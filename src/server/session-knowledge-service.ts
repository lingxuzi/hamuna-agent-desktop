// session-knowledge-service.ts — per-turn knowledge extraction for the
// session knowledge dashboard (Chat page floating panel).
//
// Fired via the turn-hooks sibling slot after a successful turn. Best-effort
// end to end: any failure means "this turn contributes nothing", never an
// error surfaced to the turn that triggered it.
//
// Extraction reuses kb-relations' provider plumbing (model resolution, direct
// provider HTTP, tolerant JSON parse) with a compact prompt — a small bounded
// graph per turn, not a full kb-style extraction with source grounding.

import { loadConfig } from './utils/admin-config';
import { broadcast } from './sse';
import { setPostTurnKnowledgeHook } from './turn-hooks';
import {
  MIN_EXTRACT_TEXT_LEN,
  mergeTurnIntoGraph,
  type KnowledgeExtraction,
  type SessionKnowledgeGraph,
} from '../shared/sessionKnowledge';
import { loadKnowledgeGraph, saveKnowledgeGraph } from './session-knowledge-store';

const SYSTEM_PROMPT = `You extract the key knowledge from an AI assistant's reply for a concept dashboard.

Output a single JSON object (NO markdown fences, NO prose):
{"entities":[{"id":"<canonical name, short>","label":"<display name>","type":"<ORG|PERSON|PLACE|PRODUCT|DATE|CODE|DOCUMENT|CONCEPT|TOPIC|...>"}],"relations":[{"subject":"<entity id>","object":"<entity id>","relation_type":"<snake_case verb phrase>","weight":<0..1 confidence>}]}

Rules:
- At most 12 entities and 12 relations. Pick the MOST salient concepts, tools, technologies, and domain terms.
- Only entities that appear in the reply. Relations must connect entities you output.
- Omit entities/relations you are not confident about. An empty {"entities":[],"relations":[]} is valid for chatty or trivial replies.`;

const MAX_INPUT_CHARS = 6_000;
const MAX_ENTITIES = 12;
const MAX_RELATIONS = 12;

/** Per-session in-flight guard + single-slot pending: while a session's
 *  extraction is running, at most ONE newer turn is kept for after. */
const inFlight = new Set<string>();
const pending = new Map<string, { text: string; messageId: string }>();

interface KnowledgeModel {
  model: string;
  providerEnv?: import('./agent-session').ProviderEnv;
}

async function resolveModel(): Promise<KnowledgeModel | null> {
  const kb = await import('./kb-relations');
  return kb.resolveRelationModel();
}

function isExtractionEnabled(): boolean {
  return loadConfig().knowledgeDashboardEnabled !== false;
}

async function extractFromText(text: string, model: KnowledgeModel): Promise<KnowledgeExtraction> {
  const kb = await import('./kb-relations');
  const clipped = text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}…` : text;
  const raw = await kb.providerMessagesText(
    model.providerEnv as Parameters<typeof kb.providerMessagesText>[0],
    model.model,
    SYSTEM_PROMPT,
    clipped,
  );
  const parsed = kb.parseExtraction(raw);
  return {
    entities: parsed.entities.slice(0, MAX_ENTITIES).map(e => ({ id: e.id, label: e.label, entityType: e.entityType })),
    relations: parsed.relations.slice(0, MAX_RELATIONS).map(r => ({
      subject: r.subject,
      object: r.object,
      relationType: r.relation_type,
      weight: r.weight,
    })),
  };
}

async function processTurn(sessionId: string, text: string, messageId: string, model: KnowledgeModel | null): Promise<void> {
  const graph = loadKnowledgeGraph(sessionId);
  // `extracting` is the only honest signal the panel has that work is running —
  // extraction can take seconds and nothing else changes on the wire meanwhile.
  broadcast('chat:knowledge-updated', { sessionId, graph, extracting: true });
  let next: SessionKnowledgeGraph = graph;
  try {
    if (model && text.length >= MIN_EXTRACT_TEXT_LEN) {
      const extraction = await extractFromText(text, model);
      if (extraction.entities.length > 0 || extraction.relations.length > 0) {
        next = mergeTurnIntoGraph(graph, extraction, messageId);
        saveKnowledgeGraph(sessionId, next);
      }
    }
  } finally {
    // Broadcast even when the turn contributed nothing: the panel refetches and
    // shows an unchanged graph instead of waiting for a later turn.
    broadcast('chat:knowledge-updated', { sessionId, graph: next, extracting: false });
  }
}

function enqueue(sessionId: string, text: string, messageId: string): void {
  if (inFlight.has(sessionId)) {
    pending.set(sessionId, { text, messageId }); // single slot: newest wins
    return;
  }
  inFlight.add(sessionId);
  void (async () => {
    // Loop instead of recursing through enqueue(): the guard above would see
    // our own inFlight entry and re-queue the pending turn forever.
    let next: { text: string; messageId: string } = { text, messageId };
    try {
      for (;;) {
        const model = await resolveModel();
        await processTurn(sessionId, next.text, next.messageId, model);
        const p = pending.get(sessionId);
        if (!p) break;
        pending.delete(sessionId);
        next = p;
      }
    } catch (err) {
      console.warn(`[session-knowledge] extraction failed for ${sessionId}:`, err);
      pending.delete(sessionId);
    } finally {
      inFlight.delete(sessionId);
    }
  })();
}

/**
 * Install the knowledge-extraction trigger into the `turn-hooks` slot.
 * Called once at sidecar boot so both runtime paths can fire extraction
 * without importing this module (dependency inversion — see turn-hooks.ts).
 */
export function installSessionKnowledgeHook(): void {
  setPostTurnKnowledgeHook(({ sessionId, text, messageId }) => {
    if (!sessionId || !isExtractionEnabled()) return;
    enqueue(sessionId, text, messageId);
  });
}

export function getKnowledgeGraphForSession(sessionId: string): SessionKnowledgeGraph {
  return loadKnowledgeGraph(sessionId);
}
