// Tauri IPC commands for sidecar management and app operations
// Supports both legacy single-instance and new multi-instance APIs

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, State};

#[allow(unused_imports)]
use serde::{Deserialize, Serialize};

use crate::logger;
use crate::perf_trace::{elapsed_ms, emit_perf_trace, trace_start, PerfTrace, PerfTraceName};
#[cfg(not(target_os = "windows"))]
use crate::sidecar::{begin_update_shutdown, shutdown_for_update_verified};
use crate::sidecar::{
    check_process_alive,
    ensure_sidecar_running,
    // Legacy exports
    get_sidecar_status,
    get_tab_server_url,
    get_tab_sidecar_status,
    restart_sidecar,
    start_global_sidecar,
    start_sidecar,
    // New multi-instance exports
    start_tab_sidecar,
    stop_all_sidecars,
    stop_sidecar,
    stop_tab_sidecar,
    LegacySidecarConfig,
    ManagedSidecar,
    ManagedSidecarManager,
    SidecarStatus,
    GLOBAL_SIDECAR_ID,
};
use crate::{ulog_error, ulog_info, ulog_warn};

const NETWORK_PROBE_USER_AGENT: &str = "HamunaAgent-Network-Probe/1.0";
const PROXY_CONNECTIVITY_TEST_URL: &str = "https://www.google.com/generate_204";

// ============= Legacy Commands (for backward compatibility) =============

/// Command: Start the sidecar for a project (legacy single-instance)
#[tauri::command]
pub async fn cmd_start_sidecar<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecar>,
    agent_dir: String,
    initial_prompt: Option<String>,
) -> Result<SidecarStatus, String> {
    logger::info(
        &app_handle,
        format!("[sidecar] Starting for project: {}", agent_dir),
    );

    let config = LegacySidecarConfig {
        port: find_available_port().unwrap_or(31415),
        agent_dir: PathBuf::from(&agent_dir),
        initial_prompt,
    };

    match start_sidecar(&app_handle, &state, config) {
        Ok(_) => {
            let status = get_sidecar_status(&state)?;
            logger::info(
                &app_handle,
                format!("[sidecar] Started on port {}", status.port),
            );
            Ok(status)
        }
        Err(e) => {
            logger::error(&app_handle, format!("[sidecar] Failed to start: {}", e));
            Err(e)
        }
    }
}

/// Command: Stop the sidecar (legacy)
#[tauri::command]
pub async fn cmd_stop_sidecar(state: State<'_, ManagedSidecar>) -> Result<(), String> {
    stop_sidecar(&state)
}

/// Command: Get sidecar status (legacy)
#[tauri::command]
pub async fn cmd_get_sidecar_status(
    state: State<'_, ManagedSidecar>,
) -> Result<SidecarStatus, String> {
    get_sidecar_status(&state)
}

/// Command: Get the backend server URL (legacy)
#[tauri::command]
pub async fn cmd_get_server_url(state: State<'_, ManagedSidecar>) -> Result<String, String> {
    let status = get_sidecar_status(&state)?;
    if status.running {
        Ok(format!("http://127.0.0.1:{}", status.port))
    } else {
        Err("Sidecar is not running".to_string())
    }
}

/// Command: Restart the sidecar (legacy)
#[tauri::command]
pub async fn cmd_restart_sidecar<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecar>,
) -> Result<SidecarStatus, String> {
    logger::info(&app_handle, "[sidecar] Restart requested".to_string());

    match restart_sidecar(&app_handle, &state) {
        Ok(port) => {
            let status = get_sidecar_status(&state)?;
            logger::info(&app_handle, format!("[sidecar] Restarted on port {}", port));
            Ok(status)
        }
        Err(e) => {
            logger::error(&app_handle, format!("[sidecar] Restart failed: {}", e));
            Err(e)
        }
    }
}

/// Command: Ensure sidecar is running (legacy)
#[tauri::command]
pub async fn cmd_ensure_sidecar_running<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecar>,
) -> Result<SidecarStatus, String> {
    match ensure_sidecar_running(&app_handle, &state) {
        Ok(port) => {
            let status = get_sidecar_status(&state)?;
            logger::debug(
                &app_handle,
                format!("[sidecar] Ensured running on port {}", port),
            );
            Ok(status)
        }
        Err(e) => {
            logger::error(
                &app_handle,
                format!("[sidecar] Ensure running failed: {}", e),
            );
            Err(e)
        }
    }
}

/// Command: Check if sidecar process is alive (legacy)
#[tauri::command]
pub async fn cmd_check_sidecar_alive(state: State<'_, ManagedSidecar>) -> Result<bool, String> {
    check_process_alive(&state)
}

// ============= New Multi-instance Commands =============

/// Command: Start a sidecar for a specific Tab
#[tauri::command]
pub async fn cmd_start_tab_sidecar<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecar>,
    tab_id: String,
    agent_dir: Option<String>,
) -> Result<SidecarStatus, String> {
    logger::info(
        &app_handle,
        format!(
            "[sidecar] Starting for tab {}, agent_dir: {:?}",
            tab_id, agent_dir
        ),
    );

    let agent_path = agent_dir.map(PathBuf::from);

    match start_tab_sidecar(&app_handle, &state, &tab_id, agent_path) {
        Ok(port) => {
            let status = get_tab_sidecar_status(&state, &tab_id)?;
            logger::info(
                &app_handle,
                format!("[sidecar] Tab {} started on port {}", tab_id, port),
            );
            Ok(status)
        }
        Err(e) => {
            logger::error(
                &app_handle,
                format!("[sidecar] Tab {} failed to start: {}", tab_id, e),
            );
            Err(e)
        }
    }
}

/// Command: Stop a sidecar for a specific Tab
#[tauri::command]
pub async fn cmd_stop_tab_sidecar(
    app_handle: AppHandle,
    state: State<'_, ManagedSidecar>,
    tab_id: String,
) -> Result<(), String> {
    logger::info(&app_handle, format!("[sidecar] Stopping tab {}", tab_id));
    stop_tab_sidecar(&state, &tab_id)
}

/// Command: Get server URL for a specific Tab
#[tauri::command]
pub async fn cmd_get_tab_server_url(
    state: State<'_, ManagedSidecar>,
    tab_id: String,
) -> Result<String, String> {
    get_tab_server_url(&state, &tab_id)
}

/// Command: Get sidecar status for a specific Tab
#[tauri::command]
pub async fn cmd_get_tab_sidecar_status(
    state: State<'_, ManagedSidecar>,
    tab_id: String,
) -> Result<SidecarStatus, String> {
    get_tab_sidecar_status(&state, &tab_id)
}

/// Command: Start the global sidecar (for Settings page)
#[tauri::command]
pub async fn cmd_start_global_sidecar<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecar>,
) -> Result<SidecarStatus, String> {
    logger::info(&app_handle, "[sidecar] Starting global sidecar".to_string());

    match start_global_sidecar(&app_handle, &state) {
        Ok(port) => {
            let status = get_tab_sidecar_status(&state, GLOBAL_SIDECAR_ID)?;
            logger::info(
                &app_handle,
                format!("[sidecar] Global sidecar started on port {}", port),
            );
            Ok(status)
        }
        Err(e) => {
            logger::error(
                &app_handle,
                format!("[sidecar] Global sidecar failed: {}", e),
            );
            Err(e)
        }
    }
}

/// Command: Get global sidecar server URL
#[tauri::command]
pub async fn cmd_get_global_server_url(state: State<'_, ManagedSidecar>) -> Result<String, String> {
    get_tab_server_url(&state, GLOBAL_SIDECAR_ID)
}

/// Command: Stop all sidecar instances (for app exit)
#[tauri::command]
pub async fn cmd_stop_all_sidecars(
    app_handle: AppHandle,
    state: State<'_, ManagedSidecar>,
) -> Result<(), String> {
    logger::info(&app_handle, "[sidecar] Stopping all instances".to_string());
    stop_all_sidecars(&state)
}

/// Command: Shutdown for update — blocks until all child processes are fully terminated.
/// Must be called before relaunch() to prevent NSIS installer file-lock errors on Windows.
#[tauri::command]
pub async fn cmd_shutdown_for_update(
    app_handle: AppHandle,
    state: State<'_, ManagedSidecar>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = state;
        logger::info(
            &app_handle,
            "[sidecar] Windows cmd_shutdown_for_update rejected; use install_pending_update"
                .to_string(),
        );
        return Err("USE_INSTALL_PENDING_UPDATE_ON_WINDOWS".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        logger::info(
            &app_handle,
            "[sidecar] Shutdown for update requested".to_string(),
        );
        let _guard = begin_update_shutdown()?;
        shutdown_for_update_verified(&app_handle, &state)
    }
}

// ============= Utility Functions =============

/// Find an available port
fn find_available_port() -> Option<u16> {
    let preferred = [31415, 31416, 31417, 31418, 31419];

    for &port in &preferred {
        if is_port_available(port) {
            return Some(port);
        }
    }

    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok().map(|addr| addr.port()))
}

/// Check if a port is available
fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok()
}

// ============= Platform & Device Info Commands =============

/// Command: Get platform identifier (matches build target naming)
/// Returns: darwin-aarch64, darwin-x86_64, windows-x86_64, linux-x86_64, etc.
#[tauri::command]
pub fn cmd_get_platform() -> String {
    crate::device_identity::platform_identifier()
}

/// Command: Get or create device ID
/// Stored in ~/.hamuna/device_id to persist across app reinstalls
/// Only regenerates if the file is deleted by user
#[tauri::command]
pub fn cmd_get_device_id() -> Result<String, String> {
    crate::device_identity::get_or_create_device_id()
}

/// Command: Get the full local device identity used by analytics and Space.
#[tauri::command]
pub fn cmd_get_device_identity() -> Result<crate::device_identity::DeviceIdentity, String> {
    crate::device_identity::current_device_identity()
}

// ============= Bundled Workspace Commands =============

#[derive(serde::Serialize)]
pub struct InitBundledWorkspaceResult {
    pub path: String,
    pub is_new: bool,
}

/// Command: Initialize bundled workspace (mino) on first launch
/// Copies from app resources to ~/.hamuna/projects/mino/
#[tauri::command]
pub async fn cmd_initialize_bundled_workspace<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<InitBundledWorkspaceResult, String> {
    tauri::async_runtime::spawn_blocking(move || initialize_bundled_workspace_blocking(app_handle))
        .await
        .map_err(|e| format!("initialize-bundled-workspace task failed: {}", e))?
}

fn initialize_bundled_workspace_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<InitBundledWorkspaceResult, String> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let mino_dest = home_dir.join(".hamuna").join("projects").join("mino");

    // NOTE: Path::exists() follows symlinks, so a dangling
    // ~/.hamuna/projects/mino link returns false here and we'd fall
    // through to copy_dir_recursive — which fails on EEXIST and surfaces
    // a workspace-init error to the user every launch until they clear
    // the link by hand. Same family as the cpSync crash fixed in
    // seedBundledSkills / cmd_sync_system_skills (CLAUDE.md red-line:
    // "用 existsSync / Path::exists() 当存在性探针"). Single fixed path
    // and graceful error → not crashing in production, so left as TODO
    // to avoid scope creep on the v0.2.6 hotfix.
    if mino_dest.exists() {
        return Ok(InitBundledWorkspaceResult {
            path: mino_dest.to_string_lossy().to_string(),
            is_new: false,
        });
    }

    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let mino_src = resource_dir.join("mino");
    if !mino_src.exists() || !mino_src.join("CLAUDE.md").exists() {
        return Err(format!(
            "Bundled mino not found or incomplete in resources: {:?}",
            mino_src
        ));
    }

    ulog_info!(
        "[workspace] Initializing bundled workspace from {:?}",
        mino_src
    );
    copy_dir_recursive(&mino_src, &mino_dest)
        .map_err(|e| format!("Failed to copy mino workspace: {}", e))?;

    // Validate the copy produced a valid workspace
    if !mino_dest.join("CLAUDE.md").exists() {
        let _ = fs::remove_dir_all(&mino_dest);
        return Err("Bundled mino copy produced incomplete workspace".to_string());
    }

    Ok(InitBundledWorkspaceResult {
        path: mino_dest.to_string_lossy().to_string(),
        is_new: true,
    })
}

// =====================================================================
// MiniApp commands (PRD v0.4 §B.1 #8)
// Phase 0 子集：列出已安装 MiniApp + 卸载 + 拿到 bundled root 路径。
// 安全：所有路径 MUST 落在 ~/.hamuna/miniapps/ 下；不跟随 symlink（PRD v0.3 §11.3）。
// =====================================================================

const MINIAPP_HOME_SUBDIR: &str = "miniapps";

fn miniapp_root_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "home_dir unavailable".to_string())?;
    Ok(home.join(".hamuna").join(MINIAPP_HOME_SUBDIR))
}

fn validate_miniapp_path(child: &Path) -> Result<PathBuf, String> {
    let root = miniapp_root_dir()?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize miniapps root: {}", e))?;
    let canon_child = child
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize path: {}", e))?;
    // 拒绝 symlink 逃逸（PRD v0.3 §11.3 + CLAUDE.md §Pit-of-Success fs-utils）
    if let Ok(meta) = std::fs::symlink_metadata(&canon_child) {
        if meta.file_type().is_symlink() {
            return Err("Refusing to follow symlink under miniapps/".to_string());
        }
    }
    if !canon_child.starts_with(&canon_root) {
        return Err("Refusing path outside ~/.hamuna/miniapps/".to_string());
    }
    Ok(canon_child)
}

/// List installed MiniApps under `~/.hamuna/miniapps/<id>/meta.json`.
/// Returns `{ id, name, version }[]` sorted by id.
#[tauri::command]
pub async fn cmd_miniapp_list_installed() -> Result<Vec<MiniAppSummary>, String> {
    tauri::async_runtime::spawn_blocking(list_installed_blocking)
        .await
        .map_err(|e| format!("miniapp list task failed: {}", e))?
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MiniAppSummary {
    pub id: String,
    pub name: String,
    /// Top-level description, i.e. the default-locale one. The renderer pairs
    /// it with `i18n` through `shared/miniapp/localize.ts` — the Marketplace
    /// must not do its own per-locale picking, or the fallback chain drifts
    /// from the one the schema guarantees.
    pub description: String,
    pub version: i64,
    pub path: String,
    /// Phase 3: catalog source tag. `bundled` = ship-from-app, `installed` =
    /// user-installed via Chat-create or Marketplace. Renderers use this to
    /// label cards and gate uninstall (only `installed` cards are removable).
    #[serde(default = "default_miniapp_source")]
    pub source: String,
    /// Phase 4 entry (PRD v0.4 §B.5): MiniApp icon (emoji or asset ref). The
    /// launcher grid renders this; absent values fall back to `📦` on the
    /// renderer side rather than failing the list call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Phase 4 entry (PRD v0.4 §B.5): execution kind. `'worker'` MiniApps need
    /// `worker_kind` to look up the worker entry script; the launcher uses
    /// this to render a kind badge and the scene tab to choose runner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Phase 4 entry (PRD v0.4 §B.5): worker entry name (e.g. `git-graph`).
    /// Required when `kind = "worker"`; the renderer passes this through to
    /// `OPEN_MINIAPP_SCENE` so the scene tab can spin up the right worker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_kind: Option<String>,
    /// CDN `<script>` / `<link>` declared in `meta.json`. Passed through
    /// verbatim: the renderer's schema-level checks (https-only, host in
    /// `permissions.net.allow`) are the authorization boundary, and the CSP
    /// widening is derived from exactly this list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<serde_json::Value>,
    /// `meta.json::i18n.locales` passed through verbatim. Rust does not
    /// resolve it — locale selection is a host-UI concern and lives in one
    /// place (`shared/miniapp/localize.ts`) so every surface agrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i18n: Option<serde_json::Value>,
    /// `meta.json::tags`, for catalog filtering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// `meta.json::permissions`, passed through verbatim. The scene tab
    /// forwards this to `MiniAppRunner`, which uses it as the renderer-side
    /// authorization source for `window.app.*` (fs / shell / net / storage).
    /// Serialized as a plain JSON value rather than a typed struct on purpose:
    /// the renderer + sidecar own the permission *semantics* (`shared/miniapp/
    /// app-permissions.ts`), and a second Rust copy of that shape would be one
    /// more thing to drift out of sync. Absent = no grants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<serde_json::Value>,
}

fn default_miniapp_source() -> String {
    "installed".to_string()
}

/// Phase 3: extended list combining `bundled-miniapps/*` (read-only seed)
/// and `~/.hamuna/miniapps/*` (user-installed). Caller tags each entry with
/// `source`. Bundled entries are NEVER returned by `list_installed_blocking`
/// (that one stays focused on user-installed for existing callers); this new
/// helper is the marketplace-facing one.
#[tauri::command]
pub async fn cmd_miniapp_list_marketplace<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<Vec<MiniAppSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_marketplace_blocking(app_handle))
        .await
        .map_err(|e| format!("miniapp list marketplace task failed: {}", e))?
}

