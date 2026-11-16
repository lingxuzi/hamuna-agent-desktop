//! Converge a workspace onto the bundled template it was created from.
//!
//! # Why this exists
//!
//! A workspace is a **copy** of a template, made once, when the user created
//! it. The template keeps evolving with the app (new skills, new ledger
//! discipline), the copy does not — so the workspace ends up running an older
//! contract than the app believes it is running.
//!
//! The symptom is not "a file is out of date". It is "the agent does the
//! wrong thing": the ops panel sends 【运营方向】 to the agent and asks it to
//! follow the `ops-direction` skill; a workspace created before that skill
//! existed has no such skill, so the agent improvises — it turns the
//! direction into a topic and writes that to the ledger instead. Same class
//! of failure for the ledger discipline itself: a stale `05-OPS.md` does not
//! know the `unverified` state, so the agent marks a piece `published`
//! without ever reading the platform back.
//!
//! # The three pieces
//!
//! - **The template declares what belongs to the user.** `.hamuna-template.json`
//!   lists the paths the user (or the agent living in the workspace) owns:
//!   profile sheets, journals, the ledger. Those are never written here.
//! - **Per-workspace state records what we wrote.** Each file we write is
//!   remembered by content hash, so a file the user edited since is
//!   recognised as theirs and left alone from then on.
//! - **Everything else converges**: missing files are added, stale files are
//!   refreshed, nothing is ever deleted.
//!
//! State and backups live in `~/.hamuna`, NOT in the workspace: a workspace
//! is often a git repo the user pushes, and app bookkeeping does not belong
//! in it.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::device_identity::hex_encode;
use crate::{ulog_info, ulog_warn};

/// The manifest every bundled template ships.
pub const TEMPLATE_MANIFEST_FILE: &str = ".hamuna-template.json";

/// A template id is a single path segment — never a traversal.
pub fn validate_template_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid template ID".to_string());
    }
    Ok(())
}

/// Resolve a template source directory from either a bundled template_id or a user
/// template source_path. Returns the CANONICAL path (symlinks resolved) — callers must
/// use this exact path for any subsequent reads/copies, otherwise a TOCTOU window opens
/// where an attacker could replace the validated source with a symlink to elsewhere
/// between this validation and the later read.
pub fn resolve_template_source<R: Runtime>(
    app_handle: &AppHandle<R>,
    template_id: Option<String>,
    source_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(id) = template_id.as_deref() {
        validate_template_id(id)?;
        let resource_dir = crate::app_dirs::resource_dir(app_handle)?;
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

/// What the template owns vs. what the user owns.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateManifest {
    /// Must match the directory name — a mismatch means the app is looking at
    /// the wrong template and every write would land in the wrong workspace.
    pub template_id: String,
    /// Paths (relative to the template root) that belong to the user. A path
    /// is user-owned when it equals an entry or lives under it, so `ops`
    /// covers `ops/state.json`.
    #[serde(default)]
    pub user_owned: Vec<String>,
}

impl TemplateManifest {
    /// Read the manifest from a template directory.
    pub fn read(template_dir: &Path) -> Result<Self, String> {
        let path = template_dir.join(TEMPLATE_MANIFEST_FILE);
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Template manifest unreadable at {}: {e}", path.display()))?;
        let manifest: TemplateManifest = serde_json::from_str(&raw)
            .map_err(|e| format!("Template manifest malformed at {}: {e}", path.display()))?;
        Ok(manifest)
    }

    /// Is this template-relative path the user's?
    pub fn is_user_owned(&self, rel_path: &str) -> bool {
        self.user_owned.iter().any(|entry| {
            let entry = entry.trim().trim_matches('/');
            if entry.is_empty() {
                return false;
            }
            rel_path == entry || rel_path.starts_with(&format!("{entry}/"))
        })
    }
}

/// Per-file bookkeeping: what we wrote, and whether the user has taken over.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct TemplateFileState {
    /// sha256 of the content we last wrote.
    hash: String,
    /// The user changed the file after we wrote it — the app stops managing
    /// it from then on. Without this flag a user edit would be indistinguishable
    /// from "the template moved on", and the next converge would undo it.
    #[serde(default)]
    user_modified: bool,
}

