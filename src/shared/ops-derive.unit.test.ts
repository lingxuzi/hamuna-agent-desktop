import { describe, it, expect } from 'vitest';
import type { OpsAsset, OpsDirection, OpsReview, OpsRule, OpsState, OpsTopic } from './ops';
import {
  deriveAssetView,
  deriveDirectionView,
  deriveOpsView,
  deriveReviewView,
  deriveScheduleView,
  deriveTopicView,
  distTotal,
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

function rule(patch: Partial<OpsRule> & Pick<OpsRule, 'id'>): OpsRule {
  return {
    name: patch.id,
    rule: '',
    source: 'reflection',
    status: 'active',
    confidence: 0.6,
    basis: 'verified',
    evidence: '',
    createdAt: '2026-11-01T09:00:00',
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
    clues: [],
    benchmarks: [],
    materials: [],
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
    // 四个来源各 1 条 = 池子里的 4 条，各占四分之一。
    //
    // 这条断言原来写的是 100 —— 相对最大值编码下四个来源都是满条，界面上读起来
    // 像「四个来源都是大头」，实际每个只占四分之一。那是排名，不是分布。
    expect(view.dist.every((d) => d.value === 1 && d.pct === 25)).toBe(true);
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

  it('状态分布按流程顺序，条长是占总数的份额', () => {
    // 8 条素材里草稿 2 条 = 25%。不是 100% —— 100% 是「它是最多的那项」，
    // 那不是份额，是排名：卡上写着 2，条却是满的，读者会当成「全在这儿」。
    expect(view.dist.map((d) => [d.key, d.value, d.pct])).toEqual([
      ['draft', 2, 25],
      ['pending', 1, 13],
      ['scheduled', 2, 25],
      ['unverified', 1, 13],
      ['published', 2, 25],
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

describe('规则的新鲜度', () => {
  it('依据过期的规则不再进建议，但要说清有几条过期了', () => {
    // 过期不等于「没有」。一条靠三个月前的数据说出来的结论，被当成今天的观察
    // 去选题，比没有这条结论更糟 —— 所以它要退出建议；同时不能静默消失。
    const view = deriveReviewView(
      state({
        rules: [
          rule({ id: 'r-fresh', confidence: 0.9, sampledAt: '2026-11-12T09:00:00' }),
          rule({ id: 'r-stale', confidence: 0.8, sampledAt: '2026-08-01T09:00:00' }),
        ],
      }),
      NOW,
    );
    expect(view.advice.map((r) => r.id)).toEqual(['r-fresh']);
    expect(view.staleRules).toBe(1);
  });

  it('没记采样时刻的规则照旧进建议', () => {
    // 老台账的规则没有采样时刻。它们不知道多久了，但也不能因此一刀切空 ——
    // 那等于升级就把所有人的规则判死刑。要修的是「从下一轮开始记时刻」。
    const view = deriveReviewView(
      state({ rules: [rule({ id: 'r-undated', confidence: 0.7 })] }),
      NOW,
    );
    expect(view.advice.map((r) => r.id)).toEqual(['r-undated']);
    expect(view.staleRules).toBe(0);
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
      finalizedAt: null,
      lastTouchedBy: null,
      dispatchedAt: null,
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

  it('台账里没有 proposal 键时，不算「有修订」', () => {
    // 老文件、手改过的文件都可能**根本没有** proposal 这个键。前端拿到的是
    // `undefined`，而 `undefined !== null` 为真 —— 用 `!== null` 判会给每一条
    // 方向都挂上采纳 / 驳回，点下去后端只能报「没有待确认的修订」。
    const withoutKey = { ...direction({ id: 'dir-douyin', platform: 'douyin' }) };
    delete (withoutKey as Partial<OpsDirection>).proposal;

    const view = deriveDirectionView(state({ directions: [withoutKey] }), NOW);

    expect(view.pool[0].hasProposal).toBe(false);
    expect(view.pool[0].proposal).toBeNull();
    expect(view.lead.pending).toBe(0);
  });

  it('有修订的行把修订本身带到界面上（采纳前要看得见「改成这样」）', () => {
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            proposal: { positioning: '夜间露营装备测评', rationale: '晚间数据更好' },
          }),
        ],
      }),
      NOW,
    );

    expect(view.pool[0].hasProposal).toBe(true);
    expect(view.pool[0].proposal).toMatchObject({
      positioning: '夜间露营装备测评',
      rationale: '晚间数据更好',
    });
    expect(view.lead.pending).toBe(1);
  });

  it('定稿进度按平台列行，没定稿的平台也占一行（空值行）', () => {
    // 空值行不是凑数：它就是「这个号还没立方向」这件事本身。少了它，
    // 只立了一条方向时整张卡只剩一行，剩下的空间全堆在卡底，看着像
    // 渲染坏了。而且卡上写的是「按平台」，列出来的也必须是平台。
    const view = deriveDirectionView(
      state({
        directions: [
          direction({ id: 'dir-douyin', platform: 'douyin', status: 'active' }),
          direction({ id: 'dir-xhs', platform: 'xiaohongshu', status: 'draft' }),
        ],
        topics: [topic({ id: 't1', platform: 'bilibili' })],
      }),
      NOW,
    );

    expect(view.finalize.map((d) => [d.platform, d.stage])).toEqual([
      ['xiaohongshu', 'brief'],
      ['douyin', 'final'],
      ['bilibili', 'none'],
    ]);
    // 只有一条方向时也要有行（不是空数组）。
    expect(view.finalize.length).toBeGreaterThan(0);
  });

  it('台账里完全没碰过的平台不占行', () => {
    // 空值行只针对「这个号在用但还没立方向」；没用过的平台不该挤进来。
    const view = deriveDirectionView(
      state({ directions: [direction({ id: 'dir-douyin', platform: 'douyin', status: 'active' })] }),
      NOW,
    );

    expect(view.finalize.map((d) => d.platform)).toEqual(['douyin']);
  });

  it('定稿进度读的是「定稿那一刻」，不是最后一次写', () => {
    // `updatedAt` 是最后一次写：Agent 提一次修订就会刷新它。拿它当「定稿于」
    // 是在撒谎 —— 方向可能三个月前就定了，昨天只是有人提了个修订。
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            status: 'active',
            createdAt: '2026-11-01T09:00:00',
            updatedAt: '2026-11-12T09:00:00',
            finalizedAt: '2026-11-10T09:00:00',
          }),
        ],
      }),
      NOW,
    );

    expect(view.finalize[0]).toMatchObject({
      stage: 'final',
      finalizedDays: 3,
      updatedDays: 1,
    });
  });

  it('定过稿但没记下时刻的老记录，finalizedDays 是 null 而不是 0', () => {
    // 0 会被读成「今天定的稿」。不知道就该说不知道。
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            status: 'active',
            updatedAt: '2026-11-01T09:00:00',
            finalizedAt: null,
          }),
        ],
      }),
      NOW,
    );

    expect(view.finalize[0]).toMatchObject({ stage: 'final', finalizedDays: null, updatedDays: 12 });
  });

  it('有修订在等时，pending 压在 stage 之上', () => {
    // 一条已定稿的方向被 Agent 提了修订，它同时是「已定稿」和「有人在等你
    // 点头」—— 卡片上要能同时说清这两件事。
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            status: 'active',
            proposal: { positioning: '夜间露营装备测评', proposedAt: '2026-11-12T09:00:00' },
          }),
        ],
      }),
      NOW,
    );

    expect(view.finalize[0]).toMatchObject({
      stage: 'final',
      pending: true,
      proposedDays: 1,
    });
  });

  it('只有原话、还没派过工时，等的是人不是 Agent', () => {
    // Agent 不知道有人让它干这个活。写成「等 Agent」就是在骗人：人以为不用管，
    // 方向就永远停在那儿 —— 静默停滞是最坏的一种坏。
    const view = deriveDirectionView(
      state({
        directions: [direction({ id: 'dir-douyin', platform: 'douyin', brief: '想让人记住我们' })],
      }),
      NOW,
    );

    expect(view.finalize[0]).toMatchObject({ stage: 'brief', waitingOn: 'user' });
  });

  it('派过工就改口等 Agent —— 派工这件事必须有事实记着', () => {
    const view = deriveDirectionView(
      state({
        directions: [
          direction({
            id: 'dir-douyin',
            platform: 'douyin',
            brief: '想让人记住我们',
            dispatchedAt: '2026-11-12T09:00:00',
          }),
        ],
      }),
      NOW,
    );

    expect(view.finalize[0]).toMatchObject({ stage: 'brief', waitingOn: 'agent' });
  });

  it('等谁看的是「该谁动」，不是「上次谁动过」', () => {
    // 四种状态各说各的：采纳 / 驳回是人的动作，结构化是 Agent 的活。
    const view = deriveDirectionView(
      state({
        directions: [
          // 已定稿，没人提修订：没人等。
          direction({ id: 'dir-a', platform: 'douyin', status: 'active' }),
          // 已定稿，有修订在等：等**人**点头。
          direction({
            id: 'dir-b',
            platform: 'xiaohongshu',
            status: 'active',
            proposal: { positioning: '夜间露营装备测评', proposedAt: '2026-11-12T09:00:00' },
          }),
          // 结构化了但没定稿：Agent 的活没干完。
          direction({ id: 'dir-c', platform: 'bilibili', positioning: '装备实测' }),
          // 完全没碰过：不占「等谁」，它不是卡住，是还没开始。
          direction({ id: 'dir-d', platform: 'zhihu', brief: '先放着' }),
        ],
        topics: [topic({ id: 't1', platform: 'kuaishou' })],
      }),
      NOW,
    );

    const waiting = Object.fromEntries(view.finalize.map((d) => [d.platform, d.waitingOn]));
    expect(waiting).toEqual({
      douyin: null,
      xiaohongshu: 'user',
      bilibili: 'agent',
      zhihu: 'user',
      kuaishou: null,
    });
  });
});

