use super::*;

/// Whether this process may still CREATE sidecars / resources.
///
/// Plain `bool` was not enough: a guard that dropped *after* app exit had
/// begun would reset the flag to `false` and silently reopen the spawn gate
/// in the middle of a shutdown — letting a new sidecar appear while
/// `ExitRequested` cleanup is still tearing everything down. `Exited` is
/// terminal: once set, nothing lowers it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SpawnGateState {
    /// Normal operation. Spawning allowed.
    Open,
    /// An update shutdown holds the gate. Spawning refused.
    UpdateQuiescing,
    /// The app is exiting. Terminal — never returns to `Open`.
    Exited,
}

static SPAWN_GATE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

fn gate_from_u8(raw: u8) -> SpawnGateState {
    match raw {
        1 => SpawnGateState::UpdateQuiescing,
        2 => SpawnGateState::Exited,
        _ => SpawnGateState::Open,
    }
}

pub fn spawn_gate_state() -> SpawnGateState {
    gate_from_u8(SPAWN_GATE.load(std::sync::atomic::Ordering::SeqCst))
}

/// Mark the process as exiting. Idempotent, and irreversible on purpose: no
/// later drop may reopen process/resource birth.
pub fn close_spawn_gate_for_exit() {
    // An unconditional terminal store, NOT a compare-exchange from `Open`:
    // app exit can land while an update shutdown already holds the gate, and
    // in that case a 0→2 exchange would silently no-op, leaving the process
    // permanently marked "update quiescing" with no way back to Open.
    SPAWN_GATE.store(2, std::sync::atomic::Ordering::SeqCst);
}

/// Test-only: restore the gate. Production never lowers `Exited`.
#[cfg(test)]
fn reset_spawn_gate_for_test() {
    SPAWN_GATE.store(0, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut state) = UPDATE_QUIESCE.state.lock() {
        state.update_requested = false;
        state.active_creations = 0;
    }
}

static UPDATE_QUIESCE: std::sync::LazyLock<UpdateQuiesce> =
    std::sync::LazyLock::new(UpdateQuiesce::default);

#[derive(Default)]
struct UpdateQuiesce {
    state: std::sync::Mutex<UpdateQuiesceState>,
    idle: std::sync::Condvar,
}

#[derive(Default)]
struct UpdateQuiesceState {
    update_requested: bool,
    active_creations: usize,
}

pub struct UpdateShutdownGuard {
    active: bool,
}

pub struct UpdateSpawnPermit {
    active: bool,
}

impl Drop for UpdateShutdownGuard {
    fn drop(&mut self) {
        if self.active {
            if let Ok(mut state) = UPDATE_QUIESCE.state.lock() {
                state.update_requested = false;
                // App exit is terminal. A guard that happens to drop after
                // ExitRequested must NOT reopen process/resource birth — only
                // clear the update-quiesce bit, and leave `Exited` in place.
                let _ = SPAWN_GATE.compare_exchange(
                    1,
                    0,
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::SeqCst,
                );
                UPDATE_QUIESCE.idle.notify_all();
            } else {
                let _ = SPAWN_GATE.compare_exchange(
                    1,
                    0,
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::SeqCst,
                );
            }
            ulog_info!("[sidecar] Update shutdown gate released");
        }
    }
}

impl Drop for UpdateSpawnPermit {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Ok(mut state) = UPDATE_QUIESCE.state.lock() {
            state.active_creations = state.active_creations.saturating_sub(1);
            if state.active_creations == 0 {
                UPDATE_QUIESCE.idle.notify_all();
            }
        }
    }
}

pub fn begin_update_spawn_permit() -> Result<UpdateSpawnPermit, String> {
    match spawn_gate_state() {
        SpawnGateState::Exited => return Err("APP_EXITING".to_string()),
        SpawnGateState::UpdateQuiescing => return Err("UPDATE_SHUTDOWN_IN_PROGRESS".to_string()),
        SpawnGateState::Open => {}
    }
    let mut state = UPDATE_QUIESCE.state.lock().map_err(|e| e.to_string())?;
    if state.update_requested {
        return Err("UPDATE_SHUTDOWN_IN_PROGRESS".to_string());
    }
    state.active_creations += 1;
    Ok(UpdateSpawnPermit { active: true })
}

