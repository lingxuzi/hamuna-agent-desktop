/**
 * 四域视图的纯派生。
 *
 * **口径只写这一份。** Hero 的三条指标、列表排序、分布条、深墨主角卡，全部从
 * `ops/state.json` 的四条记录派生出来，不落盘。派生值一旦存进 state.json，
 * 界面和真实数据就会各说各话——同一个数在两张卡上对不上就是这么来的。
 *
 * 与「现在」有关的判断（本周、滞留天数、下一条）全部走注入的 `now`，
 * 测试里钉死时间，周界与天数才可复现。
 *
 * 派生结果是**数据**，不是文案：标签由 renderer 走 i18n 取。
 */

import type {
  OpsActor,
  OpsAsset,
  OpsDirectionProposal,
  OpsDirectionStatus,
  OpsDomainId,
  OpsReview,
  OpsRule,
  OpsState,
  OpsTopic,
  OpsTopicSource,
} from './ops';
import { SOCIAL_PLATFORMS, type SocialPlatformId } from './socialPlatforms';

/** 指标单位：`count` 原样，`compact` 大数紧凑排（18.2 万），`percent` 0–1 的比例。 */
export type OpsMetricUnit = 'count' | 'compact' | 'percent';

export interface OpsMetric {
  /** i18n key，renderer 取标签。 */
  key: string;
  /** `null` = 当前没有可读数（例如一条完播率都没有），界面显示「—」而不是 0。 */
  value: number | null;
  unit: OpsMetricUnit;
}

/** 分布条的口径种类，决定 renderer 从哪个 i18n 命名空间取标签。 */
export type OpsDistKind = 'platform' | 'topicSource' | 'assetStatus';

export interface OpsDistBar {
  kind: OpsDistKind;
  /** 稳定键：平台 id / 来源 id / 状态 id。 */
  key: string;
  value: number;
  /** 0–100，占**全部**的份额。 */
  pct: number;
}

export interface OpsTopicRow {
  id: string;
  title: string;
  platform: SocialPlatformId;
  /** 副文本：切入角度，没有角度就用「为什么值得做」。 */
  sub: string;
  hotness: number | null;
}

export interface OpsAssetRow {
  id: string;
  title: string;
  platform: SocialPlatformId;
  progress: number;
  /** 距上次更新的天数。 */
  idleDays: number;
}

export interface OpsScheduleEntry {
  id: string;
  title: string;
  platform: SocialPlatformId;
  /** 投放时刻（ISO）。 */
  at: string;
}

export interface OpsScheduleDay {
  /** 本地日期 `YYYY-MM-DD`。 */
  date: string;
  assets: OpsScheduleEntry[];
  empty: boolean;
}

export interface OpsReviewRow {
  reviewId: string;
  assetId: string;
  title: string;
  platform: SocialPlatformId;
  views: number;
  completionRate: number | null;
  followers: number;
  /** 一条观众原话（复盘时留的评论样本）。空 = 没留样。 */
  commentSample: string;
}

/**
 * 深墨主角卡。四个域共用一张卡，换的是内容——每个域给「这一域此刻最该看的那条」。
 *
 * `title` 由派生侧查好一并给出：renderer 再拿 id 去数组里找一遍，等于把同一份
 * 查找写第二遍，且两处对「找不到时怎么办」的处理迟早不一致。
 */
export type OpsDarkCard =
  | {
      kind: 'topic';
      topicId: string | null;
      title: string | null;
      platform: SocialPlatformId | null;
      source: OpsTopicSource | null;
      hotness: number | null;
      idleDays: number | null;
    }
  | {
      kind: 'asset';
      assetId: string | null;
      title: string | null;
      platform: SocialPlatformId | null;
      progress: number | null;
      idleDays: number | null;
    }
  | {
      kind: 'schedule';
      assetId: string | null;
      title: string | null;
      platform: SocialPlatformId | null;
      at: string | null;
    }
  | {
      kind: 'review';
      topId: string | null;
      title: string | null;
      platform: SocialPlatformId | null;
      topViews: number | null;
      /** 领跑差距 = 第 1 名 − 第 2 名。不足两条时为 null。 */
      gap: number | null;
      /** 领先百分比 = 差距 ÷ 第 2 名。 */
      leadPct: number | null;
    }
  | {
      kind: 'direction';
      directionId: string | null;
      /** 定位；还没结构化时回落到人给的原话。 */
      title: string | null;
      platform: SocialPlatformId | null;
      /** 待确认修订的提议时刻。`null` = 没有修订在等。 */
      proposedAt: string | null;
      /** 距上次更新的天数。 */
      idleDays: number | null;
    };

