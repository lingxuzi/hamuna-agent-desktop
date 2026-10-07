/**
 * MiniApp iframe CSS Token 注入（PRD v0.4 §B.1 #6 + PRD v0.3 §5.4）。
 *
 * 把当前 Theme 的视觉 token（`--ink` / `--accent-primary` / `--theme-radius-*` /
 * `--font-body` / `--theme-shadow-*` / `--duration-*` 等）注入到 MiniApp iframe
 * 内 `:root`，让 MiniApp UI 复用宿主视觉系统。MiniApp 内禁止硬编码颜色
 * （CLAUDE.md §Pit-of-Success "前端硬编码颜色破坏设计系统一致性"）。
 *
 * Theme 切换实时同步：MiniAppRunner mount 时把首屏样式烤进 srcDoc，之后监听
 * `data-theme-id` **和** `data-color-scheme`，重算 CSS 并经 `app.event:
 * theme.change` 推给 iframe，由 appRuntimeScript 改写已注入的 `<style>`。
 *
 * ⚠️ 为什么是"推送"而不是"重烤 srcDoc"：iframe 的 sandbox 是
 * `allow-scripts allow-forms`（没有 `allow-same-origin`），宿主拿不到
 * `contentDocument`，postMessage 是唯一通道；反过来，只要重烤 srcDoc，React
 * 改 `srcDoc` 属性就会重载 iframe —— 用户切一次亮暗，MiniApp 里的状态全丢。
 *
 * ⚠️ 早前的三个坑，都留在这里免得重犯：
 *   - 变量名猜错过一轮（`--bg-primary` / `--border-color` 宿主一个都没有），
 *     每个 `var()` 静默回落，整页掉回 fallback。`theme-tokens.host-contract.test.ts`
 *     把这张表钉在主题注册表的完整性清单上。
 *   - 只监听 `data-theme-id` 意味着**换亮暗不刷新**：`readThemeTokens` 拷的是
 *     计算后的值快照，宿主切到深色时 iframe 还拿着浅色值。`app.appearanceMode`
 *     同样停在挂载时的值，`app.onAppearanceChange` 永远不会响。**observer 的
 *     attributeFilter 里少写 `data-color-scheme` 就会原样退回这个 bug**，而它不会
 *     报错——只是 UI 看起来"没跟着换主题"。
 *   - 这段注释一度描述的是"已经在推送"的行为，而代码只监听 `data-theme-id`。
 *     散文描述了代码没有的行为，是最难查的一类漂移。
 */

/**
 * 宿主注入的 token `<style>` 的 id。
 *
 * 宿主和 appRuntimeScript 必须认同一个字面量：首屏把 CSS 烤进 srcDoc，切亮暗时
 * 改写同一个元素。改这里等于同时改两端 —— 所以它是个导出的常量，不是各自硬编码的
 * 字符串。
 */
export const THEME_TOKEN_STYLE_ID = 'hamuna-theme-tokens';

/**
 * 契约的单一事实源在 `src/shared/miniapp-appearance/contract.json`。
 *
 * 这里曾有三张手写表 —— `MiniAppThemeTokens` 的键、`TOKEN_VAR_NAMES` 的 MiniApp
 * 变量名、`HOST_TO_TOKEN` 的宿主变量名 —— 三张表必须两两对齐，而 TypeScript
 * 无法验证其中任何两张。加一个键要改三处，漏一处的后果是那个 token 的
 * `getComputedStyle` 返回空串，然后静默回落到 FALLBACK：没有报错，没有测试红，
 * MiniApp 只是永远用着一个跟主题无关的硬编码颜色。
 *
 * 现在只剩一处要改（contract.json），而它的正确性由
 * `theme-tokens.host-contract.test.ts` + `verify:miniapp-appearance` 守住。
 */
import appearanceContract from '../../../shared/miniapp-appearance/contract.json';

type ContractVariable = {
  name: string;
  kind: 'theme' | 'system';
  source?: string;
  /** 派生值：宿主给的平值没有 alpha，用 color-mix 现场补上。 */
  derived?: string;
  mix?: number;
};

const CONTRACT_VARIABLES = appearanceContract.variables as ContractVariable[];

/**
 * MiniApp 作者可见的 token 键。
 *
 * 键名由 contract 里的 MiniApp 变量名反推（`--hamuna-radius-md` ->
 * `radiusMd`），所以新增 token 只需要改 JSON。
 */
type TokenKey = string;