pub fn begin_update_shutdown() -> Result<UpdateShutdownGuard, String> {
    if spawn_gate_state() == SpawnGateState::Exited {
        return Err("APP_EXITING".to_string());
    }
    let mut state = UPDATE_QUIESCE.state.lock().map_err(|e| e.to_string())?;
    if state.update_requested {
        return Err("UPDATE_SHUTDOWN_ALREADY_IN_PROGRESS".to_string());
    }
    state.update_requested = true;
    SPAWN_GATE.store(1, std::sync::atomic::Ordering::SeqCst);
    while state.active_creations > 0 {
        ulog_info!(
            "[sidecar] Waiting for {} owner creation(s) before update shutdown",
            state.active_creations
        );
        state = match UPDATE_QUIESCE.idle.wait(state) {
            Ok(state) => state,
            Err(err) => {
                let mut state = err.into_inner();
                state.update_requested = false;
                let _ = SPAWN_GATE.compare_exchange(
                    1,
                    0,
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::SeqCst,
                );
                UPDATE_QUIESCE.idle.notify_all();
                return Err("UPDATE_SHUTDOWN_GATE_POISONED".to_string());
            }
        };
    }
    ulog_info!("[sidecar] Update shutdown gate acquired");
    Ok(UpdateShutdownGuard { active: true })
}

pub fn is_update_shutdown_in_progress() -> bool {
    spawn_gate_state() == SpawnGateState::UpdateQuiescing
}

/// Stop all sidecar instances and clean up child processes
/// This should be called when the app is closing
pub fn stop_all_sidecars(manager: &ManagedSidecarManager) -> Result<(), String> {
    ulog_info!("[sidecar] Stopping all sidecars and cleaning up child processes...");

    // 1. Stop all managed sidecar instances (kills bun sidecars via Drop)
    let mut manager_guard = manager.lock().map_err(|e| e.to_string())?;
    manager_guard.stop_all();
    drop(manager_guard);

    // 2. Clean up any orphaned child processes (SDK and MCP)
    // This is necessary because SDK spawns child processes that don't die
    // when the parent bun sidecar is killed
    cleanup_child_processes();

    Ok(())
}

/// Shutdown for update — block until all child processes are fully terminated.
/// Unlike stop_all_sidecars (which is non-blocking), this function waits for
/// all bun/SDK/MCP processes to exit, preventing NSIS installer file-lock errors on Windows.
pub fn shutdown_for_update_verified<R: Runtime>(
    app_handle: &AppHandle<R>,
    manager: &ManagedSidecarManager,
) -> Result<(), String> {
    let protected_roots = update_protected_roots(app_handle);
    shutdown_for_update_inner(manager, &protected_roots)?;
    wait_for_update_file_locks(app_handle)?;
    Ok(())
}