fn list_marketplace_blocking<R: Runtime>(app_handle: AppHandle<R>) -> Result<Vec<MiniAppSummary>, String> {
    use tauri::Manager;
    let mut out: Vec<MiniAppSummary> = Vec::new();

    // Bundled (read-only seed under resource_dir/bundled-miniapps/). Fail
    // soft: in dev the resource_dir may not contain bundled-miniapps/, but
    // Phase 1 Phase 2 already wrapped that — we just collect whatever exists.
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled = resource_dir.join("bundled-miniapps");
        if bundled.exists() {
            if let Ok(rd) = fs::read_dir(&bundled) {
                for entry in rd.flatten() {
                    let meta_path = entry.path().join("meta.json");
                    if let Some(summary) = read_miniapp_meta_for_listing(&meta_path, "bundled") {
                        out.push(summary);
                    }
                }
            }
        }
    }

    // Installed (user-local under ~/.hamuna/miniapps/)
    if let Ok(root) = miniapp_root_dir() {
        if root.exists() {
            if let Ok(rd) = fs::read_dir(&root) {
                for entry in rd.flatten() {
                    let meta_path = entry.path().join("meta.json");
                    if let Some(summary) = read_miniapp_meta_for_listing(&meta_path, "installed") {
                        // If a bundled entry with the same id exists, prefer
                        // the installed copy (user overrode it). Copy every
                        // field the catalog renders — keeping the bundled
                        // name/description next to the installed path would
                        // show a stale title for a local override.
                        if let Some(existing) = out.iter_mut().find(|s| s.id == summary.id) {
                            existing.source = "installed".to_string();
                            existing.version = summary.version;
                            existing.path = summary.path;
                            existing.name = summary.name;
                            existing.description = summary.description;
                            existing.icon = summary.icon;
                            existing.kind = summary.kind;
                            existing.worker_kind = summary.worker_kind;
                            existing.i18n = summary.i18n;
                            existing.tags = summary.tags;
                        } else {
                            out.push(summary);
                        }
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Compare two `x.y.z` versions. `None` when either side is unparseable —
/// an unparseable `min_host_version` is treated as "unknown", not as "pass".
fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// True when `required` <= the running host version.
///
/// This is what makes `min_host_version` mean something. Before this existed
/// the field was validated for shape only, so an app declaring a *future*
/// minimum shipped happily and failed at first use — and three bundled apps
/// declared `0.4.0` while the host was still `0.3.x`.
fn miniapp_host_version_satisfies(required: &str) -> bool {
    let req = match parse_semver(required) {
        Some(v) => v,
        None => return false,
    };
    let host = match parse_semver(env!("CARGO_PKG_VERSION")) {
        Some(v) => v,
        None => return false,
    };
    req <= host
}

fn read_miniapp_meta_for_listing(meta_path: &Path, source: &str) -> Option<MiniAppSummary> {
    if !meta_path.exists() {
        return None;
    }
    let raw = fs::read_to_string(meta_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    // Gate on `min_host_version` before doing any more work: an app that needs
    // a newer host must not appear in the catalog, or the user opens it and
    // gets a blank tab with no explanation.
    if let Some(min) = parsed.get("min_host_version").and_then(|v| v.as_str()) {
        if !miniapp_host_version_satisfies(min) {
            return None;
        }
    }
    let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let version = parsed.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
    if id.is_empty() {
        return None;
    }
    Some(MiniAppSummary {
        id,
        name,
        description: parsed
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        version,
        path: meta_path.parent()?.to_string_lossy().to_string(),
        source: source.to_string(),
        icon: parsed
            .get("icon")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        kind: parsed
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        worker_kind: parsed
            .get("worker_kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        i18n: parsed.get("i18n").cloned().filter(|v| !v.is_null()),
        tags: parsed.get("tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect()
        }),
        permissions: parsed
            .get("permissions")
            .cloned()
            .filter(|v| v.is_object()),
        dependencies: parsed
            .get("dependencies")
            .cloned()
            .filter(|v| v.is_array()),
    })
}

fn list_installed_blocking() -> Result<Vec<MiniAppSummary>, String> {
    let root = miniapp_root_dir()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<MiniAppSummary> = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("read_dir failed: {}", e))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta_path = entry.path().join("meta.json");
        if let Some(summary) = read_miniapp_meta_for_listing(&meta_path, &default_miniapp_source()) {
            out.push(summary);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Uninstall a MiniApp by removing its directory under `~/.hamuna/miniapps/<id>/`.
/// Refuses to delete outside the miniapps root (PRD v0.3 §11.1).
#[tauri::command]
pub async fn cmd_miniapp_uninstall(app_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || uninstall_blocking(&app_id))
        .await
        .map_err(|e| format!("miniapp uninstall task failed: {}", e))?
}

/// Phase 4 entry (PRD v0.4 §B.5): read a MiniApp's compiled source HTML so
/// `MiniAppSceneTab` can mount `<MiniAppRunner srcDoc={...}>`. Looks up
/// installed first (user overrides bundled), then bundled under
/// `resource_dir/bundled-miniapps/<id>/source/<entry>`. Refuses to read
/// outside either root (PRD v0.3 §11.1).
#[tauri::command]
pub async fn cmd_miniapp_source<R: Runtime>(
    app_handle: AppHandle<R>,
    app_id: String,
) -> Result<MiniAppSourceResponse, String> {
    tauri::async_runtime::spawn_blocking(move || read_miniapp_source_blocking(&app_handle, &app_id))
        .await
        .map_err(|e| format!("miniapp source task failed: {}", e))?
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MiniAppSourceResponse {
    pub app_id: String,
    pub source: String,
    pub entry: String,
}

fn read_miniapp_source_blocking<R: Runtime>(
    app_handle: &AppHandle<R>,
    app_id: &str,
) -> Result<MiniAppSourceResponse, String> {
    if !is_safe_app_id(app_id) {
        return Err("app_id must be kebab-case ASCII".to_string());
    }
    // Phase 4 entry: locate the source directory in installed → bundled order
    // (installed wins, mirroring the marketplace listing semantics so the user
    // sees the version they actually launched).
    let dirs = candidate_source_dirs(app_handle, app_id)?;
    for dir in &dirs {
        let meta_path = dir.join("meta.json");
        let entry = match read_meta_entry(&meta_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let index_path = dir.join(&entry);
        if !index_path.exists() {
            continue;
        }
        let html = fs::read_to_string(&index_path)
            .map_err(|e| format!("read source/index.html failed: {}", e))?;
        // The entry HTML is mounted via iframe `srcdoc`, which is a single
        // document with the parent's base URL — so `href="style.css"` resolves
        // against the app origin, not the MiniApp directory, and never loads.
        // Inline the siblings the entry references before handing it over.
        // `entry` is always a relative path under `dir`, so parent() is Some;
        // fall back to `dir` rather than unwrap so a bare filename can't panic.
        let source_dir = index_path.parent().unwrap_or(dir.as_path());
        let html = inline_miniapp_siblings(&html, source_dir);
        return Ok(MiniAppSourceResponse {
            app_id: app_id.to_string(),
            source: html,
            entry,
        });
    }
    Err(format!("MiniApp '{}' has no readable source/index.html", app_id))
}

/// Replace `<link rel="stylesheet" href="X">` and `<script src="X"></script>`
/// in a MiniApp entry document with the file's own contents.
///
/// Fails soft: a tag whose target is missing (or is an absolute/remote URL, or
/// a path outside the MiniApp's own directory) is left untouched, so the
/// renderer can still see the reference instead of silently losing it.
///
/// Hand-rolled rather than regex-based: the `regex` crate is not a dependency
/// of this crate and this does not justify adding one.
fn inline_miniapp_siblings(html: &str, source_dir: &Path) -> String {
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0usize;

    while cursor < html.len() {
        let next_link = html[cursor..].find("<link").map(|i| cursor + i);
        let next_script = html[cursor..].find("<script").map(|i| cursor + i);
        let (start, is_script) = match (next_link, next_script) {
            (Some(l), Some(s)) if l <= s => (l, false),
            (Some(_), Some(s)) => (s, true),
            (Some(l), None) => (l, false),
            (None, Some(s)) => (s, true),
            (None, None) => break,
        };
        // End of the opening tag.
        let Some(gt_rel) = html[start..].find('>') else {
            break;
        };
        let tag_end = start + gt_rel;
        let tag = &html[start..tag_end];
        let after_tag = tag_end + 1;

        // For `<script src=...></script>` the whole element must be consumed.
        let element_end = if is_script {
            let close = "</script>";
            match html[after_tag..].find(close) {
                Some(i) => after_tag + i + close.len(),
                None => after_tag,
            }
        } else {
            after_tag
        };

        let attr = if is_script { "src" } else { "href" };
        match attr_value(tag, attr) {
            Some(rel) => match read_inline_target(source_dir, &rel) {
                Some(contents) => {
                    out.push_str(&html[cursor..start]);
                    let wrapper = if is_script { "script" } else { "style" };
                    out.push('<');
                    out.push_str(wrapper);
                    out.push_str(">\n");
                    out.push_str(&contents);
                    out.push('\n');
                    out.push_str("</");
                    out.push_str(wrapper);
                    out.push('>');
                }
                None => out.push_str(&html[cursor..element_end]),
            },
            None => out.push_str(&html[cursor..element_end]),
        }

        cursor = element_end;
    }

    out.push_str(&html[cursor..]);
    out
}

/// Read `attr="value"` (or `attr='value'` / unquoted) out of a single tag.
fn attr_value(tag: &str, attr: &str) -> Option<String> {
    let mut from = 0usize;
    while let Some(rel) = tag[from..].find(attr) {
        let at = from + rel;
        from = at + attr.len();
        // Must be preceded by whitespace so `href` does not match `xhref`.
        let preceded_ok = at == 0
            || tag[..at]
                .chars()
                .next_back()
                .map(|c| c.is_whitespace())
                .unwrap_or(false);
        if !preceded_ok {
            continue;
        }
        let rest = &tag[from..];
        let rest = rest.strip_prefix('=')?;
        let rest = rest.trim_start();
        if let Some(body) = rest.strip_prefix('"') {
            return body.split_once('"').map(|(v, _)| v.to_string());
        }
        if let Some(body) = rest.strip_prefix('\'') {
            return body.split_once('\'').map(|(v, _)| v.to_string());
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        if end == 0 {
            return None;
        }
        return Some(rest[..end].to_string());
    }
    None
}

/// Resolve a MiniApp-relative reference to file contents, or `None` when it
/// is not ours to inline (remote / absolute / escaping the MiniApp dir).
fn read_inline_target(source_dir: &Path, rel: &str) -> Option<String> {
    if rel.is_empty()
        || rel.contains("://")
        || rel.starts_with("//")
        || rel.starts_with("data:")
        || rel.starts_with('/')
        || rel.starts_with('#')
    {
        return None;
    }
    // `Path::join` does not normalise, so `/a/b/../c` still *starts_with*
    // `/a/b` component-wise. Reject any `..` segment outright instead — the
    // files we inline are flat siblings (`style.css`, `ui.js`).
    if rel.split(['/', '\\']).any(|seg| seg == ".." || seg == ".") {
        return None;
    }
    fs::read_to_string(source_dir.join(rel)).ok()
}

/// Read the `entry` field from `meta.json` (default `source/index.html`).
fn read_meta_entry(meta_path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(meta_path).map_err(|e| format!("read meta.json: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse meta.json: {}", e))?;
    let entry = parsed
        .get("entry")
        .and_then(|v| v.as_str())
        .unwrap_or("source/index.html");
    Ok(entry.to_string())
}

/// Compute candidate source directories for an appId in installed → bundled
/// order. Used by `read_miniapp_source_blocking`. Fails soft if neither root
/// is reachable.
fn candidate_source_dirs<R: Runtime>(
    app_handle: &AppHandle<R>,
    app_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    if let Ok(root) = miniapp_root_dir() {
        out.push(root.join(app_id));
    }
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        out.push(resource_dir.join("bundled-miniapps").join(app_id));
    }
    Ok(out)
}

fn uninstall_blocking(app_id: &str) -> Result<(), String> {
    if app_id.is_empty()
        || !app_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("app_id must be kebab-case ASCII".to_string());
    }
    let target = miniapp_root_dir()?.join(app_id);
    if !target.exists() {
        return Err(format!("MiniApp '{}' is not installed", app_id));
    }
    let canon = validate_miniapp_path(&target)?;
    fs::remove_dir_all(&canon).map_err(|e| format!("remove_dir_all failed: {}", e))?;
    Ok(())
}

/// Return the bundled MiniApps root directory (read-only source).
/// Used by `bundled-miniapps/<id>/` seed flow; renderer should fall back to this
/// when `~/.hamuna/miniapps/<id>/` doesn't exist yet (PRD v0.4 §B.1 #9 bundled seed).
#[tauri::command]
pub async fn cmd_miniapp_get_bundled_root<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || bundled_root_blocking(&app_handle))
        .await
        .map_err(|e| format!("miniapp bundled root task failed: {}", e))?
}

fn bundled_root_blocking<R: Runtime>(app_handle: &AppHandle<R>) -> Result<String, String> {
    use tauri::Manager;
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {}", e))?;
    let bundled = resource_dir.join("bundled-miniapps");
    if !bundled.exists() {
        return Err("bundled-miniapps/ not found in resource dir".to_string());
    }
    Ok(bundled.to_string_lossy().to_string())
}

// =====================================================================
// MiniApp commands (PRD v0.4 §B.2 Phase 1)
// create_from_chat: Chat Sidecar 转发 AI 生成的 4 文件 → 写盘到 ~/.hamuna/miniapps/<appId>/
// diff_source: 比较当前 source/ 与历史 snapshot（Phase 1 仅结构化 diff）
// 安全：tmp + rename + symlink_metadata + with_file_lock_blocking（PRD v0.3 §11.3 + CLAUDE.md §Pit-of-Success）
// =====================================================================

fn is_safe_app_id(app_id: &str) -> bool {
    !app_id.is_empty()
        && app_id.len() <= 64
        && app_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !app_id.starts_with('-')
        && !app_id.ends_with('-')
}

/// `appDataWorkspace` 子目录名长度上限，与 shared 那份保持一致。
const APP_DATA_WORKSPACE_MAX_LEN: usize = 64;

/// Win32 保留设备名。判定按"第一个点之前那段"，所以 `CON.txt` 同样打向 CON 设备。
const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// 归一作者给的 `appDataWorkspace`，返回 `Some(segment)` 或 `None`（用 appdata 根）。
///
/// **必须与 `src/shared/miniapp/app-data-workspace.ts::normalizeAppDataWorkspace`
/// 逐条同规则。** 两边是各自独立的信任边界：renderer 校验一遍是为了当场给作者
/// 一条能照着改的错误，Rust 再校验一遍是因为 renderer 的入参不可信，而这里
/// 拼出来的路径**就是** Agent 的 cwd（它带工具、`acceptEdits` 允许自动落盘）。
/// 少一边的后果是"另一侧静默放行"，所以改规则时 MUST 两处同步。
///
/// 拒绝表里最容易漏的两条只在 Windows 上犯：尾随点 / 尾随空格会被 Win32 静默
/// 剥掉，于是 `work.` 与 `work` 指向同一个目录，作者拿到一个指向别处的名字。
/// 跨平台 CI 抓不到这类回归，所以它们必须在这个表里被显式挡住。
fn normalize_app_data_workspace(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let segment = raw.trim();
    if segment.is_empty() {
        return Err("appDataWorkspace must not be empty".to_string());
    }
    if segment.chars().count() > APP_DATA_WORKSPACE_MAX_LEN {
        return Err(format!(
            "appDataWorkspace must be at most {} characters, got {}",
            APP_DATA_WORKSPACE_MAX_LEN,
            segment.chars().count()
        ));
    }
    if segment
        .chars()
        .any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err(format!(
            "appDataWorkspace must be a single directory name; '{segment}' contains a path separator or reserved character"
        ));
    }
    if segment.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f) {
        return Err("appDataWorkspace must not contain control characters".to_string());
    }
    if segment == "." || segment == ".." {
        return Err("appDataWorkspace must not be '.' or '..'".to_string());
    }
    if segment.starts_with('.') || segment.ends_with('.') {
        return Err(format!(
            "appDataWorkspace must not start or end with '.'; Win32 strips it and would alias '{segment}' onto a different directory"
        ));
    }
    let stem = segment
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(format!(
            "'{stem}' is a reserved Windows device name and cannot be a directory"
        ));
    }
    Ok(Some(segment.to_string()))
}

/// 解析 MiniApp 的 Agent workspace 绝对路径。
///
/// 这是 `appDataWorkspace` 落地成 cwd 的**唯一** chokepoint：先判 segment 合法，
/// 再断言拼出来的路径是 `<miniapps>/<appId>` 的**直接**子目录。多一层就说明
/// segment 偷偷带进了分隔符，断言比"再判一次字符串"强 —— 它判的是最终路径这个
/// 性质本身。
fn resolve_miniapp_agent_workspace(
    app_id: &str,
    app_data_workspace: Option<&str>,
) -> Result<PathBuf, String> {
    let base = miniapp_root_dir()?.join(app_id);
    let Some(segment) = normalize_app_data_workspace(app_data_workspace)? else {
        return Ok(base);
    };
    let path = base.join(&segment);
    // 承重墙：直接子目录。判最终路径而不是再判一次字符串。
    if path.parent() != Some(base.as_path()) {
        return Err(format!(
            "appDataWorkspace '{segment}' resolved outside the app's own appdata directory"
        ));
    }
    Ok(path)
}

/// Validate a relative file path inside `~/.hamana/miniapps/<appId>/`.
/// Reject: path traversal (`..`), absolute paths, symlink-leaf on parent, empty path.
/// The caller's full destination is `<miniapp_root>/<appId>/<relative>`.
fn validate_miniapp_relative_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty file path".to_string());
    }
    if rel.contains("..") {
        return Err("path must not contain '..'".to_string());
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err("path must be relative".to_string());
    }
    let p = PathBuf::from(rel);
    // 规范化路径前缀（不接受绝对 + 反斜杠路径）
    let normalized: PathBuf = p
        .components()
        .filter(|c| !matches!(c, std::path::Component::CurDir))
        .collect();
    Ok(normalized)
}

#[derive(Debug, Deserialize)]
pub struct CreateMiniAppRequest {
    pub app_id: String,
    /// Map of relative path → file content. Must include `meta.json` plus the 4-file set.
    pub source: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct CreateMiniAppResult {
    pub app_id: String,
    pub version: i64,
    pub path: String,
}

/// Sidecar → Rust: 接收 Chat Sidecar 生成的 4 文件 + storage.json，写入 `~/.hamuna/miniapps/<appId>/`。
/// 整体覆盖（每次生成全版本上写，version 自增）。Phase 1 不做增量 patch（增量在 Phase 2 `app.call`）。
#[tauri::command]
pub async fn cmd_miniapp_create_from_chat(
    req: CreateMiniAppRequest,
) -> Result<CreateMiniAppResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_from_chat_blocking(&req))
        .await
        .map_err(|e| format!("miniapp create task failed: {}", e))?
}

/// Phase 3: Marketplace → Rust: copy a bundled MiniApp into `~/.hamuna/miniapps/<appId>/`.
/// Reads source from `bundled-miniapps/<appId>/` (read-only seed), funnels through the
/// SAME `install_blocking` core as Chat-create so the two paths share file-lock /
/// tmp+rename / symlink guard / version increment semantics. The `from` discriminator
/// is only used for audit logging.
#[tauri::command]
pub async fn cmd_miniapp_install_from_marketplace<R: Runtime>(
    app_handle: AppHandle<R>,
    app_id: String,
) -> Result<CreateMiniAppResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_from_marketplace_blocking(app_handle, app_id))
        .await
        .map_err(|e| format!("miniapp install marketplace task failed: {}", e))?
}

fn install_from_marketplace_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
    app_id: String,
) -> Result<CreateMiniAppResult, String> {
    // Read bundled source from `bundled-miniapps/<id>/`
    use tauri::Manager;
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {}", e))?;
    let bundled_root = resource_dir.join("bundled-miniapps").join(&app_id);
    if !bundled_root.exists() {
        return Err(format!("bundled MiniApp '{}' not found", app_id));
    }

    let source = collect_miniapp_source_files(&bundled_root)?;
    let req = CreateMiniAppRequest {
        app_id: app_id.clone(),
        source,
    };
    install_blocking(&req, "marketplace")
}

/// Collect a bundled MiniApp's source files into the same shape `create_from_chat`
/// expects. Read recursively under `source/`, plus `meta.json` and `storage.json`.
fn collect_miniapp_source_files(root: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    let mut out = std::collections::HashMap::new();

    fn visit(p: &Path, base: &Path, out: &mut std::collections::HashMap<String, String>) -> Result<(), String> {
        let meta = std::fs::symlink_metadata(p)
            .map_err(|e| format!("symlink_metadata {}: {}", p.display(), e))?;
        if meta.file_type().is_symlink() {
            return Err(format!("Refusing symlink under bundled MiniApp: {}", p.display()));
        }
        if meta.is_file() {
            let s = std::fs::read_to_string(p)
                .map_err(|e| format!("read {}: {}", p.display(), e))?;
            let rel = p
                .strip_prefix(base)
                .map_err(|e| format!("strip_prefix: {}", e))?
                .to_string_lossy()
                .replace('\\', "/");
            out.insert(rel, s);
        } else if meta.is_dir() {
            for e in std::fs::read_dir(p).map_err(|e| format!("read_dir: {}", e))? {
                let e = e.map_err(|e| format!("read_dir entry: {}", e))?;
                visit(&e.path(), base, out)?;
            }
        }
        Ok(())
    }

    visit(root, root, &mut out)?;
    Ok(out)
}

/// Funnel point: Chat-create and Marketplace-install both reach here. Validates
/// inputs, locks the per-appId file, atomically writes, bumps version. The
/// `from` discriminator only feeds the audit log.
fn install_blocking(req: &CreateMiniAppRequest, from: &str) -> Result<CreateMiniAppResult, String> {
    let result = create_from_chat_blocking(req)?;
    ulog_info!(
        "[miniapp:{}] installed via {} → v{}",
        req.app_id,
        from,
        result.version
    );
    Ok(result)
}

/// Host-owned MiniApp version. `prev_meta_json` MUST be the meta.json as it
/// was **before** this write; passing the incoming one is the bug this function
/// exists to make impossible to repeat. The incoming meta.json is AI-authored
/// and always says `version: 1`, so `prev + 1` on the *new* file pinned every
/// MiniApp at 2 forever, no matter how often the user re-created it.
///
/// First install (no previous meta) → 1.
fn next_miniapp_version(prev_meta_json: Option<&str>) -> i64 {
    prev_meta_json
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.get("version").and_then(|n| n.as_i64()))
        .unwrap_or(0)
        + 1
}

fn create_from_chat_blocking(req: &CreateMiniAppRequest) -> Result<CreateMiniAppResult, String> {
    // 1. appId 校验
    if !is_safe_app_id(&req.app_id) {
        return Err(format!(
            "appId '{}' must be kebab-case ASCII (a-z, 0-9, '-'), 1-64 chars, no leading/trailing '-'",
            req.app_id
        ));
    }

    // 2. source 至少含 meta.json + source/index.html + source/ui.js + source/style.css + storage.json
    const REQUIRED: &[&str] = &[
        "meta.json",
        "source/index.html",
        "source/ui.js",
        "source/style.css",
        "storage.json",
    ];
    for k in REQUIRED {
        if !req.source.contains_key(*k) {
            return Err(format!("source is missing required file '{}'", k));
        }
    }

    // 3. 每个 file path 校验 + 内容非空 + 不超 64KB（Phase 1 小程序静态文件）
    let mut sanitized: std::collections::HashMap<PathBuf, String> =
        std::collections::HashMap::new();
    for (rel, content) in &req.source {
        let path = validate_miniapp_relative_path(rel)?;
        if content.is_empty() {
            return Err(format!("file '{}' is empty", rel));
        }
        if content.len() > 64 * 1024 {
            return Err(format!("file '{}' exceeds 64KB limit (Phase 1 static only)", rel));
        }
        sanitized.insert(path, content.clone());
    }

    // 4. meta.json schema 校验（仅做最浅校验，避免引入 zod / serde_json schema）
    let meta_str = sanitized
        .get(&PathBuf::from("meta.json"))
        .ok_or_else(|| "meta.json missing after sanitization".to_string())?;
    let meta: serde_json::Value = serde_json::from_str(meta_str)
        .map_err(|e| format!("meta.json is not valid JSON: {}", e))?;
    let meta_id = meta
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "meta.json.id is required".to_string())?;
    if meta_id != req.app_id {
        return Err(format!(
            "meta.json.id '{}' must equal appId '{}'",
            meta_id, req.app_id
        ));
    }

    // 5. 写盘：with_file_lock_blocking(<appId>.lock) + 全量覆盖 + version 自增
    let root = miniapp_root_dir()?;
    if let Err(e) = std::fs::create_dir_all(&root) {
        return Err(format!("failed to create miniapps root: {}", e));
    }
    let dest = root.join(&req.app_id);
    let lock_path = root.join(format!("{}.lock", req.app_id));

    let new_version = crate::utils::file_lock::with_file_lock_blocking(
        &lock_path,
        crate::utils::file_lock::FileLockOptions::default(),
        || {
            // 5a. 旧版本留 snapshot 用于 diff（仅留一个快照）
            let snapshot_path = root.join(format!("{}.prev.json", req.app_id));
            let mut prev_meta_json: Option<String> = None;
            if dest.exists() {
                // 收集旧 meta.json + source/* + storage.json 内容
                let prev = collect_snapshot(&dest);
                // Keep the old meta.json around: the new version derives from
                // it, and it is only in scope before the old tree is cleared.
                prev_meta_json = prev.get("meta.json").cloned();
                std::fs::write(&snapshot_path, serde_json::to_string(&prev).unwrap_or_default())
                    .map_err(|e| {
                        crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                            "snapshot write failed: {}",
                            e
                        )))
                    })?;
                // 整体清空（PRD v0.3 §11.1 卸载 + 重新安装语义）
                std::fs::remove_dir_all(&dest).map_err(|e| {
                    crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                        "failed to clear existing dest: {}",
                        e
                    )))
                })?;
            }

            // 5b. create dest + symlink guard on dest root
            std::fs::create_dir_all(&dest).map_err(|e| {
                crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                    "create_dir_all failed: {}",
                    e
                )))
            })?;
            if let Ok(meta) = std::fs::symlink_metadata(&dest) {
                if meta.file_type().is_symlink() {
                    let _ = std::fs::remove_dir_all(&dest);
                    return Err(crate::utils::file_lock::FileLockError::Io(
                        std::io::Error::other("Refusing symlink under miniapps/"),
                    ));
                }
            }

            // 5c. 写每文件（tmp + rename + parent create_dir_all）
            for (path, content) in &sanitized {
                // meta.json 在 5d 单独写：version 是宿主算出来的，不能沿用
                // AI 写的那份里的值。
                if path == Path::new("meta.json") {
                    continue;
                }
                let leaf = dest.join(path);
                if let Some(parent) = leaf.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                            "create_dir_all parent failed: {}",
                            e
                        )))
                    })?;
                    if let Ok(meta) = std::fs::symlink_metadata(parent) {
                        if meta.file_type().is_symlink() {
                            return Err(crate::utils::file_lock::FileLockError::Io(
                                std::io::Error::other(format!(
                                    "Refusing symlink parent for '{}'",
                                    path.display()
                                )),
                            ));
                        }
                    }
                }
                // tmp + rename（CLAUDE.md §Pit-of-Success fs-utils 红线）
                let tmp = {
                    let mut s = leaf.as_os_str().to_owned();
                    s.push(".tmp");
                    PathBuf::from(s)
                };
                std::fs::write(&tmp, content).map_err(|e| {
                    crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                        "tmp write failed for {}: {}",
                        path.display(),
                        e
                    )))
                })?;
                std::fs::rename(&tmp, &leaf).map_err(|e| {
                    let _ = std::fs::remove_file(&tmp);
                    crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                        "rename failed for {}: {}",
                        path.display(),
                        e
                    )))
                })?;
            }

            // 5d. 写 meta.json，version 由宿主填。
            // The stored version is what the Marketplace / MiniAppCenter render
            // (`read_miniapp_meta_for_listing` reads the file, not this return
            // value), so computing it without persisting it left every card
            // showing the AI-authored `1` while the API reported a different
            // number. Host owns this field: the skill's schema documents
            // `version` as required, but the value is not the author's to pick.
            let new_version = next_miniapp_version(prev_meta_json.as_deref());
            let mut meta_with_version = meta.clone();
            if let Some(obj) = meta_with_version.as_object_mut() {
                obj.insert("version".to_string(), serde_json::json!(new_version));
            }
            let meta_out = dest.join("meta.json");
            let meta_tmp = {
                let mut s = meta_out.as_os_str().to_owned();
                s.push(".tmp");
                PathBuf::from(s)
            };
            std::fs::write(
                &meta_tmp,
                serde_json::to_string_pretty(&meta_with_version).unwrap_or_default(),
            )
            .map_err(|e| {
                let _ = std::fs::remove_file(&meta_tmp);
                crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                    "meta.json tmp write failed: {}",
                    e
                )))
            })?;
            std::fs::rename(&meta_tmp, &meta_out).map_err(|e| {
                let _ = std::fs::remove_file(&meta_tmp);
                crate::utils::file_lock::FileLockError::Io(std::io::Error::other(format!(
                    "meta.json rename failed: {}",
                    e
                )))
            })?;

            Ok(new_version)
        },
    )
    .map_err(|e| format!("file lock error: {}", e))?;

    ulog_info!(
        "[miniapp:{}] Created v{} at {}",
        req.app_id,
        new_version,
        dest.display()
    );

    Ok(CreateMiniAppResult {
        app_id: req.app_id.clone(),
        version: new_version,
        path: dest.to_string_lossy().to_string(),
    })
}

