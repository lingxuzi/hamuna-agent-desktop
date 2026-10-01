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
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  radiusSm: string;
  radiusMd: string;
  fontSans: string;
}

const TOKEN_VAR_NAMES = {
  bg: '--hamuna-bg',
  bgElevated: '--hamuna-bg-elevated',
  text: '--hamuna-text',
  textMuted: '--hamuna-text-muted',
  accent: '--hamuna-accent',
  border: '--hamuna-border',
  radiusSm: '--hamuna-radius-sm',
  radiusMd: '--hamuna-radius-md',
  fontSans: '--hamuna-font-sans',
} as const;

const HOST_TO_TOKEN: Record<keyof MiniAppThemeTokens, string> = {
  bg: '--bg-primary',
  bgElevated: '--bg-elevated',
  text: '--ink',
  textMuted: '--ink-muted',
  accent: '--accent-primary',
  border: '--border-color',
  radiusSm: '--theme-radius-sm',
  radiusMd: '--theme-radius-md',
  fontSans: '--font-body',
};

const FALLBACK_TOKENS: MiniAppThemeTokens = {
  bg: '#ffffff',
  bgElevated: '#f5f5f5',
  text: '#1c1612',
  textMuted: '#6f6156',
  accent: '#7b8f6b',
  border: '#e0e0e0',
  radiusSm: '6px',
  radiusMd: '10px',
  fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
 * 注入内容：hamuna-* alias → host token fallback chain。
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