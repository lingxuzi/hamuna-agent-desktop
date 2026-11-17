//! 终端口令 —— 让人手动跑的 CLI 在台账里记成「人」，而不是「Agent」。
//!
//! 台账的 actor 由**门**决定：界面上的写入走 Tauri 命令（人），CLI / Agent
//! 工具走管理 API（Agent）。人手动跑 CLI 因此被记成 Agent —— 这个错位是
//! **故意**的（把人的操作记成 Agent 只是让人多看一眼；把 Agent 的操作记成
//! 人，会让人以为这事已经有人拍过板），但人自己知道那是自己做的。
//!
//! 这个模块给「人手动跑 CLI」补一扇门：**终端口令**。
//!
//! 口令由**界面铸造**，只活在 GUI 进程的内存里 —— 不落盘、不进日志、不写进
//! 任何 Agent 能读到的文件。Agent 拿不到有效口令，就没法把自己记成人。
//!
//! 为什么不发本地 token 文件：Agent 和人共用同一个 shell、同一个用户 ——
//! 文件里的 token Agent 直接读得到，那只是把 `--as-user` 换个写法，门形同
//! 虚设，还多一份落盘密文要管。环境变量同理（app 派生的子进程会继承它，
//! Agent 就拿到了）。**唯一 Agent 拿不到的，是人在界面上刚点的那一下。**
//!
//! 残留：口令在有效期内可重复使用，人若把它贴给 Agent，Agent 就能用 ——
//! 那是人的决定，不是洞。要彻底关掉，口令得改成一次性 + 逐条人工确认（管理
//! API 挂起请求，界面弹窗等人点头），那是更大的改动。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// 口令有效期。人要跑的是**一批**命令（导一批选题、补一批素材），一次点击
/// 只够一条命令的话，这个门就没人会用。
const TTL: Duration = Duration::from_secs(10 * 60);

/// 同时有效的口令上限。给窗口留够用，也不让内存里堆一堆没用的口令。
const MAX_ACTIVE: usize = 8;

/// 口令表：(口令, 过期时刻) 的列表。
///
/// **只活在内存里**：进程退出就没了，重启 app 也没了。落盘的话它就变成
/// Agent 读得到的东西（见模块头）。
///
/// 用 Vec 而不是 HashMap：同时有效的口令最多 [`MAX_ACTIVE`] 个，线性扫一遍
/// 比哈希还快，而且 `Vec::new()` 是 const，能直接放在 static 里。
static CODES: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

/// 口令字符表：Crockford base32（去掉 I / L / O / U，避免和 1 / 0 认错）。
const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// 铸一枚新口令，返回口令本体。
///
/// `pub` 是给同进程的管理 API 测试用的：验「有效口令 → 记 user」这条路必须
/// 有一枚真口令，而真口令只能从这里来（界面那扇门是 Tauri 命令，测试不经过
/// WebView）。
pub fn mint() -> String {
    let expiry = Instant::now() + TTL;
    let code = random_code();
    let mut codes = match CODES.lock() {
        Ok(guard) => guard,
        // 锁中毒（上一个持锁的线程 panic 了）也要能继续：取不到锁就当没有
        // 有效口令，铸造失败总比放行一个身份不明的人好。
        Err(poisoned) => poisoned.into_inner(),
    };
    let now = Instant::now();
    codes.retain(|(_, expiry)| *expiry > now);
    if codes.len() >= MAX_ACTIVE {
        // 满了就扔掉最早到期的那枚。人手上有几枚旧口令很正常，扔最旧的
        // 影响最小。
        if let Some(index) = codes
            .iter()
            .enumerate()
            .min_by_key(|(_, (_, expiry))| *expiry)
            .map(|(index, _)| index)
        {
            codes.remove(index);
        }
    }
    codes.push((code.clone(), expiry));
    code
}

/// 随机口令：8 个字符 × 5 bit = 40 bit。
///
/// 熵不是装饰：管理 API 在 localhost 上是敞开的，Agent 可以直接打这个端口
/// 试口令。40 bit 意味着暴力猜需要 10^12 次请求 —— 不可能。
fn random_code() -> String {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    bytes
        .iter()
        .take(8)
        .map(|byte| ALPHABET[(byte & 0x1f) as usize] as char)
        .collect()
}

/// 校验口令。有效返回 true。
///
/// 大小写不敏感：人从屏幕上抄代码时把 `a` 打成 `A` 是常事，让这种小错
/// 变成「身份不明」没有意义。
pub fn verify(code: &str) -> bool {
    let code = code.trim();
    if code.is_empty() {
        return false;
    }
    let mut codes = match CODES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let now = Instant::now();
    // 顺手清掉过期的：表只在这个函数里被读，清在这里就不需要另一个清扫点。
    codes.retain(|(_, expiry)| *expiry > now);
    codes
        .iter()
        .any(|(known, _)| known.eq_ignore_ascii_case(code))
}

/// 铸造一枚口令，返回给界面。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsUserCode {
    /// 口令本体。
    pub code: String,
    /// 过期时刻（ISO 8601，毫秒精度 UTC）。
    pub expires_at: String,
    /// 还能用多久（秒）。
    pub ttl_seconds: u64,
}

/// 界面上的「生成终端口令」。
///
/// **只有 WebView 能调 Tauri 命令** —— Agent 拿不到这个入口，所以「铸造
/// 口令」这件事本身就是人的动作。
#[tauri::command]
pub async fn cmd_ops_user_code() -> Result<OpsUserCode, String> {
    let code = mint();
    Ok(OpsUserCode {
        code,
        // 过期时刻是给人看的（界面上写「10 分钟内有效」），内部判定用单调
        // 时钟。两套时钟差几毫秒无所谓 —— 这里给的是**上限**，早一秒失效
        // 不会让人吃亏。
        expires_at: (chrono::Utc::now() + chrono::Duration::seconds(TTL.as_secs() as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ttl_seconds: TTL.as_secs(),
    })
}

// ── 测试 ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试跑在同一个进程里，口令表是全局的 —— 用独立的 key 隔开。
    fn fresh_code() -> String {
        mint()
    }

    #[test]
    fn a_minted_code_verifies() {
        let code = fresh_code();
        assert!(verify(&code), "刚铸的口令应该有效");
    }

    #[test]
    fn an_unknown_code_does_not_verify() {
        assert!(!verify("NOT-A-REAL-CODE"));
        assert!(!verify(""));
        assert!(!verify("   "));
    }

    #[test]
    fn the_code_is_case_insensitive() {
        let code = fresh_code();
        let flipped = code.to_lowercase();
        assert!(verify(&flipped), "人抄代码时把大小写打错不该算身份不明");
    }

    #[test]
    fn the_code_has_eight_unambiguous_characters() {
        let code = fresh_code();
        assert_eq!(code.len(), 8);
        for ch in code.chars() {
            assert!(
                ALPHABET.contains(&(ch as u8)),
                "口令里出现了容易认错的字符: {}",
                ch
            );
        }
    }

    #[test]
    fn two_mints_give_different_codes() {
        assert_ne!(fresh_code(), fresh_code());
    }
}