/// Per-workspace convergence state.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct TemplateSyncState {
    #[serde(default)]
    template_id: String,
    #[serde(default)]
    files: BTreeMap<String, TemplateFileState>,
}

/// What a converge did.
#[derive(Debug, Clone, Default)]
pub struct TemplateSyncReport {
    pub template_id: String,
    /// Files that did not exist in the workspace and now do.
    pub added: Vec<String>,
    /// Files that existed with stale content and now carry the template's.
    pub updated: Vec<String>,
    /// Files the user owns — never touched.
    pub user_owned: Vec<String>,
    /// Files the user edited after we wrote them — left alone.
    pub user_modified: Vec<String>,
    /// Files already identical to the template.
    pub unchanged: usize,
}

impl TemplateSyncReport {
    /// Did this converge change anything?
    pub fn changed(&self) -> bool {
        !self.added.is_empty() || !self.updated.is_empty()
    }
}

/// Walk a template directory and collect the relative paths of its files.
///
/// Symlinks are skipped: a template that ships one is either a broken
/// packaging artifact or an escape hatch out of the template root, and
/// neither should be copied into a workspace.
///
/// The manifest is skipped too — it describes the template, it is not part of
/// what the template ships into a workspace.
pub fn list_template_files_rel(src: &Path) -> std::io::Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name();
            if name == ".git" || name == "node_modules" || name == TEMPLATE_MANIFEST_FILE {
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

/// sha256 of a file's bytes, hex encoded.
fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(hex_encode(&Sha256::digest(&bytes)))
}

/// Stable per-workspace key: the same workspace always maps to the same
/// state file and backup directory, whatever the machine's temp dir does.
fn workspace_key(workspace: &Path) -> String {
    let normalized =
        crate::workspace_path::normalize_workspace_path_identity(&workspace.to_string_lossy());
    let digest = Sha256::digest(normalized.as_bytes());
    hex_encode(&digest[..8])
}

fn state_path(state_root: &Path, workspace: &Path) -> PathBuf {
    state_root
        .join("template-state")
        .join(format!("{}.json", workspace_key(workspace)))
}

fn backup_dir(state_root: &Path, workspace: &Path) -> PathBuf {
    state_root
        .join("template-backups")
        .join(workspace_key(workspace))
}

fn read_state(state_root: &Path, workspace: &Path) -> TemplateSyncState {
    fs::read_to_string(state_path(state_root, workspace))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state(
    state_root: &Path,
    workspace: &Path,
    state: &TemplateSyncState,
) -> Result<(), String> {
    let path = state_path(state_root, workspace);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Cannot serialize template state: {e}"))?;
    write_atomic(&path, raw.as_bytes())
}

/// Write a file so a reader never sees a half-written version.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    // Keep the original name in the temp name: two different sources must not
    // collapse onto one temp path (`foo.md` and `foo` would both become
    // `foo.tmp`).
    let tmp = path.with_file_name(format!(".{file_name}.tmp{}", std::process::id()));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    fs::write(&tmp, bytes).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot replace {}: {e}", path.display())
    })
}

/// Keep the version we are about to overwrite — the workspace may have been
/// edited by hand and we cannot always tell (a workspace created before this
/// feature has no state file, so "stale template" and "user edit" look the
/// same). The backup is the difference between "your edit is gone" and "your
/// edit is one directory away".
fn backup_existing(state_root: &Path, workspace: &Path, rel_path: &str) {
    let dir = backup_dir(state_root, workspace);
    let source = workspace.join(rel_path);
    let target = dir.join(rel_path);
    if let Some(parent) = target.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            ulog_warn!(
                "[template-sync] cannot create backup dir {}: {e}",
                parent.display()
            );
            return;
        }
    }
    if let Err(e) = fs::copy(&source, &target) {
        ulog_warn!(
            "[template-sync] cannot back up {} to {}: {e}",
            source.display(),
            target.display()
        );
    }
}

