// Guard: every committed MiniApp behaviour layer must parse.
//
// ## What this guards
//
// `ui.js` / `main.js` are inlined into the iframe and executed. A file that
// does not parse is discarded whole by the browser: no listener binds, no
// render runs, and the page keeps its static markup. There is no error state —
// just a plausible page that does nothing.
//
// ## Why this is separate from the inline-safety guard next door
//
// `miniapp-script-inline-safety.test.ts` catches the failure mode where a
// literal closing script tag truncates the file during inlining. This catches
// the file being already broken. They are independent: a perfectly valid
// script can be truncated by the host, and a truncated script can parse fine on
// its own.
//
// ## Why committed files are the thing to guard
//
// The observed failure was in a *generated, not-yet-committed* MiniApp, which
// no committed test can see — `scripts/validate-miniapp.mts` covers that gap.
// This guard covers the other side: once broken code *is* committed, whether
// because a generator wrote it or a human pasted it, it must fail here rather
// than in front of a user. The skill's exemplars are swept too, since a broken
// exemplar is copied verbatim into every generated MiniApp.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MINIAPP_SCRIPT_NAMES, findScriptSyntaxError } from './script-syntax';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');
const SKILL_ROOT = join(process.cwd(), 'bundled-skills', 'miniapp-creator');

function miniappScripts(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if ((MINIAPP_SCRIPT_NAMES as readonly string[]).includes(e.name)) {
        out.push({ path: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out.map(s => ({ ...s, path: s.path.replace(process.cwd() + '\\', '') }));
}

const scripts = [
  ...miniappScripts(BUNDLED_ROOT),
  ...miniappScripts(join(SKILL_ROOT, 'references', 'examples')),
  ...miniappScripts(join(SKILL_ROOT, 'source')),
];

describe('committed MiniApp behaviour layers parse', () => {
  it('finds the scripts it is supposed to guard (guards against a vacuous sweep)', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('$path is syntactically valid', ({ path, text }) => {
    const error = findScriptSyntaxError(text, path);
    expect(
      error,
      error
        ? `${error.message}\n  line ${error.line}: ${error.excerpt}`
        : '',
    ).toBeNull();
  });

  it('detects the defects it claims to detect', () => {
    // The real generated failure: a single-quoted literal spanning newlines.
    const broken = [
      "(function () {",
      "  var d = document.createElement('div');",
      "  d.innerHTML = '",
      '    <span>oops</span>',
      "  ';",
      '})();',
    ].join('\n');
    const found = findScriptSyntaxError(broken, 'broken.js');
    expect(found).not.toBeNull();
    expect(found!.line).toBe(3);
    expect(found!.excerpt).toContain("d.innerHTML = '");

    // Same mistake with double quotes.
    expect(findScriptSyntaxError('var s = "\nfoo";', 'x.js')).not.toBeNull();
    // And the ordinary ones a model emits.
    expect(findScriptSyntaxError('function ( {', 'x.js')).not.toBeNull();
    expect(findScriptSyntaxError('const a = ;', 'x.js')).not.toBeNull();
    expect(findScriptSyntaxError('if (true) {', 'x.js')).not.toBeNull();

    // A file that is merely *large* or uses modern syntax must not be flagged.
    expect(findScriptSyntaxError('const f = async () => 1; f();', 'ok.js')).toBeNull();
    expect(
      findScriptSyntaxError('const o = { ...a, b: 1, c: 2 };', 'ok.js'),
    ).toBeNull();
    // Return outside a function is legal in this host's classic scripts.
    expect(findScriptSyntaxError('return 1;', 'ok.js')).toBeNull();
    // An empty file is valid (markup-only MiniApp).
    expect(findScriptSyntaxError('', 'ok.js')).toBeNull();
  });
});
