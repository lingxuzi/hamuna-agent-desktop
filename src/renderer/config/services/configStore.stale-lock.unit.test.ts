import { describe, expect, it } from 'vitest';

import { CONFIG_LOCK_STALE_MS, shouldBreakStaleLock } from './configStore';

/**
 * Regression for a hard deadlock: `~/.hamuna/projects.json.lock` was left
 * behind as an empty directory with no `owner` file (mtime 33 days old). The
 * renderer read the missing owner, gave up, and then timed out on every
 * acquire — forever. Creating any workspace died with
 * "Config busy: could not acquire config.json.lock within 5000ms; retry",
 * naming a file that was not even the one blocking.
 *
 * Node (`file-lock.ts`) and Rust (`utils/file_lock.rs`) both treat "no owner"
 * as recoverable-by-age, so a crashed writer self-heals. The renderer was the
 * only runtime that could deadlock on it.
 */
describe('shouldBreakStaleLock', () => {
    const stale = CONFIG_LOCK_STALE_MS;

    it('breaks its own runtime locks once past staleMs', () => {
        expect(shouldBreakStaleLock(stale + 1, 'renderer:1700000000000:abc', stale)).toBe(true);
        expect(shouldBreakStaleLock(stale - 1, 'renderer:1700000000000:abc', stale)).toBe(false);
    });

    it('breaks a lock that has no owner file, matching Node and Rust', () => {
        // Impossible to have held a lock for 2 minutes without writing an
        // owner record, so this is a crashed/legacy writer, not a live one.
        expect(shouldBreakStaleLock(stale * 4 + 1, '', stale)).toBe(true);
        expect(shouldBreakStaleLock(stale - 1, '', stale)).toBe(false);
    });

    it('stays conservative for owners it cannot verify', () => {
        // The renderer cannot probe another process's pid from the WebView, so
        // it must wait longer than it would for one of its own locks. Anything
        // it cannot identify gets the same grace period as node:/rust:.
        for (const owner of ['node:1234:1700000000000', 'rust:1234:1700000000000', 'garbage']) {
            expect(shouldBreakStaleLock(stale + 1, owner, stale)).toBe(false);
            expect(shouldBreakStaleLock(stale * 4 + 1, owner, stale)).toBe(true);
        }
    });
});
