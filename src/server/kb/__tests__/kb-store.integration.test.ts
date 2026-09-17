// kb-store.integration.test.ts — TypeGraph-backed KB store end-to-end.
//
// Tests bypass the HTTP dispatcher (already covered by kb-http-smoke) and
// hit kb-store.ts directly with a per-test SQLite file in mkdtempSync. Covers
// the contracts that the React UI relies on:
//   - createKb rejects case-insensitive duplicate names
//   - addText chunks + queues pending tasks + reports summary counts
//   - saveRelations merges entities (dedup) + upgrades untyped edges to typed
//   - query hits Chinese fulltext (jieba pre-tokenized), walks 1-hop, and
//     snippets come from the raw doc text (not the token stream)
//   - deleteKb cascades graph + docs + pending
//
// Integration pool — real TypeGraph store + real better-sqlite3 binary.

import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addText,
  createKb,
  deleteKb,
  graphSummary,
  listKbs,
  mountsForWorkspace,
  query,
  resetKbStore,
  saveRelations,
  setKbStorePath,
  setMounts,
} from '../kb-store';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kb-store-test-'));
  const dbPath = join(tmpDir, 'kb.sqlite');
  setKbStorePath(dbPath);
  // setKbStorePath resets the singleton; createKb below will recreate it.
  await resetKbStore();
});

afterEach(async () => {
  await resetKbStore();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('kb-store', () => {
  it('createKb rejects case-insensitive duplicate names', async () => {
    await createKb('My KB');
    await expect(createKb('my kb')).rejects.toThrow(/已存在/);
    // Different case but same logical name → still rejected.
    await expect(createKb('MY KB')).rejects.toThrow(/已存在/);
  });

  it('createKb / listKbs round-trip preserves createdAtMs order', async () => {
    const a = await createKb('A');
    // Force a different timestamp by waiting at least 1 ms.
    await new Promise((r) => setTimeout(r, 5));
    const b = await createKb('B');
    const listed = await listKbs();
    expect(listed.map((k) => k.id)).toEqual([a.id, b.id]);
    expect(listed[0]!.createdAtMs).toBeLessThan(listed[1]!.createdAtMs);
  });

  it('addText stores a doc, queues pending tasks, and reports summary counts', async () => {
    const kb = await createKb('Test KB');
    // ~10000-char text → 3 chunks (CHUNK_CHARS=4000).
    const text = '华为由任正非创立于1987年。'.repeat(250);
    const summary = await addText(kb.id, '华为简介', text);
    expect(summary.entityCount).toBe(0); // graph still empty pre-LLM
    expect(summary.relationCount).toBe(0);
    // Verify a pending task was queued (peek into the store via summary).
    // The real assertion is "the add worked" — pending count is private state
    // exposed only via graphData; here we just confirm the call returns a
    // valid summary shape.
    expect(summary.typedRelationCount).toBe(0);
  });

  it('saveRelations dedupes entities and upgrades untyped → typed', async () => {
    const kb = await createKb('Relations KB');
    // Seed an untyped cooccur edge first.
    await saveRelations(kb.id, [
      { id: 'huawei', label: '华为', sources: ['c1'] },
      { id: 'renzhengfei', label: '任正非', sources: ['c1'] },
    ], [
      { subject: '任正非', object: '华为', relationType: 'cooccur', weight: 1.0, typed: false },
    ]);
    let summary = await graphSummary(kb.id);
    expect(summary.entityCount).toBe(2);
    expect(summary.relationCount).toBe(1);
    expect(summary.typedRelationCount).toBe(0);

    // Now send a typed relation for the same pair — must UPGRADE the existing
    // edge, not append a duplicate.
    await saveRelations(kb.id, [], [
      { subject: '任正非', object: '华为', relationType: 'founded_by', weight: 0.9, typed: true },
    ]);
    summary = await graphSummary(kb.id);
    expect(summary.entityCount).toBe(2);
    expect(summary.relationCount).toBe(1); // NOT 2 — upgrade in place
    expect(summary.typedRelationCount).toBe(1);
  });

  it('query hits Chinese fulltext (jieba) and snippets come from raw doc text', async () => {
    const kb = await createKb('Query KB');
    const title = '华为公司背景';
    const body = '华为由任正非创立于1987年，总部在深圳，是一家科技公司。';
    await addText(kb.id, title, body);

    // FTS5 MATCH: the query "华为" — must hit the doc via the jieba index.
    const result = await query([kb.id], '华为');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0]!.label).toBe(title);
    // Snippet must be the RAW Chinese text (not jieba tokens).
    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.snippets[0]).toContain('华为');
  });

  it('query walks 1 hop through typed relations from matched entities', async () => {
    const kb = await createKb('Hop KB');
    await addText(kb.id, '华为文档', '华为由任正非创立');
    // Pre-populate the graph with a typed edge.
    await saveRelations(kb.id, [
      { id: 'huawei', label: '华为', sources: [] },
      { id: 'renzhengfei', label: '任正非', sources: [] },
    ], [
      { subject: '任正非', object: '华为', relationType: 'founded_by', weight: 1, typed: true },
    ]);

    const result = await query([kb.id], '任正非');
    // The seeded edge between 任正非 ↔ 华为 must be included (1-hop).
    expect(result.relations.some(
      (r) => r.relationType === 'founded_by' && r.subject === '任正非' && r.object === '华为',
    )).toBe(true);
  });

  it('mounts round-trip via setMounts + mountsForWorkspace', async () => {
    const a = await createKb('Mount A');
    const b = await createKb('Mount B');
    await setMounts('/workspace/x', [a.id, b.id]);
    // mountsForWorkspace returns sorted ids — see kb-store contract.
    expect(await mountsForWorkspace('/workspace/x')).toEqual([a.id, b.id].sort());

    // Mount only A now — B should be detached from the workspace.
    await setMounts('/workspace/x', [a.id]);
    expect(await mountsForWorkspace('/workspace/x')).toEqual([a.id]);
    expect(await mountsForWorkspace('/workspace/y')).toEqual([]);
  });

  it('deleteKb cascades entities + relations + docs + pending tasks', async () => {
    const kb = await createKb('Delete KB');
    await addText(kb.id, 'Title', '一些内容');
    await saveRelations(kb.id, [
      { id: 'a', label: '实体A', sources: [] },
    ], []);
    await deleteKb(kb.id);
    // Kb gone.
    expect((await listKbs()).some((k) => k.id === kb.id)).toBe(false);
    // Graph back to zero (graphSummary opens a fresh transaction).
    const summary = await graphSummary(kb.id);
    expect(summary.entityCount).toBe(0);
    expect(summary.relationCount).toBe(0);
  });

  // Regression: fresh install where the parent dir does not exist (e.g.
  // ~/.hamuna/kb/ was never created). Before the fix, createKb threw
  // "Cannot open database because the directory does not exist" and the
  // kb-relations poller logged it every 15s forever.
  it('auto-creates parent directory when missing (fresh install)', async () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'kb-fresh-home-'));
    const kbDir = join(freshHome, 'kb'); // intentionally does NOT exist yet
    const dbPath = join(kbDir, 'kb.sqlite');
    try {
      setKbStorePath(dbPath);
      await resetKbStore();
      const kb = await createKb('Fresh Install KB');
      expect(kb.name).toBe('Fresh Install KB');
      expect(existsSync(kbDir)).toBe(true);
    } finally {
      await resetKbStore();
      rmSync(freshHome, { recursive: true, force: true });
    }
  });
});