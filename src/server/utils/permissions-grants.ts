// permissions-grants.ts — MiniApp per-tool grants store.
//
// Schema (Phase 2, PRD v0.4 §B.3):
//   { appId: string, toolName: string, scope: 'session' | 'always', grantedAt: ISO }
//
// Read by `miniapp-permission-gate.ts` PreToolUse hook; written by the
// `MiniAppPermissionPrompt` UI. Lives at ~/.hamuna/permissions-grants.json
// — same file as config.json (withConfigLock), never raw `fs::rename`.
//
// Why a dedicated file (not config.json field):
//   - Different write cadence (every permission grant is a write, vs config
//     which is coalesced) → independent lock reduces contention
//   - Smaller blast radius: a corrupt grants file doesn't brick config reload
//   - Future Market place (Phase 3) can mirror grants across installs without
//     copying the whole config

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { withFileLock } from './file-lock';

export type MiniAppToolScope = 'session' | 'always';

export interface MiniAppPermissionGrant {
  appId: string;
  toolName: string;
  scope: MiniAppToolScope;
  grantedAt: string;
}

interface GrantsFile {
  grants: MiniAppPermissionGrant[];
}

const EMPTY_FILE: GrantsFile = { grants: [] };

function grantsPath(appDirs: { configDir: string }): string {
  return join(appDirs.configDir, 'permissions-grants.json');
}

function readGrantsFile(path: string): GrantsFile {
  if (!existsSync(path)) return { ...EMPTY_FILE };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GrantsFile>;
    if (!parsed || !Array.isArray(parsed.grants)) return { ...EMPTY_FILE };
    return { grants: parsed.grants.filter((g: unknown) => isValidGrant(g)) };
  } catch {
    // Corrupt file → start fresh. The lock-then-tmp+rename pattern on write
    // means a torn write would surface here, never silently dropping data.
    return { ...EMPTY_FILE };
  }
}

function isValidGrant(g: unknown): g is MiniAppPermissionGrant {
  if (!g || typeof g !== 'object') return false;
  const rec = g as Record<string, unknown>;
  return (
    typeof rec.appId === 'string' &&
    typeof rec.toolName === 'string' &&
    (rec.scope === 'session' || rec.scope === 'always') &&
    typeof rec.grantedAt === 'string'
  );
}

/**
 * Check whether `(appId, toolName)` is currently granted. Session-scoped
 * grants are returned regardless of timestamp; the renderer is responsible
 * for tying session scope to the active Sidecar session.
 */
export async function isToolGranted(
  appDirs: { configDir: string },
  appId: string,
  toolName: string,
): Promise<boolean> {
  const path = grantsPath(appDirs);
  const file = await withFileLock(
    { lockPath: path + '.lock' },
    async () => readGrantsFile(path),
  );
  return file.grants.some((g) => g.appId === appId && g.toolName === toolName);
}

/**
 * Grant `(appId, toolName)` with the chosen scope. Idempotent — re-granting
 * the same pair updates `grantedAt` and does not create duplicates. Atomic
 * tmp+rename inside the config lock prevents torn writes when the
 * MiniAppPermissionPrompt UI fires twice rapidly (single-prompt + bulk
 * "Allow this session").
 */
export async function grantTool(
  appDirs: { configDir: string },
  appId: string,
  toolName: string,
  scope: MiniAppToolScope,
): Promise<void> {
  const path = grantsPath(appDirs);
  await withFileLock({ lockPath: path + '.lock' }, async () => {
    const file = readGrantsFile(path);
    const grantedAt = new Date().toISOString();
    const existing = file.grants.findIndex(
      (g) => g.appId === appId && g.toolName === toolName,
    );
    if (existing >= 0) {
      file.grants[existing] = { appId, toolName, scope, grantedAt };
    } else {
      file.grants.push({ appId, toolName, scope, grantedAt });
    }
    writeAtomic(path, file);
  });
}

/**
 * Revoke a grant. No-op if the pair isn't present (Phase 2 doesn't surface
 * a revoke UI; this exists for future "manage permissions" page).
 */
export async function revokeTool(
  appDirs: { configDir: string },
  appId: string,
  toolName: string,
): Promise<void> {
  const path = grantsPath(appDirs);
  await withFileLock({ lockPath: path + '.lock' }, async () => {
    const file = readGrantsFile(path);
    const next = file.grants.filter(
      (g) => !(g.appId === appId && g.toolName === toolName),
    );
    if (next.length === file.grants.length) return; // no-op
    file.grants = next;
    writeAtomic(path, file);
  });
}

function writeAtomic(path: string, file: GrantsFile): void {
  // tmp + rename pattern (CLAUDE.md §Pit-of-Success fs-utils red line).
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  // On POSIX rename is atomic; on Windows, rename is non-atomic but Node
  // uses MoveFileEx with MOVEFILE_REPLACE_EXISTING. withFileLock serializes
  // writers so the non-atomic window can't be observed by another renderer.
  renameSync(tmp, path);
}