/// Collect existing source/* + meta.json + storage.json into a HashMap for snapshot.
fn collect_snapshot(dest: &Path) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    fn visit(p: &Path, base: &Path, out: &mut std::collections::HashMap<String, String>) {
        let Ok(meta) = std::fs::symlink_metadata(p) else {
            return;
        };
        if meta.file_type().is_symlink() {
            return;
        }
        if meta.is_file() {
            if let Ok(s) = std::fs::read_to_string(p) {
                if let Ok(rel) = p.strip_prefix(base) {
                    out.insert(
                        rel.to_string_lossy().replace('\\', "/"),
                        s,
                    );
                }
            }
        } else if meta.is_dir() {
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.flatten() {
                    visit(&e.path(), base, out);
                }
            }
        }
    }
    visit(dest, dest, &mut out);
    out
}

#[derive(Debug, Serialize)]
pub struct MiniAppFileDiff {
    pub path: String,
    pub status: String, // "added" | "removed" | "changed" | "unchanged"
}

#[derive(Debug, Serialize)]
pub struct MiniAppDiffResult {
    pub app_id: String,
    pub from_version: i64,
    pub to_version: i64,
    pub files: Vec<MiniAppFileDiff>,
}

/// Sidecar → Rust: 比较当前 source/ 与上次 snapshot 的结构化 diff。
/// Phase 1 仅返回文件级 added/removed/changed（不做 unified text diff，留待 v0.5）。
#[tauri::command]
pub async fn cmd_miniapp_diff_source(
    app_id: String,
    from_version: Option<i64>,
) -> Result<MiniAppDiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || diff_source_blocking(&app_id, from_version))
        .await
        .map_err(|e| format!("miniapp diff task failed: {}", e))?
}

/// Phase 2 (PRD v0.4 §B.3) — Mint a deterministic MiniApp session id and
/// ensure its Sidecar is running with a `miniapp-agent:<appId>:<runId>` owner
/// token. The renderer-generated `runId` becomes the unique Session identity;
/// the per-appId cap (≤ 3) lives in `sidecar::session_lifecycle` and LRU-evicts
/// the oldest sibling before a 4th spawn would allocate a fresh port.
///
/// ## `app_data_workspace`
///
/// 参考文档让作者在 appdata 底下挑一个子目录当 Agent workspace。这个选择只能
/// 在**建 session 时**落地，因为 builtin adapter 的 cwd 是进程级 `agentDir`
/// （`--agent-dir`，SDK 子进程 spawn 时读一次），per-turn 参数表达不了。
/// 所以 `--agent-dir` 本身就是这个语义的落点，不是副作用。
///
/// 之前它被忽略、`ensureSession` 却照样回显作者请求的名字，于是作者以为收窄
/// 生效了。现在由 `resolve_miniapp_agent_workspace` 判定并拼路径，判完再建目录。
///
/// Returns the resolved `session_id`, the `port` to point subsequent renderer
/// requests at, and the `generation` header value the renderer must echo on
/// those requests (so a stop-event for an evicted sibling can't race).
#[tauri::command]
pub async fn cmd_miniapp_ensure_session<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, ManagedSidecarManager>,
    app_id: String,
    run_id: String,
    app_data_workspace: Option<String>,
) -> Result<MiniAppSessionEnsureOutcome, String> {
    if !is_safe_app_id(&app_id) {
        return Err(format!("appId '{}' must be kebab-case ASCII", app_id));
    }
    if !is_safe_run_id(&run_id) {
        return Err(format!(
            "runId '{}' must be kebab-case ASCII ≤ 64 chars",
            run_id
        ));
    }
    // 判定必须发生在建 session **之前**：非法名字不许留下一个已起的 Node 进程。
    let workspace_path = resolve_miniapp_agent_workspace(&app_id, app_data_workspace.as_deref())?;
    let session_id = format!("miniapp_{}_{}", app_id, run_id);
    let owner_id = format!("miniapp-agent:{}:{}", app_id, run_id);
    // SDK 的 cwd 就是这个目录，缺了它首个 turn 会因 cwd 不存在而失败。
    if let Err(e) = std::fs::create_dir_all(&workspace_path) {
        return Err(format!(
            "failed to create the MiniApp agent workspace {}: {}",
            workspace_path.display(),
            e
        ));
    }
    let result = crate::sidecar::ensure_session_sidecar(
        &app_handle,
        &state,
        &session_id,
        &workspace_path,
        crate::sidecar::SidecarOwner::Agent(owner_id.clone()),
    )?;
    logger::debug(
        &app_handle,
        format!(
            "[miniapp:{}] ensure_session ok: session={} port={} new={} workspace={}",
            app_id,
            session_id,
            result.port,
            result.is_new,
            workspace_path.display()
        ),
    );
    Ok(MiniAppSessionEnsureOutcome {
        session_id,
        port: result.port,
        owner_id,
    })
}

/// Phase 2 (PRD v0.4 §B.3) — Release the MiniApp owner from a Session's
/// Sidecar. After this returns, no further requests should target the
/// returned session_id — the manager may LRU-evict a sibling at any time
/// after the last MiniApp owner releases.
#[tauri::command]
pub fn cmd_miniapp_release_session(
    state: State<'_, ManagedSidecarManager>,
    app_id: String,
    run_id: String,
) -> Result<bool, String> {
    if !is_safe_app_id(&app_id) {
        return Err(format!("appId '{}' must be kebab-case ASCII", app_id));
    }
    if !is_safe_run_id(&run_id) {
        return Err(format!(
            "runId '{}' must be kebab-case ASCII ≤ 64 chars",
            run_id
        ));
    }
    let session_id = format!("miniapp_{}_{}", app_id, run_id);
    let owner_id = format!("miniapp-agent:{}:{}", app_id, run_id);
    crate::sidecar::release_session_sidecar(
        &state,
        &session_id,
        &crate::sidecar::SidecarOwner::Agent(owner_id),
    )
}

/// Companion to `is_safe_app_id` for the renderer-generated `runId` portion
/// of the MiniApp session id. Reuses the same kebab-case ASCII guard so a
/// malicious renderer can't smuggle `:` into the id and collide with the
/// `miniapp-agent:<appId>:<runId>` owner-token parser in `sidecar::types`.
fn is_safe_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= 64
        && run_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !run_id.starts_with('-')
        && !run_id.ends_with('-')
        && !run_id.contains(':')
}

/// Public result type for `cmd_miniapp_ensure_session`. Mirrors the SDK-shaped
/// `EnsureSidecarResult` for a single named field set the renderer cares about.
#[derive(Debug, Serialize)]
pub struct MiniAppSessionEnsureOutcome {
    pub session_id: String,
    pub port: u16,
    pub owner_id: String,
}

fn diff_source_blocking(
    app_id: &str,
    from_version: Option<i64>,
) -> Result<MiniAppDiffResult, String> {
    if !is_safe_app_id(app_id) {
        return Err(format!("appId '{}' must be kebab-case ASCII", app_id));
    }
    let root = miniapp_root_dir()?;
    let dest = root.join(app_id);
    if !dest.exists() {
        return Err(format!("MiniApp '{}' is not installed", app_id));
    }

    let current = collect_snapshot(&dest);
    let to_version = std::fs::read_to_string(dest.join("meta.json"))
        .ok()
        .and_then(|s| {
            serde_json::from_str::<serde_json::Value>(&s)
                .ok()
                .and_then(|v| v.get("version").and_then(|n| n.as_i64()))
        })
        .unwrap_or(0);

    // Phase 1 简化：fromVersion 暂未对应多版本快照存储，仅返回 vs current 的结构化 diff
    // （PRD v0.4 §B.2 第④项要求 Phase 1 实施，留 API 形状不动；多版本历史为 v0.5 scope）
    let prev_snapshot_path = root.join(format!("{}.prev.json", app_id));
    let prev: std::collections::HashMap<String, String> = if prev_snapshot_path.exists() {
        std::fs::read_to_string(&prev_snapshot_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let mut files: Vec<MiniAppFileDiff> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (k, v) in &current {
        seen.insert(k.clone());
        match prev.get(k) {
            None => files.push(MiniAppFileDiff {
                path: k.clone(),
                status: "added".to_string(),
            }),
            Some(old) if old != v => files.push(MiniAppFileDiff {
                path: k.clone(),
                status: "changed".to_string(),
            }),
            Some(_) => files.push(MiniAppFileDiff {
                path: k.clone(),
                status: "unchanged".to_string(),
            }),
        }
    }
    for k in prev.keys() {
        if !seen.contains(k) {
            files.push(MiniAppFileDiff {
                path: k.clone(),
                status: "removed".to_string(),
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(MiniAppDiffResult {
        app_id: app_id.to_string(),
        from_version: from_version.unwrap_or(0),
        to_version,
        files,
    })
}

/// Command: Create a dedicated workspace for an IM Bot by copying bundled mino template.
/// Sanitizes the name for path safety and auto-appends numeric suffix on collision.
/// Falls back to local mino copy if bundled resources are incomplete.
/// Returns the created workspace path.
#[tauri::command]
pub async fn cmd_create_bot_workspace<R: Runtime>(
    app_handle: AppHandle<R>,
    workspace_name: String,
) -> Result<InitBundledWorkspaceResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_bot_workspace_blocking(app_handle, &workspace_name)
    })
    .await
    .map_err(|e| format!("create-bot-workspace task failed: {}", e))?
}

fn create_bot_workspace_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
    workspace_name: &str,
) -> Result<InitBundledWorkspaceResult, String> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let projects_dir = home_dir.join(".hamuna").join("projects");

    // Sanitize name: remove @, replace non-alphanumeric (except CJK) with dash, trim
    let sanitized = sanitize_workspace_name(workspace_name);
    if sanitized.is_empty() {
        return Err("Workspace name is empty after sanitization".to_string());
    }

    // Find available path (handle collisions with numeric suffix)
    let dest = find_available_workspace_path(&projects_dir, &sanitized);

    // Primary: copy from bundled resources
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let mino_src = resource_dir.join("mino");

    if mino_src.exists() && mino_src.join("CLAUDE.md").exists() {
        ulog_info!(
            "[workspace] Copying bundled mino from {:?} to {:?}",
            mino_src,
            dest
        );
        copy_dir_recursive(&mino_src, &dest)
            .map_err(|e| format!("Failed to copy workspace template: {}", e))?;
    }

    // Validate: CLAUDE.md must exist in destination (marker file for a valid mino template)
    if !dest.join("CLAUDE.md").exists() {
        // Fallback: copy from the local mino created on first launch
        let local_mino = projects_dir.join("mino");
        if local_mino.exists() && local_mino.join("CLAUDE.md").exists() {
            ulog_warn!(
                "[workspace] Bundled mino incomplete, falling back to local {:?}",
                local_mino
            );
            // Clean up the potentially empty dest before fallback copy
            let _ = fs::remove_dir_all(&dest);
            copy_dir_recursive(&local_mino, &dest)
                .map_err(|e| format!("Failed to copy from local mino: {}", e))?;
        } else {
            // Clean up the empty dest
            let _ = fs::remove_dir_all(&dest);
            return Err(
                "Mino template not found: bundled resources incomplete and no local copy available"
                    .to_string(),
            );
        }
    }

    ulog_info!("[workspace] Bot workspace created: {:?}", dest);
    Ok(InitBundledWorkspaceResult {
        path: dest.to_string_lossy().to_string(),
        is_new: true,
    })
}

/// Command: Remove a workspace directory created by `cmd_create_bot_workspace`.
/// Safety: only allows deleting directories under `~/.hamuna/projects/`.
#[tauri::command]
pub async fn cmd_remove_bot_workspace(workspace_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_bot_workspace_blocking(&workspace_path))
        .await
        .map_err(|e| format!("remove-bot-workspace task failed: {}", e))?
}

fn remove_bot_workspace_blocking(workspace_path: &str) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let projects_dir = home_dir.join(".hamuna").join("projects");

    let target = PathBuf::from(workspace_path);
    // Canonicalize both paths to prevent traversal attacks
    let canon_projects = projects_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve projects dir: {}", e))?;
    let canon_target = target
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workspace path: {}", e))?;

    if !canon_target.starts_with(&canon_projects) || canon_target == canon_projects {
        return Err("Refusing to delete: path is not inside ~/.hamuna/projects/".to_string());
    }

    fs::remove_dir_all(&canon_target)
        .map_err(|e| format!("Failed to remove workspace directory: {}", e))?;

    Ok(())
}

/// Command: Remove a template directory from ~/.hamuna/templates/.
/// Safety: only allows deleting directories under ~/.hamuna/templates/.
#[tauri::command]
pub async fn cmd_remove_template_folder(template_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_template_folder_blocking(&template_path))
        .await
        .map_err(|e| format!("remove-template-folder task failed: {}", e))?
}

fn remove_template_folder_blocking(template_path: &str) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let templates_dir = home_dir.join(".hamuna").join("templates");

    if !templates_dir.exists() {
        return Err("Templates directory does not exist".to_string());
    }

    let target = PathBuf::from(template_path);

    // If the folder no longer exists, treat as success (already cleaned up)
    if !target.exists() {
        ulog_info!("[template] Template folder already removed: {:?}", target);
        return Ok(());
    }

    let canon_templates = templates_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve templates dir: {}", e))?;
    let canon_target = target
        .canonicalize()
        .map_err(|e| format!("Failed to resolve template path: {}", e))?;

    if !canon_target.starts_with(&canon_templates) || canon_target == canon_templates {
        return Err("Refusing to delete: path is not inside ~/.hamuna/templates/".to_string());
    }

    fs::remove_dir_all(&canon_target)
        .map_err(|e| format!("Failed to remove template directory: {}", e))?;

    ulog_info!("[template] Removed template folder: {:?}", canon_target);
    Ok(())
}

/// Sanitize a workspace name for use as a directory name.
/// Keeps alphanumeric, CJK characters, hyphens, and underscores.
fn sanitize_workspace_name(name: &str) -> String {
    let result: String = name
        .chars()
        .filter_map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                Some(c)
            } else if c == ' ' || c == '@' || c == '/' || c == '\\' {
                Some('-')
            } else if c > '\u{2E7F}' {
                // Keep CJK and other non-ASCII characters
                Some(c)
            } else {
                None
            }
        })
        .collect();

    // Trim leading/trailing dashes and collapse consecutive dashes
    let mut collapsed = String::new();
    let mut prev_dash = false;
    for c in result.chars() {
        if c == '-' {
            if !prev_dash && !collapsed.is_empty() {
                collapsed.push(c);
            }
            prev_dash = true;
        } else {
            collapsed.push(c);
            prev_dash = false;
        }
    }
    collapsed.trim_end_matches('-').to_string()
}

/// Find an available workspace path, appending numeric suffix on collision.
fn find_available_workspace_path(projects_dir: &Path, base_name: &str) -> PathBuf {
    let first = projects_dir.join(base_name);
    if !first.exists() {
        return first;
    }
    for i in 2..=100 {
        let candidate = projects_dir.join(format!("{}-{}", base_name, i));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Extremely unlikely fallback
    projects_dir.join(format!(
        "{}-{}",
        base_name,
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("x")
    ))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        // Skip .git and node_modules
        if name == ".git" || name == "node_modules" {
            continue;
        }
        // Skip symlinks to avoid circular copies and unexpected data
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let dest = dst.join(name);
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(&entry.path(), &dest)?;
        }
    }
    Ok(())
}

// ============= Workspace Template Commands =============

/// Command: Create a workspace from a user template (copy source dir to dest dir).
/// Reuses copy_dir_recursive which skips .git and node_modules.
/// Safety: source_path must be under ~/.hamuna/templates/.
/// The dest_path parent must exist; the dest_path itself must NOT exist.
#[tauri::command]
pub async fn cmd_create_workspace_from_template(
    source_path: String,
    dest_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_workspace_from_template_blocking(&source_path, &dest_path)
    })
    .await
    .map_err(|e| format!("create-workspace-from-template task failed: {}", e))?
}

fn create_workspace_from_template_blocking(
    source_path: &str,
    dest_path: &str,
) -> Result<(), String> {
    let src = PathBuf::from(source_path);
    let dst = PathBuf::from(dest_path);

    if !src.exists() {
        return Err(format!("Template source not found: {}", source_path));
    }

    // Validate source is under ~/.hamuna/templates/
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let templates_dir = home_dir.join(".hamuna").join("templates");
    if templates_dir.exists() {
        let canon_templates = templates_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve templates dir: {}", e))?;
        let canon_src = src
            .canonicalize()
            .map_err(|e| format!("Failed to resolve source path: {}", e))?;
        if !canon_src.starts_with(&canon_templates) {
            return Err("Source path must be inside ~/.hamuna/templates/".to_string());
        }
    } else {
        return Err("Templates directory does not exist".to_string());
    }

    if dst.exists() {
        return Err(format!("Destination already exists: {}", dest_path));
    }
    // Ensure parent directory exists
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }

    ulog_info!("[template] Copying template from {:?} to {:?}", src, dst);
    copy_dir_recursive(&src, &dst).map_err(|e| format!("Failed to copy template: {}", e))?;

    Ok(())
}

/// Command: Create a workspace from a bundled (preset) template.
/// Copies from app resources/<template_id> to dest_path.
/// Falls back to local copy at ~/.hamuna/projects/<template_id> if bundled is incomplete.
/// Safety: template_id is sanitized to prevent path traversal.
#[tauri::command]
pub async fn cmd_create_workspace_from_bundled_template<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: String,
    dest_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_workspace_from_bundled_template_blocking(app_handle, &template_id, &dest_path)
    })
    .await
    .map_err(|e| format!("create-workspace-from-bundled-template task failed: {}", e))?
}

fn create_workspace_from_bundled_template_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: &str,
    dest_path: &str,
) -> Result<(), String> {
    // Sanitize template_id (single source of truth in `validate_template_id`).
    validate_template_id(template_id)?;

    let dst = PathBuf::from(dest_path);
    if dst.exists() {
        return Err(format!("Destination already exists: {}", dest_path));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }

    // Primary: copy from bundled resources
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let template_src = resource_dir.join(template_id);

    if template_src.exists() && template_src.join("CLAUDE.md").exists() {
        ulog_info!(
            "[template] Copying bundled template '{}' from {:?} to {:?}",
            template_id,
            template_src,
            dst
        );
        copy_dir_recursive(&template_src, &dst)
            .map_err(|e| format!("Failed to copy bundled template: {}", e))?;
        return Ok(());
    }

    // Fallback: copy from local projects/<template_id>
    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let local_src = home_dir.join(".hamuna").join("projects").join(template_id);
    if local_src.exists() && local_src.join("CLAUDE.md").exists() {
        ulog_warn!(
            "[template] Bundled template '{}' incomplete, falling back to local {:?}",
            template_id,
            local_src
        );
        copy_dir_recursive(&local_src, &dst)
            .map_err(|e| format!("Failed to copy from local template: {}", e))?;
        return Ok(());
    }

    Err(format!(
        "Template '{}' not found in bundled resources or local copies",
        template_id
    ))
}

/// Validate a bundled template_id — rejects path separators, traversal, and empty IDs.
/// Single source of truth so all template-using commands inherit the same rules.
fn validate_template_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid template ID".to_string());
    }
    Ok(())
}

/// Validate a workspace destination path for template apply. Reuses `validate_file_path`'s
/// system/credential blacklist (so we can't accidentally write template files into `~/.ssh`,
/// `/etc`, or other protected dirs) AND requires the path to exist as a real directory.
/// Returns the resolved (`..`-free) absolute path so the caller uses a single canonical form.
fn validate_workspace_dest(dest_path: &str) -> Result<PathBuf, String> {
    let resolved = validate_file_path(dest_path)?;
    if !resolved.exists() {
        return Err(format!("Workspace does not exist: {}", dest_path));
    }
    if !resolved.is_dir() {
        return Err(format!("Workspace path is not a directory: {}", dest_path));
    }
    Ok(resolved)
}

