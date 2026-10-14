import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The store resolves SESSIONS_DIR from homedir at module load — redirect HOME
// before importing (integration-style layout on a temp dir, still unit-pool:
// no network, no real HOME writes).
const tmpHome = mkdtempSync(join(tmpdir(), 'sk-store-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { loadKnowledgeGraph, saveKnowledgeGraph, dropKnowledgeCache } = await import('../session-knowledge-store');
const { emptyKnowledgeGraph } = await import('../../shared/sessionKnowledge');

const SESSIONS_DIR = join(tmpHome, '.hamuna', 'sessions');

describe('session-knowledge-store', () => {
  beforeEach(() => {
    rmSync(SESSIONS_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    dropKnowledgeCache('sess-1');
  });

  it('returns an empty graph when no file exists', () => {
    const g = loadKnowledgeGraph('sess-1');
    expect(g.version).toBe(1);
    expect(g.entities).toEqual([]);
  });

  it('round-trips a graph through disk', () => {
    const g = { ...emptyKnowledgeGraph(), turnCount: 3, updatedAtMs: 42, entities: [{ id: 'A', label: 'A', sources: ['m1'], weight: 1 }] };
    saveKnowledgeGraph('sess-1', g);
    dropKnowledgeCache('sess-1');
    const loaded = loadKnowledgeGraph('sess-1');
    expect(loaded.turnCount).toBe(3);
    expect(loaded.entities[0].id).toBe('A');
    expect(existsSync(join(SESSIONS_DIR, 'sess-1.knowledge.json'))).toBe(true);
  });

  it('recovers from a corrupt file by returning an empty graph', () => {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(join(SESSIONS_DIR, 'sess-1.knowledge.json'), '{not json', 'utf-8');
    const g = loadKnowledgeGraph('sess-1');
    expect(g.entities).toEqual([]);
  });

  it('rejects path-traversing session ids', () => {
    // Save throws (explicit caller error); load degrades to an empty graph so
    // a malformed id can never be used as a read probe either.
    expect(() => saveKnowledgeGraph('../evil', emptyKnowledgeGraph())).toThrow(/Invalid session ID/);
    expect(loadKnowledgeGraph('a/b').entities).toEqual([]);
  });

  it('writes no file for an invalid id', () => {
    try {
      saveKnowledgeGraph('../evil', emptyKnowledgeGraph());
    } catch {
      /* expected */
    }
    expect(existsSync(join(SESSIONS_DIR, 'evil.knowledge.json'))).toBe(false);
  });
});
