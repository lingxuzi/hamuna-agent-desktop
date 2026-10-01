import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMiniAppMetadata } from './meta-schema';

const VALID = {
  id: 'git-graph-sample',
  name: 'Git Graph',
  description: 'Interactive Git graph',
  icon: '📊',
  category: 'developer',
  version: 1,
  min_host_version: '0.3.201',
  permissions: { fs: { read: ['{appdata}/**'] } },
};

describe('parseMiniAppMetadata', () => {
  it('accepts a minimal valid meta', () => {
    const r = parseMiniAppMetadata(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.id).toBe('git-graph-sample');
      expect(r.result.permissions.fs?.read).toEqual(['{appdata}/**']);
    }
  });

  it('rejects non-object input', () => {
    expect(parseMiniAppMetadata('hi').ok).toBe(false);
    expect(parseMiniAppMetadata(null).ok).toBe(false);
  });

  it('rejects non-kebab-case id', () => {
    expect(parseMiniAppMetadata({ ...VALID, id: 'Bad_ID' }).ok).toBe(false);
  });

  it('rejects description > 200 chars', () => {
    expect(parseMiniAppMetadata({ ...VALID, description: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('rejects unknown category', () => {
    expect(parseMiniAppMetadata({ ...VALID, category: 'magic' }).ok).toBe(false);
  });

  it.each([
    'developer',
    'design',
    'productivity',
    'data',
    'media',
    'game',
    'education',
    'social',
    'finance',
    'other',
  ])('accepts category %s', (category) => {
    expect(parseMiniAppMetadata({ ...VALID, category }).ok).toBe(true);
  });

  describe('permissions.node', () => {
    it('accepts a full declaration', () => {
      const r = parseMiniAppMetadata({
        ...VALID,
        permissions: { node: { enabled: true, max_memory_mb: 128, timeout_ms: 5000 } },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result.permissions.node).toEqual({
          enabled: true,
          max_memory_mb: 128,
          timeout_ms: 5000,
        });
      }
    });

    it('rejects a non-object node group', () => {
      expect(parseMiniAppMetadata({ ...VALID, permissions: { node: 64 } }).ok).toBe(false);
    });

    it('rejects a non-boolean enabled', () => {
      expect(
        parseMiniAppMetadata({ ...VALID, permissions: { node: { enabled: 'yes' } } }).ok,
      ).toBe(false);
    });

    // Bounds are policy, not schema trivia: below 16MB a worker can't even boot
    // its own runtime, above 512MB the "sandbox" stops being one.
    it.each([15, 513])('rejects max_memory_mb = %d (out of [16, 512])', (mb) => {
      expect(
        parseMiniAppMetadata({ ...VALID, permissions: { node: { max_memory_mb: mb } } }).ok,
      ).toBe(false);
    });

    it.each([16, 512])('accepts max_memory_mb = %d (boundary)', (mb) => {
      expect(
        parseMiniAppMetadata({ ...VALID, permissions: { node: { max_memory_mb: mb } } }).ok,
      ).toBe(true);
    });

    it.each([999, 60001])('rejects timeout_ms = %d (out of [1000, 60000])', (ms) => {
      expect(
        parseMiniAppMetadata({ ...VALID, permissions: { node: { timeout_ms: ms } } }).ok,
      ).toBe(false);
    });
  });

  it('rejects non-integer version', () => {
    expect(parseMiniAppMetadata({ ...VALID, version: 1.5 }).ok).toBe(false);
  });

  it('rejects non-SemVer min_host_version', () => {
    expect(parseMiniAppMetadata({ ...VALID, min_host_version: '0.3' }).ok).toBe(false);
  });

  it('rejects tags > 8', () => {
    const tags = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(parseMiniAppMetadata({ ...VALID, tags }).ok).toBe(false);
  });

  it('rejects hard-coded fs path without template prefix', () => {
    expect(
      parseMiniAppMetadata({
        ...VALID,
        permissions: { fs: { read: ['~/Desktop/**'] } },
      }).ok,
    ).toBe(false);
  });

  it('accepts all 4 permission classes', () => {
    const r = parseMiniAppMetadata({
      ...VALID,
      permissions: {
        fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] },
        shell: { allow: ['git'] },
        net: { allow: ['api.github.com'] },
        ai: {
          enabled: true,
          allowed_models: ['primary'],
          max_tokens_per_request: 8192,
          rate_limit_per_minute: 30,
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.permissions.shell?.allow).toEqual(['git']);
      expect(r.result.permissions.net?.allow).toEqual(['api.github.com']);
      expect(r.result.permissions.ai?.rate_limit_per_minute).toBe(30);
    }
  });

  describe('Phase 3 worker kind (PRD v0.4 §B.4)', () => {
    it('defaults kind to undefined (Phase 0/1/2 iframe)', () => {
      const r = parseMiniAppMetadata(VALID);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.kind).toBeUndefined();
    });

    it('accepts kind="worker" + worker_kind="git-graph"', () => {
      const r = parseMiniAppMetadata({
        ...VALID,
        kind: 'worker',
        worker_kind: 'git-graph',
        permissions: { fs: { read: ['{workspace}/**'] } },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result.kind).toBe('worker');
        expect(r.result.worker_kind).toBe('git-graph');
      }
    });

    it('rejects worker_kind without kind="worker"', () => {
      const r = parseMiniAppMetadata({ ...VALID, worker_kind: 'git-graph' });
      expect(r.ok).toBe(false);
    });

    it('rejects unknown kind values', () => {
      const r = parseMiniAppMetadata({ ...VALID, kind: 'warp' });
      expect(r.ok).toBe(false);
    });

    it('rejects non-kebab-case worker_kind', () => {
      const r = parseMiniAppMetadata({ ...VALID, kind: 'worker', worker_kind: 'Git_Graph' });
      expect(r.ok).toBe(false);
    });
  });
});

// The inline fixtures above pin the parser's rules; this pins that every
// MiniApp actually shipped in `bundled-miniapps/` satisfies them. A typo in a
// bundled `meta.json` is otherwise invisible until the Marketplace tries to
// render that card and silently drops it.
describe('bundled-miniapps/*/meta.json', () => {
  const bundledRoot = fileURLToPath(new URL('../../../bundled-miniapps', import.meta.url));

  const appDirs = readdirSync(bundledRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_e2e-fixtures')
    .map((e) => e.name);

  it.each(appDirs)('%s parses and its id matches its directory name', (dirName) => {
    const raw = JSON.parse(readFileSync(join(bundledRoot, dirName, 'meta.json'), 'utf8'));
    const r = parseMiniAppMetadata(raw);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
    if (r.ok) expect(r.result.id).toBe(dirName);
  });
});