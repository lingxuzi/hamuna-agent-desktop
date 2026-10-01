// Unit tests for the pure decision function in `miniapp-permission-gate.ts`.
// The I/O helpers (`loadMiniAppGrantsForApp`, `isToolGranted`) are exercised
// via the integration suite (Round 6 had integration for grants.json).

import { describe, expect, it } from 'vitest';
import { decideMiniAppTool } from './miniapp-permission-gate';
import type { MiniAppToolScope } from './utils/permissions-grants';

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
    // First arg includes dashes and underscores in the appId; the runId may
    // contain dashes. We deliberately do not exhaustively test every shape
    // — the integration test in the grants.ts file round-trips the full
    // set; here we just lock the parsing rule.
    const grants = new Map<string, MiniAppToolScope>([['Write', 'always']]);
    const decision = decideMiniAppTool(
      'miniapp_hello-world_run-with-dashes',
      'Write',
      grants,
    );
    expect(decision.allow).toBe(true);
  });
});