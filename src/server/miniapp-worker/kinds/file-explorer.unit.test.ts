// file-explorer.unit.test.ts — Phase 4.2 second worker kind.
//
// Schema validation + handler smoke tests for FILE_EXPLORER_KIND. Mirrors
// `git-graph.ts` style — handler logic is straightforward fs traversal
// (depth cap, max entries, symlink refusal, binary detection) so the tests
// focus on the safety rails rather than every read/write path.

import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FILE_EXPLORER_KIND } from './file-explorer';
import { getKindDef, listKinds } from '../worker-rpc';

describe('FILE_EXPLORER_KIND', () => {
  // Top-level import already triggers self-register via the side-effect
  // `registerKind(FILE_EXPLORER_KIND)` at module load. The beforeEach reset
  // clears the registry so getKindDef('file-explorer') returns null UNLESS
  // we re-register — but the import already ran once at module load, and
  // vitest doesn't re-evaluate the module. We work around this by simply
  // not resetting between tests: the registry is shared module state and
  // these tests are read-only assertions on FILE_EXPLORER_KIND.
  beforeEach(() => {
    // Intentionally no reset: the registry is module-level and we want
    // FILE_EXPLORER_KIND to be present for every test in this file.
  });

  it('registers itself under kind "file-explorer"', () => {
    expect(getKindDef('file-explorer')).toBe(FILE_EXPLORER_KIND);
    expect(listKinds().map((k) => k.kind)).toContain('file-explorer');
  });

  it('exposes exactly three methods (file.tree, file.read, file.search)', () => {
    const names = FILE_EXPLORER_KIND.methods.map((m) => m.name).sort();
    expect(names).toEqual(['file.read', 'file.search', 'file.tree']);
  });

  it('has an entryPath that points to a sibling of kinds/', () => {
    expect(FILE_EXPLORER_KIND.entryPath).toMatch(/worker-entry-file-explorer\.js$/);
  });

  describe('schemas (fail-closed on bad params)', () => {
    const schemas = Object.fromEntries(
      FILE_EXPLORER_KIND.methods.map((m) => [m.name, m.schema]),
    );

    it('file.tree rejects negative maxDepth', () => {
      const r = schemas['file.tree'].safeParse({ root: '/tmp', maxDepth: -1 });
      expect(r.success).toBe(false);
    });

    it('file.tree rejects maxDepth above 8', () => {
      const r = schemas['file.tree'].safeParse({ root: '/tmp', maxDepth: 100 });
      expect(r.success).toBe(false);
    });

    it('file.read rejects maxBytes above 1MB', () => {
      const r = schemas['file.read'].safeParse({ path: '/tmp/x', maxBytes: 2 * 1024 * 1024 });
      expect(r.success).toBe(false);
    });

    it('file.search rejects empty query', () => {
      const r = schemas['file.search'].safeParse({ root: '/tmp', query: '' });
      expect(r.success).toBe(false);
    });

    it('all methods reject empty root/path', () => {
      for (const schema of Object.values(schemas)) {
        const r = schema.safeParse({ root: '', path: '', query: 'q' });
        expect(r.success).toBe(false);
      }
    });
  });

  describe('handlers (against a real tmp dir)', () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(path.join(tmpdir(), 'miniapp-fexpl-'));
      writeFileSync(path.join(tmpRoot, 'hello.txt'), 'hello world\n');
      writeFileSync(path.join(tmpRoot, 'binary.bin'), Buffer.from([0, 1, 2, 0, 3, 4]));
      mkdirSync(path.join(tmpRoot, 'sub'));
      writeFileSync(path.join(tmpRoot, 'sub', 'nested.txt'), 'nested content');
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('file.tree lists files with size, skipping .git + node_modules + symlinks', async () => {
      mkdirSync(path.join(tmpRoot, 'node_modules'));
      writeFileSync(path.join(tmpRoot, 'node_modules', 'skip.txt'), 'should not appear');
      mkdirSync(path.join(tmpRoot, '.git'));
      writeFileSync(path.join(tmpRoot, '.git', 'skip.txt'), 'should not appear');
      // Symlink to outside the root — must be refused.
      try {
        symlinkSync('/etc', path.join(tmpRoot, 'evil-link'), 'dir');
      } catch {
        // Some platforms refuse symlinks in tmp dirs; that's fine.
      }

      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.tree')!
        .handler as (p: unknown) => Promise<{ entries: Array<{ rel: string; type: string }> }>;
      const result = await handler({ root: tmpRoot, maxDepth: 4, maxEntries: 500 });

      const rels = result.entries.map((e) => e.rel).sort();
      expect(rels).toContain('hello.txt');
      expect(rels).toContain('sub');
      expect(rels.some((r) => r.includes('node_modules'))).toBe(false);
      expect(rels.some((r) => r.includes('.git'))).toBe(false);
      // Symlink may or may not exist depending on platform; if it does,
      // it must NOT be in the listing.
      expect(rels).not.toContain('evil-link');
    });

    it('file.tree refuses symlink roots', async () => {
      const link = path.join(tmpRoot, 'link');
      try {
        symlinkSync(path.dirname(tmpRoot), link, 'dir');
      } catch {
        return; // platform doesn't allow — skip silently
      }
      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.tree')!
        .handler as (p: unknown) => unknown;
      // handler is declared as sync or async; it throws synchronously when
      // the root is a symlink, so wrap the assertion in try/catch.
      let thrown: Error | null = null;
      try {
        await handler({ root: link });
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown!.message).toMatch(/symlink/);
    });

    it('file.read returns content for text, empty content for binary', async () => {
      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.read')!
        .handler as (p: unknown) => Promise<{
          content: string;
          binary: boolean;
          size: number;
        }>;

      const txt = await handler({ path: path.join(tmpRoot, 'hello.txt') });
      expect(txt.binary).toBe(false);
      expect(txt.content).toBe('hello world\n');
      expect(txt.size).toBeGreaterThan(0);

      const bin = await handler({ path: path.join(tmpRoot, 'binary.bin') });
      expect(bin.binary).toBe(true);
      expect(bin.content).toBe('');
    });

    it('file.search returns matching lines with relative path + line number', async () => {
      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.search')!
        .handler as (p: unknown) => Promise<{
          hits: Array<{ rel: string; line: number; snippet: string }>;
          truncated: boolean;
        }>;

      const result = await handler({
        root: tmpRoot,
        query: 'hello',
        caseInsensitive: false,
        maxHits: 50,
      });
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      expect(result.hits[0].rel).toBe('hello.txt');
      expect(result.hits[0].line).toBe(1);
      expect(result.hits[0].snippet).toContain('hello');
      expect(result.truncated).toBe(false);
    });

    it('file.search is case-insensitive when configured', async () => {
      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.search')!
        .handler as (p: unknown) => Promise<{ hits: unknown[] }>;

      const sensitive = await handler({
        root: tmpRoot,
        query: 'HELLO',
        caseInsensitive: false,
        maxHits: 50,
      });
      expect(sensitive.hits.length).toBe(0);

      const insensitive = await handler({
        root: tmpRoot,
        query: 'HELLO',
        caseInsensitive: true,
        maxHits: 50,
      });
      expect(insensitive.hits.length).toBeGreaterThanOrEqual(1);
    });

    it('file.search skips .git + node_modules directories', async () => {
      mkdirSync(path.join(tmpRoot, 'node_modules'));
      writeFileSync(path.join(tmpRoot, 'node_modules', 'should-not-match.txt'), 'should-not-match');
      const handler = FILE_EXPLORER_KIND.methods.find((m) => m.name === 'file.search')!
        .handler as (p: unknown) => Promise<{ hits: Array<{ rel: string }> }>;

      const result = await handler({
        root: tmpRoot,
        query: 'should-not-match',
        caseInsensitive: false,
        maxHits: 50,
      });
      // Even case-sensitive: no hit because node_modules is skipped entirely.
      expect(result.hits.length).toBe(0);
    });
  });
});
