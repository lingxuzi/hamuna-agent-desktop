//! 运营台账（工作区内的 `ops/state.json`）的唯一写者。
//!
//! 三个写者会碰到同一个文件：运营视图（renderer）、`hamuna ops` CLI、跑 skill
//! 的 Agent 进程。三者都从这里读写，所以四条纪律：
//!
//! 1. **锁内读-改-写**（`with_file_lock_blocking`）——裸 read-modify-write 会丢记录。
//! 2. **原子发布**——临时文件 + rename，读者永远看到完整的旧版或新版。
//! 3. **坏文件不覆盖**——解析失败直接报错，绝不拿空状态盖掉用户手写的台账。
//! 4. **不认 symlink**——`ops/` 或 `ops/state.json` 是 symlink 就拒绝读写，
//!    否则一次写就能把台账打到工作区外面去。
//!
//! 数据契约见 `src/shared/ops.ts`（类型 + 枚举），派生口径见
//! `src/shared/ops-derive.ts`（纯函数，不落盘）。两侧枚举靠本文件的
//! `parity_tests` 反向校对——Rust 写出一个界面读不出来的状态值是这个方向
//! 最危险的漂移。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::utils::bom::strip_bom;
use crate::utils::file_lock::{with_file_lock_blocking, FileLockError, FileLockOptions};
use crate::utils::fs_atomic;
use crate::workspace_files::path_safety::{
    resolve_inside_workspace, validate_workspace_root,
};

/// 状态文件在工作区内的相对路径。
pub const OPS_STATE_RELATIVE_PATH: &str = "ops/state.json";

/// 状态文件所在目录（相对路径）。
pub const OPS_DIR_RELATIVE_PATH: &str = "ops";

/// `ops/state.json` 的结构版本。与 `src/shared/ops.ts::OPS_STATE_VERSION` 对齐。
pub const OPS_STATE_VERSION: u32 = 1;

/// 平台 id 白名单。注册表本身在 `src/shared/socialPlatforms.ts`，这里只做**写侧
/// 校验**；两侧靠 `parity_tests::platform_ids_exist_in_ts_registry` 保持同步。
pub const OPS_PLATFORM_IDS: &[&str] = &[
    "xiaohongshu",
    "douyin",
    "kuaishou",
    "weixin-channels",
    "bilibili",
    "zhihu",
    "wechat-mp",
];

// ── 枚举 ────────────────────────────────────────────────────────────

/// 状态 / 来源的缺省值。写者只发自己动过的字段，没发的那几个由这里的 default
/// 兜住——所以这些 default 必须落在「最保守」的那一档（想法 / 草稿 / 提议 /
/// 手动），而不是某个业务上更好看的值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsTopicStatus {
    #[default]
    Idea,
    Planned,
    Produced,
    Dropped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsTopicSource {
    Hotspot,
    Benchmark,
    #[default]
    Manual,
    Reflection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsAssetStatus {
    #[default]
    Draft,
    Ready,
    Published,
    /// 已提交，但**没有平台侧证据**。只有回读到作品列表里的这一条，才升为
    /// `Published`。这个值存在的意义是不让「点过提交」冒充「发出去了」。
    Unverified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsRuleStatus {
    #[default]
    Proposed,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsRuleSource {
    Reflection,
    #[default]
    Manual,
    Dialog,
}

/// 规则的证据性质：这条结论**凭什么**这么说。
///
/// `confidence` 是强度（0–1 浮点），回答「多可信」；这个回答「凭的是什么」。
/// 两者不能互相替代：一个 0.9 的推断仍然是推断——只给强度，界面上分不出
/// 「核实过的 0.5」和「推出来的 0.9」哪个更该当依据。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpsRuleBasis {
    /// 平台侧数据或回读核实过。
    Verified,
    /// 人（或作者）自己说的，没有独立核实。
    AuthorReport,
    /// 从已有数据推断出来的，没有直接对照。
    Inference,
    /// 还没有结论。旧记录没有这个键时落这里——不替旧结论补证据。
    #[default]
    Unresolved,
}

// ── 实体 ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsTopic {
    /// 空 = 让 store 生成。id 由 store 拥有，三个写者不各自造。
    #[serde(default)]
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub angle: String,
    pub platform: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: OpsTopicStatus,
    #[serde(default)]
    pub source: OpsTopicSource,
    #[serde(default)]
    pub source_refs: Vec<String>,
    /// 参考内容的播放量。`None` = 没有可比的参考内容，界面显示「—」而不是 0。
    #[serde(default)]
    pub hotness: Option<u64>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsShot {
    pub no: u32,
    pub visual: String,
    pub voice: String,
    pub seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsAsset {
    #[serde(default)]
    pub id: String,
    /// 素材来自哪条选题。`None` = 手动导入的稿件，不挂选题。
    #[serde(default)]
    pub topic_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// 这条内容要宣传的产品 / 服务。空 = 纯内容，不带转化。
    #[serde(default)]
    pub product: String,
    /// 期望观众做的动作。和 `product` 一起构成 CTA 的锚。
    #[serde(default)]
    pub cta: String,
    /// 原始物料在工作区里的位置，如 `ops/assets/imported/2026-11-15/折叠桌批次/`。
    #[serde(default)]
    pub source_ref: Option<String>,
    /// 工作区内的相对路径，如 `ops/assets/cover.png`。
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub shots: Vec<OpsShot>,
    pub platform: String,
    /// 排期时间。`None` = 未排期。
    #[serde(default)]
    pub scheduled_at: Option<String>,
    #[serde(default)]
    pub status: OpsAssetStatus,
    #[serde(default)]
    pub published_at: Option<String>,
    /// 平台侧作品 id。发布后回读到才填得出来，所以 `None` 是常态。
    #[serde(default)]
    pub platform_work_id: Option<String>,
    /// 制作完成度 0–100。Agent 每次改素材更新一次。
    #[serde(default)]
    pub progress: u32,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsReviewMetrics {
    #[serde(default)]
    pub views: u64,
    #[serde(default)]
    pub likes: u64,
    #[serde(default)]
    pub comments: u64,
    #[serde(default)]
    pub shares: u64,
    #[serde(default)]
    pub saves: u64,
    #[serde(default)]
    pub followers: u64,
    /// 完播率 0–1。`None` = 平台不给这个指标。
    #[serde(default)]
    pub completion_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsReview {
    #[serde(default)]
    pub id: String,
    pub asset_id: String,
    pub platform: String,
    pub published_at: String,
    /// 表现数据可以后补——刚投放还没数据就是全 0。所以这里要 `default`：
    /// 补丁语义下「先建一条复盘、稍后再填指标」是正常用法，缺 `metrics`
    /// 不该让整条记录反序列化失败。
    #[serde(default)]
    pub metrics: OpsReviewMetrics,
    #[serde(default)]
    pub note: String,
    /// 一条观众原话。复盘结论的证据常常就是这一句——「多少人问价」要有原话
    /// 才算证据。留**原文**，不改写。空 = 没留样。
    #[serde(default)]
    pub comment_sample: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsEvidenceBar {
    pub name: String,
    /// 展示值，如 `1.8×`。
    pub val: String,
    /// 条长 0–100。
    pub pct: f64,
    /// 次要项（对照组）。`mut` 是 Rust 关键字，字段名要显式 rename。
    #[serde(rename = "mut", default, skip_serializing_if = "Option::is_none")]
    pub mut_: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsRule {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub rule: String,
    #[serde(default)]
    pub source: OpsRuleSource,
    #[serde(default)]
    pub status: OpsRuleStatus,
    #[serde(default)]
    pub confidence: f64,
    /// 证据性质。强度之外的另一半：这条结论凭什么这么说。
    #[serde(default)]
    pub basis: OpsRuleBasis,
    #[serde(default)]
    pub evidence: String,
    /// 对照条。由反思侧算好存下，前端只渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_bars: Option<Vec<OpsEvidenceBar>>,
    #[serde(default)]
    pub created_at: String,
}

/// 一条运营方向：**一个平台一条**。
///
/// 字段分工不对称：`brief` 是人写的原话（可以很模糊），其余是 Agent 结构化
/// 出来的产物。两个方向共用同一平台会被 `validate_state` 拒掉——「每平台一条」
/// 是结构性的不变量，不是调用方约定。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsDirection {
    #[serde(default)]
    pub id: String,
    pub platform: String,
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub positioning: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub pillars: Vec<String>,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub cadence: String,
    #[serde(default)]
    pub status: OpsDirectionStatus,
    /// 待确认的修订。嵌套在记录里，所以采纳修订是一次原子写。
    ///
    /// **永远写出来**（没有就写 `null`），不能 `skip_serializing_if`：前端类型是
    /// `proposal: OpsDirectionProposal | null` —— 键缺失在前端拿到的是
    /// `undefined` 而不是 `null`，而 `undefined !== null` 为真，「有修订」就会
    /// 对每一条方向都成立：界面给每行都挂上「采纳 / 驳回」，点下去后端只能
    /// 报「没有待确认的修订」。
    #[serde(default)]
    pub proposal: Option<OpsDirectionProposal>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsDirectionStatus {
    #[default]
    Draft,
    Active,
}

/// 一条待确认的修订。
///
/// **没提到的字段 = 这次不改它**（`None`），不是「要清空」。修订常常只动一两个
/// 字段（`--proposal '{"positioning":"…","rationale":"…"}'`），拿空值覆盖会把
/// 方向里没参与讨论的内容整段抹掉。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsDirectionProposal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub positioning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pillars: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence: Option<String>,
    /// 为什么要改。
    #[serde(default)]
    pub rationale: String,
    /// 支撑这次修订的证据。
    #[serde(default)]
    pub evidence: String,
    /// 提议时刻。写台账时若为空由 store 补上——界面要显示「什么时候提的」。
    #[serde(default)]
    pub proposed_at: String,
}

/// 一个工作区里、某个平台的账号：**一个平台一条**。
///
/// 这是「账号体系跟着工作区走」的落点。同一个平台在两个工作区里是两个不同的
/// 账号——各自的登录态存在各自的浏览器 profile 里（见
/// `src-tauri/src/browser_profile.rs`），互不可见。
///
/// `login_state` 是**缓存的确认**，不是实时状态：登录态的真正权威是浏览器
/// cookie，界面显示的是「上次确认登录成功」。cookie 掉了而这里还写着
/// `success` 是可能的，所以字段名不叫 `loggedIn`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsAccount {
    #[serde(default)]
    pub id: String,
    pub platform: String,
    /// 人给这个号起的名字（「露营装备小王」）。空 = 还没起。
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub login_state: OpsLoginState,
    /// 上次确认登录状态的时刻（ISO 8601）。`None` = 从没确认过。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 登录态的缓存值。默认 `unknown` —— 最保守的那一档：没确认过就当没登录。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsLoginState {
    #[default]
    Unknown,
    Success,
    Expired,
}

/// 一条**评论线索**：观众在我们自己作品下面说的话。
///
/// 为什么单独存一条：复盘里只有 `metrics.comments`（评论**数**），那是结果。
/// 观众问「多少钱 / 哪里买 / 怎么用」才是需求本身——选题最该读的东西。
///
/// `comment_id` 是平台侧的评论 id，天然键是 `(platform, comment_id)`：同一段
/// 评论被反复采集只会合并成一条，不会堆出几十条重复。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsClue {
    #[serde(default)]
    pub id: String,
    /// 平台 id。空 = 非法（线索必须知道是哪个平台的话）。
    #[serde(default)]
    pub platform: String,
    /// 我们自己那条素材（作品）。`None` = 还没归到具体素材。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// 平台侧评论 id。**天然键的一半**，空 = 非法。
    #[serde(default)]
    pub comment_id: String,
    /// 楼中楼的上级评论 id。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_comment_id: Option<String>,
    /// 评论者的平台 uid。没读到就空着——别拿昵称当身份，昵称会改。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_uid: Option<String>,
    #[serde(default)]
    pub author_name: String,
    /// 评论正文原文。截断也留着原文，不要改写。
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub intent: OpsClueIntent,
    #[serde(default)]
    pub status: OpsClueStatus,
    /// 跟进备注。状态之外人工补充的判断。
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 线索的**意图**分类：观众到底在问什么。
///
/// 只分四类，不做细粒度 NLP：分类的用处是「这批线索里有多少人在问价」，
/// 四档已经够回答那个问题；再细分只会让写的人纠结。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsClueIntent {
    /// 说不清在问什么。默认档——宁可归到「其他」也别硬猜。
    #[default]
    Other,
    /// 问价格 / 多少钱 / 有没有优惠。
    Price,
    /// 问在哪买 / 链接 / 有没有货。
    Where,
    /// 问怎么用 / 怎么装 / 适不适合我。
    HowTo,
}

/// 线索的处理状态。
///
/// `new` → `qualified` → `archived` 是流水；`qualified` = 值得拿来做选题的
/// 那几条。没进 `qualified` 的不是垃圾，可能只是还没看。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsClueStatus {
    #[default]
    New,
    /// 值得跟进。
    Qualified,
    /// 处理完了，留档。
    Archived,
}

/// 对标账号的来源。
///
/// `agent` = 我找的候选。这种**要等人点头**才落库——方向是策略，对标是
/// 策略的参照系，我自选自用等于没人复核。`user` = 人直接给的，人给的话
/// 本身就是授权。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsBenchmarkSource {
    #[default]
    User,
    Agent,
}

/// 一条**对标账号**：方向相近、规模更大的参照系。
///
/// 只存「为什么对标它」和「核实到的证据」，**不存粉丝数快照**——存了就是个
/// 会过期的数字，过期后它变成一句谎。规模写进 `evidence`（"2026-11-16 公开页
/// 读到 38.2w 粉"），时间在文字里。
///
/// 天然键是 `(platform, profile_url)`：同一个主页反复加只合并成一条。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsBenchmark {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub platform: String,
    /// 账号名 / 昵称。
    #[serde(default)]
    pub name: String,
    /// 主页链接。**天然键的一半**，空 = 非法。
    #[serde(default)]
    pub profile_url: String,
    /// 为什么对标它：定位上的相似点，不是「内容好」。
    #[serde(default)]
    pub why: String,
    /// 核实到的证据（规模、受众、更新频率……）。空 = 还没核实过。
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub source: OpsBenchmarkSource,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsStyle {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub sentences: Vec<String>,
    #[serde(default)]
    pub opening: String,
    #[serde(default)]
    pub structure: String,
    #[serde(default)]
    pub words: Vec<String>,
    #[serde(default)]
    pub avoid: Vec<String>,
    #[serde(default)]
    pub samples: Vec<String>,
    #[serde(default)]
    pub updated_at: String,
}

/// `ops/state.json` 的完整形态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsState {
    pub version: u32,
    /// 每平台一条。唯一性由 `validate_state` 守。
    #[serde(default)]
    pub directions: Vec<OpsDirection>,
    /// 每平台一条。账号清单是**工作区级**的——新建工作区就是一套新账号体系。
    #[serde(default)]
    pub accounts: Vec<OpsAccount>,
    #[serde(default)]
    pub topics: Vec<OpsTopic>,
    #[serde(default)]
    pub assets: Vec<OpsAsset>,
    #[serde(default)]
    pub reviews: Vec<OpsReview>,
    #[serde(default)]
    pub rules: Vec<OpsRule>,
    /// 评论线索（观众在我们作品下面说的话）。天然键 `(platform, comment_id)`。
    #[serde(default)]
    pub clues: Vec<OpsClue>,
    /// 对标账号。天然键 `(platform, profile_url)`。
    #[serde(default)]
    pub benchmarks: Vec<OpsBenchmark>,
    #[serde(default)]
    pub style: Option<OpsStyle>,
}

impl OpsState {
    /// 合法空骨架。文件不存在时用它——不因为「读不到」就顺手建一个文件，
    /// 那是第二个写者。
    pub fn empty() -> Self {
        Self {
            version: OPS_STATE_VERSION,
            directions: Vec::new(),
            accounts: Vec::new(),
            topics: Vec::new(),
            assets: Vec::new(),
            reviews: Vec::new(),
            rules: Vec::new(),
            clues: Vec::new(),
            benchmarks: Vec::new(),
            style: None,
        }
    }
}

/// 记录类型。删除时用来指明删哪一条。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpsItemKind {
    Direction,
    Account,
    Topic,
    Asset,
    Review,
    Rule,
    Style,
    Clue,
    Benchmark,
}

