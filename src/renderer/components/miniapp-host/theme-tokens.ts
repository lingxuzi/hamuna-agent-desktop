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
 * 抽出当前 document `:root` 上 Theme 相关 CSS 变量。
 * PRD v0.3 §5.4 列出最小子集：bg / bg-elevated / text / text-muted / accent /
 * border / radius-sm / radius-md / shadow-sm / font-sans。
 */
export interface MiniAppThemeTokens {
  bg: string;
  bgElevated: string;
  bgInset: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  accent: string;
  accentText: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  error: string;
  success: string;
  warning: string;
  info: string;
  bgButton: string;
  bgInput: string;
  hoverBg: string;
  focusBorder: string;
  bgSurface: string;
  radiusSm: string;
  radiusLg: string;
  radiusMd: string;
  fontSans: string;
  fontMono: string;

  /**
   * 阴影梯度（6 档）与滚动条、动效时长。
   *
   * 这三组是 UI 质感的地基，补它们的原因不是"功能缺失"而是**没有它们作者
   * 只能硬编码**：`box-shadow` / 滚动条 / 时长没有 token 时，唯一写法就是
   * 写死 rgba 和毫秒数 —— 那正是 playbook 反 AI 味清单要禁的、也是
   * CLAUDE.md「前端硬编码颜色破坏设计系统一致性」要禁的。换主题时它们不会
   * 跟着变，于是每个 MiniApp 的阴影都是从零猜的，观感必然廉价。
   *
   * 时长档位同理：作者各写各的 `200ms`/`300ms`，一个产品里就没有统一节奏。
   */
  shadowXs: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowXl: string;
  shadowOverlay: string;
  scrollbarThumb: string;
  durationFast: string;
  durationNormal: string;
  durationSlow: string;
}

const TOKEN_VAR_NAMES = {
  bg: '--hamuna-bg-primary',
  bgElevated: '--hamuna-bg-elevated',
  bgInset: '--hamuna-bg-inset',
  text: '--hamuna-text-primary',
  textSecondary: '--hamuna-text-secondary',
  textMuted: '--hamuna-text-muted',
  textOnPrimary: '--hamuna-text-on-primary',
  accent: '--hamuna-accent',
  accentText: '--hamuna-accent-text',
  border: '--hamuna-border',
  borderSubtle: '--hamuna-border-subtle',
  borderStrong: '--hamuna-border-primary',
  error: '--hamuna-error',
  success: '--hamuna-success',
  warning: '--hamuna-warning',
  info: '--hamuna-info',
  bgButton: '--hamuna-bg-button',
  bgInput: '--hamuna-bg-input',
  hoverBg: '--hamuna-bg-button-hover',
  focusBorder: '--hamuna-focus-border',
  bgSurface: '--hamuna-bg-surface',
  radiusSm: '--hamuna-radius-sm',
  radiusLg: '--hamuna-radius-lg',
  radiusMd: '--hamuna-radius-md',
  fontSans: '--hamuna-font-sans',
  fontMono: '--hamuna-font-mono',
  shadowXs: '--hamuna-shadow-xs',
  shadowSm: '--hamuna-shadow-sm',
  shadowMd: '--hamuna-shadow-md',
  shadowLg: '--hamuna-shadow-lg',
  shadowXl: '--hamuna-shadow-xl',
  shadowOverlay: '--hamuna-shadow-overlay',
  scrollbarThumb: '--hamuna-scrollbar-thumb',
  durationFast: '--hamuna-duration-fast',
  durationNormal: '--hamuna-duration-normal',
  durationSlow: '--hamuna-duration-slow',
} as const;

/**
 * Host CSS variable each MiniApp token reads from.
 *
 * These names are the host theme's, not the MiniApp-facing ones. Verified
 * against `theme/themes/*.css` — an earlier version guessed `--bg-primary` /
 * `--bg-elevated` / `--border-color`, none of which exist, so every one of
 * those lookups silently returned empty and the iframe fell through to
 * FALLBACK_TOKENS. The host spells surfaces `--paper*`, borders `--line*`.
 *
 * Exported so a test can assert every name here is one the theme registry
 * actually validates — the failure this map invites is a typo'd or renamed
 * variable, which TypeScript cannot catch and which surfaces only as the
 * MiniApp silently rendering hardcoded fallback colours.
 */