fn shutdown_for_update_inner(
    manager: &ManagedSidecarManager,
    protected_roots: &[PathBuf],
) -> Result<(), String> {
    ulog_info!("[sidecar] Shutdown for update: stopping all processes...");

    // 1. Stop all sidecar instances (via Drop → kill_process → taskkill /T /F)
    stop_all_sidecars(manager)?;

    // 2. Actively kill orphan processes that may survive sidecar tree-kill
    //    (e.g., node.exe from bundled npx — cmd.exe intermediate layers break process tree)
    #[cfg(windows)]
    {
        cleanup_child_processes();
    }

    // 3. Wait for all related processes to truly exit. Uses the same
    //    sysinfo-backed process scan as startup cleanup — no PowerShell
    //    subprocesses, no cmd-line-escaping edge cases, consistent
    //    behavior across Windows and Unix.
    let max_wait = Duration::from_secs(20);
    let start = std::time::Instant::now();
    let mut sleep_ms = 100u64;
    let mut residual_pids: Vec<u32> = Vec::new();
    loop {
        // Update path MUST verify our own sidecars (SIDECAR_MARKER) too —
        // NSIS can't overwrite `node.exe` (the v0.2.0+ bundled sidecar runtime)
        // while it's in use, so we need confirmation that every
        // HamunaAgent-related process is gone. Uses STARTUP patterns (superset
        // that includes the sidecar marker).
        let matches = crate::process_cleanup::find_matching_processes_with_roots(
            STARTUP_CLEANUP_PATTERNS,
            protected_roots,
        );
        let residual_matches = crate::process_cleanup::find_live_processes_by_pid(&residual_pids);
        residual_pids = residual_matches.iter().map(|m| m.pid).collect();
        if matches.is_empty() && residual_matches.is_empty() {
            ulog_info!(
                "[sidecar] All processes terminated in {:?}",
                start.elapsed()
            );
            break;
        }

        if start.elapsed() > max_wait {
            ulog_warn!("[sidecar] Update shutdown timeout, force killing remaining...");
            let report = crate::process_cleanup::kill_stale_processes_with_roots(
                STARTUP_CLEANUP_PATTERNS,
                protected_roots,
            );
            ulog_info!(
                "[sidecar] Force-kill final pass: killed {}, residual {} ({:?})",
                report.killed,
                report.residual,
                report.elapsed
            );
            if report.residual > 0 {
                residual_pids.extend(report.residual_pids.iter().copied());
                residual_pids.sort_unstable();
                residual_pids.dedup();
            }
            let remaining = crate::process_cleanup::find_matching_processes_with_roots(
                STARTUP_CLEANUP_PATTERNS,
                protected_roots,
            );
            let residual_remaining =
                crate::process_cleanup::find_live_processes_by_pid(&residual_pids);
            if remaining.is_empty() && residual_remaining.is_empty() {
                break;
            }
            let mut all_remaining = remaining;
            all_remaining.extend(residual_remaining);
            return Err(format!(
                "UPDATE_PROCESSES_STILL_RUNNING: {}",
                describe_process_matches(&all_remaining)
            ));
        }

        let mut blocking = matches;
        blocking.extend(residual_matches);
        ulog_warn!(
            "[sidecar] Waiting for {} update-blocking process(es): {}",
            blocking.len(),
            describe_process_matches(&blocking)
        );
        let report = crate::process_cleanup::kill_stale_processes_with_roots(
            STARTUP_CLEANUP_PATTERNS,
            protected_roots,
        );
        if report.residual > 0 {
            residual_pids.extend(report.residual_pids.iter().copied());
            residual_pids.sort_unstable();
            residual_pids.dedup();
        }
        if report.total_targets() > 0 {
            ulog_info!(
                "[sidecar] Update shutdown kill pass: killed {} (roots={}, descendants={}, residual={}) in {:?}",
                report.killed,
                report.matched_roots,
                report.descendants,
                report.residual,
                report.elapsed
            );
        }
        thread::sleep(Duration::from_millis(sleep_ms));
        sleep_ms = std::cmp::min(sleep_ms.saturating_mul(2), 1_000);
    }

    ulog_info!("[sidecar] Shutdown for update complete");
    Ok(())
}

/// Clean up SDK and MCP child processes at app shutdown.
///
/// On Windows, SDK-spawned node/bun processes often survive a direct
/// parent kill because `cmd.exe` intermediates (npx.cmd wrapper / SDK's
/// embedded bun.exe) break the process-tree linkage that `taskkill /T /F`
/// relies on. This shutdown cleanup walks descendants by PPID via sysinfo
/// and kills
/// them all — orphans included — in one pass.
///
/// Uses [`CHILD_CLEANUP_PATTERNS`] (no `SIDECAR_MARKER`) because our own
/// sidecars are already killed through their `Child` handles in
/// [`stop_all_sidecars`]. Sweeping by marker here would risk killing a
/// concurrent HamunaAgent instance's sidecars during any overlap window.
fn cleanup_child_processes() {
    let report = crate::process_cleanup::kill_stale_processes(CHILD_CLEANUP_PATTERNS);
    if report.total_targets() == 0 {
        ulog_info!(
            "[sidecar] Shutdown cleanup: nothing to kill ({:?})",
            report.elapsed
        );
    } else {
        ulog_info!(
            "[sidecar] Shutdown cleanup: killed {} (roots={}, descendants={}, residual={}) in {:?}",
            report.killed,
            report.matched_roots,
            report.descendants,
            report.residual,
            report.elapsed
        );
    }
}

