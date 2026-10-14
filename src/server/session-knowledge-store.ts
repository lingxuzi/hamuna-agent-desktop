// session-knowledge-store.ts — per-session knowledge graph persistence.
//
// Layout mirrors SessionStore's flat sessions dir: <sessionId>.knowledge.json
// next to the transcript files. An in-memory Map caches loaded graphs so
// back-to-back merges don't re-read disk; writes go through the same
// tmp+rename pattern the rest of the app uses for JSON state.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { emptyKnowledgeGraph, type SessionKnowledgeGraph } from '../shared/sessionKnowledge';

const SESSIONS_DIR = join(homedir(), '.hamuna', 'sessions');

// Same validation semantics as SessionStore.ts::isValidSessionId — the id is
// interpolated into a file path, so anything outside [A-Za-z0-9-] is rejected.
function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(sessionId) && sessionId.length > 0 && sessionId.length < 100;
}

function knowledgeFilePath(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`[session-knowledge] Invalid session ID: ${sessionId}`);
  }
  return join(SESSIONS_DIR, `${sessionId}.knowledge.json`);
}

const cache = new Map<string, SessionKnowledgeGraph>();

export function loadKnowledgeGraph(sessionId: string): SessionKnowledgeGraph {
  if (!isValidSessionId(sessionId)) return emptyKnowledgeGraph();
  const hit = cache.get(sessionId);
  if (hit) return hit;
  try {
    const path = knowledgeFilePath(sessionId);
    if (!existsSync(path)) {
      const empty = emptyKnowledgeGraph();
      cache.set(sessionId, empty);
      return empty;
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SessionKnowledgeGraph;
    const graph: SessionKnowledgeGraph =
      parsed && parsed.version === 1 && Array.isArray(parsed.entities)
        ? { ...emptyKnowledgeGraph(), ...parsed }
        : emptyKnowledgeGraph();
    cache.set(sessionId, graph);
    return graph;
  } catch (err) {
    console.warn(`[session-knowledge] load failed for ${sessionId}:`, err);
    const empty = emptyKnowledgeGraph();
    cache.set(sessionId, empty);
    return empty;
  }
}

export function saveKnowledgeGraph(sessionId: string, graph: SessionKnowledgeGraph): void {
  const path = knowledgeFilePath(sessionId);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(graph), 'utf-8');
  renameSync(tmp, path);
  cache.set(sessionId, graph);
}

export function dropKnowledgeCache(sessionId: string): void {
  cache.delete(sessionId);
}