impl OpsItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            OpsItemKind::Direction => "direction",
            OpsItemKind::Account => "account",
            OpsItemKind::Topic => "topic",
            OpsItemKind::Asset => "asset",
            OpsItemKind::Review => "review",
            OpsItemKind::Rule => "rule",
            OpsItemKind::Style => "style",
            OpsItemKind::Clue => "clue",
            OpsItemKind::Benchmark => "benchmark",
        }
    }
}

/// 写入载荷：一个 JSON 对象。`kind` 指明实体类型，其余键是这次要写的字段。
///
/// **为什么是「补丁」而不是「完整实体」**：写者有三种（`hamuna ops` CLI、
/// 运营界面、跑 skill 的 Agent），它们几乎从不是「重建整条记录」，而是
/// 「改其中几个字段」。让写者负责回填没改的字段，等于把实体结构复制到每个
/// 写者里——加一个字段要改三处，而且三处迟早漂移。合并在 store 里做一次
/// （在锁内），写者只发自己动过的那几个键。
///
/// 合并是**深一层**的：嵌套对象（如复盘的 `metrics`）逐键合并，否则
/// 「只改播放量」会把其余五个指标抹掉。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsUpsert {
    pub kind: OpsItemKind,
    /// 实体字段。`kind` 之外的键都在这里。
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

// ── 校验 ────────────────────────────────────────────────────────────

fn check_ids<'a>(kind: &str, ids: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen: HashSet<&str> = HashSet::new();
    for id in ids {
        if id.trim().is_empty() {
            return Err(format!("{} id cannot be empty", kind));
        }
        if !seen.insert(id) {
            return Err(format!("Duplicate {} id: {}", kind, id));
        }
    }
    Ok(())
}

fn check_platform(platform: &str) -> Result<(), String> {
    if OPS_PLATFORM_IDS.contains(&platform) {
        Ok(())
    } else {
        Err(format!("Unknown platform id: {}", platform))
    }
}

/// 读回来的数据必须先过这一关。`state.json` 是人可编辑的文件，坏数据要**报错**
/// 而不是悄悄被当成合法值继续用。
///
/// 不做引用完整性校验（复盘指向不存在的素材不报错）：删一条选题不该连带删掉
/// 它的素材，界面也会把「找不到素材」显示成空标题而不是崩掉。
pub fn validate_state(state: &OpsState) -> Result<(), String> {
    if state.version != OPS_STATE_VERSION {
        return Err(format!(
            "Unsupported ops state version {} (expected {})",
            state.version, OPS_STATE_VERSION
        ));
    }

    check_ids("topic", state.topics.iter().map(|t| t.id.as_str()))?;
    check_ids("asset", state.assets.iter().map(|a| a.id.as_str()))?;
    check_ids("review", state.reviews.iter().map(|r| r.id.as_str()))?;
    check_ids("rule", state.rules.iter().map(|r| r.id.as_str()))?;
    check_ids("direction", state.directions.iter().map(|d| d.id.as_str()))?;
    check_ids("account", state.accounts.iter().map(|a| a.id.as_str()))?;
    check_ids("clue", state.clues.iter().map(|c| c.id.as_str()))?;
    check_ids("benchmark", state.benchmarks.iter().map(|b| b.id.as_str()))?;

    // 「一个平台一条账号」和方向同理：同平台出现两条账号时，界面按平台查会
    // 静默取到其中一条，而取到哪条决定了「发布发到哪个号」。
    let mut seen_account_platforms: HashSet<&str> = HashSet::new();
    for account in &state.accounts {
        check_platform(&account.platform)?;
        if !seen_account_platforms.insert(account.platform.as_str()) {
            return Err(format!(
                "Duplicate account for platform: {} (one account per platform)",
                account.platform
            ));
        }
    }

    // 「一个平台一条方向」在这里守。放进 validate 而不是 upsert，是因为
    // state.json 是人手可编辑的——手抄一份进来也得被拒，否则同一个平台出现
    // 两条方向时，界面按平台查会静默取到其中一条。
    let mut seen_platforms: HashSet<&str> = HashSet::new();
    for direction in &state.directions {
        check_platform(&direction.platform)?;
        if !seen_platforms.insert(direction.platform.as_str()) {
            return Err(format!(
                "Duplicate direction for platform: {} (one direction per platform)",
                direction.platform
            ));
        }
    }

    for topic in &state.topics {
        check_platform(&topic.platform)?;
    }
    for asset in &state.assets {
        check_platform(&asset.platform)?;
        if asset.progress > 100 {
            return Err(format!("Asset {} progress must be 0-100", asset.id));
        }
    }
    for review in &state.reviews {
        check_platform(&review.platform)?;
        if let Some(rate) = review.metrics.completion_rate {
            if !(0.0..=1.0).contains(&rate) {
                return Err(format!(
                    "Review {} completionRate must be between 0 and 1",
                    review.id
                ));
            }
        }
    }
    for rule in &state.rules {
        if !(0.0..=1.0).contains(&rule.confidence) {
            return Err(format!("Rule {} confidence must be between 0 and 1", rule.id));
        }
        if let Some(bars) = &rule.evidence_bars {
            for bar in bars {
                if !(0.0..=100.0).contains(&bar.pct) {
                    return Err(format!(
                        "Rule {} evidence bar pct must be between 0 and 100",
                        rule.id
                    ));
                }
            }
        }
    }

    // 线索的天然键是 `(platform, comment_id)`。同一段评论被采两次就得是一条，
    // 否则「有多少人在问价」会被重复采集的次数灌水。
    let mut seen_clues: HashSet<(&str, &str)> = HashSet::new();
    for clue in &state.clues {
        check_platform(&clue.platform)?;
        if clue.comment_id.trim().is_empty() {
            return Err(format!("Clue {} requires a commentId", clue.id));
        }
        if !seen_clues.insert((clue.platform.as_str(), clue.comment_id.as_str())) {
            return Err(format!(
                "Duplicate clue for platform {} and commentId {}",
                clue.platform, clue.comment_id
            ));
        }
    }

    // 对标账号的天然键是 `(platform, profile_url)`：同一个主页只能有一条，
    // 否则「我们有 3 个对标」可能其实是同一家记了三遍。
    let mut seen_benchmarks: HashSet<(&str, &str)> = HashSet::new();
    for benchmark in &state.benchmarks {
        check_platform(&benchmark.platform)?;
        if benchmark.profile_url.trim().is_empty() {
            return Err(format!("Benchmark {} requires a profileUrl", benchmark.id));
        }
        if !seen_benchmarks.insert((benchmark.platform.as_str(), benchmark.profile_url.as_str())) {
            return Err(format!(
                "Duplicate benchmark for platform {} and profileUrl {}",
                benchmark.platform, benchmark.profile_url
            ));
        }
    }

    Ok(())
}

