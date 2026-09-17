// kbClient.ts — Knowledge base (资料库) API abstraction.
//
// The KB backend moved from Rust (KbEngine over management API) to a Node
// sidecar TypeGraph store. The renderer still talks to it through this
// single seam, but now over HTTP via the sidecar's `/api/admin/kb/*` routes
// (instead of Tauri `cmd_kb_*` IPC). Response shapes are unchanged — types
// below are the ones the UI already depends on.

import { apiGetJson, apiPostJson } from '@/api/apiFetch';

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

export interface KbEntity {
  id: string;
  label: string;
  entityType?: string;
  sources: string[];
}

export interface KbRelation {
  subject: string;
  object: string;
  relationType: string;
  weight: number;
  typed: boolean;
}

export interface KbGraph {
  entities: KbEntity[];
  relations: KbRelation[];
  /** LLM extraction tasks still queued — >0 means the graph is still growing. */
  pendingCount?: number;
}

export type KbIngestKind = 'url' | 'pdf' | 'docx' | 'xlsx' | 'text';

/** Raw uploaded document metadata (no full text). */
export interface KbDocMeta {
  id: string;
  title: string;
  addedAtMs: number;
  textLength: number;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
// The sidecar's KB dispatcher returns `{ ok, ... }` and maps `ok:false` to
// HTTP 400, so `apiFetch` throws on logical failure — these wrappers stay
// as plain fetch+cast with no per-call error handling.

export async function listKbs(): Promise<KbInfo[]> {
  const r = await apiGetJson<{ ok: true; kbs: KbInfo[] }>('/api/admin/kb/list');
  return r.kbs;
}

export async function createKb(name: string): Promise<KbInfo> {
  const r = await apiPostJson<{ ok: true; kb: KbInfo }>('/api/admin/kb/create', { name });
  return r.kb;
}

export async function renameKb(kbId: string, name: string): Promise<void> {
  await apiPostJson<{ ok: true }>('/api/admin/kb/rename', { kbId, name });
}

export async function deleteKb(kbId: string): Promise<void> {
  await apiPostJson<{ ok: true }>('/api/admin/kb/delete', { kbId });
}

export async function addKbText(kbId: string, title: string, text: string): Promise<KbGraphSummary> {
  const r = await apiPostJson<{ ok: true; summary: KbGraphSummary }>('/api/admin/kb/add-text', { kbId, title, text });
  return r.summary;
}

export async function getKbGraph(kbId: string): Promise<KbGraphSummary> {
  const r = await apiGetJson<KbGraphSummary & { ok: true }>(`/api/admin/kb/graph-summary?kbId=${encodeURIComponent(kbId)}`);
  return r;
}

export async function getKbGraphData(kbId: string): Promise<KbGraph> {
  const r = await apiGetJson<KbGraph & { ok: true }>(`/api/admin/kb/graph-data?kbId=${encodeURIComponent(kbId)}`);
  return r;
}

export async function listKbMounts(): Promise<Record<string, string[]>> {
  const r = await apiGetJson<{ ok: true; mounts: Record<string, string[]> }>('/api/admin/kb/mounts');
  return r.mounts;
}

export async function setKbMounts(workspace: string, kbIds: string[]): Promise<void> {
  await apiPostJson<{ ok: true }>('/api/admin/kb/mounts', { workspace, kbIds });
}

export async function listKbDocs(kbId: string): Promise<KbDocMeta[]> {
  const r = await apiGetJson<{ ok: true; docs: KbDocMeta[] }>(`/api/admin/kb/docs?kbId=${encodeURIComponent(kbId)}`);
  return r.docs;
}

export async function rebuildKb(kbId: string): Promise<KbGraphSummary> {
  const r = await apiPostJson<{ ok: true; summary: KbGraphSummary }>('/api/admin/kb/rebuild', { kbId });
  return r.summary;
}

/**
 * Ingest richer material (web URL / PDF / Word / Excel) into a KB. Parsing
 * happens on the sidecar; the response keeps its `{ ok, summary?, error? }`
 * shape so the UI can render the partial-error path directly (no throw).
 */
export async function ingestKbMaterial(
  kbId: string,
  title: string,
  kind: KbIngestKind,
  data: string,
): Promise<{ ok: boolean; summary?: KbGraphSummary; error?: string }> {
  return apiPostJson('/api/admin/kb/ingest', { kbId, title, kind, data });
}