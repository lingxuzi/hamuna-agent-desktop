import { describe, it, expect } from 'vitest';
import type { OpsAsset, OpsDirection, OpsReview, OpsState, OpsTopic } from './ops';
import {
  deriveAssetView,
  deriveDirectionView,
  deriveOpsView,
  deriveReviewView,
  deriveScheduleView,
  deriveTopicView,
} from './ops-derive';

/** 2026-11-13 周五 10:00（本地）。所有时间用本地分量构造，测试不依赖机器时区。 */
const NOW = new Date(2026, 10, 13, 10, 0, 0);

function topic(patch: Partial<OpsTopic> & Pick<OpsTopic, 'id'>): OpsTopic {
  return {
    title: patch.id,
    note: '',
    angle: '',
    platform: 'xiaohongshu',
    tags: [],
    status: 'idea',
    source: 'manual',
    sourceRefs: [],
    hotness: null,
    createdAt: '2026-11-01T09:00:00',
    updatedAt: '2026-11-01T09:00:00',
    ...patch,
  };
}

function asset(patch: Partial<OpsAsset> & Pick<OpsAsset, 'id'>): OpsAsset {
  return {
    topicId: 't1',
    title: patch.id,
    body: '',
    product: '',
    cta: '',
    sourceRef: null,
    cover: null,
    images: [],
    shots: [],
    platform: 'douyin',
    scheduledAt: null,
    status: 'draft',
    publishedAt: null,
    platformWorkId: null,
    progress: 0,
    createdAt: '2026-11-01T09:00:00',
    updatedAt: '2026-11-01T09:00:00',
    ...patch,
  };
}

function review(patch: Partial<OpsReview> & Pick<OpsReview, 'id'>): OpsReview {
  return {
    assetId: 'a1',
    platform: 'douyin',
    publishedAt: '2026-11-10T10:00:00',
    metrics: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      followers: 0,
      completionRate: null,
    },
    note: '',
    createdAt: '2026-11-10T10:00:00',
    ...patch,
  };
}

function state(patch: Partial<OpsState> = {}): OpsState {
  return {
    version: 1,
    directions: [],
    accounts: [],
    topics: [],
    assets: [],
    reviews: [],
    rules: [],
    style: null,
    ...patch,
  };
}

const TOPICS: OpsTopic[] = [
  topic({
    id: 't1',
    title: '出租屋灯光改造 · 第二期',
    platform: 'xiaohongshu',
    source: 'hotspot',
    hotness: 86000,
    updatedAt: '2026-11-12T09:00:00',
  }),
  topic({
    id: 't2',
    title: '早八人的早餐 · 第三期',
    platform: 'douyin',
    source: 'benchmark',
    hotness: 62000,
    updatedAt: '2026-11-13T08:00:00',
  }),
  topic({
    id: 't3',
    title: '小户型收纳 · 避坑',
    platform: 'xiaohongshu',
    source: 'manual',
    hotness: null,
    updatedAt: '2026-11-10T09:00:00',
  }),
  topic({
    id: 't4',
    title: '梅雨天家电除味 · 复刻',
    platform: 'weixin-channels',
    source: 'reflection',
    status: 'planned',
    hotness: 34000,
    updatedAt: '2026-11-11T09:00:00',
  }),
  topic({
    id: 't5',
    title: '已产出的选题',
    source: 'hotspot',
    status: 'produced',
    hotness: 50000,
    updatedAt: '2026-11-09T09:00:00',
  }),
  topic({ id: 't6', title: '放弃的选题', source: 'manual', status: 'dropped', hotness: 1000 }),
];

