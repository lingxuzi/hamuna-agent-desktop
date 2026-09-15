use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub device_id: String,
    pub device_name: Option<String>,
    pub platform: String,
    pub os_version: Option<String>,
    pub app_version: String,
}

pub fn get_or_create_device_id() -> Result<String, String> {
    get_or_create_device_id_at(device_id_path()?)
}

fn get_or_create_device_id_at(device_id_file: PathBuf) -> Result<String, String> {
    if let Some(id) = read_existing_device_id(&device_id_file) {
        return Ok(id);
    }

    let lock_path = device_id_file.with_file_name("device_id.lock");
    crate::utils::file_lock::with_file_lock_blocking(
        &lock_path,
        crate::utils::file_lock::FileLockOptions::default(),
        || {
            if let Some(id) = read_existing_device_id(&device_id_file) {
                return Ok(id);
            }

            let new_id = compute_hardware_fingerprint();
            if let Some(parent) = device_id_file.parent() {
                fs::create_dir_all(parent).map_err(crate::utils::file_lock::FileLockError::Io)?;
            }
            fs::write(&device_id_file, &new_id)
                .map_err(crate::utils::file_lock::FileLockError::Io)?;
            Ok(new_id)
        },
    )
    .map_err(String::from)
}

fn read_existing_device_id(path: &Path) -> Option<String> {
    match fs::read_to_string(path) {
        Ok(id) => {
            let id = id.trim().to_string();
            if id.is_empty() {
                None
            } else {
                Some(id)
            }
        }
        Err(_) => {
            // Regenerate below. This matches the legacy command behavior.
            None
        }
    }
}

pub fn current_device_identity() -> Result<DeviceIdentity, String> {
    Ok(DeviceIdentity {
        device_id: get_or_create_device_id()?,
        device_name: local_device_name(),
        platform: platform_identifier(),
        os_version: os_version(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

pub fn platform_identifier() -> String {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "darwin-aarch64".to_string();

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "darwin-x86_64".to_string();

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "windows-x86_64".to_string();

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "windows-aarch64".to_string();

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x86_64".to_string();

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-aarch64".to_string();

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    return "unknown".to_string();
}

pub fn local_device_name() -> Option<String> {
    normalize_device_name(sysinfo::System::host_name())
        .or_else(|| normalize_device_name(std::env::var("COMPUTERNAME").ok()))
        .or_else(|| normalize_device_name(std::env::var("HOSTNAME").ok()))
}

fn device_id_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
    Ok(home_dir.join(".hamuna").join("device_id"))
}

fn normalize_device_name(value: Option<String>) -> Option<String> {
    value
        .map(|name| name.trim().trim_end_matches('.').to_string())
        .filter(|name| !name.is_empty())
}

fn os_version() -> Option<String> {
    sysinfo::System::long_os_version()
        .or_else(sysinfo::System::os_version)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 机器码 = SHA256("{主网卡 MAC}|{主机名}|{platform}") → 前 16 hex
///
/// 三因子拼接，OS 重装保持稳定（MAC 写入网卡固件，主机名通常在系统设置
/// 或路由器层，platform 区分 macOS / Windows / Linux 避免跨平台 MAC 同号
/// 撞码）。任一因子取不到时该字段为空串；空字段会让不同机器偶然撞码，
/// 但服务器端机器码定位错误的影响仅限「该用户被另一个用户充值」——
/// 按产品决策这是 acceptable risk。
///
/// 注：sysinfo 0.33 没暴露 `System::unique_id()`（仅 Windows Cpu 上有），
/// 所以走 MAC + hostname + 平台三因子。MAC 在 NIC 固件层、hostname 在系统
/// 安装时设置，重装一般不变；如未来需要更强唯一性可加 `machine-uid` crate。
fn compute_hardware_fingerprint() -> String {
    let mac = get_primary_mac_address().unwrap_or_default();
    let host_name = normalize_device_name(sysinfo::System::host_name()).unwrap_or_default();
    let platform = platform_identifier();

    let combined = format!("{mac}|{host_name}|{platform}");
    let hash = Sha256::digest(combined.as_bytes());
    hex_encode(&hash[..8])
}

fn get_primary_mac_address() -> Option<String> {
    mac_address::get_mac_address()
        .ok()
        .flatten()
        .map(|mac| mac.to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        s.push_str(&format!("{byte:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn concurrent_first_creation_returns_one_stable_device_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("device_id");
        let barrier = Arc::new(Barrier::new(12));
        let handles = (0..12)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let path = path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    get_or_create_device_id_at(path).expect("device id")
                })
            })
            .collect::<Vec<_>>();

        let ids = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .collect::<Vec<_>>();
        assert!(ids.iter().all(|id| id == &ids[0]));
        assert_eq!(
            fs::read_to_string(dir.path().join("device_id"))
                .expect("written device_id")
                .trim(),
            ids[0]
        );
    }

    #[test]
    fn hardware_fingerprint_is_16_hex_chars() {
        let fp = compute_hardware_fingerprint();
        assert_eq!(fp.len(), 16, "fingerprint must be 16 hex chars");
        assert!(
            fp.chars().all(|c| c.is_ascii_hexdigit()),
            "fingerprint must be hex: {fp}"
        );
    }

    #[test]
    fn hardware_fingerprint_is_stable_across_calls() {
        let a = compute_hardware_fingerprint();
        let b = compute_hardware_fingerprint();
        let c = compute_hardware_fingerprint();
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    #[test]
    fn hex_encode_round_trip() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab]), "00ffab");
        assert_eq!(hex_encode(&[]), "");
    }
}
