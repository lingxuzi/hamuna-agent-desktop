// kb-migrate.ts — one-shot JSON → SQLite migration.
//
// The Rust KbEngine persisted state as JSON files under `~/.hamuna/kb/`:
//   - index.json        → Vec<KbInfo>            (kb_id, name, createdAtMs)
//   - mounts.json       → Record<ws, kbIds[]>    (workspace → mounted kb ids)
//   - {kb_id}/graph.json → entities + relations
//   - {kb_id}/docs.json  → Vec<KbDoc>            (id, title, text, addedAtMs)
//   - {kb_id}/pending.json → pending LLM tasks   (rebuilt from docs below —
//                                                 the file is read for safety
//                                                 but not authoritative after
//                                                 reconstruction)
//   - {kb_id}/index/     → Tantivy fulltext      (dropped — SQLite FTS5 replaces)
//
// The KB now lives in this sidecar's TypeGraph/SQLite store. This migration
// reads the legacy layout ONCE on first KB access, writes into the store, and
// archives the JSON dir to `~/.hamuna/kb-legacy-<ts>/` for rollback. A
// `.migrated-v1` sentinel inside the source dir prevents re-running; after the
// rename, the dir no longer exists and the sentinel check trivially passes.
//
// kb_id is preserved verbatim so mounts.json stays valid — opaque to the
// frontend, but children (Entity/Doc/Relation/PendingTask) reference it via
// their `kbId` property.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { Store } from '@nicia-ai/typegraph';

import { kbGraph } from './kb-schema';
import { chunkText, entityId } from './kb-merge';
import { tokenizeForIndex } from './kb-tokenize';

// ── Legacy JSON shapes (mirror Rust serde camelCase) ────────────────────────

interface RustKbInfo {
  id: string;
  name: string;
  createdAtMs: number;
}

interface RustKbEntity {
  id: string;
  label: string;
  entityType?: string;
  sources?: string[];
}

interface RustKbRelation {
  subject: string;
  object: string;
  relationType: string;
  weight: number;
  typed: boolean;
}

interface RustKbGraph {
  entities: RustKbEntity[];
  relations: RustKbRelation[];
  pendingCount?: number;
}

interface RustKbDoc {
  id: string;
  title: string;
  text: string;
  addedAtMs: number;
}

// ── Migration ──────────────────────────────────────────────────────────────

const KB_DIR_NAME = 'kb';
const SENTINEL_FILENAME = '.migrated-v1';
const CHUNK_CHARS = 4_000;

function legacyDir(): string {
  return join(homedir(), '.hamuna', KB_DIR_NAME);
}

function archiveDir(ts: number): string {
  return join(homedir(), '.hamuna', `kb-legacy-${ts}`);
}

function writeSentinel(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SENTINEL_FILENAME), new Date().toISOString());
  } catch {
    // best-effort
  }
}

/**
 * Run the JSON→SQLite migration once. Idempotent — returns silently on:
 *   - no legacy dir (fresh install)
 *   - sentinel present (already migrated)
 *   - SQLite store already has data (user has been running the new build)
 */
