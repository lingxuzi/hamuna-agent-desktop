// Bundled MCP auto-merge + bundled-uvx sidecar seed.
//
// Runs at sidecar startup so the install-time product surface is always
// present on first launch (user does not have to manually enable each
// bundled entry in Settings). User-driven overrides (custom servers, env,
// args) are preserved.
//
// Two responsibilities:
//   1. seedBundledExtendedMcpServers()
//      Diff-merge entries from `extended_buildin_mcp/mcp.json` into
//      ~/.hamuna/config.json::mcpServers. Never overwrites entries the
//      user already has. (Trade-off: re-merges an entry the user
//      explicitly removed — opt-out list is a follow-up.)
//
//   2. seedBundledUvToHamunaBin()
//      Copy the bundled `uvx.exe` (Windows-only — macOS/Linux use
//      system uv / Homebrew) from <install-dir>/uvx.exe to
//      ~/.hamuna/bin/uvx.exe. The latter is on the user PATH (CLI
//      installer shim registers it for the same reason: `hamuna.cmd`
//      must be discoverable by `cmd.exe`). Without this copy, MCP
//      spawns of `uvx` fail with ENOENT because the install-dir is
//      not on PATH for normal NSIS / .app bundle layouts.
//
// Failure semantics: both are best-effort. A poisoned bundle config
// or missing binary must NOT prevent the Sidecar from starting —
// regular user MCPs are still honoured, and the per-spawn fallback
// in `agent-session.ts` (system PATH lookup + bundled-path prepend)
// covers the case where the seed could not run.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { atomicModifyConfig, loadConfig } from './utils/admin-config';
import { getBundledUvPath } from './utils/runtime';
import { getHomeDirOrNull } from './utils/platform';
import { ensureDirSync } from './utils/fs-utils';
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

/**
 * Copy the bundled `uvx.exe` from the install-dir to
 * `~/.hamuna/bin/uvx.exe` so MCP spawns of `uvx` resolve via the
 * user PATH (which already includes ~/.hamuna/bin via the CLI shim
 * install — see `system_binary.rs::augmented_path`).
 *
 * Idempotent: if the target already exists with the same size, we
 * skip the copy. The size check is a cheap proxy for "same binary
 * version" without needing a content hash.
 *
 * Race safety: written to a `.tmp` sibling then renamed, mirroring
 * the `withConfigLock` tmp-rename pattern. `lstatSync` + `existsSync`
 * double-probe (CLAUDE.md pit-of-success) avoids the broken-symlink
 * → `cpSync` C++ exception crash that bit us in v0.2.5.
 *
 * Windows-only — macOS/Linux installers expect system / Homebrew uv.
 *
 * Always returns void; logs and never throws so Sidecar startup is
 * never blocked.
 */
export function seedBundledUvToHamunaBin(): void {
  if (process.platform !== 'win32') return;

  const bundled = getBundledUvPath();
  if (!bundled) {
    // No bundled uvx on this machine (older install without bundling,
    // or dev box that never ran download_uv.ps1). Nothing to do —
    // agent-session.ts will fall back to system PATH and surface a
    // clear warning if `uvx` is still missing.
    return;
  }

  const homeDir = getHomeDirOrNull();
  if (!homeDir) {
    console.warn('[mcp-seed] HOME not resolvable — skipping bundled uvx copy to ~/.hamuna/bin/');
    return;
  }
  const binDir = join(homeDir, '.hamuna', 'bin');
  const target = join(binDir, 'uvx.exe');

  // Broken-symlink guard (CLAUDE.md pit-of-success: a dangling
  // symlink at `target` would make `existsSync(target)` return
  // false, hiding the symlink from the early-exit skip, and a
  // subsequent `cpSync` would throw a C++ exception that JS
  // try/catch cannot intercept — the sidecar aborts). Probe
  // `lstatSync` first to surface the symlink, then `unlinkSync`
  // before we re-copy.
  let dstLstat: ReturnType<typeof lstatSync> | null = null;
  try {
    dstLstat = lstatSync(target);
  } catch {
    // target doesn't exist — fall through to copy path
  }
  const dstExists = existsSync(target);
  const isBrokenSymlink = dstLstat?.isSymbolicLink() && !dstExists;
  if (isBrokenSymlink) {
    try {
      unlinkSync(target);
      console.warn(`[mcp-seed] removed broken symlink at ${target} before re-copy`);
    } catch (err) {
      console.warn(`[mcp-seed] failed to remove broken symlink at ${target}, skipping:`, err);
      return;
    }
  }

  // Idempotent fast path: same size = same binary, skip.
  if (!isBrokenSymlink && dstExists) {
    try {
      const srcSize = lstatSync(bundled).size;
      const dstSize = lstatSync(target).size;
      if (srcSize === dstSize) return;
    } catch {
      // fall through to copy attempt; the actual copy will surface
      // any real error.
    }
  }

  try {
    ensureDirSync(binDir);
  } catch (err) {
    console.warn(`[mcp-seed] failed to ensure ${binDir}:`, err);
    return;
  }

  const tmp = target + '.tmp';
  try {
    copyFileSync(bundled, tmp);
    renameSync(tmp, target);
    console.log(`[mcp-seed] copied bundled uvx (${bundled}) → ${target}`);
  } catch (err) {
    // Best-effort cleanup of partial tmp
    try {
      unlinkSync(tmp);
    } catch { /* ignore */ }
    console.warn(`[mcp-seed] failed to copy bundled uvx to ${target}:`, err);
  }
}