describe('分布条审计：每一根条都是真计数', () => {
  // 方向域曾经有一张「每平台有多少条已生效方向」的分布条 —— 那是**假指标**：
  // 方向是一个平台一条（store 的硬不变量），所以那个数永远是 0 或 1，条画出来
  // 不是满的就是空的，读者却以为「这根短 = 这个号弱」。它已经换成「定稿进度」
  // 那张表（见 `OpsFinalizeCard`）。
  //
  // 其余三域（选题来源 / 素材状态 / 排期平台 / 复盘平台）看着是真分布，但没逐个
  // 量过。量法只有一个：**同一条维度上落 N 条记录，那根条的值必须是 N** ——
  // 被压成 1 就说明有人在拿它当「有 / 没有」用，而它不是。

  it('选题来源分布数的是条数，不是「有没有热点」', () => {
    const view = deriveTopicView(
      state({
        topics: [
          topic({ id: 't1', source: 'hotspot' }),
          topic({ id: 't2', source: 'hotspot' }),
          topic({ id: 't3', source: 'hotspot' }),
        ],
      }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.value])).toEqual([['hotspot', 3]]);
  });

  it('素材状态分布数的是条数，不是「做到哪一步」', () => {
    const view = deriveAssetView(
      state({
        assets: [
          asset({ id: 'a1', status: 'draft' }),
          asset({ id: 'a2', status: 'draft' }),
          asset({ id: 'a3', status: 'draft' }),
        ],
      }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.value])).toEqual([['draft', 3]]);
  });

  it('排期平台分布数的是本周排期条数', () => {
    const view = deriveScheduleView(
      state({
        assets: [
          asset({ id: 'a1', platform: 'douyin', scheduledAt: '2026-11-10T10:00:00' }),
          asset({ id: 'a2', platform: 'douyin', scheduledAt: '2026-11-11T10:00:00' }),
          asset({ id: 'a3', platform: 'douyin', scheduledAt: '2026-11-12T10:00:00' }),
        ],
      }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.value])).toEqual([['douyin', 3]]);
  });

  it('复盘平台分布求的是播放量之和，不是条数', () => {
    const view = deriveReviewView(
      state({
        reviews: [
          review({ id: 'r1', platform: 'douyin', metrics: { views: 100, likes: 0, comments: 0, shares: 0, saves: 0, followers: 0, completionRate: null } }),
          review({ id: 'r2', platform: 'douyin', metrics: { views: 200, likes: 0, comments: 0, shares: 0, saves: 0, followers: 0, completionRate: null } }),
          review({ id: 'r3', platform: 'douyin', metrics: { views: 300, likes: 0, comments: 0, shares: 0, saves: 0, followers: 0, completionRate: null } }),
        ],
      }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.value])).toEqual([['douyin', 600]]);
  });

  it('方向域不再有分布条 —— 那张表是「走到哪一步」，不是计数', () => {
    // 假指标一旦被当成"真分布"搬回来，这条断言是唯一的拦截。
    const view = deriveDirectionView(
      state({
        directions: [
          {
            id: 'dir-douyin',
            platform: 'douyin',
            brief: '',
            positioning: '',
            audience: '',
            pillars: [],
            goal: '',
            cadence: '',
            status: 'active',
            proposal: null,
            createdAt: '2026-11-01T09:00:00',
            updatedAt: '2026-11-01T09:00:00',
            finalizedAt: null,
            lastTouchedBy: null,
            dispatchedAt: null,
          },
        ],
      }),
      NOW,
    );

    expect((view as unknown as Record<string, unknown>).dist).toBeUndefined();
    expect(view.finalize).toHaveLength(1);
  });
});