// ── 路径 ────────────────────────────────────────────────────────────

/// 拒绝 symlink 的目录 / 文件。`fs::symlink_metadata` **不跟随** symlink，
/// 所以这里能看见链接本身；用 `Path::exists()` 探路会跟着链接走，看不见。
fn ensure_not_symlink(path: &Path, what: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(format!(
            "[ops-store] Refusing to use symlinked {}: {}",
            what,
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "[ops-store] Cannot stat {}: {}",
            what, e
        )),
    }
}

struct OpsPaths {
    dir: PathBuf,
    state: PathBuf,
}

fn resolve_ops_paths(workspace_root: &Path) -> Result<OpsPaths, String> {
    let dir = resolve_inside_workspace(workspace_root, OPS_DIR_RELATIVE_PATH)?;
    let state = resolve_inside_workspace(workspace_root, OPS_STATE_RELATIVE_PATH)?;
    ensure_not_symlink(&dir, "ops directory")?;
    ensure_not_symlink(&state, "ops state file")?;
    Ok(OpsPaths { dir, state })
}

// ── 读 ──────────────────────────────────────────────────────────────

/// 读工作区的运营台账。文件不存在 → 空骨架；存在但坏了 → 报错。
///
/// 走 `resolve_existing_inside_workspace`（canonical 读侧）挡住 symlink 逃逸：
/// 仓库里放一个 `ops/state.json → /etc/passwd` 的链接，读一次就把内容带出去了。
pub fn read_state(workspace_root: &Path) -> Result<OpsState, String> {
    let paths = resolve_ops_paths(workspace_root)?;
    read_state_at(&paths.state)
}

/// 读已解析好的路径。锁内复用时不重复做路径解析。
fn read_state_at(state_path: &Path) -> Result<OpsState, String> {
    match fs::symlink_metadata(state_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(OpsState::empty()),
        Err(e) => {
            return Err(format!("[ops-store] Cannot stat ops state: {}", e));
        }
    }

    let raw = fs::read_to_string(state_path)
        .map_err(|e| format!("[ops-store] Cannot read ops state: {}", e))?;
    // 容忍 Windows 编辑器加的 UTF-8 BOM——否则手改过的台账解析失败，
    // 而这个文件本来就是给人手改的。
    let state: OpsState = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("[ops-store] Cannot parse ops state: {}", e))?;
    validate_state(&state)?;
    Ok(state)
}

// ── 写 ──────────────────────────────────────────────────────────────

fn to_io_err(msg: String) -> FileLockError {
    FileLockError::Io(std::io::Error::other(msg))
}

/// 锁内读-改-写，然后原子发布。mutator 的返回值原样带回——upsert 用它把
/// 「刚写的那条记录的 id」交回调用方，省得调用方写完再 list 一遍找自己刚
/// 写的那条。
fn mutate_state<F, T>(workspace_root: &Path, mutator: F) -> Result<(OpsState, T), String>
where
    F: FnOnce(&mut OpsState) -> Result<T, String>,
{
    let paths = resolve_ops_paths(workspace_root)?;
    fs::create_dir_all(&paths.dir)
        .map_err(|e| format!("[ops-store] Cannot create ops directory: {}", e))?;

    let lock_path = paths.dir.join("state.json.lock");
    let state_path = paths.state.clone();

    let result = with_file_lock_blocking(
        &lock_path,
        FileLockOptions {
            timeout: Duration::from_secs(5),
            ..Default::default()
        },
        move || -> Result<(OpsState, T), FileLockError> {
            let mut state = read_state_at(&state_path).map_err(to_io_err)?;
            let value = mutator(&mut state).map_err(to_io_err)?;
            validate_state(&state).map_err(to_io_err)?;
            let content = serde_json::to_string_pretty(&state)
                .map_err(|e| to_io_err(format!("[ops-store] Cannot serialize ops state: {}", e)))?;
            fs_atomic::atomic_publish(&state_path, &content, "ops-store").map_err(to_io_err)?;
            Ok((state, value))
        },
    );

    result.map_err(|e| match e {
        FileLockError::Busy { .. } => e.to_string(),
        FileLockError::Io(io_err) => format!("[ops-store] {}", io_err),
    })
}

/// 写入或更新一条记录。返回写入后的台账与**这条记录的 id**。
///
/// 载荷是**补丁**：只有出现的键会覆盖已有值（嵌套对象深合并）。同 id 覆盖，
/// 新 id 新建。id 留空时由 store 生成——三个写者各自造 id 迟早撞车，撞了就
/// 是覆盖别人的记录。
pub fn upsert_item(
    workspace_root: &Path,
    item: OpsUpsert,
) -> Result<(OpsState, String), String> {
    let OpsUpsert { kind, fields } = item;
    mutate_state(workspace_root, |state| match kind {
        OpsItemKind::Direction => upsert_direction(state, fields),
        OpsItemKind::Account => upsert_account(state, fields),
        OpsItemKind::Topic => upsert_topic(state, fields),
        OpsItemKind::Asset => upsert_asset(state, fields),
        OpsItemKind::Review => upsert_review(state, fields),
        OpsItemKind::Rule => upsert_rule(state, fields),
        OpsItemKind::Style => upsert_style(state, fields),
        OpsItemKind::Clue => upsert_clue(state, fields),
        OpsItemKind::Benchmark => upsert_benchmark(state, fields),
    })
}

/// 生成台账记录 id。带类型前缀，肉眼能看出是选题还是素材。
fn generate_id(kind: &str) -> String {
    format!("{}-{}", kind, &uuid::Uuid::new_v4().simple().to_string()[..8])
}