function camelize(name: string): string {
  return name
    .replace(/^--hamuna-/, '')
    .replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const TOKENS = CONTRACT_VARIABLES.map((v) => ({
  ...v,
  key: camelize(v.name) as TokenKey,
}));

const BY_KEY = new Map(TOKENS.map((t) => [t.key, t]));

/**
 * MiniApp 变量名 -> MiniAppThemeTokens 的键。由 contract 派生。
 *
 * Exported because the docs point at it as the token list. If you are adding a
 * token, edit `contract.json` — this map is generated from it and a hand-edit
 * here would be silently overwritten by nothing, which is worse.
 */
export const TOKEN_VAR_NAMES: Record<string, string> = Object.fromEntries(
  TOKENS.map((t) => [t.name, t.key]),
);

/**
 * Host CSS variable each MiniApp token reads from.
 *
 * `derived` 的条目不读宿主，而是从另一个宿主变量 color-mix 出 alpha 值 ——
 * 见 `buildThemeTokenCss`。`record` 是为了让类型强制覆盖 contract 里每一个键，
 * 新增变量而忘了给它 source 或 derived 时，这里会红。
 */
export const HOST_TO_TOKEN: Record<TokenKey, string | { derived: string; mix: number }> =
  Object.fromEntries(
    TOKENS.map((t) => [
      t.key,
      t.derived ? { derived: t.derived, mix: t.mix ?? 0.5 } : (t.source as string),
    ]),
  );

/**
 * 抽出当前 document `:root` 上 Theme 相关 CSS 变量。
 *
 * 键的集合来自 contract，所以这个函数的形状完全由 JSON 决定 ——
 * 加一个 token 就是加一条 JSON，不会出现"类型里有、读取时没有"的键。
 */
export type MiniAppThemeTokens = Record<TokenKey, string>;

const FALLBACK_BY_KEY: Record<TokenKey, string> = {
  // 表面与文字。fallback 观感必须与 hamuna-default.css 的浅色一致，否则
  // "宿主缺 token"和"没有宿主"会长得不一样 —— 用户会以为主题坏了。
  bg: '#ffffff',
  bgSurface: '#ffffff',
  bgElevated: '#f5f5f5',
  bgInset: '#ececec',
  textPrimary: '#1c1612',
  textSecondary: '#544b42',
  textMuted: '#6f6156',
  textOnPrimary: '#ffffff',

  // 强调色。注意 fallback 的 accent 是 #7b8f6b（橄榄），白字对比度约 3.1:1，
  // 低于 WCAG AA 的 4.5:1。这不是选色失误而是缺 `--accent-primary-hover`
  // 这类状态的必然结果：作者拿不到 hover 色就只能用 filter 硬凑，越修越糟。
  // 补齐交互态 token 后 fallback 才有意义。见 contract.json 的 note。
  accent: '#7b8f6b',
  accentHover: '#6d8060',
  accentSecondary: '#c26d3a',
  link: '#7b8f6b',

  success: '#146c2e',
  warning: '#8a5a00',
  error: '#b3261e',
  info: '#0b5cad',

  border: 'rgba(0, 0, 0, 0.12)',
  borderSubtle: 'rgba(0, 0, 0, 0.08)',
  borderPrimary: 'rgba(0, 0, 0, 0.20)',
  bgButton: '#f0ece6',
  bgButtonHover: 'rgba(0, 0, 0, 0.06)',
  bgInput: '#ffffff',
  fieldBorder: 'rgba(0, 0, 0, 0.12)',
  fieldBorderFocus: '#7b8f6b',
  focusBorder: '#7b8f6b',
  scrollbarThumb: 'rgba(166, 154, 144, 0.50)',
  scrollbarThumbHover: 'rgba(120, 110, 102, 0.70)',

  // 阴影用 rgba(逗号) 而非 rgb(空格/斜杠)：前者是导出成独立页面时
  // 兼容性最广的写法。
  shadowXs: '0 1px 2px rgba(28, 22, 18, 0.05)',
  shadowSm: '0 2px 8px rgba(28, 22, 18, 0.08)',
  shadowCard: '0 2px 4px rgba(28, 22, 18, 0.06)',
  shadowMd: '0 8px 24px rgba(28, 22, 18, 0.12)',
  shadowLg: '0 16px 40px rgba(28, 22, 18, 0.16)',
  shadowXl: '0 24px 48px rgba(28, 22, 18, 0.20)',
  shadowOverlay: '0 32px 64px -12px rgba(28, 22, 18, 0.25)',
  overlayScrim: 'rgba(28, 22, 18, 0.56)',

  // system 层：与外观无关，切主题时不变。
  radiusSm: '6px',
  radiusMd: '10px',
  radiusLg: '14px',
  fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  durationFast: '150ms',
  durationNormal: '200ms',
  durationSlow: '300ms',
};

/**
 * 从宿主 document 读 CSS 变量值；缺则 fallback。
 *
 * `derived` 的 token 不走这条路 —— 它们要在 CSS 里 color-mix，见
 * `buildThemeTokenCss`。这里给它们一个占位值，保证返回的对象每个键都有值，
 * 免得 `tokens[key]` 是 undefined 时渲染出 `undefined` 字面量。
 */
export function readThemeTokens(): MiniAppThemeTokens {
  const out = { ...FALLBACK_BY_KEY } as Record<string, string>;
  if (typeof document === 'undefined') return out as MiniAppThemeTokens;

  const style = getComputedStyle(document.documentElement);
  for (const [key, source] of Object.entries(HOST_TO_TOKEN)) {
    if (typeof source !== 'string') continue; // derived：留给 CSS 层
    const v = style.getPropertyValue(source).trim();
    if (v) out[key] = v;
  }
  return out as MiniAppThemeTokens;
}

/**
 * CSS 值里不能出现 `<`。
 *
 * 这段 CSS 会被原样塞进 MiniApp iframe 的 `<style>` 元素，而宿主给 iframe 的 CSP
 * 恰恰是 `script-src 'unsafe-inline'`（否则作者的 ui.js 内联脚本跑不了）。值来自
 * `getComputedStyle` 读宿主 CSS 变量 —— 也就是**装上来的第三方 Theme**。一个 Theme
 * 只要把某个 token 写成 `</style><script>…</script><style>`，就会在每一个 MiniApp
 * 里执行。
 *
 * iframe 是 opaque origin，父文档和 cookie 摸不到，但 `allow-forms` 还在，
 * `connect-src` 之外的通道（表单提交、图片、导航）也都还在。
 *
 * 转成 CSS 的 `<` 转义：值本身对作者仍是同一个字符串，标签则永远组不出来。
 */
function cssSafeValue(value: string): string {
  return value.replace(/</g, '\\3c ');
}

/**
 * 生成一段 `<style>` 文本，注入到 iframe :root 上。
 */
/**
 * 生成注入到 MiniApp iframe `<style>` 的完整首屏样式。
 *
 * 除了变量本身，还带三样**作者写不出来也猜不到**的东西：
 *
 * 1. `color-scheme` —— 决定原生控件、滚动条、canvas 的默认外观。不设的话
 *    深色主题里 MiniApp 会冒出一条亮色滚动条，这是"廉价感"最常见的来源。
 *    传了 `appearanceMode` 就跟随宿主；没传退化成 `light dark` 交给 UA 判断，
 *    仍然好过完全不管。
 * 2. `background: transparent` —— 让 iframe 底色透明，透出宿主背景而不是
 *    先白闪一下再被作者的 CSS 盖住。
 * 3. 滚动条 —— 6px 透明轨道 + 药丸滑块 + hover，外加 `scrollbar-color` 与
 *    `selector(::-webkit-scrollbar)` 两组 `@supports` 降级。默认滚动条又宽
 *    又方，在一个精心排版的工具面板里极其扎眼。
 *
 * 变量值仍然逐个过 `cssSafeValue`；这三样都是字面量，不含 token 值。
 */
export function buildThemeTokenCss(
  tokens: MiniAppThemeTokens,
  appearanceMode?: string,
): string {
  const scheme = appearanceMode === 'light' || appearanceMode === 'dark'
    ? appearanceMode
    : 'light dark';
  const lines = [
    ':root {',
    `  color-scheme: ${scheme};`,
    '  background: transparent;',
  ];
  for (const t of TOKENS) {
    const source = HOST_TO_TOKEN[t.key];
    if (typeof source === 'string') {
      lines.push(`  ${t.name}: ${cssSafeValue(tokens[t.key] ?? '')};`);
    } else {
      // Derived value: reference the host variable through a scoped alias and
      // mix it toward transparent to get the alpha the flat tokens cannot carry.
      //
      // Why here and not in readThemeTokens(): the alpha has to be applied to
      // the *live* host value, otherwise switching theme would leave the scrim
      // tinted for the theme that was active at mount. Referencing the host var
      // directly means the browser re-resolves it on every repaint.
      //
      // The alias strips the `--hamuna-` prefix and re-adds a host marker, so
      // `--hamuna-overlay-scrim` becomes `--host-hamuna-overlay-scrim` rather
      // than the doubled `--hamuna-host-hamuna-…` a naive prefix would produce.
      // It is a CSS custom property, not a JS identifier, so kebab-case.
      const alias = t.name.replace(/^--hamuna-/, '--host-hamuna-');
      lines.push(`  ${alias}: var(${source.derived});`);
      lines.push(`  ${t.name}: color-mix(in srgb, var(${alias}) ${Math.round(source.mix * 100)}%, transparent);`);
    }
  }
  lines.push(
    '}',
    '/* Host scrollbar: 6px transparent track, pill thumb. */',
    '*::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }',
    '*::-webkit-scrollbar-track,',
    '*::-webkit-scrollbar-track-piece,',
    '*::-webkit-scrollbar-corner,',
    '*::-webkit-scrollbar-button,',
    '*::-webkit-scrollbar-resizer { background: transparent; }',
    '*::-webkit-scrollbar-thumb {',
    '  border-radius: 999px;',
    '  background: var(--hamuna-scrollbar-thumb);',
    '}',
    '*::-webkit-scrollbar-thumb:hover {',
    '  background: var(--hamuna-scrollbar-thumb-hover);',
    '}',
    '@supports (scrollbar-color: transparent transparent) {',
    '  * { scrollbar-width: thin; scrollbar-color: var(--hamuna-scrollbar-thumb) transparent; }',
    '}',
  );
  return lines.join('\n');
}