/// Copy the template's version of a file into the workspace.
fn install_template_file(source: &Path, target: &Path) -> Result<(), String> {
    let bytes = fs::read(source).map_err(|e| format!("Cannot read {}: {e}", source.display()))?;
    write_atomic(target, &bytes)
}

/// Converge `workspace` onto `template_dir`.
///
/// Safe to call repeatedly: files already identical to the template are left
/// alone, files the user owns are never written, and files the user edited
/// after we wrote them are left alone from then on.
pub fn sync_template_files(
    workspace: &Path,
    template_dir: &Path,
) -> Result<TemplateSyncReport, String> {
    let state_root = crate::app_dirs::hamuna_data_dir()
        .ok_or_else(|| "Cannot resolve ~/.hamuna to persist template state.".to_string())?;
    sync_template_files_with_state_root(workspace, template_dir, &state_root)
}

/// The converge itself, with the bookkeeping root injected.
///
/// The bookkeeping (state file, backups) lives under `state_root` — the app
/// home in production, a temp dir in tests. Injecting it keeps the unit tests
/// off the real `~/.hamuna`.
fn sync_template_files_with_state_root(
    workspace: &Path,
    template_dir: &Path,
    state_root: &Path,
) -> Result<TemplateSyncReport, String> {
    let manifest = TemplateManifest::read(template_dir)?;
    let previous = read_state(state_root, workspace);
    let mut files: BTreeMap<String, TemplateFileState> = BTreeMap::new();
    let mut report = TemplateSyncReport {
        template_id: manifest.template_id.clone(),
        ..Default::default()
    };

    let template_files = list_template_files_rel(template_dir)
        .map_err(|e| format!("Cannot walk template {}: {e}", template_dir.display()))?;

    for rel in template_files {
        let rel_path = rel.to_string_lossy().replace('\\', "/");

        if manifest.is_user_owned(&rel_path) {
            report.user_owned.push(rel_path);
            continue;
        }

        let source = template_dir.join(&rel);
        let target = workspace.join(&rel);
        let bundled_hash = hash_file(&source)?;

        // `symlink_metadata` — it does NOT follow links (CLAUDE.md red line:
        // `Path::exists()` follows links and reports false for a broken one, so
        // the write would then fail in a confusing way).
        let existing = fs::symlink_metadata(&target);
        let current_hash = match &existing {
            // A directory where the template has a file: not ours to resolve.
            // A symlink where the template has a file: the user pointed it
            // somewhere on purpose — replacing it would destroy that intent
            // and could write through it.
            Ok(meta) if meta.is_dir() || meta.is_symlink() => {
                report.user_modified.push(rel_path.clone());
                files.insert(
                    rel_path,
                    TemplateFileState {
                        hash: String::new(),
                        user_modified: true,
                    },
                );
                continue;
            }
            Ok(_) => Some(hash_file(&target)?),
            Err(_) => None,
        };

        match current_hash {
            None => {
                install_template_file(&source, &target)?;
                report.added.push(rel_path.clone());
                files.insert(
                    rel_path,
                    TemplateFileState {
                        hash: bundled_hash,
                        user_modified: false,
                    },
                );
            }
            Some(current) if current == bundled_hash => {
                report.unchanged += 1;
                files.insert(
                    rel_path,
                    TemplateFileState {
                        hash: bundled_hash,
                        user_modified: false,
                    },
                );
            }
            Some(current) => {
                let prior = previous.files.get(&rel_path);
                let user_touched = match prior {
                    Some(state) if state.user_modified => true,
                    // We wrote it, and the workspace still holds what we wrote:
                    // only the template moved on.
                    Some(state) if state.hash == current => false,
                    // We wrote it, and the workspace differs from what we
                    // wrote: the user changed it.
                    Some(_) => true,
                    // No record at all: a workspace created before this feature
                    // existed. "Stale template" and "hand-edited" look the same
                    // from here, so back the old copy up and take the
                    // template's version — the backup is what makes that safe.
                    None => false,
                };

                if user_touched {
                    report.user_modified.push(rel_path.clone());
                    files.insert(
                        rel_path,
                        TemplateFileState {
                            hash: current,
                            user_modified: true,
                        },
                    );
                    continue;
                }

                backup_existing(state_root, workspace, &rel_path);
                install_template_file(&source, &target)?;
                report.updated.push(rel_path.clone());
                files.insert(
                    rel_path,
                    TemplateFileState {
                        hash: bundled_hash,
                        user_modified: false,
                    },
                );
            }
        }
    }

    write_state(
        state_root,
        workspace,
        &TemplateSyncState {
            template_id: manifest.template_id.clone(),
            files,
        },
    )?;

    if report.changed() {
        ulog_info!(
            "[template-sync] {} converged: +{} ~{} (user-owned {}, user-modified {})",
            manifest.template_id,
            report.added.len(),
            report.updated.len(),
            report.user_owned.len(),
            report.user_modified.len()
        );
        for path in &report.added {
            ulog_info!("[template-sync] added {}", path);
        }
        for path in &report.updated {
            ulog_info!("[template-sync] updated {}", path);
        }
    }

    Ok(report)
}

