/**
 * 运营视图的共享数据契约。
 *
 * **权威写者是 Rust 侧 `src-tauri/src/ops_store.rs`**——schema、校验、原子写
 * 都在那边。本文件给 renderer / CLI / sidecar 提供类型与枚举，不提供写路径。
 *
 * 枚举在这里再写一份，是因为 Rust 与 TypeScript 之间没有共享类型机制；
 * 两侧漂移的后果是「Rust 写出一个界面读不出来的状态值」。防线是 Rust 里的
 * `ops_enum_parity` 单测反向校对这份文件的枚举字面量——所以**改这里的状态值，
 * 必须同步改 Rust 的枚举**，否则那条单测会红。
 *
 * 落盘形态见 `docs/OPS-VIEW.md`，界面见 `docs/OPS-VIEW-UI.md`。
 */

import type { SocialPlatformId } from './socialPlatforms';

/** Sino（运营 Agent 模板）的模板 id。运营视图只对它创建的工作区可见。 */
export const SINO_TEMPLATE_ID = 'sino';

/** `ops/state.json` 的结构版本。 */
export const OPS_STATE_VERSION = 1;

/** 状态文件在工作区内的相对路径。 */
export const OPS_STATE_RELATIVE_PATH = 'ops/state.json';

/** 素材文件在工作区内的相对目录。 */
export const OPS_ASSETS_RELATIVE_DIR = 'ops/assets';

/**
 * 五个域。排期不是独立实体，是素材排期字段的投影。
 *
 * `direction`（方向）是唯一一个**按平台**而不是按记录排的域：一个平台一条，
 * 讲的是「这个账号写给谁、讲什么、要达成什么」。其余四域是流水线，方向是
 * 流水线的输入。
 */
export type OpsDomainId = 'topic' | 'asset' | 'schedule' | 'review' | 'direction';

export const OPS_DOMAIN_IDS: readonly OpsDomainId[] = [
  'direction',
  'topic',
  'asset',
  'schedule',
  'review',
];

/** 台账记录类型。写入 / 删除时用来指明是哪一类。 */
export type OpsItemKind =
  | 'topic'
  | 'asset'
  | 'review'
  | 'rule'
  | 'style'
  | 'direction'
  | 'account';

export const OPS_ITEM_KINDS: readonly OpsItemKind[] = [
  'topic',
  'asset',
  'review',
  'rule',
  'style',
  'direction',
  'account',
];

/** 选题状态：想法 → 排进制作 → 已产出。 */
export type OpsTopicStatus = 'idea' | 'planned' | 'produced' | 'dropped';

export const OPS_TOPIC_STATUSES: readonly OpsTopicStatus[] = ['idea', 'planned', 'produced', 'dropped'];

/** 选题来源：热点 / 对标 / 手动 / 复盘回流。 */
export type OpsTopicSource = 'hotspot' | 'benchmark' | 'manual' | 'reflection';

export const OPS_TOPIC_SOURCES: readonly OpsTopicSource[] = [
  'hotspot',
  'benchmark',
  'manual',
  'reflection',
];

/**
 * 素材状态：草稿 → 定稿 → （已投放 | 未核实）。
 *
 * `unverified` = 已经点过提交，但**没有平台侧证据**证明它真的发出去了。
 * 它和 `published` 的区别就是这一条证据：`published` 只由发布后的回读
 * （到创作者后台的作品列表里找到这条）置位。界面上两者必须视觉可分——
 * 把「提交了」显示成「发出去了」是这套自动化里唯一不可逆的谎。
 */
export type OpsAssetStatus = 'draft' | 'ready' | 'published' | 'unverified';

export const OPS_ASSET_STATUSES: readonly OpsAssetStatus[] = [
  'draft',
  'ready',
  'published',
  'unverified',
];

/** 规则状态：提议 → 生效。 */
export type OpsRuleStatus = 'proposed' | 'active';

export const OPS_RULE_STATUSES: readonly OpsRuleStatus[] = ['proposed', 'active'];

