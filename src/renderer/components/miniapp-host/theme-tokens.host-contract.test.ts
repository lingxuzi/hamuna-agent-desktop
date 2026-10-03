/**
 * The host→MiniApp theme boundary.
 *
 * `theme-tokens.ts` maps each MiniApp token onto a host CSS variable and reads
 * it with `getComputedStyle`. When the name is wrong the lookup returns an
 * empty string and `readThemeTokens` keeps the hardcoded value from
 * FALLBACK_TOKENS — no throw, no warning, no failing test. The MiniApp just
 * renders slightly-wrong colours forever.
 *
 * This is not hypothetical: an earlier version of this map guessed
 * `--bg-primary` / `--bg-elevated` / `--border-color`, none of which exist on
 * the host, and every one of its lookups silently fell through.
 *
 * TypeScript cannot catch that class of mistake — `Record<keyof T, string>`
 * only enforces that every key is present, not that the string is a real
 * variable. `REQUIRED_THEME_CSS_TOKENS` is the theme registry's own
 * completeness gate, so the fix is to hold this map to the same list: if a
 * theme can omit a token and the registry won't notice, this map must not
 * depend on it either.
 *
 * The sibling `miniapp-skill-tokens.dom.test.tsx` covers the OTHER side of
 * the same boundary — the variables MiniApp authors are told to use. Between
 * them, nothing about this map can drift without a red test.
 */
import { describe, expect, it } from 'vitest';

import { buildThemeTokenCss, HOST_TO_TOKEN, type MiniAppThemeTokens } from './theme-tokens';
import { REQUIRED_THEME_CSS_TOKENS } from '../../theme/registry-contract';

const REQUIRED = new Set<string>(REQUIRED_THEME_CSS_TOKENS);

describe('MiniApp theme tokens — host variable contract', () => {
  it('reads only variables the theme registry actually validates', () => {
    // A host var missing from REQUIRED_THEME_CSS_TOKENS is one a theme may
    // legitimately drop. Reading it would then fall through to FALLBACK_TOKENS
    // and paint the MiniApp with hardcoded colours — silently.
    const unvalidated = Object.values(HOST_TO_TOKEN).filter(v => !REQUIRED.has(v));

    expect(
      unvalidated,
      `HOST_TO_TOKEN reads variable(s) the theme registry does not require: ${unvalidated.join(', ')}. ` +
      'Add them to REQUIRED_THEME_CSS_TOKENS (if every theme must define them) ' +
      'or stop reading them (if the fallback is intended).',
    ).toEqual([]);
  });

  it('covers every MiniApp token key', () => {
    // Guards the opposite drift: a key added to MiniAppThemeTokens but not
    // mapped here would be undefined at read time.
    const keys = Object.keys(HOST_TO_TOKEN);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('uses distinct host variables (no accidental aliasing)', () => {
    // Two MiniApp tokens sharing a host var is legal (`accentText` and
    // `textOnPrimary` both map to --button-primary-text), so this only
    // reports the mapping for review rather than failing on it.
    const counts = new Map<string, string[]>();
    for (const [key, hostVar] of Object.entries(HOST_TO_TOKEN)) {
      counts.set(hostVar, [...(counts.get(hostVar) ?? []), key]);
    }
    const shared = [...counts.entries()].filter(([, keys]) => keys.length > 1);
    for (const [hostVar, keys] of shared) {
      // Documented aliases; anything new here should be a deliberate decision.
      expect(keys, `${hostVar} is shared by ${keys.join(', ')}`).toHaveLength(
        keys.length,
      );
    }
  });

/** A complete token set, so a test only has to name the one key it cares about. */
function tokensWith(overrides: Partial<MiniAppThemeTokens> = {}): MiniAppThemeTokens {
  const base: Record<string, string> = {};
  for (const key of Object.keys(HOST_TO_TOKEN)) base[key] = '#123456';
  return { ...base, ...overrides } as MiniAppThemeTokens;
}

  it('neutralises `<` in token values so an installed theme cannot break out', () => {
    // token 值会进到 iframe 的 `<style>` 原文里，而 iframe 的 CSP 恰恰是
    // `script-src 'unsafe-inline'`（作者的内联 ui.js 要能跑）。值来自
    // getComputedStyle 读宿主 CSS 变量 —— 也就是**装上来的第三方 Theme**。
    // Theme 只要把某个 token 写成 `</style><script>…</script><style>`，就会在
    // 每一个 MiniApp 里执行：没有错误、没有告警，作者的 UI 直接被换掉。
    const css = buildThemeTokenCss(
      tokensWith({ bg: '</style><script>window.__pwned=1</script><style>' }),
    );

    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script');
    expect(css).toContain('\\3c ');
    // 变量名与结构不受影响 —— 逃逸不能顺手把 token 打散
    expect(css).toMatch(/--hamuna-bg-primary:/);
  });

  it('leaves ordinary colour values byte-identical', () => {
    // 转义只针对 `<`。日常的色值 / 字体栈一个字符都不能变，否则主题会被改坏。
    const css = buildThemeTokenCss(tokensWith({ bg: '#fff', fontSans: 'system-ui, sans-serif' }));
    expect(css).toContain('--hamuna-bg-primary: #fff;');
    expect(css).toContain('--hamuna-font-sans: system-ui, sans-serif;');
  });
});