export interface OpsTopicView {
  domain: 'topic';
  metrics: OpsMetric[];
  lead: { pending: number; fromHotspot: number; focusId: string | null };
  pool: OpsTopicRow[];
  dist: OpsDistBar[];
  dark: OpsDarkCard;
}

export interface OpsAssetView {
  domain: 'asset';
  metrics: OpsMetric[];
  lead: { producing: number; dueToday: number; blockedId: string | null };
  pool: OpsAssetRow[];
  dist: OpsDistBar[];
  dark: OpsDarkCard;
}

export interface OpsScheduleView {
  domain: 'schedule';
  metrics: OpsMetric[];
  lead: { thisWeek: number; emptyDays: number; nextId: string | null };
  pool: OpsScheduleDay[];
  dist: OpsDistBar[];
  dark: OpsDarkCard;
}

/** 趋势图的一天：按**发布日**聚合的播放量。 */
export interface OpsTrendPoint {
  /** 本地日期 `YYYY-MM-DD`。 */
  date: string;
  views: number;
}

/** 趋势图窗口天数。 */
export const OPS_TREND_DAYS = 15;

export interface OpsReviewView {
  domain: 'review';
  metrics: OpsMetric[];
  lead: { published: number; totalViews: number; bestId: string | null };
  pool: OpsReviewRow[];
  dist: OpsDistBar[];
  /**
   * 近 `OPS_TREND_DAYS` 天按发布日聚合的播放量，缺数据的日子补 0。
   *
   * 口径是「这天发布的内容有多少播放」，不是「这天的播放量」——台账只有每条
   * 内容的累计播放，没有逐日曲线。写成「每日播放」会是假仪表盘。
   */
  series: OpsTrendPoint[];
  /**
   * 建议卡：沉淀下来的规则，按置信度降序。
   *
   * 建议不是渲染层现算的洞察——它读的是 `rules`，也就是上一轮复盘真的写下来的
   * 结论。没有规则就是空卡，不编。
   */
  advice: OpsRule[];
  /** 有数据的日期区间，给列表副标题用。 */
  range: { from: string | null; to: string | null };
  /** 距最近一次复盘的天数；null = 一条复盘都没有。 */
  lastReviewDaysAgo: number | null;
  dark: OpsDarkCard;
}

export type OpsView =
  | OpsTopicView
  | OpsAssetView
  | OpsScheduleView
  | OpsReviewView
  | OpsDirectionView;

/* ── 方向域 ───────────────────────────────────────────────────── */

/**
 * 一个平台的方向行。
 *
 * `draft` 与「没有方向」是两件事：没有方向 = 这个账号还没被定义过（写一句原话
 * 就行）；`draft` = 有原话但还没结构化（点一次「交给 Agent 整理」）。
 */
export interface OpsDirectionRow {
  /**
   * 记录 id。`null` = 这个平台还没有方向记录 —— 账号在台账里出现过（有选题或
   * 素材），但没被定义过。这种行只能「写方向」，没有可采纳的修订。
   */
  id: string | null;
  platform: SocialPlatformId;
  brief: string;
  positioning: string;
  audience: string;
  pillars: string[];
  goal: string;
  cadence: string;
  status: OpsDirectionStatus;
  /** 有修订在等确认。 */
  hasProposal: boolean;
  /** 待确认的修订本身。采纳 / 驳回之前必须让人看到「改成这样」。 */
  proposal: OpsDirectionProposal | null;
  /** 修订的理由，列表副文本优先用它 —— 人此刻要判断的正是这次改动。 */
  proposalRationale: string | null;
  /** 距上次更新的天数。没有记录时为 null。 */
  idleDays: number | null;
}