/// Resolve a template source directory from either a bundled template_id or a user
/// template source_path. Returns the CANONICAL path (symlinks resolved) — callers must
/// use this exact path for any subsequent reads/copies, otherwise a TOCTOU window opens
/// where an attacker could replace the validated source with a symlink to elsewhere
/// between this validation and the later read.
fn resolve_template_source<R: Runtime>(
    app_handle: &AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(id) = template_id.as_deref() {
        validate_template_id(id)?;
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;
        let bundled = resource_dir.join(id);
        if bundled.exists() && bundled.join("CLAUDE.md").exists() {
            // Canonicalize so subsequent reads can't be redirected via symlink swap.
            return bundled
                .canonicalize()
                .map_err(|e| format!("Failed to resolve bundled template path: {}", e));
        }
        let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
        let local = home_dir.join(".hamuna").join("projects").join(id);
        if local.exists() && local.join("CLAUDE.md").exists() {
            return local
                .canonicalize()
                .map_err(|e| format!("Failed to resolve local template path: {}", e));
        }
        return Err(format!("Bundled template '{}' not found", id));
    }
    if let Some(p) = source_path.as_deref() {
        let src = PathBuf::from(p);
        if !src.exists() {
            return Err(format!("Template source not found: {}", p));
        }
        let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
        let templates_dir = home_dir.join(".hamuna").join("templates");
        if !templates_dir.exists() {
            return Err("Templates directory does not exist".to_string());
        }
        let canon_templates = templates_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve templates dir: {}", e))?;
        let canon_src = src
            .canonicalize()
            .map_err(|e| format!("Failed to resolve source path: {}", e))?;
        if !canon_src.starts_with(&canon_templates) {
            return Err("Source path must be inside ~/.hamuna/templates/".to_string());
        }
        // Return canonical path (not the original `src`) — closes the TOCTOU between
        // validation and consumption, since the caller will read from canon_src directly.
        return Ok(canon_src);
    }
    Err("Either template_id or source_path is required".to_string())
}

/// Walk a template directory and collect relative file paths (skipping .git / node_modules /
/// symlinks). Used by the preview command to compute overwrite vs add classifications.
fn list_template_files_rel(src: &Path) -> std::io::Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name();
            if name == ".git" || name == "node_modules" {
                continue;
            }
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            let p = entry.path();
            if file_type.is_dir() {
                walk(root, &p, out)?;
            } else if let Ok(rel) = p.strip_prefix(root) {
                out.push(rel.to_path_buf());
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(src, src, &mut out)?;
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct TemplateApplyPreview {
    pub overwrite: Vec<String>,
    pub add: Vec<String>,
}

/// Command: Preview which files a template would overwrite vs add when applied to an
/// existing workspace. Used to drive the confirmation UI before the destructive merge.
/// Either `template_id` (bundled) or `source_path` (user template) must be provided.
#[tauri::command]
pub async fn cmd_template_apply_preview<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
    dest_path: String,
) -> Result<TemplateApplyPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        template_apply_preview_blocking(app_handle, template_id, source_path, &dest_path)
    })
    .await
    .map_err(|e| format!("template-apply-preview task failed: {}", e))?
}

fn template_apply_preview_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
    dest_path: &str,
) -> Result<TemplateApplyPreview, String> {
    // `validate_workspace_dest` forbids system/credential dirs (mirroring the
    // file-read/write commands' blacklist) so a misbehaving renderer can't redirect a
    // template apply at e.g. `~/.ssh` or `/etc`.
    let dst = validate_workspace_dest(dest_path)?;
    let src = resolve_template_source(&app_handle, template_id, source_path)?;
    let files =
        list_template_files_rel(&src).map_err(|e| format!("Failed to walk template: {}", e))?;
    let mut overwrite = Vec::new();
    let mut add = Vec::new();
    for rel in files {
        let target = dst.join(&rel);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if target.exists() {
            overwrite.push(rel_str);
        } else {
            add.push(rel_str);
        }
    }
    overwrite.sort();
    add.sort();
    Ok(TemplateApplyPreview { overwrite, add })
}

/// Command: Apply a template to an EXISTING workspace by merging files (same-name overwrite,
/// other files preserved). This is the destructive counterpart to `cmd_template_apply_preview`
/// — callers should always preview + confirm with the user before invoking apply.
#[tauri::command]
pub async fn cmd_apply_template_to_workspace<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
    dest_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_template_to_workspace_blocking(app_handle, template_id, source_path, &dest_path)
    })
    .await
    .map_err(|e| format!("apply-template-to-workspace task failed: {}", e))?
}

fn apply_template_to_workspace_blocking<R: Runtime>(
    app_handle: AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
    dest_path: &str,
) -> Result<(), String> {
    let dst = validate_workspace_dest(dest_path)?;
    let src = resolve_template_source(&app_handle, template_id, source_path)?;
    ulog_info!(
        "[template] Merging template from {:?} into existing workspace {:?}",
        src,
        dst
    );
    merge_dir_recursive(&src, &dst).map_err(|e| format!("Failed to apply template: {}", e))?;
    Ok(())
}

/// Command: Copy a local folder into the templates library (~/.hamuna/templates/<name>/).
/// Returns the destination path.
#[tauri::command]
pub async fn cmd_copy_folder_to_templates(
    source_path: String,
    template_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_folder_to_templates_blocking(&source_path, &template_name)
    })
    .await
    .map_err(|e| format!("copy-folder-to-templates task failed: {}", e))?
}

fn copy_folder_to_templates_blocking(
    source_path: &str,
    template_name: &str,
) -> Result<String, String> {
    let src = PathBuf::from(source_path);
    if !src.exists() || !src.is_dir() {
        return Err(format!("Source folder not found: {}", source_path));
    }

    let home_dir = dirs::home_dir().ok_or("Failed to get home dir")?;
    let templates_dir = home_dir.join(".hamuna").join("templates");
    fs::create_dir_all(&templates_dir)
        .map_err(|e| format!("Failed to create templates dir: {}", e))?;

    // Sanitize name and find available path
    let sanitized = sanitize_workspace_name(template_name);
    if sanitized.is_empty() {
        return Err("Template name is empty after sanitization".to_string());
    }
    let dest = find_available_workspace_path(&templates_dir, &sanitized);

    // Prevent overlapping source/destination (would cause infinite recursion)
    let canon_src = src
        .canonicalize()
        .map_err(|e| format!("Failed to resolve source: {}", e))?;
    let canon_templates = templates_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve templates dir: {}", e))?;
    if canon_src.starts_with(&canon_templates) {
        return Err("Source folder is already inside the templates directory".to_string());
    }

    ulog_info!(
        "[template] Copying folder {:?} to template library {:?}",
        src,
        dest
    );
    copy_dir_recursive(&src, &dest)
        .map_err(|e| format!("Failed to copy to template library: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ============= Admin Agent Sync =============

const ADMIN_AGENT_VERSION: &str = "25";

/// Helper-bundled paths (relative to `~/.hamuna/`) that previous versions
/// shipped but that have since been retired.
///
/// `merge_dir_recursive` is overwrite-only ("never deletes"), so a file
/// removed from the bundle would persist on upgraders' disks indefinitely
/// — letting a retired skill keep loading inside the helper agent and
/// silently diverge fresh-install from upgrade behavior. Each retire
/// MUST also append the relative path here so the next sync removes it.
///
/// Once `~/.hamuna/.admin-agent-version` has rolled past the version
/// that introduced the retire, the entry is harmless to keep (it just
/// no-ops on absent paths).
const RETIRED_ADMIN_PATHS: &[&str] = &[
    // v16: /self-config promoted to global system skill /hamuna-cli
    ".claude/skills/self-config",
];

/// Merge bundled admin agent files into ~/.hamuna/
/// Version-gated: only runs when ADMIN_AGENT_VERSION changes.
#[tauri::command]
pub async fn cmd_sync_admin_agent<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || sync_admin_agent_blocking(app_handle))
        .await
        .map_err(|e| format!("admin-agent sync task failed: {}", e))?
}

fn sync_admin_agent_blocking<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    let dest = home.join(".hamuna");

    // Version gate
    let ver_file = dest.join(".admin-agent-version");
    if ver_file.exists() {
        let ver = fs::read_to_string(&ver_file).unwrap_or_default();
        if ver.trim() == ADMIN_AGENT_VERSION {
            return Ok(false);
        }
    }

    // Source: app resources
    let res = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Resource dir: {}", e))?;
    let src = res.join("bundled-agents").join("hamuna_helper");
    if !src.exists() {
        return Err(format!("Admin agent not found: {:?}", src));
    }

    // Pre-merge: remove retired paths so they don't linger on upgraders'
    // disks. Use symlink_metadata (not Path::exists) for symlink-trap
    // safety, mirroring cmd_sync_system_skills.
    for rel in RETIRED_ADMIN_PATHS {
        let target = dest.join(rel);
        match fs::symlink_metadata(&target) {
            Ok(meta) => {
                let removed = if meta.file_type().is_symlink() || meta.is_file() {
                    fs::remove_file(&target)
                } else {
                    fs::remove_dir_all(&target)
                };
                if let Err(e) = removed {
                    ulog_warn!(
                        "[admin-agent] failed to clear retired path {}: {} — continuing",
                        rel,
                        e
                    );
                } else {
                    ulog_info!("[admin-agent] retired {}", rel);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Already absent — fresh install or already cleaned.
            }
            Err(e) => {
                ulog_warn!(
                    "[admin-agent] symlink_metadata({}) failed: {} — continuing",
                    rel,
                    e
                );
            }
        }
    }

    // Merge into ~/.hamuna/
    merge_dir_recursive(&src, &dest).map_err(|e| format!("Merge failed: {}", e))?;

    fs::write(&ver_file, ADMIN_AGENT_VERSION)
        .map_err(|e| format!("Version write failed: {}", e))?;

    ulog_info!("[admin-agent] Synced v{}", ADMIN_AGENT_VERSION);
    Ok(true)
}

// ============= CLI Sync =============

const CLI_VERSION: &str = "40";

/// Sync the CLI script from bundled resources to ~/.hamuna/bin/.
/// Version-gated: only runs when CLI_VERSION changes.
/// Sources `resources/cli/hamuna.js` (esbuild bundle, shebang `#!/usr/bin/env node`)
/// and copies it to `~/.hamuna/bin/hamuna` with 0755 on Unix.
#[tauri::command]
pub async fn cmd_sync_cli<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || sync_cli_blocking(app_handle))
        .await
        .map_err(|e| format!("cli sync task failed: {}", e))?
}

fn sync_cli_blocking<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    let bin_dir = home.join(".hamuna").join("bin");

    // Version gate
    let ver_file = home.join(".hamuna").join(".cli-version");
    if ver_file.exists() {
        let ver = fs::read_to_string(&ver_file).unwrap_or_default();
        if ver.trim() == CLI_VERSION {
            return Ok(false);
        }
    }

    // Source: app resources/cli/ (esbuild output from `npm run build:cli`)
    let res = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Resource dir: {}", e))?;
    let cli_src = res.join("cli");
    if !cli_src.exists() {
        return Err(format!("CLI source not found: {:?}", cli_src));
    }

    // Ensure ~/.hamuna/bin/ exists
    fs::create_dir_all(&bin_dir).map_err(|e| format!("Failed to create bin dir: {}", e))?;

    // Copy hamuna.js → hamuna (strip extension, shebang handles node invocation on Unix;
    // Windows uses hamuna.cmd wrapper below).
    let src_script = cli_src.join("hamuna.js");
    let dst_script = bin_dir.join("hamuna");
    if !src_script.exists() {
        return Err(format!(
            "CLI script not found: {:?} (run `npm run build:cli`?)",
            src_script
        ));
    }
    // Atomic-replace via tmp + rename, so a `hamuna` process currently
    // executing the old binary doesn't block the upgrade. On Windows
    // `fs::copy` directly to a path held open by another process returns
    // ERROR_SHARING_VIOLATION; the tmp+rename pattern dodges this since
    // rename atomically swaps inodes (or, on Windows ≥1.81, calls
    // `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` which works even when the
    // destination is open). Codex C6 from cross-review.
    let tmp_script = dst_script.with_extension("tmp.new");
    fs::copy(&src_script, &tmp_script)
        .map_err(|e| format!("Failed to copy CLI script tmp: {}", e))?;
    if let Err(e) = fs::rename(&tmp_script, &dst_script) {
        // Best-effort tmp cleanup so a stale `hamuna.tmp.new` doesn't
        // pile up on every failed sync.
        let _ = fs::remove_file(&tmp_script);
        return Err(format!("Failed to install CLI script: {}", e));
    }
    // Ensure executable permission on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        fs::set_permissions(&dst_script, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Write Windows launcher (hamuna.cmd) pinned to the bundled Node.js binary.
    // v0.2.0+: the source hamuna.cmd uses `for %%b in (node.exe)` which searches
    // the user's PATH — but when a user runs `hamuna` from their own terminal, the
    // app bundle's Node directory is NOT in PATH (only injected when the app spawns
    // its own subprocesses). Result on Windows-without-system-Node: ENOENT. We fix
    // this at sync time by baking the absolute bundled node.exe path into the
    // launcher, so terminal invocations don't depend on the system install.
    #[cfg(target_os = "windows")]
    {
        let bundled_node = app_handle
            .path()
            .resource_dir()
            .ok()
            .map(|r| r.join("nodejs").join("node.exe"))
            .filter(|p| p.exists())
            // #229: resource_dir() on Windows can return a `\\?\`-prefixed
            // extended-length path. That prefix is fine for Rust std file APIs
            // (.exists() above accepts it), but once baked into hamuna.cmd as
            // literal text, cmd.exe cannot execute it and reports "The system
            // cannot find the path specified." Strip the prefix at this Rust→
            // cmd.exe boundary, per the red line in CLAUDE.md.
            .map(crate::sidecar::normalize_external_path);

        let dst_cmd = bin_dir.join("hamuna.cmd");
        let cmd_contents = if let Some(node_path) = bundled_node {
            // Absolute path: no PATH dependency; survives terminal launch.
            let node_str = node_path.to_string_lossy();
            format!(
                "@echo off\r\n\
                 :: hamuna CLI wrapper — generated by cmd_sync_cli; invokes bundled Node.js.\r\n\
                 setlocal\r\n\
                 \"{}\" \"%~dp0hamuna\" %*\r\n\
                 exit /b %ERRORLEVEL%\r\n",
                node_str
            )
        } else {
            // Dev / packaging-in-progress fallback: behave like the source .cmd,
            // expecting node.exe in PATH.
            let src_cmd = cli_src.join("hamuna.cmd");
            match fs::read_to_string(&src_cmd) {
                Ok(s) => s,
                Err(e) => return Err(format!("Failed to read source hamuna.cmd: {}", e)),
            }
        };
        // Same tmp+rename atomic-replace pattern as above (an open
        // hamuna.cmd shell window would otherwise block the upgrade
        // with ERROR_SHARING_VIOLATION).
        let tmp_cmd = dst_cmd.with_extension("cmd.tmp.new");
        fs::write(&tmp_cmd, cmd_contents)
            .map_err(|e| format!("Failed to write hamuna.cmd tmp: {}", e))?;
        if let Err(e) = fs::rename(&tmp_cmd, &dst_cmd) {
            let _ = fs::remove_file(&tmp_cmd);
            return Err(format!("Failed to install hamuna.cmd: {}", e));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Non-Windows: copy the source .cmd as-is for completeness (unused at runtime).
        let src_cmd = cli_src.join("hamuna.cmd");
        let dst_cmd = bin_dir.join("hamuna.cmd");
        if src_cmd.exists() {
            fs::copy(&src_cmd, &dst_cmd)
                .map_err(|e| format!("Failed to copy CLI cmd script: {}", e))?;
        }
    }

    // Write version gate
    fs::write(&ver_file, CLI_VERSION).map_err(|e| format!("CLI version write failed: {}", e))?;

    ulog_info!("[cli] Synced CLI v{}", CLI_VERSION);
    Ok(true)
}

// ============= System Skills Sync =============
//
// A distinct tier from the "seed once" bundled-skills behaviour
// (src/server/index.ts::seedBundledSkills). Those are open-ended utility
// skills users are encouraged to customise — we copy them in on first
// launch and then never touch them again.
//
// System skills are different: they encode flow-level contracts that
// must evolve in lockstep with Rust / CLI / shape changes. Example:
// `/task-implement` used to call `hamuna task update-progress <id>
// "..."`; when we removed that CLI in v0.1.69+ the skill had to update
// in the same release, else existing users' AI calls would fail with
// "unknown command". The seed-once path can't deliver updates — we
// need version-gated force-overwrite, same pattern as ADMIN_AGENT
// and CLI above.
//
// To add a new system skill: drop the directory in `bundled-skills/`
// (must contain a SKILL.md). The list is auto-derived at build time by
// `scripts/generate-system-skills.mjs` (also wired into npm
// `prebuild:server` / `prebuild:web` / `pretest` / `prelint` hooks and
// `src-tauri/build.rs` as the bare-cargo fallback). Both
// `src-tauri/src/system_skills.generated.rs` and
// `src/shared/systemSkills.generated.ts` are regenerated before every
// build/test/lint pass, so the Rust `const SYSTEM_SKILLS: &[&str]` and the
// Node `SYSTEM_SKILLS: readonly string[]` cannot drift.
//
// To remove a system skill: remove its directory from `bundled-skills/`.
// On the next launch the orphan cleanup pass detects the snapshot/dir
// mismatch and hard-deletes the user's copy (see
// `cmd_sync_system_skills_blocking`). No version bump or code edit
// required.
//
// SYSTEM_SKILLS_VERSION is independent — bump it only when SKILL.md
// *content* changes that must overwrite on every existing install.
//
// 59: miniapp-creator — document `meta.json::dependencies` (CDN deps) as the
// only way to load third-party libraries under `default-src 'none'`, and
// correct the stale "ai.cancel / agent streaming don't exist" notes. Both
// used to steer authors away from capabilities that now work.

const SYSTEM_SKILLS_VERSION: &str = "60";

/// One process-wide transaction owner for the versioned system-skill
/// snapshot. Startup automation and ConfigProvider may request convergence at
/// the same time; both must join this lock before any remove/copy/version
/// operation so a Runtime can never scan a half-replaced directory tree.
static SYSTEM_SKILLS_SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

// Skills that ship with the app and MUST stay at the bundled version —
// the app's flows depend on them, users are not meant to customise.
//
// Derived at build time from `bundled-skills/<name>/SKILL.md` and emitted
// to `system_skills.generated.rs`. `include!` keeps it a real `const` so the
// existing `.iter().copied() / for x in / includes()` callsites stay
// untouched. The Node mirror lives at
// `src/shared/systemSkills.generated.ts` and is also emitted by the same
// generator — cross-language drift is ruled out by both targets being
// produced by a single Node pass over the same filesystem.
// NOTE: line comment (not `///`) — rustdoc refuses doc comments on
// macro invocations.
include!("system_skills.generated.rs");

/// Skills unavailable on certain platforms due to upstream bugs.
/// MUST stay in sync with `src/server/utils/platform.ts::PLATFORM_BLOCKED_SKILLS`.
/// Used by `cmd_sync_system_skills` to skip force-syncing skills that the
/// Node-side runtime would later filter out anyway — prevents orphan files
/// in `~/.hamuna/skills/` that confuse users.
fn is_skill_blocked_on_platform(skill_folder: &str) -> bool {
    match skill_folder {
        // agent-browser daemon broken on Windows: vercel-labs/agent-browser#398
        "agent-browser" => cfg!(target_os = "windows"),
        _ => false,
    }
}

/// Force-sync every system skill from the app bundle to
/// `~/.hamuna/skills/<name>/`. Runs once per `SYSTEM_SKILLS_VERSION`
/// bump — idempotent otherwise. User edits to these directories will
/// be overwritten when the version changes, by design (see module
/// comment above).
///
/// async + spawn_blocking (cross-review 0.2.32): this command recursively
/// deletes/copies skill directories and is invoked during config load
/// (ConfigProvider). As a synchronous command it ran on the main thread —
/// on macOS that's WKWebView's UI thread, so a version bump or a slow disk
/// froze the whole WebView for the duration of the sweep (same class as the
/// 0.2.31 cmd_ensure_session_sidecar freeze). The healthy-install fast path
/// (version stamp + per-skill SKILL.md stat) is also disk I/O, so the entire
/// body moves off-thread, not just the copy loop.
#[tauri::command]
pub async fn cmd_sync_system_skills<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    sync_system_skills_for_startup(app_handle).await
}

/// Force-sync and then verify the complete versioned system-skill snapshot.
///
/// This is shared by the renderer command and Rust startup automation so
/// hidden maintenance tasks never depend on ConfigProvider having mounted.
pub(crate) async fn sync_system_skills_for_startup<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<bool, String> {
    let sync_lock = SYSTEM_SKILLS_SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _transaction = sync_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let changed = sync_system_skills_blocking(app_handle)?;
        ensure_system_skills_installation_current()?;
        Ok(changed)
    })
    .await
    .map_err(|e| format!("system-skills sync task failed: {}", e))?
}

fn ensure_system_skills_installation_current() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    ensure_system_skills_installation_current_at(&home.join(".hamuna"))
}

fn ensure_system_skills_installation_current_at(hamuna_dir: &Path) -> Result<(), String> {
    let version_path = hamuna_dir.join(".system-skills-version");
    let installed_version = fs::read_to_string(&version_path).map_err(|e| {
        format!(
            "system skills are not ready: failed to read {}: {}",
            version_path.display(),
            e
        )
    })?;
    if installed_version.trim() != SYSTEM_SKILLS_VERSION {
        return Err(format!(
            "system skills are not ready: installed version {:?}, expected {}",
            installed_version.trim(),
            SYSTEM_SKILLS_VERSION
        ));
    }

    let skills_dir = hamuna_dir.join("skills");
    if !all_installed_system_skills_complete(&skills_dir) {
        return Err(format!(
            "system skills are not ready: one or more required SKILL.md files are missing under {}",
            skills_dir.display()
        ));
    }
    Ok(())
}