/// The template id of a workspace, according to the project registry.
///
/// Only built-in templates have a template to converge to; a workspace the
/// user made from their own folder — or from one of their own templates —
/// belongs to the user and is never touched.
pub fn workspace_template_id(workspace: &Path) -> Option<String> {
    let home = crate::app_dirs::hamuna_data_dir()?;
    let path = home.join("projects.json");
    let raw = fs::read_to_string(path).ok()?;
    let projects: Vec<serde_json::Value> =
        serde_json::from_str(crate::utils::bom::strip_bom(&raw)).ok()?;

    let wanted =
        crate::workspace_path::normalize_workspace_path_identity(&workspace.to_string_lossy());

    for project in projects {
        let Some(project_path) = project.get("path").and_then(|v| v.as_str()) else {
            continue;
        };
        let normalized = crate::workspace_path::normalize_workspace_path_identity(project_path);
        if normalized != wanted {
            continue;
        }
        // A user template is the user's content — the app must not overwrite it.
        let source = project
            .get("templateSource")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if source != "builtin" {
            return None;
        }
        let template_id = project.get("templateId").and_then(|v| v.as_str())?;
        let template_id = template_id.trim();
        if template_id.is_empty() {
            return None;
        }
        return Some(template_id.to_string());
    }
    None
}

