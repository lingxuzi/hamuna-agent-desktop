// kbClient.ts — Knowledge base (资料库) API abstraction.
//
// Knowledge bases live in the Rust `KbEngine` and are reached directly via
// Tauri IPC (`cmd_kb_*`), exactly like `searchClient.ts` reaches SearchEngine.
// There is no Node Sidecar path for KB management.

import { invoke } from '@tauri-apps/api/core';

import { apiPostJson } from '@/api/apiFetch';

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

export async function listKbs(): Promise<KbInfo[]> {
  return invoke<KbInfo[]>('cmd_kb_list');
}

export async function createKb(name: string): Promise<KbInfo> {
  return invoke<KbInfo>('cmd_kb_create', { name });
}

export async function renameKb(kbId: string, name: string): Promise<void> {
  return invoke('cmd_kb_rename', { kbId, name });
}

export async function deleteKb(kbId: string): Promise<void> {
  return invoke('cmd_kb_delete', { kbId });
}

export async function addKbText(kbId: string, title: string, text: string): Promise<KbGraphSummary> {
  return invoke<KbGraphSummary>('cmd_kb_add_text', { kbId, title, text });
}

export async function getKbGraph(kbId: string): Promise<KbGraphSummary> {
  return invoke<KbGraphSummary>('cmd_kb_graph', { kbId });
}

/** Full knowledge graph (entities + relations) for the visualization panel. */
export async function getKbGraphData(kbId: string): Promise<KbGraph> {
  return invoke<KbGraph>('cmd_kb_graph_data', { kbId });
}

/** workspace path -> mounted kb ids */
export async function listKbMounts(): Promise<Record<string, string[]>> {
  return invoke<Record<string, string[]>>('cmd_kb_mount_list');
}

export async function setKbMounts(workspace: string, kbIds: string[]): Promise<void> {
  return invoke('cmd_kb_mount_set', { workspace, kbIds });
}

export type KbIngestKind = 'url' | 'pdf' | 'docx' | 'xlsx' | 'text';

/** Raw uploaded document metadata (no full text). */
export interface KbDocMeta {
  id: string;
  title: string;
  addedAtMs: number;
  textLength: number;
}

/** List the raw documents stored in a KB (newest first). */
export async function listKbDocs(kbId: string): Promise<KbDocMeta[]> {
  return invoke<KbDocMeta[]>('cmd_kb_list_docs', { kbId });
}

/** Rebuild a KB's graph + index from its stored raw documents. */
export async function rebuildKb(kbId: string): Promise<KbGraphSummary> {
  return invoke<KbGraphSummary>('cmd_kb_rebuild', { kbId });
}

/**
 * Ingest richer material (web URL / PDF / Word / Excel) into a KB. The sidecar
 * parses it to text and writes back to Rust via the management API.
 * Returns { ok, summary?, error? }.
 */
export async function ingestKbMaterial(
  kbId: string,
  title: string,
  kind: KbIngestKind,
  data: string,
): Promise<{ ok: boolean; summary?: KbGraphSummary; error?: string }> {
  return apiPostJson('/api/admin/kb/ingest', { kbId, title, kind, data });
}
