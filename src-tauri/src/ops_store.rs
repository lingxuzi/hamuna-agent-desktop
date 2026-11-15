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
    #[serde(default)]
    pub evidence: String,
    /// 对照条。由反思侧算好存下，前端只渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_bars: Option<Vec<OpsEvidenceBar>>,
    #[serde(default)]
    pub created_at: String,
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
    #[serde(default)]
    pub topics: Vec<OpsTopic>,
    #[serde(default)]
    pub assets: Vec<OpsAsset>,
    #[serde(default)]
    pub reviews: Vec<OpsReview>,
    #[serde(default)]
    pub rules: Vec<OpsRule>,
    #[serde(default)]
    pub style: Option<OpsStyle>,
}

impl OpsState {
    /// 合法空骨架。文件不存在时用它——不因为「读不到」就顺手建一个文件，
    /// 那是第二个写者。
    pub fn empty() -> Self {
        Self {
            version: OPS_STATE_VERSION,
            topics: Vec::new(),
            assets: Vec::new(),
            reviews: Vec::new(),
            rules: Vec::new(),
            style: None,
        }
    }
}

/// 记录类型。删除时用来指明删哪一条。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpsItemKind {
    Topic,
    Asset,
    Review,
    Rule,
    Style,
}

impl OpsItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            OpsItemKind::Topic => "topic",
            OpsItemKind::Asset => "asset",
            OpsItemKind::Review => "review",
            OpsItemKind::Rule => "rule",
            OpsItemKind::Style => "style",
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
        OpsItemKind::Topic => upsert_topic(state, fields),
        OpsItemKind::Asset => upsert_asset(state, fields),
        OpsItemKind::Review => upsert_review(state, fields),
        OpsItemKind::Rule => upsert_rule(state, fields),
        OpsItemKind::Style => upsert_style(state, fields),
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
            OpsItemKind::Topic => remove_by_id(&mut state.topics, id, |t| t.id.as_str()),
            OpsItemKind::Asset => remove_by_id(&mut state.assets, id, |a| a.id.as_str()),
            OpsItemKind::Review => remove_by_id(&mut state.reviews, id, |r| r.id.as_str()),
            OpsItemKind::Rule => remove_by_id(&mut state.rules, id, |r| r.id.as_str()),
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
}

#[cfg(test)]
mod parity_tests {
    use super::*;

    const TS_OPS: &str = include_str!("../../src/shared/ops.ts");
    const TS_PLATFORMS: &str = include_str!("../../src/shared/socialPlatforms.ts");

    /// 取 TS 里 `const NAME: readonly ... = [...];` 那一段的字面量。
    fn ts_array_literal(source: &str, name: &str) -> String {
        let idx = source
            .find(name)
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
