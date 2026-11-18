//! 彻底删除一个工作区。
//!
//! 「删除工作区」不是「从列表里划掉一行」。一个工作区在 App 里留下的东西都要
//! 一起走：定时任务（还会往已删目录里写）、Goal（还会自己往下轮）、会话、
//! 磁盘目录、浏览器 profile（登录态）、搜索索引（还留着已删文件的内容）。
//!
//! 拆成几处各做各的 = 一堆半吊子状态。所以这里做成**一条级联**，一次调用返回
//! 一份报告：删了什么、什么没删掉、为什么没删掉。没删掉的必须说 —— 假装删干净
//! 了比删一半更糟。
//!
//! 删除顺序是有依赖的：**先解除持有者，再删被持有的东西**。Goal / Task 保护着
//! 会话的「身份」（会话 id 不能在持有者还在用的时候被换掉），所以顺序是
//! 定时任务 → Goal → 会话 → 磁盘 → profile → 索引。顺序反了就会有一批会话
//! 因为「还有持有者」被跳过，留下新的孤儿 —— 那正是这个功能要根治的东西。

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

use crate::search::SearchEngine;
use crate::sidecar::session_lifecycle::{acquire_session_lifecycle, has_persisted_session_owner};
use crate::sidecar::{ManagedSidecarManager, SidecarOwner, GLOBAL_SIDECAR_ID};
use crate::workspace_path::normalize_workspace_path_identity;

/// 一条没删掉的东西 + 原因。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedItem {
    pub id: String,
    pub reason: String,
}

/// 级联删除的结果。`deleted_*` 是真删掉的，`skipped_*` 是没删掉的 + 原因。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteReport {
    pub deleted_sessions: Vec<String>,
    pub skipped_sessions: Vec<SkippedItem>,
    pub deleted_tasks: Vec<String>,
    pub skipped_tasks: Vec<SkippedItem>,
    pub cancelled_goals: Vec<String>,
    /// 磁盘目录是否已从原位消失（进回收站，或本来就不存在）。
    pub disk_deleted: bool,
    pub disk_path: String,
    /// 浏览器 profile（登录态）是否已删除。
    pub profile_deleted: bool,
    pub errors: Vec<String>,
}

/// 两个路径是不是同一个工作区。
///
/// 判**身份**（`normalize_workspace_path_identity`）而不是判字符串：Windows 上
/// `C:\work` 与 `c:/work/` 是同一个地方，raw `==` 会静默不相等（#320 那条红线
/// 在这里同样成立 —— 这是 Set/Map 键之外的又一个比较点）。
fn same_workspace(left: &str, right: &str) -> bool {
    let left = normalize_workspace_path_identity(left.trim());
    let right = normalize_workspace_path_identity(right.trim());
    !left.is_empty() && left == right
}

/// 拒绝删「删了就等于删掉整个 App」或「删了就等于删掉用户整个家目录」的路径。
///
/// 判的是**路径组件**（`Path::starts_with`），不是字符串形状：带盘符的路径、
/// `..` 绕回、末尾多一个斜杠，都要挡住。`canonicalize` 顺手把 `..` 和符号
/// 链接解掉了 —— 词法比较挡不住 `/home/me/.hamuna/..`。
///
/// 允许删的只有两类：`~/.hamuna` 之外的任何目录（用户自己的工作区），以及
/// `~/.hamuna/projects/` 里的子目录。`~/.hamuna` 内部别的东西（`sessions/`、
/// `config.json`、`kb/`…）是 App 自己的数据，不是工作区。
///
/// 错误串统一带 `workspace_guarded:` 前缀 —— 前端据此显示「这个路径不能删」
/// 而不是「失败，请重试」（重试永远不会成功）。
fn guard_deletable_workspace(target: &Path) -> Result<(), String> {
    let data_dir = crate::app_dirs::hamuna_data_dir().ok_or_else(|| {
        "workspace_guarded: cannot resolve ~/.hamuna, refusing to delete a workspace.".to_string()
    })?;
    let canonical_data = data_dir.canonicalize().unwrap_or(data_dir);
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace path {}: {}", target.display(), e))?;

    // 目标是 ~/.hamuna 的祖先（`/`、`~`、`/home`）→ 删它等于删掉整个 App。
    // `Path::starts_with` 对相等路径也返回 true，所以这条同时挡住 ~/.hamuna 本身。
    if canonical_data.starts_with(&canonical_target) {
        return Err(format!(
            "workspace_guarded: {} contains ~/.hamuna",
            canonical_target.display()
        ));
    }

    let projects_dir = canonical_data.join("projects");
    if canonical_target == projects_dir {
        return Err("workspace_guarded: ~/.hamuna/projects holds every workspace".to_string());
    }

    // 在 ~/.hamuna 里面、但不在 ~/.hamuna/projects 里面 → App 自己的数据。
    if canonical_target.starts_with(&canonical_data) && !canonical_target.starts_with(&projects_dir)
    {
        return Err(format!(
            "workspace_guarded: {} is inside ~/.hamuna but not a workspace directory",
            canonical_target.display()
        ));
    }

    Ok(())
}

