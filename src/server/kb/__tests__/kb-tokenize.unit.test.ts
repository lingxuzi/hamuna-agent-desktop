// kb-tokenize.unit.test.ts — jieba-wasm tokenization for KB fulltext.
//
// The KB fulltext layer relies on jieba `cut_for_search` to pre-split CJK
// runs into space-separated word sequences (TypeGraph's FTS5 uses
// `unicode61`, which treats a CJK run as ONE unbreakable token — see
// tech_docs/... and the Phase 0 spike). These tests cover the wrapper:
// stopword + single-char + punctuation filtering, plus the
// "searchable string" shape used as the indexed column.

import { describe, expect, it } from 'vitest';

import { tokenizeForIndex, tokenizeText } from '../kb-tokenize';

describe('kb-tokenize', () => {
  describe('tokenizeText', () => {
    it('splits a Chinese sentence into multi-char tokens', () => {
      const tokens = tokenizeText('华为由任正非创立');
      // Each Chinese word must be >=2 chars; no stopwords or punctuation.
      expect(tokens.length).toBeGreaterThan(0);
      for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(2);
      // The known entities must survive tokenization.
      expect(tokens).toContain('华为');
      expect(tokens).toContain('任正非');
    });

    it('strips Chinese stopwords', () => {
      const tokens = tokenizeText('我们和他们一起');
      // '我们' / '他们' / '一起' (if >=2 chars) — but '和' is a single-char stopword
      // and MUST be dropped.
      expect(tokens).not.toContain('和');
    });

    it('drops single-char tokens', () => {
      const tokens = tokenizeText('任正非');
      // jieba may split 3-char names as ['任','正非'] or ['任正非']; if split,
      // the single char must be dropped (>=2 chars policy).
      for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(2);
    });

    it('drops English stopwords but keeps domain words', () => {
      const tokens = tokenizeText('knowledge graph is useful');
      // 'is' is a stopword; 'knowledge' / 'graph' / 'useful' are not.
      expect(tokens).not.toContain('is');
      expect(tokens).toContain('knowledge');
      expect(tokens).toContain('graph');
    });

    it('lowercases English tokens', () => {
      const tokens = tokenizeText('Apple Pie');
      expect(tokens).toContain('apple');
      expect(tokens).toContain('pie');
    });

    it('filters out pure punctuation/whitespace', () => {
      const tokens = tokenizeText('华为, 创立. 1987!');
      // No pure-punctuation tokens should appear.
      for (const t of tokens) {
        const isPurePunct = [...t].every((c) => /[\p{P}\p{Z}\s]/u.test(c));
        expect(isPurePunct).toBe(false);
      }
    });

    it('handles empty input gracefully (returns [])', () => {
      expect(tokenizeText('')).toEqual([]);
    });
  });

  describe('tokenizeForIndex', () => {
    it('joins tokens with single spaces — the FTS5 MATCH shape', () => {
      const indexStr = tokenizeForIndex('华为由任正非创立');
      // No leading/trailing whitespace, no double-spaces.
      expect(indexStr).not.toMatch(/^\s|\s$/);
      expect(indexStr).not.toMatch(/\s\s/);
      // Round-trip: every space-separated piece is a real token.
      const parts = indexStr.split(' ');
      for (const p of parts) {
        expect(p.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('produces a non-empty indexable string for Chinese fulltext', () => {
      // This is the exact case that exposed the unicode61 CJK zero-token bug.
      const indexStr = tokenizeForIndex('知识图谱是一种结构化语义知识库');
      expect(indexStr.length).toBeGreaterThan(0);
      expect(indexStr).toContain('知识');
      expect(indexStr).toContain('图谱');
    });
  });
});