fn sync_system_skills_blocking<R: Runtime>(app_handle: AppHandle<R>) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    let hamuna_dir = home.join(".hamuna");
    let skills_dir = hamuna_dir.join("skills");

    // Version gate — skip the whole sweep if we've already landed
    // SYSTEM_SKILLS_VERSION AND every system skill is actually present on disk.
    //
    // The version stamp alone is NOT proof the install is healthy (issue #321):
    // the old destructive sync could write the version after leaving empty
    // `~/.hamuna/skills/<name>/` dirs, freezing that broken state forever.
    // Validating the on-disk result here makes the gate self-healing — a frozen
    // or incomplete install re-runs the (now non-destructive) sync regardless of
    // whether the version happened to be bumped. Healthy installs still
    // early-return after the cheap per-skill SKILL.md stat.
    let ver_file = hamuna_dir.join(".system-skills-version");
    if ver_file.exists() {
        let ver = fs::read_to_string(&ver_file).unwrap_or_default();
        if ver.trim() == SYSTEM_SKILLS_VERSION && all_installed_system_skills_complete(&skills_dir)
        {
            return Ok(false);
        }
    }

    // Source: app bundle resources/bundled-skills/
    let res = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Resource dir: {}", e))?;
    let bundled_skills_dir = res.join("bundled-skills");
    if !bundled_skills_dir.exists() {
        return Err(format!(
            "bundled-skills not found: {:?}",
            bundled_skills_dir
        ));
    }

    fs::create_dir_all(&skills_dir).map_err(|e| format!("Failed to create skills dir: {}", e))?;

    let mut synced = Vec::new();
    let mut missing = Vec::new();
    let mut incomplete = Vec::new();
    let mut platform_skipped = Vec::new();
    for skill_name in SYSTEM_SKILLS {
        // Platform block: keep parity with Node-side `isSkillBlockedOnPlatform`
        // (src/server/utils/platform.ts). Without this, a skill marked
        // unavailable on the current platform (e.g. agent-browser on Windows
        // due to upstream daemon bug) would be force-synced into
        // ~/.hamuna/skills/ but invisible to the SDK runtime — orphan
        // disk files that confuse users and serve no purpose.
        if is_skill_blocked_on_platform(skill_name) {
            platform_skipped.push(*skill_name);
            continue;
        }
        let src = bundled_skills_dir.join(skill_name);
        let dst = skills_dir.join(skill_name);
        match sync_one_system_skill(&src, &dst)
            .map_err(|e| format!("sync {}: {}", skill_name, e))?
        {
            SystemSkillSync::Synced => synced.push(*skill_name),
            SystemSkillSync::SkippedMissingSource => {
                // Packaging miss — skill listed in SYSTEM_SKILLS but absent
                // from the bundle. Log and continue so one missing skill
                // doesn't block the rest.
                ulog_warn!("[system-skills] bundled skill missing: {}", skill_name);
                missing.push(skill_name.to_string());
            }
            SystemSkillSync::SkippedIncompleteSource => {
                // Packaging miss — the bundled source dir exists but has no
                // SKILL.md (issue #321: the Windows resource tree shipped some
                // system skills empty). `sync_one_system_skill` left any
                // existing good copy untouched. Don't advance the version gate
                // below so a corrected bundle re-syncs on the next launch.
                ulog_warn!(
                    "[system-skills] bundled skill incomplete (no SKILL.md), preserved existing copy: {}",
                    skill_name
                );
                incomplete.push(skill_name.to_string());
            }
        }
    }

    // Only advance the version gate when every system skill actually landed.
    // A missing/incomplete bundled source is a packaging defect; freezing the
    // version on a partial sweep would make the broken state permanent (the
    // old behavior that produced empty `~/.hamuna/skills/<name>` dirs on
    // Windows — issue #321). Leaving the version unwritten retries next launch
    // and keeps the warnings above visible. Platform-skipped skills are
    // intentional, not defects, so they don't block the advance.
    let complete = missing.is_empty() && incomplete.is_empty();
    if complete {
        fs::write(&ver_file, SYSTEM_SKILLS_VERSION)
            .map_err(|e| format!("version write failed: {}", e))?;
    }

    // === Orphan cleanup pass (task #155) ===
    //
    // Bundled system skills that were removed from `SYSTEM_SKILLS` in a later
    // release leave behind a `~/.hamuna/skills/<name>/` dir. Per design
    // ("bundled-skills == system skills, fully synced"), hard-delete those
    // copies on every successful sync.
    //
    // The tracker is `~/.hamuna/.system-skills-snapshot.json` (separate from
    // `.system-skills-version`, which only gates the version stamp). The
    // snapshot records the *previous* `SYSTEM_SKILLS` list; any name that is
    // (a) in that snapshot, (b) NOT in the current `SYSTEM_SKILLS`, and
    // (c) present on disk under `~/.hamuna/skills/` is a bundled-originated
    // orphan → remove.
    //
    // Names that are NOT in the snapshot are user-installed (manual `mkdir`
    // or `hamuna skill add`); we never touch those. A missing/corrupt
    // snapshot file is treated as "no orphans to consider" (conservative —
    // avoids wiping user content on first launch after an upgrade from a
    // pre-#155 build).
    let orphan_snapshot = read_system_skills_snapshot(&hamuna_dir);
    let mut removed_orphans: Vec<String> = Vec::new();
    let mut failed_orphans: Vec<String> = Vec::new();
    let bundled_set: std::collections::HashSet<&str> = SYSTEM_SKILLS.iter().copied().collect();
    if let Ok(snapshot) = orphan_snapshot {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_string();
                // Skip dotfiles (`.system-skills-version`, `.system-skills-snapshot.json`).
                if name_str.starts_with('.') {
                    continue;
                }
                // Still in current SYSTEM_SKILLS → keep.
                if bundled_set.contains(name_str.as_str()) {
                    continue;
                }
                // Not in previous snapshot → user-installed → preserve.
                if !snapshot.skills.iter().any(|s| s == &name_str) {
                    continue;
                }
                // Bundled-originated orphan: was in snapshot, not in current
                // SYSTEM_SKILLS, present on disk → remove.
                let path = entry.path();
                // Pit-of-success: symlink_metadata does NOT follow symlinks,
                // so a dangling link (Node-side broken-symlink hazard) is
                // still detected and removed here.
                match fs::symlink_metadata(&path) {
                    Ok(_) => match fs::remove_dir_all(&path) {
                        Ok(_) => {
                            ulog_info!("[system-skills] Removed orphan: {}", name_str);
                            removed_orphans.push(name_str);
                        }
                        Err(e) => {
                            ulog_warn!(
                                "[system-skills] Failed to remove orphan {}: {}",
                                name_str,
                                e
                            );
                            failed_orphans.push(name_str);
                        }
                    },
                    Err(e) => {
                        ulog_warn!(
                            "[system-skills] symlink_metadata({}) failed: {}",
                            path.display(),
                            e
                        );
                        failed_orphans.push(name_str);
                    }
                }
            }
        }
    }
    // Always refresh the snapshot to reflect the current SYSTEM_SKILLS list,
    // even when nothing was removed. A missing file is the same as "never
    // tracked anything", which on the next launch would skip cleanup — so we
    // persist the current set to bootstrap the tracker on the first run after
    // #155 ships.
    if let Err(e) = write_system_skills_snapshot(&hamuna_dir, SYSTEM_SKILLS) {
        ulog_warn!(
            "[system-skills] failed to write .system-skills-snapshot.json: {}",
            e
        );
    }

    ulog_info!(
        "[system-skills] Synced v{} (complete={}) — ok: {:?}, missing: {:?}, incomplete: {:?}, platform-skipped: {:?}",
        SYSTEM_SKILLS_VERSION,
        complete,
        synced,
        missing,
        incomplete,
        platform_skipped
    );
    Ok(complete)
}

/// Outcome of syncing one system skill from the app bundle into
/// `~/.hamuna/skills/`.
enum SystemSkillSync {
    /// Source was valid and copied over `dst`.
    Synced,
    /// Source directory does not exist in the bundle at all.
    SkippedMissingSource,
    /// Source directory exists but is not a valid skill (no SKILL.md). The
    /// existing `dst`, if any, was left untouched.
    SkippedIncompleteSource,
}

/// A skill directory is "complete" iff it carries a top-level `SKILL.md` — the
/// one file every SKILL.md-gated scanner (Settings panel, slash picker, SDK
/// runtime) requires to recognize a skill. An empty / SKILL.md-less directory
/// is a packaging defect, not a skill. Applies equally to a bundled source dir
/// and an installed `~/.hamuna/skills/<name>` dir.
fn skill_dir_is_complete(dir: &Path) -> bool {
    dir.join("SKILL.md").is_file()
}

/// True iff every system skill that SHOULD be installed on this platform has a
/// valid SKILL.md on disk under `skills_dir`. Platform-blocked skills are
/// intentionally absent and don't count against completeness. Used to bypass
/// the version fast-path so a frozen/incomplete install (issue #321) self-heals
/// instead of trusting the version stamp.
fn all_installed_system_skills_complete(skills_dir: &Path) -> bool {
    SYSTEM_SKILLS.iter().all(|name| {
        is_skill_blocked_on_platform(name) || skill_dir_is_complete(&skills_dir.join(name))
    })
}

/// Snapshot of which skills were last force-synced by `sync_system_skills_blocking`.
/// Lives at `~/.hamuna/.system-skills-snapshot.json` and is updated on every
/// successful sync. The orphan-cleanup pass compares this list against the
/// current `SYSTEM_SKILLS` constant: any name in the snapshot that is no
/// longer a system skill AND is present on disk is a bundled-originated
/// orphan → remove.
///
/// Distinct from `.system-skills-version` (a single string stamp): the version
/// only gates the *force-overwrite* fast-path; the snapshot gates
/// *orphan-cleanup* decisions. They live in different files because they
/// have different shapes (string vs JSON array) and different write
/// triggers.
#[derive(serde::Serialize, serde::Deserialize)]
struct SystemSkillsSnapshot {
    /// Mirrors `SYSTEM_SKILLS_VERSION` at the time of the last write — for
    /// debugging only, the orphan decision is driven by the `skills` list.
    version: String,
    skills: Vec<String>,
}

/// Read the system-skills snapshot, or return an error if the file is
/// missing/corrupt. Callers treat any error as "no prior snapshot" →
/// skip cleanup (conservative: avoids wiping user content on first launch
/// after a pre-#155 build).
fn read_system_skills_snapshot(hamuna_dir: &Path) -> Result<SystemSkillsSnapshot, String> {
    let path = hamuna_dir.join(".system-skills-snapshot.json");
    let raw = fs::read_to_string(&path).map_err(|e| format!("read snapshot: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse snapshot: {}", e))
}

/// Persist the current `SYSTEM_SKILLS` set as the new snapshot. A best-
/// effort write — on failure the next launch's cleanup simply has no prior
/// snapshot and skips the pass (the failure is logged so it's visible in
/// the unified log).
fn write_system_skills_snapshot(hamuna_dir: &Path, skills: &[&str]) -> Result<(), String> {
    let snapshot = SystemSkillsSnapshot {
        version: SYSTEM_SKILLS_VERSION.to_string(),
        skills: skills.iter().map(|s| s.to_string()).collect(),
    };
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("serialize snapshot: {}", e))?;
    let path = hamuna_dir.join(".system-skills-snapshot.json");
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("write tmp: {}", e))?;
    // Atomic rename: a crash mid-write leaves the old snapshot intact
    // (or no file, on first launch — both safe; cleanup just skips).
    fs::rename(&tmp, &path).map_err(|e| format!("rename snapshot: {}", e))
}

