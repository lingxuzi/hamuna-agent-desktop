/**
 * MiniApp iframe CSS Token 注入（PRD v0.4 §B.1 #6 + PRD v0.3 §5.4）。
 *
 * 把当前 Theme 的视觉 token（`--ink` / `--accent-primary` / `--theme-radius-*` /
 * `--font-body` 等）注入到 MiniApp iframe 内 `:root`，让 MiniApp UI 复用宿主
 * 视觉系统。MiniApp 内禁止硬编码颜色（CLAUDE.md §Pit-of-Success "前端硬
 * 编码颜色破坏设计系统一致性"）。
 *
 * Theme 切换实时同步：MiniAppRunner mount 时读一次 + Theme change listener
 * 重写 `:root` CSS 变量 + 发 postMessage `app.event: theme.change`（v2）。
 */

import type { CSSProperties } from 'react';

/**
 * 抽出当前 document `:root` 上 Theme 相关 CSS 变量。
 * PRD v0.3 §5.4 列出最小子集：bg / bg-elevated / text / text-muted / accent /
 * border / radius-sm / radius-md / shadow-sm / font-sans。
 *
 * ponytail: 不抽全部 theme token（Theme 切换时全量重写 iframe :root 即可）；
 * 这里抽的子集只为 MiniApp 内 CSS 提供 fallback。
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
} as const;

/**
 * Host CSS variable each MiniApp token reads from.
 *
 * These names are the host theme's, not the MiniApp-facing ones. Verified
 * against `theme/themes/*.css` — an earlier version guessed `--bg-primary` /
 * `--bg-elevated` / `--border-color`, none of which exist, so every one of
 * those lookups silently returned empty and the iframe fell through to
 * FALLBACK_TOKENS. The host spells surfaces `--paper*`, borders `--line*`.
 */
const HOST_TO_TOKEN: Record<keyof MiniAppThemeTokens, string> = {
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
 * 生成一段 `<style>` 文本，注入到 iframe :root 上。
 */
export function buildThemeTokenCss(tokens: MiniAppThemeTokens): string {
  const lines = [':root {'];
  (Object.keys(TOKEN_VAR_NAMES) as Array<keyof MiniAppThemeTokens>).forEach((key) => {
    const varName = TOKEN_VAR_NAMES[key];
    lines.push(`  ${varName}: ${tokens[key]};`);
  });
  lines.push('}');
  return lines.join('\n');
}

/**
 * 直接返回 React `style={{ '--hamuna-bg': tokens.bg }}` 用的 inline style map
 * —— 给 MiniApp iframe srcDoc `<style>` 用。
 */
export function themeTokenInlineStyle(tokens: MiniAppThemeTokens): CSSProperties {
  const out: Record<string, string> = {};
  (Object.keys(TOKEN_VAR_NAMES) as Array<keyof MiniAppThemeTokens>).forEach((key) => {
    out[TOKEN_VAR_NAMES[key]] = tokens[key];
  });
  return out as CSSProperties;
}