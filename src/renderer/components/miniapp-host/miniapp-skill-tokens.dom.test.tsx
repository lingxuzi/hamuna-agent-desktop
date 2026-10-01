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
  ].map((rel) => ({ path: rel, text: readFileSync(join(SKILL_ROOT, rel), 'utf8') }));
}

describe('miniapp-creator skill CSS tokens', () => {
  const injected = injectedTokenNames();

  it('reads a non-empty token list from the host builder', () => {
    // Guards the helper above: if buildThemeTokenCss changes shape, this fails
    // loudly instead of silently passing zero assertions.
    expect(injected.size).toBeGreaterThan(0);
  });

  it.each(skillFiles())('$path only references real host tokens', ({ text }) => {
    // Collect every `var(--x)` the skill tells the model to write. Lines marked
    // `disabled-example:` exist to show a failure mode, so they are exempt.
    const referenced = text
      .split('\n')
      .filter((line) => !line.includes('disabled-example:'))
      .flatMap((line) => [...line.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    for (const name of referenced) {
      expect(
        injected.has(name),
        `${name} is not a host-injected token. Known: ${[...injected].sort().join(', ')}`,
      ).toBe(true);
    }
  });
});