/// Sync one system skill `src` → `dst`. Refuses to clear an existing good
/// `dst` unless the source is a complete skill, so a packaging miss can never
/// replace a working installed copy with an empty directory (issue #321: the
/// old path did `remove_dir_all(dst)` BEFORE merging, so an empty bundled
/// source destroyed the user's copy and then wrote the version file, making
/// the empty state permanent and invisible to every panel/scan).
fn sync_one_system_skill(src: &Path, dst: &Path) -> Result<SystemSkillSync, String> {
    if !src.exists() {
        return Ok(SystemSkillSync::SkippedMissingSource);
    }
    if !skill_dir_is_complete(src) {
        return Ok(SystemSkillSync::SkippedIncompleteSource);
    }
    // Source is a valid skill — safe to replace the existing target wholesale.
    // SYSTEM_SKILLS_VERSION bumps mean "the whole skill snapshot is new".
    //
    // Path::exists() follows symlinks → returns false for broken links, so a
    // dangling `~/.hamuna/skills/<name>` left by the user (e.g. pointing at
    // a moved repo) would slip past and then trip `fs::create_dir_all` in
    // `merge_dir_recursive` with EEXIST, failing the whole startup sync.
    // symlink_metadata() does NOT follow, so it's the right probe for "is
    // there anything at this path, even a dangling link?".
    match fs::symlink_metadata(dst) {
        Ok(meta) => {
            let removed = if meta.file_type().is_symlink() || meta.is_file() {
                fs::remove_file(dst)
            } else {
                fs::remove_dir_all(dst)
            };
            if let Err(e) = removed {
                ulog_warn!(
                    "[system-skills] failed to clear {}: {} — falling back to merge",
                    dst.display(),
                    e
                );
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Nothing there, fresh seed below.
        }
        Err(e) => {
            ulog_warn!(
                "[system-skills] symlink_metadata({}) failed: {} — falling back to merge",
                dst.display(),
                e
            );
        }
    }
    merge_dir_recursive(src, dst).map_err(|e| e.to_string())?;
    Ok(SystemSkillSync::Synced)
}

/// Merge src/ into dst/ recursively. Creates missing dirs, overwrites files, never deletes.
fn merge_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let d = dst.join(&name);
        if ft.is_dir() {
            merge_dir_recursive(&entry.path(), &d)?;
        } else {
            fs::copy(&entry.path(), &d)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod miniapp_version_tests {
    use super::next_miniapp_version;

    // Regression: the old code read `version` back out of the meta.json it had
    // *just written* and added 1. That file is AI-authored and always carries
    // `version: 1`, so every overwrite produced 2 — the number never moved,
    // while the Marketplace rendered the stored `1`. Both halves are pinned
    // here: increment against the PREVIOUS version, and start at 1.

    #[test]
    fn first_install_is_one() {
        assert_eq!(next_miniapp_version(None), 1);
    }

    #[test]
    fn increments_across_repeated_overwrites() {
        // The AI rewrites `version: 1` into every meta.json it produces, so the
        // stored number has to come from the meta as it was *before* this write.
        // The caller supplies that (see `create_from_chat_blocking`), which is
        // the only thing that can make the increment real.
        let mut stored = next_miniapp_version(None);
        assert_eq!(stored, 1, "first install is 1");
        for expected in 2..=5 {
            stored = next_miniapp_version(Some(&format!(
                r#"{{"id":"x","name":"X","description":"d","version":{}}}"#,
                stored
            )));
            assert_eq!(stored, expected, "overwrite should increment");
        }
        // Four overwrites of a file the AI keeps rewriting as `version: 1` must
        // land on 5. Reading the just-written file back instead would have fed
        // `1` in every round and pinned the number at 2 forever — which is the
        // regression this exists to catch.
        assert_eq!(stored, 5);
    }

    #[test]
    fn tolerates_unreadable_or_versionless_previous_meta() {
        assert_eq!(next_miniapp_version(Some("not json")), 1);
        assert_eq!(next_miniapp_version(Some(r#"{"id":"x"}"#)), 1);
        assert_eq!(next_miniapp_version(Some(r#"{"version":"3"}"#)), 1);
    }
}

#[cfg(test)]
mod miniapp_summary_tests {
    use super::read_miniapp_meta_for_listing;
    use std::fs;

    fn summary_for(meta: &str) -> super::MiniAppSummary {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("app");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("meta.json"), meta).unwrap();
        read_miniapp_meta_for_listing(&dir.join("meta.json"), "installed").unwrap()
    }

    // The catalog renders name/description through `shared/miniapp/localize.ts`,
    // which needs both halves: the top-level defaults AND the `i18n` table.
    // Dropping either one here does not fail — the card just silently shows the
    // wrong language — so pin both.
    #[test]
    fn carries_top_level_strings_and_i18n_table() {
        let s = summary_for(
            r#"{
              "id": "gomoku", "name": "五子棋", "description": "经典棋盘",
              "version": 2, "icon": "Grid3x9", "tags": ["game"],
              "i18n": { "locales": { "en-US": { "name": "Gomoku" } } }
            }"#,
        );
        assert_eq!(s.name, "五子棋");
        assert_eq!(s.description, "经典棋盘");
        assert_eq!(s.tags.as_deref(), Some(&["game".to_string()][..]));
        let locales = &s.i18n.expect("i18n table must be passed through")["locales"];
        assert_eq!(locales["en-US"]["name"], serde_json::json!("Gomoku"));
    }

    #[test]
    fn missing_optional_fields_stay_none() {
        // No `description` on purpose: the last assertion below is about an
        // older meta.json that predates the field.
        let s = summary_for(r#"{"id": "bare", "name": "Bare", "version": 1}"#);
        assert!(s.i18n.is_none());
        assert!(s.tags.is_none());
        assert!(s.icon.is_none());
        // `permissions` and `dependencies` are the two fields the renderer's CSP
        // decision is derived from. Losing either one fails **open-looking**
        // rather than closed: with `permissions` gone every capability call is
        // denied (fail-closed, visible), but with `dependencies` gone the CDN
        // tags silently stop being injected and the MiniApp renders unstyled
        // with no error anywhere. Pin both as None-when-absent.
        assert!(s.permissions.is_none());
        assert!(s.dependencies.is_none());
        // An older meta.json with no `description` must still list, not panic —
        // the card falls back to the name.
        assert_eq!(s.description, "");
    }

    // `permissions` + `dependencies` are the authorization pair: the renderer
    // widens the iframe CSP to exactly the dependency hosts that already appear
    // in `permissions.net.allow`. If Rust stopped forwarding either one the
    // failure is silent — the MiniApp just loads with a stricter CSP and no CDN.
    // These two tests pin that both survive the listing hop.
    #[test]
    fn carries_permissions_and_dependencies_verbatim() {
        let s = summary_for(
            r#"{
              "id": "cdn-app", "name": "CDN", "description": "d", "version": 1,
              "permissions": { "net": { "allow": ["cdn.jsdelivr.net"] } },
              "dependencies": [
                { "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js", "type": "script" }
              ]
            }"#,
        );
        let perms = s.permissions.expect("permissions must reach the renderer");
        assert_eq!(
            perms["net"]["allow"][0],
            serde_json::json!("cdn.jsdelivr.net")
        );
        let deps = s
            .dependencies
            .expect("dependencies must reach the renderer");
        assert_eq!(deps.as_array().map(|a| a.len()), Some(1));
        assert_eq!(deps[0]["type"], serde_json::json!("script"));
    }

    // A non-array `dependencies` must not be forwarded. The renderer's schema
    // check would reject it, but a hand-edited meta.json can get here first and
    // the host code indexes into this value while computing the CSP host list.
    #[test]
    fn non_array_dependencies_are_dropped() {
        let s = summary_for(
            r#"{"id":"x","name":"X","description":"d","version":1,"dependencies":"nope"}"#,
        );
        assert!(s.dependencies.is_none());

        let s2 =
            summary_for(r#"{"id":"x","name":"X","description":"d","version":1,"permissions":[]}"#);
        assert!(s2.permissions.is_none());
    }

    // `"i18n": null` is what a failed write leaves behind; serializing it as
    // `Some(Value::Null)` would put a null table on the wire that the renderer's
    // `Object.keys()` guard has to special-case.
    #[test]
    fn null_i18n_is_not_forwarded() {
        let s = summary_for(
            r#"{"id":"x","name":"X","description":"d","version":1,"i18n":null}"#,
        );
        assert!(s.i18n.is_none());
    }
}

#[cfg(test)]
mod miniapp_host_version_tests {
    use super::{miniapp_host_version_satisfies, parse_semver};

    // `min_host_version` used to be shape-checked only, which let three bundled
    // apps declare 0.4.0 while the host was 0.3.x — they shipped, appeared in the
    // catalog, and then had no working implementation behind them. These pin the
    // comparison that now gates the listing.

    #[test]
    fn parses_three_segment_semver() {
        assert_eq!(parse_semver("0.3.233"), Some((0, 3, 233)));
        assert_eq!(parse_semver("1.0.0"), Some((1, 0, 0)));
    }

    #[test]
    fn rejects_malformed_semver() {
        assert_eq!(parse_semver("0.3"), None);
        assert_eq!(parse_semver("0.3.1.2"), None);
        assert_eq!(parse_semver("v0.3.1"), None);
        assert_eq!(parse_semver(""), None);
    }

    #[test]
    fn host_satisfies_versions_at_or_below_its_own() {
        assert!(miniapp_host_version_satisfies("0.0.1"));
        // An app declaring exactly the host version must load.
        assert!(miniapp_host_version_satisfies(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn host_rejects_versions_above_its_own() {
        // A far-future minimum must not pass, and neither must an unparseable one.
        assert!(!miniapp_host_version_satisfies("999.0.0"));
        assert!(
            !miniapp_host_version_satisfies("not-a-version"),
            "an unparseable min_host_version must fail closed, not silently pass"
        );
    }
}

#[cfg(test)]
mod system_skills_tests {
    use super::{
        all_installed_system_skills_complete, ensure_system_skills_installation_current_at,
        is_skill_blocked_on_platform, read_system_skills_snapshot, skill_dir_is_complete,
        sync_one_system_skill, SystemSkillSync, SystemSkillsSnapshot, ADMIN_AGENT_VERSION,
        CLI_VERSION, SYSTEM_SKILLS, SYSTEM_SKILLS_VERSION,
    };
    use std::fs;
    use std::path::Path;

    // Issue #321: a Windows install shipped some system-skill source dirs
    // empty (no SKILL.md). The old sync removed the user's good copy, merged
    // the empty source, then wrote the version file — freezing an empty,
    // panel-invisible directory permanently. These tests pin the invariant
    // that an incomplete source can never destroy a working copy, and that the
    // version gate validates on-disk state rather than trusting the stamp.

    #[test]
    fn complete_requires_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("foo");
        fs::create_dir_all(&dir).unwrap();
        assert!(!skill_dir_is_complete(&dir), "empty dir is not a skill");
        fs::write(dir.join("SKILL.md"), "x").unwrap();
        assert!(skill_dir_is_complete(&dir), "dir with SKILL.md is a skill");
    }

    #[test]
    fn v37_updates_goal_cli_skill_and_preserves_v36_contracts() {
        // After Phase 1/2 added icon-design / miniapp-creator / ppt-master,
        // SYSTEM_SKILLS_VERSION bumped to 58, and it has moved on since (60 as of
        // the MiniApp sandbox same-origin fix — miniapp-creator's SKILL.md told
        // authors the iframe carried `allow-same-origin`, which it no longer
        // does). The v37 contracts on CLI / memory-update / docs are still valid;
        // only the version anchor has to track the constant.
        assert_eq!(CLI_VERSION, "40");
        assert_eq!(SYSTEM_SKILLS_VERSION, "60");
        let bundled = include_str!("../../bundled-skills/hamuna-cli/SKILL.md");
        assert!(bundled.contains("hamuna space list --json"));
        assert!(bundled.contains("hamuna space whoami --space <slug> --json"));
        assert!(bundled.contains("hamuna space goal list --space <slug> --json"));
        assert!(bundled.contains("hamuna space issue update <issueId>"));
        assert!(bundled.contains("--clear-goal"));
        assert!(bundled.contains("只有精确 leaf help 明确声明支持的命令才使用 `--dry-run`"));
        assert!(bundled.contains("所有 Space 业务命令都必须带 `--space <slug>`"));
        assert!(bundled.contains("hamuna goal create --objective-file goal-objective.txt"));
        assert!(bundled.contains("workspace 或系统 temp 均可"));
        assert!(bundled.contains("--max-executions <正整数>"));

        let memory_update = include_str!("../../bundled-skills/hamuna-memory-update/SKILL.md");
        assert!(
            memory_update.contains("仅当系统或用户明确指定完整名称 `hamuna-memory-update` 时使用")
        );
        assert!(memory_update.contains("不要根据任务语义或相似表述自行触发"));
        assert!(memory_update.contains("错误的长期记忆通常比暂时缺失更有害"));
        assert!(memory_update.contains("无法说明未来判断或行动差异的信息，不写"));
        assert!(memory_update.contains("不置可否、忽略、换话题、未纠正或简单接受"));
        assert!(memory_update.contains("明确限定为“本次/这次/单次”"));
        assert!(memory_update.contains("不从已有 topic 名称或工作区结构猜测事件归属"));
        assert!(memory_update.contains("不要落盘“未升级偏好”"));
        assert!(memory_update.contains("commit 后 push 当前分支"));
        assert!(SYSTEM_SKILLS.contains(&"hamuna-memory-update"));

        let product_docs = include_str!("../../bundled-skills/hamuna-docs/SKILL.md");
        assert!(product_docs.contains("name: hamuna-docs"));
        assert!(product_docs.contains("它面向软件使用而非源码开发"));
        assert!(product_docs.contains("随后加载 `/hamuna-cli`"));
        assert!(product_docs.contains("在内置小助理里加载 `/support`"));
        assert!(SYSTEM_SKILLS.contains(&"hamuna-docs"));
    }

    #[test]
    fn v25_helper_routes_product_knowledge_and_diagnosis() {
        assert_eq!(ADMIN_AGENT_VERSION, "25");
        let helper = include_str!("../../bundled-agents/hamuna_helper/CLAUDE.md");
        let support =
            include_str!("../../bundled-agents/hamuna_helper/.claude/skills/support/SKILL.md");
        assert!(helper.contains("`/hamuna-docs`"));
        assert!(helper.contains("`/hamuna-cli`"));
        assert!(helper.contains("`/support`"));
        assert!(support.contains("先用 `/hamuna-docs` 确认正确产品预期"));
        assert!(support.contains("不读取 `~/.hamuna/credentials/`"));
    }

    #[test]
    fn bundled_product_and_support_reference_closures_are_complete() {
        fn assert_reference_closure(skill_dir: &str) {
            let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("src-tauri must live under the repository root");
            let skill_dir = repo_root.join(skill_dir);
            let index = fs::read_to_string(skill_dir.join("SKILL.md")).expect("skill index");
            let routed: std::collections::BTreeSet<String> = index
                .split('`')
                .filter_map(|token| token.strip_prefix("references/"))
                .filter(|token| token.ends_with(".md"))
                .map(str::to_owned)
                .collect();
            let references_dir = skill_dir.join("references");
            let bundled: std::collections::BTreeSet<String> = fs::read_dir(&references_dir)
                .expect("references directory")
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect();

            assert!(
                !routed.is_empty(),
                "skill must route at least one reference"
            );
            assert_eq!(
                routed, bundled,
                "SKILL.md routes and bundled references drifted"
            );
            for name in routed {
                let content = fs::read_to_string(references_dir.join(&name))
                    .unwrap_or_else(|error| panic!("missing reference {name}: {error}"));
                assert!(
                    content.starts_with("# "),
                    "{name} must contain reference content"
                );
            }
        }

        assert_reference_closure("bundled-skills/hamuna-docs");
        assert_reference_closure("bundled-agents/hamuna_helper/.claude/skills/support");

        let redactor = include_str!(
            "../../bundled-agents/hamuna_helper/.claude/skills/support/scripts/redact-log-output.mjs"
        );
        assert!(redactor.contains("<redacted-token>"));
    }

    #[test]
    fn system_skills_matches_bundled_skills_with_skill_md() {
        // SYSTEM_SKILLS is auto-derived from bundled-skills/ by
        // scripts/generate-system-skills.mjs. The Rust and Node targets are
        // both emitted by the same Node pass, so cross-language parity is
        // by-construction (verify-system-skills-sync.mjs still reads the
        // generated files to catch a missing regen). This test asserts the
        // single remaining invariant: the bundled Rust const exactly matches
        // the directories present in bundled-skills/ that ship a SKILL.md.
        let bundled_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .join("bundled-skills");
        let mut actual: Vec<String> = fs::read_dir(&bundled_dir)
            .expect("bundled-skills/ exists")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .filter(|entry| entry.path().join("SKILL.md").is_file())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        actual.sort();
        let expected: Vec<String> = SYSTEM_SKILLS
            .iter()
            .map(|name| (*name).to_string())
            .collect();
        assert_eq!(
            actual, expected,
            "bundled-skills/ ↔ SYSTEM_SKILLS drift; rerun `npm run generate:system-skills`"
        );
    }

    #[test]
    fn all_memory_skill_descriptions_require_the_exact_full_name() {
        for (name, content) in [
            (
                "hamuna-memory-update",
                include_str!("../../bundled-skills/hamuna-memory-update/SKILL.md"),
            ),
            (
                "hamuna-memory-gardener",
                include_str!("../../bundled-skills/hamuna-memory-gardener/SKILL.md"),
            ),
            (
                "hamuna-memory-molt",
                include_str!("../../bundled-skills/hamuna-memory-molt/SKILL.md"),
            ),
        ] {
            assert!(
                content.contains(&format!("仅当系统或用户明确指定完整名称 `{name}` 时使用")),
                "{name} must use the exact-name-only trigger contract"
            );
            assert!(
                content.contains("不要根据任务语义或相似表述自行触发"),
                "{name} must reject semantic or similar-phrase auto-triggering"
            );
        }
    }

    #[test]
    fn automation_startup_sync_precedes_task_scheduler_recovery() {
        let source = include_str!("cron_task/init_recovery.rs");
        let sync = source
            .find("sync_system_skills_for_startup")
            .expect("startup system-skill sync");
        let scheduler = source
            .find("get_task_scheduler()")
            .expect("task scheduler recovery");
        assert!(sync < scheduler);
    }

    #[test]
    fn sync_readiness_requires_current_version_and_complete_snapshot() {
        let tmp = tempfile::tempdir().unwrap();
        let hamuna_dir = tmp.path();
        let skills_dir = hamuna_dir.join("skills");
        for name in SYSTEM_SKILLS {
            if is_skill_blocked_on_platform(name) {
                continue;
            }
            let dir = skills_dir.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("SKILL.md"), "x").unwrap();
        }

        fs::write(
            hamuna_dir.join(".system-skills-version"),
            SYSTEM_SKILLS_VERSION,
        )
        .unwrap();
        ensure_system_skills_installation_current_at(hamuna_dir)
            .expect("current complete snapshot is ready");

        fs::write(hamuna_dir.join(".system-skills-version"), "32").unwrap();
        assert!(ensure_system_skills_installation_current_at(hamuna_dir).is_err());

        fs::write(
            hamuna_dir.join(".system-skills-version"),
            SYSTEM_SKILLS_VERSION,
        )
        .unwrap();
        fs::remove_file(skills_dir.join("hamuna-memory-update").join("SKILL.md")).unwrap();
        assert!(ensure_system_skills_installation_current_at(hamuna_dir).is_err());
    }

    #[test]
    fn version_gate_validation_detects_frozen_install() {
        // Lay down every platform-available system skill WITH a SKILL.md →
        // gate may early-return. Then blank one out → gate must bypass so the
        // (non-destructive) re-sync runs and self-heals.
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        for name in SYSTEM_SKILLS {
            if is_skill_blocked_on_platform(name) {
                continue;
            }
            let d = skills_dir.join(name);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("SKILL.md"), "x").unwrap();
        }
        assert!(
            all_installed_system_skills_complete(&skills_dir),
            "all SKILL.md present → install is complete"
        );

        // Freeze one into the empty-dir state seen in #321.
        let victim = SYSTEM_SKILLS
            .iter()
            .find(|n| !is_skill_blocked_on_platform(n))
            .expect("at least one platform-available system skill");
        fs::remove_file(skills_dir.join(victim).join("SKILL.md")).unwrap();
        assert!(
            !all_installed_system_skills_complete(&skills_dir),
            "a SKILL.md-less system skill must fail the gate so sync re-runs"
        );
    }

    #[test]
    fn missing_source_reports_missing_and_leaves_dst() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src/skill"); // never created
        let dst = tmp.path().join("dst/skill");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("SKILL.md"), "good").unwrap();
        let outcome = sync_one_system_skill(&src, &dst).unwrap();
        assert!(matches!(outcome, SystemSkillSync::SkippedMissingSource));
        assert_eq!(fs::read_to_string(dst.join("SKILL.md")).unwrap(), "good");
    }

    #[test]
    fn incomplete_source_preserves_existing_good_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src/skill");
        fs::create_dir_all(&src).unwrap(); // source exists but has NO SKILL.md
        fs::write(src.join("README.md"), "noise").unwrap();
        let dst = tmp.path().join("dst/skill");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("SKILL.md"), "good").unwrap();

        let outcome = sync_one_system_skill(&src, &dst).unwrap();
        assert!(matches!(outcome, SystemSkillSync::SkippedIncompleteSource));
        assert!(
            dst.join("SKILL.md").exists(),
            "an incomplete bundled source must NOT destroy the installed copy"
        );
        assert_eq!(fs::read_to_string(dst.join("SKILL.md")).unwrap(), "good");
    }

    #[test]
    fn valid_source_replaces_dst_wholesale() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src/skill");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("SKILL.md"), "new").unwrap();
        let dst = tmp.path().join("dst/skill");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("SKILL.md"), "old").unwrap();
        // A stale file under dst must be gone after a wholesale replace.
        fs::write(dst.join("stale.txt"), "stale").unwrap();

        let outcome = sync_one_system_skill(&src, &dst).unwrap();
        assert!(matches!(outcome, SystemSkillSync::Synced));
        assert_eq!(fs::read_to_string(dst.join("SKILL.md")).unwrap(), "new");
        assert!(
            !dst.join("stale.txt").exists(),
            "wholesale replace drops stale files"
        );
    }

    // === task #155: orphan cleanup pass ===

    /// Build a `SystemSkillsSnapshot` JSON on disk (mirrors the production
    /// write path's shape so the read path can parse it back).
    fn write_snapshot_for_test(hamuna_dir: &Path, version: &str, skills: &[&str]) {
        let snapshot = SystemSkillsSnapshot {
            version: version.to_string(),
            skills: skills.iter().map(|s| s.to_string()).collect(),
        };
        let json = serde_json::to_string_pretty(&snapshot).unwrap();
        fs::write(hamuna_dir.join(".system-skills-snapshot.json"), json).unwrap();
    }

    /// Lay down a fake `skills/<name>/SKILL.md` tree.
    fn install_fake_skill(skills_dir: &Path, name: &str) {
        let d = skills_dir.join(name);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("SKILL.md"), "x").unwrap();
    }

    #[test]
    fn orphan_removal_targets_only_names_in_snapshot_but_not_in_current_system_skills() {
        // Simulate: prior release shipped ["task-alignment", "fake-orphan"];
        // the current release drops "fake-orphan" from SYSTEM_SKILLS. User
        // has all three on disk + a `mycustom` user-installed dir.
        // Expect: fake-orphan removed (in snapshot, not in current
        // SYSTEM_SKILLS), task-alignment kept (still in current
        // SYSTEM_SKILLS), mycustom kept (not in snapshot = user-installed).
        //
        // We can't drive `sync_system_skills_blocking` directly (it needs
        // an AppHandle), so we simulate the orphan pass by writing a
        // snapshot, then calling only the helpers the pass uses
        // (read_system_skills_snapshot + the same iteration logic).
        let tmp = tempfile::tempdir().unwrap();
        let hamuna_dir = tmp.path();
        let skills_dir = hamuna_dir.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();

        for name in ["task-alignment", "fake-orphan", "mycustom"] {
            install_fake_skill(&skills_dir, name);
        }
        write_snapshot_for_test(hamuna_dir, "55", &["task-alignment", "fake-orphan"]);

        // Run the same per-entry decision the orphan pass runs.
        let snapshot = read_system_skills_snapshot(hamuna_dir).expect("snapshot should parse");
        let bundled: std::collections::HashSet<&str> = SYSTEM_SKILLS.iter().copied().collect();
        let mut to_remove: Vec<String> = Vec::new();
        for entry in fs::read_dir(&skills_dir).unwrap().flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            if name_str.starts_with('.') {
                continue;
            }
            if bundled.contains(name_str.as_str()) {
                continue;
            }
            if !snapshot.skills.iter().any(|s| s == &name_str) {
                continue;
            }
            to_remove.push(name_str);
        }
        for n in &to_remove {
            fs::remove_dir_all(skills_dir.join(n)).unwrap();
        }

        // fake-orphan removed; task-alignment + mycustom kept.
        assert!(
            !skills_dir.join("fake-orphan").exists(),
            "fake-orphan is bundled-originated orphan → removed"
        );
        assert!(
            skills_dir.join("task-alignment").exists(),
            "task-alignment still in SYSTEM_SKILLS → kept"
        );
        assert!(
            skills_dir.join("mycustom").exists(),
            "mycustom not in snapshot → user-installed → preserved"
        );
    }

    #[test]
    fn orphan_cleanup_skips_passes_when_snapshot_missing_or_corrupt() {
        // Pre-#155 installs have no snapshot file. Cleanup must skip (NOT
        // wipe user content) rather than treating every name as orphan.
        let tmp = tempfile::tempdir().unwrap();
        let hamuna_dir = tmp.path();
        let skills_dir = hamuna_dir.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        install_fake_skill(&skills_dir, "mycustom");

        // Missing snapshot → read_system_skills_snapshot returns Err;
        // the production pass bails on Err and skips the iteration.
        let result = read_system_skills_snapshot(hamuna_dir);
        assert!(
            result.is_err(),
            "missing snapshot must be reported as error"
        );
        assert!(skills_dir.join("mycustom").exists(), "user skill untouched");

        // Corrupt snapshot → also an error, also skip.
        fs::write(
            hamuna_dir.join(".system-skills-snapshot.json"),
            "not-json {",
        )
        .unwrap();
        let result = read_system_skills_snapshot(hamuna_dir);
        assert!(
            result.is_err(),
            "corrupt snapshot must be reported as error"
        );
        assert!(skills_dir.join("mycustom").exists(), "user skill untouched");
    }
}

// Path-safety blacklist (single source for validate_file_path + the cross-check
// test). cfg-gated so each platform compiles only its own list. MUST stay in
// sync with Node path-safety.ts and the shared fixture
// src/shared/path-safety-blacklist.json — see path_safety_crosscheck_tests.
#[cfg(windows)]
const FORBIDDEN_SYSTEM_DIRS: &[&str] = &[
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Recovery",
    "C:\\$Recycle.Bin",
];
#[cfg(all(not(windows), not(target_os = "macos")))]
const FORBIDDEN_SYSTEM_DIRS: &[&str] = &[
    "/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/root", "/sys", "/proc", "/dev",
];
// macOS symlinks /etc → /private/etc and /var → /private/var; block the canonical
// /private targets too so a literal /private/etc path can't slip the lexical check.
#[cfg(target_os = "macos")]
const FORBIDDEN_SYSTEM_DIRS: &[&str] = &[
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/root",
    "/sys",
    "/proc",
    "/dev",
    "/private/etc",
    "/private/var",
];
const CREDENTIAL_SUBDIRS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".config/op",
    ".hamuna/codex",
    ".hamuna/credentials",
];
#[cfg(target_os = "macos")]
const MAC_SENSITIVE_SUBDIRS: &[&str] = &[
    "Library/Keychains",
    "Library/Cookies",
    "Library/Mail",
    "Library/Messages",
    "Library/Safari",
];
#[cfg(windows)]
const WIN_SENSITIVE_SUBDIRS: &[&str] = &["AppData/Local/Microsoft"];

/// Validate that a file path does not target sensitive system or credential directories.
/// Resolves `..` components to prevent path traversal. Mirrors `isSafeReadPath()` in Bun.
///
/// `pub(crate)` so workspace_files::path_safety can reuse the exact same blacklist —
/// duplicating it would be a pit-of-failure (two places to update for new credential dirs).
#[cfg(any(windows, test))]
fn normalize_windows_security_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    let windows = raw.replace('/', r"\");
    let folded = windows.to_lowercase();
    if folded.starts_with(r"\\?\unc\") {
        return PathBuf::from(format!(r"\\{}", &windows[8..]));
    }
    if folded.starts_with(r"\\?\") {
        return PathBuf::from(&windows[4..]);
    }
    path.to_path_buf()
}

pub(crate) fn normalize_security_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        return normalize_windows_security_path(&path);
    }
    #[cfg(not(windows))]
    {
        path
    }
}

#[cfg(any(windows, test))]
fn normalize_windows_path_identity(path: &Path) -> String {
    normalize_windows_security_path(path)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn path_starts_with_identity(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = normalize_windows_path_identity(path);
        let root = normalize_windows_path_identity(root);
        return candidate == root
            || candidate
                .strip_prefix(&root)
                .is_some_and(|rest| rest.starts_with('/'));
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

fn reject_blacklisted_path(resolved: &Path) -> Result<(), String> {
    let home = dirs::home_dir().unwrap_or_default();

    for dir in FORBIDDEN_SYSTEM_DIRS {
        if path_starts_with_identity(resolved, Path::new(dir)) {
            return Err("Access denied: protected system directory".to_string());
        }
    }

    if !home.as_os_str().is_empty() {
        for name in CREDENTIAL_SUBDIRS {
            if path_starts_with_identity(resolved, &home.join(name)) {
                return Err("Access denied: protected credential directory".to_string());
            }
        }

        #[cfg(target_os = "macos")]
        for name in MAC_SENSITIVE_SUBDIRS {
            if path_starts_with_identity(resolved, &home.join(name)) {
                return Err("Access denied: protected system directory".to_string());
            }
        }

        #[cfg(windows)]
        for name in WIN_SENSITIVE_SUBDIRS {
            if path_starts_with_identity(resolved, &home.join(name)) {
                return Err("Access denied: protected system directory".to_string());
            }
        }
    }

    Ok(())
}

fn resolve_nearest_existing_path_identity(path: &Path) -> Option<PathBuf> {
    let mut ancestor = path.to_path_buf();
    let mut suffix = Vec::new();
    loop {
        if let Ok(canonical) = fs::canonicalize(&ancestor) {
            let mut resolved = normalize_security_path(canonical);
            for component in suffix.iter().rev() {
                resolved.push(component);
            }
            return Some(resolved);
        }
        let name = ancestor.file_name()?.to_os_string();
        suffix.push(name);
        ancestor = ancestor.parent()?.to_path_buf();
    }
}

pub(crate) fn validate_file_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = normalize_security_path(PathBuf::from(raw_path));

    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    // Resolve .. and . components without requiring the file to exist
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            std::path::Component::CurDir => {}
            _ => resolved.push(component),
        }
    }

    reject_blacklisted_path(&resolved)?;
    if let Some(real_identity) = resolve_nearest_existing_path_identity(&resolved) {
        reject_blacklisted_path(&real_identity)?;
    }

    Ok(resolved)
}

#[cfg(test)]
mod path_safety_crosscheck_tests {
    use super::{normalize_windows_path_identity, CREDENTIAL_SUBDIRS, FORBIDDEN_SYSTEM_DIRS};
    use serde_json::Value;