/// 词法版的路径守卫，用于路径**不存在**时的兜底。
///
/// 路径不存在 = 磁盘上没东西可删，剩下的只是会话/任务清理。但守卫仍然要挡：
/// `~/.hamuna` 这个诊断项目本身是注册过的，删它的会话等于抹掉全局状态。
fn guard_workspace_identity(workspace_path: &str) -> Result<(), String> {
    let identity = normalize_workspace_path_identity(workspace_path.trim());
    if identity.is_empty() {
        return Err("Workspace path is empty".to_string());
    }
    let Some(data_dir) = crate::app_dirs::hamuna_data_dir() else {
        return Err(
            "workspace_guarded: cannot resolve ~/.hamuna, refusing to delete a workspace."
                .to_string(),
        );
    };
    let data_identity = normalize_workspace_path_identity(&data_dir.to_string_lossy());
    if identity == data_identity {
        return Err("workspace_guarded: ~/.hamuna holds the App's own data".to_string());
    }
    Ok(())
}

/// 把磁盘上的工作区目录移进系统回收站。
///
/// 用回收站而不是 `remove_dir_all`：工作区路径可以指向用户自己的任意目录
/// （`~/Documents/xxx`），不可恢复的递归删除一旦误操作就没了。回收站保留了
/// 「放回原处」，语义上仍然是「从原位消失」。
fn trash_workspace_dir(target: &Path) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("stat failed: {}", e)),
    };

    // 符号链接直接 unlink：删链接不删目标，而且 trash 的各后端对链接的处理
    // 跨平台不一致（与 workspace_files/delete.rs 同一个判断）。
    if metadata.is_symlink() {
        std::fs::remove_file(target).map_err(|e| format!("Failed to unlink link: {}", e))?;
        return Ok(true);
    }

    // Windows 上 canonicalize 会留下 `\\?\` 长路径前缀，trash 的后端不认。
    let target = crate::sidecar::normalize_external_path(target.to_path_buf());
    trash::delete(&target).map_err(|e| format!("Failed to move to trash: {}", e))?;
    Ok(true)
}

/// 解除一个会话自己的持有者，让它可以被删掉。
///
/// 工作区没了，会话就不能留着 —— 而持有者（开着的 Tab、正在收尾的后台完成、
/// 还有残留 owner 的任务 / Goal）会挡住删除。用户要的是「整个工作区消失」，
/// 所以这些持有者属于这个工作区自己的残留，必须一起走；留着它们 = 这批会话
/// 永远因为「还有持有者」被跳过，正是这个功能要根治的孤儿。
///
/// **Agent 持有者不动**：那是 IM 渠道正在跑的对话（用户可能在手机上刚发了一条），
/// 杀了会打断他。这种会话如实报告成「没删掉」，让用户知道还剩什么。
///
/// 返回 Err = 有不该由我们解除的持有者。
fn release_workspace_owners(
    manager: &mut crate::sidecar::SidecarManager,
    session_id: &str,
) -> Result<(), String> {
    let owners: Vec<SidecarOwner> = match manager.get_session_sidecar(session_id) {
        Some(sidecar) => sidecar.owners.iter().cloned().collect(),
        // 没有 sidecar = 没有持有者。
        None => return Ok(()),
    };
    if owners
        .iter()
        .any(|owner| matches!(owner, SidecarOwner::Agent(_)))
    {
        return Err("still in use by an IM channel".to_string());
    }
    for owner in owners {
        // 最后一个持有者被摘掉时 sidecar 进程随之停掉（Drop）。
        manager.remove_session_owner(session_id, &owner);
    }
    Ok(())
}