/// 台账里的时间戳统一走 ISO 8601（UTC），**毫秒精度**。
///
/// `to_rfc3339()` 会输出 9 位小数（纳秒）。V8（Node / Chromium）宽松地接受，
/// WebKit 不保证——而这里的值最终喂给 renderer 的 `new Date(...)`，macOS 上
/// 只有 WebKit。ES 规范只认 3 位小数，多出来的位数属于实现自选。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 从补丁里取出 id。没有 / 空串 = 新建。
fn patch_id(patch: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    patch
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 深合并：两边都是对象就逐键合并，否则补丁值整体覆盖。
///
/// 深一层是为了复盘的 `metrics`——只改播放量时如果整体替换 `metrics`，
/// 其余五个指标就丢了。
fn merge_values(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                match base_map.get_mut(key) {
                    Some(existing) => merge_values(existing, value),
                    None => {
                        base_map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (base, patch) => *base = patch.clone(),
    }
}

/// 把补丁合并到已有记录上（`existing` 为 `None` 时就是新建），再反序列化成
/// 实体。反序列化这一步就是 schema 校验：字段类型不对 / 必填缺失会在这里
/// 报错，而不是等到落盘后才发现台账坏了。
fn merge_patch<T>(existing: Option<&T>, patch: &serde_json::Map<String, serde_json::Value>) -> Result<T, String>
where
    T: Serialize + serde::de::DeserializeOwned,
{
    let mut merged = match existing {
        Some(record) => serde_json::to_value(record)
            .map_err(|e| format!("[ops-store] Cannot re-encode record: {}", e))?,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };
    if let Some(base) = merged.as_object_mut() {
        for (key, value) in patch {
            match base.get_mut(key) {
                Some(existing_value) => merge_values(existing_value, value),
                None => {
                    base.insert(key.clone(), value.clone());
                }
            }
        }
    }
    serde_json::from_value(merged)
        .map_err(|e| format!("[ops-store] Invalid record payload: {}", e))
}

/// 决定一条记录的 `created_at`：已有记录保留最初的时间（改字段不该改「何时
/// 创建」），新记录用补丁里的，没有就现在。
fn resolve_created_at(existing_created_at: Option<&str>, patched: &str) -> String {
    match existing_created_at {
        Some(original) => original.to_string(),
        None if patched.trim().is_empty() => now_iso(),
        None => patched.to_string(),
    }
}

fn upsert_topic(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let existing = id
        .as_deref()
        .and_then(|id| state.topics.iter().find(|topic| topic.id == id));
    let mut topic: OpsTopic = merge_patch(existing, &patch)?;
    if topic.id.trim().is_empty() {
        topic.id = generate_id("topic");
    }
    topic.created_at = resolve_created_at(
        existing.map(|old| old.created_at.as_str()),
        &topic.created_at,
    );
    topic.updated_at = now_iso();
    upsert_by_id(&mut state.topics, topic, |t| t.id.as_str())
}

fn upsert_asset(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let existing = id
        .as_deref()
        .and_then(|id| state.assets.iter().find(|asset| asset.id == id));
    let mut asset: OpsAsset = merge_patch(existing, &patch)?;
    if asset.id.trim().is_empty() {
        asset.id = generate_id("asset");
    }
    asset.created_at = resolve_created_at(
        existing.map(|old| old.created_at.as_str()),
        &asset.created_at,
    );
    asset.updated_at = now_iso();
    upsert_by_id(&mut state.assets, asset, |a| a.id.as_str())
}

fn upsert_review(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let existing = id
        .as_deref()
        .and_then(|id| state.reviews.iter().find(|review| review.id == id));
    let mut review: OpsReview = merge_patch(existing, &patch)?;
    if review.id.trim().is_empty() {
        review.id = generate_id("review");
    }
    review.created_at = resolve_created_at(
        existing.map(|old| old.created_at.as_str()),
        &review.created_at,
    );
    upsert_by_id(&mut state.reviews, review, |r| r.id.as_str())
}

fn upsert_rule(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let existing = id
        .as_deref()
        .and_then(|id| state.rules.iter().find(|rule| rule.id == id));
    let mut rule: OpsRule = merge_patch(existing, &patch)?;
    if rule.id.trim().is_empty() {
        rule.id = generate_id("rule");
    }
    rule.created_at = resolve_created_at(existing.map(|old| old.created_at.as_str()), &rule.created_at);
    upsert_by_id(&mut state.rules, rule, |r| r.id.as_str())
}

/// 写方向。除了 id，**也认 `platform` 作为天然键**：Agent 从来不知道方向记录
/// 的 id，但一定知道平台；要求它先 list 一次再 upsert 是白跑一轮。
///
/// 采纳修订也走这里：一次 payload 里同时给新字段和 `proposal: null`，锁内一次
/// 写完——分两次（先改值再清 proposal）中间崩掉会留下「已采纳但仍在等你确认」
/// 的状态。
fn upsert_direction(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    // 采纳 / 驳回修订是**动作**，不是字段：这两个键不进补丁合并，先取出来。
    // 让调用方自己把 proposal 的每个字段抄一遍等于把字段清单复制到每个写者里。
    let accept = patch
        .get("acceptProposal")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let reject = patch
        .get("rejectProposal")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut fields = patch;
    fields.remove("acceptProposal");
    fields.remove("rejectProposal");

    // `proposal` 不走通用合并：它是**一整版新值**，深合并会把上一版残留的字段
    // （尤其 rationale）揉进新修订里，人看到的就不是 Agent 刚提的那一版。
    // 这里单独取出来，采纳 / 驳回之后再决定怎么落。
    let patched_proposal = match fields.remove("proposal") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Object(map)) => Some(map),
        Some(other) => {
            return Err(format!("[ops-store] Invalid direction proposal: {}", other));
        }
    };
    if patched_proposal.is_some() && (accept || reject) {
        return Err(
            "[ops-store] a new proposal cannot be combined with acceptProposal / rejectProposal"
                .to_string(),
        );
    }

    let id = patch_id(&fields);
    let platform = fields
        .get("platform")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let existing = match id.as_deref() {
        Some(id) => state.directions.iter().find(|d| d.id == id),
        None => platform
            .as_deref()
            .and_then(|p| state.directions.iter().find(|d| d.platform == p)),
    };

    let mut direction: OpsDirection = merge_patch(existing, &fields)?;
    if direction.id.trim().is_empty() {
        direction.id = match platform.as_deref() {
            // id 从平台派生：同平台重复 upsert 落在同一条上，不靠调用方记 id。
            Some(p) => format!("dir-{}", p),
            None => generate_id("direction"),
        };
    }

    if accept {
        let proposal = direction
            .proposal
            .take()
            .ok_or_else(|| format!("Direction {} has no pending revision to accept", direction.id))?;
        // 修订没提到的字段**保持原样**。拿空值覆盖 = 把方向里没参与讨论的
        // 内容整段抹掉，而人点「采纳」时看到的只是被改的那几项。
        if let Some(value) = proposal.positioning {
            direction.positioning = value;
        }
        if let Some(value) = proposal.audience {
            direction.audience = value;
        }
        if let Some(value) = proposal.pillars {
            direction.pillars = value;
        }
        if let Some(value) = proposal.goal {
            direction.goal = value;
        }
        if let Some(value) = proposal.cadence {
            direction.cadence = value;
        }
        // 采纳即生效：人点了头就是「定下来了」，不需要再点一次。
        direction.status = OpsDirectionStatus::Active;
    } else if reject {
        // 驳回只丢修订，其余字段保持原样——驳回的是「改成这样」，不是方向本身。
        direction.proposal = None;
    } else if let Some(map) = patched_proposal {
        let mut proposal: OpsDirectionProposal = serde_json::from_value(serde_json::Value::Object(map))
            .map_err(|e| format!("[ops-store] Invalid direction proposal: {}", e))?;
        // 提议时刻由 store 兜底：Agent 不写也得有个时间给人看。
        if proposal.proposed_at.trim().is_empty() {
            proposal.proposed_at = now_iso();
        }
        direction.proposal = Some(proposal);
    }

    direction.created_at =
        resolve_created_at(existing.map(|old| old.created_at.as_str()), &direction.created_at);
    direction.updated_at = now_iso();
    upsert_by_id(&mut state.directions, direction, |d| d.id.as_str())
}

/// 写账号。除了 id，**也认 `platform` 作为天然键**：账号天然是「一个平台一个
/// 号」，调用方（尤其是 Agent）知道平台就够了，不必先 list 一遍找 id。
///
/// 平台是必填的：没有平台的账号既没法找到登录页，也没法校验唯一性。
fn upsert_account(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let platform = patch
        .get("platform")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let existing = match id.as_deref() {
        Some(id) => state.accounts.iter().find(|a| a.id == id),
        None => platform
            .as_deref()
            .and_then(|p| state.accounts.iter().find(|a| a.platform == p)),
    };

    let mut account: OpsAccount = merge_patch(existing, &patch)?;
    if account.platform.trim().is_empty() {
        return Err("account requires a platform".to_string());
    }
    if account.id.trim().is_empty() {
        // id 从平台派生：同平台重复 upsert 落在同一条上，不靠调用方记 id。
        account.id = format!("acc-{}", account.platform);
    }

    account.created_at =
        resolve_created_at(existing.map(|old| old.created_at.as_str()), &account.created_at);
    account.updated_at = now_iso();
    upsert_by_id(&mut state.accounts, account, |a| a.id.as_str())
}

/// 写线索。除了 id，也认 `(platform, comment_id)` 作为天然键：同一段评论被
/// 反复采集只会**合并**成一条。
///
/// `comment_id` 必填——没有它就判不了重，重复采集会把「有多少人在问价」
/// 灌上假数。`platform` 必填，理由同 `upsert_account`。
fn upsert_clue(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let platform = patch
        .get("platform")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let comment_id = patch
        .get("commentId")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let existing = match id.as_deref() {
        Some(id) => state.clues.iter().find(|clue| clue.id == id),
        None => comment_id.and_then(|comment_id| {
            state.clues.iter().find(|clue| {
                clue.comment_id == comment_id
                    && platform.map(|p| clue.platform == p).unwrap_or(true)
            })
        }),
    };

    let mut clue: OpsClue = merge_patch(existing, &patch)?;
    if clue.platform.trim().is_empty() {
        return Err("clue requires a platform".to_string());
    }
    if clue.comment_id.trim().is_empty() {
        return Err("clue requires a commentId".to_string());
    }
    if clue.id.trim().is_empty() {
        clue.id = generate_id("clue");
    }
    clue.created_at = resolve_created_at(
        existing.map(|old| old.created_at.as_str()),
        &clue.created_at,
    );
    clue.updated_at = now_iso();
    upsert_by_id(&mut state.clues, clue, |c| c.id.as_str())
}

/// 写对标账号。除了 id，也认 `(platform, profile_url)` 作为天然键：同一个主页
/// 反复加只合并成一条。
///
/// `profile_url` 必填——它是对标账号的身份，没有它就分不清「同一家」和
/// 「两个撞名的号」。
fn upsert_benchmark(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let id = patch_id(&patch);
    let platform = patch
        .get("platform")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let profile_url = patch
        .get("profileUrl")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let existing = match id.as_deref() {
        Some(id) => state
            .benchmarks
            .iter()
            .find(|benchmark| benchmark.id == id),
        None => profile_url.and_then(|profile_url| {
            state.benchmarks.iter().find(|benchmark| {
                benchmark.profile_url == profile_url
                    && platform.map(|p| benchmark.platform == p).unwrap_or(true)
            })
        }),
    };

    let mut benchmark: OpsBenchmark = merge_patch(existing, &patch)?;
    if benchmark.platform.trim().is_empty() {
        return Err("benchmark requires a platform".to_string());
    }
    if benchmark.profile_url.trim().is_empty() {
        return Err("benchmark requires a profileUrl".to_string());
    }
    if benchmark.id.trim().is_empty() {
        benchmark.id = generate_id("benchmark");
    }
    benchmark.created_at = resolve_created_at(
        existing.map(|old| old.created_at.as_str()),
        &benchmark.created_at,
    );
    benchmark.updated_at = now_iso();
    upsert_by_id(&mut state.benchmarks, benchmark, |b| b.id.as_str())
}

fn upsert_style(
    state: &mut OpsState,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let existing = state.style.as_ref();
    let mut style: OpsStyle = merge_patch(existing, &patch)?;
    if style.id.trim().is_empty() {
        style.id = "style".to_string();
    }
    style.updated_at = now_iso();
    let id = style.id.clone();
    state.style = Some(style);
    Ok(id)
}

/// 删除一条记录。找不到就报错——静默成功会让调用方以为删掉了。
pub fn delete_item(
    workspace_root: &Path,
    kind: OpsItemKind,
    id: &str,
) -> Result<OpsState, String> {
    mutate_state(workspace_root, |state| {
        let removed = match kind {
            OpsItemKind::Direction => {
                remove_by_id(&mut state.directions, id, |d| d.id.as_str())
            }
            OpsItemKind::Account => {
                remove_by_id(&mut state.accounts, id, |a| a.id.as_str())
            }
            OpsItemKind::Topic => remove_by_id(&mut state.topics, id, |t| t.id.as_str()),
            OpsItemKind::Asset => remove_by_id(&mut state.assets, id, |a| a.id.as_str()),
            OpsItemKind::Review => remove_by_id(&mut state.reviews, id, |r| r.id.as_str()),
            OpsItemKind::Rule => remove_by_id(&mut state.rules, id, |r| r.id.as_str()),
            OpsItemKind::Clue => remove_by_id(&mut state.clues, id, |c| c.id.as_str()),
            OpsItemKind::Benchmark => {
                remove_by_id(&mut state.benchmarks, id, |b| b.id.as_str())
            }
            OpsItemKind::Style => {
                let matched = state.style.as_ref().map(|s| s.id == id).unwrap_or(false);
                if matched {
                    state.style = None;
                }
                matched
            }
        };
        if removed {
            Ok(())
        } else {
            Err(format!("No {} record with id {}", kind.as_str(), id))
        }
    })
    .map(|(state, _)| state)
}