const ASSETS: OpsAsset[] = [
  asset({
    id: 'a1',
    title: '出租屋灯光改造',
    platform: 'xiaohongshu',
    status: 'draft',
    progress: 80,
    updatedAt: '2026-11-11T10:00:00',
  }),
  asset({
    id: 'a2',
    title: '早八人的早餐',
    status: 'draft',
    progress: 45,
    updatedAt: '2026-11-12T10:00:00',
  }),
  asset({
    id: 'a3',
    title: '梅雨天家电除味',
    platform: 'weixin-channels',
    status: 'ready',
    progress: 100,
    updatedAt: '2026-11-13T09:00:00',
  }),
  asset({
    id: 'a4',
    title: '通勤穿搭 5 分钟',
    platform: 'douyin',
    status: 'ready',
    progress: 100,
    scheduledAt: '2026-11-14T08:00:00',
    updatedAt: '2026-11-12T10:00:00',
  }),
  asset({
    id: 'a5',
    title: '早八人的早餐 · 投放版',
    status: 'published',
    publishedAt: '2026-11-10T10:00:00',
    updatedAt: '2026-11-10T10:00:00',
  }),
  asset({
    id: 'a6',
    title: '出租屋灯光改造 · 投放版',
    platform: 'xiaohongshu',
    status: 'published',
    publishedAt: '2026-11-05T10:00:00',
    updatedAt: '2026-11-05T10:00:00',
  }),
  asset({
    id: 'a7',
    title: '下周才发',
    platform: 'douyin',
    status: 'ready',
    scheduledAt: '2026-11-17T12:00:00',
    updatedAt: '2026-11-13T08:00:00',
  }),
  asset({
    id: 'a8',
    title: '提交了但回读不到',
    status: 'unverified',
    progress: 100,
    updatedAt: '2026-11-13T07:00:00',
  }),
];

const REVIEWS: OpsReview[] = [
  review({
    id: 'r1',
    assetId: 'a5',
    platform: 'douyin',
    publishedAt: '2026-11-10T10:00:00',
    metrics: {
      views: 12847,
      likes: 800,
      comments: 120,
      shares: 90,
      saves: 60,
      followers: 62,
      completionRate: 0.41,
    },
  }),
  review({
    id: 'r2',
    assetId: 'a6',
    platform: 'xiaohongshu',
    publishedAt: '2026-11-05T10:00:00',
    metrics: {
      views: 8412,
      likes: 500,
      comments: 60,
      shares: 30,
      saves: 20,
      followers: 38,
      completionRate: 0.36,
    },
  }),
  review({
    id: 'r3',
    assetId: 'missing-asset',
    platform: 'douyin',
    publishedAt: '2026-11-11T10:00:00',
    metrics: {
      views: 2000,
      likes: 10,
      comments: 0,
      shares: 0,
      saves: 0,
      followers: 5,
      completionRate: null,
    },
  }),
];

const FULL = state({ topics: TOPICS, assets: ASSETS, reviews: REVIEWS });

describe('选题域派生', () => {
  const view = deriveTopicView(FULL, NOW);

  it('待加工只数 idea，产出的与放弃的不算', () => {
    expect(view.metrics[0]).toEqual({
      key: 'ops.metric.topic.pending',
      value: 3,
      unit: 'count',
    });
    expect(view.metrics[1].value).toBe(1);
  });

  it('热点来源按池子里的选题算', () => {
    expect(view.metrics[2].value).toBe(1);
    expect(view.lead.fromHotspot).toBe(1);
  });

  it('池子按热度降序，没有热度的排最后', () => {
    expect(view.pool.map((r) => r.id)).toEqual(['t1', 't2', 't4', 't3']);
  });

  it('没有热度的选题，热度是 null 而不是 0', () => {
    const row = view.pool.find((r) => r.id === 't3');
    expect(row?.hotness).toBeNull();
    expect(String(row?.hotness)).not.toContain('undefined');
  });

  it('来源分布按固定顺序，只出现有数的来源', () => {
    expect(view.dist.map((d) => d.key)).toEqual([
      'hotspot',
      'benchmark',
      'reflection',
      'manual',
    ]);
    expect(view.dist.every((d) => d.value === 1 && d.pct === 100)).toBe(true);
  });

  it('主角卡是热度最高的那条', () => {
    expect(view.dark).toMatchObject({ kind: 'topic', topicId: 't1', hotness: 86000 });
    expect(view.lead.focusId).toBe('t1');
  });
});