export interface OpsDirectionView {
  domain: 'direction';
  metrics: OpsMetric[];
  lead: {
    /** 已生效的方向数。 */
    active: number;
    /** 有修订待确认的方向数。 */
    pending: number;
    /** 拿到焦点的那条（有修订的优先，其次最久没动的）。 */
    focusId: string | null;
  };
  pool: OpsDirectionRow[];
  finalize: OpsFinalizeRow[];
  dark: OpsDarkCard;
}

/**
 * 一个平台的定稿进度。
 *
 * 之前这张卡画的是「每平台有多少条已生效的方向」的分布条 —— 但方向是**一个
 * 平台一条**（store 的硬不变量），所以那个数永远是 0 或 1，条画出来是满的或
 * 空的，没有信息。真正要看的是「这个号走到哪一步了、卡在谁那儿、多久没动」。
 */
export type OpsFinalizeStage = 'none' | 'brief' | 'structured' | 'final';

export interface OpsFinalizeRow {
  platform: SocialPlatformId;
  /**
   * 走到哪一步：
   * - `none` —— 平台上还没有方向记录
   * - `brief` —— 有原话，Agent 还没结构化
   * - `structured` —— 有结构化产物，但还没定稿（status 不是 active）
   * - `final` —— 已定稿
   */
  stage: OpsFinalizeStage;
  /**
   * 有修订等确认。压在 stage 之上：一条已定稿的方向被 Agent 提了修订，它同时
   * 是「已定稿」和「有人在等你点头」。
   */
  pending: boolean;
  /** 距上次定稿几天。`null` = 没定过稿，或定过但没记下时刻（老记录）。 */
  finalizedDays: number | null;
  /** 距最后一次写几天。 */
  updatedDays: number | null;
  /** 距修订提议几天。 */
  proposedDays: number | null;
  /**
   * 最后一次写这条方向的是谁。`null` = 没记下（老记录）。
   *
   * 它跟 `updatedDays` 说的是同一件事的两面：那是「多久没动」，这是「谁动的」。
   */
  touchedBy: OpsActor | null;
  /**
   * 这一行**现在等谁**。`null` = 没人等（还没开始，或已经定稿且没人提修订）。
   *
   * 它跟 `touchedBy` 不是一回事：`touchedBy` 是历史（上次谁动的），这是当下
   * （该谁动）。两件事各说各的，混在一列里就变成「Agent 动过所以等 Agent」——
   * Agent 动过恰恰说明它已经干完了。
   */
  waitingOn: OpsActor | null;
}

/**
 * 这一行现在等谁。
 *
 * 判据是**台账里已有的事实**，不猜：
 * - 有修订在等 → 等**人**点头：采纳 / 驳回是人的动作，Agent 不能自己点头。
 * - 有原话、还没派过工 → 等**人**派：Agent 不知道有人让它干这个活，说「等
 *   Agent」就是在骗人（人以为不用管，方向就永远停在那儿）。
 * - 有原话、派过工 → 等**Agent** 整理。
 * - 半张方向（结构化了但没定稿）→ 等**Agent** 补齐。
 * - 已定稿且没人提修订 → 没人等。
 */
function waitingOnOf(
  stage: OpsFinalizeStage,
  hasProposal: boolean,
  dispatchedAt: string | null,
): OpsActor | null {
  if (stage === 'final') return hasProposal ? 'user' : null;
  if (stage === 'structured') return 'agent';
  if (stage === 'brief') return dispatchedAt ? 'agent' : 'user';
  return null;
}

