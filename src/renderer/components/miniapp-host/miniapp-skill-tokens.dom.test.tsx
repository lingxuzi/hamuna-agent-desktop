import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildThemeTokenCss, type MiniAppThemeTokens } from './theme-tokens';

/**
 * The miniapp-creator skill teaches the AI which CSS variables to use. Nothing
 * in the render path validates that guidance: a wrong `var()` name resolves to
 * nothing and the iframe silently falls back, so a stale skill produces broken
 * UI with no error anywhere.
 *
 * That has already happened twice — `theme-tokens.ts` itself once guessed
 * `--bg-primary` / `--border-color` (neither exists on the host), and the skill
 * shipped those same invented names. Pin the skill to the real list.
 */
// vitest's `root` is the repo root, so this resolves the same way regardless
// of which project pool loads the file (the dom pool's import.meta.url is not
// a file: URL).
const SKILL_ROOT = join(process.cwd(), 'bundled-skills', 'miniapp-creator');

/** Every `--hamuna-*` variable the host actually injects, read from the source of truth. */
function injectedTokenNames(): Set<string> {
  // A value for every key is all buildThemeTokenCss needs — it iterates the
  // token name map, not the values, so placeholders are fine here.
  const css = buildThemeTokenCss(
    new Proxy({} as MiniAppThemeTokens, { get: () => '' }),
  );
  // buildThemeTokenCss emits one `  --name: value;` line per token.
  return new Set([...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
}

function skillFiles(): { path: string; text: string }[] {
  return [
    'SKILL.md',
    'source/miniapp-template/source/style.css',
    'source/miniapp-template/source/index.html',
    'references/design-playbook.md',
    // The reference exemplar is what an AI copies the visual half of a MiniApp
    // from, so a wrong token name there is at least as damaging as one in the
    // prose — it gets pasted into generated apps verbatim.
    'references/examples/design-reference/source/style.css',
    'references/examples/design-reference/source/index.html',
    'references/examples/design-reference/source/ui.js',
  ].map((rel) => ({ path: rel, text: readFileSync(join(SKILL_ROOT, rel), 'utf8') }));
}

/**
 * Custom properties the skill's own files declare.
 *
 * Both the template and the exemplar alias host tokens once and then speak in
 * semantic names (`--surface`, `--dr-ease`), because a real design system
 * collapses to a few names. Those references are legitimate and must not be
 * reported as unknown — but only when the file actually declares them, so a
 * typo'd property is still caught.
 */
function declaredTokenNames(files: { text: string }[]): Set<string> {
  const names = new Set<string>();
  for (const { text } of files) {
    // CSS declaration: `--foo: ...`. The `var(--foo` form has no colon after
    // the name, so it is not matched here.
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
    // Property set from script: `style.setProperty('--foo', ...)`
    for (const m of text.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) names.add(m[1]);
  }
  return names;
}

describe('miniapp-creator skill CSS tokens', () => {
  const injected = injectedTokenNames();
  const files = skillFiles();
  const declared = declaredTokenNames(files);

  const skillText = () => files.find((f) => f.path === 'SKILL.md')!.text;

  it('reads a non-empty token list from the host builder', () => {
    // Guards the helper above: if buildThemeTokenCss changes shape, this fails
    // loudly instead of silently passing zero assertions.
    expect(injected.size).toBeGreaterThan(0);
  });

  it('finds the reference exemplar the prose points at', () => {
    // The playbook now tells the AI to read this file first. If someone moves
    // or renames it, the instruction silently rots — same failure mode as a
    // stale token name, one level up.
    expect(declared.size).toBeGreaterThan(0);
    expect(
      files.some((f) => f.path.endsWith('design-reference/source/style.css')),
    ).toBe(true);
  });

  it.each(files)('$path only references real host tokens', ({ text }) => {
    // Collect every `var(--x)` the skill tells the model to write. Lines marked
    // `disabled-example:` exist to show a failure mode, so they are exempt.
    const referenced = text
      .split('\n')
      .filter((line) => !line.includes('disabled-example:'))
      .flatMap((line) => [...line.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    for (const name of referenced) {
      expect(
        injected.has(name) || declared.has(name),
        `${name} is neither a host token nor declared by the skill. ` +
          `Host: ${[...injected].sort().join(', ')}`,
      ).toBe(true);
    }
  });

  it('points at the design playbook in the preamble, not after the API dump', () => {
    // The failure this guards is the reason generated MiniApps used to look
    // flat. The model absorbed ~350 lines of API shape before anything told it
    // the design rules existed, so the last concrete artifact it read before
    // writing style.css was an API-usage snippet — which it copied wholesale,
    // visual quality included. v2's miniapp-dev puts this pointer on line 14 for
    // the same reason. Move the pointer back down and the symptom returns with
    // no failing test, no lint hit, and no runtime error.
    const preamble = skillText().split('\n').slice(0, 30).join('\n');
    expect(preamble, 'SKILL.md preamble must name the playbook').toContain(
      'design-playbook.md',
    );
    expect(preamble, 'SKILL.md preamble must name the visual exemplar').toContain(
      'examples/design-reference',
    );
  });

  it('keeps any token count quoted in SKILL.md equal to the real host count', () => {
    // Prose drifts silently — nothing validates it and a wrong count only
    // misleads the model's mental model, since theme-tokens.ts stays the actual
    // source of truth. "26 个" survived a session in which theme-tokens.ts went
    // 26 -> 36, so pin the quoted number to the real list instead of trusting it.
    for (const m of skillText().matchAll(/共\s*(\d+)\s*个/g)) {
      expect(Number(m[1]), `SKILL.md quotes "${m[0]}"`).toBe(injected.size);
    }
  });

  it('offers color-mix whenever it bans hand-written rgba', () => {
    // The playbook bans hard-coded rgba: "MiniApp 内禁止硬编码颜色" is a
    // redline, and the anti-AI-flavor table repeats it. But every host token is a
    // *flat* value — none of the 36 can produce a tint, a translucent border or a
    // colored shadow. So without a sanctioned way to derive them, the ban leaves
    // an author who wants depth with no legal move, and the only thing they can
    // actually write is the banned one. The result is every MiniApp obeying the
    // rule and looking like the same flat grey card grid.
    //
    // color-mix() is the exit: it derives from the tokens themselves, needs no new
    // host variable, and follows the theme for free. v2's tool-type apps lean on it
    // 17-25 times apiece against our 3. If someone tightens the ban again without
    // keeping the alternative, this goes red — the symptom (flat output) has no
    // other detectable signature.
    const playbook = files.find((f) => f.path.endsWith('design-playbook.md'))!.text;
    const bansHardCodedColor =
      /禁止硬编码颜色|硬编码\s*`?rgba|不写硬编码颜色/.test(playbook);
    expect(bansHardCodedColor, 'the playbook no longer bans hard-coded colors; re-check this test').toBe(true);
    expect(playbook, 'banning hard-coded rgba without offering color-mix leaves no legal way to add depth').toContain(
      'color-mix',
    );
  });
});