    // Rust side of the Node↔Rust blacklist cross-check (PRD 0.2.15 §7.2). Asserts
    // the lists THIS platform compiled equal the shared fixture; the Node test
    // (path-safety-crosscheck.unit.test.ts) covers every platform's list. Change
    // a list without the fixture → one of the two sides fails.
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../src/shared/path-safety-blacklist.json"))
            .expect("path-safety-blacklist.json parses")
    }
    fn arr(v: &Value, key: &str) -> Vec<String> {
        v[key]
            .as_array()
            .unwrap_or_else(|| panic!("fixture.{key} must be an array"))
            .iter()
            .map(|x| x.as_str().expect("fixture entry is a string").to_string())
            .collect()
    }

    #[test]
    fn credential_subdirs_match_fixture() {
        let owned: Vec<String> = CREDENTIAL_SUBDIRS.iter().map(|s| s.to_string()).collect();
        assert_eq!(owned, arr(&fixture(), "credentialSubdirs"));
    }

    #[test]
    fn system_dirs_match_fixture_for_this_platform() {
        let f = fixture();
        #[cfg(windows)]
        let expected = arr(&f, "systemDirsWindows");
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let expected = arr(&f, "systemDirsPosix");
        #[cfg(target_os = "macos")]
        let expected = {
            let mut v = arr(&f, "systemDirsPosix");
            v.extend(arr(&f, "systemDirsMacosExtra"));
            v
        };
        let owned: Vec<String> = FORBIDDEN_SYSTEM_DIRS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(owned, expected);
    }

    #[test]
    fn windows_path_identity_strips_verbatim_prefix_and_folds_case() {
        assert_eq!(
            normalize_windows_path_identity(std::path::Path::new(r"\\?\c:\WINDOWS\System32\")),
            "c:/windows/system32"
        );
        assert_eq!(
            normalize_windows_path_identity(std::path::Path::new(
                r"\\?\UNC\Server\Share\Users\Alice\.ssh\id_ed25519"
            )),
            "//server/share/users/alice/.ssh/id_ed25519"
        );
    }

    #[cfg(unix)]
    #[test]
    fn blacklist_rechecks_symlinked_existing_ancestor_identity() {
        let parent =
            crate::workspace_files::test_support::make_test_workspace("commands_path_alias");
        let alias = parent.join("system-alias");
        std::os::unix::fs::symlink("/etc", &alias).unwrap();

        assert!(super::validate_file_path(&alias.join("passwd").to_string_lossy()).is_err());
        assert!(
            super::validate_file_path(&alias.join("not-created-yet").to_string_lossy()).is_err()
        );

        let _ = std::fs::remove_file(alias);
        let _ = std::fs::remove_dir_all(parent);
    }

    #[cfg(windows)]
    #[test]
    fn windows_blacklist_rejects_case_and_verbatim_aliases() {
        assert!(super::validate_file_path(r"c:\windows\System32").is_err());
        assert!(super::validate_file_path(r"\\?\C:\WINDOWS\System32").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_sensitive_subdirs_match_fixture() {
        let owned: Vec<String> = super::MAC_SENSITIVE_SUBDIRS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(owned, arr(&fixture(), "macSensitiveSubdirs"));
    }

    #[cfg(windows)]
    #[test]
    fn win_sensitive_subdirs_match_fixture() {
        let owned: Vec<String> = super::WIN_SENSITIVE_SUBDIRS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(owned, arr(&fixture(), "winSensitiveSubdirs"));
    }
}

/// Read a workspace text file. Returns content if exists, null if not.
/// Bypasses Tauri fs plugin scope (which only covers ~/.hamuna).
#[tauri::command]
pub async fn cmd_read_workspace_file(path: String) -> Result<Option<String>, String> {
    let resolved = validate_file_path(&path)?;
    match tokio::fs::read_to_string(&resolved).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", path, e)),
    }
}

/// Write content to a workspace text file, creating parent directories if needed.
/// Bypasses Tauri fs plugin scope (which only covers ~/.hamuna).
#[tauri::command]
pub async fn cmd_write_workspace_file(path: String, content: String) -> Result<(), String> {
    let resolved = validate_file_path(&path)?;
    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    tokio::fs::write(&resolved, content)
        .await
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Delete a workspace file. Returns true if deleted, false if not found.
/// Bypasses Tauri fs plugin scope (which only covers ~/.hamuna).
#[tauri::command]
pub async fn cmd_delete_workspace_file(path: String) -> Result<bool, String> {
    let resolved = validate_file_path(&path)?;
    match tokio::fs::remove_file(&resolved).await {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Failed to delete {}: {}", path, e)),
    }
}

/// Read a local file and return its contents as base64.
/// Used by the audio player to create blob URLs without asset protocol scope issues.
#[tauri::command]
pub async fn cmd_read_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let resolved = validate_file_path(&path)?;
    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(BASE64.encode(&bytes))
}

/// Open a local file with the system default application.
/// Bypasses shell plugin URL-only scope restriction.
#[tauri::command]
pub async fn cmd_open_file(path: String) -> Result<(), String> {
    // Validate: path must resolve to an existing file (prevents opening arbitrary commands)
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Invalid path '{}': {}", path, e))?;
    if !canonical.is_file() {
        return Err(format!("Not a file: {}", canonical.display()));
    }
    let safe_path = canonical.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        crate::process_cmd::new("open")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Failed to open {}: {}", safe_path, e))?;
    }
    #[cfg(target_os = "windows")]
    {
        // Use explorer.exe instead of cmd /C start to avoid shell metacharacter injection
        crate::process_cmd::new("explorer")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Failed to open {}: {}", safe_path, e))?;
    }
    #[cfg(target_os = "linux")]
    {
        crate::process_cmd::new("xdg-open")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Failed to open {}: {}", safe_path, e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WeCom QR Code — generate & poll for bot credentials
// Uses the public WeCom QR API (same flow as @wecom/wecom-openclaw-cli).
// These are external HTTPS requests — use proxy_config for outbound proxy.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct WecomQrGenerateResult {
    pub scode: String,
    pub auth_url: String,
}

/// Generate a WeCom QR code for one-click bot creation.
/// Returns scode (for polling) and auth_url (to render as QR image).
#[tauri::command]
pub async fn cmd_wecom_qr_generate() -> Result<WecomQrGenerateResult, String> {
    let plat = if cfg!(target_os = "macos") {
        1
    } else if cfg!(target_os = "windows") {
        2
    } else {
        3
    };
    let url = format!(
        "https://work.weixin.qq.com/ai/qc/generate?source=hamuna&plat={}",
        plat
    );

    // External host (work.weixin.qq.com) — system proxy is wanted here.
    #[allow(clippy::disallowed_methods)]
    let builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15));
    let client = crate::proxy_config::build_client_with_proxy(builder)?;

    let resp: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("WeCom QR generate request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("WeCom QR generate parse failed: {}", e))?;

    // Check for API-level errors (same pattern as poll)
    let errcode = resp["errcode"].as_i64().unwrap_or(0);
    if errcode != 0 {
        let errmsg = resp["errmsg"].as_str().unwrap_or("unknown error");
        return Err(format!(
            "WeCom QR generate API error {}: {}",
            errcode, errmsg
        ));
    }

    let data = resp.get("data").ok_or("WeCom QR response missing 'data'")?;
    let scode = data["scode"]
        .as_str()
        .ok_or("WeCom QR response missing 'scode'")?
        .to_string();
    let auth_url = data["auth_url"]
        .as_str()
        .ok_or("WeCom QR response missing 'auth_url'")?
        .to_string();

    let scode_preview: String = scode.chars().take(8).collect();
    ulog_info!("[wecom-qr] Generated QR code, scode={}", scode_preview);
    Ok(WecomQrGenerateResult { scode, auth_url })
}

#[derive(serde::Serialize)]
pub struct WecomQrPollResult {
    /// "waiting" — user hasn't scanned yet; "success" — bot created, credentials available
    pub status: String,
    pub bot_id: Option<String>,
    pub secret: Option<String>,
}

/// Poll the WeCom QR scan result. Call repeatedly until status is "success".
/// `poll_index` is used for periodic logging (log every 10th poll to reduce noise).
#[tauri::command]
pub async fn cmd_wecom_qr_poll(
    scode: String,
    poll_index: Option<u32>,
) -> Result<WecomQrPollResult, String> {
    // Sanitize scode: only allow alphanumeric (defense-in-depth against URL injection)
    let safe_scode: String = scode.chars().filter(|c| c.is_alphanumeric()).collect();
    let url = format!(
        "https://work.weixin.qq.com/ai/qc/query_result?scode={}",
        safe_scode
    );

    // External host — system proxy wanted.
    #[allow(clippy::disallowed_methods)]
    let builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10));
    let client = crate::proxy_config::build_client_with_proxy(builder)?;

    let resp: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("WeCom QR poll failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("WeCom QR poll parse failed: {}", e))?;

    // Check for API-level errors first
    let errcode = resp["errcode"].as_i64().unwrap_or(0);
    if errcode != 0 {
        let errmsg = resp["errmsg"].as_str().unwrap_or("unknown error");
        ulog_error!("[wecom-qr] Poll API error {}: {}", errcode, errmsg);
        return Err(format!("WeCom QR poll API error {}: {}", errcode, errmsg));
    }

    let status_str = resp["data"]["status"].as_str().unwrap_or("waiting");
    let idx = poll_index.unwrap_or(0);

    match status_str {
        "success" => {
            let bot_info = &resp["data"]["bot_info"];
            let bot_id = bot_info["botid"].as_str().map(String::from);
            let secret = bot_info["secret"].as_str().map(String::from);
            if bot_id.is_some() && secret.is_some() {
                ulog_info!("[wecom-qr] QR scan success, bot created (poll #{})", idx);
                Ok(WecomQrPollResult {
                    status: "success".into(),
                    bot_id,
                    secret,
                })
            } else {
                // Log raw response for debugging unexpected format
                ulog_error!(
                    "[wecom-qr] Poll #{} status=success but bot_info incomplete: {}",
                    idx,
                    resp
                );
                Err("WeCom QR scan succeeded but bot_info is incomplete".into())
            }
        }
        "expired" | "cancelled" | "denied" => {
            ulog_info!("[wecom-qr] Poll #{} terminal status: {}", idx, status_str);
            Ok(WecomQrPollResult {
                status: status_str.into(),
                bot_id: None,
                secret: None,
            })
        }
        _ => {
            // Periodic logging: first poll, then every 10th
            if idx == 0 || idx % 10 == 0 {
                let scode_preview: String = safe_scode.chars().take(8).collect();
                ulog_info!(
                    "[wecom-qr] Poll #{} scode={} status={}",
                    idx,
                    scode_preview,
                    status_str
                );
            }
            Ok(WecomQrPollResult {
                status: "waiting".into(),
                bot_id: None,
                secret: None,
            })
        }
    }
}

// ============= Network Diagnostics =============

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProbeResult {
    pub ok: bool,
    pub stage: String,
    pub kind: String,
    pub message: String,
    pub detail: Option<String>,
    pub http_status: Option<u16>,
    pub url: String,
}

fn network_probe_result(
    ok: bool,
    stage: &str,
    kind: &str,
    message: impl Into<String>,
    detail: Option<String>,
    http_status: Option<u16>,
    url: impl Into<String>,
) -> NetworkProbeResult {
    NetworkProbeResult {
        ok,
        stage: stage.to_string(),
        kind: kind.to_string(),
        message: message.into(),
        detail,
        http_status,
        url: url.into(),
    }
}

fn is_loopback_http_url(url: &reqwest::Url) -> bool {
    match url.host_str() {
        Some(host) => {
            let normalized = host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_ascii_lowercase();
            if normalized == "localhost"
                || normalized == "localhost.localdomain"
                || normalized.ends_with(".localhost")
            {
                return true;
            }
            normalized
                .parse::<std::net::IpAddr>()
                .map(|ip| ip.is_loopback())
                .unwrap_or(false)
        }
        None => false,
    }
}

#[cfg(test)]
mod network_probe_tests {
    use super::is_loopback_http_url;

    fn parsed(url: &str) -> reqwest::Url {
        reqwest::Url::parse(url).expect("test URL parses")
    }

    #[test]
    fn detects_loopback_provider_urls() {
        assert!(is_loopback_http_url(&parsed("http://localhost:11434/v1")));
        assert!(is_loopback_http_url(&parsed("https://127.0.0.1:8443/v1")));
        assert!(is_loopback_http_url(&parsed("http://[::1]:8080/v1")));
        assert!(is_loopback_http_url(&parsed(
            "http://lmstudio.localhost:1234"
        )));
    }

    #[test]
    fn leaves_external_provider_urls_on_proxy_path() {
        assert!(!is_loopback_http_url(&parsed("https://api.example.com/v1")));
        assert!(!is_loopback_http_url(&parsed("http://192.168.1.2:8080/v1")));
    }
}

fn classify_reqwest_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        return "timeout";
    }

    let text = error.to_string().to_lowercase();
    if text.contains("dns") || text.contains("resolve") || text.contains("name or service") {
        return "dns_error";
    }
    if text.contains("certificate") || text.contains("tls") || text.contains("ssl") {
        return "tls_error";
    }
    if text.contains("proxy") || text.contains("socks") {
        return "proxy_error";
    }
    if error.is_connect() {
        return "connect_error";
    }
    if error.is_builder() {
        return "invalid_url";
    }

    "network_error"
}

async fn send_probe_request(
    client: &reqwest::Client,
    url: &str,
    stage: &str,
    failure_message: &str,
) -> NetworkProbeResult {
    match client
        .get(url)
        .header(reqwest::header::USER_AGENT, NETWORK_PROBE_USER_AGENT)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            network_probe_result(
                true,
                stage,
                "http_reachable",
                "网络连接正常",
                None,
                Some(status.as_u16()),
                url,
            )
        }
        Err(error) => network_probe_result(
            false,
            stage,
            classify_reqwest_error(&error),
            failure_message,
            Some(error.to_string()),
            None,
            url,
        ),
    }
}

/// Probe whether a provider base URL is reachable through the same proxy policy
/// used by external Rust HTTP requests. Any HTTP status means the network path
/// reached the provider; API-key validity is verified by the SDK in the next step.
#[tauri::command]
pub async fn cmd_probe_provider_network(
    url: String,
    provider_id: String,
) -> Result<NetworkProbeResult, String> {
    let parsed = match reqwest::Url::parse(&url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        Ok(_) => {
            return Ok(network_probe_result(
                false,
                "provider_http",
                "invalid_url",
                "供应商 Base URL 必须使用 http 或 https",
                None,
                None,
                url,
            ));
        }
        Err(error) => {
            return Ok(network_probe_result(
                false,
                "provider_http",
                "invalid_url",
                "供应商 Base URL 无效",
                Some(error.to_string()),
                None,
                url,
            ));
        }
    };

    let target_url = parsed.to_string();
    ulog_info!(
        "[network-probe] Probing provider URL {} provider={}",
        target_url,
        provider_id
    );

    let client = if is_loopback_http_url(&parsed) {
        match crate::local_http::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return Ok(network_probe_result(
                    false,
                    "provider_http",
                    "network_error",
                    "本地供应商探测客户端创建失败",
                    Some(error.to_string()),
                    None,
                    target_url,
                ));
            }
        }
    } else {
        #[allow(clippy::disallowed_methods)]
        let builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(5));
        match crate::proxy_config::build_client_with_proxy_for_provider(builder, &provider_id) {
            Ok(client) => client,
            Err(error) => {
                return Ok(network_probe_result(
                    false,
                    "provider_http",
                    "proxy_config_error",
                    "网络代理配置无效，请检查代理设置",
                    Some(error),
                    None,
                    target_url,
                ));
            }
        }
    };

    Ok(send_probe_request(
        &client,
        &target_url,
        "provider_http",
        "当前网络无法连接供应商，请检查网络或配置代理",
    )
    .await)
}

/// Probe the proxy settings currently shown in Settings. This intentionally
/// accepts explicit values instead of reading disk config so the UI can test
/// the user's latest committed protocol / host / port immediately.
#[tauri::command]
pub async fn cmd_probe_proxy(
    protocol: String,
    host: String,
    port: u16,
) -> Result<NetworkProbeResult, String> {
    let protocol = protocol.trim().to_lowercase();
    let host = host.trim().to_string();
    let proxy_url = format!("{}://{}:{}", protocol, host, port);

    if !matches!(protocol.as_str(), "http" | "https" | "socks5") {
        return Ok(network_probe_result(
            false,
            "local_proxy",
            "invalid_proxy",
            "代理协议无效，请选择 HTTP、HTTPS 或 SOCKS5",
            None,
            None,
            proxy_url,
        ));
    }
    if host.is_empty() || port == 0 {
        return Ok(network_probe_result(
            false,
            "local_proxy",
            "invalid_proxy",
            "代理地址或端口无效",
            None,
            None,
            proxy_url,
        ));
    }

    ulog_info!(
        "[network-probe] Probing proxy {} via {}",
        proxy_url,
        PROXY_CONNECTIVITY_TEST_URL
    );

    match tokio::time::timeout(
        Duration::from_millis(1500),
        tokio::net::TcpStream::connect((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(_stream)) => {}
        Ok(Err(error)) => {
            return Ok(network_probe_result(
                false,
                "local_proxy",
                "proxy_unreachable",
                "当前代理地址或端口没有检测到可用代理，请确认端口号与本地代理软件一致",
                Some(error.to_string()),
                None,
                proxy_url,
            ));
        }
        Err(_) => {
            return Ok(network_probe_result(
                false,
                "local_proxy",
                "timeout",
                "当前代理地址或端口连接超时，请确认端口号与本地代理软件一致",
                None,
                None,
                proxy_url,
            ));
        }
    }

    #[allow(clippy::disallowed_methods)]
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5));
    let proxy = match reqwest::Proxy::all(&proxy_url) {
        Ok(proxy) => proxy.no_proxy(reqwest::NoProxy::from_string(
            crate::proxy_config::LOCALHOST_NO_PROXY,
        )),
        Err(error) => {
            return Ok(network_probe_result(
                false,
                "local_proxy",
                "invalid_proxy",
                "代理配置无效，请检查协议、地址和端口",
                Some(error.to_string()),
                None,
                proxy_url,
            ));
        }
    };
    let client = match builder.proxy(proxy).build() {
        Ok(client) => client,
        Err(error) => {
            return Ok(network_probe_result(
                false,
                "local_proxy",
                "invalid_proxy",
                "代理客户端创建失败，请检查代理配置",
                Some(error.to_string()),
                None,
                proxy_url,
            ));
        }
    };

    let result = send_probe_request(
        &client,
        PROXY_CONNECTIVITY_TEST_URL,
        "external_http",
        "已检测到本地代理，但无法访问全球互联网，请检查代理软件节点或规则",
    )
    .await;

    if result.ok {
        Ok(network_probe_result(
            true,
            "external_http",
            "http_reachable",
            "代理可用，已能访问全球互联网",
            result.detail,
            result.http_status,
            PROXY_CONNECTIVITY_TEST_URL,
        ))
    } else {
        Ok(result)
    }
}

// ============= Model Discovery =============

/// Fetch provider model list via external API.
/// Returns raw JSON response — parsing is done in the frontend.
#[tauri::command]
pub async fn cmd_fetch_provider_models(
    url: String,
    provider_id: String,
    auth_header_name: String,
    auth_header_value: String,
    extra_headers: Option<HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    ulog_info!(
        "[model-discovery] Fetching models from {} provider={}",
        url,
        provider_id
    );

    // Determine if URL points to localhost — if so, use local_http (no proxy)
    // to avoid the system-proxy-intercepts-localhost bug. Otherwise, use the
    // provider-aware proxy client for external APIs.
    let parsed_url =
        reqwest::Url::parse(&url).map_err(|e| format!("Invalid model list URL: {}", e))?;
    let is_localhost = is_loopback_http_url(&parsed_url);

    let client = if is_localhost {
        crate::local_http::json_client(std::time::Duration::from_secs(15))
    } else {
        // External host branch — system proxy wanted.
        #[allow(clippy::disallowed_methods)]
        let builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15));
        crate::proxy_config::build_client_with_proxy_for_provider(builder, &provider_id)?
    };

    let mut request = client
        .get(&url)
        .header(&auth_header_name, &auth_header_value);

    if let Some(headers) = extra_headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    let response = request.send().await.map_err(|e| {
        ulog_error!("[model-discovery] Network error for {}: {}", url, e);
        format!("Network error: {}", e)
    })?;

    let status = response.status();
    if !status.is_success() {
        // Limit error body to ~2KB to avoid unbounded allocation (char-boundary safe for UTF-8)
        let body = response.text().await.unwrap_or_default();
        let truncated = match body.char_indices().nth(2048) {
            Some((byte_pos, _)) => &body[..byte_pos],
            None => &body,
        };
        ulog_error!("[model-discovery] HTTP {} from {}", status.as_u16(), url);
        return Err(format!("HTTP {}: {}", status.as_u16(), truncated));
    }

    let result = response.json::<serde_json::Value>().await.map_err(|e| {
        ulog_error!("[model-discovery] Invalid JSON from {}: {}", url, e);
        format!("Invalid JSON response: {}", e)
    })?;

    ulog_info!("[model-discovery] Success from {}", url);
    Ok(result)
}

// ============= Agent Runtime Detection (v0.1.59) =============

/// Runtime detection result for a single CLI
#[derive(serde::Serialize, Clone)]
pub struct RuntimeDetectionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Clone)]
struct RuntimeDetectionCache {
    detected_at: Instant,
    results: HashMap<String, RuntimeDetectionResult>,
}

const RUNTIME_DETECTION_CACHE_TTL: Duration = Duration::from_secs(30);
const RUNTIME_DETECTION_VERSION_TIMEOUT: Duration = Duration::from_secs(2);

struct RuntimeDetectionState {
    cache: Option<RuntimeDetectionCache>,
    in_progress: bool,
}

struct RuntimeDetectionGate {
    state: Mutex<RuntimeDetectionState>,
    done: Condvar,
}

enum RuntimeDetectionGateDecision {
    CacheHit(HashMap<String, RuntimeDetectionResult>),
    JoinInFlight,
    RunDetection,
}

static RUNTIME_DETECTION_GATE: OnceLock<RuntimeDetectionGate> = OnceLock::new();

fn should_use_runtime_detection_cache(now: Instant, cached_at: Instant, ttl: Duration) -> bool {
    now.saturating_duration_since(cached_at) < ttl
}

fn clone_runtime_detection_cache_results(
    cache: &RuntimeDetectionCache,
) -> HashMap<String, RuntimeDetectionResult> {
    cache.results.clone()
}

fn runtime_detection_gate() -> &'static RuntimeDetectionGate {
    RUNTIME_DETECTION_GATE.get_or_init(|| RuntimeDetectionGate {
        state: Mutex::new(RuntimeDetectionState {
            cache: None,
            in_progress: false,
        }),
        done: Condvar::new(),
    })
}

fn runtime_detection_gate_decision(
    gate: &RuntimeDetectionGate,
    now: Instant,
    ttl: Duration,
) -> RuntimeDetectionGateDecision {
    let mut state = match gate.state.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(cache) = state.cache.as_ref() {
        if should_use_runtime_detection_cache(now, cache.detected_at, ttl) {
            return RuntimeDetectionGateDecision::CacheHit(clone_runtime_detection_cache_results(
                cache,
            ));
        }
    }

    if state.in_progress {
        RuntimeDetectionGateDecision::JoinInFlight
    } else {
        state.in_progress = true;
        RuntimeDetectionGateDecision::RunDetection
    }
}

fn wait_for_runtime_detection_result(
    gate: &RuntimeDetectionGate,
) -> HashMap<String, RuntimeDetectionResult> {
    let mut state = match gate.state.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };

    while state.in_progress {
        state = match gate.done.wait(state) {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
    }

    state
        .cache
        .as_ref()
        .map(clone_runtime_detection_cache_results)
        .unwrap_or_else(run_runtime_detection)
}

fn finish_runtime_detection(
    gate: &RuntimeDetectionGate,
    detected_at: Instant,
    results: &HashMap<String, RuntimeDetectionResult>,
) {
    let mut state = match gate.state.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };
    state.cache = Some(RuntimeDetectionCache {
        detected_at,
        results: results.clone(),
    });
    state.in_progress = false;
    gate.done.notify_all();
}

fn run_runtime_detection() -> HashMap<String, RuntimeDetectionResult> {
    let mut results = HashMap::new();

    // Builtin is always available
    results.insert(
        "builtin".to_string(),
        RuntimeDetectionResult {
            installed: true,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            path: None,
        },
    );

    // Claude Code CLI
    results.insert("claude-code".to_string(), detect_cli("claude"));

    // Codex CLI
    results.insert("codex".to_string(), detect_cli("codex"));

    // Gemini CLI (v0.1.66)
    results.insert("gemini".to_string(), detect_cli("gemini"));

    results
}

/// Detect whether external Agent Runtime CLIs are installed.
///
/// async + spawn_blocking is LOAD-BEARING (not a perf tweak): detection spawns
/// `<cli> --version` per installed runtime (blocking process spawns — ~hundreds of
/// ms each for the JS CLIs), and the in-flight-join branch blocks waiting on the
/// running detection. A sync command runs all of that on the MAIN thread = the
/// WKWebView UI thread on macOS, freezing the UI ~0.5–1.5s on Launcher/Chat/Settings
/// mount for multi-runtime users. Same class as cmd_ensure_session_sidecar — see the
/// CLAUDE.md red-line "同步 Tauri 命令阻塞 → 冻结 WKWebView". The cache /
/// in-flight-join gate is preserved inside the blocking helper.
#[tauri::command]
pub async fn cmd_detect_runtimes() -> HashMap<String, RuntimeDetectionResult> {
    tauri::async_runtime::spawn_blocking(detect_runtimes_blocking)
        .await
        // spawn_blocking only errors if the task panics — fall back to empty
        // detections (renderer's default is all-not-installed) rather than crash.
        .unwrap_or_else(|_| HashMap::new())
}

