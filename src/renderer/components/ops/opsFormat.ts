// 运营视图的数值格式化。
//
// 只做「数据 → 可读字符串」，不做文案：标签一律由调用方从 i18n 取。
// 所有函数收 `locale`，不读全局状态 —— 语言切换后不必重挂整个面板。

import type { SocialPlatformId } from '../../../shared/socialPlatforms';
import type { OpsContentForm } from '../../../shared/ops';
import type { OpsMetric } from '../../../shared/ops-derive';

/** 一个指标拆成「数值 + 单位」两段：Hero 里数值走衬线大字，单位小一号跟在后面。 */
export interface OpsMetricParts {
  text: string;
  unit: string;
}

/**
 * 大数紧凑排。
 *
 * 直接用 `Intl.NumberFormat` 的 compact：zh-CN 给 `18.2万`、en-US 给 `182K`，
 * 正是界面要的形态。自己写一套 `万/亿` 换算会在第二语言上立刻失效。
 */
export function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** 千分位，用于榜单里的精确播放量。 */
export function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * 坐标轴刻度：过万才缩写，否则千分位。
 *
 * compact 在 10000 以下也会带一位小数（6423 → `6423.5`），刻度上既不准也占位。
 */
export function formatTick(value: number, locale: string): string {
  return value >= 10000
    ? formatCompact(value, locale)
    : formatInteger(Math.round(value), locale);
}

export function formatMetric(metric: OpsMetric, locale: string): OpsMetricParts {
  if (metric.value === null) return { text: '—', unit: '' };
  switch (metric.unit) {
    case 'percent':
      return { text: String(Math.round(metric.value * 100)), unit: '%' };
    case 'compact': {
      // 拆开整数部分与紧凑单位：`18.2万` → { text: '18.2', unit: '万' }。
      const parts = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).formatToParts(metric.value);
      let text = '';
      let unit = '';
      for (const part of parts) {
        if (part.type === 'compact') unit += part.value;
        else if (part.type !== 'literal' || text) text += part.value;
      }
      return { text: text.trim(), unit };
    }
    case 'count':
    default:
      return { text: String(metric.value), unit: '' };
  }
}

/** 热度：没有可比参考时是 `—` 而不是 0。 */
export function formatHotness(value: number | null, locale: string): string {
  return value === null ? '—' : formatCompact(value, locale);
}

/** 平台显示名。复用设置页已有的平台表，不另开一份平台文案。 */
export function platformLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  platform: SocialPlatformId | null | undefined,
): string {
  if (!platform) return '';
  return t(`accounts.platform.${platform}`, { ns: 'settings' });
}

/**
 * 成品形态的短标签。列表行上的徽章用——要能一眼认出「这轮做的是什么」，
 * 但不能长到把标题挤没。
 */
export function formLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  form: OpsContentForm | null | undefined,
): string {
  if (!form) return '';
  return t(`ops.form.kind.${form}`);
}

/** `2026-11-14` 或 ISO → `11/14`。 */
export function shortDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(d);
}

/** `2026-11-14` 或 ISO → 星期几（短）。 */
export function weekdayShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
}

/** `2026-11-14T20:00` → `20:00`。排期列表的副文本用。 */
export function clockTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