fn upsert_by_id<T, F>(list: &mut Vec<T>, item: T, id_of: F) -> Result<String, String>
where
    F: Fn(&T) -> &str,
{
    let id = id_of(&item).to_string();
    if id.trim().is_empty() {
        return Err("id cannot be empty".to_string());
    }
    match list.iter_mut().find(|existing| id_of(existing) == id) {
        Some(slot) => *slot = item,
        None => list.push(item),
    }
    Ok(id)
}

fn remove_by_id<T, F>(list: &mut Vec<T>, id: &str, id_of: F) -> bool
where
    F: Fn(&T) -> &str,
{
    let before = list.len();
    list.retain(|item| id_of(item) != id);
    list.len() != before
}

// ── 事件 ────────────────────────────────────────────────────────────

/// 写成功后通知前端刷新面板。
///
/// 用全局 AppHandle（`logger::init_app_handle` 在 setup 里塞好的那个），这样
/// Tauri command 与管理 API（CLI 走的那条）共用同一个通知点，不需要把
/// AppHandle 穿到 axum 的 router state 里。
pub fn emit_changed(workspace: &str) {
    let Some(app) = crate::logger::get_app_handle() else {
        return;
    };
    let payload = serde_json::json!({ "workspace": workspace });
    if let Err(e) = app.emit("ops:changed", payload) {
        crate::ulog_warn!("[ops-store] Failed to emit ops:changed: {}", e);
    }
}

// ── Tauri 命令 ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_ops_read(workspace: String) -> Result<OpsState, String> {
    let root = validate_workspace_root(&workspace)?;
    tauri::async_runtime::spawn_blocking(move || read_state(&root))
        .await
        .map_err(|e| format!("[ops-store] read task failed: {}", e))?
}

/// 写入结果：台账快照 + 刚写入那条记录的 id。
///
/// id 是新建时由 store 生成的——写者造不出它，只能由 store 回传。少了这个
/// 回传，写者就得写完再 list 一遍去找自己刚写的那条。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsUpsertOutcome {
    pub state: OpsState,
    pub id: String,
}

#[tauri::command]
pub async fn cmd_ops_upsert(workspace: String, item: OpsUpsert) -> Result<OpsUpsertOutcome, String> {
    let root = validate_workspace_root(&workspace)?;
    let (state, id) = tauri::async_runtime::spawn_blocking(move || upsert_item(&root, item))
        .await
        .map_err(|e| format!("[ops-store] upsert task failed: {}", e))??;
    emit_changed(&workspace);
    Ok(OpsUpsertOutcome { state, id })
}

#[tauri::command]
pub async fn cmd_ops_delete(
    workspace: String,
    kind: OpsItemKind,
    id: String,
) -> Result<OpsState, String> {
    let root = validate_workspace_root(&workspace)?;
    let state = tauri::async_runtime::spawn_blocking(move || delete_item(&root, kind, &id))
        .await
        .map_err(|e| format!("[ops-store] delete task failed: {}", e))??;
    emit_changed(&workspace);
    Ok(state)
}

