// Unit tests for the MiniApp per-tool grant store (`utils/permissions-grants.ts`).
//
// This store is the persistence half of the MiniApp permission gate: the
// renderer writes grants here via `grantTool`, and `miniapp-permission-gate.ts`
// reads them back to decide whether a MiniApp may run a tool. It had no test
// at all — the gate's own unit test claimed the I/O half was "exercised via the
// integration suite", but no test ever called any of these functions, so the
// whole grant → allow chain ran untested.
//
// No fake timers here on purpose: `withFileLock` polls with `Date.now()` for
// its acquire-timeout and stale-lock windows, so freezing the clock would
// deadlock the lock rather than exercise it. Assertions therefore pin grant
// identity and shape, never an exact timestamp.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grantTool, isToolGranted, revokeTool } from './utils/permissions-grants';

let configDir: string;
let appDirs: { configDir: string };

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'hamuna-grants-'));
  appDirs = { configDir };
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

const grantsPath = () => join(configDir, 'permissions-grants.json');
const readRaw = () =>
  JSON.parse(readFileSync(grantsPath(), 'utf8')) as { grants: Record<string, unknown>[] };

describe('permissions-grants / grantTool + isToolGranted', () => {
  it('round-trips a grant through the file', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(true);
  });

  it('does not bleed a grant across appId or toolName', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    // Same tool, different app. The gate keys on BOTH halves of the pair, so
    // one app must never inherit another app's grant — this is the property
    // the PreToolUse gate depends on for per-app isolation.
    expect(await isToolGranted(appDirs, 'file-explorer', 'Bash')).toBe(false);
    // Same app, different tool.
    expect(await isToolGranted(appDirs, 'git-graph', 'Write')).toBe(false);
  });

  it('records grantedAt as a parseable ISO timestamp', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'always');
    const g = readRaw().grants[0]!;
    expect(g.appId).toBe('git-graph');
    expect(g.toolName).toBe('Bash');
    expect(g.scope).toBe('always');
    expect(Number.isNaN(Date.parse(g.grantedAt as string))).toBe(false);
  });

  it('re-granting updates in place instead of appending a duplicate', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    await grantTool(appDirs, 'git-graph', 'Bash', 'always');
    const grants = readRaw().grants;
    expect(grants).toHaveLength(1);
    expect(grants[0]!.scope).toBe('always');
  });

  it('keeps every grant when writers race without awaiting each other', async () => {
    // Distinct (appId, tool) pairs written concurrently. All four share one
    // lock path, so the store must serialize them — without withFileLock this
    // is last-writer-wins and pairs silently vanish.
    await Promise.all([
      grantTool(appDirs, 'a-one', 'Bash', 'session'),
      grantTool(appDirs, 'b-two', 'Write', 'session'),
      grantTool(appDirs, 'c-three', 'Read', 'always'),
      grantTool(appDirs, 'd-four', 'Edit', 'always'),
    ]);
    expect(readRaw().grants).toHaveLength(4);
    expect(await isToolGranted(appDirs, 'c-three', 'Read')).toBe(true);
  });
});

describe('permissions-grants / revokeTool', () => {
  it('removes exactly the revoked pair and leaves the rest', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    await grantTool(appDirs, 'git-graph', 'Write', 'session');
    await revokeTool(appDirs, 'git-graph', 'Bash');
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
    expect(await isToolGranted(appDirs, 'git-graph', 'Write')).toBe(true);
  });

  it('is a no-op for a pair that was never granted', async () => {
    await grantTool(appDirs, 'git-graph', 'Write', 'session');
    await revokeTool(appDirs, 'git-graph', 'Bash');
    expect(readRaw().grants).toHaveLength(1);
  });
});

describe('permissions-grants / corrupt and hostile files fail closed', () => {
  it('treats unparseable JSON as no grants', async () => {
    writeFileSync(grantsPath(), '{ this is not json', 'utf8');
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
  });

  it('treats a non-array grants field as no grants', async () => {
    writeFileSync(grantsPath(), JSON.stringify({ grants: { Bash: true } }), 'utf8');
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
  });

  it('drops a record whose scope is outside session|always', async () => {
    // 'admin' is not a real scope. Honouring an unknown scope would widen what
    // the gate lets through, so the whole record must be rejected.
    writeFileSync(
      grantsPath(),
      JSON.stringify({
        grants: [
          {
            appId: 'git-graph',
            toolName: 'Bash',
            scope: 'admin',
            grantedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      'utf8',
    );
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
  });

  it('drops a record missing grantedAt, then recovers on the next write', async () => {
    writeFileSync(
      grantsPath(),
      JSON.stringify({ grants: [{ appId: 'git-graph', toolName: 'Bash', scope: 'always' }] }),
      'utf8',
    );
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
    // A rejected read must not wedge the store: the next grant rewrites a
    // valid file rather than propagating the garbage forward.
    await grantTool(appDirs, 'file-explorer', 'Read', 'session');
    expect(readRaw().grants).toHaveLength(1);
    expect(await isToolGranted(appDirs, 'file-explorer', 'Read')).toBe(true);
  });

  it('writes into a config dir that already exists', async () => {
    // NOTE: a *missing* config dir currently throws ENOENT from withFileLock,
    // which mkdir's `<file>.lock` before writeAtomic gets a chance to create
    // the dir. Latent in production (~/.hamuna is created at startup), and the
    // fix belongs in withFileLock — 22 callers — not here. Tracked, not pinned.
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    expect(existsSync(grantsPath())).toBe(true);
  });
});

// Regression: `readGrantsFile` used to return `{ ...EMPTY_FILE }`, a shallow
// spread of a module-level constant. Every caller therefore shared ONE `grants`
// array, and `grantTool` pushed into it — so the constant accumulated every
// grant made in the process. Deleting or corrupting the file then resurrected
// those grants in memory, i.e. the gate failed OPEN on a missing grants file.
describe('permissions-grants / empty-state isolation (regression)', () => {
  it('does not resurrect a grant after the file is deleted', async () => {
    await grantTool(appDirs, 'app-one', 'Bash', 'always');
    rmSync(grantsPath());
    expect(await isToolGranted(appDirs, 'app-one', 'Bash')).toBe(false);
  });

  it('does not resurrect a grant after the file is corrupted', async () => {
    await grantTool(appDirs, 'app-two', 'Write', 'session');
    writeFileSync(grantsPath(), 'CORRUPT', 'utf8');
    expect(await isToolGranted(appDirs, 'app-two', 'Write')).toBe(false);
  });

  it('does not leak grants between two independent config dirs', async () => {
    // Two apps must not see each other's grants through the shared constant.
    const other = { configDir: mkdtempSync(join(tmpdir(), 'hamuna-grants-b-')) };
    try {
      await grantTool(appDirs, 'app-one', 'Bash', 'always');
      expect(await isToolGranted(other, 'app-one', 'Bash')).toBe(false);
      expect(await isToolGranted(other, 'app-one', 'Bash')).toBe(false);
    } finally {
      rmSync(other.configDir, { recursive: true, force: true });
    }
  });

  it('keeps revoking scoped to the revoked pair when the file is gone', async () => {
    // With the shared array, revoking an unrelated pair could write another
    // app's stale grant back to disk.
    await grantTool(appDirs, 'app-one', 'Bash', 'always');
    rmSync(grantsPath());
    await revokeTool(appDirs, 'app-three', 'Read');
    expect(existsSync(grantsPath())).toBe(false);
  });
});
