import { describe, expect, it } from 'vitest';

import { themeRegistry } from './registry';
import {
  collectContractBlocks,
  collectDeclaredTokens,
  parseThemeStylesheet,
} from './stylesheet-contract';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((value >> 16) & 255)
    + 0.7152 * channel((value >> 8) & 255)
    + 0.0722 * channel(value & 255);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function applyBrightness(hex: string, multiplier: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `#${[
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ].map(channelValue => Math.min(255, Math.round(channelValue * multiplier))
    .toString(16)
    .padStart(2, '0')).join('')}`;
}

function tokensFor(stylesheetText: string, themeId: string, scheme: 'light' | 'dark'): Map<string, string> {
  const selector = `html[data-theme-id='${themeId}'][data-color-scheme='${scheme}']`;
  const allowedSelectorLists = themeId === 'hamuna-default'
    ? [[`html[data-color-scheme='${scheme}']`, selector]]
    : [[selector]];
  const stylesheet = parseThemeStylesheet(stylesheetText);
  return collectDeclaredTokens(collectContractBlocks(
    stylesheet.topLevelBlocks,
    selector,
    allowedSelectorLists,
    `contrast selector ${selector}`,
  ));
}

function resolvedColorToken(tokens: Map<string, string>, tokenName: string): string {
  const value = tokens.get(tokenName)!;
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
  return reference ? tokens.get(reference)! : value;
}