// ── 测试 ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;

    fn topic(id: &str) -> OpsTopic {
        OpsTopic {
            id: id.to_string(),
            title: format!("选题 {}", id),
            note: String::new(),
            angle: String::new(),
            platform: "douyin".to_string(),
            tags: Vec::new(),
            status: OpsTopicStatus::Idea,
            source: OpsTopicSource::Manual,
            source_refs: Vec::new(),
            hotness: None,
            created_at: "2026-11-01T09:00:00".to_string(),
            updated_at: "2026-11-01T09:00:00".to_string(),
        }
    }

    fn asset(id: &str) -> OpsAsset {
        OpsAsset {
            id: id.to_string(),
            topic_id: None,
            title: format!("素材 {}", id),
            body: String::new(),
            product: String::new(),
            cta: String::new(),
            source_ref: None,
            cover: None,
            images: Vec::new(),
            shots: Vec::new(),
            platform: "xiaohongshu".to_string(),
            scheduled_at: None,
            status: OpsAssetStatus::Draft,
            published_at: None,
            platform_work_id: None,
            progress: 0,
            created_at: "2026-11-01T09:00:00".to_string(),
            updated_at: "2026-11-01T09:00:00".to_string(),
        }
    }

    /// 把一个完整实体转成写入载荷（补丁）。
    fn upsert(kind: OpsItemKind, item: &impl Serialize) -> OpsUpsert {
        let value = serde_json::to_value(item).expect("serialize");
        let fields = value
            .as_object()
            .cloned()
            .expect("entity must serialize to a JSON object");
        OpsUpsert { kind, fields }
    }

    fn topic_upsert(item: &OpsTopic) -> OpsUpsert {
        upsert(OpsItemKind::Topic, item)
    }

    fn direction(platform: &str, brief: &str) -> serde_json::Map<String, serde_json::Value> {
        serde_json::json!({ "platform": platform, "brief": brief })
            .as_object()
            .cloned()
            .expect("object")
    }

    #[test]
    fn direction_upsert_keys_on_platform_when_no_id_is_given() {
        let ws = make_test_workspace("ops-direction-key");
        let (_, first) = upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "先做露营装备") },
        )
        .expect("first");
        // 第二次不带 id，只带平台 + 新字段：必须落在同一条上。
        let (state, second) = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Direction,
                fields: direction("douyin", "改成做城市露营"),
            },
        )
        .expect("second");

        assert_eq!(first, second, "同平台必须复用同一条方向");
        assert_eq!(state.directions.len(), 1);
        assert_eq!(state.directions[0].brief, "改成做城市露营");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn direction_accepting_a_proposal_clears_it_in_one_write() {
        let ws = make_test_workspace("ops-direction-accept");
        upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "露营装备") },
        )
        .expect("seed");

        // Agent 提议一版修订。
        let propose = serde_json::json!({
            "platform": "douyin",
            "proposal": {
                "positioning": "夜间露营装备测评",
                "rationale": "近两周晚间发布的内容表现更好",
                "evidence": "3 条晚 9 点内容完播率高 40%",
                "proposedAt": "2026-11-15T10:00:00.000Z",
            },
        })
        .as_object()
        .cloned()
        .expect("object");
        let (state, _) =
            upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: propose })
                .expect("propose");
        assert!(state.directions[0].proposal.is_some());

        // 人确认：一个动作键，store 在锁内把 proposal 的值搬进正文字段并清掉修订。
        let accept = serde_json::json!({ "platform": "douyin", "acceptProposal": true })
            .as_object()
            .cloned()
            .expect("object");
        let (state, _) =
            upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: accept })
                .expect("accept");

        assert!(state.directions[0].proposal.is_none(), "采纳后修订必须清掉");
        assert_eq!(state.directions[0].positioning, "夜间露营装备测评");
        assert!(matches!(state.directions[0].status, OpsDirectionStatus::Active));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn rejecting_a_proposal_keeps_the_direction_itself() {
        let ws = make_test_workspace("ops-direction-reject");
        upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "露营装备") },
        )
        .expect("seed");
        let propose = serde_json::json!({
            "platform": "douyin",
            "proposal": { "positioning": "不该采纳的定位", "rationale": "猜的" },
        })
        .as_object()
        .cloned()
        .expect("object");
        upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: propose })
            .expect("propose");

        let reject = serde_json::json!({ "platform": "douyin", "rejectProposal": true })
            .as_object()
            .cloned()
            .expect("object");
        let (state, _) =
            upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: reject })
                .expect("reject");

        assert!(state.directions[0].proposal.is_none());
        // 驳回的是修订，不是方向：原话和已有定位都还在。
        assert_eq!(state.directions[0].brief, "露营装备");
        assert_eq!(state.directions[0].positioning, "");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn accepting_a_proposal_when_none_exists_reports_error() {
        let ws = make_test_workspace("ops-direction-accept-none");
        upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "露营装备") },
        )
        .expect("seed");
        let accept = serde_json::json!({ "platform": "douyin", "acceptProposal": true })
            .as_object()
            .cloned()
            .expect("object");
        let err = upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: accept })
            .expect_err("should fail");
        assert!(err.contains("no pending revision"), "错误要说清原因: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn direction_state_always_carries_the_proposal_key() {
        // 前端类型是 `proposal: OpsDirectionProposal | null`。键缺失在前端就是
        // `undefined`，而 `undefined !== null` 为真 —— 「有修订」会对每一条方向
        // 都成立，界面给每行都挂上采纳 / 驳回，点下去只能报「没有待确认的修订」。
        let ws = make_test_workspace("ops-direction-proposal-key");
        upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "露营装备") },
        )
        .expect("seed");

        let raw = fs::read_to_string(ws.join("ops/state.json")).expect("read raw");
        assert!(raw.contains("\"proposal\": null"), "方向记录必须带 proposal 键: {}", raw);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn accepting_a_partial_proposal_keeps_the_fields_it_never_mentioned() {
        // 修订常常只动一两个字段。拿空值覆盖 = 把方向里没参与讨论的内容抹掉，
        // 而人点「采纳」时看到的只是被改的那几项。
        let ws = make_test_workspace("ops-direction-partial-accept");
        let seed = serde_json::json!({
            "platform": "douyin",
            "brief": "露营装备",
            "positioning": "白天露营装备测评",
            "audience": "入门露营者",
            "goal": "涨粉",
            "cadence": "每周三条",
        })
        .as_object()
        .cloned()
        .expect("object");
        upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: seed }).expect("seed");

        let propose = serde_json::json!({
            "platform": "douyin",
            "proposal": { "positioning": "夜间露营装备测评", "rationale": "晚间数据更好" },
        })
        .as_object()
        .cloned()
        .expect("object");
        upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: propose }).expect("propose");

        let accept = serde_json::json!({ "platform": "douyin", "acceptProposal": true })
            .as_object()
            .cloned()
            .expect("object");
        let (state, _) =
            upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: accept })
                .expect("accept");

        assert_eq!(state.directions[0].positioning, "夜间露营装备测评");
        // 没提到的字段保持原样。
        assert_eq!(state.directions[0].audience, "入门露营者");
        assert_eq!(state.directions[0].goal, "涨粉");
        assert_eq!(state.directions[0].cadence, "每周三条");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn a_second_proposal_replaces_the_first_instead_of_merging_into_it() {
        // 深合并会把上一版的 rationale 揉进新修订：人看到的就不是 Agent 刚提的
        // 那一版，改的到底是哪一版就说不清了。
        let ws = make_test_workspace("ops-direction-proposal-replace");
        upsert_item(
            &ws,
            OpsUpsert { kind: OpsItemKind::Direction, fields: direction("douyin", "露营装备") },
        )
        .expect("seed");

        let first = serde_json::json!({
            "platform": "douyin",
            "proposal": { "positioning": "第一版", "rationale": "第一版的理由" },
        })
        .as_object()
        .cloned()
        .expect("object");
        upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: first }).expect("first");

        let second = serde_json::json!({
            "platform": "douyin",
            "proposal": { "positioning": "第二版" },
        })
        .as_object()
        .cloned()
        .expect("object");
        let (state, _) =
            upsert_item(&ws, OpsUpsert { kind: OpsItemKind::Direction, fields: second })
                .expect("second");

        let proposal = state.directions[0].proposal.as_ref().expect("proposal");
        assert_eq!(proposal.positioning.as_deref(), Some("第二版"));
        assert_eq!(proposal.rationale, "", "上一版的理由不能被揉进新修订");
        assert!(!proposal.proposed_at.trim().is_empty(), "提议时刻由 store 兜底");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn duplicate_direction_for_one_platform_is_rejected() {
        // 手写一份 state.json：同一平台两条方向。
        let ws = make_test_workspace("ops-direction-dup");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let raw = serde_json::json!({
            "version": OPS_STATE_VERSION,
            "directions": [
                { "id": "dir-a", "platform": "douyin", "brief": "a" },
                { "id": "dir-b", "platform": "douyin", "brief": "b" },
            ],
        })
        .to_string();
        fs::write(ops_dir.join("state.json"), raw).expect("write");

        let err = read_state(&ws).expect_err("must reject");
        assert!(err.contains("Duplicate direction"), "错误要说清是重复: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn account_upsert_keys_on_platform_when_no_id_is_given() {
        let ws = make_test_workspace("ops-account-key");
        let (_, first) = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Account,
                fields: serde_json::json!({ "platform": "douyin", "displayName": "露营小王" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            },
        )
        .expect("first");
        // 第二次不带 id，只带平台 + 新名字：必须落在同一条上。
        let (state, second) = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Account,
                fields: serde_json::json!({ "platform": "douyin", "displayName": "露营小李" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            },
        )
        .expect("second");

        assert_eq!(first, second, "同平台必须复用同一条账号");
        assert_eq!(state.accounts.len(), 1);
        assert_eq!(state.accounts[0].display_name, "露营小李");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn account_name_upsert_does_not_clobber_the_login_state() {
        // 只改名字不该把登录态冲掉——登录态是界面确认的结果，Agent 改个名
        // 就把它重置成 unknown，等于逼人重新登录一次。
        let ws = make_test_workspace("ops-account-merge");
        upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Account,
                fields: serde_json::json!({
                    "platform": "douyin",
                    "displayName": "露营小王",
                    "loginState": "success",
                    "lastCheckedAt": "2026-11-15T10:00:00.000Z",
                })
                .as_object()
                .cloned()
                .expect("object"),
            },
        )
        .expect("seed");

        let (state, _) = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Account,
                fields: serde_json::json!({ "platform": "douyin", "displayName": "露营小李" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            },
        )
        .expect("rename");

        assert_eq!(state.accounts.len(), 1);
        assert_eq!(state.accounts[0].display_name, "露营小李");
        assert_eq!(state.accounts[0].login_state, OpsLoginState::Success);
        assert_eq!(
            state.accounts[0].last_checked_at.as_deref(),
            Some("2026-11-15T10:00:00.000Z")
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn account_without_a_platform_is_rejected() {
        let ws = make_test_workspace("ops-account-no-platform");
        let err = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Account,
                fields: serde_json::json!({ "displayName": "无名号" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            },
        )
        .expect_err("must reject");
        assert!(err.contains("platform"), "错误要说清缺平台: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn duplicate_account_for_one_platform_is_rejected() {
        // 手写一份 state.json：同一平台两个账号。
        let ws = make_test_workspace("ops-account-dup");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let raw = serde_json::json!({
            "version": OPS_STATE_VERSION,
            "accounts": [
                { "id": "acc-a", "platform": "douyin" },
                { "id": "acc-b", "platform": "douyin" },
            ],
        })
        .to_string();
        fs::write(ops_dir.join("state.json"), raw).expect("write");

        let err = read_state(&ws).expect_err("must reject");
        assert!(err.contains("Duplicate account"), "错误要说清是重复: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn missing_state_file_reads_as_empty_skeleton() {
        let ws = make_test_workspace("ops-empty");
        let state = read_state(&ws).expect("read");
        assert_eq!(state.version, OPS_STATE_VERSION);
        assert!(state.topics.is_empty());
        assert!(state.style.is_none());
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn upsert_writes_then_reads_back() {
        let ws = make_test_workspace("ops-upsert");
        let (state, _) = upsert_item(&ws, topic_upsert(&topic("t1"))).expect("upsert");
        assert_eq!(state.topics.len(), 1);

        let reread = read_state(&ws).expect("read");
        assert_eq!(reread.topics.len(), 1);
        assert_eq!(reread.topics[0].id, "t1");
        assert_eq!(reread.topics[0].title, "选题 t1");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn upsert_with_same_id_updates_instead_of_duplicating() {
        let ws = make_test_workspace("ops-replace");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("first");
        let mut updated = topic("t1");
        updated.title = "改过的标题".to_string();
        let (state, _) = upsert_item(&ws, topic_upsert(&updated)).expect("second");

        assert_eq!(state.topics.len(), 1);
        assert_eq!(state.topics[0].title, "改过的标题");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn state_file_is_human_readable_json() {
        let ws = make_test_workspace("ops-readable");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("upsert");

        let raw = fs::read_to_string(ws.join("ops/state.json")).expect("read raw");
        assert!(raw.contains("\n"), "应该缩进排版而不是压成一行");
        assert!(raw.contains("\"id\": \"t1\""));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn delete_removes_only_the_target_record() {
        let ws = make_test_workspace("ops-delete");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("t1");
        upsert_item(&ws, topic_upsert(&topic("t2"))).expect("t2");
        upsert_item(&ws, upsert(OpsItemKind::Asset, &asset("a1"))).expect("a1");

        let state = delete_item(&ws, OpsItemKind::Topic, "t1").expect("delete");
        assert_eq!(state.topics.len(), 1);
        assert_eq!(state.topics[0].id, "t2");
        assert_eq!(state.assets.len(), 1);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn deleting_a_missing_record_reports_error() {
        let ws = make_test_workspace("ops-delete-missing");
        let err = delete_item(&ws, OpsItemKind::Topic, "nope").expect_err("should fail");
        assert!(err.contains("nope"), "错误信息里要带上 id: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn corrupt_json_is_reported_and_never_overwritten() {
        let ws = make_test_workspace("ops-corrupt");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let state_path = ops_dir.join("state.json");
        fs::write(&state_path, "{ this is not json").expect("seed");

        let err = read_state(&ws).expect_err("read should fail");
        assert!(err.contains("Cannot parse"), "错误信息: {}", err);

        // 坏文件绝不能被空状态盖掉——用户手写的台账比我们的默认值贵。
        let write_err = upsert_item(&ws, topic_upsert(&topic("t1"))).expect_err("write should fail");
        assert!(write_err.contains("Cannot parse"), "错误信息: {}", write_err);
        assert_eq!(
            fs::read_to_string(&state_path).expect("read raw"),
            "{ this is not json"
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn unknown_platform_is_rejected() {
        let ws = make_test_workspace("ops-platform");
        let mut bad = topic("t1");
        bad.platform = "tiktok".to_string();
        let err = upsert_item(&ws, topic_upsert(&bad)).expect_err("should fail");
        assert!(err.contains("Unknown platform"), "错误信息: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn out_of_range_progress_is_rejected() {
        let ws = make_test_workspace("ops-progress");
        let mut bad = asset("a1");
        bad.progress = 120;
        let err = upsert_item(&ws, upsert(OpsItemKind::Asset, &bad)).expect_err("should fail");
        assert!(err.contains("progress"), "错误信息: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn duplicate_ids_in_the_file_are_rejected() {
        let ws = make_test_workspace("ops-dup");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let mut state = OpsState::empty();
        state.topics.push(topic("t1"));
        state.topics.push(topic("t1"));
        fs::write(
            ops_dir.join("state.json"),
            serde_json::to_string_pretty(&state).expect("serialize"),
        )
        .expect("seed");

        let err = read_state(&ws).expect_err("should fail");
        assert!(err.contains("Duplicate"), "错误信息: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    #[cfg(unix)]
    fn symlinked_state_file_is_refused() {
        let ws = make_test_workspace("ops-symlink");
        let outside = ws.join("outside.json");
        fs::write(&outside, "{}").expect("seed");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        std::os::unix::fs::symlink(&outside, ops_dir.join("state.json")).expect("symlink");

        let err = read_state(&ws).expect_err("should fail");
        assert!(err.contains("symlink"), "错误信息: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn concurrent_writes_do_not_lose_records() {
        let ws = make_test_workspace("ops-concurrent");
        let root = ws.clone();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let root = root.clone();
                std::thread::spawn(move || {
                    upsert_item(&root, topic_upsert(&topic(&format!("t{}", i))))
                        .expect("upsert should succeed");
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread should not panic");
        }

        let state = read_state(&ws).expect("read");
        assert_eq!(state.topics.len(), 8, "并发写不该丢记录");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn upsert_payload_round_trips_through_json() {
        let payload = serde_json::json!({
            "kind": "topic",
            "id": "t1",
            "title": "选题",
            "platform": "douyin",
            "status": "idea",
            "source": "hotspot",
            "createdAt": "2026-11-01T09:00:00",
            "updatedAt": "2026-11-01T09:00:00",
        });
        let upsert: OpsUpsert = serde_json::from_value(payload).expect("deserialize");
        assert_eq!(upsert.kind, OpsItemKind::Topic);
        assert_eq!(upsert.fields.get("id").and_then(|v| v.as_str()), Some("t1"));
        assert_eq!(
            upsert.fields.get("source").and_then(|v| v.as_str()),
            Some("hotspot")
        );
    }

    #[test]
    fn asset_source_ref_round_trips_through_the_ledger() {
        let ws = make_test_workspace("ops-asset-source-ref");
        let mut a = asset("a1");
        a.source_ref = Some("ops/assets/imported/2026-11-15/折叠桌".to_string());
        upsert_item(&ws, upsert(OpsItemKind::Asset, &a)).expect("upsert");

        let reread = read_state(&ws).expect("read");
        assert_eq!(reread.assets.len(), 1);
        assert_eq!(
            reread.assets[0].source_ref.as_deref(),
            Some("ops/assets/imported/2026-11-15/折叠桌")
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn ledger_written_before_the_intake_fields_still_loads() {
        // 老台账没有 product / cta / sourceRef / platformWorkId。这些字段是
        // `#[serde(default)]` 的原因：升级不能让用户已有的台账直接解析失败。
        let ws = make_test_workspace("ops-legacy-asset");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        fs::write(
            ops_dir.join("state.json"),
            r#"{
              "version": 1,
              "topics": [],
              "assets": [{
                "id": "a1",
                "topicId": null,
                "title": "老素材",
                "body": "正文",
                "cover": null,
                "images": [],
                "shots": [],
                "platform": "douyin",
                "scheduledAt": null,
                "status": "published",
                "publishedAt": "2026-11-01T09:00:00",
                "progress": 100,
                "createdAt": "2026-11-01T09:00:00",
                "updatedAt": "2026-11-01T09:00:00"
              }],
              "reviews": [],
              "rules": [],
              "style": null
            }"#,
        )
        .expect("write");

        let state = read_state(&ws).expect("read");
        assert_eq!(state.assets.len(), 1);
        let a = &state.assets[0];
        assert_eq!(a.title, "老素材");
        assert_eq!(a.product, "");
        assert_eq!(a.cta, "");
        assert!(a.source_ref.is_none());
        assert!(a.platform_work_id.is_none());
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn patch_merges_into_existing_record_without_dropping_other_fields() {
        let ws = make_test_workspace("ops-patch-merge");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("seed");

        // 只发要改的字段：标题之外的字段必须原样留下。
        let patch = serde_json::json!({ "kind": "topic", "id": "t1", "status": "planned" });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, _) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(state.topics.len(), 1);
        assert_eq!(state.topics[0].status, OpsTopicStatus::Planned);
        assert_eq!(state.topics[0].title, "选题 t1", "没发的字段不能被抹掉");
        assert_eq!(state.topics[0].platform, "douyin");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn nested_object_patch_merges_one_level_deep() {
        let ws = make_test_workspace("ops-patch-nested");
        let review = OpsReview {
            id: "r1".to_string(),
            asset_id: "a1".to_string(),
            platform: "douyin".to_string(),
            published_at: "2026-11-01T09:00:00".to_string(),
            metrics: OpsReviewMetrics {
                views: 100,
                likes: 10,
                comments: 2,
                shares: 3,
                saves: 4,
                followers: 50,
                completion_rate: Some(0.4),
            },
            note: String::new(),
            comment_sample: String::new(),
            created_at: "2026-11-01T09:00:00".to_string(),
        };
        upsert_item(&ws, upsert(OpsItemKind::Review, &review)).expect("seed");

        // 只改播放量：其余五个指标与完播率必须留着。
        let patch = serde_json::json!({
            "kind": "review",
            "id": "r1",
            "metrics": { "views": 900 },
        });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, _) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(state.reviews[0].metrics.views, 900);
        assert_eq!(state.reviews[0].metrics.likes, 10);
        assert_eq!(state.reviews[0].metrics.completion_rate, Some(0.4));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn missing_id_gets_a_generated_one() {
        let ws = make_test_workspace("ops-generate-id");
        let patch = serde_json::json!({ "kind": "topic", "title": "选题", "platform": "douyin" });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, id) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(state.topics.len(), 1);
        assert!(
            state.topics[0].id.starts_with("topic-"),
            "id 应该由 store 生成并带类型前缀: {}",
            state.topics[0].id
        );
        assert!(!state.topics[0].created_at.is_empty());
        assert!(!state.topics[0].updated_at.is_empty());
        assert_eq!(id, state.topics[0].id, "回传的 id 必须就是刚写入那条的 id");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn review_can_be_created_before_the_numbers_arrive() {
        let ws = make_test_workspace("ops-review-no-metrics");
        // 刚投放还没数据：只给必填字段，不给 metrics。
        let patch = serde_json::json!({
            "kind": "review",
            "assetId": "a1",
            "platform": "douyin",
            "publishedAt": "2026-11-01T09:00:00+00:00",
        });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, id) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(state.reviews.len(), 1);
        assert_eq!(state.reviews[0].metrics.views, 0, "缺 metrics 要补零而不是反序列化失败");
        assert_eq!(state.reviews[0].metrics.likes, 0);
        assert_eq!(id, state.reviews[0].id);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn upsert_returns_the_id_of_the_record_it_wrote() {
        let ws = make_test_workspace("ops-upsert-id");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("seed");

        let patch = serde_json::json!({ "kind": "topic", "id": "t1", "status": "produced" });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, id) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(id, "t1");
        assert_eq!(state.topics[0].id, "t1");
        let _ = fs::remove_dir_all(&ws);
    }

    /// 时间戳精度必须是毫秒。`to_rfc3339()` 默认输出 9 位小数，renderer 在
    /// macOS 的 WebKit 里 `new Date(...)` 不保证解析得了——ES 规范只认 3 位。
    #[test]
    fn timestamps_are_millisecond_precision() {
        let ws = make_test_workspace("ops-timestamp-precision");
        upsert_item(&ws, topic_upsert(&topic("t1"))).expect("seed");
        let state = read_state(&ws).expect("read");
        // 看 `updated_at`：`created_at` 可以由写者自带（fixture 就是），
        // 只有 store 自己盖的 `updated_at` 才反映 `now_iso()` 的格式。
        let created = &state.topics[0].updated_at;

        let fractional = created
            .split('.')
            .nth(1)
            .and_then(|rest| rest.split(['+', 'Z']).next())
            .unwrap_or_else(|| panic!("时间戳缺少小数部分: {}", created));
        assert_eq!(
            fractional.len(),
            3,
            "时间戳必须是毫秒精度（3 位小数），实际 {}: {}",
            fractional.len(),
            created
        );
        assert!(created.ends_with('Z'), "UTC 时间戳用 Z 后缀: {}", created);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn update_preserves_created_at_and_refreshes_updated_at() {
        let ws = make_test_workspace("ops-timestamps");
        let mut seed = topic("t1");
        seed.created_at = "2026-01-01T00:00:00+00:00".to_string();
        seed.updated_at = "2026-01-01T00:00:00+00:00".to_string();
        upsert_item(&ws, topic_upsert(&seed)).expect("seed");

        let patch = serde_json::json!({ "kind": "topic", "id": "t1", "status": "produced" });
        let upsert: OpsUpsert = serde_json::from_value(patch).expect("deserialize");
        let (state, _) = upsert_item(&ws, upsert).expect("upsert");

        assert_eq!(
            state.topics[0].created_at, "2026-01-01T00:00:00+00:00",
            "改字段不该改「何时创建」"
        );
        assert_ne!(
            state.topics[0].updated_at, "2026-01-01T00:00:00+00:00",
            "改字段必须刷新「何时更新」——派生的「本周完成」靠它"
        );
        let _ = fs::remove_dir_all(&ws);
    }

    // ── 线索（评论信号）───────────────────────────────────────────────

    fn clue_patch(fields: serde_json::Value) -> OpsUpsert {
        OpsUpsert {
            kind: OpsItemKind::Clue,
            fields: fields.as_object().cloned().expect("object"),
        }
    }

    fn benchmark_patch(fields: serde_json::Value) -> OpsUpsert {
        OpsUpsert {
            kind: OpsItemKind::Benchmark,
            fields: fields.as_object().cloned().expect("object"),
        }
    }

    /// 同一段评论被采两次 → 一条，且后一次的内容补上去。
    #[test]
    fn clue_upsert_merges_the_same_comment_id() {
        let ws = make_test_workspace("ops-clue-key");
        let (state, first) = upsert_item(
            &ws,
            clue_patch(serde_json::json!({
                "platform": "douyin",
                "commentId": "c-1",
                "authorName": "小王",
                "content": "多少钱？",
                "intent": "price",
            })),
        )
        .expect("first");
        assert_eq!(state.clues.len(), 1);
        assert!(first.starts_with("clue-"), "id 应当带类型前缀: {}", first);

        // 第二次采集同一条评论（不同 id 都不给，只给天然键）：必须落在同一条。
        let (state, second) = upsert_item(
            &ws,
            clue_patch(serde_json::json!({
                "platform": "douyin",
                "commentId": "c-1",
                "content": "多少钱？有优惠吗？",
            })),
        )
        .expect("second");

        assert_eq!(first, second, "同一条评论必须复用同一条记录");
        assert_eq!(state.clues.len(), 1, "重复采集不该堆出第二条");
        assert_eq!(state.clues[0].author_name, "小王", "没传的字段要留着");
        assert_eq!(state.clues[0].content, "多少钱？有优惠吗？", "传了的字段要更新");
        assert_eq!(state.clues[0].intent, OpsClueIntent::Price);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn different_comment_ids_stay_separate_clues() {
        let ws = make_test_workspace("ops-clue-distinct");
        upsert_item(
            &ws,
            clue_patch(serde_json::json!({
                "platform": "douyin", "commentId": "c-1", "content": "多少钱？"
            })),
        )
        .expect("first");
        let (state, _) = upsert_item(
            &ws,
            clue_patch(serde_json::json!({
                "platform": "douyin", "commentId": "c-2", "content": "哪里买？"
            })),
        )
        .expect("second");

        assert_eq!(state.clues.len(), 2, "不同的评论是两条线索");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn clue_without_comment_id_is_rejected() {
        let ws = make_test_workspace("ops-clue-no-comment-id");
        let err = upsert_item(
            &ws,
            clue_patch(serde_json::json!({ "platform": "douyin", "content": "多少钱？" })),
        )
        .expect_err("must reject");
        assert!(err.contains("commentId"), "错误要说清缺什么: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    /// 手写一份 state.json：同平台同 commentId 两条线索 —— 读的时候就得拒。
    #[test]
    fn duplicate_clue_comment_id_in_state_file_is_rejected() {
        let ws = make_test_workspace("ops-clue-dup");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let raw = serde_json::json!({
            "version": OPS_STATE_VERSION,
            "clues": [
                { "id": "c1", "platform": "douyin", "commentId": "x-1" },
                { "id": "c2", "platform": "douyin", "commentId": "x-1" },
            ],
        })
        .to_string();
        fs::write(ops_dir.join("state.json"), raw).expect("write");

        let err = read_state(&ws).expect_err("must reject");
        assert!(err.contains("Duplicate clue"), "错误要说清是重复: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    /// 对标账号：同一个主页反复加只合并成一条。
    #[test]
    fn benchmark_upsert_merges_the_same_profile_url() {
        let ws = make_test_workspace("ops-benchmark-key");
        let (state, first) = upsert_item(
            &ws,
            benchmark_patch(serde_json::json!({
                "platform": "douyin",
                "name": "露营老王",
                "profileUrl": "https://www.douyin.com/user/abc",
                "source": "user",
            })),
        )
        .expect("first");
        assert!(first.starts_with("benchmark-"), "id 应当带类型前缀: {}", first);

        let (state, second) = upsert_item(
            &ws,
            benchmark_patch(serde_json::json!({
                "platform": "douyin",
                "profileUrl": "https://www.douyin.com/user/abc",
                "why": "同赛道，讲解式开头",
            })),
        )
        .expect("second");

        assert_eq!(first, second, "同一个主页必须复用同一条对标");
        assert_eq!(state.benchmarks.len(), 1);
        assert_eq!(state.benchmarks[0].name, "露营老王", "没传的字段要留着");
        assert_eq!(state.benchmarks[0].why, "同赛道，讲解式开头");
        assert_eq!(state.benchmarks[0].source, OpsBenchmarkSource::User);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn benchmark_without_profile_url_is_rejected() {
        let ws = make_test_workspace("ops-benchmark-no-url");
        let err = upsert_item(
            &ws,
            benchmark_patch(serde_json::json!({ "platform": "douyin", "name": "露营老王" })),
        )
        .expect_err("must reject");
        assert!(err.contains("profileUrl"), "错误要说清缺什么: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn duplicate_benchmark_profile_url_in_state_file_is_rejected() {
        let ws = make_test_workspace("ops-benchmark-dup");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let raw = serde_json::json!({
            "version": OPS_STATE_VERSION,
            "benchmarks": [
                { "id": "b1", "platform": "douyin", "profileUrl": "https://x/1" },
                { "id": "b2", "platform": "douyin", "profileUrl": "https://x/1" },
            ],
        })
        .to_string();
        fs::write(ops_dir.join("state.json"), raw).expect("write");

        let err = read_state(&ws).expect_err("must reject");
        assert!(
            err.contains("Duplicate benchmark"),
            "错误要说清是重复: {}",
            err
        );
        let _ = fs::remove_dir_all(&ws);
    }

    /// 老台账里没有 `basis` / `commentSample` 这两个键 —— 加字段不能把老
    /// 工作区读成坏掉。
    #[test]
    fn records_written_before_the_evidence_fields_still_load() {
        let ws = make_test_workspace("ops-evidence-legacy");
        let ops_dir = ws.join("ops");
        fs::create_dir_all(&ops_dir).expect("mkdir");
        let raw = serde_json::json!({
            "version": OPS_STATE_VERSION,
            "rules": [
                {
                    "id": "rule-1",
                    "name": "标题里写清数字",
                    "rule": "封面写清数字的笔记点击率更高",
                    "source": "reflection",
                    "status": "active",
                    "confidence": 0.6,
                    "createdAt": "2026-11-12T00:00:00.000Z",
                    "updatedAt": "2026-11-12T00:00:00.000Z",
                },
            ],
            "reviews": [
                {
                    "id": "review-1",
                    "assetId": "asset-1",
                    "platform": "douyin",
                    "publishedAt": "2026-11-12T00:00:00.000Z",
                    "metrics": { "views": 1200 },
                    "createdAt": "2026-11-12T00:00:00.000Z",
                    "updatedAt": "2026-11-12T00:00:00.000Z",
                },
            ],
        })
        .to_string();
        fs::write(ops_dir.join("state.json"), raw).expect("write");

        let state = read_state(&ws).expect("老台账必须读得出来");

        // 旧规则不该被补上证据 —— 补上就是把「没查过」显示成「核实过」。
        assert_eq!(state.rules[0].basis, OpsRuleBasis::Unresolved);
        // 旧复盘没有留样，就是没有，不能凭空造一句。
        assert_eq!(state.reviews[0].comment_sample, "");
        let _ = fs::remove_dir_all(&ws);
    }

    /// 拼错的性质必须报错，不能静默落成默认值 —— 默认值是「未定」，
    /// 而 Agent 拼错时以为自己标的是「已核实」。
    #[test]
    fn an_unknown_evidence_kind_is_rejected() {
        let ws = make_test_workspace("ops-evidence-bad-basis");
        let err = upsert_item(
            &ws,
            OpsUpsert {
                kind: OpsItemKind::Rule,
                fields: serde_json::json!({
                    "name": "标题里写清数字",
                    "rule": "封面写清数字的笔记点击率更高",
                    "basis": "verifiedd",
                })
                .as_object()
                .cloned()
                .expect("object"),
            },
        )
        .expect_err("must reject");
        // serde 的报错要说清：写错了什么，以及该写什么。
        assert!(err.contains("verifiedd"), "错误要点名写错的值: {}", err);
        assert!(err.contains("author_report"), "错误要列出可选值: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }
}

#[cfg(test)]
mod parity_tests {
    use super::*;

    const TS_OPS: &str = include_str!("../../src/shared/ops.ts");
    const TS_PLATFORMS: &str = include_str!("../../src/shared/socialPlatforms.ts");

    /// 取 TS 里 `const NAME: readonly ... = [...];` 那一段的字面量。
    ///
    /// 找的是**声明**，不是第一个出现：同名常量常常先在别处被引用
    /// （`isOneOf(value, OPS_DIRECTION_STATUSES)` 就排在声明前面），命中引用
    /// 会把「字面量」截成一句函数调用，断言随之永远失败——方向状态那条
    /// parity 测试已经这么红了一段时间。
    fn ts_array_literal(source: &str, name: &str) -> String {
        let decl = format!("export const {}:", name);
        let idx = source
            .find(decl.as_str())
            .unwrap_or_else(|| panic!("TS 契约里找不到 {}", name));
        let rest = &source[idx..];
        let end = rest.find(';').unwrap_or(rest.len());
        rest[..end].to_string()
    }

    fn assert_ts_array_has(source: &str, name: &str, value: &str) {
        let literal = ts_array_literal(source, name);
        assert!(
            literal.contains(&format!("'{}'", value)),
            "Rust 侧有 '{}'，但 TS 的 {} 里没有——两侧枚举漂移了",
            value,
            name
        );
    }

    #[test]
    fn topic_status_values_exist_in_ts_contract() {
        for value in ["idea", "planned", "produced", "dropped"] {
            assert_ts_array_has(TS_OPS, "OPS_TOPIC_STATUSES", value);
        }
    }

    #[test]
    fn topic_source_values_exist_in_ts_contract() {
        for value in ["hotspot", "benchmark", "manual", "reflection"] {
            assert_ts_array_has(TS_OPS, "OPS_TOPIC_SOURCES", value);
        }
    }

    #[test]
    fn asset_status_values_exist_in_ts_contract() {
        for value in ["draft", "ready", "published", "unverified"] {
            assert_ts_array_has(TS_OPS, "OPS_ASSET_STATUSES", value);
        }
    }

    #[test]
    fn rule_status_and_source_values_exist_in_ts_contract() {
        for value in ["proposed", "active"] {
            assert_ts_array_has(TS_OPS, "OPS_RULE_STATUSES", value);
        }
        for value in ["reflection", "manual", "dialog"] {
            assert_ts_array_has(TS_OPS, "OPS_RULE_SOURCES", value);
        }
    }

    #[test]
    fn rule_basis_values_exist_in_ts_contract() {
        for value in ["verified", "author_report", "inference", "unresolved"] {
            assert_ts_array_has(TS_OPS, "OPS_RULE_BASES", value);
        }
    }

    #[test]
    fn direction_status_values_exist_in_ts_contract() {
        for value in ["draft", "active"] {
            assert_ts_array_has(TS_OPS, "OPS_DIRECTION_STATUSES", value);
        }
    }

    #[test]
    fn login_state_values_exist_in_ts_contract() {
        for value in ["unknown", "success", "expired"] {
            assert_ts_array_has(TS_OPS, "OPS_LOGIN_STATES", value);
        }
    }

    #[test]
    fn clue_intent_values_exist_in_ts_contract() {
        for value in ["price", "where", "howto", "other"] {
            assert_ts_array_has(TS_OPS, "OPS_CLUE_INTENTS", value);
        }
    }

    #[test]
    fn clue_status_values_exist_in_ts_contract() {
        for value in ["new", "qualified", "archived"] {
            assert_ts_array_has(TS_OPS, "OPS_CLUE_STATUSES", value);
        }
    }

    #[test]
    fn benchmark_source_values_exist_in_ts_contract() {
        for value in ["user", "agent"] {
            assert_ts_array_has(TS_OPS, "OPS_BENCHMARK_SOURCES", value);
        }
    }

    /// 台账记录类型的枚举两侧必须一致：Rust 多一种而 TS 没有，界面就写不出
    /// 那条记录（或反过来读出一个不认识的 kind）。
    #[test]
    fn item_kinds_exist_in_ts_contract() {
        for kind in [
            OpsItemKind::Topic,
            OpsItemKind::Asset,
            OpsItemKind::Review,
            OpsItemKind::Rule,
            OpsItemKind::Style,
            OpsItemKind::Direction,
            OpsItemKind::Account,
            OpsItemKind::Clue,
            OpsItemKind::Benchmark,
        ] {
            assert_ts_array_has(TS_OPS, "OPS_ITEM_KINDS", kind.as_str());
        }
    }

    #[test]
    fn platform_ids_exist_in_ts_registry() {
        for platform in OPS_PLATFORM_IDS {
            assert!(
                TS_PLATFORMS.contains(&format!("'{}'", platform)),
                "Rust 侧允许平台 '{}'，但 TS 平台注册表里没有",
                platform
            );
        }
    }

    #[test]
    fn state_version_matches_ts_contract() {
        assert!(
            TS_OPS.contains(&format!("OPS_STATE_VERSION = {}", OPS_STATE_VERSION)),
            "Rust 与 TS 的 state 版本号不一致"
        );
    }
}
