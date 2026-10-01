import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { VISIBLE_APP_SHORTCUTS } from '../utils/appShortcuts';
import { resources } from './index';

function flattenResource(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, child]) => {
    Object.assign(acc, flattenResource(child, prefix ? `${prefix}.${key}` : key));
    return acc;
  }, {});
}

function interpolationNames(value: string): string[] {
  return [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map(match => match[1] ?? '').sort();
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

describe('renderer i18n resource parity', () => {
  it.each(['app', 'chat', 'launcher', 'settings', 'task'] as const)('%s keeps zh-CN and en-US keys aligned', (namespace) => {
    const zh = flattenResource(resources['zh-CN'][namespace]);
    const en = flattenResource(resources['en-US'][namespace]);

    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh)) {
      expect(interpolationNames(en[key] ?? '')).toEqual(interpolationNames(zh[key] ?? ''));
    }
  });

  it('settings includes labels for every visible app shortcut', () => {
    const expectedIds = VISIBLE_APP_SHORTCUTS.map(shortcut => shortcut.id).sort();
    const zhItems = resources['zh-CN'].settings.shortcuts.app.items;
    const enItems = resources['en-US'].settings.shortcuts.app.items;

    expect(Object.keys(zhItems).sort()).toEqual(expectedIds);
    expect(Object.keys(enItems).sort()).toEqual(expectedIds);
  });

  // A missing key is invisible to typecheck, to eslint, and to the parity test
  // above (which only compares zh-CN against en-US — two absent keys are
  // perfectly "aligned"). i18next returns the KEY STRING for a missing key, so
  // `t('x.y') ?? 'Fallback'` silently renders `x.y`: the `??` is unreachable
  // dead code that makes the bug look handled. Both MiniApp pages shipped with
  // 20 such keys and rendered no real text at all. This asserts the key
  // actually resolves, in every locale, before a user has to click through.
  //
  // Scope is the whole `src/renderer` tree, not just `pages/` + `components/`:
  // that narrower list let `tabs.marketplace` / `tabs.miniappCenter` ship
  // missing, because their only call sites live in `App.tsx`, and the raw key
  // string rendered as the tab label.
  it('every t() literal key used in the renderer resolves in both locales', () => {
    const flattened = Object.fromEntries(
      Object.entries(resources).map(([locale, namespaces]) => [
        locale,
        Object.values(namespaces).reduce<Record<string, string>>(
          (acc, ns) => Object.assign(acc, flattenResource(ns)),
          {},
        ),
      ]),
    );

    const files = collectSourceFiles(join(process.cwd(), 'src/renderer'));
    expect(files.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) {
        // `t('ns:key')` names its namespace; a bare key is looked up across all
        // of them, since the call site's `useTranslation()` is not statically
        // visible here. Absence from EVERY namespace is the bug we are catching.
        const raw = match[1] ?? '';
        const key = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
        for (const locale of Object.keys(flattened)) {
          if (flattened[locale]?.[key] === undefined) {
            missing.push(`${file.replace(/\\/g, '/')}: ${raw} (${locale})`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