/** 规则来源：反思 / 手动 / 对话。 */
export type OpsRuleSource = 'reflection' | 'manual' | 'dialog';

export const OPS_RULE_SOURCES: readonly OpsRuleSource[] = ['reflection', 'manual', 'dialog'];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export const isOpsTopicStatus = (value: unknown): value is OpsTopicStatus =>
  isOneOf(value, OPS_TOPIC_STATUSES);

export const isOpsTopicSource = (value: unknown): value is OpsTopicSource =>
  isOneOf(value, OPS_TOPIC_SOURCES);

export const isOpsAssetStatus = (value: unknown): value is OpsAssetStatus =>
  isOneOf(value, OPS_ASSET_STATUSES);

export const isOpsRuleStatus = (value: unknown): value is OpsRuleStatus =>
  isOneOf(value, OPS_RULE_STATUSES);

export const isOpsRuleSource = (value: unknown): value is OpsRuleSource =>
  isOneOf(value, OPS_RULE_SOURCES);

export const isOpsDirectionStatus = (value: unknown): value is OpsDirectionStatus =>
  isOneOf(value, OPS_DIRECTION_STATUSES);

export const isOpsLoginState = (value: unknown): value is OpsLoginState =>
  isOneOf(value, OPS_LOGIN_STATES);

/** 一条选题：值得做成什么，还不含成品。 */
export interface OpsTopic {
  id: string;
  title: string;
  /** 为什么值得做。 */
  note: string;
  /** 切入角度。 */
  angle: string;
  platform: SocialPlatformId;
  tags: string[];
  status: OpsTopicStatus;
  source: OpsTopicSource;
  /** 热点 / 对标的来源线索。 */
  sourceRefs: string[];
  /**
   * 参考内容的播放量。`null` = 没有可比的参考内容，界面显示「—」而不是 0。
   */
  hotness: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 一段分镜。 */
export interface OpsShot {
  no: number;
  visual: string;
  voice: string;
  seconds: number;
}

/** 一条素材：正文 + 封面 + 配图（+ 分镜），到「可以直接投放」为止。 */
export interface OpsAsset {
  id: string;
  /**
   * 素材来自哪条选题。`null` = 手动导入的稿件，不挂选题——导入的素材是常见
   * 起点，不该被迫先建一条选题才能记。
   */
  topicId: string | null;
  title: string;
  /** 正文 / 脚本。 */
  body: string;
  /**
   * 这条内容要宣传的产品 / 服务。空 = 纯内容，不带转化。
   *
   * **为什么挂在素材上而不是选题上**：选题的 `angle` 是「从哪个角度切」，
   * 而产品和转化目标是这条内容最终要对齐的东西——同一条选题换个产品就是
   * 另一条内容。两边都放等于同一个字符串有两个权威，迟早不一致。
   */
  product: string;
  /** 期望观众做的动作（关注 / 进店 / 领券…）。和 `product` 一起构成 CTA 的锚。 */
  cta: string;
  /**
   * 原始物料在工作区里的位置，如 `ops/assets/imported/2026-11-15/折叠桌批次/`。
   *
   * **为什么需要它**：入库时人是丢一批原件进来的（产品图 + 卖点说明 + 禁用词），
   * 素材字段放的是成品。做稿子时得回原件看卖点，没有这个指针就只能靠记忆猜——
   * 而记忆活不过一轮对话。落在账本里，跨会话、跨心跳都还在。
   */
  sourceRef: string | null;
  /** 工作区内的相对路径，如 `ops/assets/cover.png`。 */
  cover: string | null;
  images: string[];
  shots: OpsShot[];
  platform: SocialPlatformId;
  /** 排期时间。`null` = 未排期。 */
  scheduledAt: string | null;
  status: OpsAssetStatus;
  publishedAt: string | null;
  /**
   * 平台侧的作品 id。发布后回读（在创作者后台的作品列表里匹配到这一条）才
   * 填得出来，所以 `null` 是常态：提交了但没核实，就还没有它。
   */
  platformWorkId: string | null;
  /** 制作完成度 0–100。Agent 每次改素材更新一次。 */
  progress: number;
  createdAt: string;
  updatedAt: string;
}

/** 一条素材的表现数据。 */
export interface OpsReviewMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  followers: number;
  /** 完播率 0–1。`null` = 平台不给这个指标。 */
  completionRate: number | null;
}

