/**
 * MiniApp lifecycle, stage 1 of 2: GENERATE and REGISTER.
 *
 * The full path a MiniApp walks is:
 *   generate  — the agent writes 5 files and POSTs /api/miniapp/create
 *   register  — /api/miniapp/install, or the create above writing straight to
 *               ~/.hamuna/miniapps/<appId>/
 *   launch    — see miniapp-lifecycle.dom.test.tsx (renderer side)
 *
 * Two contracts are pinned here, both invisible from any single file:
 *
 *  1. `appId` reaches the filesystem as a path segment
 *     (`~/.hamuna/miniapps/<appId>/`). Six routes validated it, each with its
 *     own inlined copy of the regex, and they had drifted — diff and uninstall
 *     accepted a leading/trailing dash that create/install rejected, so `-foo`
 *     was a legal id to uninstall but never a legal id to create. One
 *     validator now, asserted to be the only one.
 *
 *  2. The generator (the miniapp-creator skill template) and the create
 *     route must agree on the file set. The route hard-requires 5 specific
 *     keys; the template ships those 5 files. If either side gains or renames
 *     one, every generated MiniApp fails with "source is missing required
 *     file" — a 400 the agent cannot self-diagnose.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isKebabAppId } from '../miniapp-app-id';

const SRC = join(process.cwd(), 'src');
const SKILL_TEMPLATE = join(
  process.cwd(),
  'bundled-skills',
  'miniapp-creator',
  'source',
  'miniapp-template',
);

function read(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf8');
}

describe('MiniApp generate + register: appId contract', () => {
  it.each([
    'git-graph',
    'icon-generator',
    'a',
    'a1',
    'my-app-2',
    'a'.repeat(64),
  ])('accepts %j', (id) => {
    expect(isKebabAppId(id)).toBe(true);
  });

  // appId becomes `~/.hamuna/miniapps/<appId>/`, so anything that can steer
  // that path out of the miniapps dir, or that Rust would treat as a distinct
  // key than the one create wrote, has to be rejected.
  it.each([
    ['empty string', ''],
    ['uppercase', 'GitGraph'],
    ['underscore', 'git_graph'],
    ['dot', 'git.graph'],
    ['path separator', 'a/b'],
    ['backslash', 'a\\b'],
    ['parent traversal', '..'],
    ['traversal with valid prefix', 'a/../..'],
    ['absolute path', '/etc/passwd'],
    ['null byte', 'a\0b'],
    ['newline', 'a\nb'],
    ['space', 'my app'],
    ['leading dash', '-foo'],
    ['trailing dash', 'foo-'],
    ['only dashes', '-'],
    ['65 chars (one over)', 'a'.repeat(65)],
  ])('rejects %s', (_label, id) => {
    expect(isKebabAppId(id)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]], [true]])(
    'rejects non-string %j',
    (value) => {
      expect(isKebabAppId(value)).toBe(false);
    },
  );

  it('is the only appId validator left in the sidecar', () => {
    // The drift this guards against came from copies, not from the regex
    // being wrong. A new inline copy is the regression.
    const source = read('server/index.ts');
    expect(
      source.match(/\^\[a-z0-9-\]\{1,64\}\$/g),
      'index.ts re-inlined the appId regex. Route it through isKebabAppId ' +
        'from server/miniapp-app-id.ts so the six call sites cannot drift again.',
    ).toBeNull();
    expect(
      source.match(/isKebabAppId\(/g)?.length ?? 0).toBe(7); // one per route
    // The seventh is the `window.app.*` capability dispatch route
    // (`/api/miniapp/app/:method`): it takes an appId from the MiniApp iframe
    // and resolves it to `~/.hamuna/miniapps/<appId>`, so it must go through
    // the same validator rather than trusting the caller.
  });
});

describe('MiniApp generate: skill template satisfies the create route', () => {
  // Mirrors REQUIRED_FILES in the /api/miniapp/create forward-port.
  const REQUIRED_FILES = [
    'meta.json',
    'source/index.html',
    'source/ui.js',
    'source/style.css',
    'storage.json',
  ] as const;

  // `readdirSync(recursive)` also yields the `source` directory itself, which
  // is not one of the five keys the route reads.
  function templateFiles(): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else out.add(rel);
      }
    };
    walk(SKILL_TEMPLATE, '');
    return out;
  }

  it('the template ships every file the create route requires', () => {
    const missing = REQUIRED_FILES.filter(f => !templateFiles().has(f));
    expect(
      missing,
      `miniapp-creator template is missing ${missing.join(', ')}. The agent ` +
        'copies this template, so /api/miniapp/create 400s on every generated ' +
        'MiniApp with "source is missing required file".',
    ).toEqual([]);
  });

  it('the template ships nothing the create route would reject', () => {
    // The route only reads the 5 required keys, so an extra file is dead
    // weight the agent pays to write and Rust silently discards.
    const extra = [...templateFiles()].filter(p => !REQUIRED_FILES.includes(p as never));
    expect(extra, `Template has files the create route ignores: ${extra.join(', ')}`).toEqual([]);
  });

  it("the template's meta.json id is itself a legal appId", () => {
    const meta = JSON.parse(readFileSync(join(SKILL_TEMPLATE, 'meta.json'), 'utf8')) as {
      id?: unknown;
    };
    expect(
      isKebabAppId(meta.id),
      `template meta.json id ${JSON.stringify(meta.id)} would be rejected by ` +
        'isKebabAppId, so the agent can copy the template verbatim and still 400.',
    ).toBe(true);
  });
});

/**
 * A MiniApp entry is mounted through iframe `srcdoc`, a single document whose
 * base URL is the PARENT's. So `href="style.css"` resolves against the app
 * origin (`http://localhost:5173/style.css`), not the MiniApp's directory, and
 * never loads — the app renders unstyled and inert. The source endpoint now
 * inlines those siblings (read_miniapp_source_blocking), which only works if
 * the referenced filenames actually match the files the 5-file contract ships.
 *
 * This is the contract that broke: the entry HTML shipped by every bundled
 * MiniApp referenced two files, and nothing anywhere served them.
 */
describe('MiniApp launch: entry HTML references resolvable siblings', () => {
  const ROOT = join(process.cwd(), 'bundled-miniapps');

  function bundledApps(): Array<{ appId: string; dir: string }> {
    return readdirSync(ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_'))
      .map(e => ({ appId: e.name, dir: join(ROOT, e.name, 'source') }));
  }

  function referencedPaths(html: string): string[] {
    const out: string[] = [];
    for (const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)) out.push(m[1]);
    for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) out.push(m[1]);
    return out;
  }

  it('finds the bundled MiniApps to check', () => {
    expect(bundledApps().length).toBeGreaterThan(0);
  });

  it.each(bundledApps().map(a => [a.appId, a.dir] as const))(
    '%s references only files that exist next to its entry HTML',
    (appId, dir) => {
      const entry = join(dir, 'index.html');
      if (!existsSync(entry)) return; // app declares a different entry
      const refs = referencedPaths(readFileSync(entry, 'utf8'));

      const missing = refs.filter(
        r => !/^([a-z]+:)?\/\//i.test(r) && !r.startsWith('/') && !existsSync(join(dir, r)),
      );
      expect(
        missing,
        `${appId}/source/index.html references ${missing.join(', ')}, which the ` +
          '5-file contract does not ship. srcdoc cannot resolve these (wrong base ' +
          'URL), so the MiniApp renders unstyled and inert.',
      ).toEqual([]);
    },
  );
});