export const HOST_TO_TOKEN: Record<keyof MiniAppThemeTokens, string> = {
  bg: '--paper',
  bgElevated: '--paper-elevated',
  bgInset: '--paper-inset',
  text: '--ink',
  textSecondary: '--ink-secondary',
  textMuted: '--ink-muted',
  textOnPrimary: '--button-primary-text',
  accent: '--accent-primary',
  accentText: '--button-primary-text',
  border: '--line',
  borderSubtle: '--line-subtle',
  borderStrong: '--line-strong',
  error: '--error',
  success: '--success',
  warning: '--warning',
  info: '--info',
  bgButton: '--button-secondary-bg',
  bgInput: '--code-bg',
  hoverBg: '--hover-bg',
  focusBorder: '--focus-border',
  bgSurface: '--paper',
  radiusSm: '--theme-radius-sm',
  radiusLg: '--theme-radius-lg',
  radiusMd: '--theme-radius-md',
  fontSans: '--font-body',
  fontMono: '--font-code',
  // 阴影梯度直接取主题自己的 --theme-shadow-*：它已经是 6 档有序梯度，
  // 另有 `--fb-shadow-*`（浮层专用）。不要自己编阴影值。
  shadowXs: '--theme-shadow-xs',
  shadowSm: '--theme-shadow-sm',
  shadowMd: '--theme-shadow-md',
  shadowLg: '--theme-shadow-lg',
  shadowXl: '--theme-shadow-xl',
  shadowOverlay: '--fb-shadow-strong',
  scrollbarThumb: '--fb-scroll-thumb',
  // 宿主已有节奏 token。author 各写各的毫秒数时，产品里就没有统一速度。
  durationFast: '--duration-fast',
  durationNormal: '--duration-normal',
  durationSlow: '--duration-slow',
};

const FALLBACK_TOKENS: MiniAppThemeTokens = {
  bg: '#ffffff',
  bgElevated: '#f5f5f5',
  bgInset: '#ececec',
  text: '#1c1612',
  textSecondary: '#544b42',
  textMuted: '#6f6156',
  textOnPrimary: '#ffffff',
  accent: '#7b8f6b',
  accentText: '#ffffff',
  border: 'rgba(0, 0, 0, 0.12)',
  borderSubtle: 'rgba(0, 0, 0, 0.08)',
  borderStrong: 'rgba(0, 0, 0, 0.20)',
  error: '#b3261e',
  success: '#146c2e',
  warning: '#8a5a00',
  info: '#0b5cad',
  bgButton: '#f0ece6',
  bgInput: '#ffffff',
  hoverBg: 'rgba(0, 0, 0, 0.06)',
  focusBorder: '#7b8f6b',
  bgSurface: '#ffffff',
  radiusSm: '6px',
  radiusMd: '10px',
  radiusLg: '14px',
  fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  // 与 theme-tokens.host-contract.test.ts 对齐：这些值必须和 FALLBACK_TOKENS
  // 之外的浅色主题观感一致，否则"宿主缺 token"和"无宿主"会长得不一样。
  // 阴影用 rgba(逗号) 而非 rgb(空格/斜杠)：前者是导出成独立页面时
  // 兼容性最广的写法。
  shadowXs: '0 1px 2px rgba(28, 22, 18, 0.05)',
  shadowSm: '0 2px 8px rgba(28, 22, 18, 0.08)',
  shadowMd: '0 8px 24px rgba(28, 22, 18, 0.12)',
  shadowLg: '0 16px 40px rgba(28, 22, 18, 0.16)',
  shadowXl: '0 24px 48px rgba(28, 22, 18, 0.20)',
  shadowOverlay: '0 32px 64px -12px rgba(28, 22, 18, 0.25)',
  scrollbarThumb: 'rgba(166, 154, 144, 0.50)',
  durationFast: '150ms',
  durationNormal: '200ms',
  durationSlow: '300ms',
};

/**
 * 从宿主 document 读 CSS 变量值；缺则 fallback。
 */
export function readThemeTokens(): MiniAppThemeTokens {
  if (typeof document === 'undefined') return FALLBACK_TOKENS;
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const out = { ...FALLBACK_TOKENS };
  (Object.keys(HOST_TO_TOKEN) as Array<keyof MiniAppThemeTokens>).forEach((key) => {
    const hostVar = HOST_TO_TOKEN[key];
    const v = style.getPropertyValue(hostVar).trim();
    if (v) (out[key] as string) = v;
  });
  return out;
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
  (Object.keys(TOKEN_VAR_NAMES) as Array<keyof MiniAppThemeTokens>).forEach((key) => {
    const varName = TOKEN_VAR_NAMES[key];
    lines.push(`  ${varName}: ${cssSafeValue(tokens[key])};`);
  });
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
    '  background: var(--hamuna-text-muted);',
    '}',
    '@supports (scrollbar-color: transparent transparent) {',
    '  * { scrollbar-width: thin; scrollbar-color: var(--hamuna-scrollbar-thumb) transparent; }',
    '}',
  );
  return lines.join('\n');
}
