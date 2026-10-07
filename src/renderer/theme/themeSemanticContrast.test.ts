/**
 * The canonical Theme's semantic colours must clear WCAG AA on every surface they
 * can legally appear on.
 *
 * Why this exists, specifically: a semantic token is **two jobs at once**. It is
 * small body text (`text-[var(--error)]`) *and* a solid fill with a paired ink
 * (`bg-[var(--success)]` + `color: var(--on-success)`). Those two jobs want
 * opposite luminance — text needs to be dark to clear AA on a light surface, a
 * fill needs to be light enough to sit under dark ink.
 *
 * The shipped palette satisfied the second job and quietly failed the first. On
 * `--paper-inset` (the fill behind inputs) the light-mode values measured
 * `--warning` 2.36:1, `--success` 3.17:1, `--info` 3.28:1, `--error` 3.58:1 —
 * every one of them below the 4.5:1 body-text threshold, in every appearance.
 * So "colour this 12px status line with the error token" was unreadable
 * everywhere, and nothing in the repo said so: `themeArchitecture.test.ts`
 * enforces that a status fill is paired with its own `--on-*` ink, but never
 * looked at whether either colour could be seen.
 *
 * This test reads the shipped CSS rather than a copy, so editing a hex without
 * re-deriving the arithmetic fails here instead of in front of a user.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  join(process.cwd(), 'src/renderer/theme/themes/hamuna-default.css'),
  'utf8',
);

/** WCAG 2.1: 4.5:1 for body text, 3:1 for large text and non-text graphics. */
const AA_BODY = 4.5;

const SEMANTIC = ['success', 'error', 'warning', 'info'] as const;
const SURFACES = ['paper', 'paper-elevated', 'paper-inset'] as const;

/** Parse one `html[data-color-scheme='…']` block into `{ token: hex }`. */
function scheme(mode: 'light' | 'dark'): Record<string, string> {
  const start = CSS.indexOf(`html[data-color-scheme='${mode}']`);
  if (start === -1) throw new Error(`no ${mode} block in the canonical theme`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Hue in degrees, or null for a near-grey (which has no meaningful hue). */
function hue(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const [mx, mn] = [Math.max(r, g, b), Math.min(r, g, b)];
  const d = mx - mn;
  if (d === 0) return Number.NaN;
  let h =
    mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

/** Shortest distance around the 360° wheel. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

describe('canonical theme — semantic colour contrast', () => {
  const modes = { light: scheme('light'), dark: scheme('dark') };

  for (const [mode, tokens] of Object.entries(modes)) {
    describe(mode, () => {
      it('parses a full token set, so the assertions below are not vacuous', () => {
        for (const key of ['paper', 'paper-elevated', 'paper-inset', ...SEMANTIC]) {
          expect(tokens[key], `--${key} missing from the ${mode} block`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      });

      it.each(SEMANTIC)('--%s clears AA as body text on every surface', (name) => {
        const ratios = SURFACES.map((s) => [s, ratio(tokens[name], tokens[s])] as const);
        const worst = ratios.reduce((a, b) => (a[1] <= b[1] ? a : b));
        expect(
          worst[1],
          `--${name} ${tokens[name]} on --${worst[0]} ${tokens[worst[0]]} = ` +
            `${worst[1].toFixed(2)}:1, needs ${AA_BODY}:1 (worst surface: ${ratios
              .map(([s, r]) => `${s} ${r.toFixed(2)}`)
              .join(', ')})`,
        ).toBeGreaterThanOrEqual(AA_BODY);
      });

      it.each(SEMANTIC)('--on-%s stays legible on the --%s fill', (name) => {
        const ink = tokens[`on-${name}`];
        const r = ratio(ink, tokens[name]);
        expect(
          r,
          `--on-${name} ${ink} on --${name} ${tokens[name]} = ${r.toFixed(2)}:1, ` +
            `needs ${AA_BODY}:1`,
        ).toBeGreaterThanOrEqual(AA_BODY);
      });
    });
  }

  it('keeps the semantic hues distinct from the primary accent', () => {
    // Hue separation, not luminance. A first attempt compared luminances and
    // reported dark `--warning` as "too close to the accent" — 0.044 apart,
    // but amber (38°) and sage (93°) are unmistakably different colours at any
    // shared lightness. Luminance distance is a contrast measure, and reusing it
    // here would have flagged a pair that is never confusable.
    for (const [mode, tokens] of Object.entries(modes)) {
      const accentHue = hue(tokens['accent-primary']);
      for (const name of SEMANTIC) {
        const separation = hueDistance(accentHue, hue(tokens[name]));
        expect(
          separation,
          `${mode}: --${name} sits only ${separation.toFixed(0)}° from --accent-primary`,
        ).toBeGreaterThan(25);
      }
    }
  });
});