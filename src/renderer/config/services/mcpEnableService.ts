/**
 * Shared MCP enable path — the single definition of "turn this MCP on".
 *
 * Chat's composer tool-menu and Settings' MCP cards are two entry points onto
 * the same intent, but they write DIFFERENT config layers:
 *
 *   Settings → `AppConfig.mcpEnabledServers`  (global catalogue gate)
 *   Chat     → `Project/AgentConfig.mcpEnabledServers` + session snapshot
 *
 * The set that actually runs is the intersection of both (see
 * `persistInputOption.ts` / `mcpService.getEffectiveMcpServers`), so the two
 * toggles are deliberately NOT the same write and must stay separate. What
 * WAS duplicated — and had drifted — is everything up to that point: the
 * requiresConfig pre-check, the `/api/mcp/enable` handshake, and the decision
 * of what a given failure means. Chat had grown up without the pre-check, so
 * enabling an MCP with no API key burned a full npx handshake before failing
 * with a bare toast.
 *
 * This module owns that shared prefix and returns a structured outcome. It
 * deliberately knows nothing about UI: the caller decides whether a given
 * outcome becomes a toast, a config dialog, or a download prompt. That is why
 * Settings keeps its `runtimeDialog` while Chat shows a toast — same verdict,
 * different surface.
 */
import { homeDir, join } from '@tauri-apps/api/path';

import { apiPostJson } from '@/api/apiFetch';
import type { McpEnableError, McpServerDefinition } from '../../../shared/config-types';
import { getMcpServerArgs, getMcpServerEnv, saveMcpServerArgs } from './mcpService';

export type McpEnableOutcome =
  | { ok: true; playwrightArgsInitialized: boolean }
  | { ok: false; kind: 'missing-config'; missingKeys: string[] }
  | { ok: false; kind: 'runtime-missing'; runtimeName?: string; downloadUrl?: string; command?: string }
  | { ok: false; kind: 'failed'; message: string };

interface EnableResponse {
  success: boolean;
  error?: McpEnableError;
}

/**
 * Which of the server's `requiresConfig` keys have no saved value yet.
 *
 * Blank/whitespace-only counts as missing — an env var set to " " is the same
 * as unset as far as the spawned process is concerned. Servers without
 * `requiresConfig` return [].
 */
export async function findMissingMcpConfigKeys(server: McpServerDefinition): Promise<string[]> {
  const required = server.requiresConfig;
  if (!required || required.length === 0) return [];
  const savedEnv = await getMcpServerEnv(server.id);
  return required.filter((key) => !savedEnv?.[key]?.trim());
}

/**
 * Give Playwright a persistent-profile default the first time it is enabled.
 *
 * `undefined` from getMcpServerArgs means "never configured" — distinct from
 * `[]`, which means the user deliberately cleared the args, so an empty array
 * is left alone. Best-effort: a failure here must not fail the enable, the MCP
 * still works with whatever args it has.
 */
async function initPlaywrightArgsIfUnset(): Promise<boolean> {
  const existing = await getMcpServerArgs('playwright');
  if (existing !== undefined) return false;
  try {
    const home = await homeDir();
    const profilePath = await join(home, '.playwright-mcp-profile');
    await saveMcpServerArgs('playwright', [`--user-data-dir=${profilePath}`]);
    return true;
  } catch (e) {
    console.warn('[mcpEnable] failed to init default Playwright args:', e);
    return false;
  }
}

/**
 * Validate + hand off to the sidecar's real stdio handshake, then classify the
 * result. Never throws — every failure comes back as an `ok: false` variant so
 * callers stay free of try/catch noise.
 *
 * The requiresConfig check short-circuits BEFORE the network call: a server
 * that cannot possibly work should not cost a cold npx spawn to find out.
 */
export async function enableMcpServer(server: McpServerDefinition): Promise<McpEnableOutcome> {
  const missingKeys = await findMissingMcpConfigKeys(server);
  if (missingKeys.length > 0) {
    return { ok: false, kind: 'missing-config', missingKeys };
  }

  let response: EnableResponse;
  try {
    response = await apiPostJson<EnableResponse>('/api/mcp/enable', { server });
  } catch (err) {
    return {
      ok: false,
      kind: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (response?.success) {
    return {
      ok: true,
      playwrightArgsInitialized: server.id === 'playwright'
        ? await initPlaywrightArgsIfUnset()
        : false,
    };
  }

  const error = response?.error;
  if (error?.type === 'command_not_found') {
    // The runtime binary is absent. Settings can offer a download dialog for
    // this; Chat surfaces it as a toast. Same verdict, different surface.
    return {
      ok: false,
      kind: 'runtime-missing',
      runtimeName: error.runtimeName,
      downloadUrl: error.downloadUrl,
      command: error.command,
    };
  }

  return {
    ok: false,
    kind: 'failed',
    message: error?.message || 'MCP enable failed',
  };
}
