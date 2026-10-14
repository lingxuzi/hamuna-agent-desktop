// Locks the single-slot queue contract in session-knowledge-service.
//
// The pending turn used to be re-dispatched through `enqueue`, which saw its
// own `inFlight` entry and pushed the turn straight back into `pending` —
// so a turn that arrived during extraction was never extracted.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { broadcasts, hookSlot, resolveModelMock } = vi.hoisted(() => {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const hookSlot: { current: ((p: { sessionId: string; text: string; messageId: string }) => void) | null } = { current: null };
  const resolveModelMock = vi.fn(() => Promise.resolve({ model: 'm', providerEnv: {} }));
  return { broadcasts, hookSlot, resolveModelMock };
});

vi.mock('../sse', () => ({
  broadcast: (event: string, payload: unknown) => broadcasts.push({ event, payload }),
}));

vi.mock('../turn-hooks', () => ({
  setPostTurnKnowledgeHook: (hook: (p: { sessionId: string; text: string; messageId: string }) => void) => {
    hookSlot.current = hook;
  },
}));

vi.mock('../utils/admin-config', () => ({ loadConfig: () => ({ knowledgeDashboardEnabled: true }) }));

vi.mock('../session-knowledge-store', () => ({
  loadKnowledgeGraph: () => ({ version: 1, entities: [], relations: [], turnCount: 0, updatedAtMs: 0 }),
  saveKnowledgeGraph: () => {},
}));

vi.mock('../kb-relations', () => ({
  resolveRelationModel: resolveModelMock,
  providerMessagesText: () => Promise.resolve('{"entities":[],"relations":[]}'),
  parseExtraction: () => ({ entities: [], relations: [] }),
}));

/** Long enough to clear MIN_EXTRACT_TEXT_LEN so extraction actually runs. */
const LONG = 'a'.repeat(300);

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
}

describe('session-knowledge-service queue', () => {
  beforeEach(async () => {
    broadcasts.length = 0;
    resolveModelMock.mockClear();
    vi.resetModules();
    hookSlot.current = null;
    const mod = await import('../session-knowledge-service');
    mod.installSessionKnowledgeHook();
  });

  it('processes the queued turn that arrived during extraction', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let calls = 0;
    const kb = await import('../kb-relations');
    vi.spyOn(kb, 'providerMessagesText').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate;
      return '{"entities":[],"relations":[]}';
    });

    hookSlot.current!({ sessionId: 'sess-a', text: LONG, messageId: 'm1' });
    await flush();
    // Second turn lands while the first is still in flight → queued, not dropped.
    hookSlot.current!({ sessionId: 'sess-a', text: LONG, messageId: 'm2' });
    release();
    await flush();
    await flush();

    expect(calls).toBe(2);
    expect(broadcasts.filter(b => (b.payload as { extracting?: boolean }).extracting === false)).toHaveLength(2);
  });

  it('brackets extraction with extracting true/false so the panel can animate', async () => {
    hookSlot.current!({ sessionId: 'sess-b', text: LONG, messageId: 'm1' });
    await flush();

    const flags = broadcasts
      .filter(b => b.event === 'chat:knowledge-updated')
      .map(b => (b.payload as { extracting?: boolean }).extracting);
    expect(flags[0]).toBe(true);
    expect(flags[flags.length - 1]).toBe(false);
  });
});
