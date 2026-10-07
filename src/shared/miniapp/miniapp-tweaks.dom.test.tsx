/**
 * The tweaks runtime — the module a MiniApp copies verbatim into itself.
 *
 * It is shipped as a file under `bundled-skills/`, which means every MiniApp that
 * uses it runs *this exact code*. That raises the bar for "good enough": a bug
 * here is not one app's bug, it is the same bug in every app that adopted it.
 *
 * Three behaviours are worth pinning, and each of them is a way the obvious
 * implementation goes quietly wrong:
 *
 *  1. Defaults must paint **before** storage resolves. Reading storage is async,
 *     so a panel that waits for it renders one frame of unstyled state — and on a
 *     slow disk that frame is long enough to see.
 *  2. Locale refresh must update the *visible* text. An implementation that
 *     dispatches on tag name will set `aria-label` on a `<span>` and leave the
 *     screen text in the previous language: the a11y tree and the pixels now
 *     disagree, and nothing reports it.
 *  3. A stored value outside the declared options must be ignored. `meta.json`
 *     can be hand-edited, and a stale value has to degrade to the default rather
 *     than to an option no rule in the stylesheet matches.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TWEAKS_JS = join(process.cwd(), 'bundled-skills/miniapp-creator/references/tweaks/tweaks.js');

type Listener = (arg?: unknown) => void;

/** Minimal stand-in for the host runtime the real module expects. */
function stubHost(storage: Record<string, unknown>) {
  const localeListeners: Listener[] = [];
  (globalThis as Record<string, unknown>).app = {
    locale: 'zh-CN',
    storage: {
      get: vi.fn(async (key: string) => (key in storage ? storage[key] : null)),
      set: vi.fn(async (key: string, value: unknown) => {
        storage[key] = value;
      }),
    },
    onLocaleChange: (fn: Listener) => {
      localeListeners.push(fn);
    },
  };
  return {
    fireLocale(next: string) {
      for (const fn of localeListeners) fn(next);
    },
  };
}

async function loadTweaks() {
  vi.resetModules();
  // Imported through a data URL so the module under test is the shipped file,
  // not a copy that could drift from it.
  const source = readFileSync(TWEAKS_JS, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return (await import(/* @vite-ignore */ url)) as {
    mountTweaks: (config: {
      items: {
        id: string;
        label: Record<string, string>;
        options: [string, Record<string, string>][];
        default: string;
      }[];
    }) => void;
  };
}

const ITEMS = [
  {
    id: 'density',
    label: { 'zh-CN': '密度', 'en-US': 'Density' },
    options: [
      ['comfortable', { 'zh-CN': '宽松', 'en-US': 'Roomy' }],
      ['compact', { 'zh-CN': '紧凑', 'en-US': 'Tight' }],
    ] as [string, Record<string, string>][],
    default: 'comfortable',
  },
];

describe('tweaks runtime', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-tweakDensity');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).app;
  });

  it('paints the default tier synchronously, before storage resolves', async () => {
    stubHost({});
    const { mountTweaks } = await loadTweaks();
    mountTweaks({ items: ITEMS });

    // No await here on purpose: the attribute must already be there.
    expect(document.documentElement.dataset.tweakDensity).toBe('comfortable');
  });

  it('writes the attribute as the option id, not its index', async () => {
    stubHost({});
    const { mountTweaks } = await loadTweaks();
    mountTweaks({ items: ITEMS });

    document.querySelector<HTMLButtonElement>('.tw-option[data-value="compact"]')!.click();

    expect(document.documentElement.dataset.tweakDensity).toBe('compact');
    // Exactly one radio is checked — two checked states make the control lie.
    const checked = [...document.querySelectorAll('.tw-option')].filter(
      (b) => b.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('data-value')).toBe('compact');
  });

  it('persists the chosen tier under a stable storage key', async () => {
    const storage: Record<string, unknown> = {};
    stubHost(storage);
    const { mountTweaks } = await loadTweaks();
    mountTweaks({ items: ITEMS });

    document.querySelector<HTMLButtonElement>('.tw-option[data-value="compact"]')!.click();
    await Promise.resolve();

    expect(storage.tweaks).toEqual({ density: 'compact' });
  });

  it('refreshes visible text on locale change, not just aria labels', async () => {
    const host = stubHost({});
    const { mountTweaks } = await loadTweaks();
    mountTweaks({ items: ITEMS });

    const labelBefore = document.querySelector('.tw-label')!.textContent;
    expect(labelBefore).toBe('密度');

    host.fireLocale('en-US');

    // The regression this guards: only aria-label changed, pixels did not.
    expect(document.querySelector('.tw-label')!.textContent).toBe('Density');
    expect(document.querySelector('.tw-option')!.textContent).toBe('Roomy');
    // The tier itself must survive a locale switch — only copy is re-rendered.
    expect(document.documentElement.dataset.tweakDensity).toBe('comfortable');
  });

  it('ignores a stored value that is not one of the declared options', async () => {
    // meta.json (and therefore storage.json) is a file someone can edit.
    stubHost({ tweaks: { density: 'ultra-compressed' } });
    const { mountTweaks } = await loadTweaks();
    mountTweaks({ items: ITEMS });

    await Promise.resolve();
    await Promise.resolve();

    // Degrades to the default rather than to an attribute no CSS rule matches.
    expect(document.documentElement.dataset.tweakDensity).toBe('comfortable');
  });
});