// kb-store.ts — single-instance TypeGraph store for the knowledge base (资料库).
//
// The Rust KbEngine (JSON files + Tantivy) is replaced by an embedded TypeGraph
// graph over SQLite (WAL + busy_timeout, so multiple sidecar processes can
// write concurrently). Doc.text holds jieba pre-tokenized, space-joined tokens
// (searchable); Doc.textOriginal holds raw text for display/snippets. The store
// is created lazily on first access (kb modules are lazy-imported by design) and
// the path is injectable for tests.

import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { createLocalSqliteStore } from '@nicia-ai/typegraph/sqlite/local';
import type { NodeId, Store } from '@nicia-ai/typegraph';
import { asNodeId } from '@nicia-ai/typegraph';

import { kbGraph, KbNode } from './kb-schema';
import { tokenizeForIndex, tokenizeText } from './kb-tokenize';
import {
  chunkText,
  entityId,
  mergeEntities,
  mergeRelations,
  type KbEntity,
  type KbGraphData,
  type KbRelation,
} from './kb-merge';

// ── Public result types (mirror the Rust serde shapes exactly) ─────────────

export interface KbInfo {
  id: string;
  name: string;
  createdAtMs: number;
}

export interface KbGraphSummary {
  entityCount: number;
  relationCount: number;
  typedRelationCount: number;
}

export interface KbEntityView {
  id: string;
  label: string;
  entityType?: string;
  sources: string[];
}

export interface KbRelationView {
  subject: string;
  object: string;
  relationType: string;
  weight: number;
  typed: boolean;
}

export interface KbGraph {
  entities: KbEntityView[];
  relations: KbRelationView[];
  /** LLM extraction tasks still queued — >0 means the graph is still growing. */
  pendingCount: number;
}

export interface KbDocMeta {
  id: string;
  title: string;
  addedAtMs: number;
  textLength: number;
}

export interface KbQueryEntity {
  id: string;
  label: string;
  score: number;
}

export interface KbQueryResult {
  entities: KbQueryEntity[];
  relations: KbRelationView[];
  snippets: string[];
}

export interface PendingRelationTask {
  kbId: string;
  chunkId: string;
  text: string;
  pairs: [string, string][];
}

// ── Constants (ported from Rust) ───────────────────────────────────────────

const CHUNK_CHARS = 4_000;
const MAX_HOP_RELATIONS = 200;
const DEFAULT_QUERY_LIMIT = 20;

// ── Store instance ─────────────────────────────────────────────────────────

let storePromise: Promise<Store<typeof kbGraph>> | null = null;
let dbPath: string | undefined;

export function getDbPath(): string {
  return dbPath ?? join(homedir(), '.hamuna', 'kb', 'kb.sqlite');
}

/** Override the sqlite path (tests inject a temp dir). Resets the singleton. */
export function setKbStorePath(path: string): void {
  dbPath = path;
  storePromise = null;
}

/** Lazily create (and provision) the SQLite-backed store. */
export function getKbStore(): Promise<Store<typeof kbGraph>> {
  if (!storePromise) {
    storePromise = (async () => {
      // better-sqlite3 won't create the parent directory on its own — fresh
      // installs (no ~/.hamuna/kb/ yet) would otherwise fail every poll with
      // "Cannot open database because the directory does not exist". recursive:
      // true is idempotent (no throw if the dir already exists), so this is
      // safe on warm paths too — we deliberately do NOT existsSync-then-mkdir
      // (that pattern mishandles broken symlinks, see pit_of_success §fs-utils).
      mkdirSync(dirname(getDbPath()), { recursive: true });
      const store = await createLocalSqliteStore(kbGraph, {
        path: getDbPath(),
        pragmas: { journalMode: 'wal', busyTimeoutMs: 5000 },
      });
      // First-boot one-shot migration from the legacy Rust JSON layout.
      // Idempotent — no-ops on fresh installs and after the archive rename.
      const { runKbMigrationIfNeeded } = await import('./kb-migrate');
      await runKbMigrationIfNeeded(store);
      return store;
    })();
  }
  return storePromise;
}

/** Reset the singleton (tests that inject a temp path call this). */
export async function resetKbStore(): Promise<void> {
  if (storePromise) {
    const store = await storePromise;
    await store.close();
    storePromise = null;
  }
}

type KbStore = Store<typeof kbGraph>;
type KbNodeId = NodeId<typeof KbNode>;

function kbNodeId(id: string): KbNodeId {
  return asNodeId<typeof KbNode>(id);
}

