// browser_throttle.rs — per-host navigation pacing for the embedded browser
//
// WHY THIS EXISTS
// ---------------
// The embedded browser already looks like a real user in every dimension that
// matters for bot detection: a real engine, a real Chrome UA, the user's own
// cookies, and its own JS running the site's scripts. The one signal that is
// still machine-shaped is *cadence*: an Agent can fire ten page loads at the
// same host in two seconds, which no human does, and several sites respond by
// throttling or challenging the session.
//
// So: enforce a minimum interval between navigations to the same host, and
// vary it with jitter so the gaps never line up on a fixed period.
//
// WHAT IS **NOT** THROTTLED
// -------------------------
// Read-only work (`browser read` / `status`) makes ZERO network requests — it
// reads the DOM of a page that is already loaded. Delaying it would slow the
// Agent down for no anti-detection benefit, so it is deliberately exempt.
// `click` / `fill` / `submit` are interactions *inside* a page the user is
// watching; making a visible button press lag by seconds reads as a broken UI.
// Their navigations still count, though: the `on_page_load` hook records every
// navigation that actually happened, wherever it came from, so the next
// explicit navigate measures against real history instead of guessing.
//
// The decision logic is a pure function (`throttle_delay_ms`) with the clock
// and the jitter seed passed in, so it is testable without sleeping.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Minimum gap between two navigations to the same host. Two seconds still
/// feels responsive in a panel the user is watching, while capping a burst at
/// ~30 loads/minute — below the threshold most rate limiters trip on, and
/// comfortably in the range a human clicking around produces.
const MIN_NAVIGATION_INTERVAL_MS: u64 = 2_000;

/// Upper bound on the random extra added to every gap. Varies the observable
/// period between 2.0s and 3.2s so the pattern is not a metronome.
const NAVIGATION_JITTER_MS: u64 = 1_200;

/// When the previous navigation to `host` happened at `last_ms`, how long a
/// navigation starting at `now_ms` must wait before it may fire.
///
/// `seed` supplies the jitter (in `0..=jitter_ms`); it is passed in rather than
/// generated here so tests are deterministic. A `last_ms` in the future is not
/// an error — `wait_for_host` reserves a slot ahead of the sleep, and a second
/// caller arriving mid-wait must measure from that reserved slot.
pub fn throttle_delay_ms(
    last_ms: Option<u64>,
    now_ms: u64,
    min_interval_ms: u64,
    jitter_ms: u64,
    seed: u64,
) -> u64 {
    let Some(last_ms) = last_ms else {
        // First contact with this host in this process: nothing to pace
        // against. Waiting here would punish the common "open one page" case.
        return 0;
    };
    let jitter = if jitter_ms == 0 {
        0
    } else {
        seed % (jitter_ms + 1)
    };
    last_ms
        .saturating_add(min_interval_ms)
        .saturating_add(jitter)
        .saturating_sub(now_ms)
}

/// Jitter seed for one navigation attempt: FNV-1a over the host plus the
/// current time. Deterministic given the same inputs, different across calls.
fn jitter_seed(host: &str, now_ms: u64) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in host.as_bytes().iter().chain(now_ms.to_le_bytes().iter()) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Last navigation time per host, process-wide (a burst on one host from two
/// tabs is still a burst as far as the site is concerned).
fn hits() -> &'static Mutex<HashMap<String, u64>> {
    static HITS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    HITS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_hits() -> std::sync::MutexGuard<'static, HashMap<String, u64>> {
    // A panic while holding this lock must not disable pacing for the rest of
    // the process — the map is trivially recoverable.
    hits()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Pace the navigation that is about to happen to `host`: sleep out whatever
/// the minimum interval still requires, then record the slot.
pub async fn wait_for_host(host: &str) {
    if host.is_empty() {
        return;
    }
    let now = now_ms();
    let delay = {
        let mut hits = lock_hits();
        let delay = throttle_delay_ms(
            hits.get(host).copied(),
            now,
            MIN_NAVIGATION_INTERVAL_MS,
            NAVIGATION_JITTER_MS,
            jitter_seed(host, now),
        );
        // Reserve the slot *before* sleeping: a concurrent caller must measure
        // from when this navigation will fire, not from when it started
        // waiting, or both would wake up together.
        hits.insert(host.to_string(), now.saturating_add(delay));
        delay
    };
    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
}

/// Record a navigation that already happened. Called from the page-load hook
/// so click-driven loads count toward the next host's pacing.
pub fn record_navigation(host: &str) {
    if host.is_empty() {
        return;
    }
    lock_hits().insert(host.to_string(), now_ms());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_navigation_to_a_host_is_not_delayed() {
        assert_eq!(throttle_delay_ms(None, 1_000, 2_000, 1_200, 42), 0);
    }

    #[test]
    fn a_navigation_inside_the_window_waits_the_remainder() {
        // last=1000, min=2000, jitter resolves to 500 → target 3500.
        assert_eq!(
            throttle_delay_ms(Some(1_000), 1_000, 2_000, 1_000, 500),
            2_500
        );
        assert_eq!(
            throttle_delay_ms(Some(1_000), 2_000, 2_000, 1_000, 500),
            1_500
        );
    }

    #[test]
    fn a_navigation_past_the_window_is_not_delayed() {
        assert_eq!(throttle_delay_ms(Some(1_000), 3_500, 2_000, 1_000, 500), 0);
        assert_eq!(throttle_delay_ms(Some(1_000), 9_000, 2_000, 1_000, 500), 0);
    }

    #[test]
    fn jitter_stays_within_its_bound_and_varies() {
        let mut seen = std::collections::HashSet::new();
        for seed in 0..200u64 {
            let delay = throttle_delay_ms(Some(0), 0, 2_000, 1_200, seed);
            assert!(
                (2_000..=3_200).contains(&delay),
                "jittered delay {delay} escaped 2000..=3200 for seed {seed}"
            );
            seen.insert(delay);
        }
        assert!(
            seen.len() > 50,
            "jitter collapsed to {} distinct gaps; a fixed period is what \
             makes the cadence machine-shaped in the first place",
            seen.len()
        );
    }

    #[test]
    fn zero_jitter_yields_exactly_the_minimum_interval() {
        assert_eq!(throttle_delay_ms(Some(0), 0, 2_000, 0, 123), 2_000);
    }

    #[test]
    fn a_reserved_slot_in_the_future_extends_the_wait() {
        // A slot reserved at now+3000: the next caller must wait 3000 + the
        // full interval, not the interval minus zero elapsed.
        assert_eq!(throttle_delay_ms(Some(4_000), 1_000, 2_000, 0, 0), 5_000);
    }
}
