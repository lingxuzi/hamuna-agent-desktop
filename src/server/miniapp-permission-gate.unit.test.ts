// Unit tests for the MiniApp permission gate (`miniapp-permission-gate.ts`).
//
// `decideMiniAppTool` is the pure policy; `loadMiniAppGrantsForApp` is the I/O
// half that feeds it the grant map. Both are covered here. An earlier version
// of this header claimed the I/O half was "exercised via the integration
// suite" — no test ever called it, so the grant → load → allow chain that
// gates every MiniApp tool call ran entirely untested.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideMiniAppTool, loadMiniAppGrantsForApp } from './miniapp-permission-gate';
import { grantTool, isToolGranted, type MiniAppToolScope } from './utils/permissions-grants';

let configDir: string;
let appDirs: { configDir: string };

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'hamapp-gate-'));
  appDirs = { configDir };
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

const grantsPath = () => join(configDir, 'permissions-grants.json');

describe('miniapp-permission-gate / decideMiniAppTool', () => {
  it('passes through non-MiniApp sessions immediately', () => {
    const decision = decideMiniAppTool(
      'chat-session-123',
      'Read',
      new Map(),
    );
    expect(decision.allow).toBe(true);
    expect(decision.scope).toBeUndefined();
  });

  it('denies when MiniApp session_id is malformed', () => {
    const decision = decideMiniAppTool('miniapp_', 'Read', new Map());
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/Malformed MiniApp session id/);
  });

  it('denies when the tool is not granted', () => {
    const decision = decideMiniAppTool(
      'miniapp_icon-generator_run-abc',
      'Bash',
      new Map(),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/has not been granted/);
  });

  it('allows when the tool is granted with scope "session"', () => {
    const grants = new Map<string, MiniAppToolScope>([['Bash', 'session']]);
    const decision = decideMiniAppTool(
      'miniapp_icon-generator_run-abc',
      'Bash',
      grants,
    );
    expect(decision.allow).toBe(true);
    expect(decision.scope).toBe('session');
  });

  it('allows when the tool is granted with scope "always"', () => {
    const grants = new Map<string, MiniAppToolScope>([['Write', 'always']]);
    const decision = decideMiniAppTool(
      'miniapp_icon-generator_run-abc',
      'Write',
      grants,
    );
    expect(decision.allow).toBe(true);
    expect(decision.scope).toBe('always');
  });

  it('extracts the appId from "miniapp_<appId>_<runId>"', () => {
    // Both halves are kebab-case ASCII — appId may contain dashes, runId may
    // contain dashes, and neither may contain "_" (enforced upstream by
    // `is_safe_app_id` / `is_safe_run_id`). So the first "_" after the
    // `miniapp_` prefix is always the appId/runId boundary. We deliberately do
    // not test illegal shapes here: they cannot reach the hook, and the loader
    // tests below cover the live read path.
    const grants = new Map<string, MiniAppToolScope>([['Write', 'always']]);
    const decision = decideMiniAppTool(
      'miniapp_hello-world_run-with-dashes',
      'Write',
      grants,
    );
    expect(decision.allow).toBe(true);
  });
});

// The gate's loader is the live read path: `agent-session.ts` calls
// `loadMiniAppGrantsForApp` inside the PreToolUse hook for every
// `miniapp_<appId>_<runId>` session.
describe('miniapp-permission-gate / loadMiniAppGrantsForApp', () => {
  it('returns only the requested app\'s grants', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    await grantTool(appDirs, 'git-graph', 'Write', 'always');
    await grantTool(appDirs, 'file-explorer', 'Read', 'always');

    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect([...grants.keys()].sort()).toEqual(['Bash', 'Write']);
    expect(grants.get('Bash')).toBe('session');
    expect(grants.get('Write')).toBe('always');
    // The other app's tool must not leak into this app's map — this map is
    // the entire authorization surface for the hook.
    expect(grants.has('Read')).toBe(false);
  });

  it('returns an empty map when the grants file does not exist', async () => {
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect(grants.size).toBe(0);
  });

  it('returns an empty map for unparseable JSON (fail closed, never throws)', async () => {
    writeFileSync(grantsPath(), 'not json at all', 'utf8');
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect(grants.size).toBe(0);
  });

  it('returns an empty map when the record shape is wrong', async () => {
    writeFileSync(grantsPath(), JSON.stringify({ grants: 'nope' }), 'utf8');
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect(grants.size).toBe(0);
  });

  it('feeds decideMiniAppTool end to end: granted tool runs, ungranted is denied', async () => {
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    const sessionId = 'miniapp_git-graph_run-abc';

    const allowed = decideMiniAppTool(
      sessionId,
      'Bash',
      await loadMiniAppGrantsForApp(appDirs, 'git-graph'),
    );
    expect(allowed.allow).toBe(true);
    expect(allowed.scope).toBe('session');

    const denied = decideMiniAppTool(
      sessionId,
      'Write',
      await loadMiniAppGrantsForApp(appDirs, 'git-graph'),
    );
    expect(denied.allow).toBe(false);
    expect(denied.reason).toMatch(/has not been granted/);
  });

  it('does not let one app answer for another through a shared session id shape', async () => {
    // The hook derives appId by splitting "miniapp_<appId>_<runId>" on "_".
    // That is only sound because both halves are kebab-case ASCII, enforced by
    // `is_safe_app_id` / `is_safe_run_id` in `cmd_miniapp_ensure_session`
    // before the session is created. This test pins the gate's half of that
    // contract: given a well-formed id, it must resolve to exactly one app.
    await grantTool(appDirs, 'git-graph', 'Bash', 'session');
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph-run-abc');
    expect(grants.size).toBe(0);
  });
});

describe('miniapp-permission-gate / parser parity with the store', () => {
  // The gate keeps its own parser so it never takes `withFileLock` on the
  // PreToolUse hot path. That makes this pair of assertions the thing standing
  // between "two parsers" and "two different answers": they pin the gate's
  // filter to `permissions-grants.isValidGrant` in BOTH directions, so the two
  // can never quietly drift apart again.
  it('rejects exactly the records the store rejects', async () => {
    // Regression: the gate's filter skipped `grantedAt`, so the allow authority
    // honoured a record `isToolGranted` treated as absent. Only `grantTool`
    // writes this file and it always stamps the field, so the record is only
    // reachable by a hand-edited or third-party-written grants file - but the
    // gate is what authorises every MiniApp tool call, and it must never be
    // the laxer of the two.
    writeFileSync(
      grantsPath(),
      JSON.stringify({ grants: [{ appId: 'git-graph', toolName: 'Bash', scope: 'always' }] }),
      'utf8',
    );
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect(grants.get('Bash')).toBeUndefined();
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(false);
  });

  it('still honours a fully-formed grant', async () => {
    // The other direction, so parity cannot be "fixed" by making the gate
    // ignore the file and silently deny every real grant - which would look
    // exactly like correct fail-closed behaviour right up until a user could
    // not run any MiniApp tool at all.
    writeFileSync(
      grantsPath(),
      JSON.stringify({
        grants: [
          {
            appId: 'git-graph',
            toolName: 'Bash',
            scope: 'always',
            grantedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      'utf8',
    );
    const grants = await loadMiniAppGrantsForApp(appDirs, 'git-graph');
    expect(grants.get('Bash')).toBe('always');
    expect(await isToolGranted(appDirs, 'git-graph', 'Bash')).toBe(true);
  });
});
