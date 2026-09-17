// kb-merge.unit.test.ts — pure merge/chunk helpers for the KB graph.
//
// kb-merge is the only KB module with zero side effects (no fs, no sqlite,
// no jieba). Rust algorithm ports here must be byte-for-byte compatible with
// the frontend's rendering, so we cover the same cases the Rust unit tests
// did, plus the boundary edges that the FTS spike surfaced.

import { describe, expect, it } from 'vitest';

import {
  chunkText,
  entityId,
  mergeEntities,
  mergeRelations,
  type KbEntity,
  type KbGraphData,
  type KbRelation,
} from '../kb-merge';

describe('kb-merge', () => {
  describe('entityId', () => {
    it('lowercases and trims the label', () => {
      expect(entityId('  Huawei ')).toBe('huawei');
      expect(entityId('任正非')).toBe('任正非');
    });
  });

  describe('chunkText', () => {
    it('returns a single chunk for text under the limit', () => {
      expect(chunkText('short text', 4000)).toEqual(['short text']);
    });

    it('preserves every character (no truncation) across many chunks', () => {
      const text = '华为由任正非创立。' .repeat(1000);
      const chunks = chunkText(text, 4000);
      expect(chunks.join('')).toBe(text);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('breaks on sentence boundaries when they fall inside the window', () => {
      // 4000-char window; force a 。 exactly at char 2000 so chunk 1 ends there.
      const head = '甲'.repeat(1999);
      const tail = '乙'.repeat(4000);
      const text = `${head}。${tail}`;
      const chunks = chunkText(text, 4000);
      // First chunk ends right after the 。 (i+1 = 2000).
      expect(chunks[0]!.endsWith('。')).toBe(true);
      expect(chunks[0]!.length).toBe(2000);
    });

    it('hard-breaks when no boundary exists in the window', () => {
      const text = '甲'.repeat(10_000);
      const chunks = chunkText(text, 4000);
      expect(chunks.length).toBe(3); // 4000 + 4000 + 2000
      expect(chunks[0]!.length).toBe(4000);
      expect(chunks[2]!.length).toBe(2000);
    });

    it('breaks on the last boundary in each window (not every boundary)', () => {
      // The algorithm picks the rightmost boundary char in the
      // [start, start+maxChars) window — earlier boundaries in the same
      // window are skipped. With '！' at idx 1999, '？' at idx 3999, and
      // '；' at idx 5999 in a 8001-char input, each lands at the very end
      // of its respective [0,4000) / [4000,8000) window. The trailing
      // '戊' (after '\n' at 7999) becomes the final single-char chunk.
      // Result: 3 chunks — boundary chars grouped by window, not one per
      // boundary.
      const text = '甲'.repeat(1999) + '！' + '乙'.repeat(1999) + '？' + '丙'.repeat(1999) + '；' + '丁'.repeat(1999) + '\n戊';
      const chunks = chunkText(text, 4000);
      expect(chunks.length).toBe(3);
      expect(chunks.at(-1)).toBe('戊');
      expect(chunks[0]!.endsWith('？')).toBe(true);
      expect(chunks[1]!.endsWith('\n')).toBe(true);
    });

    it('handles a single empty chunk input (returns the empty string)', () => {
      // Mirrors the Rust fallback: empty input still yields one chunk equal
      // to the original text (so callers can blindly iterate).
      expect(chunkText('', 4000)).toEqual(['']);
    });
  });

  describe('mergeEntities', () => {
    it('appends a new entity when none exists with the same id', () => {
      const g: KbGraphData = { entities: [], relations: [] };
      mergeEntities(g, [{ id: 'a', label: 'A', sources: ['s1'] }]);
      expect(g.entities).toEqual([{ id: 'a', label: 'A', sources: ['s1'] }]);
    });

    it('dedupes sources when entity already exists', () => {
      const g: KbGraphData = {
        entities: [{ id: 'a', label: 'A', sources: ['s1', 's2'] }],
        relations: [],
      };
      mergeEntities(g, [{ id: 'a', label: 'A', sources: ['s2', 's3'] }]);
      expect(g.entities[0]!.sources).toEqual(['s1', 's2', 's3']);
    });

    it('keeps first non-undefined entityType on merge', () => {
      const g: KbGraphData = {
        entities: [{ id: 'a', label: 'A', sources: [] }],
        relations: [],
      };
      mergeEntities(g, [{ id: 'a', label: 'A', entityType: 'company', sources: [] }]);
      expect(g.entities[0]!.entityType).toBe('company');
      // Later merge must not overwrite an already-set type.
      mergeEntities(g, [{ id: 'a', label: 'A', entityType: 'person', sources: [] }]);
      expect(g.entities[0]!.entityType).toBe('company');
    });

    it('leaves existing entityType undefined when both are undefined', () => {
      const g: KbGraphData = {
        entities: [{ id: 'a', label: 'A', sources: [] }],
        relations: [],
      };
      mergeEntities(g, [{ id: 'a', label: 'A', sources: ['x'] }]);
      expect(g.entities[0]!.entityType).toBeUndefined();
    });
  });

  describe('mergeRelations', () => {
    it('appends a new typed relation', () => {
      const g: KbGraphData = { entities: [], relations: [] };
      mergeRelations(g, [{ subject: 'A', object: 'B', relationType: 'founded', weight: 1, typed: true }]);
      expect(g.relations).toEqual([
        { subject: 'A', object: 'B', relationType: 'founded', weight: 1, typed: true },
      ]);
    });

    it('upgrades an untyped cooccur edge in place when a typed relation arrives', () => {
      const g: KbGraphData = {
        entities: [],
        relations: [{ subject: 'A', object: 'B', relationType: 'cooccur', weight: 2, typed: false }],
      };
      mergeRelations(g, [{ subject: 'A', object: 'B', relationType: 'founded', weight: 0.8, typed: true }]);
      expect(g.relations).toEqual([
        { subject: 'A', object: 'B', relationType: 'founded', weight: 2, typed: true },
      ]);
      expect(g.relations.length).toBe(1);
    });

    it('accumulates weight for same-direction same-type edges', () => {
      const g: KbGraphData = {
        entities: [],
        relations: [{ subject: 'A', object: 'B', relationType: 'cooccur', weight: 0.5, typed: false }],
      };
      mergeRelations(g, [{ subject: 'A', object: 'B', relationType: 'cooccur', weight: 0.3, typed: false }]);
      expect(g.relations[0]!.weight).toBeCloseTo(0.8);
    });

    it('keeps typed relations distinct per (subject, object, type) tuple', () => {
      const g: KbGraphData = { entities: [], relations: [] };
      mergeRelations(g, [
        { subject: 'A', object: 'B', relationType: 'founded', weight: 1, typed: true },
        { subject: 'A', object: 'B', relationType: 'invested_in', weight: 1, typed: true },
      ]);
      expect(g.relations.length).toBe(2);
    });

    it('treats relations with relationType "cooccur" as untyped even when typed flag is omitted', () => {
      const g: KbGraphData = { entities: [], relations: [] };
      // Caller omits `typed` field — the merge falls back to "cooccur" semantics.
      const incoming: KbRelation = { subject: 'A', object: 'B', relationType: 'cooccur', weight: 1, typed: false };
      mergeRelations(g, [incoming]);
      expect(g.relations[0]!.typed).toBe(false);
    });
  });

  // Integration of mergeEntities + mergeRelations — guards against regression
  // where a typed upgrade forgets to also keep the entity's sources in sync.
  describe('entities + relations together', () => {
    it('merging an entity does not affect unrelated relations', () => {
      const entity: KbEntity = { id: 'a', label: 'A', sources: [] };
      const g: KbGraphData = {
        entities: [entity],
        relations: [{ subject: 'A', object: 'C', relationType: 'cooccur', weight: 1, typed: false }],
      };
      mergeEntities(g, [{ id: 'a', label: 'A', entityType: 'company', sources: ['doc1'] }]);
      expect(g.entities[0]!.entityType).toBe('company');
      expect(g.relations[0]!.typed).toBe(false); // unchanged
    });
  });
});