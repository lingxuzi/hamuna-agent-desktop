// kb-schema.ts — TypeGraph node definitions for the knowledge base (资料库).
//
// Migration from the Rust KbEngine (JSON + Tantivy) to an embedded TypeGraph
// graph over SQLite on the Node sidecar. Relation is modeled as a NODE (not an
// edge) because TypeGraph `defineEdge` has no property schema, and relations
// carry {relationType, weight, typed}. Endpoint identity is the entity LABEL
// (== the API-visible entity id, same as Rust `entity_id()`), stored in the
// `subject` / `object` props.
//
// Fulltext: Doc.text holds the jieba pre-tokenized, space-joined token
// sequence and is marked `searchable()`; Doc.textOriginal holds the raw text
// for display/snippets. FTS5's unicode61 tokenizer produces zero tokens for a
// CJK run, so pre-tokenization is REQUIRED (verified in Phase 0 spike) — not a
// nice-to-have.

import { z } from 'zod';
import { defineNode, defineGraph } from '@nicia-ai/typegraph';
import { searchable } from '@nicia-ai/typegraph';

// ── Kinds ──────────────────────────────────────────────────────────────

/** A knowledge base. workspaceIds = mounts (workspace path -> this kb). */
export const KbNode = defineNode('Kb', {
  schema: z.object({
    name: z.string().min(1),
    createdAtMs: z.number(),
    workspaceIds: z.array(z.string()).default([]),
  }),
  description: 'A knowledge base (资料库).',
});

/** A knowledge-graph entity. label is the business key == API id. */
export const EntityNode = defineNode('Entity', {
  schema: z.object({
    kbId: z.string(),
    label: z.string().min(1),
    entityType: z.string().optional(),
    sources: z.array(z.string()).default([]),
  }),
  description: 'A knowledge-graph entity; label == API-visible id.',
});

/** One chunk of an ingested document. text is jieba-tokenized + searchable. */
export const DocNode = defineNode('Doc', {
  schema: z.object({
    kbId: z.string(),
    title: z.string(),
    addedAtMs: z.number(),
    text: searchable(),
    textOriginal: z.string(),
  }),
  description: 'A document chunk with jieba-tokenized fulltext surface.',
});

/** A queued LLM relation-typing task (drained as the poller processes it). */
export const PendingTaskNode = defineNode('PendingTask', {
  schema: z.object({
    kbId: z.string(),
    chunkId: z.string(),
    text: z.string(),
  }),
  description: 'A queued LLM relation-typing task for one chunk.',
});

/** A typed/untyped relation between two entities (labels). */
export const RelationNode = defineNode('Relation', {
  schema: z.object({
    kbId: z.string(),
    subject: z.string(),
    object: z.string(),
    relationType: z.string(),
    weight: z.number(),
    typed: z.boolean(),
  }),
  description: 'A relation between two entities; subject/object are labels.',
});

export const kbGraph = defineGraph({
  id: 'hamuna-kb',
  nodes: {
    Kb: { type: KbNode, unique: [{
      name: 'kb_name_unique',
      fields: ['name'],
      scope: 'kind',
      collation: 'caseInsensitive',
    }] },
    Entity: { type: EntityNode },
    Doc: { type: DocNode },
    PendingTask: { type: PendingTaskNode },
    Relation: { type: RelationNode },
  },
  edges: {},
});
