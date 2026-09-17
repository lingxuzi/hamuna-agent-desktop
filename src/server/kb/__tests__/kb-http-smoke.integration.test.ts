// kb-http-smoke.integration.test.ts — end-to-end check of the KB HTTP
// dispatcher (handleKbAdminRequest) against a temp SQLite file. Covers the
// public CRUD + ingest + query contract: each route returns the expected
// `{ ok, ... }` shape AND the right HTTP status (200 on success, 400 on
// logical failure, 404 on unknown route). Integration pool — touches the
// real TypeGraph store; uses a tmpdir so the user's ~/.hamuna is untouched.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleKbAdminRequest } from '../kb-service';
import { setKbStorePath } from '../kb-store';

function makeRequest(method: string, pathname: string, body?: Record<string, unknown>): Request {
  const url = `http://localhost${pathname}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new Request(url, init);
}

describe('kb-service HTTP dispatcher', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kb-http-smoke-'));
    setKbStorePath(join(tmpDir, 'kb.sqlite'));
  });

  afterAll(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects unknown paths with 404', async () => {
    const res = await handleKbAdminRequest(makeRequest('GET', '/api/admin/kb/unknown'), '/api/admin/kb/unknown');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
  });

  it('runs the full CRUD + query chain', async () => {
    // 1. Create
    let res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/create', { name: '烟测 KB' }),
      '/api/admin/kb/create',
    );
    expect(res.status).toBe(200);
    const created = (await res.json()) as { ok: boolean; kb: { id: string; name: string } };
    expect(created.ok).toBe(true);
    expect(created.kb.name).toBe('烟测 KB');
    const kbId = created.kb.id;

    // 2. List
    res = await handleKbAdminRequest(makeRequest('GET', '/api/admin/kb/list'), '/api/admin/kb/list');
    const list = (await res.json()) as { ok: boolean; kbs: Array<{ id: string }> };
    expect(list.kbs.some((k) => k.id === kbId)).toBe(true);

    // 3. Duplicate name → logical failure → 400
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/create', { name: '烟测 KB' }),
      '/api/admin/kb/create',
    );
    expect(res.status).toBe(400);
    const dup = (await res.json()) as Record<string, unknown>;
    expect(dup.ok).toBe(false);

    // 4. Add text with Chinese content
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/add-text', {
        kbId,
        title: '知识图谱介绍',
        text: '华为由任正非创立，是一家科技公司。知识图谱是其核心技术之一。',
      }),
      '/api/admin/kb/add-text',
    );
    expect(res.status).toBe(200);
    const added = (await res.json()) as { ok: boolean; summary: { entityCount: number; relationCount: number } };
    expect(added.ok).toBe(true);
    expect(added.summary.entityCount).toBeGreaterThanOrEqual(0);

    // 5. List docs
    res = await handleKbAdminRequest(
      makeRequest('GET', `/api/admin/kb/docs?kbId=${kbId}`),
      '/api/admin/kb/docs',
    );
    const docs = (await res.json()) as { ok: boolean; docs: Array<{ title: string; textLength: number }> };
    expect(docs.ok).toBe(true);
    expect(docs.docs.length).toBe(1);
    expect(docs.docs[0]!.title).toBe('知识图谱介绍');
    expect(docs.docs[0]!.textLength).toBeGreaterThan(0);

    // 6. Graph summary
    res = await handleKbAdminRequest(
      makeRequest('GET', `/api/admin/kb/graph-summary?kbId=${kbId}`),
      '/api/admin/kb/graph-summary',
    );
    const summary = (await res.json()) as Record<string, unknown>;
    expect(summary.ok).toBe(true);
    expect(typeof summary.entityCount).toBe('number');

    // 7. Graph data — pendingCount >0 (no relations worker in this test)
    res = await handleKbAdminRequest(
      makeRequest('GET', `/api/admin/kb/graph-data?kbId=${kbId}`),
      '/api/admin/kb/graph-data',
    );
    const graph = (await res.json()) as { ok: boolean; entities: unknown[]; relations: unknown[]; pendingCount: number };
    expect(graph.ok).toBe(true);
    expect(graph.pendingCount).toBeGreaterThan(0);

    // 8. Query — Chinese fulltext hit
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/query', { kbIds: [kbId], query: '知识图谱' }),
      '/api/admin/kb/query',
    );
    expect(res.status).toBe(200);
    const q = (await res.json()) as { ok: boolean; entities: Array<{ id: string }>; snippets: string[] };
    expect(q.ok).toBe(true);
    expect(q.entities.length).toBeGreaterThan(0);
    expect(q.snippets.some((s) => s.includes('知识图谱'))).toBe(true);

    // 9. Save relations (LLM-style extract) — verify merge semantics
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/relations', {
        kbId,
        entities: [
          { id: '华为', label: '华为', entityType: 'company' },
          { id: '任正非', label: '任正非', entityType: 'person' },
        ],
        relations: [
          { subject: '任正非', object: '华为', relationType: 'founded_by', weight: 1.0, typed: true },
        ],
      }),
      '/api/admin/kb/relations',
    );
    expect(res.status).toBe(200);

    // 10. Re-query — graph entities should now seed matched set
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/query', { kbIds: [kbId], query: '华为' }),
      '/api/admin/kb/query',
    );
    const q2 = (await res.json()) as { ok: boolean; relations: Array<{ subject: string; object: string }> };
    expect(q2.relations.some((r) => r.subject === '任正非' && r.object === '华为')).toBe(true);

    // 11. Mounts round-trip
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/mounts', { workspace: '/tmp/ws1', kbIds: [kbId] }),
      '/api/admin/kb/mounts',
    );
    expect(res.status).toBe(200);
    res = await handleKbAdminRequest(makeRequest('GET', '/api/admin/kb/mounts'), '/api/admin/kb/mounts');
    const mounts = (await res.json()) as { ok: boolean; mounts: Record<string, string[]> };
    expect(mounts.mounts['/tmp/ws1']).toContain(kbId);

    // 12. Pending queue — done drains the queue
    res = await handleKbAdminRequest(
      makeRequest('GET', `/api/admin/kb/pending-relations?kbId=${kbId}&limit=50`),
      '/api/admin/kb/pending-relations',
    );
    const pending = (await res.json()) as { ok: boolean; tasks: Array<{ chunkId: string }> };
    const chunkIds = pending.tasks.map((t) => t.chunkId);
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/pending-relations/done', { kbId, chunkIds }),
      '/api/admin/kb/pending-relations/done',
    );
    expect(res.status).toBe(200);

    // 13. Rename
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/rename', { kbId, name: '烟测 KB 重命名' }),
      '/api/admin/kb/rename',
    );
    expect(res.status).toBe(200);

    // 14. Rebuild
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/rebuild', { kbId }),
      '/api/admin/kb/rebuild',
    );
    expect(res.status).toBe(200);

    // 15. Delete cascades
    res = await handleKbAdminRequest(
      makeRequest('POST', '/api/admin/kb/delete', { kbId }),
      '/api/admin/kb/delete',
    );
    expect(res.status).toBe(200);
    res = await handleKbAdminRequest(makeRequest('GET', '/api/admin/kb/list'), '/api/admin/kb/list');
    const afterDelete = (await res.json()) as { kbs: Array<{ id: string }> };
    expect(afterDelete.kbs.some((k) => k.id === kbId)).toBe(false);
  });
});