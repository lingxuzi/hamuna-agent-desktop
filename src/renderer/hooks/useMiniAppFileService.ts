// MiniApp file service hook — Phase 1 of PRD v0.4 §B.2.
//
// Lightweight wrapper around the MiniApp install path. Phase 1 deliberately
// stops at *path resolution* — full file read/write UI is deferred to Phase 2
// because:
//   - the renderer reads MiniApp files via the MiniAppRunner iframe sandbox
//     (source/ is loaded directly into the iframe via local URL); renderer
//     itself does not need to read source/* bytes to render the MiniApp
//   - drag-to-Chat context (PRD §B.2 item 5) needs the Bubble Claim
//     attachment pipeline (Phase 2) to keep tool_attachment protocol
//     invariants (PRD v0.3 §4.2 + CLAUDE.md §Pit-of-Success
//     tool_attachment_pipeline)
//
// Phase 1 surface:
//   - resolveAppPath(rel): `source/index.html` → `~/.hamuna/miniapps/<id>/source/index.html`
//   - parseAppIdFromPath(abs): reverse the resolution
//   - isValidAppId(id): kebab-case ASCII guard (mirrors Rust is_safe_app_id)
//
// Future phases can add file tree + diff preview by reading `cmd_miniapp_*`
// endpoints; the resolver below is the single point all of them thread
// through.

import { useCallback } from 'react';

const APP_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * Validate MiniApp id matches Rust `is_safe_app_id` (PRD v0.3 §2.1.1).
 * Use this before any path resolution to fail fast on bad input.
 */
export function isValidAppId(appId: string): boolean {
  if (!APP_ID_PATTERN.test(appId)) return false;
  if (appId.startsWith('-') || appId.endsWith('-')) return false;
  return true;
}

/**
 * Resolve a relative path inside a MiniApp's install directory.
 * Returns the absolute path under `~/.hamuna/miniapps/<appId>/<rel>`.
 *
 * Rejects path traversal (`..`) and absolute paths. Pure function — no Tauri
 * dependency, safe to call during render.
 */
export function resolveMiniAppPath(appId: string, rel: string): string {
  if (!isValidAppId(appId)) {
    throw new Error(`Invalid MiniApp id: '${appId}'`);
  }
  if (rel.length === 0 || rel.startsWith('/') || rel.includes('..')) {
    throw new Error(`Invalid relative path: '${rel}'`);
  }
  // homedir() resolves via Node-side fs at runtime; we use a sentinel here so
  // the renderer can compute on its own. Real path comes from
  // `cmd_miniapp_list_installed` which returns absolute paths.
  return `<~/.hamuna/miniapps/${appId}/${rel}>`;
}

/**
 * Pull appId from an absolute path inside a MiniApp install.
 * Returns null if the path does not live under `~/.hamuna/miniapps/<id>/`.
 */
export function parseAppIdFromPath(absPath: string): string | null {
  const m = absPath.match(/^(?:\/[^/]+)*\/?\.hamuna\/miniapps\/([a-z0-9-]{1,64})(?:\/|$)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Phase 1 hook surface — currently just exposes the pure helpers. Phase 2
 * will return a callable service object for file tree + diff preview.
 */
export function useMiniAppFileService(appId: string | null) {
  const resolvePath = useCallback(
    (rel: string) => {
      if (!appId) throw new Error('appId required for resolvePath');
      return resolveMiniAppPath(appId, rel);
    },
    [appId]
  );

  return {
    isValidAppId,
    resolvePath,
    parseAppIdFromPath,
    appId,
  };
}