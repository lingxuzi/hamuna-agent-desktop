/**
 * The static half of "a generated MiniApp must actually work".
 *
 * `bundled-apps-permissions.test.ts` already guards *declared* methods used
 * without permission, but it enumerates calls by longest-matching the names in
 * `listAppMethods()` — so a hallucinated name (`app.fs.readFileSync`,
 * `app.http.get`) matches nothing, is never probed, and passes. That is the
 * exact shape of the bug this file pins: code that parses, renders, clears every
 * visual probe, and throws only when a button is pressed.
 *
 * The second half is `scripts/shoot-miniapp.mjs`, which exercises the same
 * surface in a real browser. Both are needed; neither subsumes the other.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { APP_METHODS } from './app-protocol';
import { findAppMethodErrors, formatAppMethodError } from './method-contract';
import { MINIAPP_SCRIPT_NAMES } from './script-syntax';

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not locate repo root from ' + HERE);
}

const REPO = repoRoot();

/** Every expression the checker flagged, in a comparable form. */
function flagged(source: string): string[] {
  return findAppMethodErrors(source, 'probe.js').map((e) => e.expression);
}

/**
 * Real behaviour layers are IIFE-wrapped, and they must be: `await` is not
 * valid at the top level of a classic script, so a bare snippet would fail to
 * parse and be reported as a syntax error instead of reaching the checker.
 */
function behaviourLayer(body: string): string {
  return `(async function () {\n${body}\n})();`;
}

describe('findAppMethodErrors — accepts what the host implements', () => {
  it('accepts every dispatch method the protocol declares', () => {
    const calls = Object.entries(APP_METHODS)
      .flatMap(([group, names]) => names.map((n) => `app.${group}.${n}()`))
      .join('\n');
    expect(flagged(calls)).toEqual([]);
  });

  it('accepts the facade value keys, including the locale picker call', () => {
    const source = [
      'const id = app.appId;',
      'const loc = app.locale;',
      'const dir = app.workspaceDir;',
      "const label = app.t('hello', 'Hello');",
      "const off = app.onAppearanceChange(() => {});",
    ].join('\n');
    expect(flagged(source)).toEqual([]);
  });

  it('accepts app.call, the escape hatch for custom backends', () => {
    expect(flagged("await app.call('git.status', {});")).toEqual([]);
  });

  it('accepts the computed form of a legal call', () => {
    expect(flagged(behaviourLayer("await app['fs']['readFile']('{appdata}/a.txt');"))).toEqual([]);
  });

  it('accepts a locally-named variable that merely contains `app`', () => {
    expect(flagged('const myapp = {}; myapp.whatever.nope();')).toEqual([]);
  });

  it('accepts a dynamic key it cannot resolve, rather than guessing', () => {
    // `app[userPicked]()` is legitimate code; only a resolved name is checkable.
    expect(flagged('app[window.which]()')).toEqual([]);
  });
});

describe('findAppMethodErrors — flags what the host cannot serve', () => {
  it('flags a misspelled method and names the real one', () => {
    const errors = findAppMethodErrors(
      behaviourLayer("await app.fs.readFileSync('{appdata}/a');"),
      'ui.js',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expression).toBe('app.fs.readFileSync');
    expect(errors[0]!.message).toMatch(/does not exist/);
    expect(errors[0]!.message).toMatch(/readFile/);
    expect(errors[0]!.line).toBe(2);
  });

  it('flags a hallucinated group', () => {
    const errors = findAppMethodErrors(behaviourLayer("await app.http.get('/x');"), 'ui.js');
    expect(errors.map((e) => e.expression)).toEqual(['app.http.get']);
    expect(errors[0]!.message).toMatch(/not a capability group/);
  });

  it('flags a value key used as a callable', () => {
    const errors = findAppMethodErrors(behaviourLayer('app.locale("zh-CN");'), 'ui.js');
    expect(errors.map((e) => e.expression)).toEqual(['app.locale']);
  });

  it('flags a three-segment call', () => {
    const errors = findAppMethodErrors(behaviourLayer('app.fs.read.extra();'), 'ui.js');
    expect(errors.map((e) => e.expression)).toEqual(['app.fs.read.extra']);
  });

  it('flags the computed form too — a rename must not hide it', () => {
    expect(flagged(behaviourLayer("await app['fs']['readFileSync']('x');")))
      .toEqual(['app.fs.readFileSync']);
  });

  it('reports the offending source line so the fix is one edit', () => {
    const source = ['(async function () {', "  const x = await app.fs.nope('p');", '})();'].join('\n');
    const errors = findAppMethodErrors(source, 'ui.js');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
    expect(errors[0]!.excerpt).toContain('app.fs.nope');
    // The formatter is what an agent reads; it must carry position + fix.
    const rendered = formatAppMethodError(errors[0]!);
    expect(rendered).toContain('ui.js:2');
    expect(rendered).toContain('app.fs.nope');
    expect(rendered).toContain('UNKNOWN_METHOD');
  });

  it('flags every bad call, not just the first', () => {
    expect(flagged(['app.http.get(1)', 'app.fs.readFileSync(2)', 'app.storage.get(3)'].join('\n')))
      .toEqual(['app.http.get', 'app.fs.readFileSync']);
  });

  it('stays quiet on unparseable source — the syntax gate owns that', () => {
    // Reporting invented call sites for source that cannot be parsed would bury
    // the one error that is actually actionable.
    expect(findAppMethodErrors("const x = '", 'ui.js')).toEqual([]);
  });
});

describe('every committed MiniApp resolves its app.* calls', () => {
  /** Behaviour layers committed to the repo, mirroring the syntax gate's roots. */
  function committedScripts(): Array<{ file: string; source: string }> {
    const roots = [
      join(REPO, 'bundled-miniapps'),
      join(REPO, 'bundled-skills', 'miniapp-creator', 'source'),
      join(REPO, 'bundled-skills', 'miniapp-creator', 'references', 'examples'),
    ];
    const out: Array<{ file: string; source: string }> = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (MINIAPP_SCRIPT_NAMES.includes(entry as never)) {
          out.push({ file: full.slice(REPO.length + 1), source: readFileSync(full, 'utf8') });
        }
      }
    };
    for (const r of roots) walk(r);
    return out;
  }

  it('is not vacuous: it inspected real scripts that really call app.*', () => {
    const scripts = committedScripts();
    expect(scripts.length).toBeGreaterThan(3);
    const withCalls = scripts.filter((s) => /\bapp\s*[.[]/.test(s.source));
    // If this were 0 the sweep below would pass by finding nothing, which is the
    // failure mode this whole file exists to prevent.
    expect(withCalls.length, 'no committed behaviour layer references app.*').toBeGreaterThan(0);
  });

  it('reports no unresolvable call', () => {
    const offenders = committedScripts().flatMap((s) =>
      findAppMethodErrors(s.source, s.file).map((e) => `${e.file}:${e.line ?? '?'} ${e.expression}`),
    );
    expect(offenders, `unresolvable app.* calls:\n${offenders.join('\n')}`).toEqual([]);
  });
});