async function listKbRows(store: KbStore) {
  const nodes = await store.nodes.Kb.find();
  return nodes.map((n) => ({ id: n.id, name: n.name, createdAtMs: n.createdAtMs, workspaceIds: n.workspaceIds }));
}

// ── Kb CRUD ────────────────────────────────────────────────────────────────

export async function listKbs(): Promise<KbInfo[]> {
  const store = await getKbStore();
  const rows = await listKbRows(store);
  return rows
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map(({ id, name, createdAtMs }) => ({ id, name, createdAtMs }));
}

export async function createKb(name: string): Promise<KbInfo> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('KB name must not be empty');
  const store = await getKbStore();
  // Case-insensitive duplicate check (the unique constraint is caseInsensitive
  // too, so this keeps the user-facing message consistent with Rust).
  const dup = await store.nodes.Kb.find({ where: (k) => k.name.ilike(trimmed), limit: 1 });
  if (dup.length > 0) throw new Error(`知识库名称已存在: ${trimmed}`);
  const now = Date.now();
  const id = `kb_${crypto.randomUUID().replace(/-/g, '')}`;
  const node = await store.nodes.Kb.create({ name: trimmed, createdAtMs: now, workspaceIds: [] }, { id });
  return { id: node.id, name: node.name, createdAtMs: node.createdAtMs };
}

export async function renameKb(kbId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('KB name must not be empty');
  const store = await getKbStore();
  const id = kbNodeId(kbId);
  const kb = await store.nodes.Kb.getById(id);
  if (!kb) throw new Error(`知识库不存在: ${kbId}`);
  await store.nodes.Kb.update(id, { name: trimmed });
}

export async function deleteKb(kbId: string): Promise<void> {
  const store = await getKbStore();
  const id = kbNodeId(kbId);
  const kb = await store.nodes.Kb.getById(id);
  if (!kb) throw new Error(`知识库不存在: ${kbId}`);
  await store.nodes.Kb.delete(id);
  // Cascade-delete the KB's graph data.
  const entities = await store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) });
  await store.nodes.Entity.bulkDelete(entities.map((e) => e.id));
  const docs = await store.nodes.Doc.find({ where: (d) => d.kbId.eq(kbId) });
  await store.nodes.Doc.bulkDelete(docs.map((d) => d.id));
  const tasks = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId) });
  await store.nodes.PendingTask.bulkDelete(tasks.map((t) => t.id));
  const relations = await store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) });
  await store.nodes.Relation.bulkDelete(relations.map((r) => r.id));
}

// ── Mounts ─────────────────────────────────────────────────────────────────

/** workspace path -> mounted kb ids. */
export async function listMounts(): Promise<Record<string, string[]>> {
  const store = await getKbStore();
  const rows = await listKbRows(store);
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    for (const ws of row.workspaceIds) {
      (out[ws] ??= []).push(row.id);
    }
  }
  return out;
}

export async function setMounts(workspace: string, kbIds: string[]): Promise<void> {
  const store = await getKbStore();
  const ids = [...new Set(kbIds)].sort();
  const rows = await listKbRows(store);
  await store.transaction(async (tx) => {
    for (const row of rows) {
      const next = ids.includes(row.id)
        ? [...new Set([...(row.workspaceIds ?? []), workspace])].sort()
        : (row.workspaceIds ?? []).filter((w) => w !== workspace);
      await tx.nodes.Kb.update(kbNodeId(row.id), { workspaceIds: next });
    }
  });
}

export async function mountsForWorkspace(workspace: string): Promise<string[]> {
  const store = await getKbStore();
  const rows = await listKbRows(store);
  // Stable, deterministic order: callers (kb-tool) and tests rely on it.
  return rows
    .filter((r) => (r.workspaceIds ?? []).includes(workspace))
    .map((r) => r.id)
    .sort();
}

// ── Ingestion ──────────────────────────────────────────────────────────────

export async function addText(kbId: string, title: string, text: string): Promise<KbGraphSummary> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('入库内容不能为空');
  const store = await getKbStore();
  const chunks = chunkText(trimmed, CHUNK_CHARS);
  const docId = crypto.randomUUID().replace(/-/g, '');
  const addedAtMs = Date.now();
  await store.nodes.Doc.create(
    { kbId, title, addedAtMs, text: tokenizeForIndex(trimmed), textOriginal: trimmed },
    { id: docId },
  );
  const tasks = chunks.map((c, i) => ({ kbId, chunkId: `${docId}-${i}`, text: c }));
  await store.nodes.PendingTask.bulkInsert(tasks.map((t) => ({ props: t })));
  return graphSummaryInternal(store, kbId);
}