/// 删掉一批会话的物理转录（JSONL + 索引条目）。
///
/// 调用方必须**已经**持有这些会话的 lifecycle guard —— 「能不能删」是调用方的
/// 责任；这个函数只做「删得掉」的那部分：解除持有者 + 本地 HTTP DELETE + 解除激活。
/// guard 不能在函数内部再拿一次（`KeyedLifecycleRegistry` 的锁不可重入）。
///
/// 返回 (会话 id, 失败原因)；成功时原因是 None。
fn delete_session_transcripts(
    manager: &mut crate::sidecar::SidecarManager,
    session_ids: &[String],
) -> Vec<(String, Option<String>)> {
    let port = {
        let Some(instance) = manager.get_instance_mut(GLOBAL_SIDECAR_ID) else {
            return session_ids
                .iter()
                .map(|id| {
                    (
                        id.clone(),
                        Some("Global Sidecar is not running".to_string()),
                    )
                })
                .collect();
        };
        if !instance.is_running() {
            return session_ids
                .iter()
                .map(|id| {
                    (
                        id.clone(),
                        Some("Global Sidecar is not running".to_string()),
                    )
                })
                .collect();
        }
        instance.port
    };

    let client = match crate::local_http::blocking_builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return session_ids
                .iter()
                .map(|id| (id.clone(), Some(format!("HTTP client failed: {}", e))))
                .collect();
        }
    };

    let mut results = Vec::with_capacity(session_ids.len());
    for session_id in session_ids {
        if let Err(reason) = release_workspace_owners(manager, session_id) {
            results.push((session_id.clone(), Some(reason)));
            continue;
        }
        let response = client
            .delete(format!("http://127.0.0.1:{port}/sessions/{session_id}"))
            .send();
        match response {
            Ok(response) if response.status().is_success() => {
                manager.deactivate_session(session_id);
                results.push((session_id.clone(), None));
            }
            Ok(response) => {
                results.push((
                    session_id.clone(),
                    Some(format!("HTTP {}", response.status())),
                ));
            }
            Err(e) => {
                results.push((session_id.clone(), Some(e.to_string())));
            }
        }
    }
    results
}