export function deriveDirectionView(state: OpsState, now: Date): OpsDirectionView {
  const { directions } = state;
  const active = directions.filter((d) => d.status === 'active').length;
  // 真值判定而不是 `!== null`：台账里可能**根本没有** proposal 键（老文件、
  // 手改过的文件），`undefined !== null` 为真会把每一条方向都算成「有修订」，
  // 界面于是给每行都挂上采纳 / 驳回，点下去后端只能报「没有待确认的修订」。
  const pending = directions.filter((d) => Boolean(d.proposal)).length;

  const rows: OpsDirectionRow[] = directions.map((d) => ({
    id: d.id,
    platform: d.platform,
    brief: d.brief,
    positioning: d.positioning,
    audience: d.audience,
    pillars: d.pillars,
    goal: d.goal,
    cadence: d.cadence,
    status: d.status,
    hasProposal: Boolean(d.proposal),
    proposal: d.proposal ?? null,
    proposalRationale: d.proposal?.rationale ?? null,
    idleDays: idleDays(d.updatedAt, now),
  }));

  // 有内容但还没立方向的平台也要出现，否则「这个号没定义过」在界面里根本
  // 不可见 —— 而它恰恰是人最该处理的一行。平台清单从台账里已有的记录推，
  // 不另养一份。
  const covered = new Set(rows.map((row) => row.platform));
  const platformsInUse = new Set<SocialPlatformId>();
  for (const topic of state.topics) platformsInUse.add(topic.platform);
  for (const asset of state.assets) platformsInUse.add(asset.platform);
  for (const platform of [...platformsInUse].sort()) {
    if (covered.has(platform)) continue;
    rows.push({
      id: null,
      platform,
      brief: '',
      positioning: '',
      audience: '',
      pillars: [],
      goal: '',
      cadence: '',
      status: 'draft',
      hasProposal: false,
      proposal: null,
      proposalRationale: null,
      idleDays: null,
    });
  }

  // 排序：没定义过的先上（一步就能做完），其次有修订要点头的（在等人做事），
  // 最后是最久没动过的（越久越可能已经偏了）。
  const pool = [...rows].sort((a, b) => {
    const rank = (row: OpsDirectionRow) => {
      if (row.id === null) return 0;
      if (row.hasProposal) return 1;
      return 2;
    };
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (b.idleDays ?? 0) - (a.idleDays ?? 0);
  });

  const focus = pool[0] ?? null;
  const focusSource = focus?.id ? directions.find((d) => d.id === focus.id) : undefined;

  // 定稿进度按**平台**列行，而且没定稿的平台也要占一行（空值行）。
  //
  // 之前这里数的是「每平台有多少条已生效的方向」，可方向是**一个平台一条**
  // （store 的硬不变量），那个数永远是 0 或 1 —— 条画出来不是满的就是空的，
  // 没有信息。真正能看的是「这个号走到哪一步、卡在谁那儿、多久没动」。
  //
  // 空值行不是凑数：它就是「这个号还没立方向」这件事本身，跟上面的方向列表
  // 逐行对得上。
  const usedPlatforms = new Set<SocialPlatformId>([
    ...directions.map((d) => d.platform),
    ...platformsInUse,
  ]);
  const platformRows = SOCIAL_PLATFORMS.map((p) => p.id).filter((id) => usedPlatforms.has(id));

  const finalize: OpsFinalizeRow[] = platformRows.map((platform) => {
    const d = directions.find((x) => x.platform === platform);
    if (!d) {
      return {
        platform,
        stage: 'none',
        pending: false,
        finalizedDays: null,
        updatedDays: null,
        proposedDays: null,
        touchedBy: null,
        waitingOn: null,
      };
    }
    const stage: OpsFinalizeStage =
      d.status === 'active' ? 'final' : d.positioning.trim() !== '' ? 'structured' : 'brief';
    const hasProposal = Boolean(d.proposal);
    return {
      platform,
      stage,
      pending: hasProposal,
      finalizedDays: daysSince(d.finalizedAt, now),
      updatedDays: daysSince(d.updatedAt, now),
      proposedDays: daysSince(d.proposal?.proposedAt, now),
      // `?? null` 而不是直接取值：老台账里可能**根本没有**这个键，前端拿到的是
      // `undefined` 而不是 `null`，而 `undefined !== null` 为真 —— 「没人动过」
      // 会被读成「有人动过」。
      touchedBy: d.lastTouchedBy ?? null,
      // 派工时刻同理：老台账里没这个键 = 还没派过。
      waitingOn: waitingOnOf(stage, hasProposal, d.dispatchedAt ?? null),
    };
  });

  return {
    domain: 'direction',
    metrics: [
      { key: 'ops.metric.direction.active', value: active, unit: 'count' },
      { key: 'ops.metric.direction.pending', value: pending, unit: 'count' },
      { key: 'ops.metric.direction.covered', value: directions.length, unit: 'count' },
    ],
    lead: { active, pending, focusId: focus?.id ?? null },
    pool,
    finalize,
    dark: {
      kind: 'direction',
      directionId: focus?.id ?? null,
      title: focus ? focus.positioning || focus.brief || null : null,
      platform: focus?.platform ?? null,
      proposedAt: focusSource?.proposal?.proposedAt ?? null,
      idleDays: focus?.idleDays ?? null,
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 素材在管线里的位置。`pending` / `scheduled` 由 `scheduledAt` 派生，不是存储
 * 状态；`unverified` 是存储状态（`OpsAssetStatus`），单独成一档是因为它和
 * `published` 之间差的不是流程位置，而是「有没有平台侧证据」——混在一起显示
 * 会让「提交了」看起来像「发出去了」。
 */
export type OpsAssetSlot = 'draft' | 'pending' | 'scheduled' | 'unverified' | 'published';

const TOPIC_SOURCE_ORDER: readonly OpsTopicSource[] = ['hotspot', 'benchmark', 'reflection', 'manual'];

const ASSET_SLOT_ORDER: readonly OpsAssetSlot[] = [
  'draft',
  'pending',
  'scheduled',
  'unverified',
  'published',
];

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 本周一 00:00（本地时区）。周一是一周的第一天。 */
export function startOfWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  const dow = (day.getDay() + 6) % 7; // 周一 = 0
  day.setDate(day.getDate() - dow);
  return day;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** 本地日期键 `YYYY-MM-DD`。 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function isInWeek(date: Date | null, weekStart: Date, weekEnd: Date): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= weekStart.getTime() && t < weekEnd.getTime();
}

/** 距某个时刻过去了多少天（向下取整）。 */
export function idleDays(since: string, now: Date): number {
  const from = parseDate(since);
  if (!from) return 0;
  const diff = now.getTime() - from.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

/**
 * 距某个时刻过去了多少天。**没有这个时刻就是 `null`**，不是 0。
 *
 * `idleDays` 把「没有 / 解析不了」都算成 0 天（它只回答「多久没动」，0 天就是
 * 今天动过）。这里不行：「上次定稿」没有这个时刻，界面要能说出「不知道」，
 * 0 天会被读成「今天定的稿」。
 */
function daysSince(since: string | null | undefined, now: Date): number | null {
  if (!since) return null;
  if (!parseDate(since)) return null;
  return idleDays(since, now);
}

interface DistEntry {
  key: string;
  value: number;
}

/**
 * 分布条。`pct` 是**占总数的份额**，不是相对最大值。
 *
 * 为什么不是相对最大值：那张卡叫「分布」，分布的定义是各部分加起来是全部。
 * 相对最大值编码的是**排名**（谁最多），它冒充分布 —— 四个来源各 1 条时，
 * 相对最大值给出四根满条，界面上读起来像「四个来源都是大头」，实际每个都
 * 只占四分之一。份额编码下同一组数据是四根 25%，加上就是 100%。
 *
 * 份额的分母是**榜上这些条的总和**（`distTotal`），不是整个台账 —— 分母必须
 * 等于被分的那堆东西，否则各条加起来不到 100%，份额就成了悬空的百分比。
 *
 * **收到的条目一条不落全进榜**，包括值为 0 的。留不留 0 值行由调用方定：
 * `countEntries` 先把没数到的维度滤掉（来源、状态这类「没发生就不该占行」）；
 * 方向域的「定稿进度」反过来**故意**留下 0 值行——「这个号还没立方向」本身
 * 就是要看见的一件事，滤掉就等于把没定义过的平台藏起来。
 */
function buildBars(kind: OpsDistKind, entries: DistEntry[]): OpsDistBar[] {
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  return entries.map((e) => ({
    kind,
    key: e.key,
    value: e.value,
    pct: total > 0 ? Math.round((e.value / total) * 100) : 0,
  }));
}

/**
 * 一张分布卡的总 —— 份额的分母。
 *
 * 就是榜上各条之和：份额编码的诚实前提是「这些条加起来是全部」，所以分母
 * 必须是**被分的那堆条**。台账里被滤掉的条目（还没发生的来源、还没排的素材）
 * 不在这张卡的口径里，进了分母就成了另一个口径。
 */
export function distTotal(bars: OpsDistBar[]): number {
  return bars.reduce((sum, b) => sum + b.value, 0);
}

/** 按固定顺序数条数（来源、状态这类有流程含义的维度）。 */
function countEntries<T>(items: T[], keyOf: (item: T) => string, order: readonly string[]): DistEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => ({ key, value: counts.get(key) ?? 0 }));
}

/** 按值求和后从大到小排（平台这类排名维度）。 */
function sumEntries<T>(items: T[], keyOf: (item: T) => string, valueOf: (item: T) => number): DistEntry[] {
  const sums = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    sums.set(key, (sums.get(key) ?? 0) + valueOf(item));
  }
  return [...sums.entries()]
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/** 素材在管线里的位置。排期不是独立实体，是素材字段的投影。 */
export function assetSlot(asset: OpsAsset): OpsAssetSlot {
  if (asset.status === 'published') return 'published';
  if (asset.status === 'unverified') return 'unverified';
  if (asset.status === 'ready') return asset.scheduledAt ? 'scheduled' : 'pending';
  return 'draft';
}

function topicPriority(a: OpsTopic, b: OpsTopic): number {
  const ha = a.hotness ?? -1;
  const hb = b.hotness ?? -1;
  if (ha !== hb) return hb - ha;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function deriveTopicView(state: OpsState, now: Date): OpsTopicView {
  // 选题池 = 还没产出、也没被放弃的选题。`planned` 留在池子里，因为它还在路上。
  const poolTopics = state.topics.filter((t) => t.status === 'idea' || t.status === 'planned');
  const pending = state.topics.filter((t) => t.status === 'idea').length;
  const produced = state.topics.filter((t) => t.status === 'produced').length;
  const fromHotspot = poolTopics.filter((t) => t.source === 'hotspot').length;

  const sorted = [...poolTopics].sort(topicPriority);
  const pool: OpsTopicRow[] = sorted.map((t) => ({
    id: t.id,
    title: t.title,
    platform: t.platform,
    sub: t.angle || t.note,
    hotness: t.hotness,
  }));

  const top = sorted[0] ?? null;

  return {
    domain: 'topic',
    metrics: [
      { key: 'ops.metric.topic.pending', value: pending, unit: 'count' },
      { key: 'ops.metric.topic.produced', value: produced, unit: 'count' },
      { key: 'ops.metric.topic.hotspot', value: fromHotspot, unit: 'count' },
    ],
    lead: { pending, fromHotspot, focusId: top?.id ?? null },
    pool,
    dist: buildBars('topicSource', countEntries(poolTopics, (t) => t.source, TOPIC_SOURCE_ORDER)),
    dark: {
      kind: 'topic',
      topicId: top?.id ?? null,
      title: top?.title ?? null,
      platform: top?.platform ?? null,
      source: top?.source ?? null,
      hotness: top?.hotness ?? null,
      idleDays: top ? idleDays(top.updatedAt, now) : null,
    },
  };
}

export function deriveAssetView(state: OpsState, now: Date): OpsAssetView {
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const todayStart = startOfLocalDay(now);

  const drafts = state.assets.filter((a) => a.status === 'draft');
  const producing = drafts.length;
  // 「今天该收尾」= 开工了但今天还没动过。用更新时间代理，state.json 不另存完成时间。
  const dueToday = drafts.filter((a) => {
    const updated = parseDate(a.updatedAt);
    return updated !== null && updated.getTime() < todayStart.getTime();
  }).length;

  const doneThisWeek = state.assets.filter((a) => {
    if (a.status === 'draft') return false;
    const updated = parseDate(a.updatedAt);
    return isInWeek(updated, weekStart, weekEnd);
  }).length;

  // 制作中的池子只放「还在做」的。`unverified` 不是在做——内容已经提交出去了，
  // 差的是核实，混进来会让「卡在 100% 好几天」看起来像制作停滞。
  // ponytail: 未核实的素材目前只在状态分布条上可见；需要一个专门的角落时再加。
  const notPublished = state.assets.filter(
    (a) => a.status !== 'published' && a.status !== 'unverified',
  );
  const pool: OpsAssetRow[] = [...notPublished]
    .sort((a, b) => {
      const bucket = (x: OpsAsset) => (x.status === 'draft' ? 0 : 1);
      if (bucket(a) !== bucket(b)) return bucket(a) - bucket(b);
      return idleDays(b.updatedAt, now) - idleDays(a.updatedAt, now);
    })
    .map((a) => ({
      id: a.id,
      title: a.title,
      platform: a.platform,
      progress: a.progress,
      idleDays: idleDays(a.updatedAt, now),
    }));

  // 最该收尾 = 制作中、且停滞最久的那条。
  const stalled = [...drafts].sort(
    (a, b) => idleDays(b.updatedAt, now) - idleDays(a.updatedAt, now),
  )[0];

  const pendingSchedule = state.assets.filter((a) => assetSlot(a) === 'pending').length;

  return {
    domain: 'asset',
    metrics: [
      { key: 'ops.metric.asset.producing', value: producing, unit: 'count' },
      { key: 'ops.metric.asset.pendingSchedule', value: pendingSchedule, unit: 'count' },
      { key: 'ops.metric.asset.doneThisWeek', value: doneThisWeek, unit: 'count' },
    ],
    lead: { producing, dueToday, blockedId: stalled?.id ?? null },
    pool,
    dist: buildBars(
      'assetStatus',
      countEntries(state.assets, (a) => assetSlot(a), ASSET_SLOT_ORDER),
    ),
    dark: {
      kind: 'asset',
      assetId: stalled?.id ?? null,
      title: stalled?.title ?? null,
      platform: stalled?.platform ?? null,
      progress: stalled?.progress ?? null,
      idleDays: stalled ? idleDays(stalled.updatedAt, now) : null,
    },
  };
}

export function deriveScheduleView(state: OpsState, now: Date): OpsScheduleView {
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);

  const scheduled = state.assets
    .map((asset) => ({ asset, at: parseDate(asset.scheduledAt) }))
    .filter((x): x is { asset: OpsAsset; at: Date } => x.at !== null);

  const inWeek = scheduled.filter((x) => isInWeek(x.at, weekStart, weekEnd));
  const upcomingInWeek = inWeek.filter((x) => x.at.getTime() >= now.getTime());

  const days: OpsScheduleDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(weekStart, i);
    const entries = inWeek
      .filter((x) => localDateKey(x.at) === localDateKey(day))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((x) => ({
        id: x.asset.id,
        title: x.asset.title,
        platform: x.asset.platform,
        at: x.asset.scheduledAt as string,
      }));
    days.push({ date: localDateKey(day), assets: entries, empty: entries.length === 0 });
  }

  const emptyDays = days.filter((d) => d.empty).length;

  // 下一条 = 全量排期里最早的那条未到时间的素材（不限本周）。
  const next = scheduled
    .filter((x) => x.at.getTime() >= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];

  const pendingSchedule = state.assets.filter((a) => assetSlot(a) === 'pending').length;

  return {
    domain: 'schedule',
    metrics: [
      { key: 'ops.metric.schedule.thisWeek', value: upcomingInWeek.length, unit: 'count' },
      { key: 'ops.metric.schedule.pending', value: pendingSchedule, unit: 'count' },
      { key: 'ops.metric.schedule.emptyDays', value: emptyDays, unit: 'count' },
    ],
    lead: { thisWeek: inWeek.length, emptyDays, nextId: next?.asset.id ?? null },
    pool: days,
    dist: buildBars(
      'platform',
      sumEntries(
        inWeek.map((x) => x.asset),
        (a) => a.platform,
        () => 1,
      ),
    ),
    dark: {
      kind: 'schedule',
      assetId: next?.asset.id ?? null,
      title: next?.asset.title ?? null,
      platform: next?.asset.platform ?? null,
      at: next?.asset.scheduledAt ?? null,
    },
  };
}

