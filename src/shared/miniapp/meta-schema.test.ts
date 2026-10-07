import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  it('parses storage.defaults so the declared fallback actually reaches dispatch', () => {
    // 这条存在的理由：storage 块此前**整个**被 parseMiniAppMetadata 静默丢掉，
    // 于是 5 个 bundled meta 与 SKILL.md 都在教作者一个不存在的配置。schema
    // 层先钉住"声明能进到 meta 里"，dispatch 层再钉住"get 真的回落"。
    const r = parseMiniAppMetadata({
      ...VALID,
      storage: { defaults: { items: [], theme: 'dark' } },
    });
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
    if (r.ok) {
      expect(r.result.storage?.defaults).toEqual({ items: [], theme: 'dark' });
    }
  });

  it('keeps a storage block with no defaults, without inventing a file name', () => {
    // 5 个 bundled meta 都写 {file, defaults}。file 是**不兑现**的字段（宿主恒定
    // 写 <appdata>/storage.json），所以它不该出现在类型里 —— 放进类型只会让
    // "schema 认得"和"运行时有用"脱钩。这里钉住 defaults 缺省时不报错、也不
    // 凭空造出 file。
    const r = parseMiniAppMetadata({ ...VALID, storage: {} });
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
    if (r.ok) {
      expect(r.result.storage).toEqual({});
    }
  });

  it('rejects a malformed storage block instead of silently treating it as absent', () => {
    // meta.json 是作者完全可控的输入。形状写错却静默当"没声明"，症状和作者
    // 忘了写 storage 一模一样 —— 这是最难查的那一类。
    for (const bad of ['storage.json', 42, [], null]) {
      expect(
        parseMiniAppMetadata({ ...VALID, storage: bad }).ok,
        `storage: ${JSON.stringify(bad)} should be rejected`,
      ).toBe(false);
    }
    for (const bad of ['x', 7, []]) {
      expect(
        parseMiniAppMetadata({ ...VALID, storage: { defaults: bad } }).ok,
        `storage.defaults: ${JSON.stringify(bad)} should be rejected`,
      ).toBe(false);
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

  describe('i18n', () => {
    it('is absent by default', () => {
      const r = parseMiniAppMetadata(VALID);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.i18n).toBeUndefined();
    });

    it('accepts per-locale name/description/tags', () => {
      const r = parseMiniAppMetadata({
        ...VALID,
        i18n: {
          locales: {
            'zh-CN': { name: '五子棋', description: '经典棋盘', tags: ['游戏'] },
            'en-US': { name: 'Gomoku', description: 'Classic board', tags: ['game'] },
          },
        },
      });
      expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
      if (r.ok) {
        expect(r.result.i18n?.locales['en-US']).toEqual({
          name: 'Gomoku',
          description: 'Classic board',
          tags: ['game'],
        });
      }
    });

    it('accepts a locale that overrides only one field', () => {
      const r = parseMiniAppMetadata({
        ...VALID,
        i18n: { locales: { 'zh-TW': { name: '五子棋' } } },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.i18n?.locales['zh-TW']).toEqual({ name: '五子棋' });
    });

    it('rejects a non-object i18n', () => {
      expect(parseMiniAppMetadata({ ...VALID, i18n: 'zh-CN' }).ok).toBe(false);
    });

    it('rejects a non-object locales map', () => {
      expect(parseMiniAppMetadata({ ...VALID, i18n: { locales: [] } }).ok).toBe(false);
    });

    it('rejects a non-object locale entry', () => {
      expect(
        parseMiniAppMetadata({ ...VALID, i18n: { locales: { 'en-US': 'Gomoku' } } }).ok,
      ).toBe(false);
    });

    // A translation must not be a way around the limits the top level enforces
    // — it is the same string, rendered in a different place.
    it('rejects a translated description > 200 chars', () => {
      expect(
        parseMiniAppMetadata({
          ...VALID,
          i18n: { locales: { 'en-US': { description: 'x'.repeat(201) } } },
        }).ok,
      ).toBe(false);
    });

    it('rejects more than 8 translated tags', () => {
      const tags = Array.from({ length: 9 }, (_, i) => `t${i}`);
      expect(
        parseMiniAppMetadata({ ...VALID, i18n: { locales: { 'en-US': { tags } } } }).ok,
      ).toBe(false);
    });
  });

  it('rejects non-integer version', () => {    expect(parseMiniAppMetadata({ ...VALID, version: 1.5 }).ok).toBe(false);
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

/**
 * The MiniApp authoring skill ships a template that the agent copies from.
 * Nothing in the install path runs `parseMiniAppMetadata`, so a template that
 * drifts out of schema does not fail loudly — it installs, and the declared
 * permissions then silently fall back to defaults (see
 * `miniapp-worker/node-limits.ts::readDeclaredNode`, which is fail-soft).
 * Guard the template here, where drift is actually visible.
 */
describe('miniapp-creator skill template', () => {
  const templateRoot = fileURLToPath(
    new URL('../../../bundled-skills/miniapp-creator/source/miniapp-template', import.meta.url),
  );

  it('parses against the current schema', () => {
    const raw = JSON.parse(readFileSync(join(templateRoot, 'meta.json'), 'utf8'));
    const r = parseMiniAppMetadata(raw);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
  });

  it('ships every file the 4-file contract requires', () => {
    // storage.json is legitimately empty in the template — a fresh MiniApp has
    // no KV state yet. Every other file must carry real content.
    for (const f of ['meta.json', 'source/index.html', 'source/ui.js', 'source/style.css']) {
      expect(readFileSync(join(templateRoot, f), 'utf8').length, `${f} is missing or empty`).toBeGreaterThan(0);
    }
    expect(existsSync(join(templateRoot, 'storage.json')), 'storage.json is missing').toBe(true);
  });

  });

/**
 * Reference exemplars are what an AI copies `meta.json` shape from, so a schema
 * violation or a wrong key here propagates into every generated MiniApp. They
 * are references rather than shipped apps: nothing in the install path parses
 * them, and they legitimately have no `storage.json`, so neither the bundled-app
 * sweep nor the template's 4-file check covers them.
 */
describe('miniapp-creator reference exemplars', () => {
  const exemplarBase = fileURLToPath(
    new URL('../../../bundled-skills/miniapp-creator/references/examples', import.meta.url),
  );

  // Discovered from disk rather than listed. These are reference apps, not
  // shipped ones, so nothing in the install path parses them — an exemplar that
  // drifts out of schema just keeps being copied into generated MiniApps. A
  // hardcoded list meant every exemplar added after this test was written was
  // unguarded until someone remembered to extend it.
  const exemplarDirs = readdirSync(exemplarBase, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('finds reference exemplars', () => {
    expect(exemplarDirs.length).toBeGreaterThan(0);
  });

  it.each(exemplarDirs)('%s parses and grants no ambient permission', (dirName) => {
    const raw = JSON.parse(readFileSync(join(exemplarBase, dirName, 'meta.json'), 'utf8'));
    const r = parseMiniAppMetadata(raw);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
    if (!r.ok) return;
    expect(r.result.id).toBe(dirName);

    // Assert on the *parsed* permissions, not the raw file. This is the whole
    // point: the parser drops permission keys it does not recognise, so an
    // exemplar can carry a plausible-looking `shell: { exec: [] }` that never
    // survives parsing — and an AI copying it learns a key that silently grants
    // nothing. Checking the raw JSON would have passed that forever.
    expect(r.result.permissions).toMatchObject({
      fs: { read: [], write: [] },
      shell: { allow: [] },
      net: { allow: [] },
    });
  });
});
/**
 * `meta.json::appearance` — a MiniApp declaring that its palette is the product
 * rather than a deviation from the host theme.
 *
 * Every rule below exists because the alternative is silent. An unknown palette
 * key would be ignored by the host and the author would believe they had
 * overridden a colour that never changed. A `var(--hamuna-*)` inside a palette
 * would make "bespoke" mean "a slightly more indirect way to depend on the host",
 * which is the opposite of what the field promises.
 */
describe('appearance (bespoke palette)', () => {
  const base = {
    id: 'x',
    name: 'X',
    description: 'x',
    icon: 'i',
    category: 'other',
    version: 1,
    min_host_version: '0.3.0',
    permissions: {},
  };

  const parse = (appearance: unknown) => parseMiniAppMetadata({ ...base, appearance });

  it('is absent by default, so every existing meta.json behaves identically', () => {
    const r = parseMiniAppMetadata(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.appearance).toBeUndefined();
  });

  it('accepts a palette keyed by contract slot names', () => {
    const r = parse({
      mode: 'bespoke',
      palette: { 'bg-primary': '#101014', accent: '#d9a0b4' },
      palette_dark: { 'bg-primary': '#faf6ef' },
    });
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
    if (r.ok) {
      expect(r.result.appearance).toEqual({
        mode: 'bespoke',
        palette: { 'bg-primary': '#101014', accent: '#d9a0b4' },
        palette_dark: { 'bg-primary': '#faf6ef' },
      });
    }
  });

  it('rejects a slot the contract does not define', () => {
    const r = parse({ mode: 'bespoke', palette: { 'bg-primry': '#101014' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('is not a MiniApp appearance token');
  });

  it('rejects a palette that defers to the host, which would make bespoke a no-op', () => {
    const r = parse({ mode: 'bespoke', palette: { accent: 'var(--hamuna-accent)' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('literal CSS color');
  });

  it('requires a palette for bespoke rather than accepting a silent no-op', () => {
    const r = parse({ mode: 'bespoke' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('requires a palette');
  });

  it('rejects a palette declared without bespoke mode', () => {
    const r = parse({ mode: 'host', palette: { accent: '#8a3d58' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("requires mode 'bespoke'");
  });

  it('rejects an unknown mode outright', () => {
    const r = parse({ mode: 'custom' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("must be 'host' | 'bespoke'");
  });
});
