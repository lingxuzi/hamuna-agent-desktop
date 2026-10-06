// node-limits.ts — resolve `meta.json` `permissions.node` into the numbers
// `MiniAppWorkerPool` actually enforces.
//
// The pool must not read files itself: installed MiniApps live under
// `~/.hamuna/miniapps/<id>/` and Rust owns that path (symlink rejection, path
// validation). The Sidecar spawn route is the first place that has both the
// `appId` and a legitimate reason to touch the disk, so it resolves here and
// hands the pool plain numbers.
//
// Precedence mirrors `read_miniapp_source_blocking`: installed beats bundled,
// so a user who overrides a bundled MiniApp gets their declared limits.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseMiniAppMetadata } from '../../shared/miniapp/meta-schema';
import type { MiniAppPermissions } from '../../shared/miniapp/types';
import { getBundledTopLevelResourcePath } from '../utils/runtime';
import { getConfigDir } from '../utils/admin-config';

export const DEFAULT_MAX_MEMORY_MB = 64;
export const DEFAULT_CALL_TIMEOUT_MS = 5000;

export interface NodeLimits {
  maxMemoryMb: number;
  timeoutMs: number;
}

/**
 * Read one MiniApp's declared `permissions.node`, or `null` when the app has no
 * install dir, no readable meta.json, or a meta.json that fails schema
 * validation — a malformed meta.json must not grant limits, but it also must
 * not hard-fail the spawn: the Marketplace already refuses to list it, and
 * the default limits are the safe answer either way.
 */
export function readMiniAppNodePermission(appId: string): MiniAppPermissions['node'] | null {
  // Same installed-wins-over-bundled precedence as
  // `read_miniapp_source_blocking` in `src-tauri/src/commands.rs`: a user who
  // overrides a bundled MiniApp must get the limits they shipped.
  const installed = readDeclaredNode(join(getConfigDir(), 'miniapps', appId));
  if (installed) return installed;
  const bundledRoot = getBundledTopLevelResourcePath('bundled-miniapps');
  return bundledRoot ? readDeclaredNode(join(bundledRoot, appId)) : null;
}

function readDeclaredNode(appRoot: string): MiniAppPermissions['node'] | null {
  try {
    const raw = JSON.parse(readFileSync(join(appRoot, 'meta.json'), 'utf8')) as unknown;
    const parsed = parseMiniAppMetadata(raw);
    return parsed.ok ? (parsed.result.permissions.node ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a MiniApp's worker resource envelope. Falls back to the pool
 * defaults for any field the app omits.
 *
 * Whether a worker may exist at all is NOT decided here: the spawn route owns
 * that, and it requires an explicit `enabled === true`. This function only
 * answers "given a permitted app, what envelope does it get", so an app that
 * declares `max_memory_mb` but forgets `enabled` still gets its declared
 * number — the denial happens earlier and names the missing field.
 */
export function resolveNodeLimits(appId: string): NodeLimits {
  const declared = readMiniAppNodePermission(appId);
  return {
    maxMemoryMb: declared?.max_memory_mb ?? DEFAULT_MAX_MEMORY_MB,
    timeoutMs: declared?.timeout_ms ?? DEFAULT_CALL_TIMEOUT_MS,
  };
}
