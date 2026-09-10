// Bundled MCP auto-merge — runs at sidecar startup so the install-time
// product surface is always present on first launch (user does not have
// to manually enable each bundled entry in Settings). User-driven
// overrides (custom servers, env, args) are preserved.
//
// seedBundledExtendedMcpServers():
//   Diff-merge entries from `extended_buildin_mcp/mcp.json` into
//   ~/.hamuna/config.json::mcpServers. Never overwrites entries the
//   user already has. (Trade-off: re-merges an entry the user
//   explicitly removed — opt-out list is a follow-up.)
//
// Failure semantics: best-effort. A poisoned bundle config must NOT
// prevent the Sidecar from starting — regular user MCPs are still
// honoured.

import { atomicModifyConfig, loadConfig } from './utils/admin-config';
import { loadExtendedBuiltinMcpServers } from './utils/extended-builtin-mcp';
import type { McpServerDefinition } from '../shared/config-types';

/**
 * Diff-merge entries from `extended_buildin_mcp/mcp.json` into
 * `~/.hamuna/config.json::mcpServers`. Idempotent — re-running on a
 * config that already has all bundled entries is a no-op.
 *
 * Product trade-off: this is "auto-merge on first install" semantics,
 * not "user can opt out of bundled entries". If a user removes a
 * bundled entry from `mcpServers` via the Settings UI, the next
 * Sidecar startup will re-merge it. Follow-up PR can add an
 * `mcpDisabledBundledMcpServers: string[]` opt-out list and wire the
 * Settings UI delete handler to populate it (out of scope here).
 *
 * Race safety: writes go through `atomicModifyConfig` so the on-disk
 * config.json swap is locked + tmp-rename atomic (see
 * `admin-config.ts::withConfigLock`). Reading is `loadConfig` (in-memory
 * cache + the same lock when the cache misses).
 *
 * Always returns void; logs (and never throws) on partial failure so
 * Sidecar startup is never blocked.
 */
export function seedBundledExtendedMcpServers(): void {
  let bundled: McpServerDefinition[];
  try {
    bundled = loadExtendedBuiltinMcpServers();
  } catch (err) {
    console.warn('[mcp-seed] failed to load bundled extended MCP config:', err);
    return;
  }
  if (bundled.length === 0) return;

  // Synchronous load — atomicModifyConfig will re-read inside its own
  // lock so this is just a fast path / log-line carrier.
  const config = loadConfig();
  const existing = Array.isArray(config.mcpServers) ? config.mcpServers : [];
  const existingIds = new Set(existing.map((s) => s.id));

  const missing = bundled.filter((s) => !existingIds.has(s.id));
  if (missing.length === 0) {
    console.log(`[mcp-seed] all ${bundled.length} bundled extended MCP(s) already present in ~/.hamuna/config.json — no merge needed`);
    return;
  }

  // Capture pre-merge state so we can re-check inside the lock — the
  // synchronous loadConfig() above may race with a concurrent writer
  // (e.g. an HTTP handler that also calls atomicModifyConfig). The
  // inside-lock re-check ensures we don't double-merge if another
  // writer raced us between loadConfig and atomicModifyConfig.
  atomicModifyConfig((c) => {
    const cur = Array.isArray(c.mcpServers) ? c.mcpServers : [];
    const curIds = new Set(cur.map((s) => s.id));
    const toAdd = bundled.filter((s) => !curIds.has(s.id));
    if (toAdd.length === 0) return c;
    console.log(
      `[mcp-seed] auto-merging ${toAdd.length} bundled extended MCP(s) into ~/.hamuna/config.json::mcpServers: ${toAdd.map((s) => s.id).join(', ')}`,
    );
    return {
      ...c,
      mcpServers: [...cur, ...toAdd],
    };
  }).catch((err) => {
    // atomicModifyConfig throws ConfigBusyError / FileBusyError on
    // contention. Swallow — the next startup will retry, and the
    // user can still enable these via Settings.
    console.warn('[mcp-seed] auto-merge failed (will retry next startup):', err);
  });
}
