// kb-relations.unit.test.ts — pure helpers for the KB LLM relation-typing pipeline.
//
// Covers the precision-critical building blocks added for source-grounding:
// - `extractBalancedJson`: string-aware brace-depth scan (replaces the old
//   indexOf('{')/lastIndexOf('}') heuristic that broke on chatty model output)
// - `validateGrounding`: drops entities/relations whose `source_quote` cannot
//   be located verbatim in the original chunk text
//
// These two functions gate the user's precision upgrade (TODO #22). Any
// regression in either one silently degrades KB extraction quality, so the
// tests live here rather than relying on LLM end-to-end coverage.

import { describe, expect, it } from 'vitest';

import { extractBalancedJson, stripMarkdownFence, validateGrounding } from './kb-relations';

describe('kb-relations pure helpers', () => {
  describe('extractBalancedJson', () => {
    it('returns null when there is no opening brace', () => {
      expect(extractBalancedJson('no JSON here at all')).toBeNull();
    });

    it('returns the entire string when it is already a single balanced object', () => {
      const obj = '{"a":1,"b":2}';
      expect(extractBalancedJson(obj)).toBe(obj);
    });

    it('handles braces and brackets inside JSON strings without miscounting', () => {
      // The value contains both '{' and '}' as data; the only real object
      // boundary is at the very end. The naive lastIndexOf('}') approach
      // would slice to the wrong position.
      const inner = '{"note":"example: {a:1} ignored","value":42}';
      expect(extractBalancedJson(inner)).toBe(inner);
    });

    it('respects backslash escapes inside strings (so backslash-quote does not toggle string state)', () => {
      // Contains an escaped quote then a closing brace that must NOT end the
      // object, then later the real closing brace.
      const inner = '{"text":"\\"} still in string","ok":true}';
      expect(extractBalancedJson(inner)).toBe(inner);
    });

    it('extracts a balanced object when the model wraps it in prose', () => {
      // The model's previous broken slice started at the first '{' (inside the
      // explanation) and ran past the real JSON boundary. Brace-depth scan
      // finds the real object boundary.
      const wrapped = 'Sure! Here is the JSON: {"entities":[],"relations":[]}. Hope this helps!';
      expect(extractBalancedJson(wrapped)).toBe('{"entities":[],"relations":[]}');
    });

    it('returns null when no balanced object exists (unterminated)', () => {
      expect(extractBalancedJson('{"a":1,')).toBeNull();
    });
  });

  describe('stripMarkdownFence', () => {
    it('strips a ```json fence around a JSON object', () => {
      const fenced = '```json\n{"a":1}\n```';
      expect(stripMarkdownFence(fenced)).toBe('{"a":1}');
    });

    it('strips a plain ``` fence (no language tag)', () => {
      const fenced = '```\n{"a":1}\n```';
      expect(stripMarkdownFence(fenced)).toBe('{"a":1}');
    });

    it('handles uppercase JSON language tag', () => {
      expect(stripMarkdownFence('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('returns input unchanged when there is no fence (bare objects are not "fenced")', () => {
      const bare = 'Here is the answer: {"a":1}';
      expect(stripMarkdownFence(bare)).toBe(bare);
    });

    it('returns input unchanged when the fence is not closed', () => {
      const half = '```json\n{"a":1}';
      expect(stripMarkdownFence(half)).toBe(half);
    });

    it('combined with extractBalancedJson: a fenced JSON object is fully parsed', () => {
      const fenced = '```json\n{"entities":[],"relations":[]}\n```';
      expect(extractBalancedJson(stripMarkdownFence(fenced))).toBe('{"entities":[],"relations":[]}');
    });
  });

  describe('validateGrounding', () => {
    const originalText = '江苏索普化工股份有限公司（股票代码600746）成立于1996年。';

    it('keeps entities whose source_quote is a substring of the original text', () => {
      const result = validateGrounding(originalText, {
        entities: [
          { id: '江苏索普化工股份有限公司', label: '江苏索普化工股份有限公司', sourceQuote: '江苏索普化工股份有限公司' },
          { id: '600746', label: '600746', sourceQuote: '股票代码600746' },
        ],
        relations: [],
      });
      expect(result.droppedEntities).toBe(0);
      expect(result.cleaned.entities.map((e) => e.id)).toEqual(['江苏索普化工股份有限公司', '600746']);
    });

    it('drops entities whose source_quote is fabricated (not in the original text)', () => {
      const result = validateGrounding(originalText, {
        entities: [
          { id: 'real', label: 'real', sourceQuote: '股票代码600746' },
          // Common hallucination pattern: model invents a span that does not exist.
          { id: 'hallucinated', label: 'hallucinated', sourceQuote: '成立于2025年' },
        ],
        relations: [],
      });
      expect(result.droppedEntities).toBe(1);
      expect(result.cleaned.entities.map((e) => e.id)).toEqual(['real']);
    });

    it('keeps entities that omitted source_quote entirely (defensive — do not lose data on small chunks)', () => {
      const result = validateGrounding(originalText, {
        entities: [{ id: 'no-quote', label: 'no-quote' }],
        relations: [],
      });
      expect(result.droppedEntities).toBe(0);
      expect(result.cleaned.entities.map((e) => e.id)).toEqual(['no-quote']);
    });

    it('drops relations whose endpoints were dropped from entities (no orphan relations)', () => {
      const result = validateGrounding(originalText, {
        entities: [
          { id: 'kept', label: 'kept', sourceQuote: '江苏索普' },
          { id: 'dropped', label: 'dropped', sourceQuote: '不存在于原文的字段' },
        ],
        relations: [
          // subject kept, object kept → kept
          { subject: 'kept', object: 'kept', relation_type: 'self', weight: 1, typed: true, sourceQuote: '江苏索普' },
          // subject dropped → dropped even though subject id technically exists in entities (it was dropped)
          { subject: 'dropped', object: 'kept', relation_type: 'ref', weight: 1, typed: true, sourceQuote: '江苏索普' },
        ],
      });
      expect(result.droppedEntities).toBe(1);
      expect(result.droppedRelations).toBe(1);
      expect(result.cleaned.relations.map((r) => `${r.subject}->${r.object}`)).toEqual(['kept->kept']);
    });

    it('drops relations whose own source_quote is fabricated', () => {
      const result = validateGrounding(originalText, {
        entities: [
          { id: 'a', label: 'a', sourceQuote: '股票代码600746' },
          { id: 'b', label: 'b', sourceQuote: '1996年' },
        ],
        relations: [
          { subject: 'a', object: 'b', relation_type: 'listed_as', weight: 1, typed: true, sourceQuote: '股票代码600746' },
          { subject: 'a', object: 'b', relation_type: 'imagined', weight: 1, typed: true, sourceQuote: '纯属虚构的引用' },
        ],
      });
      expect(result.droppedRelations).toBe(1);
      expect(result.cleaned.relations.map((r) => r.relation_type)).toEqual(['listed_as']);
    });

    describe('char_interval (LangExtract-style position-anchored check)', () => {
      it('keeps an entity when char_interval slice equals source_quote exactly', () => {
        const result = validateGrounding(originalText, {
          entities: [
            // "股票代码600746" sits at chars 13..23 of originalText (find via indexOf).
            { id: 'code', label: 'code', sourceQuote: '股票代码600746', charStart: 13, charEnd: 23 },
          ],
          relations: [],
        });
        expect(result.droppedEntities).toBe(0);
        expect(result.charIntervalUsed).toBe(1);
      });

      it('drops an entity when char_interval slice does NOT equal source_quote (LLM transcription error)', () => {
        const result = validateGrounding(originalText, {
          entities: [
            // char_interval points to "股票代码600746" but source_quote is the WRONG text.
            { id: 'mismatch', label: 'mismatch', sourceQuote: '股票代码 600746', charStart: 13, charEnd: 23 },
          ],
          relations: [],
        });
        expect(result.droppedEntities).toBe(1);
      });

      it('drops an entity when char_interval is out of bounds', () => {
        const result = validateGrounding(originalText, {
          entities: [
            { id: 'oob', label: 'oob', sourceQuote: 'too long', charStart: 0, charEnd: 9999 },
          ],
          relations: [],
        });
        expect(result.droppedEntities).toBe(1);
      });

      it('falls back to substring search when char_interval is missing (the old behavior)', () => {
        const result = validateGrounding(originalText, {
          entities: [
            // No char_interval, but source_quote is a valid substring.
            { id: 'no-interval', label: 'no-interval', sourceQuote: '股票代码600746' },
          ],
          relations: [],
        });
        expect(result.droppedEntities).toBe(0);
        expect(result.charIntervalUsed).toBe(0);
      });
    });
  });
});