describe('production Theme contrast', () => {
  it('keeps every optional light Theme toggle thumb on the light control surface', () => {
    const lightSurfaceFloor = luminance('#f0f0f0');

    for (const definition of themeRegistry.getAcceptedDefinitions().slice(1)) {
      const tokens = tokensFor(definition.stylesheetText, definition.id, 'light');
      expect(
        luminance(tokens.get('--toggle-thumb')!),
        `${definition.id}.light toggle thumb`,
      ).toBeGreaterThanOrEqual(lightSurfaceFloor);
    }
  });

  it('keeps every optional light Theme primary action foreground on the light control surface', () => {
    const lightSurfaceFloor = luminance('#f0f0f0');

    for (const definition of themeRegistry.getAcceptedDefinitions().slice(1)) {
      const tokens = tokensFor(definition.stylesheetText, definition.id, 'light');
      expect(
        luminance(resolvedColorToken(tokens, '--button-primary-text')),
        `${definition.id}.light primary action foreground`,
      ).toBeGreaterThanOrEqual(lightSurfaceFloor);
    }
  });

  it('keeps every dark Theme primary action readable with the intended foreground polarity', () => {
    const lightSurfaceFloor = luminance('#f0f0f0');

    for (const definition of themeRegistry.getAcceptedDefinitions()) {
      const tokens = tokensFor(definition.stylesheetText, definition.id, 'dark');
      const foreground = resolvedColorToken(tokens, '--button-primary-text');

      expect(
        contrast(foreground, tokens.get('--button-primary-bg')!),
        `${definition.id}.dark primary action`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(foreground, tokens.get('--button-primary-bg-hover')!),
        `${definition.id}.dark primary action hover`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        luminance(foreground),
        `${definition.id}.dark primary action foreground polarity`,
      ).toBeGreaterThanOrEqual(lightSurfaceFloor);
    }
  });

  it('keeps reviewed dark Theme toggle thumb polarity stable', () => {
    for (const definition of themeRegistry.getAcceptedDefinitions()) {
      const tokens = tokensFor(definition.stylesheetText, definition.id, 'dark');
      const thumb = tokens.get('--toggle-thumb')!;
      expect(
        luminance(thumb),
        `${definition.id}.dark toggle thumb polarity`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('keeps every palette Theme core text and solid action state at 4.5:1 or better', () => {
    const solidActionPairs = [
      ['accent action', '--on-accent', '--accent'],
      ['accent action hover', '--on-accent', '--accent-warm-hover'],
      ['primary action', '--button-primary-text', '--button-primary-bg'],
      ['primary action hover', '--button-primary-text', '--button-primary-bg-hover'],
      ['fixed dark action', '--button-dark-text', '--button-dark-bg'],
      ['fixed dark action hover', '--button-dark-text', '--button-dark-bg-hover'],
      ['secondary action', '--button-secondary-text', '--button-secondary-bg'],
      ['secondary action hover', '--button-secondary-text', '--button-secondary-bg-hover'],
      ['success action', '--on-success', '--success'],
      ['error action', '--on-error', '--error'],
      ['error action hover', '--on-error', '--error-hover'],
      ['warning action', '--on-warning', '--warning'],
      ['info action', '--on-info', '--info'],
    ] as const;

    for (const definition of themeRegistry.getAcceptedDefinitions().filter(
      candidate => candidate.id !== 'hamuna-default' && candidate.id !== 'default-black',
    )) {
      for (const scheme of ['light', 'dark'] as const) {
        const tokens = tokensFor(definition.stylesheetText, definition.id, scheme);
        const ink = tokens.get('--ink')!;
        const paper = tokens.get('--paper')!;

        expect(contrast(ink, paper), `${definition.id}.${scheme} body`).toBeGreaterThanOrEqual(4.5);
        for (const [label, foregroundToken, backgroundToken] of solidActionPairs) {
          expect(
            contrast(tokens.get(foregroundToken)!, tokens.get(backgroundToken)!),
            `${definition.id}.${scheme} ${label}`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        // Several existing semantic buttons use `hover:brightness-110` on the
        // whole painted control. Test the rendered pair, not only its base
        // Tokens, because white foregrounds clip while the surface brightens.
        for (const status of ['success', 'error', 'warning', 'info'] as const) {
          expect(
            contrast(
              applyBrightness(tokens.get(`--on-${status}`)!, 1.1),
              applyBrightness(tokens.get(`--${status}`)!, 1.1),
            ),
            `${definition.id}.${scheme} ${status} brightness hover`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps every solid accent and primary action readable', () => {
    for (const definition of themeRegistry.getAcceptedDefinitions()) {
      for (const scheme of ['light', 'dark'] as const) {
        const tokens = tokensFor(definition.stylesheetText, definition.id, scheme);
        const key = `${definition.id}.${scheme}`;

        for (const backgroundToken of ['--accent', '--accent-warm-hover'] as const) {
          expect(
            contrast(resolvedColorToken(tokens, '--on-accent'), tokens.get(backgroundToken)!),
            `${key} --on-accent over ${backgroundToken}`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        // `resolvedColorToken` follows the `var(--x)` indirection on purpose:
        // `--button-primary-text` must NOT be `var(--on-accent)`. One token
        // cannot serve both surfaces once the CTA background is a different
        // colour family from the accent -- Default Black's light CTA is
        // #111111 and needs white, while its #c26d3a accent needs dark ink.
        // That alias is precisely what let the two surfaces disagree, so
        // resolving it here is load-bearing, not incidental.
        for (const backgroundToken of ['--button-primary-bg', '--button-primary-bg-hover'] as const) {
          expect(
            contrast(
              resolvedColorToken(tokens, '--button-primary-text'),
              tokens.get(backgroundToken)!,
            ),
            `${key} --button-primary-text over ${backgroundToken}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
  it('keeps every Widget solid accent readable', () => {
    for (const definition of themeRegistry.getAcceptedDefinitions()) {
      for (const scheme of ['light', 'dark'] as const) {
        const widget = themeRegistry.resolve(definition.id, scheme, false).adapters.widget.variables;
        const foreground = widget['--widget-primary-text'];
        const key = `${definition.id}.${scheme}`;
        // Widget variables are raw hex by construction (preset-theme.ts reads
        // them through requiredHex), so they can be contrasted directly. This
        // surface is its own owner rather than an alias of --on-accent, which
        // is why the burnt-orange themes needed fixing in two places.
        expect(
          contrast(foreground!, widget['--widget-accent']!),
          `${key} --widget-primary-text over --widget-accent`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(foreground!, widget['--widget-accent-hover']!),
          `${key} --widget-primary-text over --widget-accent-hover`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
