import { describe, it, expect } from 'vitest';

import {
  emptyKnowledgeGraph,
  mergeTurnIntoGraph,
  SESSION_NODE_CAP,
  SESSION_EDGE_CAP,
  type SessionKnowledgeGraph,
} from './sessionKnowledge';

function extraction(
  entities: [string, string?, string?][],
  relations: [string, string, string?][],
) {
  return {
    entities: entities.map(([id, label, entityType]) => ({ id, ...(label ? { label } : {}), ...(entityType ? { entityType } : {}) })),
    relations: relations.map(([subject, object, relationType]) => ({ subject, object, relationType: relationType ?? 'related_to' })),
  };
}

describe('mergeTurnIntoGraph', () => {
  it('merges new entities and relations from a turn', () => {
    const g = mergeTurnIntoGraph(
      emptyKnowledgeGraph(),
      extraction([['React', 'React 19'], ['Vite']], [['React', 'Vite', 'integrates_with']]),
      'm1',
    );
    expect(g.entities).toHaveLength(2);
    expect(g.relations).toHaveLength(1);
    expect(g.relations[0]).toMatchObject({ subject: 'React', object: 'Vite', relationType: 'integrates_with', typed: true, weight: 1 });
    expect(g.entities[0].sources).toEqual(['m1']);
    expect(g.turnCount).toBe(1);
  });

  it('dedupes entities case-insensitively and accumulates weight + sources', () => {
    let g = mergeTurnIntoGraph(emptyKnowledgeGraph(), extraction([['react']], []), 'm1');
    g = mergeTurnIntoGraph(g, extraction([['React', 'ReactJS']], []), 'm2');
    expect(g.entities).toHaveLength(1);
    expect(g.entities[0].weight).toBe(2);
    expect(g.entities[0].sources).toEqual(['m1', 'm2']);
    expect(g.entities[0].label).toBe('ReactJS'); // longer surface form wins
  });

  it('dedupes relations as unordered pairs and keeps max weight', () => {
    let g = mergeTurnIntoGraph(emptyKnowledgeGraph(), extraction([['A'], ['B']], [['A', 'B', 'x']]), 'm1');
    g = mergeTurnIntoGraph(g, extraction([['A'], ['B']], [['B', 'A', 'y']]), 'm2');
    expect(g.relations).toHaveLength(1);
    expect(g.relations[0].weight).toBe(1); // both extractions weight 1
    expect(g.relations[0].sources).toEqual(['m1', 'm2']);
  });

  it('drops self-loop relations', () => {
    const g = mergeTurnIntoGraph(emptyKnowledgeGraph(), extraction([['A']], [['A', 'a', 'x']]), 'm1');
    expect(g.relations).toHaveLength(0);
    expect(g.entities).toHaveLength(1);
  });

  it('skips relations whose endpoints are unknown or evicted', () => {
    const g = mergeTurnIntoGraph(emptyKnowledgeGraph(), extraction([], [['Ghost', 'Other', 'x']]), 'm1');
    expect(g.relations).toHaveLength(0);
  });

  it('resolves relation endpoints that differ from the entity id only by case or padding', () => {
    // LLM extraction is not byte-exact: the relation names come back cased and
    // padded differently from the entity ids. Matching raw strings silently
    // dropped every such edge, so the dashboard rendered isolated nodes.
    const g = mergeTurnIntoGraph(
      emptyKnowledgeGraph(),
      extraction([['React'], ['Vite']], [['react ', ' VITE', 'integrates_with']]),
      'm1',
    );
    expect(g.relations).toHaveLength(1);
    // Stored as the canonical entity ids, not the raw extraction strings.
    expect(g.relations[0].subject).toBe('React');
    expect(g.relations[0].object).toBe('Vite');
  });

  it('is a no-op for empty extractions except turnCount', () => {
    let g = mergeTurnIntoGraph(emptyKnowledgeGraph(), extraction([['A']], []), 'm1');
    const before = g;
    g = mergeTurnIntoGraph(g, extraction([], []), 'm2');
    expect(g.entities).toHaveLength(1);
    expect(g.entities[0].sources).toEqual(['m1']);
    expect(g.turnCount).toBe(2);
    expect(g).not.toBe(before); // pure: new object each merge
  });

  it('evicts lowest-weight entities beyond the node cap but keeps same-turn survivors', () => {
    let g: SessionKnowledgeGraph = emptyKnowledgeGraph();
    // Every node hit twice except node-0 hit once → lowest weight, first out.
    for (let i = 0; i < SESSION_NODE_CAP; i++) {
      g = mergeTurnIntoGraph(g, extraction([[`node-${i}`]], []), `m-${i}`);
    }
    for (let i = 1; i < SESSION_NODE_CAP; i++) {
      g = mergeTurnIntoGraph(g, extraction([[`node-${i}`]], []), `boost-${i}`);
    }
    expect(g.entities).toHaveLength(SESSION_NODE_CAP);
    g = mergeTurnIntoGraph(g, extraction([['fresh-node']], []), 'new');
    expect(g.entities).toHaveLength(SESSION_NODE_CAP);
    expect(g.entities.find(e => e.id === 'fresh-node')).toBeDefined();
    expect(g.entities.find(e => e.id === 'node-0')).toBeUndefined();
  });

  it('caps relations beyond the edge cap by weight', () => {
    let g: SessionKnowledgeGraph = emptyKnowledgeGraph();
    const ents = Array.from({ length: SESSION_EDGE_CAP + 1 }, (_, i) => [`e${i}`] as [string]);
    g = mergeTurnIntoGraph(g, extraction(ents, []), 'm0');
    const rels: [string, string, string?][] = [];
    for (let i = 0; i < SESSION_EDGE_CAP + 1; i++) {
      rels.push([`e${i}`, `e${(i + 1) % (SESSION_EDGE_CAP + 1)}`, 'x']);
    }
    g = mergeTurnIntoGraph(g, extraction(ents, rels), 'm1');
    expect(g.relations.length).toBeLessThanOrEqual(SESSION_EDGE_CAP);
  });

  it('ignores malformed extraction entries', () => {
    const g = mergeTurnIntoGraph(
      emptyKnowledgeGraph(),
      {
        entities: [{ id: '' }, { id: '  ' }, { id: 'ok' }],
        relations: [{ subject: '', object: 'b', relationType: 'x' }, { subject: 'a', object: '', relationType: 'x' }],
      } as Parameters<typeof mergeTurnIntoGraph>[1],
      'm1',
    );
    expect(g.entities).toHaveLength(1);
    expect(g.relations).toHaveLength(0);
  });
});
