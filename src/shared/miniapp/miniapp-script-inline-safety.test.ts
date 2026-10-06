// Guard: a MiniApp's `ui.js` must not contain a literal `</script>`.
//
// ## What this guards
//
// `inline_miniapp_siblings` (Rust, `src-tauri/src/commands.rs`) rewrites
// `<script src="ui.js"></script>` into `<script>…the file's contents…</script>`
// and hands the result to the iframe as srcdoc. That means `ui.js` is parsed in
// HTML text context, and the HTML tokenizer closes a `<script>` element at the
// **first** `</script` it sees — regardless of whether that sequence appears in
// a string, a regex, or a comment.
//
// ## Why it matters more than it looks
//
// This was not hypothetical. The design-reference exemplar carried a comment
// explaining the classic-script rule, and that comment contained the closing tag
// it was describing. The file was truncated at that point and everything after it
// rendered as visible page text: the app looked like it had a giant block of
// source code under it, and the behaviour layer silently stopped running.
//
// Nothing in the stack reports it. `meta.json` parses, the entry reference
// resolves, the iframe mounts, there is no console error — the failure looks
// exactly like a styling bug, which is why it survived a full round of design
// work and was only caught by screenshotting the thing.
//
// ## Why a test and not a lint rule
//
// The pattern is not a syntax error, not an ESLint rule anyone maintains, and not
// detectable from the file alone — `</script>` is perfectly legal JavaScript. It
// is only illegal *because of what the host does to the file afterwards*. So the
// invariant has to live next to the description of that transform, and it has to
// cover the authored-by-AI files, which are exactly the ones where an
// explanatory comment about the host is likely.
//
// The same check runs over the skill's exemplars: they are the files an AI
// copies, so a trap sitting in one propagates into every generated MiniApp.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');
const SKILL_ROOT = join(process.cwd(), 'bundled-skills', 'miniapp-creator');

/**
 * Does this source contain a sequence that would close a `<script>` element?
 *
 * Case-insensitive and tolerant of whitespace inside the tag, because the HTML
 * tokenizer is too: `</ script>` and `</SCRIPT>` both end the element. A naive
 * `/<\/script>/` check would let the same bug back in through a different
 * spelling, and the failure is expensive enough to be worth closing properly.
 */
function closesScriptElement(src: string): boolean {
  return /<\s*\/\s*script/i.test(src);
}

function miniappScripts(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // The template's source is copied verbatim into generated MiniApps, so it
        // has exactly the same exposure as a shipped app.
        walk(p);
      } else if (e.name === 'ui.js' || e.name === 'main.js') {
        out.push({ path: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

const scripts = [
  ...miniappScripts(BUNDLED_ROOT).map((s) => ({ ...s, path: s.path.replace(process.cwd() + '\\', '') })),
  ...miniappScripts(join(SKILL_ROOT, 'references', 'examples')).map((s) => ({
    ...s,
    path: s.path.replace(process.cwd() + '\\', ''),
  })),
  ...miniappScripts(join(SKILL_ROOT, 'source')).map((s) => ({
    ...s,
    path: s.path.replace(process.cwd() + '\\', ''),
  })),
];

describe('MiniApp scripts survive HTML inlining', () => {
  it('finds the scripts it is supposed to guard (guards against a vacuous sweep)', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('$path contains no literal </script', ({ text }) => {
    expect(
      closesScriptElement(text),
      'this file is pasted into HTML by inline_miniapp_siblings; a literal ' +
        'closing tag inside it — even in a comment — truncates the script at ' +
        'that point and renders the remainder as visible page text. Describe the ' +
        'tag without writing it (e.g. "<script src=...>" / "closing tag").',
    ).toBe(false);
  });

  it('detects the trap it claims to detect', () => {
    // Real files being clean proves nothing unless the predicate can fail.
    expect(closesScriptElement('// see </script>')).toBe(true);
    expect(closesScriptElement('// see </SCRIPT>')).toBe(true);
    expect(closesScriptElement('// see </ script>')).toBe(true);
    expect(closesScriptElement('// a <script src="ui.js"> tag')).toBe(false);
    expect(closesScriptElement('const s = "</scr" + "ipt>";')).toBe(false);
  });
});