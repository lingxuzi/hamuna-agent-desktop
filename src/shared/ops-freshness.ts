/**
 * 规则新鲜度。
 *
 * **结论会过期。**「完播率高」是那批数据说的话，数据一旧，这个「高」就不再是
 * 现在的「高」。autody 靠每轮重算绕开这件事（`/gengxin` 根本不读上一轮结论，
 * `/html` 渲染时还要再算一遍）；我们是台账制 —— 结论写下来就一直躺在那里等着
 * 被下一轮继承。没有这道读数，继承式会把三周前的观察当成今天的观察。
 *
 * **派生而非存储。** 过期不是台账里的一个状态位，是读的时候按采样时刻算出来的。
 * 存成状态位就要定时器去改它 —— 多一个写者去跟并发写者抢同一把锁，而且改的那天
 * 和真实时间对不上（放了两周的台账没人去改）。派生就没有这些问题。
 *
 * 这个模块零依赖：不 import 台账类型，CLI 与 renderer 都直接能用。
 */

/** 结论的有效期。超过这个天数，结论不再作为依据。 */
export const OPS_RULE_FRESHNESS_DAYS = 30;

/**
 * - `fresh` —— 依据还新鲜。
 * - `stale` —— 依据过期，不能再当依据。
 * - `unknown` —— 没记采样时刻（或记的不是时间）。
 *
 * `unknown` **不等于 fresh**：那是「不知道多久了」，不是「刚采的」。autody 那句
 * 「空不等于零」说的就是这件事 —— 界面上看不出这个区别，人和 Agent 就会把
 * 「不知道多久前的观察」当成「今天的观察」。
 */
export type OpsRuleFreshness = 'fresh' | 'stale' | 'unknown';

export interface OpsRuleFreshnessInfo {
  freshness: OpsRuleFreshness;
  /** 距采样时刻多少天；null = 不知道（没记 / 解析不了）。 */
  ageDays: number | null;
}

/** 只要采样时刻就够了 —— 不 import 台账类型，保持零依赖。 */
export interface OpsRuleFreshnessInput {
  sampledAt?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 这条结论的依据有多旧。
 *
 * 采样时刻在将来 = 时钟错位，不当成「还没过期」—— 但也不当成过期：那是
 * 「还没发生」，不是「很久以前」。
 */
export function ruleFreshness(
  rule: OpsRuleFreshnessInput,
  now: Date,
): OpsRuleFreshnessInfo {
  const sampledAt = rule.sampledAt;
  if (!sampledAt) return { freshness: 'unknown', ageDays: null };
  const at = new Date(sampledAt);
  if (Number.isNaN(at.getTime())) return { freshness: 'unknown', ageDays: null };
  const diff = now.getTime() - at.getTime();
  const ageDays = diff <= 0 ? 0 : Math.floor(diff / DAY_MS);
  return {
    freshness: ageDays > OPS_RULE_FRESHNESS_DAYS ? 'stale' : 'fresh',
    ageDays,
  };
}
