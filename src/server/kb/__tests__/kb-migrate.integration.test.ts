// kb-migrate.integration.test.ts — JSON → SQLite migration end-to-end.
//
// Builds a fake `~/.hamuna/kb/` directory layout (matching the Rust
// KbEngine's on-disk JSON format), invokes the migrator, and asserts the
// resulting SQLite store matches what the legacy layout held. Covers:
//   - no legacy dir → no-op
//   - happy path: KBs, mounts, graph (entities + relations), docs, pending
//   - archive rename (legacy dir → kb-legacy-<ts>)
//   - SQLite already populated → no-op + sentinel written
//
// Integration pool — uses the real TypeGraph store + real FS. Patches
// `process.env.HOME` so `os.homedir()` reflects a tmp "fake home" (Linux's
// libuv re-reads $HOME at each call; macOS may cache — see test guard).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';

import { runKbMigrationIfNeeded } from '../kb-migrate';
import { createLocalSqliteStore } from '@nicia-ai/typegraph/sqlite/local';
import { kbGraph } from '../kb-schema';

const IS_LINUX = process.platform === 'linux';

let testRoot: string;
let tmpHome: string;
let sqlitePath: string;
let origHome: string | undefined;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'kb-migrate-test-'));
  tmpHome = join(testRoot, 'fake-home');
  mkdirSync(tmpHome, { recursive: true });
  sqlitePath = join(testRoot, 'store.sqlite');
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
  // Sanity: homedir() must reflect the patched HOME for the migrator to
  // see our fake layout. Skip the suite on platforms that cache it.
  if (homedir() !== tmpHome) {
    process.env.HOME = origHome;
    throw new Error(`homedir() does not reflect $HOME on ${process.platform}; cannot run migration tests`);
  }
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(testRoot, { recursive: true, force: true });
});

describe.skipIf(!IS_LINUX)('kb-migrate', () => {
  it('skips when no legacy dir exists', async () => {
    const store = await createLocalSqliteStore(kbGraph, { path: sqlitePath });
    try {
      await runKbMigrationIfNeeded(store);
      const kbs = await store.nodes.Kb.find();
      expect(kbs.length).toBe(0);
    } finally {
      await store.close();
    }
  });

  it('migrates legacy JSON store → SQLite and archives the source dir', async () => {
    const kbDirPath = join(tmpHome, '.hamuna', 'kb');
    mkdirSync(kbDirPath, { recursive: true });

    // Realistic legacy layout: 1 KB, mounts for 2 workspaces, graph with
    // 2 entities + 1 typed relation, 1 doc with Chinese text.
    const kbId = 'kb_legacytest01';
    writeFileSync(join(kbDirPath, 'index.json'), JSON.stringify([
      { id: kbId, name: 'Legacy KB', createdAtMs: 1700000000000 },
    ]));
    writeFileSync(join(kbDirPath, 'mounts.json'), JSON.stringify({
      '/workspace/alpha': [kbId],
      '/workspace/beta': [kbId],
    }));
    const kbSubdir = join(kbDirPath, kbId);
    mkdirSync(kbSubdir, { recursive: true });
    writeFileSync(join(kbSubdir, 'graph.json'), JSON.stringify({
      entities: [
        { id: 'huawei', label: '华为', entityType: 'company', sources: ['c1'] },
        { id: 'renzhengfei', label: '任正非', entityType: 'person', sources: ['c1'] },
      ],
      relations: [
        { subject: 'renzhengfei', object: 'huawei', relationType: 'founded_by', weight: 1.0, typed: true },
      ],
    }));
    writeFileSync(join(kbSubdir, 'docs.json'), JSON.stringify([
      { id: 'doc1', title: '华为简介', text: '华为由任正非创立，是一家科技公司。', addedAtMs: 1700000001000 },
    ]));

    const store = await createLocalSqliteStore(kbGraph, { path: sqlitePath });
    try {
      await runKbMigrationIfNeeded(store);

      const kbs = await store.nodes.Kb.find();
      expect(kbs.length).toBe(1);
      expect(kbs[0]!.id).toBe(kbId);
      expect(kbs[0]!.name).toBe('Legacy KB');
      expect(kbs[0]!.workspaceIds.sort()).toEqual(['/workspace/alpha', '/workspace/beta']);

      const entities = await store.nodes.Entity.find({ where: (e) => e.kbId.eq(kbId) });
      expect(entities.length).toBe(2);
      expect(new Set(entities.map((e) => e.label))).toEqual(new Set(['华为', '任正非']));

      const relations = await store.nodes.Relation.find({ where: (r) => r.kbId.eq(kbId) });
      expect(relations.length).toBe(1);
      expect(relations[0]!.relationType).toBe('founded_by');
      expect(relations[0]!.typed).toBe(true);

      const docs = await store.nodes.Doc.find({ where: (d) => d.kbId.eq(kbId) });
      expect(docs.length).toBe(1);
      expect(docs[0]!.title).toBe('华为简介');
      expect(docs[0]!.textOriginal).toContain('任正非');

      const pending = await store.nodes.PendingTask.find({ where: (t) => t.kbId.eq(kbId) });
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0]!.chunkId.startsWith('doc1-')).toBe(true);

      // Archive: legacy dir must be gone, exactly one kb-legacy-<ts> dir present.
      expect(existsSync(kbDirPath)).toBe(false);
      const archives = readdirSync(join(tmpHome, '.hamuna')).filter((n) => n.startsWith('kb-legacy-'));
      expect(archives.length).toBe(1);

      // Re-running the migrator after the rename must be a no-op.
      await runKbMigrationIfNeeded(store);
      const kbsAfter = await store.nodes.Kb.find();
      expect(kbsAfter.length).toBe(1);
    } finally {
      await store.close();
    }
  });

  it('skips and writes sentinel when SQLite already populated', async () => {
    const kbDirPath = join(tmpHome, '.hamuna', 'kb');
    mkdirSync(kbDirPath, { recursive: true });
    writeFileSync(join(kbDirPath, 'index.json'), JSON.stringify([
      { id: 'kb_old', name: 'Should not overwrite', createdAtMs: 1 },
    ]));

    const store = await createLocalSqliteStore(kbGraph, { path: sqlitePath });
    try {
      // Seed the SQLite store with a DIFFERENT KB — migration must skip.
      await store.nodes.Kb.create({ name: 'New build KB', createdAtMs: 2, workspaceIds: [] }, { id: 'kb_new' });

      await runKbMigrationIfNeeded(store);

      const kbs = await store.nodes.Kb.find();
      expect(kbs.length).toBe(1);
      expect(kbs[0]!.id).toBe('kb_new');
      // Legacy dir still present (no archive rename), sentinel written to
      // make future boots skip cleanly too.
      expect(existsSync(kbDirPath)).toBe(true);
      expect(existsSync(join(kbDirPath, '.migrated-v1'))).toBe(true);
    } finally {
      await store.close();
    }
  });
});