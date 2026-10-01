// node-limits.unit.test.ts — `meta.json` `permissions.node` → pool limits.
//
// The precedence rule under test (installed beats bundled) is the one that
// actually bites: a user who overrides a bundled MiniApp must get the limits
// they shipped, not the ones the app bundle declares.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'miniapp-node-limits-'));

vi.mock('../utils/admin-config', () => ({
  getConfigDir: () => home,
}));
vi.mock('../utils/runtime', () => ({
  getBundledTopLevelResourcePath: (rel: string) => join(home, rel),
}));

const { readMiniAppNodePermission, resolveNodeLimits, DEFAULT_MAX_MEMORY_MB, DEFAULT_CALL_TIMEOUT_MS } =
  await import('./node-limits');

function writeMeta(root: string, appId: string, node: unknown) {
  const dir = join(root, appId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      id: appId,
      name: 'Test',
      description: 'fixture',
      icon: 'x',
      category: 'developer',
      version: 1,
      min_host_version: '0.4.0',
      permissions: { node },
    }),
  );
}

const installedRoot = join(home, 'miniapps');
const bundledRoot = join(home, 'bundled-miniapps');

beforeEach(() => {
  rmSync(installedRoot, { recursive: true, force: true });
  rmSync(bundledRoot, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('resolveNodeLimits', () => {
  it('falls back to the pool defaults for an unknown app', () => {
    expect(resolveNodeLimits('nope')).toEqual({
      maxMemoryMb: DEFAULT_MAX_MEMORY_MB,
      timeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    });
  });

  it('reads declared limits from the installed app', () => {
    writeMeta(installedRoot, 'declared', { max_memory_mb: 128, timeout_ms: 9000 });
    expect(resolveNodeLimits('declared')).toEqual({ maxMemoryMb: 128, timeoutMs: 9000 });
  });

  it('reads declared limits from a bundled app', () => {
    writeMeta(bundledRoot, 'shipped', { max_memory_mb: 256 });
    expect(resolveNodeLimits('shipped')).toEqual({
      maxMemoryMb: 256,
      timeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    });
  });

  it('prefers the installed copy over the bundled one', () => {
    writeMeta(bundledRoot, 'both', { max_memory_mb: 256, timeout_ms: 30000 });
    writeMeta(installedRoot, 'both', { max_memory_mb: 32, timeout_ms: 2000 });
    expect(resolveNodeLimits('both')).toEqual({ maxMemoryMb: 32, timeoutMs: 2000 });
  });

  // A meta.json that fails validation must not grant limits — but it also must
  // not throw, because the Marketplace already refuses to list it and the
  // default envelope is the safe answer in the meantime.
  it('falls back to defaults for an out-of-range declaration', () => {
    writeMeta(installedRoot, 'toobig', { max_memory_mb: 4096 });
    expect(resolveNodeLimits('toobig')).toEqual({
      maxMemoryMb: DEFAULT_MAX_MEMORY_MB,
      timeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    });
  });

  it('exposes the enabled flag for the spawn route to gate on', () => {
    writeMeta(installedRoot, 'blocked', { enabled: false });
    expect(readMiniAppNodePermission('blocked')?.enabled).toBe(false);
    writeMeta(installedRoot, 'allowed', { enabled: true });
    expect(readMiniAppNodePermission('allowed')?.enabled).toBe(true);
    expect(readMiniAppNodePermission('nope')).toBeNull();
  });
});