export function deriveReviewView(state: OpsState, now: Date): OpsReviewView {
  const reviews = state.reviews;
  const totalViews = reviews.reduce((sum, r) => sum + r.metrics.views, 0);
  const totalInteractions = reviews.reduce(
    (sum, r) => sum + r.metrics.likes + r.metrics.comments + r.metrics.shares + r.metrics.saves,
    0,
  );

  // 完播率只按有值的算——平台不给这个指标时不能当 0 拉低均值。
  const rates = reviews
    .map((r) => r.metrics.completionRate)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  const completion =
    rates.length > 0 ? rates.reduce((sum, r) => sum + r, 0) / rates.length : null;

  const titleOf = (review: OpsReview): string =>
    state.assets.find((a) => a.id === review.assetId)?.title ?? '';

  const pool: OpsReviewRow[] = [...reviews]
    .sort((a, b) => b.metrics.views - a.metrics.views)
    .slice(0, 5)
    .map((r) => ({
      reviewId: r.id,
      assetId: r.assetId,
      title: titleOf(r),
      platform: r.platform,
      views: r.metrics.views,
      completionRate: r.metrics.completionRate,
      followers: r.metrics.followers,
      commentSample: r.commentSample ?? '',
    }));

  const ranked = [...reviews].sort((a, b) => b.metrics.views - a.metrics.views);
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const gap = top && second ? top.metrics.views - second.metrics.views : null;
  const leadPct =
    gap !== null && second && second.metrics.views > 0
      ? Math.round((gap / second.metrics.views) * 100)
      : null;

  const publishedDates = reviews
    .map((r) => parseDate(r.publishedAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const latest = publishedDates[publishedDates.length - 1] ?? null;

  const byDay = new Map<string, number>();
  for (const r of reviews) {
    const published = parseDate(r.publishedAt);
    if (!published) continue;
    const key = localDateKey(published);
    byDay.set(key, (byDay.get(key) ?? 0) + r.metrics.views);
  }
  const series: OpsTrendPoint[] = [];
  for (let i = OPS_TREND_DAYS - 1; i >= 0; i -= 1) {
    const key = localDateKey(addDays(startOfLocalDay(now), -i));
    series.push({ date: key, views: byDay.get(key) ?? 0 });
  }

  return {
    domain: 'review',
    metrics: [
      { key: 'ops.metric.review.views', value: totalViews, unit: 'compact' },
      { key: 'ops.metric.review.interactions', value: totalInteractions, unit: 'compact' },
      { key: 'ops.metric.review.completion', value: completion, unit: 'percent' },
    ],
    lead: { published: reviews.length, totalViews, bestId: top?.assetId ?? null },
    pool,
    dist: buildBars(
      'platform',
      sumEntries(reviews, (r) => r.platform, (r) => r.metrics.views),
    ),
    series,
    // 生效的规则优先：`proposed` 还没被用户点头，压在后面。
    advice: [...state.rules]
      .sort((a, b) => {
        const rank = (r: OpsRule) => (r.status === 'active' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.confidence - a.confidence;
      })
      .slice(0, 3),
    range: {
      from: publishedDates[0] ? publishedDates[0].toISOString() : null,
      to: latest ? latest.toISOString() : null,
    },
    lastReviewDaysAgo: latest ? idleDays(latest.toISOString(), now) : null,
    dark: {
      kind: 'review',
      topId: top?.assetId ?? null,
      title: top ? titleOf(top) : null,
      platform: top?.platform ?? null,
      topViews: top?.metrics.views ?? null,
      gap,
      leadPct,
    },
  };
}

/** 按域取视图。 */
export function deriveOpsView(state: OpsState, domain: OpsDomainId, now: Date): OpsView {
  switch (domain) {
    case 'direction':
      return deriveDirectionView(state, now);
    case 'topic':
      return deriveTopicView(state, now);
    case 'asset':
      return deriveAssetView(state, now);
    case 'schedule':
      return deriveScheduleView(state, now);
    case 'review':
      return deriveReviewView(state, now);
  }
}
