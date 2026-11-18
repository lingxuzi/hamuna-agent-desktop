import { describe, it, expect } from 'vitest';
import { OPS_RULE_FRESHNESS_DAYS, ruleFreshness } from './ops-freshness';

/** 绝对时刻（UTC）。两边都用显式 Z，算天数差与机器时区无关。 */
const NOW = new Date('2026-11-13T10:00:00Z');

describe('规则新鲜度', () => {
  it('没记采样时刻是「不知道」，不是「刚采的」', () => {
    // 老台账里的规则都是这一档。它不等于 fresh —— 那是「不知道多久前的观察」，
    // 当成「今天的观察」就会拿半个月前的结论去选题。
    expect(ruleFreshness({}, NOW)).toEqual({ freshness: 'unknown', ageDays: null });
  });

  it('记的不是时间也是「不知道」', () => {
    expect(ruleFreshness({ sampledAt: '上周三' }, NOW)).toEqual({
      freshness: 'unknown',
      ageDays: null,
    });
  });

  it('刚采的还在有效期内', () => {
    expect(ruleFreshness({ sampledAt: '2026-11-12T10:00:00Z' }, NOW)).toEqual({
      freshness: 'fresh',
      ageDays: 1,
    });
  });

  it('有效期最后一天还算新鲜', () => {
    const at = new Date(NOW.getTime() - OPS_RULE_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
    expect(ruleFreshness({ sampledAt: at.toISOString() }, NOW).freshness).toBe('fresh');
  });

  it('过了有效期就是过期', () => {
    const at = new Date(NOW.getTime() - (OPS_RULE_FRESHNESS_DAYS + 1) * 24 * 60 * 60 * 1000);
    const info = ruleFreshness({ sampledAt: at.toISOString() }, NOW);
    expect(info.freshness).toBe('stale');
    expect(info.ageDays).toBe(OPS_RULE_FRESHNESS_DAYS + 1);
  });

  it('采样时刻在将来是时钟错位，不当成过期', () => {
    expect(ruleFreshness({ sampledAt: '2026-12-01T10:00:00Z' }, NOW)).toEqual({
      freshness: 'fresh',
      ageDays: 0,
    });
  });
});
