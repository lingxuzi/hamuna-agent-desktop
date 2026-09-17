// kb-merge.ts — pure merge/chunk logic for the knowledge base graph.
//
// Direct TS ports of the Rust KbEngine helpers (src-tauri/src/kb/mod.rs):
// chunk_text, entity_id, merge_entities, merge_relations. Kept pure so they
// are unit-testable without a store. Graph semantics must stay byte-for-byte
// compatible with the Rust originals — the frontend renders these.

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

export interface KbGraphData {
  entities: KbEntity[];
  relations: KbRelation[];
}

/** Global entity id — the normalized label itself (Rust `entity_id`). */
export function entityId(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Split text into meaning-preserving chunks of at most `maxChars` chars.
 * Every character lands in exactly one chunk (NO truncation). Breaks prefer
 * sentence/clause boundaries (。！？；\n) so each chunk keeps readable meaning
 * for the LLM; falls back to a hard character break when no boundary exists
 * within the window. Mirrors Rust `chunk_text`.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const chars = [...text];
  let start = 0;
  while (start < chars.length) {
    const end = Math.min(start + maxChars, chars.length);
    if (end === chars.length) {
      chunks.push(chars.slice(start, end).join(''));
      break;
    }
    // Look back for the last sentence boundary within the window.
    let breakAt: number | null = null;
    for (let i = end - 1; i >= start; i--) {
      if ('。！？；\n\r'.includes(chars[i]!)) {
        breakAt = i + 1;
        break;
      }
    }
    if (breakAt !== null && breakAt > start) {
      chunks.push(chars.slice(start, breakAt).join(''));
      start = breakAt;
    } else {
      // No boundary in this window: hard-break at the window edge.
      chunks.push(chars.slice(start, end).join(''));
      start = end;
    }
  }
  if (chunks.length === 0) chunks.push(text);
  return chunks;
}

/** Merge LLM/skeleton entities into a graph (dedup by id, merge sources,
 * keep first non-null entityType). Mirrors Rust `merge_entities`. */
export function mergeEntities(graph: KbGraphData, entities: KbEntity[]): void {
  for (const e of entities) {
    const existing = graph.entities.find((x) => x.id === e.id);
    if (existing) {
      for (const s of e.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      if (existing.entityType === undefined && e.entityType !== undefined) {
        existing.entityType = e.entityType;
      }
    } else {
      graph.entities.push(e);
    }
  }
}

/** Merge LLM/skeleton relations into a graph. A typed relation upgrades/
 * overrides an untyped cooccur edge between the same pair; same-direction
 * cooccur edges accumulate weight. Mirrors Rust `merge_relations`. */
export function mergeRelations(graph: KbGraphData, relations: KbRelation[]): void {
  for (const r of relations) {
    if (r.typed) {
      const prev = graph.relations.find(
        (p) => p.subject === r.subject && p.object === r.object && !p.typed,
      );
      if (prev) {
        prev.relationType = r.relationType;
        prev.typed = true;
        prev.weight = Math.max(prev.weight, r.weight);
        continue;
      }
    }
    const same = graph.relations.find(
      (p) => p.subject === r.subject && p.object === r.object && p.relationType === r.relationType,
    );
    if (same) {
      same.weight += r.weight;
    } else {
      graph.relations.push({ ...r, typed: r.typed || r.relationType !== 'cooccur' });
    }
  }
}