export async function runKbMigrationIfNeeded(store: Store<typeof kbGraph>): Promise<void> {
  const dir = legacyDir();
  if (!existsSync(dir)) return;
  if (existsSync(join(dir, SENTINEL_FILENAME))) return;

  // If SQLite already has any Kb rows, the user has been running the new
  // build and the legacy JSON must not overwrite it. Write the sentinel so
  // future boots skip cleanly.
  const existing = await store.nodes.Kb.find({ limit: 1 });
  if (existing.length > 0) {
    console.warn('[kb-migrate] SQLite already populated; skipping legacy migration');
    writeSentinel(dir);
    return;
  }

  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) {
    // Legacy dir with no index.json → nothing to migrate.
    writeSentinel(dir);
    return;
  }

  console.warn('[kb-migrate] migrating legacy Rust KB JSON store → SQLite…');

  let kbs: RustKbInfo[] = [];
  try {
    kbs = JSON.parse(readFileSync(indexPath, 'utf8')) as RustKbInfo[];
  } catch (err) {
    console.warn(`[kb-migrate] failed to parse ${indexPath}:`, err);
    writeSentinel(dir);
    return;
  }

  // ── Mounts: invert workspace → kbIds[] to kbId → workspaces[]
  let mounts: Record<string, string[]> = {};
  const mountsPath = join(dir, 'mounts.json');
  if (existsSync(mountsPath)) {
    try {
      mounts = JSON.parse(readFileSync(mountsPath, 'utf8')) as Record<string, string[]>;
    } catch (err) {
      console.warn(`[kb-migrate] failed to parse ${mountsPath}:`, err);
    }
  }
  const kbToWorkspaces: Record<string, string[]> = {};
  for (const [ws, kbIds] of Object.entries(mounts)) {
    for (const kbId of kbIds ?? []) {
      (kbToWorkspaces[kbId] ??= []).push(ws);
    }
  }

  // ── 1) Create Kb nodes (preserve ids) + workspaceIds
  await store.transaction(async (tx) => {
    for (const kb of kbs) {
      const wsSorted = [...new Set(kbToWorkspaces[kb.id] ?? [])].sort();
      try {
        await tx.nodes.Kb.create(
          { name: kb.name, createdAtMs: kb.createdAtMs, workspaceIds: wsSorted },
          { id: kb.id },
        );
      } catch (err) {
        // Re-run mid-migration: skip the existing row, carry on.
        console.warn(`[kb-migrate] KB ${kb.id} insert skipped:`, err instanceof Error ? err.message : err);
      }
    }
  });

  // ── 2) Per-kb: graph + docs + (rebuilt) pending queue
  for (const kb of kbs) {
    const kbDir = join(dir, kb.id);

    // 2a) Graph
    const graphPath = join(kbDir, 'graph.json');
    if (existsSync(graphPath)) {
      try {
        const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as RustKbGraph;
        const entities = (graph.entities ?? []).map((e) => ({
          id: entityId(e.label),
          label: e.label,
          ...(e.entityType !== undefined ? { entityType: e.entityType } : {}),
          sources: e.sources ?? [],
        }));
        const relations = (graph.relations ?? []).map((r) => ({
          subject: r.subject,
          object: r.object,
          relationType: r.relationType,
          weight: r.weight,
          typed: r.typed,
        }));
        await store.transaction(async (tx) => {
          const entityRows = entities.map((e) => ({
            id: e.id,
            props: {
              kbId: kb.id,
              label: e.label,
              ...(e.entityType !== undefined ? { entityType: e.entityType } : {}),
              sources: e.sources,
            },
          }));
          await tx.nodes.Entity.bulkUpsertById(entityRows);
          const relRows = relations.map((r) => ({
            id: `rel_${kb.id}_${entityId(r.subject)}_${entityId(r.object)}`,
            props: {
              kbId: kb.id,
              subject: r.subject,
              object: r.object,
              relationType: r.relationType,
              weight: r.weight,
              typed: r.typed,
            },
          }));
          await tx.nodes.Relation.bulkUpsertById(relRows);
        });
      } catch (err) {
        console.warn(`[kb-migrate] graph ${kb.id} failed:`, err instanceof Error ? err.message : err);
      }
    }

    // 2b) Docs → Doc node + chunked pending tasks
    const docsPath = join(kbDir, 'docs.json');
    if (existsSync(docsPath)) {
      try {
        const docs = JSON.parse(readFileSync(docsPath, 'utf8')) as RustKbDoc[];
        for (const doc of docs) {
          const trimmed = (doc.text ?? '').trim();
          if (!trimmed) continue;
          const chunks = chunkText(trimmed, CHUNK_CHARS);
          try {
            await store.nodes.Doc.create(
              { kbId: kb.id, title: doc.title, addedAtMs: doc.addedAtMs, text: tokenizeForIndex(trimmed), textOriginal: trimmed },
              { id: doc.id },
            );
          } catch (err) {
            // Doc id already exists (idempotent re-run): skip — its pending
            // tasks should already be queued from the first migration pass.
            console.warn(`[kb-migrate] Doc ${doc.id} insert skipped:`, err instanceof Error ? err.message : err);
            continue;
          }
          const tasks = chunks.map((c, i) => ({ kbId: kb.id, chunkId: `${doc.id}-${i}`, text: c }));
          if (tasks.length > 0) {
            await store.nodes.PendingTask.bulkInsert(tasks.map((t) => ({ props: t })));
          }
        }
      } catch (err) {
        console.warn(`[kb-migrate] docs ${kb.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // ── 3) Archive legacy dir → kb-legacy-<ts>/
  const ts = Date.now();
  try {
    renameSync(dir, archiveDir(ts));
    console.warn(`[kb-migrate] archived legacy KB store to ${archiveDir(ts)}`);
  } catch (err) {
    // Rename failed (e.g. cross-device, perms): leave the dir in place, write
    // the sentinel so we don't try again next boot.
    console.warn(`[kb-migrate] could not archive legacy dir:`, err instanceof Error ? err.message : err);
    writeSentinel(dir);
  }
}