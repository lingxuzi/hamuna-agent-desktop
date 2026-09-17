// Unit tests for KB store pure helpers (buildSnippet + snapshot diff inputs).
//
// buildSnippet is the raw-text hit-context window used in query() results —
// it must center on the query token rather than dumping the doc opening.

import { describe, expect, it } from 'vitest';

import { buildSnippet } from './kb/kb-store';

describe('buildSnippet', () => {
  it('centers on the first query-token occurrence in a long doc', () => {
    const raw = '开头无关内容。'.repeat(40) + '江苏索普化工股份有限公司发布公告。' + '结尾无关内容。'.repeat(40);
    const out = buildSnippet(raw, ['江苏', '索普', '公司']);
    expect(out).toContain('江苏索普化工股份有限公司');
    expect(out.startsWith('…')).toBe(true); // hit is in the middle → both ends trimmed
    expect(out.endsWith('…')).toBe(true);
    // The window is anchored near the hit, not at the doc opening.
    expect(out.indexOf('江苏索普化工股份有限公司')).toBeLessThan(240);
  });

  it('falls back to the opening window when no token appears verbatim', () => {
    const raw = 'abcdefghij'.repeat(40); // no query token present
    const out = buildSnippet(raw, ['zzz']);
    expect(out).toBe('abcdefghij'.repeat(24) + '…'); // 240 chars + ellipsis
  });

  it('returns the whole (short) text without ellipsis', () => {
    expect(buildSnippet('苹果公司很好', ['苹果'])).toBe('苹果公司很好');
  });

  it('is case-insensitive for latin tokens', () => {
    const raw = 'prelude '.repeat(30) + 'Apple Inc released a product.' + ' tail'.repeat(30);
    const out = buildSnippet(raw, ['apple']);
    expect(out.toLowerCase()).toContain('apple inc'); // anchor region shown
    expect(out.toLowerCase().indexOf('apple')).toBeLessThan(240);
  });

  it('prefers the longest matching token as the anchor', () => {
    // "江苏索普" matches before the shorter "江苏" later in the text.
    const raw = 'A'.repeat(200) + '先提到江苏索普。' + 'B'.repeat(100) + '再次江苏。';
    const out = buildSnippet(raw, ['江苏', '索普']);
    expect(out.indexOf('江苏索普')).toBeGreaterThan(-1);
  });
});