/** 一条复盘：已投放素材的表现 + 人工结论。 */
export interface OpsReview {
  id: string;
  assetId: string;
  platform: SocialPlatformId;
  publishedAt: string;
  metrics: OpsReviewMetrics;
  note: string;
  createdAt: string;
}

/** 规则卡下方的对照条。 */
export interface OpsEvidenceBar {
  name: string;
  /** 展示值，如 `1.8×`。 */
  val: string;
  /** 条长 0–100。 */
  pct: number;
  /** 次要项（对照组）。 */
  mut?: boolean;
}

/** 一条沉淀下来的规则，反哺选题与制作。 */
export interface OpsRule {
  id: string;
  name: string;
  rule: string;
  source: OpsRuleSource;
  status: OpsRuleStatus;
  confidence: number;
  evidence: string;
  /**
   * 对照条。**由反思侧算好存下**，前端只渲染——按属性分组跨内容求均值是
   * 一台分析引擎，放在渲染层算等于把业务逻辑塞进组件里。
   */
  evidenceBars?: OpsEvidenceBar[];
  createdAt: string;
}

/**
 * 一条运营方向：**一个平台一条**。
 *
 * 分工不对称，这是这张卡存在的全部理由：
 * - `brief` 是人写的原话，可以很模糊（「想让人记住我们是懂露营装备的」）。
 * - `positioning` / `audience` / `pillars` / `goal` / `cadence` 是 Agent 把这句
 *   模糊的话结构化出来的产物，人只在采纳修订时点头。
 *
 * 没有 `brief` 的方向是凭空编的，没有结构化字段的方向是不能执行的。两者都
 * 允许暂时缺失（`status: 'draft'`），但只有 `active` 的方向才算「定下来了」。
 */
export interface OpsDirection {
  id: string;
  platform: SocialPlatformId;
  /** 人给的原话。可以很模糊 —— 结构化是 Agent 的活。 */
  brief: string;
  /** 这个账号一句话定位。空 = 还没结构化。 */
  positioning: string;
  /** 写给谁看。 */
  audience: string;
  /** 内容支柱：反复讲的几件事。选题从这里长出来。 */
  pillars: string[];
  /** 要达成什么（涨粉 / 转化 / 品牌认知…）。 */
  goal: string;
  /** 节奏，如「每周 3 条，周二 / 四 / 六」。 */
  cadence: string;
  /** `draft` = 还没结构化，`active` = 定下来了。 */
  status: OpsDirectionStatus;
  /**
   * Agent 提请的修订。**嵌套在记录里而不是第二条记录**：采纳修订必须是
   * 一次原子操作（写新值 + 清 proposal），拆成两条记录就要靠跨记录的不变量
   * 保证「每平台只有一条 active」，并发写守不住。
   */
  proposal: OpsDirectionProposal | null;
  createdAt: string;
  updatedAt: string;
}

/** 方向状态：草稿 → 生效。 */
export type OpsDirectionStatus = 'draft' | 'active';

export const OPS_DIRECTION_STATUSES: readonly OpsDirectionStatus[] = ['draft', 'active'];

/**
 * 登录态的**缓存值**。
 *
 * `unknown` 是默认档，也是最保守的一档：没确认过就当没登录——宁可多问一次人，
 * 也不要拿一个可能是假的「已登录」去自动发布。
 */
export type OpsLoginState = 'unknown' | 'success' | 'expired';

export const OPS_LOGIN_STATES: readonly OpsLoginState[] = ['unknown', 'success', 'expired'];

