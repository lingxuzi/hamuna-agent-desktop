// Bundled MCP auto-merge — runs at sidecar startup so the install-time
// product surface is always present on first launch (user does not have
// to manually enable each bundled entry in Settings).
//
// seedBundledExtendedMcpServers():
//   Selective merge of entries from `extended_buildin_mcp/mcp.json` into
//   ~/.hamuna/config.json::mcpServers.
//
//   Per-id merge contract:
//     - id not present in user config  →  ADD entry (bundled verbatim)
//     - id present in user config       →  UPGRADE: bundled wins for the
//       product surface (`command`, `args`, `url`, `headers`, `type`,
//       `name`, `description`, `isBuiltin`, `isFree`, `requiresConfig`,
//       `websiteUrl`, `configHint`, `platforms`, `hidesDefaultArgs`),
//       user wins for `env` (so an end user's `AGNES_API_KEYS` override
//       survives an upgrade that ships a fresh demo key) and `enabled`
//       (so a user who disabled a bundled entry stays disabled — flipping
//       back is an explicit Settings UI action).
//     - id present in user config but NOT in bundled  →  KEEP user entry
//       (user-added custom MCP; do NOT silently delete).
//
//   The previous behaviour (only `ADD` when id is missing — never touch
//   existing entries) was wrong: shipping a new command line, a new URL,
//   or a new arg pin in `mcp.json` had zero effect on already-installed
//   users. They kept running the old product surface until they
//   manually edited ~/.hamuna/config.json or wiped the file. That is
//   exactly the "升级后新 extended_buildin_mcp 没有覆盖安装" failure mode.
//
// Failure semantics: best-effort. A poisoned bundle config must NOT
// prevent the Sidecar from starting — regular user MCPs are still
// honoured.

import { atomicModifyConfig, loadConfig } from './utils/admin-config';
import { loadExtendedBuiltinMcpServers } from './utils/extended-builtin-mcp';
import type { McpServerDefinition } from '../shared/config-types';

/**
 * Fields that the seed MUST NOT overwrite when an existing bundled entry
 * is upgraded. Everything else on `McpServerDefinition` is treated as
 * bundled-owned (product surface) and gets refreshed on each upgrade.
 *
 * Exported (not internal) because the test suite imports it to assert
 * the merge shape.
 */
export const BUNDLED_SEED_USER_FIELDS = ['env', 'enabled'] as const;

/** Product-side merge: bundled is authoritative except for user fields. */
function mergeBundledEntry(
  bundled: McpServerDefinition,
  existing: McpServerDefinition | undefined,
): McpServerDefinition {
  if (!existing) return bundled;
  const userOverrides: Record<string, unknown> = {};
  for (const f of BUNDLED_SEED_USER_FIELDS) {
    const v = (existing as unknown as Record<string, unknown>)[f];
    if (v !== undefined) userOverrides[f] = v;
  }
  return { ...bundled, ...userOverrides };
}

/** True iff any product field on `a` differs from `b` (user fields ignored). */
function productFieldsDiffer(a: McpServerDefinition, b: McpServerDefinition): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of allKeys) {
    if ((BUNDLED_SEED_USER_FIELDS as readonly string[]).includes(k)) continue;
    const av = (a as unknown as Record<string, unknown>)[k];
    const bv = (b as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) return true;
  }
  return false;
}

interface MergeCounts {
  added: string[];
  upgraded: string[];
}

function diffMerge(bundled: McpServerDefinition[], existing: McpServerDefinition[]): {
  next: McpServerDefinition[];
  counts: MergeCounts;
} {
  const next = existing.map((e) => {
    const b = bundled.find((x) => x.id === e.id);
    return b ? mergeBundledEntry(b, e) : e;
  });
  const existingIds = new Set(existing.map((s) => s.id));
  const added = bundled.filter((s) => !existingIds.has(s.id));
  const upgraded: string[] = [];
  for (const e of existing) {
    const b = bundled.find((x) => x.id === e.id);
    if (b && productFieldsDiffer(b, e)) upgraded.push(e.id);
  }
  return { next: [...next, ...added], counts: { added: added.map((s) => s.id), upgraded } };
}

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

  const preview = diffMerge(bundled, existing);
  if (preview.counts.added.length === 0 && preview.counts.upgraded.length === 0) {
    console.log(
      `[mcp-seed] all ${bundled.length} bundled extended MCP(s) already present and up-to-date — no merge needed`,
    );
    return;
  }

  // Re-run diffMerge inside the lock — loadConfig() above may race with
  // a concurrent writer (e.g. an HTTP handler that also calls
  // atomicModifyConfig), so the in-lock re-check ensures we don't
  // double-merge or write a stale `next` over a fresher on-disk config.
  atomicModifyConfig((c) => {
    const cur = Array.isArray(c.mcpServers) ? c.mcpServers : [];
    const curPreview = diffMerge(bundled, cur);
    if (curPreview.counts.added.length === 0 && curPreview.counts.upgraded.length === 0) {
      return c;
    }
    const tag: string[] = [];
    if (curPreview.counts.added.length > 0) tag.push(`+${curPreview.counts.added.length} new`);
    if (curPreview.counts.upgraded.length > 0) tag.push(`${curPreview.counts.upgraded.length} upgraded`);
    const touchedIds = [...curPreview.counts.added, ...curPreview.counts.upgraded];
    console.log(
      `[mcp-seed] merging bundled extended MCPs into ~/.hamuna/config.json::mcpServers (${tag.join(', ')}): ${touchedIds.join(', ')}`,
    );
    return { ...c, mcpServers: curPreview.next };
  }).catch((err) => {
    // atomicModifyConfig throws ConfigBusyError / FileBusyError on
    // contention. Swallow — the next startup will retry, and the
    // user can still enable these via Settings.
    console.warn('[mcp-seed] auto-merge failed (will retry next startup):', err);
  });

  // Reference preview so TS doesn't complain about unused locals on
  // builds that enable noUnusedLocals (the pre-lock preview is what
  // gates the fast-path `return` above — without it we'd take the
  // lock every startup, which is wasteful).
  void preview;
}
