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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsTopicStatus {
    Idea,
    Planned,
    Produced,
    Dropped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsTopicSource {
    Hotspot,
    Benchmark,
    Manual,
    Reflection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsAssetStatus {
    Draft,
    Ready,
    Published,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsRuleStatus {
    Proposed,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpsRuleSource {
    Reflection,
    Manual,
    Dialog,
}

// ── 实体 ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsTopic {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub angle: String,
    pub platform: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: OpsTopicStatus,
    pub source: OpsTopicSource,
    #[serde(default)]
    pub source_refs: Vec<String>,
    /// 参考内容的播放量。`None` = 没有可比的参考内容，界面显示「—」而不是 0。
    #[serde(default)]
    pub hotness: Option<u64>,
    pub created_at: String,
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
    pub id: String,
    /// 素材来自哪条选题。`None` = 手动导入的稿件，不挂选题。
    #[serde(default)]
    pub topic_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: String,
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
    pub status: OpsAssetStatus,
    #[serde(default)]
    pub published_at: Option<String>,
    /// 制作完成度 0–100。Agent 每次改素材更新一次。
    #[serde(default)]
    pub progress: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsReviewMetrics {
    pub views: u64,
    pub likes: u64,
    pub comments: u64,
    pub shares: u64,
    pub saves: u64,
    pub followers: u64,
    /// 完播率 0–1。`None` = 平台不给这个指标。
    #[serde(default)]
    pub completion_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsReview {
    pub id: String,
    pub asset_id: String,
    pub platform: String,
    pub published_at: String,
    pub metrics: OpsReviewMetrics,
    #[serde(default)]
    pub note: String,
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
    pub id: String,
    pub name: String,
    pub rule: String,
    pub source: OpsRuleSource,
    pub status: OpsRuleStatus,
    pub confidence: f64,
    pub evidence: String,
    /// 对照条。由反思侧算好存下，前端只渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_bars: Option<Vec<OpsEvidenceBar>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsStyle {
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

/// 写入载荷：内部标签 + 对应实体。JSON 形态是
/// `{"kind":"topic", ...topic 字段}`——CLI、HTTP、invoke 三条路共用这一份。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpsUpsert {
    Topic(OpsTopic),
    Asset(OpsAsset),
    Review(OpsReview),
    Rule(OpsRule),
    Style(OpsStyle),
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

/// 锁内读-改-写，然后原子发布。
fn mutate_state<F>(workspace_root: &Path, mutator: F) -> Result<OpsState, String>
where
    F: FnOnce(&mut OpsState) -> Result<(), String>,
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
        move || -> Result<OpsState, FileLockError> {
            let mut state = read_state_at(&state_path).map_err(to_io_err)?;
            mutator(&mut state).map_err(to_io_err)?;
            validate_state(&state).map_err(to_io_err)?;
            let content = serde_json::to_string_pretty(&state)
                .map_err(|e| to_io_err(format!("[ops-store] Cannot serialize ops state: {}", e)))?;
            fs_atomic::atomic_publish(&state_path, &content, "ops-store").map_err(to_io_err)?;
            Ok(state)
        },
    );

    result.map_err(|e| match e {
        FileLockError::Busy { .. } => e.to_string(),
        FileLockError::Io(io_err) => format!("[ops-store] {}", io_err),
    })
}

/// 写入或覆盖一条记录（同 id 覆盖）。
pub fn upsert_item(workspace_root: &Path, item: OpsUpsert) -> Result<OpsState, String> {
    mutate_state(workspace_root, |state| {
        match item {
            OpsUpsert::Topic(topic) => upsert_by_id(&mut state.topics, topic, |t| t.id.as_str()),
            OpsUpsert::Asset(asset) => upsert_by_id(&mut state.assets, asset, |a| a.id.as_str()),
            OpsUpsert::Review(review) => upsert_by_id(&mut state.reviews, review, |r| r.id.as_str()),
            OpsUpsert::Rule(rule) => upsert_by_id(&mut state.rules, rule, |r| r.id.as_str()),
            OpsUpsert::Style(style) => {
                state.style = Some(style);
                Ok(())
            }
        }
    })
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
}

fn upsert_by_id<T, F>(list: &mut Vec<T>, item: T, id_of: F) -> Result<(), String>
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
    Ok(())
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

#[tauri::command]
pub async fn cmd_ops_upsert(workspace: String, item: OpsUpsert) -> Result<OpsState, String> {
    let root = validate_workspace_root(&workspace)?;
    let state = tauri::async_runtime::spawn_blocking(move || upsert_item(&root, item))
        .await
        .map_err(|e| format!("[ops-store] upsert task failed: {}", e))??;
    emit_changed(&workspace);
    Ok(state)
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
            cover: None,
            images: Vec::new(),
            shots: Vec::new(),
            platform: "xiaohongshu".to_string(),
            scheduled_at: None,
            status: OpsAssetStatus::Draft,
            published_at: None,
            progress: 0,
            created_at: "2026-11-01T09:00:00".to_string(),
            updated_at: "2026-11-01T09:00:00".to_string(),
        }
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
        let state = upsert_item(&ws, OpsUpsert::Topic(topic("t1"))).expect("upsert");
        assert_eq!(state.topics.len(), 1);

        let reread = read_state(&ws).expect("read");
        assert_eq!(reread.topics.len(), 1);
        assert_eq!(reread.topics[0].id, "t1");
        assert_eq!(reread.topics[0].title, "选题 t1");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn upsert_with_same_id_replaces_instead_of_duplicating() {
        let ws = make_test_workspace("ops-replace");
        upsert_item(&ws, OpsUpsert::Topic(topic("t1"))).expect("first");
        let mut updated = topic("t1");
        updated.title = "改过的标题".to_string();
        let state = upsert_item(&ws, OpsUpsert::Topic(updated)).expect("second");

        assert_eq!(state.topics.len(), 1);
        assert_eq!(state.topics[0].title, "改过的标题");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn state_file_is_human_readable_json() {
        let ws = make_test_workspace("ops-readable");
        upsert_item(&ws, OpsUpsert::Topic(topic("t1"))).expect("upsert");

        let raw = fs::read_to_string(ws.join("ops/state.json")).expect("read raw");
        assert!(raw.contains("\n"), "应该缩进排版而不是压成一行");
        assert!(raw.contains("\"id\": \"t1\""));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn delete_removes_only_the_target_record() {
        let ws = make_test_workspace("ops-delete");
        upsert_item(&ws, OpsUpsert::Topic(topic("t1"))).expect("t1");
        upsert_item(&ws, OpsUpsert::Topic(topic("t2"))).expect("t2");
        upsert_item(&ws, OpsUpsert::Asset(asset("a1"))).expect("a1");

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
        let write_err = upsert_item(&ws, OpsUpsert::Topic(topic("t1"))).expect_err("write should fail");
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
        let err = upsert_item(&ws, OpsUpsert::Topic(bad)).expect_err("should fail");
        assert!(err.contains("Unknown platform"), "错误信息: {}", err);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn out_of_range_progress_is_rejected() {
        let ws = make_test_workspace("ops-progress");
        let mut bad = asset("a1");
        bad.progress = 120;
        let err = upsert_item(&ws, OpsUpsert::Asset(bad)).expect_err("should fail");
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
                    upsert_item(&root, OpsUpsert::Topic(topic(&format!("t{}", i))))
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
        match upsert {
            OpsUpsert::Topic(topic) => {
                assert_eq!(topic.id, "t1");
                assert_eq!(topic.source, OpsTopicSource::Hotspot);
            }
            other => panic!("expected topic, got {:?}", other),
        }
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
        for value in ["draft", "ready", "published"] {
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