describe('分布条的长度口径：占全部的份额', () => {
  // 条长是「这一项占全部的百分之多少」，不是「它是最多的百分之多少」。
  //
  // 相对最大值编码的问题是它编码的是**排名**，却长在叫「分布」的卡上：四个
  // 来源各 1 条时四根全满，读者读成「四个来源都是大头」；两个总量差 4 倍的
  // 域，最长的那根在两张卡上一样长，量级差在条上完全看不出来。
  //
  // 份额编码把这两件事都还原成真话：各条加起来是全部，满条只在真的占满时
  // 出现（一个来源独占时）。分母是榜上各条之和 —— 份额的分母必须等于被分的
  // 那堆条，否则各条加起来不到 100%，百分比就是悬空的。

  it('条长是占总数的份额', () => {
    const view = deriveAssetView(
      state({
        assets: [
          asset({ id: 'a1', status: 'draft' }),
          asset({ id: 'a2', status: 'draft' }),
          asset({ id: 'a3', status: 'draft' }),
          asset({ id: 'a4', status: 'published' }),
        ],
      }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.value, d.pct])).toEqual([
      ['draft', 3, 75],
      ['published', 1, 25],
    ]);
  });

  it('榜上各条加起来是全部 —— 分母就是榜上这些条', () => {
    const view = deriveAssetView(
      state({
        assets: [
          asset({ id: 'a1', status: 'draft' }),
          asset({ id: 'a2', status: 'draft' }),
          asset({ id: 'a3', status: 'ready' }),
          asset({ id: 'a4', status: 'published' }),
          asset({ id: 'a5', status: 'published' }),
        ],
      }),
      NOW,
    );

    expect(distTotal(view.dist)).toBe(5);
    // 四舍五入会让百分比之和在 99–101 之间抖，所以断言的是「约等于 100」。
    const pctSum = view.dist.reduce((sum, d) => sum + d.pct, 0);
    expect(pctSum).toBeGreaterThanOrEqual(99);
    expect(pctSum).toBeLessThanOrEqual(101);
  });

  it('只有一个来源时那根是满条 —— 满条只在真的占满时出现', () => {
    const view = deriveTopicView(
      state({ topics: [topic({ id: 't1', source: 'hotspot' })] }),
      NOW,
    );

    expect(view.dist.map((d) => [d.key, d.pct])).toEqual([['hotspot', 100]]);
  });

  it('总量差几倍，条长照样可比 —— 份额是绝对可比的量', () => {
    // 两个域，同一个比例，条长必须一样；不同的比例，条长必须不一样。
    // 相对最大值编码下这两张卡的最长条都是 100%，量级差 4 倍在条上看不出来。
    const small = deriveAssetView(
      state({
        assets: [
          asset({ id: 'a1', status: 'draft' }),
          asset({ id: 'a2', status: 'draft' }),
          asset({ id: 'a3', status: 'draft' }),
          asset({ id: 'a4', status: 'published' }),
        ],
      }),
      NOW,
    );
    const big = deriveAssetView(
      state({
        assets: [
          asset({ id: 'b1', status: 'draft' }),
          asset({ id: 'b2', status: 'draft' }),
          asset({ id: 'b3', status: 'draft' }),
          asset({ id: 'b4', status: 'draft' }),
          asset({ id: 'b5', status: 'draft' }),
          asset({ id: 'b6', status: 'draft' }),
          asset({ id: 'b7', status: 'draft' }),
          asset({ id: 'b8', status: 'draft' }),
          asset({ id: 'b9', status: 'draft' }),
          asset({ id: 'b10', status: 'draft' }),
          asset({ id: 'b11', status: 'draft' }),
          asset({ id: 'b12', status: 'draft' }),
          asset({ id: 'b13', status: 'published' }),
          asset({ id: 'b14', status: 'published' }),
          asset({ id: 'b15', status: 'published' }),
          asset({ id: 'b16', status: 'published' }),
        ],
      }),
      NOW,
    );

    expect(distTotal(small.dist)).toBe(4);
    expect(distTotal(big.dist)).toBe(16);
    // 3/4 和 12/16 是同一个比例 → 同样长
    expect(small.dist[0].pct).toBe(big.dist[0].pct);
    // 3/4 和 4/16 不是同一个比例 → 不一样长
    expect(small.dist[0].pct).not.toBe(big.dist[1].pct);
  });

  it('一个数都没有时条长是 0，不是 NaN', () => {
    const view = deriveAssetView(state({ assets: [] }), NOW);

    expect(view.dist).toEqual([]);
    expect(distTotal(view.dist)).toBe(0);
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
