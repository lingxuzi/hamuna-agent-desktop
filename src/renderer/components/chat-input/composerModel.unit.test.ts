import { describe, it, expect } from 'vitest';
import { chipDeleteRange, composerHtml } from './composerModel';

const chipText = (html: string) =>
  [
    ...html
      // Unwrap the hidden prefix span first so chip bodies contain no tags.
      .replace(/<span class="cc-chip-prefix">(.*?)<\/span>/g, '$1')
      .matchAll(/<span class="cc-chip cc-chip-(\w+)"[^>]*>([^<]*)<\/span>/g),
  ].map((m) => [m[1], m[2]]);

describe('composerHtml', () => {
  it('chips a complete marker when not editing', () => {
    expect(chipText(composerHtml('/compact', null))).toEqual([['skill', '/compact']]);
    expect(chipText(composerHtml('see @a/b.ts now', null))).toEqual([['asset', '@a/b.ts']]);
  });

  it('keeps textContent identical to the source value', () => {
    for (const s of ['/a @b c', 'plain', '@x', '/a.b:c/d', '前 /skill 后 @a/b.ts']) {
      const stripped = composerHtml(s, null).replace(/<[^>]*>/g, '');
      expect(stripped).toBe(s); // escaping is a superset concern; these have no <> &
    }
  });

  it('leaves a marker alone while the caret is still inside it', () => {
    // "/comp" + caret at 5 — the user is still typing toward "/compact".
    expect(chipText(composerHtml('/comp', 5))).toEqual([]);
    // caret escaped past it → chipped.
    expect(chipText(composerHtml('/comp', 6))).toEqual([['skill', '/comp']]);
    // caret before it (typed text ahead) → chipped.
    expect(chipText(composerHtml('/comp ', 0))).toEqual([['skill', '/comp']]);
  });

  it('escapes markup in plain text and inside chips', () => {
    expect(composerHtml('a<b & c', null)).toBe('a&lt;b &amp; c');
    expect(composerHtml('@a<b', null)).toContain('a&lt;b');
    expect(composerHtml('@a<b', null)).not.toContain('<b');
  });

  it('classifies skill vs asset', () => {
    expect(composerHtml('/s', null)).toContain('cc-chip-skill');
    expect(composerHtml('@a', null)).toContain('cc-chip-asset');
  });

  it('hides the marker prefix visually but keeps it in textContent', () => {
    const html = composerHtml('@a/b.ts', null);
    expect(html).toContain('<span class="cc-chip-prefix">@</span>');
    // Stripping tags must still reproduce the original — caret offsets are
    // computed from Range.toString(), which counts display:none text.
    expect(html.replace(/<[^>]*>/g, '')).toBe('@a/b.ts');
  });
});

describe('chipDeleteRange', () => {
  it('takes the whole chip out on Backspace', () => {
    // "/compact " — the chip plus the whitespace that committed it.
    expect(chipDeleteRange('/compact ', 9, 'backward')).toEqual({ start: 0, end: 9 });
  });

  it('keeps the text in front of the chip', () => {
    expect(chipDeleteRange('前 /compact ', 11, 'backward')).toEqual({ start: 2, end: 11 });
  });

  it('takes the chip in front of the caret out on Delete', () => {
    expect(chipDeleteRange('前 @a/b.ts', 2, 'forward')).toEqual({ start: 2, end: 9 });
  });

  it('leaves a marker the caret is still inside alone', () => {
    // "/comp" with the caret at its end — still being typed, so it must
    // degrade character by character like any other text.
    expect(chipDeleteRange('/comp', 5, 'backward')).toBeNull();
  });

  it('returns null when there is no chip', () => {
    expect(chipDeleteRange('plain ', 6, 'backward')).toBeNull();
    expect(chipDeleteRange('plain', 0, 'forward')).toBeNull();
  });
});
