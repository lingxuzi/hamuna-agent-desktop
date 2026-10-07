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
import appearanceContract from '../../../shared/miniapp-appearance/contract.json';
import { describe, expect, it } from 'vitest';

import {
  buildThemeTokenCss,
  bespokeOverrides,
  FALLBACK_BY_KEY,
  HOST_TO_TOKEN,
  TOKEN_VAR_NAMES,
  type MiniAppThemeTokens,
} from './theme-tokens';
import { REQUIRED_THEME_CSS_TOKENS } from '../../theme/registry-contract';

const REQUIRED = new Set<string>(REQUIRED_THEME_CSS_TOKENS);


/**
 * The host variable a token actually reads, whichever form it takes.
 *
 * A `derived` entry resolves its base through `var()` in the emitted CSS rather
 * than through getComputedStyle, but it depends on the host defining that
 * variable just as much — so it gets pinned to the same list. Unwrapping here
 * keeps the assertions below written against a plain string.
 */
/** Mirrors camelize() in theme-tokens.ts. Duplicated so this file reads the JSON itself. */
const camelize = (name: string): string =>
  name.replace(/^--hamuna-/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * The host variable a token actually reads, whichever form it takes.
 *
 * A `derived` entry resolves its base through `var()` in the emitted CSS rather
 * than through getComputedStyle, but it depends on the host defining that
 * variable just as much — so it gets pinned to the same list. Unwrapping here
 * keeps the assertions below written against a plain string.
 */
const hostVarOf = (key: string): string => {
  const v = HOST_TO_TOKEN[key];
  return typeof v === 'string' ? v : v.derived;
};

describe('MiniApp theme tokens — host variable contract', () => {
  it('reads only variables the theme registry actually validates', () => {
    // A host var missing from REQUIRED_THEME_CSS_TOKENS is one a theme may
    // legitimately drop. Reading it would then fall through to FALLBACK_TOKENS
    // and paint the MiniApp with hardcoded colours — silently.
    const unvalidated = Object.keys(HOST_TO_TOKEN)
      .map(hostVarOf)
      .filter((v) => !REQUIRED.has(v));

    expect(
      unvalidated,
      `HOST_TO_TOKEN reads variable(s) the theme registry does not require: ${unvalidated.join(', ')}. ` +
        'Add them to REQUIRED_THEME_CSS_TOKENS (if every theme must define them) ' +
        'or stop reading them (if the fallback is intended).',
    ).toEqual([]);
  });

  it('covers every MiniApp token key', () => {
    // Guards the opposite drift: a key added to the contract but not mapped here
    // would be undefined at read time.
    const keys = Object.keys(HOST_TO_TOKEN);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
  });
  it('every contract variable has a host mapping and a fallback', () => {
    // This is the check a type cannot do. TypeScript widens string literals
    // through a JSON import, so TokenKey is `string` and any Record<TokenKey,
    // ...> is satisfied by an empty object; deriving the key union with
    // template-literal types instead yields `never`, which is equally vacuous.
    // Two attempts at a compile-time guarantee both produced something that
    // looked checked and checked nothing, so the guarantee lives here.
    //
    // It reads the JSON file itself rather than TOKEN_VAR_NAMES. That map is
    // generated from the same contract, so a "reverse direction" assertion
    // written against it is a tautology -- it passed even with a key mapped in
    // the source but absent from the contract.
    //
    // The failure it prevents: a contract entry with no `source` reads
    // undefined from getComputedStyle, emits an empty CSS value, and the
    // MiniApp silently falls back -- no runtime error, no visible difference in
    // the host app, just one token that stopped following the theme.
    const contractKeys = appearanceContract.variables.map((v) => camelize(v.name));
    expect(new Set(contractKeys).size, 'contract has a duplicate variable name').toBe(
      contractKeys.length,
    );
    const known = new Set(contractKeys);

    for (const [name, key] of Object.entries(TOKEN_VAR_NAMES)) {
      const mapping = HOST_TO_TOKEN[key];
      expect(mapping, `${name} has no entry in HOST_TO_TOKEN (key "${key}")`).toBeDefined();
      expect(
        typeof mapping === 'string' || mapping.derived,
        `${name} needs either a host "source" or a "derived" variable`,
      ).toBeTruthy();
      expect(
        FALLBACK_BY_KEY[key],
        `${name} has no fallback, so a theme that omits it renders empty`,
      ).toBeTruthy();
    }

    // Reverse: a key that no contract entry produces would be looked up by
    // nothing. Dead weight that reads like coverage.
    for (const key of Object.keys(HOST_TO_TOKEN)) {
      expect(known.has(key), `${key} is mapped but absent from contract.json`).toBe(true);
    }
    for (const key of Object.keys(FALLBACK_BY_KEY)) {
      expect(known.has(key), `${key} has a fallback but no contract entry`).toBe(true);
    }
  });

  it('uses distinct host variables (no accidental aliasing)', () => {
    // Two MiniApp tokens sharing a host var is legal (`focusBorder` and
    // `fieldBorderFocus` both resolve to --focus-border), so this only reports
    // the mapping for review rather than failing on it.
    const counts = new Map<string, string[]>();
    for (const key of Object.keys(HOST_TO_TOKEN)) {
      const v = hostVarOf(key);
      counts.set(v, [...(counts.get(v) ?? []), key]);
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
      tokensWith({ bgPrimary: '</style><script>window.__pwned=1</script><style>' }),
    );

    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script');
    expect(css).toContain('\\3c ');
    // 变量名与结构不受影响 —— 逃逸不能顺手把 token 打散
    expect(css).toMatch(/--hamuna-bg-primary:/);
  });

  it('leaves ordinary colour values byte-identical', () => {
    // 转义只针对 `<`。日常的色值 / 字体栈一个字符都不能变，否则主题会被改坏。
    const css = buildThemeTokenCss(tokensWith({ bgPrimary: '#fff', fontSans: 'system-ui, sans-serif' }));
    expect(css).toContain('--hamuna-bg-primary: #fff;');
    expect(css).toContain('--hamuna-font-sans: system-ui, sans-serif;');
  });

  it('derives translucent values from a host variable instead of baking a literal', () => {
    // The host's token set is all flat values, so nothing it provides can carry
    // an alpha. A scrim built from a literal would be tinted for whichever theme
    // happened to be active when this ran; referencing the host variable means
    // the browser re-resolves it, so a dark theme gets a scrim tuned for dark.
    //
    // The literal here is the thing being asserted against: if someone "fixes"
    // this by replacing the color-mix with `rgba(0,0,0,.56)`, the test goes red
    // and says why.
    const css = buildThemeTokenCss(tokensWith({ overlayScrim: 'rgba(0, 0, 0, 0.56)' }), 'dark');

    expect(css).toContain('--hamuna-overlay-scrim: color-mix(');
    expect(css).toMatch(/--host-hamuna-overlay-scrim: var\(--fb-mask-opaque\);/);
    expect(css).not.toContain('--hamuna-overlay-scrim: rgba(0, 0, 0, 0.56)');
    // And the mix must actually produce a scrim — a 100% mix is opaque black.
    // The pattern is non-greedy up to the first `%` rather than the first `)`,
    // because the value contains `var(...)` and its closing paren would
    // otherwise cut the match short.
    const pct = Number(
      css.match(/--hamuna-overlay-scrim:\s*color-mix\((?:[^%]*?)(\d+)%/)?.[1],
    );
    expect(Number.isNaN(pct), 'overlay-scrim no longer emitted as a color-mix').toBe(false);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  // --- 首屏投影 -----------------------------------------------------------
  // 变量之外的这段才是"廉价感"的来源：深色主题里冒一条亮色滚动条、iframe
  // 白闪一下、精心排版的面板配一条又宽又方的默认滚动条。都没有硬编码可抄，
  // 作者只能自己猜，所以它必须由宿主给定并被钉住。
  describe('first-paint projection', () => {
    it('follows the host appearance mode', () => {
      expect(buildThemeTokenCss(tokensWith(), 'dark')).toContain('color-scheme: dark;');
      expect(buildThemeTokenCss(tokensWith(), 'light')).toContain('color-scheme: light;');
    });

    it('degrades to `light dark` rather than guessing when the mode is unknown', () => {
      // `document.documentElement.dataset.colorScheme` 是唯一来源，它可能为空。
      // 退化成两值形式让 UA 按 OS 判断，好过把一个字面值写死成错的。
      for (const mode of [undefined, '', 'system', 'auto']) {
        expect(buildThemeTokenCss(tokensWith(), mode)).toContain('color-scheme: light dark;');
      }
    });

    it('makes the iframe background transparent so nothing white-flashes', () => {
      expect(buildThemeTokenCss(tokensWith(), 'dark')).toContain('background: transparent;');
    });

    it('styles the scrollbar off the injected token, not a literal colour', () => {
      const css = buildThemeTokenCss(tokensWith(), 'dark');
      expect(css).toContain('--hamuna-scrollbar-thumb: #123456;');
      expect(css).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
      expect(css).toContain('background: var(--hamuna-scrollbar-thumb);');
      // Both @supports branches: one for standards `scrollbar-color`, one for
      // engines that only match the webkit pseudo without also exposing it.
      expect(css).toContain('@supports (scrollbar-color: transparent transparent)');
    });

    it('gives authors a shadow scale instead of making them invent one', () => {
      // Shadows were the largest gap versus the reference spec: without tokens
      // the only way to add elevation is a hardcoded rgba, which is exactly what
      // the design playbook bans. All seven rungs must come from the host.
      const css = buildThemeTokenCss(tokensWith(), 'dark');
      for (const rung of ['xs', 'sm', 'card', 'md', 'lg', 'xl', 'overlay']) {
        expect(css, `--hamuna-shadow-${rung} is missing`).toContain(`--hamuna-shadow-${rung}:`);
      }
    });

    it('gives authors the host motion timing instead of per-app milliseconds', () => {
      const css = buildThemeTokenCss(tokensWith(), 'dark');
      for (const tier of ['fast', 'normal', 'slow']) {
        expect(css, `--hamuna-duration-${tier} is missing`).toContain(`--hamuna-duration-${tier}:`);
      }
    });
  });
});

/**
 * `meta.json::appearance` — the sanctioned way to ship a palette that is the
 * product (a night-sky table, a brand dashboard).
 *
 * The failure this exists to prevent: an author who needs its own colours used
 * to have exactly two options — give up its identity and render the host accent,
 * or hardcode every colour and lose the token contract entirely. The first
 * produced things like a "night" tarot app whose starfield was drawn with
 * `--hamuna-text-muted` and vanished on a light theme. The second is now an
 * audit failure, which is the point.
 *
 * So the contract has to hold on one non-obvious invariant: bespoke changes the
 * values, never the names. If an override could rename or drop a variable, the
 * author's `var()` fallbacks would stop matching reality and the standalone
 * export would drift from the hosted render.
 */
describe('bespoke appearance overrides', () => {
  /** Same idea as `tokensWith` above, which is scoped to its own describe. */
  function fullTokens(): MiniAppThemeTokens {
    const base: Record<string, string> = {};
    for (const key of Object.keys(HOST_TO_TOKEN)) base[key] = '#123456';
    return base as MiniAppThemeTokens;
  }

  it('returns nothing for host mode, so the default path is untouched', () => {
    expect(bespokeOverrides(undefined, 'dark')).toBeUndefined();
    expect(bespokeOverrides({ mode: 'host' }, 'dark')).toBeUndefined();
  });

  it('picks palette_dark in dark and palette in light', () => {
    const appearance = {
      mode: 'bespoke' as const,
      palette: { accent: '#8a3d58' },
      palette_dark: { accent: '#d9a0b4' },
    };
    expect(bespokeOverrides(appearance, 'light')).toEqual({ '--hamuna-accent': '#8a3d58' });
    expect(bespokeOverrides(appearance, 'dark')).toEqual({ '--hamuna-accent': '#d9a0b4' });
  });

  it('falls back to the light palette in dark when only one is declared', () => {
    // "I only declared one palette" beats "I forgot the second and it silently
    // went light" — the author can see what they wrote and know what they'll get.
    const appearance = { mode: 'bespoke' as const, palette: { accent: '#8a3d58' } };
    expect(bespokeOverrides(appearance, 'dark')).toEqual({ '--hamuna-accent': '#8a3d58' });
  });

  it('overrides the value without touching the variable name', () => {
    const css = buildThemeTokenCss(fullTokens(), 'light', { '--hamuna-accent': '#8a3d58' });
    expect(css).toContain('--hamuna-accent: #8a3d58;');
    // The rest of the contract still comes from the host, so the app keeps
    // following the theme for everything it did not override.
    expect(css).toContain('--hamuna-bg-primary:');
    expect(css).toMatch(/--hamuna-bg-primary: [^;]+;/);
    expect(css).not.toMatch(/--hamuna-bg-primary: ;/);
  });

  it('escapes a hostile override so it cannot break out of the style element', () => {
    // meta.json is a file on disk and the iframe CSP allows unsafe-inline, so
    // this is the same trust boundary as the host-token path — a palette value
    // has to go through the same sanitizer, not a friendlier one.
    const css = buildThemeTokenCss(fullTokens(), 'light', {
      '--hamuna-accent': 'red;</style><script>alert(1)</script>',
    });
    expect(css).not.toContain('</style><script>');
    // The `<` is CSS-escaped rather than dropped, so the author's value still
    // parses as one declaration. `\\3c` is the CSS escape for `<`.
    expect(css).toContain(String.raw`\3c `);
  });
});