export async function listDocs(kbId: string): Promise<KbDocMeta[]> {
  const store = await getKbStore();
  const docs = await store.nodes.Doc.find({ where: (d) => d.kbId.eq(kbId) });
  return docs
    .map((d) => ({ id: d.id, title: d.title, addedAtMs: d.addedAtMs, textLength: d.textOriginal.length }))
    .sort((a, b) => b.addedAtMs - a.addedAtMs);
}

/** Rebuild a KB's graph + pending queue from its stored raw documents. */
export async function rebuild(kbId: string): Promise<KbGraphSummary> {
  const store = await getKbStore();
  const docs = await store.nodes.Doc.find({ where: (d) => d.kbId.eq(kbId) });
  // Clear graph + pending, then re-ingest every doc.
  const entities = await store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) });
  await store.nodes.Entity.bulkDelete(entities.map((e) => e.id));
  const relations = await store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) });
  await store.nodes.Relation.bulkDelete(relations.map((r) => r.id));
  const tasks = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId) });
  await store.nodes.PendingTask.bulkDelete(tasks.map((t) => t.id));
  const newTasks: { kbId: string; chunkId: string; text: string }[] = [];
  for (const doc of docs) {
    chunkText(doc.textOriginal, CHUNK_CHARS).forEach((c, i) => {
      newTasks.push({ kbId, chunkId: `${doc.id}-${i}`, text: c });
    });
  }
  await store.nodes.PendingTask.bulkInsert(newTasks.map((t) => ({ props: t })));
  return graphSummaryInternal(store, kbId);
}

// ── Pending queue ──────────────────────────────────────────────────────────

export async function peekPending(kbId: string, limit: number): Promise<PendingRelationTask[]> {
  const store = await getKbStore();
  const tasks = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId), limit });
  return tasks.map((t) => ({ kbId: t.kbId, chunkId: t.chunkId, text: t.text, pairs: [] }));
}

/** Peek pending tasks across all KBs (for the poller). */
export async function takePendingAll(limit: number): Promise<PendingRelationTask[]> {
  const store = await getKbStore();
  const tasks = await store.nodes.PendingTask.find({ limit });
  return tasks.slice(0, limit).map((t) => ({ kbId: t.kbId, chunkId: t.chunkId, text: t.text, pairs: [] }));
}

export async function removePending(kbId: string, chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  const store = await getKbStore();
  const tasks = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId) });
  const toDelete = tasks.filter((t) => chunkIds.includes(t.chunkId)).map((t) => t.id);
  if (toDelete.length > 0) await store.nodes.PendingTask.bulkDelete(toDelete);
}

// ── Relations ──────────────────────────────────────────────────────────────

export async function saveRelations(kbId: string, entities: KbEntity[], relations: KbRelation[]): Promise<void> {
  const store = await getKbStore();
  // Load the current graph for this kb (id == label semantics).
  const existingEntities = await store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) });
  const existingRelations = await store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) });
  const graph: KbGraphData = {
    entities: existingEntities.map((e) => ({ id: e.id, label: e.label, entityType: e.entityType, sources: e.sources })),
    relations: existingRelations.map((r) => ({ subject: r.subject, object: r.object, relationType: r.relationType, weight: r.weight, typed: r.typed })),
  };
  mergeEntities(graph, entities);
  mergeRelations(graph, relations);
  await store.transaction(async (tx) => {
    const entityRows = graph.entities.map((e) => ({
      id: entityId(e.label),
      props: { kbId, label: e.label, entityType: e.entityType, sources: e.sources },
    }));
    await tx.nodes.Entity.bulkUpsertById(entityRows);
    // Relation id is derived ONLY from (kbId, subject, object) so a typed
    // upgrade reuses the existing row (mergeRelations already merged in
    // memory; stable ids let bulkUpsertById overwrite in place). Including
    // relationType or an index in the id would leave the old cooccur row
    // behind when a typed relation later upgrades the same pair.
    const relRows = graph.relations.map((r) => ({
      id: `rel_${kbId}_${entityId(r.subject)}_${entityId(r.object)}`,
      props: { kbId, subject: r.subject, object: r.object, relationType: r.relationType, weight: r.weight, typed: r.typed },
    }));
    await tx.nodes.Relation.bulkUpsertById(relRows);
  });
}

// ── Graph data + summary ───────────────────────────────────────────────────

