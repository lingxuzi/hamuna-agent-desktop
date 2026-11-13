//! 原子落盘：临时文件 → fsync → rename → fsync 父目录。
//!
//! 抽出来的原因：`config.json`（存密钥）和 `ops/state.json`（存用户自己的运营
//! 台账）都需要「写完之后崩溃也不丢数据」。同一份平台相关代码写两遍，两边就会
//! 各自漂移——尤其是「Windows 上目录 fsync 只能跳过、Unix 上必须做」这种平台
//! 差异，漏改一边就会在另一个平台上静默丢数据。
//!
//! `label` 只进错误前缀，让排查时能一眼看出是哪个文件坏了（`[config-io]` /
//! `[ops-store]`），不改变任何行为。

use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// 写 `content` 到 `path` 并 fsync 文件内容。
///
/// 显式 0o600：`config.json` 存密钥，`ops/state.json` 存用户自己的运营台账，
/// 两者都不该是同机其他用户可读的。跨进程写者（Node sidecar / Rust 命令）产出的
/// 权限必须一致，否则谁最后写谁决定权限。
pub fn write_all_synced(path: &Path, content: &str, label: &str) -> Result<(), String> {
    #[cfg(unix)]
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("[{}] Cannot open tmp file: {}", label, e))?;
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|e| format!("[{}] Cannot open tmp file: {}", label, e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("[{}] Cannot write tmp file: {}", label, e))?;
    file.sync_all()
        .map_err(|e| format!("[{}] Cannot fsync tmp file: {}", label, e))?;
    Ok(())
}

/// fsync 目录，让「新建 / 替换文件」这个动作本身也落盘——只 fsync 文件的话，
/// 崩溃后可能出现「文件内容在、文件名不在」的目录项丢失。
///
/// POSIX-only —— Windows 的 `FlushFileBuffers` 对目录句柄是文档化的空操作
/// （还得带 `FILE_FLAG_BACKUP_SEMANTICS` 才能打开），那边靠 NTFS 自己的日志。
/// 拆成两个函数而不是 cfg-gate 函数体，是为了让 `path` / `label` 在 Windows
/// 上不会被判成未使用。
#[cfg(unix)]
pub fn fsync_parent_dir(path: &Path, label: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let dir = OpenOptions::new()
            .read(true)
            .open(parent)
            .map_err(|e| format!("[{}] Cannot open dir for fsync: {}", label, e))?;
        dir.sync_all()
            .map_err(|e| format!("[{}] Cannot fsync dir: {}", label, e))?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn fsync_parent_dir(_path: &Path, _label: &str) -> Result<(), String> {
    Ok(())
}

/// 原子发布：写同目录临时文件 → fsync → rename 覆盖目标 → fsync 父目录。
///
/// rename 在 POSIX 与 Windows 上都是原子的，读者永远看到完整的旧版或新版，
/// 看不到半个文件。临时文件名带 pid + 计数器，同目录内不与别的写者撞名。
///
/// 调用方负责保证目标父目录已存在（需要隐式建目录的场景自己先 `create_dir_all`）。
pub fn atomic_publish(target: &Path, content: &str, label: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("[{}] Cannot determine parent directory", label))?;
    let file_name = target
        .file_name()
        .ok_or_else(|| format!("[{}] Cannot determine filename", label))?
        .to_string_lossy()
        .to_string();

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_path = parent.join(format!(".{}.hamuna-{}-{}.tmp", file_name, std::process::id(), n));

    write_all_synced(&tmp_path, content, label)?;
    if let Err(e) = fs::rename(&tmp_path, target) {
        // 失败时清掉临时文件，别在目录里留垃圾。
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("[{}] Cannot commit write: {}", label, e));
    }
    fsync_parent_dir(target, label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishes_atomically_and_leaves_no_tmp_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("state.json");

        atomic_publish(&target, "{\"a\":1}", "test").expect("publish");

        assert_eq!(fs::read_to_string(&target).expect("read"), "{\"a\":1}");
        let leftovers: Vec<String> = fs::read_dir(dir.path())
            .expect("read dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n != "state.json")
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件: {:?}", leftovers);
    }

    #[test]
    fn overwrites_existing_content() {
        let dir = tempfile::tempdir().expect("temp dir");
        let target = dir.path().join("state.json");
        fs::write(&target, "old").expect("seed");

        atomic_publish(&target, "new", "test").expect("publish");

        assert_eq!(fs::read_to_string(&target).expect("read"), "new");
    }
}