/// 彻底删除一个工作区：定时任务 → Goal → 会话 → 磁盘目录 → 浏览器 profile →
/// 搜索索引。
///
/// 返回一份报告，逐项说明删了什么、什么没删掉。调用方（前端）据此给用户
/// 如实反馈 —— 没删掉的会话不会假装成已删除。
#[tauri::command]
#[allow(non_snake_case)]
pub async fn cmd_delete_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ManagedSidecarManager>,
    task_state: tauri::State<'_, crate::task::ManagedTaskStore>,
    thought_state: tauri::State<'_, crate::thought::ManagedThoughtStore>,
    workspacePath: String,
) -> Result<WorkspaceDeleteReport, String> {
    let workspace_path = workspacePath.trim().to_string();
    guard_workspace_identity(&workspace_path)?;

    let mut report = WorkspaceDeleteReport {
        disk_path: workspace_path.clone(),
        ..Default::default()
    };

    // ── 1. 定时任务 ────────────────────────────────────────────────────────
    // 必须最先删：Task 通过 `has_persistent_task_for_session` 保护着会话身份，
    // 任务还在 → 会话被判为「有持有者」→ 会话删不掉。
    let tasks = task_state
        .list(crate::task::TaskListFilter {
            include_managed: Some(true),
            ..Default::default()
        })
        .await;
    for task in tasks {
        if !same_workspace(&task.workspace_path, &workspace_path) {
            continue;
        }
        // 正在跑的 turn 会让 TaskStore::delete 拒绝删除 —— 先停。
        if let Err(e) = crate::task_scheduler::get_task_scheduler()
            .stop(&task.id)
            .await
        {
            crate::ulog_warn!("[workspace-delete] stopping task {} failed: {}", task.id, e);
        }
        let source_thought_id = task.source_thought_id.clone();
        match task_state.delete(&task.id).await {
            Ok(()) => {
                if let Some(thought_id) = source_thought_id {
                    if let Err(e) = thought_state.unlink_task(&thought_id, &task.id).await {
                        crate::ulog_warn!(
                            "[workspace-delete] unlink thought {} for task {} failed: {}",
                            thought_id,
                            task.id,
                            e
                        );
                    }
                }
                report.deleted_tasks.push(task.id.clone());
            }
            Err(e) => {
                report.skipped_tasks.push(SkippedItem {
                    id: task.id.clone(),
                    reason: e,
                });
            }
        }
    }

    // ── 2. Goal ───────────────────────────────────────────────────────────
    // 同样必须排在会话前面：非终态的 Goal 保护着会话身份。
    let goal_manager = crate::session_goal::get_session_goal_manager();
    match goal_manager.startup_snapshot().await {
        Ok(goals) => {
            for goal in goals {
                if !same_workspace(&goal.workspace_path, &workspace_path) {
                    continue;
                }
                match goal_manager
                    .cancel_goal_and_stop(&goal.id, Some("workspace deleted".to_string()))
                    .await
                {
                    Ok(_) => report.cancelled_goals.push(goal.id.clone()),
                    Err(e) => report
                        .errors
                        .push(format!("goal {} not cancelled: {}", goal.id, e)),
                }
            }
        }
        Err(e) => report.errors.push(format!("goal snapshot failed: {}", e)),
    }

    // ── 3. 会话 ───────────────────────────────────────────────────────────
    // 列举不过滤可见性：prepared / system-maintenance 这类会话恰恰是「只删看得
    // 见的会话」会漏掉的残留。
    let session_ids = crate::session_metadata::read_session_ids_for_agent_dir(&workspace_path)?;
    if !session_ids.is_empty() {
        let refs: Vec<&str> = session_ids.iter().map(String::as_str).collect();
        // lifecycle guard 一次拿全：整个清理过程中不允许新的 Task/Goal/Agent
        // 冒出来认领这些会话。
        let _lifecycle = acquire_session_lifecycle(&refs).await;

        let mut deletable: Vec<String> = Vec::with_capacity(session_ids.len());
        for session_id in &session_ids {
            match has_persisted_session_owner(session_id).await {
                Ok(true) => report.skipped_sessions.push(SkippedItem {
                    id: session_id.clone(),
                    reason: "protected by a task or goal".to_string(),
                }),
                Ok(false) => deletable.push(session_id.clone()),
                Err(e) => report.skipped_sessions.push(SkippedItem {
                    id: session_id.clone(),
                    reason: e,
                }),
            }
        }

        if !deletable.is_empty() {
            let sidecars = state.inner().clone();
            let results = tauri::async_runtime::spawn_blocking(move || {
                let mut manager = sidecars
                    .lock()
                    .map_err(|error| format!("Sidecar manager lock failed: {}", error))?;
                Ok::<Vec<(String, Option<String>)>, String>(delete_session_transcripts(
                    &mut manager,
                    &deletable,
                ))
            })
            .await
            .map_err(|error| format!("Session deletion task failed: {error:?}"))?;

            match results {
                Ok(results) => {
                    for (session_id, failure) in results {
                        match failure {
                            None => report.deleted_sessions.push(session_id),
                            Some(reason) => report.skipped_sessions.push(SkippedItem {
                                id: session_id,
                                reason,
                            }),
                        }
                    }
                }
                Err(e) => report.errors.push(e),
            }
        }
    }

    // ── 4. 磁盘目录 ───────────────────────────────────────────────────────
    let target = Path::new(&workspace_path);
    match target.canonicalize() {
        Ok(canonical) => match guard_deletable_workspace(&canonical) {
            Ok(()) => match trash_workspace_dir(&canonical) {
                Ok(deleted) => report.disk_deleted = deleted,
                Err(e) => report.errors.push(e),
            },
            Err(e) => report.errors.push(e),
        },
        // 目录已经不在了（孤儿会话的典型形态）—— 磁盘这步无事可做，不算失败。
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => report
            .errors
            .push(format!("cannot resolve {}: {}", target.display(), e)),
    }

    // ── 5. 浏览器 profile（登录态） ────────────────────────────────────────
    // profile 故意放在工作区外面（工作区可能被 git 同步），所以删工作区不会顺
    // 手带走它 —— 必须显式删，否则登录态留在一堆孤儿 cookie 里。
    //
    // 删除 = 「关掉占用它的标签页」+「删掉存储本身」。两件事都在 Rust 侧做：
    // 三个平台的存储形态不一样（macOS 是具名 WKWebsiteDataStore，Windows /
    // Linux 是独立目录），而且存储还被活着的 webview 占着时 WebKit / WebView2
    // 都会拒绝删除 —— renderer 那个「关掉这个工作区的标签页」事件是 fire-and-
    // forget，不等 teardown，靠它把关就会撞上「仍在使用中」。
    match app_handle.try_state::<Arc<crate::browser::BrowserManager>>() {
        Some(manager) => match crate::browser::delete_workspace_profile(
            &app_handle,
            manager.inner(),
            &workspace_path,
        )
        .await
        {
            Ok(()) => report.profile_deleted = true,
            Err(e) => report.errors.push(e),
        },
        None => report.errors.push(
            "browser manager unavailable: the saved logins of this workspace were not deleted"
                .to_string(),
        ),
    }

    // ── 6. 搜索索引 ───────────────────────────────────────────────────────
    // 索引里留着已删文件的内容 —— 不清就是一份「文件还在」的假象。
    //
    // SearchEngine 是**条件注册**的（初始化失败就没有这个 state），所以只能
    // try_state —— 直接声明 `State<Arc<SearchEngine>>` 会在搜索引擎起不来的
    // 机器上把整个删除命令变成 panic。
    if let Some(search_engine) = app_handle.try_state::<Arc<SearchEngine>>() {
        search_engine
            .invalidate_workspace_file_index(&workspace_path)
            .await;
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_workspace_ignores_separator_and_trailing_slash() {
        assert!(same_workspace("/home/me/work", "/home/me/work/"));
        assert!(!same_workspace("/home/me/work", "/home/me/other"));
        assert!(!same_workspace("", "/home/me/work"));
    }

    #[test]
    fn same_workspace_matches_windows_case_and_separator_variants() {
        assert!(same_workspace(r"C:\work\a", "c:/work/a"));
        assert!(same_workspace(r"C:\work\a\", r"C:\work\a"));
        assert!(!same_workspace(r"C:\work\a", r"D:\work\a"));
    }

    #[test]
    fn identity_guard_rejects_the_app_data_dir() {
        let data_dir = crate::app_dirs::hamuna_data_dir().unwrap();
        let identity = data_dir.to_string_lossy().to_string();
        assert!(guard_workspace_identity(&identity).is_err());
    }

    #[test]
    fn identity_guard_accepts_an_ordinary_workspace() {
        assert!(guard_workspace_identity("/home/me/some-workspace").is_ok());
    }

    /// 造一个带持有者的 sidecar —— 进程是个立刻退出的占位符，测试只关心
    /// owner 的增删。
    fn manager_with_owners(
        session_id: &str,
        owners: Vec<SidecarOwner>,
    ) -> crate::sidecar::SidecarManager {
        use std::collections::HashSet;
        use std::path::PathBuf;
        use std::process::Stdio;
        use std::time::Instant;

        #[cfg(windows)]
        let mut command = {
            let mut command = crate::process_cmd::new("cmd");
            command.args(["/C", "exit", "0"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = crate::process_cmd::new("true");

        let mut process = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test sidecar placeholder");
        process.wait().expect("reap test sidecar placeholder");

        let mut manager = crate::sidecar::SidecarManager::new();
        manager.insert_sidecar(
            session_id,
            crate::sidecar::SessionSidecar {
                process,
                port: 1234,
                session_id: session_id.to_string(),
                workspace_path: PathBuf::from("/tmp/workspace"),
                state: crate::sidecar::SidecarState::Healthy,
                owners: HashSet::from_iter(owners),
                created_at: Instant::now(),
                runtime: None,
                runtime_source: None,
            },
        );
        manager
    }

    #[test]
    fn releasing_a_tab_owner_lets_the_conversation_go() {
        let mut manager =
            manager_with_owners("session-1", vec![SidecarOwner::Tab("tab-1".to_string())]);

        assert!(release_workspace_owners(&mut manager, "session-1").is_ok());
        // 最后一个持有者被摘掉 → sidecar 一起消失。
        assert!(manager.get_session_sidecar("session-1").is_none());
    }

    #[test]
    fn an_im_channel_keeps_its_conversation() {
        let mut manager = manager_with_owners(
            "session-2",
            vec![SidecarOwner::Agent("agent:1:telegram:dm:7".to_string())],
        );

        let reason = release_workspace_owners(&mut manager, "session-2").unwrap_err();
        assert!(reason.contains("IM channel"));
        // 持有者原封不动 —— 用户可能刚在手机上发了一条。
        assert!(manager.session_has_owners("session-2"));
    }

    #[test]
    fn a_session_without_a_sidecar_has_nothing_to_release() {
        let mut manager = crate::sidecar::SidecarManager::new();
        assert!(release_workspace_owners(&mut manager, "session-3").is_ok());
    }
}