/**
 * 一条待确认的修订。字段是**完整的新值**，不是差异 —— 人看到的是「改成
 * 这样」，确认就整段替换。给差异等于让人在脑子里做合并。
 */
export interface OpsDirectionProposal {
  /** 建议的新定位 / 受众 / 支柱 / 目标 / 节奏。 */
  positioning: string;
  audience: string;
  pillars: string[];
  goal: string;
  cadence: string;
  /** 为什么要改。 */
  rationale: string;
  /** 支撑这次修订的证据，如「近 14 天 3 条晚 9 点发布的内容完播率高 40%」。 */
  evidence: string;
  /** 提议时刻。 */
  proposedAt: string;
}

/**
 * 一个工作区里、某个平台的账号：**一个平台一条**。
 *
 * 这是「账号体系跟着工作区走」的落点。同一个平台在两个工作区里是两个不同的
 * 账号——各自的登录态存在各自的浏览器 profile 里，互不可见。
 *
 * `loginState` 是**缓存的确认**，不是实时状态：登录态的真正权威是浏览器
 * cookie，界面显示的是「上次确认登录成功」。cookie 掉了而这里还写着
 * `success` 是可能的，所以字段名不叫 `loggedIn`。
 */
export interface OpsAccount {
  id: string;
  platform: SocialPlatformId;
  /** 人给这个号起的名字（「露营装备小王」）。空 = 还没起。 */
  displayName: string;
  /** 上次确认的登录态。默认 `unknown` = 从没确认过。 */
  loginState: OpsLoginState;
  /** 上次确认登录状态的时刻（ISO 8601）。`null` = 从没确认过。 */
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 风格卡：工作区级，单条。 */
export interface OpsStyle {
  id: string;
  name: string;
  summary: string;
  tone: string;
  sentences: string[];
  opening: string;
  structure: string;
  words: string[];
  avoid: string[];
  samples: string[];
  updatedAt: string;
}

/** `ops/state.json` 的完整形态。 */
export interface OpsState {
  version: number;
  /** 每平台一条。key 是 `platform`，由 Rust 侧校验唯一。 */
  directions: OpsDirection[];
  /** 每平台一条。账号清单是**工作区级**的——新建工作区就是一套新账号体系。 */
  accounts: OpsAccount[];
  topics: OpsTopic[];
  assets: OpsAsset[];
  reviews: OpsReview[];
  rules: OpsRule[];
  style: OpsStyle | null;
}

/** 合法空骨架。模板初始化与「文件不存在」时用它，不产生第二个写者。 */
export function emptyOpsState(): OpsState {
  return {
    version: OPS_STATE_VERSION,
    directions: [],
    accounts: [],
    topics: [],
    assets: [],
    reviews: [],
    rules: [],
    style: null,
  };
}

/**
 * 每种记录可写的字段。写入载荷是**补丁**：只有出现的键会被写进去。
 *
 * 写者有三种（`hamuna ops` CLI、运营面板、跑 skill 的 Agent），它们几乎从不是
 * 「重建整条记录」，而是「改其中几个字段」。让写者回填没改的字段，等于把实体
 * 结构复制到每个写者里——加一个字段要改三处，三处迟早漂移。合并在 Rust 的
 * `ops_store` 里做一次（锁内），写者只发自己动过的键。
 */
export interface OpsUpsertFieldMap {
  topic: Partial<OpsTopic>;
  asset: Partial<OpsAsset>;
  review: Partial<Omit<OpsReview, 'metrics'>> & { metrics?: Partial<OpsReviewMetrics> };
  rule: Partial<OpsRule>;
  style: Partial<OpsStyle>;
  direction: Partial<OpsDirection>;
  account: Partial<OpsAccount>;
}

/** 写入载荷：`kind` + 这次要动的字段。 */
export type OpsUpsertPayload = {
  [K in OpsItemKind]: { kind: K } & OpsUpsertFieldMap[K];
}[OpsItemKind];

