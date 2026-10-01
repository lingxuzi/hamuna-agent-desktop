/**
 * MiniApp locale resolution.
 *
 * `meta.json` declares the default language at the top level and puts
 * translations in `i18n.locales[<locale-id>]`. The top level is both the
 * fallback locale and the "no i18n at all" answer, so every caller gets usable
 * strings even for an app that never declared `i18n`.
 *
 * The chain is deliberately short and total — it always returns something:
 *   exact locale → same language, any region (`zh-Hans-CN` → `zh`)
 *   → `zh-CN` for Chinese variants → `en-US` → `zh-CN` → first declared
 *   locale → top-level.
 *
 * Per-field, not per-locale: an app that translated only `name` still gets its
 * top-level `description` rather than dropping the whole locale.
 */

import type { MiniAppI18n, MiniAppLocaleStrings } from './types';

/** The subset of a MiniApp the resolver needs — a full `MiniAppMetadata` fits. */
export interface LocalizableMiniApp {
  name: string;
  description: string;
  tags?: string[];
  i18n?: MiniAppI18n;
}

export interface LocalizedMiniAppStrings {
  name: string;
  description: string;
  tags?: string[];
}

/** Candidate locales in priority order for `locale`, most specific first. */
function localeChain(locale: string | undefined): string[] {
  const chain: string[] = [];
  if (locale) {
    chain.push(locale);
    // `zh-Hans-CN` → `zh`: reach a table keyed by the bare language.
    const language = locale.split('-')[0];
    if (language && language !== locale) chain.push(language);
    // Any Chinese variant reads zh-CN. Without this it would fall through to
    // the English default below, showing a zh-* host an English card.
    if (locale.toLowerCase().startsWith('zh')) chain.push('zh-CN');
  }
  chain.push('en-US', 'zh-CN');
  return chain;
}

/** The first locale that actually has an entry, or undefined if none do. */
function pickLocale(
  table: Record<string, MiniAppLocaleStrings>,
  locale: string | undefined,
): string | undefined {
  for (const candidate of localeChain(locale)) {
    if (table[candidate]) return candidate;
  }
  // Nothing matched — a declared-but-unrelated table (e.g. only `ja-JP`) is
  // better than nothing, and its author clearly intended it to be read.
  return Object.keys(table)[0];
}

export function localizeMiniApp(
  meta: LocalizableMiniApp,
  locale: string | undefined,
): LocalizedMiniAppStrings {
  // No host locale means no basis for choosing a translation, and the top-level
  // fields *are* the app's declared default language — guessing `en-US` here
  // would show English to a host that never said it speaks English.
  const table = locale ? meta.i18n?.locales : undefined;
  const match = table ? pickLocale(table, locale) : undefined;
  const strings = match ? table?.[match] : undefined;

  return {
    name: strings?.name || meta.name,
    description: strings?.description || meta.description,
    ...(strings?.tags?.length ? { tags: strings.tags } : meta.tags ? { tags: meta.tags } : {}),
  };
}