/// Converge a workspace onto the template it was created from, if it has one.
///
/// Fail-open by design: a workspace that is not template-backed, a template
/// without a manifest, or any IO error must never keep a session from
/// starting. The agent can work with a slightly stale contract; it cannot
/// work with no session at all.
pub fn sync_workspace_template<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Path,
) -> Option<TemplateSyncReport> {
    let template_id = workspace_template_id(workspace)?;
    let template_dir = resolve_template_source(app_handle, Some(template_id.clone()), None).ok()?;
    // A template without a manifest does not know which paths are the user's —
    // converging it would overwrite their notes. Skip instead of guessing.
    if !template_dir.join(TEMPLATE_MANIFEST_FILE).exists() {
        ulog_warn!(
            "[template-sync] template {} has no {} — skipping converge",
            template_id,
            TEMPLATE_MANIFEST_FILE
        );
        return None;
    }
    match sync_template_files(workspace, &template_dir) {
        Ok(report) => Some(report),
        Err(e) => {
            ulog_warn!("[template-sync] converge failed for {}: {}", template_id, e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn template(dir: &Path, manifest: &str) {
        write(&dir.join(TEMPLATE_MANIFEST_FILE), manifest);
    }

    #[test]
    fn adds_files_the_workspace_is_missing() {
        // The exact shape of the bug this module exists for: the workspace was
        // created before `ops-direction` existed, so the skill the ops panel
        // names is simply not there.
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(
            &template_dir,
            r#"{"templateId":"sino","userOwned":["ops"]}"#,
        );
        write(
            &template_dir.join(".claude/skills/ops-direction/SKILL.md"),
            "direction",
        );
        write(&template_dir.join(".claude/rules/05-OPS.md"), "ops rules");
        write(&workspace.join(".claude/rules/05-OPS.md"), "old ops rules");
        fs::create_dir_all(&workspace).unwrap();

        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert_eq!(report.added, vec![".claude/skills/ops-direction/SKILL.md"]);
        assert_eq!(report.updated, vec![".claude/rules/05-OPS.md"]);
        assert_eq!(
            fs::read_to_string(workspace.join(".claude/skills/ops-direction/SKILL.md")).unwrap(),
            "direction"
        );
        assert_eq!(
            fs::read_to_string(workspace.join(".claude/rules/05-OPS.md")).unwrap(),
            "ops rules"
        );
    }

    #[test]
    fn never_writes_files_the_user_owns() {
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(
            &template_dir,
            r#"{"templateId":"sino","userOwned":["ops","memory",".claude/rules/03-USER.md"]}"#,
        );
        write(&template_dir.join("ops/state.json"), r#"{"topics":[]}"#);
        write(&template_dir.join("memory/topics/.gitkeep"), "");
        write(
            &template_dir.join(".claude/rules/03-USER.md"),
            "blank profile",
        );
        write(&workspace.join("ops/state.json"), r#"{"topics":["kept"]}"#);
        write(&workspace.join("memory/topics/.gitkeep"), "notes");
        write(&workspace.join(".claude/rules/03-USER.md"), "my profile");
        fs::create_dir_all(&workspace).unwrap();

        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert!(report.added.is_empty() && report.updated.is_empty());
        assert_eq!(
            fs::read_to_string(workspace.join("ops/state.json")).unwrap(),
            r#"{"topics":["kept"]}"#
        );
        assert_eq!(
            fs::read_to_string(workspace.join(".claude/rules/03-USER.md")).unwrap(),
            "my profile"
        );
    }

    #[test]
    fn keeps_a_file_the_user_edited_after_we_wrote_it() {
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(&template_dir, r#"{"templateId":"sino"}"#);
        write(&template_dir.join("CLAUDE.md"), "v1");
        fs::create_dir_all(&workspace).unwrap();
        write(&workspace.join("CLAUDE.md"), "v1");

        // First converge: the workspace matches the template.
        sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        // The template moves on, and so does the user.
        write(&template_dir.join("CLAUDE.md"), "v2");
        write(&workspace.join("CLAUDE.md"), "mine");

        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert_eq!(report.user_modified, vec!["CLAUDE.md"]);
        assert!(report.updated.is_empty());
        assert_eq!(
            fs::read_to_string(workspace.join("CLAUDE.md")).unwrap(),
            "mine"
        );

        // And it stays the user's from then on, even if the template moves again.
        write(&template_dir.join("CLAUDE.md"), "v3");
        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();
        assert_eq!(report.user_modified, vec!["CLAUDE.md"]);
        assert_eq!(
            fs::read_to_string(workspace.join("CLAUDE.md")).unwrap(),
            "mine"
        );
    }

    #[test]
    fn converges_a_stale_file_the_user_never_touched() {
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(&template_dir, r#"{"templateId":"sino"}"#);
        write(&template_dir.join("CLAUDE.md"), "v1");
        fs::create_dir_all(&workspace).unwrap();
        write(&workspace.join("CLAUDE.md"), "v1");

        sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        // Only the template moved.
        write(&template_dir.join("CLAUDE.md"), "v2");
        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert_eq!(report.updated, vec!["CLAUDE.md"]);
        assert_eq!(
            fs::read_to_string(workspace.join("CLAUDE.md")).unwrap(),
            "v2"
        );
    }

    #[test]
    fn never_deletes_workspace_files() {
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(&template_dir, r#"{"templateId":"sino"}"#);
        write(&template_dir.join("CLAUDE.md"), "v1");
        fs::create_dir_all(&workspace).unwrap();
        write(&workspace.join("CLAUDE.md"), "v1");
        write(&workspace.join("my-notes.md"), "mine");

        sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert!(workspace.join("my-notes.md").exists());
    }

    #[test]
    fn a_second_converge_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let template_dir = tmp.path().join("template");
        let workspace = tmp.path().join("workspace");
        template(&template_dir, r#"{"templateId":"sino"}"#);
        write(&template_dir.join("CLAUDE.md"), "v1");
        write(&template_dir.join(".claude/skills/a/SKILL.md"), "a");
        fs::create_dir_all(&workspace).unwrap();

        sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();
        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert!(!report.changed());
        assert_eq!(report.unchanged, 2);
    }

    #[test]
    fn user_owned_paths_match_on_components_not_string_prefixes() {
        let manifest = TemplateManifest {
            template_id: "sino".to_string(),
            user_owned: vec!["ops".to_string()],
        };
        assert!(manifest.is_user_owned("ops"));
        assert!(manifest.is_user_owned("ops/state.json"));
        assert!(!manifest.is_user_owned("opsx/state.json"));
        assert!(!manifest.is_user_owned("CLAUDE.md"));
    }

    /// The templates the app ships must declare their own id — a mismatch
    /// means the converge is looking at the wrong template.
    #[test]
    fn shipped_templates_declare_a_matching_id() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("agent-templates");
        for id in ["sino", "mino"] {
            let dir = repo.join(id);
            assert!(dir.is_dir(), "missing shipped template {}", id);
            let manifest = TemplateManifest::read(&dir).unwrap();
            assert_eq!(manifest.template_id, id);
            // The repo filter and the journal are the user's. Overwriting
            // `.gitignore` would silently drop a line the user added (and
            // possibly the one that keeps credentials out of the repo);
            // overwriting `memory/` would wipe the agent's own journal.
            assert!(
                manifest.is_user_owned(".gitignore"),
                "{} must leave .gitignore alone",
                id
            );
            assert!(
                manifest.is_user_owned("memory"),
                "{} must leave memory/ alone",
                id
            );
        }
        // The ledger is the user's — the App's ops store is its only writer.
        let sino = TemplateManifest::read(&repo.join("sino")).unwrap();
        assert!(sino.is_user_owned("ops/state.json"));
    }

    /// The regression this whole module exists for: a workspace created
    /// before `ops-direction` existed must receive that skill, and the
    /// ledger it already has must stay exactly as it was.
    #[test]
    fn the_shipped_sino_template_gives_the_missing_skill_and_keeps_the_ledger() {
        let template_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("agent-templates")
            .join("sino");
        let tmp = tempfile::tempdir().unwrap();
        let state_root = tmp.path().join("state");
        let workspace = tmp.path().join("workspace");

        // A workspace from before the skill existed: the ops skills it did
        // have are there, `ops-direction` is not.
        fs::create_dir_all(workspace.join(".claude/skills/ops-topic")).unwrap();
        fs::write(workspace.join(".claude/skills/ops-topic/SKILL.md"), "topic").unwrap();
        fs::create_dir_all(workspace.join("ops")).unwrap();
        fs::write(workspace.join("ops/state.json"), r#"{"stateVersion":1}"#).unwrap();

        let report =
            sync_template_files_with_state_root(&workspace, &template_dir, &state_root).unwrap();

        assert!(report
            .added
            .contains(&".claude/skills/ops-direction/SKILL.md".to_string()));
        assert!(workspace
            .join(".claude/skills/ops-direction/SKILL.md")
            .exists());
        // The ledger is the user's — the converge must not have touched it.
        assert_eq!(
            fs::read_to_string(workspace.join("ops/state.json")).unwrap(),
            r#"{"stateVersion":1}"#
        );
    }
}