fn update_protected_roots<R: Runtime>(app_handle: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        roots.push(normalize_external_path(resource_dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(normalize_external_path(dir.to_path_buf()));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn describe_process_matches(matches: &[crate::process_cleanup::ProcessMatch]) -> String {
    matches
        .iter()
        .take(8)
        .map(|m| {
            let exe = m.exe.as_deref().unwrap_or("<unknown-exe>");
            format!(
                "pid={} name={} reason={} exe={}",
                m.pid, m.name, m.reason, exe
            )
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

#[cfg(target_os = "windows")]
fn wait_for_update_file_locks<R: Runtime>(app_handle: &AppHandle<R>) -> Result<(), String> {
    let paths = update_lock_probe_paths(app_handle)?;
    if paths.is_empty() {
        return Err("UPDATE_LOCK_PROBE_UNAVAILABLE: no probe paths resolved".to_string());
    }

    let max_wait = Duration::from_secs(20);
    let start = std::time::Instant::now();
    let mut sleep_ms = 100u64;
    loop {
        let locked = probe_locked_paths(&paths);
        if locked.is_empty() {
            ulog_info!(
                "[sidecar] Update file-lock probe passed for {} path(s) in {:?}",
                paths.len(),
                start.elapsed()
            );
            return Ok(());
        }
        if start.elapsed() > max_wait {
            return Err(format!(
                "UPDATE_FILES_STILL_LOCKED: {}",
                locked
                    .iter()
                    .map(|(path, err)| format!("{} ({})", path.display(), err))
                    .collect::<Vec<_>>()
                    .join(" | ")
            ));
        }
        ulog_warn!(
            "[sidecar] Waiting for {} update file lock(s): {}",
            locked.len(),
            locked
                .iter()
                .map(|(path, err)| format!("{} ({})", path.display(), err))
                .collect::<Vec<_>>()
                .join(" | ")
        );
        thread::sleep(Duration::from_millis(sleep_ms));
        sleep_ms = std::cmp::min(sleep_ms.saturating_mul(2), 1_000);
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_update_file_locks<R: Runtime>(_app_handle: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn update_lock_probe_paths<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Vec<PathBuf>, String> {
    let resource_dir = app_handle.path().resource_dir().map_err(|err| {
        format!(
            "UPDATE_LOCK_PROBE_UNAVAILABLE: failed to resolve resource_dir: {}",
            err
        )
    })?;
    let resource_dir = normalize_external_path(resource_dir);
    let entries: [(&str, PathBuf, bool); 5] = [
        (
            "bundled node",
            resource_dir.join("nodejs").join("node.exe"),
            true,
        ),
        (
            "claude sdk",
            resource_dir.join("claude-agent-sdk").join("claude.exe"),
            true,
        ),
        ("sidecar bundle", resource_dir.join("server-dist.js"), true),
        (
            "plugin bridge bundle",
            resource_dir.join("plugin-bridge-dist.mjs"),
            true,
        ),
        (
            "tsx loader",
            resource_dir
                .join("tsx-runtime")
                .join("node_modules")
                .join("tsx")
                .join("dist")
                .join("esm")
                .join("index.mjs"),
            true,
        ),
    ];

    let mut paths = Vec::new();
    let mut missing_required = Vec::new();
    for (label, path, required) in entries {
        if path.exists() {
            paths.push(path);
        } else if required {
            missing_required.push(format!("{} ({})", label, path.display()));
        }
    }

    if !missing_required.is_empty() {
        return Err(format!(
            "UPDATE_LOCK_PROBE_UNAVAILABLE: missing required path(s): {}",
            missing_required.join(" | ")
        ));
    }
    Ok(paths)
}

#[cfg(target_os = "windows")]
fn probe_locked_paths(paths: &[PathBuf]) -> Vec<(PathBuf, String)> {
    use std::os::windows::fs::OpenOptionsExt;

    paths
        .iter()
        .filter_map(|path| {
            let write_probe = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(path);
            match write_probe {
                Ok(_) => None,
                Err(err) if is_windows_file_lock_error(&err) => {
                    Some((path.clone(), err.to_string()))
                }
                Err(err) if err.raw_os_error() == Some(5) => {
                    let read_probe = std::fs::OpenOptions::new()
                        .read(true)
                        .share_mode(0)
                        .open(path);
                    match read_probe {
                        Ok(_) => {
                            ulog_warn!(
                                "[sidecar] Update file-lock probe ignored write-access denial for {}: {}",
                                path.display(),
                                err
                            );
                            None
                        }
                        Err(read_err) if is_windows_file_lock_error(&read_err) => {
                            Some((path.clone(), read_err.to_string()))
                        }
                        Err(read_err) => {
                            ulog_warn!(
                                "[sidecar] Update file-lock probe ignored non-lock read probe error for {}: {}",
                                path.display(),
                                read_err
                            );
                            None
                        }
                    }
                }
                Err(err) => {
                    ulog_warn!(
                        "[sidecar] Update file-lock probe ignored non-lock error for {}: {}",
                        path.display(),
                        err
                    );
                    None
                }
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn is_windows_file_lock_error(err: &std::io::Error) -> bool {
    matches!(
        err.raw_os_error(),
        // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_USER_MAPPED_FILE.
        Some(32 | 33 | 1224)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The regression this gate exists for: an update guard that drops AFTER
    /// app exit began used to reset the flag to `false`, reopening process and
    /// resource birth in the middle of `ExitRequested` teardown — a new
    /// sidecar could appear while cleanup was still running.
    #[test]
    fn app_exit_cannot_be_reopened_by_a_late_update_guard_drop() {
        reset_spawn_gate_for_test();

        let guard = begin_update_shutdown().expect("first shutdown acquires the gate");
        assert_eq!(spawn_gate_state(), SpawnGateState::UpdateQuiescing);

        // Exit starts while the update guard is still alive.
        close_spawn_gate_for_exit();
        assert_eq!(spawn_gate_state(), SpawnGateState::Exited);

        // The guard now drops — it must release the update bit WITHOUT
        // resurrecting `Open`.
        drop(guard);

        assert_eq!(spawn_gate_state(), SpawnGateState::Exited);
        assert!(!is_update_shutdown_in_progress());
        assert!(begin_update_spawn_permit().is_err());
    }

    #[test]
    fn a_normal_update_shutdown_reopens_the_gate_on_drop() {
        reset_spawn_gate_for_test();

        let guard = begin_update_shutdown().expect("acquires");
        assert!(begin_update_spawn_permit().is_err());
        drop(guard);

        // Not exiting: the gate must genuinely reopen, or the app could never
        // spawn a sidecar again after a cancelled/aborted update.
        assert_eq!(spawn_gate_state(), SpawnGateState::Open);
        assert!(begin_update_spawn_permit().is_ok());
    }

    #[test]
    fn close_for_exit_is_idempotent_and_never_downgrades_an_update_quiesce() {
        reset_spawn_gate_for_test();

        let guard = begin_update_shutdown().expect("acquires");
        // A second exit signal must not clobber the update-quiesce bit.
        close_spawn_gate_for_exit();
        close_spawn_gate_for_exit();
        assert_eq!(spawn_gate_state(), SpawnGateState::Exited);

        drop(guard);
        assert_eq!(spawn_gate_state(), SpawnGateState::Exited);
    }
}
