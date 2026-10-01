// miniapp-permission-gate.ts — Phase 2 (PRD v0.4 §B.3) PreToolUse hard gate.
//
// Why a hook (not canUseTool): CLAUDE.md §Pit-of-Success canUseTool 红线
// (lines 215-218) — SDK calls canUseTool only on the user-facing primary
// turn. Background sub-agents never hit it; plan-mode + acceptEdits silently
// downgrades to allow-all in some paths (#295). PreToolUse runs on the
// native parser path before any canUseTool consult, so deny is unconditional
// regardless of caller (matches the §Pit-of-Success 注释: "deny 无条件采纳").
//
// This module is intentionally pure logic. It does NOT prompt the user —
// prompting is the renderer's job (`MiniAppPermissionPrompt`). The gate only
// returns one of:
//   - `{ continue: true }`            — tool is allowed (granted, or not MiniApp)
//   - `{ decision: 'block', reason }` — MiniApp tried a tool not in grants.json
//
// Identifying a MiniApp call:
//   MiniApp Sidecar owners have `session_id === "miniapp_<appId>_<runId>"`
//   (set by `cmd_miniapp_ensure_session`). The session_id reaches the hook
//   via the SDK's `HookInput.session_id` field.

import {
  isToolGranted,
  type MiniAppToolScope,
} from './utils/permissions-grants';

export const MINIAPP_SESSION_ID_PREFIX = 'miniapp_';

export interface PreToolUseHookDecision {
  /**
   * `true` lets the tool run unmodified. The shape is `HookJSONOutput`'s
   * `hookSpecificOutput.permissionDecision.decision: 'allow'` wrapper, but
   * we model just the boolean so the call site is obvious; the existing
   * PreToolUse array in agent-session.ts does the wrapping.
   */
  allow: boolean;
  /**
   * Human-readable reason when `allow === false`. Logged on the renderer
   * side as the `permission` SSE event so the user sees why their MiniApp
   * action was rejected.
   */
  reason?: string;
  /**
   * The grant scope that authorized this call (when `allow === true`).
   * Helps the renderer decide whether to surface the grant to the user.
   */
  scope?: MiniAppToolScope;
}

/**
 * Decide whether a MiniApp call should be allowed to execute.
 *
 * Pure function — does not perform I/O. The caller (the PreToolUse hook
 * lambda) is responsible for passing the pre-resolved `isToolGranted`
 * result. We keep I/O out of here so the policy can be unit-tested without
 * touching the disk.
 *
 * `appsByAppId` is a per-appId `Map<toolName, scope>` of currently-granted
 * tools. Empty map = no grants = deny.
 */
export function decideMiniAppTool(
  sessionId: string,
  toolName: string,
  grantsByApp: ReadonlyMap<string, MiniAppToolScope>,
): PreToolUseHookDecision {
  if (!sessionId.startsWith(MINIAPP_SESSION_ID_PREFIX)) {
    return { allow: true }; // Not a MiniApp call — defer to other gates.
  }
  const underscoreIdx = sessionId.indexOf('_', MINIAPP_SESSION_ID_PREFIX.length);
  if (underscoreIdx < 0) {
    return {
      allow: false,
      reason: `Malformed MiniApp session id '${sessionId}' (expected 'miniapp_<appId>_<runId>')`,
    };
  }
  const appId = sessionId.slice(
    MINIAPP_SESSION_ID_PREFIX.length,
    underscoreIdx,
  );
  const scope = grantsByApp.get(toolName);
  if (!scope) {
    return {
      allow: false,
      reason: `MiniApp '${appId}' has not been granted '${toolName}'. Prompt the user via MiniAppPermissionPrompt first.`,
    };
  }
  return { allow: true, scope };
}

/**
 * Load grants for an appId into a Map suitable for `decideMiniAppTool`.
 * Convenience for the hook integration site in agent-session.ts so the
 * gate does not need to know about `appDirs` config plumbing.
 */
export async function loadMiniAppGrantsForApp(
  appDirs: { configDir: string },
  appId: string,
): Promise<ReadonlyMap<string, MiniAppToolScope>> {
  // Phase 2 reads all grants and filters by appId; Phase 3 may add a
  // dedicated read-by-app endpoint if the file grows large.
  const all = await readAllGrants(appDirs);
  const out = new Map<string, MiniAppToolScope>();
  for (const g of all) {
    if (g.appId === appId) out.set(g.toolName, g.scope);
  }
  return out;
}

// Thin wrapper around the public store. Local to keep the gate decoupled
// from utils/permissions-grants.ts re-exports.
async function readAllGrants(
  appDirs: { configDir: string },
): Promise<{ appId: string; toolName: string; scope: MiniAppToolScope }[]> {
  const { join } = await import('node:path');
  const { existsSync, readFileSync } = await import('node:fs');
  const path = join(appDirs.configDir, 'permissions-grants.json');
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { grants?: unknown };
    if (!parsed || !Array.isArray(parsed.grants)) return [];
    return parsed.grants
      .filter(
        (g): g is { appId: string; toolName: string; scope: MiniAppToolScope } =>
          !!g &&
          typeof g === 'object' &&
          typeof (g as { appId?: unknown }).appId === 'string' &&
          typeof (g as { toolName?: unknown }).toolName === 'string' &&
          ((g as { scope?: unknown }).scope === 'session' ||
            (g as { scope?: unknown }).scope === 'always'),
      )
      .map((g) => ({
        appId: g.appId,
        toolName: g.toolName,
        scope: g.scope,
      }));
  } catch {
    return [];
  }
}

export { isToolGranted };