describe('素材域派生', () => {
  const view = deriveAssetView(FULL, NOW);

  it('制作中只数草稿', () => {
    expect(view.metrics[0].value).toBe(2);
  });

  it('待排期 = 已定稿但没有排期时间', () => {
    expect(view.metrics[1].value).toBe(1);
  });

  it('本周完成按本周一为起点算，上周的不算', () => {
    // 5 = a3/a4/a5/a7 + a8（unverified 也算本周做完了内容，不算的只有草稿）。
    expect(view.metrics[2].value).toBe(5);
  });

  it('池子里草稿在前，同类按滞留时长倒序', () => {
    expect(view.pool.map((r) => r.id)).toEqual(['a1', 'a2', 'a4', 'a3', 'a7']);
    expect(view.pool[0].idleDays).toBe(2);
  });

  it('主角卡是停滞最久的那条草稿', () => {
    expect(view.dark).toMatchObject({ kind: 'asset', assetId: 'a1', idleDays: 2 });
    expect(view.lead.blockedId).toBe('a1');
  });

  it('今天该收尾数的是今天还没动过的草稿', () => {
    expect(view.lead.dueToday).toBe(2);
  });

  it('状态分布按流程顺序，值相对最大值', () => {
    expect(view.dist.map((d) => [d.key, d.value, d.pct])).toEqual([
      ['draft', 2, 100],
      ['pending', 1, 50],
      ['scheduled', 2, 100],
      ['unverified', 1, 50],
      ['published', 2, 100],
    ]);
  });

  it('unverified 不进「制作中」池子 —— 内容已经交出去了，卡点不在制作', () => {
    expect(view.pool.map((r) => r.id)).not.toContain('a8');
  });
});

describe('排期域派生', () => {
  const view = deriveScheduleView(FULL, NOW);

  it('一周从周一开始', () => {
    expect(view.pool[0].date).toBe('2026-11-09');
    expect(view.pool[6].date).toBe('2026-11-15');
    expect(view.pool).toHaveLength(7);
  });

  it('只算本周内的排期，下周的不算', () => {
    expect(view.lead.thisWeek).toBe(1);
    expect(view.metrics[0].value).toBe(1);
  });

  it('空缺日是本周没有排期的天数', () => {
    expect(view.lead.emptyDays).toBe(6);
    expect(view.metrics[2].value).toBe(6);
  });

  it('主角卡是下一条未到时间的排期', () => {
    expect(view.dark).toMatchObject({ kind: 'schedule', assetId: 'a4' });
    expect(view.lead.nextId).toBe('a4');
  });

  it('本周的排期落在对应的日期行里', () => {
    const saturday = view.pool.find((d) => d.date === '2026-11-14');
    expect(saturday?.assets.map((a) => a.id)).toEqual(['a4']);
    expect(view.pool.find((d) => d.date === '2026-11-09')?.empty).toBe(true);
  });
});

describe('复盘域派生', () => {
  const view = deriveReviewView(FULL, NOW);

  it('总播放是全部复盘之和', () => {
    expect(view.metrics[0]).toEqual({
      key: 'ops.metric.review.views',
      value: 23259,
      unit: 'compact',
    });
  });

  it('总互动含赞、评、转、藏', () => {
    expect(view.metrics[1].value).toBe(1690);
  });

  it('平均完播只按有值的算，缺一个不会被当 0 拉低', () => {
    expect(view.metrics[2].value).toBeCloseTo(0.385, 5);
  });

  it('排行榜按播放严格降序', () => {
    expect(view.pool.map((r) => r.reviewId)).toEqual(['r1', 'r2', 'r3']);
    expect(view.pool.map((r) => r.views)).toEqual([12847, 8412, 2000]);
  });

  it('找不到对应素材时标题留空而不是崩', () => {
    expect(view.pool.find((r) => r.reviewId === 'r3')?.title).toBe('');
  });

  it('领跑优势是第 1 名减第 2 名，百分比以第 2 名为基数', () => {
    expect(view.dark).toMatchObject({ kind: 'review', topId: 'a5', gap: 4435, leadPct: 53 });
  });

  it('平台分布按播放量从大到小', () => {
    expect(view.dist.map((d) => [d.key, d.value])).toEqual([
      ['douyin', 14847],
      ['xiaohongshu', 8412],
    ]);
  });

  it('给出有数据的日期区间与最近一次复盘距今天数', () => {
    expect(view.range.from).not.toBeNull();
    expect(view.lastReviewDaysAgo).toBe(2);
  });
});

