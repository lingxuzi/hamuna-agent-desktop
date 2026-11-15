//! Per-workspace browser profile isolation.
//!
//! 一个工作区 = 一套浏览器 profile = 一份 cookie。登录态因此不跨工作区：在 A
//! 工作区登录的号，在 B 工作区看不见 —— 这是「账号体系跟着工作区走」的物理
//! 基础（账号清单本身落在台账 `ops/state.json` 里）。
//!
//! 平台差异（对着 wry 0.55 / tauri 2.11 的实际行为核过，不是猜的）：
//!
//! - macOS 14+：`data_store_identifier` → `WKWebsiteDataStore::dataStoreForIdentifier`，
//!   一个命名的持久化 store。**macOS 13 及以下会静默回落到默认 store**（也就是
//!   共用 cookie），所以 App 的最低 macOS 版本被抬到 14.0 —— 与其给用户一个
//!   「以为隔离了其实没隔离」的坑，不如不支持那个系统。
//! - Windows / Linux：`data_directory` → 每个目录一份独立的 WebContext
//!   （WebView2 的 userDataFolder / WebKitGTK 的 cookie 目录）。
//!
//! 两条路都落到同一个 16 字节 id 上：macOS 用它当 store 标识，Windows/Linux
//! 用它的 hex 当目录名。

use std::path::PathBuf;

use sha2::{Digest, Sha256};

use crate::device_identity::hex_encode;

/// A workspace's browser profile.
#[derive(Debug, Clone)]
pub struct WorkspaceProfile {
    /// macOS: the identifier of the named WKWebView data store.
    pub data_store_identifier: [u8; 16],
    /// Windows / Linux: the per-profile data directory.
    pub data_directory: PathBuf,
    /// Hex form of the identifier — the directory name and the log tag.
    pub key: String,
}

/// Derive the browser profile of a workspace.
///
/// The path is normalized first (`normalize_workspace_path_identity`) so that
/// `C:\work\a`, `c:/work/a` and `C:\work\a\` are ONE workspace, not three —
/// otherwise the same workspace would get three profiles and three logins.
///
/// The digest is **SHA-256**, not `DefaultHasher`: the std hasher is explicitly
/// documented as unstable across Rust versions, and an unstable profile id
/// silently orphans every workspace's cookies on the next toolchain upgrade
/// (every user would have to log in everywhere again). SHA-256 is a fixed
/// spec, and `sha2` is already a dependency.
pub fn profile_for_workspace(workspace: &str) -> Result<WorkspaceProfile, String> {
    let normalized = crate::workspace_path::normalize_workspace_path_identity(workspace.trim());
    if normalized.is_empty() {
        return Err("Workspace path is empty — cannot derive a browser profile.".to_string());
    }

    let digest = Sha256::digest(normalized.as_bytes());
    let mut identifier = [0u8; 16];
    identifier.copy_from_slice(&digest[..16]);
    let key = hex_encode(&identifier);

    let base = crate::app_dirs::hamuna_data_dir().ok_or_else(|| {
        "Cannot resolve ~/.hamuna — the browser profile has no home directory.".to_string()
    })?;

    Ok(WorkspaceProfile {
        data_store_identifier: identifier,
        // The profile directory lives under ~/.hamuna, NOT inside the
        // workspace: the workspace may be synced to git or a network drive,
        // and a cookie jar in there is a disaster.
        data_directory: base.join("browser-profiles").join(&key),
        key,
    })
}

impl WorkspaceProfile {
    /// Create the profile's data directory (Windows / Linux).
    ///
    /// WebView2 and WebKitGTK create it on demand, but doing it here means a
    /// broken profile fails at creation with a readable message instead of
    /// surfacing later as "the browser opened but nothing is logged in".
    pub fn ensure_data_directory(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_directory).map_err(|e| {
            format!(
                "Could not create the browser profile directory {}: {e}",
                self.data_directory.display()
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_workspace_written_differently_is_one_profile() {
        let unix = profile_for_workspace("/home/me/work/sino").unwrap();
        let unix_slash = profile_for_workspace("/home/me/work/sino/").unwrap();
        let windows = profile_for_workspace("C:\\work\\sino").unwrap();
        let windows_slash = profile_for_workspace("c:/work/sino").unwrap();

        assert_eq!(unix.key, unix_slash.key, "尾斜杠不算另一个工作区");
        assert_eq!(windows.key, windows_slash.key, "盘符大小写不算另一个工作区");
        assert_ne!(unix.key, windows.key, "不同根路径必须是不同 profile");
    }

    #[test]
    fn different_workspaces_get_different_profiles() {
        let a = profile_for_workspace("/home/me/work/sino").unwrap();
        let b = profile_for_workspace("/home/me/work/other").unwrap();
        assert_ne!(a.key, b.key);
        assert_ne!(a.data_store_identifier, b.data_store_identifier);
    }

    #[test]
    fn the_profile_id_is_pinned() {
        // 写死这个值：换算法 / 换归一化规则 = 所有工作区的登录态一次性作废，
        // 而症状只是「又要重新登录」，没人会想到是这条常量动了。这条断言就是
        // 那根红线。
        let profile = profile_for_workspace("/workspace/demo").unwrap();
        assert_eq!(profile.key, "4de1d2f8b60db00ae8307a6fe19690b2");
    }

    #[test]
    fn an_empty_workspace_is_rejected() {
        assert!(profile_for_workspace("").is_err());
        assert!(profile_for_workspace("   ").is_err());
    }
}
