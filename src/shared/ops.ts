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

/** 四个域。排期不是独立实体，是素材排期字段的投影。 */
export type OpsDomainId = 'topic' | 'asset' | 'schedule' | 'review';

export const OPS_DOMAIN_IDS: readonly OpsDomainId[] = ['topic', 'asset', 'schedule', 'review'];

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

/** 素材状态：草稿 → 定稿 → 已投放。 */
export type OpsAssetStatus = 'draft' | 'ready' | 'published';

export const OPS_ASSET_STATUSES: readonly OpsAssetStatus[] = ['draft', 'ready', 'published'];

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
  /** 工作区内的相对路径，如 `ops/assets/cover.png`。 */
  cover: string | null;
  images: string[];
  shots: OpsShot[];
  platform: SocialPlatformId;
  /** 排期时间。`null` = 未排期。 */
  scheduledAt: string | null;
  status: OpsAssetStatus;
  publishedAt: string | null;
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
    topics: [],
    assets: [],
    reviews: [],
    rules: [],
    style: null,
  };
}