describe('方向域', () => {
  function direction(patch: Partial<OpsDirection> & Pick<OpsDirection, 'id' | 'platform'>): OpsDirection {
    return {
      brief: '',
      positioning: '',
      audience: '',
      pillars: [],
      goal: '',
      cadence: '',
      status: 'draft',
      proposal: null,
      createdAt: '2026-11-01T09:00:00',
      updatedAt: '2026-11-01T09:00:00',
      ...patch,
    };
  }

  it('有内容但没立方向的平台也出现在池里，且 id 是 null', () => {
    // 这一行不存在的话，「这个号从来没定义过方向」在界面上完全不可见，
    // 而它恰恰是最该被人处理的一行。
    const view = deriveDirectionView(
      state({ topics: [topic({ id: 't1', platform: 'xiaohongshu' })] }),
      NOW,
    );
    expect(view.pool).toHaveLength(1);
    expect(view.pool[0]).toMatchObject({ id: null, platform: 'xiaohongshu', idleDays: null });
    expect(view.dark).toMatchObject({ kind: 'direction', directionId: null });
  });

  it('排序：没定义过 → 有修订待确认 → 最久没动', () => {
    const view = deriveDirectionView(
      state({
        topics: [topic({ id: 't1', platform: 'bilibili' })],
        directions: [
          direction({ id: 'dir-zhihu', platform: 'zhihu', updatedAt: '2026-11-12T09:00:00' }),
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            proposal: {
              positioning: 'x',
              audience: '',
              pillars: [],
              goal: '',
              cadence: '',
              rationale: '晚间数据更好',
              evidence: '',
              proposedAt: '2026-11-12T09:00:00',
            },
          }),
        ],
      }),
      NOW,
    );
    expect(view.pool.map((row) => row.platform)).toEqual(['bilibili', 'douyin', 'zhihu']);
    expect(view.pool[1].proposalRationale).toBe('晚间数据更好');
  });

  it('修订把定位 / 受众 / 支柱都带出来，但 proposal 只影响 sub 文案', () => {
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            status: 'active',
            brief: '想让人记住我们懂露营装备',
            positioning: '白天露营装备测评',
            audience: '入门者',
            pillars: ['装备实测'],
          }),
        ],
      }),
      NOW,
    );
    // 采纳前主字段不变——修订是待确认的，不该提前生效。
    expect(view.pool[0]).toMatchObject({
      positioning: '白天露营装备测评',
      audience: '入门者',
      pillars: ['装备实测'],
      hasProposal: false,
      proposalRationale: null,
    });
    expect(view.lead).toEqual({ active: 1, pending: 0, focusId: 'dir-douyin' });
  });
});

describe('空数据不炸', () => {
  const empty = state();

  it('五个域都能派生，且不出现 NaN', () => {
    for (const domain of ['direction', 'topic', 'asset', 'schedule', 'review'] as const) {
      const view = deriveOpsView(empty, domain, NOW);
      const values = view.metrics.map((m) => m.value);
      expect(values.some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
      expect(view.pool).toBeDefined();
    }
  });

  it('没有复盘时平均完播是 null，不是 0', () => {
    const view = deriveReviewView(empty, NOW);
    expect(view.metrics[2].value).toBeNull();
    expect(view.dark).toMatchObject({ gap: null, leadPct: null });
  });

  it('没有素材时状态分布为空，主角卡没有实体', () => {
    const view = deriveAssetView(empty, NOW);
    expect(view.dist).toEqual([]);
    expect(view.dark).toMatchObject({ kind: 'asset', assetId: null, idleDays: null });
  });

  it('没有排期时主角卡为空', () => {
    const view = deriveScheduleView(empty, NOW);
    expect(view.dark).toMatchObject({ kind: 'schedule', assetId: null, at: null });
    expect(view.pool).toHaveLength(7);
    expect(view.pool.every((d) => d.empty)).toBe(true);
  });

  it('选题全都没有热度时主角卡仍然是某一条，但热度是 null', () => {
    const view = deriveTopicView(state({ topics: [topic({ id: 't9' })] }), NOW);
    expect(view.dark).toMatchObject({ kind: 'topic', topicId: 't9', hotness: null });
  });
});