export async function graphData(kbId: string): Promise<KbGraph> {
  const store = await getKbStore();
  const [entities, relations, pendingCount] = await Promise.all([
    store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) }),
    store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) }),
    countPending(store, kbId),
  ]);
  return {
    entities: entities.map((e) => ({ id: e.id, label: e.label, entityType: e.entityType, sources: e.sources })),
    relations: relations.map((r) => ({ subject: r.subject, object: r.object, relationType: r.relationType, weight: r.weight, typed: r.typed })),
    pendingCount,
  };
}

async function countPending(store: KbStore, kbId: string): Promise<number> {
  const tasks = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId) });
  return tasks.length;
}

async function graphSummaryInternal(store: KbStore, kbId: string): Promise<KbGraphSummary> {
  const [entities, relations] = await Promise.all([
    store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) }),
    store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) }),
  ]);
  return {
    entityCount: entities.length,
    relationCount: relations.length,
    typedRelationCount: relations.filter((r) => r.typed).length,
  };
}

/** Public summary (entity/relation counts) for a KB — used by the UI summary panel. */
export async function graphSummary(kbId: string): Promise<KbGraphSummary> {
  const store = await getKbStore();
  return graphSummaryInternal(store, kbId);
}

// ── Query (mirror Rust KbEngine::query) ────────────────────────────────────

/**
 * Search across the mounted KBs. Mirrors the Rust algorithm:
 * 1. Per-kb fulltext search on Doc.text (jieba-tokenized query), take top hits
 *    as entities (title pseudo-entities `doc:<title>`), snippets from raw text.
 * 2. Seed the matched-ids set with the search entities AND graph entities whose
 *    label contains a query token.
 * 3. 1-hop neighborhood: relations whose subject/object is in the matched set,
 *    capped at MAX_HOP_RELATIONS.
 */
export async function query(kbIds: string[], queryStr: string, limit?: number): Promise<KbQueryResult> {
  const trimmed = queryStr.trim();
  if (!trimmed) return { entities: [], relations: [], snippets: [] };
  const max = Math.max(1, limit ?? DEFAULT_QUERY_LIMIT);
  const store = await getKbStore();
  const tokenized = tokenizeForIndex(trimmed);
  const tokens = tokenizeText(trimmed);

  // 1. Fulltext search per kb.
  const allEntities: { id: string; label: string; score: number }[] = [];
  const snippets: string[] = [];
  for (const kbId of kbIds) {
    let hits;
    try {
      hits = await store.search.fulltext('Doc', {
        query: tokenized,
        limit: max,
        where: (d) => d.kbId.eq(kbId),
        includeSnippets: true,
      });
    } catch {
      continue;
    }
    for (const hit of hits) {
      const title = hit.node.title;
      if (title) allEntities.push({ id: `doc:${title}`, label: title, score: hit.score });
      // The FTS5 snippet() runs over the tokenized `text` field — for Chinese
      // that's a jieba token stream, not readable prose. Slice the raw doc
      // text instead (mirrors Rust `trim_snippet`: first 240 chars + …).
      const raw = hit.node.textOriginal;
      const bounded = [...raw].slice(0, 240).join('');
      snippets.push(bounded.length < raw.length ? `${bounded}…` : bounded);
    }
  }

  // Dedup entities by id, keep max score; sort score desc.
  const seen = new Map<string, { id: string; label: string; score: number }>();
  for (const e of allEntities) {
    const prev = seen.get(e.id);
    if (!prev || e.score > prev.score) seen.set(e.id, e);
  }
  const entities = [...seen.values()].sort((a, b) => b.score - a.score);

  // 2. Seed matched ids: search entities + graph entities whose label contains
  //    a query token.
  const matchedIds = new Set(entities.map((e) => e.id));
  if (tokens.length > 0) {
    for (const kbId of kbIds) {
      const graphEnts = await store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) });
      for (const e of graphEnts) {
        if (tokens.some((t) => e.label.toLowerCase().includes(t))) matchedIds.add(e.id);
      }
    }
  }

  // 3. 1-hop relations across the mounted KBs, capped.
  const relations: KbRelationView[] = [];
  for (const kbId of kbIds) {
    if (relations.length >= MAX_HOP_RELATIONS) break;
    const rels = await store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) });
    for (const r of rels) {
      if (matchedIds.has(r.subject) || matchedIds.has(r.object)) {
        relations.push({ subject: r.subject, object: r.object, relationType: r.relationType, weight: r.weight, typed: r.typed });
        if (relations.length >= MAX_HOP_RELATIONS) break;
      }
    }
  }

  return { entities, relations, snippets };
}