fn detect_runtimes_blocking() -> HashMap<String, RuntimeDetectionResult> {
    let now = Instant::now();
    let gate = runtime_detection_gate();
    match runtime_detection_gate_decision(gate, now, RUNTIME_DETECTION_CACHE_TTL) {
        RuntimeDetectionGateDecision::CacheHit(results) => {
            emit_perf_trace(
                PerfTrace::new(PerfTraceName::Runtime, "detect_cache_hit")
                    .status("ok")
                    .count(results.len() as u64),
            );
            return results;
        }
        RuntimeDetectionGateDecision::JoinInFlight => {
            let start = trace_start();
            emit_perf_trace(PerfTrace::new(PerfTraceName::Runtime, "detect_join"));
            let results = wait_for_runtime_detection_result(gate);
            emit_perf_trace(
                PerfTrace::new(PerfTraceName::Runtime, "detect_join_done")
                    .duration_ms(elapsed_ms(start))
                    .status("ok")
                    .count(results.len() as u64),
            );
            return results;
        }
        RuntimeDetectionGateDecision::RunDetection => {}
    }

    let start = trace_start();
    emit_perf_trace(PerfTrace::new(PerfTraceName::Runtime, "detect_start"));

    let results = run_runtime_detection();

    emit_perf_trace(
        PerfTrace::new(PerfTraceName::Runtime, "detect_done")
            .duration_ms(elapsed_ms(start))
            .status("ok")
            .count(results.len() as u64),
    );

    finish_runtime_detection(gate, now, &results);

    results
}

fn detect_cli(binary_name: &str) -> RuntimeDetectionResult {
    match crate::system_binary::find(binary_name) {
        Some(path) => {
            let version = detect_cli_version(&path);
            RuntimeDetectionResult {
                installed: true,
                version,
                path: Some(path.to_string_lossy().to_string()),
            }
        }
        None => RuntimeDetectionResult {
            installed: false,
            version: None,
            path: None,
        },
    }
}

fn detect_cli_version(path: &Path) -> Option<String> {
    // MUST use process_cmd::new() to prevent Windows console flash.
    let mut cmd = crate::process_cmd::new(path);
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    crate::proxy_config::apply_to_subprocess(&mut cmd);

    let start = Instant::now();
    let mut child = cmd.spawn().ok()?;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if status.success() {
                    return String::from_utf8(output.stdout)
                        .ok()
                        .map(|s| s.trim().to_string());
                }
                return None;
            }
            Ok(None) => {
                if start.elapsed() >= RUNTIME_DETECTION_VERSION_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod runtime_detection_cache_tests {
    use super::*;

    #[test]
    fn runtime_detection_cache_hit_within_ttl() {
        let cached_at = Instant::now();
        let now = cached_at + Duration::from_secs(29);
        assert!(should_use_runtime_detection_cache(
            now,
            cached_at,
            Duration::from_secs(30),
        ));
    }

    #[test]
    fn runtime_detection_cache_miss_after_ttl() {
        let cached_at = Instant::now();
        let now = cached_at + Duration::from_secs(30);
        assert!(!should_use_runtime_detection_cache(
            now,
            cached_at,
            Duration::from_secs(30),
        ));
    }

    #[test]
    fn runtime_detection_cache_returns_clone_not_shared_map() {
        let mut results = HashMap::new();
        results.insert(
            "codex".to_string(),
            RuntimeDetectionResult {
                installed: true,
                version: Some("1".to_string()),
                path: Some("/bin/codex".to_string()),
            },
        );
        let cache = RuntimeDetectionCache {
            detected_at: Instant::now(),
            results,
        };

        let mut cloned = clone_runtime_detection_cache_results(&cache);
        cloned.insert(
            "gemini".to_string(),
            RuntimeDetectionResult {
                installed: false,
                version: None,
                path: None,
            },
        );

        assert!(cache.results.contains_key("codex"));
        assert!(!cache.results.contains_key("gemini"));
    }

    fn test_gate() -> RuntimeDetectionGate {
        RuntimeDetectionGate {
            state: Mutex::new(RuntimeDetectionState {
                cache: None,
                in_progress: false,
            }),
            done: Condvar::new(),
        }
    }

    fn test_detection_result() -> RuntimeDetectionResult {
        RuntimeDetectionResult {
            installed: true,
            version: Some("1.0.0".to_string()),
            path: Some("/bin/codex".to_string()),
        }
    }

    #[test]
    fn runtime_detection_gate_first_miss_runs_detection() {
        let gate = test_gate();
        match runtime_detection_gate_decision(&gate, Instant::now(), Duration::from_secs(30)) {
            RuntimeDetectionGateDecision::RunDetection => {}
            _ => panic!("expected first cold miss to run detection"),
        }
        let state = gate.state.lock().unwrap();
        assert!(state.in_progress);
    }

    #[test]
    fn runtime_detection_gate_concurrent_miss_joins_in_flight_detection() {
        let gate = test_gate();
        assert!(matches!(
            runtime_detection_gate_decision(&gate, Instant::now(), Duration::from_secs(30)),
            RuntimeDetectionGateDecision::RunDetection
        ));
        assert!(matches!(
            runtime_detection_gate_decision(&gate, Instant::now(), Duration::from_secs(30)),
            RuntimeDetectionGateDecision::JoinInFlight
        ));
    }

    #[test]
    fn runtime_detection_gate_cache_hit_returns_clone() {
        let gate = test_gate();
        let mut results = HashMap::new();
        results.insert("codex".to_string(), test_detection_result());
        finish_runtime_detection(&gate, Instant::now(), &results);

        match runtime_detection_gate_decision(&gate, Instant::now(), Duration::from_secs(30)) {
            RuntimeDetectionGateDecision::CacheHit(mut cached) => {
                cached.remove("codex");
                let state = gate.state.lock().unwrap();
                assert!(state.cache.as_ref().unwrap().results.contains_key("codex"));
            }
            _ => panic!("expected cache hit"),
        }
    }
}

#[cfg(test)]
mod miniapp_tests {
    use super::{
        collect_snapshot, inline_miniapp_siblings, is_safe_app_id, is_safe_run_id,
        miniapp_root_dir, normalize_app_data_workspace, resolve_miniapp_agent_workspace,
        validate_miniapp_relative_path, CreateMiniAppRequest,
    };
    use std::collections::HashMap;
    use std::fs;

    #[test]
    fn app_id_kebab_case_only() {
        assert!(is_safe_app_id("hello-miniapp"));
        assert!(is_safe_app_id("a"));
        assert!(is_safe_app_id("icon-generator-v2"));
        assert!(is_safe_app_id("123"));
        // uppercase / underscore / dot / leading-or-trailing dash rejected
        assert!(!is_safe_app_id("Hello"));
        assert!(!is_safe_app_id("hello_mini"));
        assert!(!is_safe_app_id("hello.mini"));
        assert!(!is_safe_app_id("-foo"));
        assert!(!is_safe_app_id("foo-"));
        assert!(!is_safe_app_id(""));
        assert!(!is_safe_app_id(&"a".repeat(65)));
    }

    #[test]
    fn relative_path_rejects_traversal_and_absolute() {
        // Happy paths
        assert!(validate_miniapp_relative_path("meta.json").is_ok());
        assert!(validate_miniapp_relative_path("source/index.html").is_ok());
        assert!(validate_miniapp_relative_path("source/./ui.js").is_ok());
        // Rejects
        assert!(validate_miniapp_relative_path("").is_err());
        assert!(validate_miniapp_relative_path("../etc/passwd").is_err());
        assert!(validate_miniapp_relative_path("/etc/passwd").is_err());
        assert!(validate_miniapp_relative_path("source\\..\\evil").is_err());
    }

    #[test]
    fn run_id_kebab_case_only() {
        assert!(is_safe_run_id("r1"));
        assert!(is_safe_run_id("run-7"));
        assert!(is_safe_run_id("a1-b2-c3"));
        // 与 appId 同一套字符规则：'/' 与 '.' 会让拼出来的路径跳出 miniapps/。
        assert!(!is_safe_run_id("Hello"));
        assert!(!is_safe_run_id("run_7"));
        assert!(!is_safe_run_id("run.7"));
        assert!(!is_safe_run_id("run/7"));
        assert!(!is_safe_run_id("-run"));
        assert!(!is_safe_run_id("run-"));
        assert!(!is_safe_run_id(""));
        assert!(!is_safe_run_id(&"a".repeat(65)));
        // 冒号是 owner token `miniapp-agent:<appId>:<runId>` 的分隔符，放进来
        // 会让 sidecar::types 的解析撞车，所以比 appId 多这一条。
        assert!(!is_safe_run_id("run:7"));
    }

    // ─── 沙箱第一跳：拼出来的 workspace 必须在 miniapps/ 之内 ──────────
    //
    // MiniApp 沙箱不靠 per-turn 参数，而是靠 `cmd_miniapp_ensure_session` 把
    // `--agent-dir` 设成 `miniapps/<appId>`：sidecar 与 appdata 是 1:1 的，
    // builtin adapter 的进程级 agentDir 于是天然落在沙箱里。
    //
    // 所以这一跳是整条约束的承重墙 —— appId 一旦能带 '/' 或 '..'，Agent 的
    // cwd 就直接落在用户的真实工作区上，而它带工具、`acceptEdits` 允许文件
    // 编辑自动落盘。上面的字符表测试隐含地挡住了它，但那是**推出来的**；
    // 这里直接断言被推导出来的那个性质：接受 ⇒ 路径一定在 root 之内。
    //
    // 顺带把"拒绝"那一侧也钉住：不合法的 id 根本不该产生任何路径，而不是
    // 产生一个"看起来可疑但先用了再说"的路径。

    fn resolved_workspace_path(app_id: &str, run_id: &str) -> Option<std::path::PathBuf> {
        if !is_safe_app_id(app_id) || !is_safe_run_id(run_id) {
            return None;
        }
        // 与 cmd_miniapp_ensure_session 保持同一形状。
        let _session_id = format!("miniapp_{}_{}", app_id, run_id);
        miniapp_root_dir().ok().map(|root| root.join(app_id))
    }

    #[test]
    fn accepted_ids_resolve_inside_the_miniapps_root() {
        let root = miniapp_root_dir().expect("home dir");
        for (app_id, run_id) in [
            ("hello-miniapp", "r1"),
            ("a", "run-7"),
            ("icon-generator-v2", "a1-b2-c3"),
            ("123", "x"),
        ] {
            let path = resolved_workspace_path(app_id, run_id)
                .unwrap_or_else(|| panic!("{app_id}/{run_id} should be accepted"));
            assert!(
                path.starts_with(&root),
                "{app_id} resolved outside the miniapps root: {path:?}"
            );
            // 必须是 root 的**直接**子目录：多一层就说明 appId 偷偷带进了分隔符。
            assert_eq!(
                path.parent(),
                Some(root.as_path()),
                "{app_id} did not resolve to a direct child of the root"
            );
            assert_eq!(path.file_name().and_then(|s| s.to_str()), Some(app_id));
        }
    }

    #[test]
    fn rejected_ids_never_yield_a_workspace_path() {
        for bad in [
            "../escape",
            "..",
            "a/b",
            "a\\b",
            "C:evil",
            "Hello",
            "hello_mini",
            "hello.mini",
            "-lead",
            "trail-",
            "",
        ] {
            assert!(
                resolved_workspace_path(bad, "r1").is_none(),
                "{bad:?} must not resolve to a workspace path"
            );
        }
        // runId 同样参与判定：它虽然不进路径，但决定 session_id 与 owner token。
        assert!(resolved_workspace_path("ok-app", "run:7").is_none());
        assert!(resolved_workspace_path("ok-app", "../evil").is_none());
    }

    // ─── appDataWorkspace：Agent workspace 收窄到 appdata 里的一个子目录 ────
    //
    // 上面那组只锁住"appId 不许带分隔符"。`appDataWorkspace` 是作者**主动**传的
    // 子目录名，它拼出来的路径就是 Agent 的 cwd，所以这层要单独锁：判的是最终
    // 路径仍然是 `<miniapps>/<appId>` 的**直接**子目录 —— 多一层就是逃逸。
    //
    // 拒绝表还要与 shared 那份逐条同规则，两边各自是独立信任边界。

    #[test]
    fn accepted_segments_land_directly_under_the_apps_appdata() {
        let app_root = miniapp_root_dir().expect("home dir").join("seg-app");
        for segment in ["notes", "workspace", "a", "with space", "UPPER", "n-1"] {
            let path = resolve_miniapp_agent_workspace("seg-app", Some(segment))
                .unwrap_or_else(|e| panic!("{segment:?} should be accepted: {e}"));
            assert_eq!(path.parent(), Some(app_root.as_path()), "{segment:?} escaped");
            assert_eq!(path.file_name().and_then(|s| s.to_str()), Some(segment));
        }
        // 不传 = appdata 根（作者没挑子目录）。
        let root = resolve_miniapp_agent_workspace("seg-app", None).expect("root");
        assert_eq!(root, app_root);
        // 首尾空白按 TS 那份一样 trim 掉，而不是产生一个叫 " notes" 的目录。
        let trimmed = resolve_miniapp_agent_workspace("seg-app", Some("  notes  ")).expect("trim");
        assert_eq!(trimmed.file_name().and_then(|s| s.to_str()), Some("notes"));
        // 尾随空格是**归一**而不是拒绝 —— 它在 Win32 上本来就会被静默剥掉，
        // trim 之后两平台拿到的是同一个名字，没有别名可言。shared 那份曾有一条
        // `endsWith(' ')` 的拒绝分支，但它跑在 `raw.trim()` 之后，永远不成立，
        // 只会让人误以为尾随空格被拒。留在这里是为了把"归一"这个真实行为钉住。
        let space = resolve_miniapp_agent_workspace("seg-app", Some("trailing ")).expect("space");
        assert_eq!(space.file_name().and_then(|s| s.to_str()), Some("trailing"));
    }

    #[test]
    fn rejected_segments_never_reach_the_filesystem() {
        for bad in [
            "",              // 显式空串是"写了没意义的东西"，与不传区分开
            "   ",           // 全空白同理
            "..",
            ".",
            "../escape",     // 分隔符
            "a/b",
            "a\\b",
            "C:evil",
            "with\0null",
            "with\nnewline",
            ".hidden",       // 起始点会被 Win32 静默剥掉 → 别名到别的目录
            "trailing.",     // 同理，尾随点 trim 剥不掉，必须显式挡
            "con",           // 保留设备名
            "CON.txt",       // 判定看第一个点之前那段
            "LPT9",
            "nul",
        ] {
            assert!(
                resolve_miniapp_agent_workspace("seg-app", Some(bad)).is_err(),
                "{bad:?} must be rejected"
            );
        }
        // 超长名字多半是误传了一整条路径。
        assert!(resolve_miniapp_agent_workspace("seg-app", Some(&"x".repeat(65))).is_err());
        assert!(resolve_miniapp_agent_workspace("seg-app", Some(&"x".repeat(64))).is_ok());
    }

    #[test]
    fn console_is_a_directory_not_a_device() {
        // 判定必须是整段相等而不是前缀匹配 —— 早期的前缀写法会误杀 `console`。
        assert!(resolve_miniapp_agent_workspace("seg-app", Some("console")).is_ok());
        assert!(resolve_miniapp_agent_workspace("seg-app", Some("con")).is_err());
    }

    /// 直接断判定表本身。
    ///
    /// 为什么不靠上面那个路径级测试就够：路径级测试只看"被拒了没有"，而
    /// `normalize_app_data_workspace` 与 `resolve_miniapp_agent_workspace` 里的
    /// 直接子目录断言**会互相掩护** —— 拿掉判定表里的分隔符检查，父目录断言照样
    /// 兜住，反之亦然，两边返回同样的 Err。端到端层面分不出是谁拦的，所以
    /// 这里断**判定表自己**的每一条规则。
    ///
    /// 直接子目录断言因此是**兜底**而不是 chokepoint（与 sidecar 那层同款定位）：
    /// 它防的是"将来给判定表放宽了某个字符"变成路径逃逸，而不是今天就拦什么。
    #[test]
    fn the_validator_itself_enforces_every_rule() {
        // 放行
        for good in ["notes", "workspace", "a", "with space", "UPPER", "n-1", "console"] {
            assert_eq!(
                normalize_app_data_workspace(Some(good)),
                Ok(Some(good.to_string())),
                "{good:?} should be accepted verbatim"
            );
        }
        // 归一（不是拒绝）
        assert_eq!(
            normalize_app_data_workspace(Some("  notes  ")),
            Ok(Some("notes".to_string()))
        );
        assert_eq!(
            normalize_app_data_workspace(Some("trailing ")),
            Ok(Some("trailing".to_string()))
        );
        assert_eq!(normalize_app_data_workspace(None), Ok(None));
        // 拒绝：逐条对到 shared 那份，两边 MUST 同规则
        for bad in [
            "",
            "   ",
            "..",
            ".",
            "../escape",
            "a/b",
            "a\\b",
            "C:evil",
            "with\0null",
            "with\nnewline",
            "with\ttab",
            ".hidden",
            "trailing.",
            "con",
            "CON",
            "CON.txt",
            "lpt9",
            "nul",
        ] {
            assert!(
                normalize_app_data_workspace(Some(bad)).is_err(),
                "{bad:?} must be rejected by the validator itself"
            );
        }
        assert!(normalize_app_data_workspace(Some(&"x".repeat(65))).is_err());
        assert!(normalize_app_data_workspace(Some(&"x".repeat(64))).is_ok());
    }

    #[test]
    fn create_request_requires_five_keys() {
        let req = CreateMiniAppRequest {
            app_id: "icon-generator".to_string(),
            source: HashMap::from([("meta.json".to_string(), r#"{"id":"icon-generator"}"#.to_string())]),
        };
        assert!(req.source.contains_key("meta.json"));
        assert!(!req.source.contains_key("source/index.html"));
    }

    #[test]
    fn snapshot_collects_files_with_relative_paths() {
        // Smoke test: collect_snapshot on a non-existent path yields empty map.
        let collected = collect_snapshot(std::path::Path::new("/nonexistent/path/does/not/exist"));
        assert!(collected.is_empty());
    }

    // ─── inline_miniapp_siblings ────────────────────────────────────────
    // A MiniApp entry is mounted via iframe `srcdoc`, whose base URL is the
    // parent's, so `href="style.css"` / `src="ui.js"` never resolve. These
    // tests pin that the siblings get inlined and that nothing else is
    // touched — an over-eager rewrite would silently swallow a remote
    // stylesheet or follow a `..` out of the MiniApp directory.

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hamuna-inline-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn inlines_link_and_script_siblings() {
        let dir = scratch_dir("happy");
        fs::write(dir.join("style.css"), "body { color: red; }").unwrap();
        fs::write(dir.join("ui.js"), "console.log(1);").unwrap();
        let html = r#"<html><head><link rel="stylesheet" href="style.css" /></head><body><script src="ui.js"></script></body></html>"#;

        let out = inline_miniapp_siblings(html, &dir);

        assert!(
            out.contains("body { color: red; }"),
            "css not inlined: {out}"
        );
        assert!(out.contains("console.log(1);"), "js not inlined: {out}");
        assert!(!out.contains("<link"), "link tag survived: {out}");
        assert!(!out.contains("src="), "script src survived: {out}");
    }

    #[test]
    fn leaves_remote_absolute_and_missing_targets_alone() {
        let dir = scratch_dir("negative");
        for frag in [
            r#"<link rel="stylesheet" href="https://cdn.example.com/x.css">"#,
            r#"<link rel="stylesheet" href="//cdn.example.com/x.css">"#,
            r#"<link rel="stylesheet" href="/abs/x.css">"#,
            r#"<link rel="stylesheet" href="missing.css">"#,
        ] {
            assert_eq!(
                inline_miniapp_siblings(frag, &dir),
                frag,
                "should not have rewritten: {frag}"
            );
        }
    }

    #[test]
    fn refuses_to_follow_traversal_out_of_the_miniapp_dir() {
        let dir = scratch_dir("traversal");
        // The bait must sit OUTSIDE the MiniApp dir, otherwise the tag would be
        // left alone merely because the file is missing and the test proves
        // nothing about the traversal guard.
        let outside = dir.parent().unwrap().join("hamuna-inline-secret.css");
        fs::write(&outside, "SECRET").unwrap();
        let frag = r#"<link rel="stylesheet" href="../hamuna-inline-secret.css">"#;

        let out = inline_miniapp_siblings(frag, &dir);
        let _ = fs::remove_file(&outside);

        assert_eq!(out, frag, "traversal was followed: {out}");
        assert!(!out.contains("SECRET"));
    }

    #[test]
    fn handles_single_quotes_and_extra_attributes() {
        let dir = scratch_dir("attrs");
        fs::write(dir.join("ui.js"), "JS").unwrap();
        fs::write(dir.join("style.css"), "CSS").unwrap();

        let single = inline_miniapp_siblings(r#"<script src='ui.js'></script>"#, &dir);
        assert!(single.contains("JS"), "single quotes: {single}");

        let deferred = inline_miniapp_siblings(r#"<script defer src="ui.js"></script>"#, &dir);
        assert!(deferred.contains("JS"), "defer attr: {deferred}");

        // `data-href` must not be mistaken for `href`.
        let data_attr = inline_miniapp_siblings(
            r#"<link data-href="x" rel="stylesheet" href="style.css">"#,
            &dir,
        );
        assert!(
            data_attr.contains("CSS"),
            "data-href confusion: {data_attr}"
        );
    }

    #[test]
    fn preserves_markup_around_the_tags() {
        let dir = scratch_dir("preserve");
        fs::write(dir.join("ui.js"), "JS").unwrap();
        let html = "<!doctype html><html><head><title>T</title></head><body><p>hi</p><script src=\"ui.js\"></script></body></html>";

        let out = inline_miniapp_siblings(html, &dir);

        assert!(out.starts_with("<!doctype html>"));
        assert!(out.contains("<title>T</title>"));
        assert!(out.contains("<p>hi</p>"));
        assert!(out.ends_with("</body></html>"));
    }
}
