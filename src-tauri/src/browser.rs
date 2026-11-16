// browser.rs — Embedded browser panel (Tauri Multi-Webview)
//
// Manages child Webview instances for in-app web browsing.
// Each Chat Tab can have one browser Webview. The Webview floats
// above the React DOM at OS level, positioned by frontend coordinates.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url,
};
use tokio::sync::Mutex;

use crate::browser_profile;
use crate::{ulog_info, ulog_warn};
use std::path::Path;

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

/// User-Agent for the embedded browser webview.
///
/// The default WebView UA on each platform is missing parts (macOS WKWebView
/// drops the `Version/X Safari/Y` suffix; Windows WebView2 advertises Edge
/// instead of Chrome; Linux WebKitGTK is rarer and frequently fingerprinted
/// as a bot) which several big sites — baidu.com main page is the canonical
/// case — flag and respond to with degraded/empty pages or redirect chains.
/// (A user session log showed baidu.com cycling at ~30 redirects/sec.)
///
/// We pretend to be a recent stable Chrome on each host OS rather than the
/// host engine's actual identity: most sites — especially the CN ecosystem —
/// optimize for Chrome and the recognition rate is highest there. The
/// tradeoff is that some UA-sniffing sites may serve Blink-only code paths
/// that the host engine (WebKit on macOS, WebKit2GTK on Linux) doesn't
/// implement identically. Worth it for the "things actually load" win.
#[cfg(target_os = "macos")]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
#[cfg(target_os = "windows")]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
#[cfg(target_os = "linux")]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

/// Document-start init script injected into every page in the embedded
/// browser. Two responsibilities:
///
/// 1. **`window.open` shim** — we don't have multi-tab; route programmatic
///    `window.open(url)` calls to the same page so the user actually sees
///    something happen instead of a silently-blocked popup. (WKWebView's
///    `javaScriptCanOpenWindowsAutomatically` defaults to false and isn't
///    exposed by wry, so non-user-gesture window.open never reaches our
///    on_new_window handler.) The `<a target="_blank">` path goes through
///    on_new_window → navigate-current-webview separately.
///
/// 2. **Cmd/Ctrl/middle-click escape hatch** — power users expect modifier+
///    click to open in the system browser. Since wry's on_new_window doesn't
///    surface modifier state, we intercept the click in JS and signal Rust
///    via a navigation to a custom `hamuna-internal://open-external/?url=`
///    scheme. on_navigation parses the request, opens the target in the OS
///    default browser, and cancels the navigation so the current page stays.
///    An iframe is used so the trigger doesn't replace the visible page.
const BROWSER_INIT_SCRIPT: &str = r#"
(function() {
  if (window.__hamunaBrowserShimInstalled) return;
  window.__hamunaBrowserShimInstalled = true;

  // 1. Route window.open() to current page (no multi-tab support).
  var origOpen = window.open;
  window.open = function(url, target, features) {
    if (url && /^https?:/i.test(String(url))) {
      window.location.href = String(url);
      return window;
    }
    return origOpen ? origOpen.apply(this, arguments) : null;
  };

  // 2. Cmd/Ctrl/middle-click on links → external browser via custom scheme.
  function handleClick(e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.href;
    if (!href || !/^https?:/i.test(href)) return;
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      var ifr = document.createElement('iframe');
      ifr.src = 'hamuna-internal://open-external/?url=' + encodeURIComponent(href);
      ifr.style.display = 'none';
      (document.documentElement || document.body).appendChild(ifr);
      setTimeout(function() {
        if (ifr.parentNode) ifr.parentNode.removeChild(ifr);
      }, 100);
    }
  }
  document.addEventListener('click', handleClick, true);
  document.addEventListener('auxclick', handleClick, true);
})();
"#;

/// Spawn the OS default-browser opener for a URL. URL must already be
/// validated as http/https/mailto by the caller — we don't want to hand
/// arbitrary schemes (`file:`, `javascript:`, etc.) to the system opener.
///
/// `pub(crate)` so the main-window navigation handler (`lib.rs::setup`) can
/// reuse the same exec path when it intercepts an external-frame navigation
/// and reroutes it to the OS default browser.
pub(crate) fn spawn_external_open(url: &str) {
    // All three platform arms route through process_cmd::new for the
    // single-mental-model rule. The Windows arm in particular benefits —
    // `cmd /C start` is a console-subsystem binary, so CREATE_NO_WINDOW
    // (set inside process_cmd::new) actually suppresses a brief CMD window
    // flash that the previous raw Command::new spawn would have produced.
    // macOS `open` and Linux `xdg-open` are unaffected (CREATE_NO_WINDOW
    // is Windows-only).
    #[cfg(target_os = "macos")]
    let res = crate::process_cmd::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let res = shell_execute_open(url);
    #[cfg(target_os = "linux")]
    let res = crate::process_cmd::new("xdg-open").arg(url).spawn();

    if let Err(e) = res {
        ulog_info!("[browser] spawn_external_open failed for {}: {}", url, e);
    }
}

#[cfg(target_os = "windows")]
fn shell_execute_open(url: &str) -> Result<(), String> {
    let operation = wide_null_terminated("open");
    let target = wide_null_terminated(url);
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "ShellExecuteW failed with code {}",
            result as isize
        ))
    }
}

#[cfg(target_os = "windows")]
fn wide_null_terminated(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A webview's container bounds are "degenerate" when width or height is
/// non-positive. The renderer positions the OS-level webview over a React div
/// via `getBoundingClientRect()`, and that div momentarily reports 0×N (or
/// 0×0 when `display:none`) while the split panel slides in behind a 300ms
/// width transition. Applying such bounds collapses the webview and floats it
/// over the chat area (issue #290). The renderer already filters these, but we
/// re-check here so no caller can poison the cached geometry that `SHOW`
/// restores from. NaN is non-finite, so it's caught too.
fn is_degenerate_bounds(width: f64, height: f64) -> bool {
    let usable = width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0;
    !usable
}

/// CSS px → GTK device px.
///
/// GDK scales the whole window by the window's scale factor and the webview's
/// `devicePixelRatio` is that same factor, so a DOM rect in CSS px has to be
/// scaled before it is handed to GTK. Kept platform-independent so it can be
/// unit-tested on every host, not just Linux.
fn device_px(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// Parse a URL string that may be an absolute file path or an http(s) URL.
/// Handles both Unix (`/Users/...`) and Windows (`C:\Users\...`) paths.
fn parse_url_or_path(url: &str) -> Result<Url, String> {
    let path = Path::new(url);
    if path.is_absolute() {
        Url::from_file_path(path).map_err(|_| format!("Invalid file path: {}", url))
    } else {
        url.parse().map_err(|e| format!("Invalid URL: {e}"))
    }
}

/// Is this host a private / loopback / link-local address the agent must not
/// be able to reach?
///
/// The agent drives the browser from a model turn that may have been steered
/// by page content, so the URL is not trustworthy input. Without this guard,
/// `hamuna browser open http://127.0.0.1:<port>/api/…` would let the agent
/// reach this app's own admin / management endpoints (loopback), the cloud
/// metadata service (`169.254.169.254`), or anything on the user's LAN.
///
/// This is the LITERAL check only — a public hostname that resolves to a
/// private IP still passes (DNS pinning at connect time is the fix for that
/// and is out of scope here; the webview, not a fetch, does the connecting).
fn is_private_agent_host(host: &str) -> bool {
    let h = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_lowercase();
    if h.is_empty() {
        return true;
    }
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    // IPv6 literals: loopback / unspecified / ULA / link-local, plus the
    // IPv4-mapped and IPv4-compatible forms that hide a private IPv4.
    if h.contains(':') {
        if h == "::" || h == "::0" || h == "::1" {
            return true;
        }
        if h.starts_with("::ffff:") {
            return true;
        }
        if h.starts_with("fc") || h.starts_with("fd") || h.starts_with("fe80:") {
            return true;
        }
        return false;
    }
    // IPv4 literals.
    if h.starts_with("127.") || h.starts_with("10.") || h.starts_with("192.168.") {
        return true;
    }
    if h.starts_with("169.254.") || h == "0.0.0.0" {
        return true;
    }
    if let Some(rest) = h.strip_prefix("172.") {
        if let Some(second) = rest.split('.').next() {
            if let Ok(octet) = second.parse::<u8>() {
                if (16..=31).contains(&octet) {
                    return true;
                }
            }
        }
    }
    false
}

/// Parse a URL for agent-driven navigation.
///
/// Unlike `parse_url_or_path` (which serves the user-facing preview, where a
/// local file path is legitimate), this rejects every non-http(s) scheme.
/// The agent supplies the URL from a model turn that may have been steered
/// by page content, so `javascript:`, `data:` and `file:` must not be
/// reachable from this path — `javascript:` in particular would execute in
/// the webview's page context.
///
/// Private / loopback hosts are rejected too (see `is_private_agent_host`):
/// the agent must not be able to point the embedded browser at this app's own
/// admin endpoints or at cloud metadata.
pub fn parse_agent_url(url: &str) -> Result<Url, String> {
    let parsed = parse_url_or_path(url)?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!(
                "Only http and https URLs can be opened by the agent (got '{other}')"
            ))
        }
    }
    let host = parsed.host_str().unwrap_or("");
    if is_private_agent_host(host) {
        return Err(format!(
            "The agent cannot open private or loopback addresses (got '{host}')"
        ));
    }
    Ok(parsed)
}

/// How many browser tabs one owner (Chat tab) may hold at a time.
///
/// A hard cap, not a suggestion: every tab is a live native webview with its
/// own process-level resources, so an uncapped strip would let a stray
/// "open in new tab" loop eat the machine.
pub const MAX_BROWSER_TABS: usize = 3;

/// One embedded browser tab — a single native child Webview.
///
/// A Chat tab owns up to [`MAX_BROWSER_TABS`] of these. Two ids matter and
/// they are NOT the same thing:
///
/// - `owner_tab_id` — the renderer's tab id (the Chat tab, or
///   `social-login-<platform>`). Groups the tabs of one panel.
/// - the map key — the *browser tab id* (`bt-7`), one per webview. This is
///   what the renderer passes back and what the native events are keyed by.
///
/// The agent never sees either: it addresses the browser by Chat session id
/// and always lands on the owner's **selected** tab.
#[derive(Clone)]
pub struct BrowserSession {
    webview_label: String,
    /// Renderer-side owner tab id — see the type docs.
    owner_tab_id: String,
    /// Chat session that owns this tab. The agent CLI addresses the browser
    /// by session id (it only knows `HAMUNA_SESSION_ID`), never by tab id —
    /// tab ids are a renderer-only concept.
    ///
    /// The id rotates: a fresh Chat starts as `pending-<tabId>` and is upgraded
    /// to a real UUID once the SDK reports `system_init`. The renderer re-binds
    /// the browser to the new id (see `cmd_browser_set_session`), so this field
    /// always holds the id the agent will actually use.
    session_id: Option<String>,
    /// Monotonic creation stamp. It doubles as the display order of a
    /// owner's tabs (oldest first) and as the agent-facing tab index.
    created_at: u64,
    /// Frontmost tab of its owner — the one the agent drives.
    selected: bool,
    /// Whether the owner's panel is on screen.
    ///
    /// Native visibility is *derived*, never stored per tab: a tab is visible
    /// iff `panel_visible && selected`. One rule, one place (`apply_visibility`),
    /// so "which webview is on screen" can never disagree with "which tab the
    /// agent is driving".
    panel_visible: bool,
    /// Cache last-known position/size for show-after-hide restoration.
    last_x: f64,
    last_y: f64,
    last_width: f64,
    last_height: f64,
}

impl BrowserSession {
    /// The renderer-side owner (the Chat tab) this browser tab belongs to.
    pub fn owner_tab_id(&self) -> &str {
        &self.owner_tab_id
    }

    /// Whether this tab is the frontmost one of its owner.
    pub fn is_selected(&self) -> bool {
        self.selected
    }

    /// The native webview label backing this tab.
    pub fn webview_label(&self) -> &str {
        &self.webview_label
    }
}

pub struct BrowserManager {
    /// browser tab id → session.
    sessions: Mutex<HashMap<String, BrowserSession>>,
    /// browser tab id → last known URL.
    ///
    /// A separate *sync* mutex because the webview's navigation callbacks
    /// fire on the UI thread and cannot await the async session lock. Kept
    /// apart from the session map so a slow page cannot block the registry.
    urls: std::sync::Mutex<HashMap<String, String>>,
}

/// Global handle to the one `BrowserManager`, so the Rust Management API can
/// reach browser sessions without Tauri `State` injection. Same pattern as
/// `task::set_task_store` — points at the SAME manager the Tauri commands use.
static BROWSER_MANAGER: OnceLock<Arc<BrowserManager>> = OnceLock::new();

/// Publish the manager for Management API access. Called once at app startup.
pub fn set_browser_manager(manager: Arc<BrowserManager>) {
    if BROWSER_MANAGER.set(manager).is_err() {
        ulog_warn!("[browser] browser manager already initialized");
    }
}

/// Retrieve the published manager, or None before app startup finished.
pub fn get_browser_manager() -> Option<&'static Arc<BrowserManager>> {
    BROWSER_MANAGER.get()
}

/// Monotonic counter giving each browser session a creation stamp, so
/// "most recently created" lookups are stable even when two sessions share
/// a Chat session id.
static SESSION_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_session_seq() -> u64 {
    SESSION_SEQ.fetch_add(1, Ordering::Relaxed)
}

impl BrowserManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            urls: std::sync::Mutex::new(HashMap::new()),
        })
    }

    /// Record the URL a browser tab is on (called from the navigation hooks).
    pub fn record_url(&self, browser_tab_id: &str, url: String) {
        if let Ok(mut urls) = self.urls.lock() {
            urls.insert(browser_tab_id.to_string(), url);
        }
    }

    /// Last known URL of a browser tab.
    pub fn url_of(&self, browser_tab_id: &str) -> Option<String> {
        self.urls.lock().ok()?.get(browser_tab_id).cloned()
    }

    /// Drop the cached URL of a closed browser tab.
    pub fn forget_url(&self, browser_tab_id: &str) {
        if let Ok(mut urls) = self.urls.lock() {
            urls.remove(browser_tab_id);
        }
    }

    /// The owner tab id of the browser that serves `session_id`.
    pub async fn owner_for_session_id(&self, session_id: &str) -> Option<String> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .find(|session| session.session_id.as_deref() == Some(session_id))
            .map(|session| session.owner_tab_id.clone())
    }

    /// Every tab of one owner, oldest first.
    ///
    /// Creation order is the display order of the tab strip and the index
    /// space the agent sees (`browser tabs`).
    pub async fn tabs_of_owner(&self, owner_tab_id: &str) -> Vec<(String, BrowserSession)> {
        let sessions = self.sessions.lock().await;
        let mut tabs: Vec<(String, BrowserSession)> = sessions
            .iter()
            .filter(|(_, session)| session.owner_tab_id == owner_tab_id)
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect();
        tabs.sort_by_key(|(_, session)| session.created_at);
        tabs
    }

    /// The selected (frontmost) tab of one owner.
    ///
    /// Falls back to the newest tab when none is marked selected — that only
    /// happens mid-teardown, and "newest" is the least surprising answer.
    pub async fn selected_tab_of_owner(
        &self,
        owner_tab_id: &str,
    ) -> Option<(String, BrowserSession)> {
        let tabs = self.tabs_of_owner(owner_tab_id).await;
        tabs.iter()
            .find(|(_, session)| session.selected)
            .cloned()
            .or_else(|| tabs.last().cloned())
    }

    /// Can this owner open one more browser tab?
    ///
    /// The cap is a hard limit, not a suggestion: every tab is a live native
    /// webview with its own process-level resources, so an uncapped strip
    /// would let a stray "open in new tab" loop eat the machine.
    pub async fn has_tab_capacity(&self, owner_tab_id: &str) -> bool {
        self.tabs_of_owner(owner_tab_id).await.len() < MAX_BROWSER_TABS
    }

    /// Find the browser session owned by a Chat session id.
    ///
    /// The agent CLI addresses the browser by `HAMUNA_SESSION_ID` — it has no
    /// way to know the renderer-side tab id. The owner's *selected* tab wins:
    /// with several tabs open, "the browser" is the one the user is looking
    /// at, and it is the one the agent should be driving.
    pub async fn session_for_session_id(&self, session_id: &str) -> Option<(String, String)> {
        let sessions = self.sessions.lock().await;
        let mut matches: Vec<(&String, &BrowserSession)> = sessions
            .iter()
            .filter(|(_, session)| session.session_id.as_deref() == Some(session_id))
            .collect();
        matches.sort_by_key(|(_, session)| session.created_at);
        let chosen = matches
            .iter()
            .rev()
            .find(|(_, session)| session.selected)
            .or_else(|| matches.last())?;
        Some((chosen.0.clone(), chosen.1.webview_label.clone()))
    }

    /// The most recently created browser tab, regardless of owner.
    ///
    /// Fallback for callers with no Chat session to address — the CLI's
    /// `status` command, and agents running outside a Chat (cron, IM).
    pub async fn any_session(&self) -> Option<(String, String)> {
        let sessions = self.sessions.lock().await;
        let mut owners: HashMap<&str, u64> = HashMap::new();
        for session in sessions.values() {
            let slot = owners.entry(session.owner_tab_id.as_str()).or_insert(0);
            *slot = (*slot).max(session.created_at);
        }
        let newest_owner = owners.into_iter().max_by_key(|(_, stamp)| *stamp)?.0;
        let chosen = sessions
            .iter()
            .filter(|(_, session)| session.owner_tab_id == newest_owner)
            .max_by_key(|(_, session)| session.created_at)?;
        Some((chosen.0.clone(), chosen.1.webview_label.clone()))
    }

    /// The owner tab id of the most recently created browser, regardless of owner.
    ///
    /// Counterpart of [`Self::any_session`] for callers that work in owner
    /// space (the tab strip) rather than in webview space.
    pub async fn any_owner(&self) -> Option<String> {
        let sessions = self.sessions.lock().await;
        let mut owners: HashMap<&str, u64> = HashMap::new();
        for session in sessions.values() {
            let slot = owners.entry(session.owner_tab_id.as_str()).or_insert(0);
            *slot = (*slot).max(session.created_at);
        }
        owners
            .into_iter()
            .max_by_key(|(_, stamp)| *stamp)
            .map(|(owner, _)| owner.to_string())
    }

    /// Wait until a browser session for `session_id` exists.
    ///
    /// Used after asking the renderer to open the browser panel: the
    /// renderer creates the webview asynchronously, so the agent's request
    /// has to wait for that to land before it can drive the page.
    pub async fn wait_for_session(
        &self,
        session_id: &str,
        timeout: std::time::Duration,
    ) -> Option<(String, String)> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some(found) = self.session_for_session_id(session_id).await {
                return Some(found);
            }
            if std::time::Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        }
    }
}

// ──────────────────────────────────────────────────────────
// Linux child-webview positioning
// ──────────────────────────────────────────────────────────
//
// On Linux Tauri builds a child webview straight into the window's `GtkBox`
// (`Window::add_child` → wry's `build_gtk(vbox)` → `pack_start`), which
// ignores the requested x/y — the browser lands as a full-width strip under
// the app UI instead of on the browser panel. wry's `set_bounds` cannot
// repair it either: it only calls `size_allocate` when the parent is a
// `GtkFixed` (`is_in_fixed_parent`), and that flag is frozen at creation.
//
// Fix: re-parent the app webview into a `GtkOverlay` (it stays the overlay's
// MAIN child, so it keeps filling the window) and park every browser webview
// in a `GtkFixed` inside that overlay — the only GTK3 container that honours
// absolute coordinates. The overlay's preferred size comes from its MAIN
// child alone, so the browser's offset never inflates the window's minimum
// size.
//
// The `GtkFixed` MUST be `set_overlay_pass_through(…, true)`. Overlay children
// default to `GTK_ALIGN_FILL`, so the fixed is allocated the whole window, and
// GTK3 dispatches pointer events purely by "which GdkWindow owns this event"
// — `gtk_main_do_event` → `gtk_get_event_widget` → `gdk_window_get_user_data`,
// with no coordinate-based widget picking anywhere. A full-window fixed is a
// real (invisible) GdkWindow sitting above the app webview's, so it swallows
// every press and the entire UI outside the browser page goes dead. Pass-
// through makes GDK hit-test *through* the fixed's window while its children
// (the browser webview's own window) stay clickable — verified with a GTK3
// probe on 2026-10: app click → app page, browser click → browser page.
//
// This mirrors wry's own advice for Linux child webviews ("use `new_gtk`
// with `gtk::Fixed`"), which Tauri's `add_child` cannot express because it
// always hands wry the window's `GtkBox`.
//
// Verified with a standalone GTK3 probe (2026-10): a `GtkFixed` child lands
// at exactly the requested (x, y, w, h), an overlay child is allocated
// MAX(overlay area, natural size) so it is never clipped, and the overlay's
// minimum size stays that of its main child.
#[cfg(target_os = "linux")]
mod linux_layout {
    use gtk::prelude::*;

    use super::device_px;

    /// Create the browser host on first use: the app webview becomes the MAIN
    /// child of a fresh `GtkOverlay`, and the overlay's `GtkFixed` child is
    /// where browser webviews get positioned.
    ///
    /// MUST run on the GTK main thread.
    fn ensure_host(window: &tauri::Window, main_widget: &gtk::Widget) -> Result<(), String> {
        let vbox = window
            .default_vbox()
            .map_err(|e| format!("default_vbox failed: {e}"))?;

        let vbox_children = vbox.children();
        if let Some(overlay) = vbox_children
            .iter()
            .find_map(|child| child.downcast_ref::<gtk::Overlay>())
        {
            let overlay_children = overlay.children();
            if overlay_children
                .iter()
                .find_map(|child| child.downcast_ref::<gtk::Fixed>())
                .is_none()
            {
                let fixed = gtk::Fixed::new();
                // 0×0 keeps the fixed out of the window's minimum size — the
                // overlay hands it the full area anyway.
                fixed.set_size_request(0, 0);
                overlay.add_overlay(&fixed);
                overlay.set_overlay_pass_through(&fixed, true);
                fixed.show_all();
            }
            return Ok(());
        }

        // First use: the app webview moves into the overlay so it keeps
        // filling the whole window as the overlay's MAIN child.
        detach(main_widget);
        let overlay = gtk::Overlay::new();
        overlay.add(main_widget);
        let fixed = gtk::Fixed::new();
        fixed.set_size_request(0, 0);
        overlay.add_overlay(&fixed);
        // Without pass-through the full-window fixed would swallow every
        // pointer event for the app webview behind it. See the module docs.
        overlay.set_overlay_pass_through(&fixed, true);
        vbox.pack_start(&overlay, true, true, 0);
        // The browser webview may already be packed into the box (wry packs
        // it there when it builds the child), so the overlay has to be moved
        // to the front — otherwise the app webview would end up *below* the
        // browser instead of filling the window behind it.
        vbox.reorder_child(&overlay, 0);
        overlay.show_all();
        Ok(())
    }

    /// Park a browser webview in the host's `GtkFixed` at (x, y) with
    /// (width, height) — GTK device pixels.
    ///
    /// MUST run on the GTK main thread.
    fn place<W: IsA<gtk::Widget> + Clone>(
        window: &tauri::Window,
        browser: &W,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        let fixed = find_fixed(window)?;
        let widget: gtk::Widget = browser.clone().upcast();
        // `gtk_fixed_put` refuses a widget that still has a parent — the
        // webview is born inside the window's box.
        detach(&widget);
        apply_size_request(&widget, width, height);
        fixed.put(&widget, x, y);
        fixed.show_all();
        Ok(())
    }

    /// Move an already-placed browser webview.
    ///
    /// MUST run on the GTK main thread.
    fn reposition<W: IsA<gtk::Widget> + Clone>(
        browser: &W,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        let widget: gtk::Widget = browser.clone().upcast();
        let parent = widget
            .parent()
            .ok_or_else(|| "browser webview is not in the host".to_string())?;
        let fixed = parent
            .downcast_ref::<gtk::Fixed>()
            .ok_or_else(|| "browser webview is not in a GtkFixed".to_string())?;
        apply_size_request(&widget, width, height);
        fixed.move_(&widget, x, y);
        Ok(())
    }

    /// Resize `widget` and *invalidate its cached size request*.
    ///
    /// `gtk_widget_set_size_request` only queues a resize when the widget is
    /// visible (`gtk_widget_set_usize_internal`: `if (_gtk_widget_get_visible
    /// (widget) && changed) gtk_widget_queue_resize (widget);`). A hidden
    /// widget therefore keeps `resize_needed == false`, so its size-request
    /// cache keeps the *old* value and `gtk_widget_get_preferred_size` (what
    /// `gtk_fixed_size_allocate` allocates by) answers with the stale minimum
    /// for as long as the widget lives.
    ///
    /// The browser webview hits that path on every panel open: React hides it
    /// while the page is blank, the width reconciler resizes it while hidden
    /// (see `BrowserPanel`: "cmd_browser_resize updates Rust's cached geometry
    /// on hidden webviews"), and the later SHOW then allocates the widget at
    /// the width it had *at creation* — 132px when the panel was created
    /// mid-expand-animation — leaving the page squeezed into a strip while
    /// the React toolbar spans the full panel.
    ///
    /// `gtk_widget_queue_resize` sets `resize_needed` unconditionally
    /// (`gtk_widget_queue_resize_on_widget`), which makes the next
    /// `gtk_widget_ensure_resize` drop the cache.
    fn apply_size_request(widget: &gtk::Widget, width: i32, height: i32) {
        widget.set_size_request(width, height);
        widget.queue_resize();
    }

    /// Detach a widget from whatever container currently holds it.
    fn detach(widget: &gtk::Widget) {
        if let Some(parent) = widget.parent() {
            if let Ok(container) = parent.downcast::<gtk::Container>() {
                container.remove(widget);
            }
        }
    }

    /// The `GtkFixed` inside the window's overlay host.
    fn find_fixed(window: &tauri::Window) -> Result<gtk::Fixed, String> {
        let vbox = window
            .default_vbox()
            .map_err(|e| format!("default_vbox failed: {e}"))?;
        let vbox_children = vbox.children();
        let overlay = vbox_children
            .iter()
            .find_map(|child| child.downcast_ref::<gtk::Overlay>())
            .ok_or_else(|| "browser host overlay is missing".to_string())?;
        let overlay_children = overlay.children();
        overlay_children
            .iter()
            .find_map(|child| child.downcast_ref::<gtk::Fixed>())
            .cloned()
            .ok_or_else(|| "browser host fixed is missing".to_string())
    }

    /// Attach a freshly created browser webview to the host and place it on
    /// the panel rect (CSS px).
    pub fn attach(
        window: &tauri::Window,
        main_webview: &tauri::Webview,
        browser_webview: &tauri::Webview,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let scale = window.scale_factor().unwrap_or(1.0);
        let (px, py) = (device_px(x, scale), device_px(y, scale));
        let (pw, ph) = (device_px(width, scale), device_px(height, scale));

        // The host is created on first use; only the app webview can become
        // the overlay's MAIN child.
        let win = window.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        main_webview
            .with_webview(move |platform| {
                let main_widget: gtk::Widget = platform.inner().upcast();
                let _ = tx.send(ensure_host(&win, &main_widget));
            })
            .map_err(|e| format!("with_webview failed: {e}"))?;
        rx.recv()
            .map_err(|_| "host task was dropped".to_string())??;

        // Park the browser webview in the fixed.
        let win = window.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        browser_webview
            .with_webview(move |platform| {
                let browser_widget: gtk::Widget = platform.inner().upcast();
                let _ = tx.send(place(&win, &browser_widget, px, py, pw, ph));
            })
            .map_err(|e| format!("with_webview failed: {e}"))?;
        rx.recv()
            .map_err(|_| "place task was dropped".to_string())??;
        Ok(())
    }

    /// Move an attached browser webview to a new panel rect (CSS px).
    pub fn move_to(
        window: &tauri::Window,
        browser_webview: &tauri::Webview,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let scale = window.scale_factor().unwrap_or(1.0);
        let (px, py) = (device_px(x, scale), device_px(y, scale));
        let (pw, ph) = (device_px(width, scale), device_px(height, scale));
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        browser_webview
            .with_webview(move |platform| {
                let browser_widget: gtk::Widget = platform.inner().upcast();
                let _ = tx.send(reposition(&browser_widget, px, py, pw, ph));
            })
            .map_err(|e| format!("with_webview failed: {e}"))?;
        rx.recv()
            .map_err(|_| "reposition task was dropped".to_string())??;
        Ok(())
    }
}

/// Run `task` on the GTK main thread and wait for its result.
///
/// Same shape as Tauri's own `Window::add_child`. MUST NOT be called from the
/// main thread — the closure would be queued behind the blocked caller and
/// never run.
#[cfg(target_os = "linux")]
fn on_main_thread<T: Send + 'static>(
    window: &tauri::Window,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(task());
        })
        .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
    rx.recv()
        .map_err(|_| "main-thread task was dropped".to_string())?
}

// ──────────────────────────────────────────────────────────
// IPC Commands
// ──────────────────────────────────────────────────────────

/// Create a child Webview for the given owner tab, positioned at (x, y) with
/// (width, height). Returns the new **browser tab id** — the renderer keys
/// every later call (and every native event) by it.
#[tauri::command]
pub async fn cmd_browser_create(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    session_id: Option<String>,
    workspace: Option<String>,
) -> Result<String, String> {
    let _update_spawn_permit = crate::sidecar::begin_update_spawn_permit()?;

    // One owner holds at most MAX_BROWSER_TABS webviews. Checked before
    // anything is created so a rejected call leaves no webview behind.
    {
        let sessions = state.sessions.lock().await;
        let open = sessions
            .values()
            .filter(|session| session.owner_tab_id == tab_id)
            .count();
        if open >= MAX_BROWSER_TABS {
            ulog_info!(
                "[browser] Tab limit reached for owner {} ({}/{})",
                tab_id,
                open,
                MAX_BROWSER_TABS
            );
            return Err(format!(
                "This browser already has {MAX_BROWSER_TABS} tabs — close one before opening another."
            ));
        }
    }

    // The browser tab id is its own identity: the owner tab id may hold several
    // webviews, so it cannot be the map key. `bt-<seq>` is unique for the app's
    // lifetime and is a valid Tauri webview label / event-name suffix.
    let seq = next_session_seq();
    let browser_tab_id = format!("bt-{}", seq);
    let label = format!("browser-{}", browser_tab_id);

    ulog_info!(
        "[browser] cmd_browser_create: owner={} browser_tab={} url={} pos=({},{}) size={}x{}",
        tab_id,
        browser_tab_id,
        url,
        x,
        y,
        width,
        height
    );

    // Clamp degenerate bounds up to a 1px floor so the OS webview is never born
    // collapsed and — critically — the cached `last_width/height` (which SHOW
    // restores from) can never be seeded with zeros (issue #290). The renderer
    // already defers creation until the container is laid out, so this only
    // fires for an unexpected/future caller; the post-create ResizeObserver
    // immediately corrects the size. NaN/non-finite are caught by the same
    // guard since they aren't `> 0.0`.
    let (width, height) = if is_degenerate_bounds(width, height) {
        ulog_info!(
            "[browser] cmd_browser_create: clamping degenerate bounds {}x{} to 1px floor for tab {}",
            width, height, tab_id
        );
        (width.max(1.0), height.max(1.0))
    } else {
        (width, height)
    };

    let parsed_url = parse_url_or_path(&url)?;

    // 每个工作区一套浏览器 profile：cookie / localStorage / IndexedDB 都不跨
    // 工作区，所以「在 A 工作区登录的号」在 B 工作区根本不存在。
    //
    // 传了工作区却推不出 profile 时**直接失败**，不回落共享 profile —— 回落
    // 等于「以为隔离了其实没隔离」，那比没有隔离更危险：用户会拿一个不属于
    // 这个工作区的登录态去发布。
    let profile = match workspace
        .as_deref()
        .map(str::trim)
        .filter(|w| !w.is_empty())
    {
        Some(workspace) => Some(browser_profile::profile_for_workspace(workspace)?),
        None => None,
    };
    if let Some(profile) = &profile {
        ulog_info!(
            "[browser] workspace profile {} for owner {}",
            profile.key,
            tab_id
        );
        #[cfg(not(target_os = "macos"))]
        profile.ensure_data_directory()?;
    }

    // Clone values for closures
    let app_nav = app.clone();
    let tab_id_nav = browser_tab_id.clone();
    let app_load = app.clone();
    let tab_id_load = browser_tab_id.clone();
    let app_new_win = app.clone();
    let label_new_win = label.clone();
    // The navigation hooks run on the UI thread — they cannot await the async
    // session lock, so the URL goes into the manager's sync URL map.
    let manager_nav = state.inner().clone();
    let manager_load = state.inner().clone();

    let mut builder = WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url.clone()))
        .user_agent(BROWSER_USER_AGENT)
        .initialization_script(BROWSER_INIT_SCRIPT)
        .on_navigation(move |nav_url| {
            let scheme = nav_url.scheme();
            // Security: block dangerous schemes; allow everything else.
            // file: is allowed — used for local HTML preview; the webview is
            // already sandboxed (browser.json zero Tauri permissions).
            if scheme == "javascript" {
                ulog_info!(
                    "[browser] on_navigation BLOCKED: {} (scheme: {})",
                    nav_url,
                    scheme
                );
                return false;
            }
            // Internal signaling channel: BROWSER_INIT_SCRIPT triggers an
            // iframe nav to hamuna-internal://open-external/?url=… on
            // Cmd/Ctrl/middle-click. Hand the URL to the OS default browser
            // and cancel the navigation so the current page is undisturbed.
            if scheme == "hamuna-internal" && nav_url.host_str() == Some("open-external") {
                let target_str = nav_url
                    .query_pairs()
                    .find(|(k, _)| k == "url")
                    .map(|(_, v)| v.into_owned());
                if let Some(target_str) = target_str {
                    if let Ok(target) = Url::parse(&target_str) {
                        if matches!(target.scheme(), "http" | "https" | "mailto") {
                            ulog_info!(
                                "[browser] open-external (Cmd/Ctrl/middle-click): {}",
                                target
                            );
                            spawn_external_open(target.as_str());
                        } else {
                            ulog_info!(
                                "[browser] open-external rejected non-allowlisted scheme: {}",
                                target.scheme()
                            );
                        }
                    }
                }
                return false;
            }
            // Emit URL changes for http/https/file (skip about:, data:, blob: noise)
            if scheme == "http" || scheme == "https" || scheme == "file" {
                ulog_info!("[browser] on_navigation ALLOW: {}", nav_url);
                manager_nav.record_url(&tab_id_nav, nav_url.to_string());
                let _ = app_nav.emit(
                    &format!("browser:url-changed:{}", tab_id_nav),
                    nav_url.to_string(),
                );
            } else {
                ulog_info!(
                    "[browser] on_navigation ALLOW (internal): {} (scheme: {})",
                    nav_url,
                    scheme
                );
            }
            true
        })
        .on_page_load(move |_webview, payload| {
            let url_str = payload.url().to_string();
            let event_name = format!("browser:loading:{}", tab_id_load);
            match payload.event() {
                PageLoadEvent::Started => {
                    ulog_info!("[browser] on_page_load STARTED: {}", url_str);
                    let _ = app_load.emit(&event_name, true);
                }
                PageLoadEvent::Finished => {
                    ulog_info!("[browser] on_page_load FINISHED: {}", url_str);
                    // Every navigation that actually happened counts toward
                    // the per-host pacing, including click-driven ones the
                    // agent never issued a `browser open` for. See
                    // `browser_throttle`.
                    if let Some(host) = payload.url().host_str() {
                        crate::browser_throttle::record_navigation(host);
                    }
                    let _ = app_load.emit(&event_name, false);
                    // Use the load-event's payload URL — calling _webview.url()
                    // here panics inside wry's url_from_webview when WKWebView.URL
                    // is nil (notably for about:blank in transient states), which
                    // tao's stop_app_on_panic then escalates to a process crash.
                    manager_load.record_url(&tab_id_load, url_str.clone());
                    let _ = app_load.emit(
                        &format!("browser:url-changed:{}", tab_id_load),
                        url_str.clone(),
                    );
                }
            }
        })
        .on_new_window(move |url, _features| {
            ulog_info!(
                "[browser] on_new_window: {} — redirecting to current webview",
                url
            );
            // Redirect target="_blank" / window.open() into the current webview
            let app = app_new_win.clone();
            let lbl = label_new_win.clone();
            let nav_url = url.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(webview) = app.get_webview(&lbl) {
                    let _ = webview.navigate(nav_url);
                }
            });
            tauri::webview::NewWindowResponse::Deny
        });

    // 平台各走各的隔离机制（见 browser_profile.rs）：
    // macOS 14+ 用命名的 WKWebView data store（`data_directory` 在 WKWebView
    // 上不存在），Windows / Linux 用独立的 data 目录（`data_store_identifier`
    // 在这两个平台上被 wry 忽略）。
    #[cfg(target_os = "macos")]
    if let Some(profile) = &profile {
        builder = builder.data_store_identifier(profile.data_store_identifier);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(profile) = &profile {
        builder = builder.data_directory(profile.data_directory.clone());
    }

    // Get the Window (not WebviewWindow) to add a child webview
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width, height);

    ulog_info!(
        "[browser] Calling window.add_child for label='{}' url={}",
        label,
        parsed_url
    );

    // Linux: `add_child` builds the child webview straight into the window's
    // GtkBox, which drops the requested x/y. Create it inside a single
    // main-thread turn and re-parent it into the overlay host right away, so
    // the browser never gets a frame in the wrong place.
    #[cfg(target_os = "linux")]
    {
        let win = window.clone();
        let main_webview = app
            .get_webview("main")
            .ok_or_else(|| "Main webview not found".to_string())?;
        on_main_thread(&window, move || {
            let child = win
                .add_child(builder, position, size)
                .map_err(|e| format!("Failed to create browser webview: {e}"))?;
            linux_layout::attach(&win, &main_webview, &child, x, y, width, height)
        })?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        window.add_child(builder, position, size).map_err(|e| {
            ulog_info!("[browser] add_child FAILED: {}", e);
            format!("Failed to create browser webview: {e}")
        })?;
    }

    ulog_info!("[browser] add_child SUCCESS for label='{}'", label);

    // NOTE: do NOT call `app.get_webview(&label).url()` here as a "health check".
    // wry's url_from_webview unwraps WKWebView.URL which may be nil for a
    // freshly-created webview (especially about:blank), and that unwrap panic
    // crashes the whole event loop via tao's stop_app_on_panic. See
    // wry-0.54.4/src/wkwebview/mod.rs:1349. add_child returning Ok is itself
    // sufficient evidence that the webview was created.

    // Store session. The new tab becomes the owner's frontmost one — the same
    // rule the agent sees ("the browser" = the tab on screen).
    {
        let mut sessions = state.sessions.lock().await;
        for session in sessions.values_mut() {
            if session.owner_tab_id == tab_id {
                session.selected = false;
            }
        }
        sessions.insert(
            browser_tab_id.clone(),
            BrowserSession {
                webview_label: label.clone(),
                owner_tab_id: tab_id.clone(),
                session_id,
                created_at: seq,
                selected: true,
                // The renderer only creates a tab while the panel is on
                // screen, so the owner is visible from the start.
                panel_visible: true,
                last_x: x,
                last_y: y,
                last_width: width,
                last_height: height,
            },
        );
    }

    // Hand the webviews over to the new frontmost tab (the previous one goes
    // off-screen).
    apply_visibility(&app, &state, &tab_id).await;

    let _ = app.emit(
        &format!("browser:tab-selected:{}", tab_id),
        browser_tab_id.clone(),
    );

    ulog_info!(
        "[browser] Created webview '{}' ({}) for owner {} — session stored",
        label,
        browser_tab_id,
        tab_id
    );
    Ok(browser_tab_id)
}

/// Push (x, y, width, height) onto a native webview.
///
/// Linux has no working `set_position`/`set_size`: wry only applies them
/// when the webview's parent is a `GtkFixed` at creation time, and Tauri
/// builds child webviews into the window's `GtkBox`. The webview lives in
/// the overlay host's `GtkFixed` instead, so it is moved there directly.
#[cfg(target_os = "linux")]
fn apply_geometry(
    app: &AppHandle,
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    linux_layout::move_to(&window, webview, x, y, width, height).map_err(|e| {
        ulog_warn!(
            "[browser] move_to({}, {}) {}x{} failed: {}",
            x,
            y,
            width,
            height,
            e
        );
        e
    })
}

#[cfg(not(target_os = "linux"))]
fn apply_geometry(
    _app: &AppHandle,
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| {
            ulog_warn!("[browser] set_position({}, {}) failed: {}", x, y, e);
            format!("set_position failed: {e}")
        })?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| {
            ulog_warn!("[browser] set_size({}x{}) failed: {}", width, height, e);
            format!("set_size failed: {e}")
        })
}

/// Enforce the native-visibility invariant for one owner.
///
/// The selected tab is on screen iff the owner's panel is on screen; every
/// other tab of that owner is hidden. One rule, applied from one place, so
/// "what the user sees" and "what the agent drives" can never drift apart.
async fn apply_visibility(app: &AppHandle, state: &BrowserManager, owner_tab_id: &str) {
    let tabs = state.tabs_of_owner(owner_tab_id).await;
    for (browser_tab_id, session) in tabs {
        let Some(webview) = app.get_webview(&session.webview_label) else {
            continue;
        };
        let should_show = session.panel_visible && session.selected;
        if should_show {
            // SHOW restores the cached geometry — the reconciler keeps that
            // cache current even while the tab is hidden.
            if let Err(e) = apply_geometry(
                app,
                &webview,
                session.last_x,
                session.last_y,
                session.last_width,
                session.last_height,
            ) {
                ulog_warn!(
                    "[browser] SHOW geometry restore failed for tab {}: {}",
                    browser_tab_id,
                    e
                );
            }
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
    }
}

/// Select one browser tab of an owner — the frontmost one.
///
/// The renderer calls this when the user picks a tab; the agent reaches it
/// through `browser select`. Either way the native visibility follows.
pub async fn select_browser_tab(
    app: &AppHandle,
    state: &BrowserManager,
    browser_tab_id: &str,
) -> Result<(), String> {
    let owner_tab_id = {
        let mut sessions = state.sessions.lock().await;
        let owner = sessions
            .get(browser_tab_id)
            .map(|session| session.owner_tab_id.clone())
            .ok_or_else(|| format!("No browser tab {}", browser_tab_id))?;
        for (id, session) in sessions.iter_mut() {
            if session.owner_tab_id == owner {
                session.selected = id == browser_tab_id;
            }
        }
        owner
    };

    apply_visibility(app, state, &owner_tab_id).await;

    // Tell the renderer which tab is frontmost — the agent can select a tab
    // behind the user's back, and the strip has to follow.
    let _ = app.emit(
        &format!("browser:tab-selected:{}", owner_tab_id),
        browser_tab_id.to_string(),
    );
    ulog_info!(
        "[browser] Selected tab {} of owner {}",
        browser_tab_id,
        owner_tab_id
    );
    Ok(())
}

/// Tauri command wrapper around [`select_browser_tab`].
#[tauri::command]
pub async fn cmd_browser_select(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    browser_tab_id: String,
) -> Result<(), String> {
    select_browser_tab(&app, &state, &browser_tab_id).await
}

/// Re-bind a tab's browser to a Chat session id.
///
/// The Chat session id is not stable for the lifetime of a tab: a fresh Chat
/// starts as `pending-<tabId>` and is upgraded to a real UUID once the SDK
/// reports `system_init`. The agent CLI only knows the *final* id (it reads
/// `HAMUNA_SESSION_ID` from its environment), so the browser has to be
/// re-pointed when the upgrade happens — otherwise every agent command would
/// look up a browser that does not exist.
///
/// Owner-scoped: every tab of the panel belongs to the same Chat session.
#[tauri::command]
pub async fn cmd_browser_set_session(
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    session_id: Option<String>,
) -> Result<(), String> {
    let next = session_id.filter(|id| !id.trim().is_empty());
    let mut sessions = state.sessions.lock().await;
    let mut rebound = false;
    for session in sessions.values_mut() {
        if session.owner_tab_id == tab_id && session.session_id != next {
            ulog_info!(
                "[browser] Rebinding browser for owner {}: session {:?} -> {:?}",
                tab_id,
                session.session_id,
                next
            );
            session.session_id = next.clone();
            rebound = true;
        }
    }
    if !rebound && !sessions.values().any(|s| s.owner_tab_id == tab_id) {
        return Err(format!("No browser for tab {}", tab_id));
    }
    Ok(())
}

/// Navigate the owner's frontmost browser tab to a new URL.
#[tauri::command]
pub async fn cmd_browser_navigate(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    ulog_info!("[browser] cmd_browser_navigate: tab={} url={}", tab_id, url);
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;

    let parsed_url = parse_url_or_path(&url)?;
    let webview = app
        .get_webview(&session.webview_label)
        .ok_or_else(|| "Webview not found".to_string())?;

    webview
        .navigate(parsed_url)
        .map_err(|e| format!("Navigation failed: {e}"))
}

/// Report which of the given cookie names exist for `url` in this webview.
///
/// This is the login-state authority the renderer needs before it can trust a
/// DOM probe. The cookie IS the login session — `socialPlatforms.ts` says so
/// verbatim ("登录态的权威是浏览器 cookie"), and the 2026-11 Douyin report
/// proved why that matters: the cookie jar already held `sessionid` /
/// `sid_tt` while the panel still showed the login page and never recorded
/// success.
///
/// Why a cookie check instead of another DOM probe, two independent reasons:
///
/// 1. The DOM probe has to evaluate JS in the page, and the page navigates at
///    exactly the moment login completes (`creator.douyin.com/` →
///    `/creator-micro/home`). An eval issued against the context being torn
///    down fails, and the caller's poll then has to guess whether that was a
///    transient miss or a real "not logged in" — the guess is what silently
///    made the panel never conclude success. Cookie reads do not touch the
///    page's JS context at all, so a navigation cannot eat them.
/// 2. Douyin's `sessionid` is **HttpOnly**. `document.cookie` cannot see it,
///    so no amount of DOM probing could ever find it. The cookie API is the
///    only reader that can.
///
/// Returns the subset that exists, not a boolean: the caller decides which
/// names constitute a login, and gets a diagnostic trail for free (the log
/// line in the caller names what was actually found).
///
/// ## Why `cookies()` and not `cookies_for_url()`
///
/// `cookies_for_url` is the tempting call, and it is **wrong on macOS**:
/// wry's macOS implementation filters with `cookie.domain() == url.domain()`
/// — *exact* equality (`wkwebview/mod.rs::cookies_for_url`). Douyin's
/// `sessionid` is a domain cookie stored on `.douyin.com`, so its domain
/// never equals `creator.douyin.com` and the cookie is silently dropped.
/// Linux and Windows do proper URI matching, which makes the bug
/// platform-dependent — the worst kind.
///
/// So: read the whole jar (`cookies()`) and do the domain matching here, as a
/// suffix match (host == domain, or host ends with `.` + domain). That is one
/// rule on every platform.
///
/// The domain match is not decoration: one workspace shares one browser
/// profile across platforms, so a `sessionid` cookie set by some unrelated
/// site would otherwise be read as "Douyin is logged in" — and the panel
/// would tell the user they're logged in when they are not.
///
/// `cookies()` on Windows deadlocks when called from a **synchronous** command
/// (tauri's own docs, wry issue #583). This command is `async` and does the
/// blocking read inside `spawn_blocking`, so the UI thread stays free to pump
/// the WebView2 completion callback.
#[tauri::command]
pub async fn cmd_browser_cookie_names(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    url: String,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;
    let label = session.webview_label.clone();

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Webview not found".to_string())?;

    let parsed = url
        .parse::<Url>()
        .map_err(|e| format!("Invalid cookie lookup URL: {e}"))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "Cookie lookup URL has no host".to_string())?
        .to_ascii_lowercase();

    // `cookies()` blocks the caller until the webview thread answers. The read
    // itself is a few hundred microseconds, but the wait crosses a thread
    // boundary, so it must not sit on the UI thread (Windows: the WebView2
    // completion callback is pumped by the UI thread — blocking it deadlocks).
    // `async` + `spawn_blocking` puts the wait on a worker instead.
    let cookies = tauri::async_runtime::spawn_blocking(move || webview.cookies())
        .await
        .map_err(|e| format!("Cookie read task failed: {e}"))?
        .map_err(|e| format!("Cookie read failed: {e}"))?;

    let wanted: std::collections::HashSet<&str> = names.iter().map(String::as_str).collect();
    let mut found: Vec<String> = cookies
        .iter()
        .filter(|c| wanted.contains(c.name()))
        .filter(|c| cookie_domain_matches_host(c.domain(), &host))
        .map(|c| c.name().to_string())
        .collect();
    found.sort();
    found.dedup();
    Ok(found)
}

/// Does a cookie whose domain is `cookie_domain` belong to `host`?
///
/// A cookie set on `.douyin.com` applies to `creator.douyin.com`; a cookie set
/// on `creator.douyin.com` applies to nothing else. Both sides may carry a
/// leading dot (WebKit / WebView2 / NSHTTPCookie all store domain cookies
/// that way), so compare on the bare domain.
///
/// A cookie with no domain is treated as belonging to nobody: it can only be
/// scoped by the path, and we cannot check that from here. Erring towards
/// "not mine" keeps unrelated cookies from being read as a login.
fn cookie_domain_matches_host(cookie_domain: Option<&str>, host: &str) -> bool {
    let domain = cookie_domain
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if domain.is_empty() {
        return false;
    }
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Report whether a CSS selector currently matches a VISIBLE element.
///
/// Exists for login-completion detection. Some creator consoles (Douyin being
/// the canonical one) are pure SPAs: the URL is byte-identical before and
/// after the user scans the QR code, so the renderer's `browser:url-changed`
/// signal never fires and a URL whitelist can never conclude "logged in".
/// The only reliable tell is a post-login element becoming visible — Easel
/// reads the same signal (`douyin_publish.py::_logged_in`) in Playwright.
///
/// Still a guess: the element can be mid-mount, the eval can die with the
/// navigation that login triggers, and both read identically as `false`.
/// Callers MUST treat a cookie hit as authoritative and this as the fallback
/// (see `cmd_browser_cookie_names`).
///
/// Deliberately NOT a general eval bridge: the caller supplies a selector, not
/// a script, and this returns one boolean. `querySelectorAll` + `getClientRects`
/// covers the `is_visible()` semantics Easel relies on — existence alone is not
/// enough (Kuaishou's SPA keeps the creator-console shell in the DOM, hidden,
/// after logout, which is the classic false positive).
#[tauri::command]
pub async fn cmd_browser_query_visible(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    selector: String,
) -> Result<bool, String> {
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;
    let label = session.webview_label.clone();

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Webview not found".to_string())?;

    // JSON-encode the selector so quotes / backslashes in a CSS attribute
    // selector cannot break out of the JS string literal.
    let selector_json = serde_json::to_string(&selector)
        .map_err(|e| format!("Invalid selector: {e}"))?;

    // `getClientRects().length > 0` is the check that actually matters: a
    // display:none / detached element has none, while `offsetParent` alone
    // misses `position: fixed` elements that ARE visible.
    let script = format!(
        r#"(() => {{
  const els = document.querySelectorAll({selector_json});
  for (const el of els) {{
    if (!el.getClientRects().length) continue;
    const st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.visibility === 'collapse') continue;
    return true;
  }}
  return false;
}})()"#
    );

    eval_in_webview(&webview, &script, std::time::Duration::from_secs(5)).await
        .map(|v| v.as_bool().unwrap_or(false))
}

/// Go back in browser history (owner's frontmost tab).
#[tauri::command]
pub async fn cmd_browser_go_back(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;

    let webview = app
        .get_webview(&session.webview_label)
        .ok_or_else(|| "Webview not found".to_string())?;

    webview
        .eval("window.history.back()")
        .map_err(|e| format!("Go back failed: {e}"))
}

/// Go forward in browser history (owner's frontmost tab).
#[tauri::command]
pub async fn cmd_browser_go_forward(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;

    let webview = app
        .get_webview(&session.webview_label)
        .ok_or_else(|| "Webview not found".to_string())?;

    webview
        .eval("window.history.forward()")
        .map_err(|e| format!("Go forward failed: {e}"))
}

/// Reload the current page (owner's frontmost tab).
#[tauri::command]
pub async fn cmd_browser_reload(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    let (_, session) = state
        .selected_tab_of_owner(&tab_id)
        .await
        .ok_or_else(|| format!("No browser for tab {}", tab_id))?;

    let webview = app
        .get_webview(&session.webview_label)
        .ok_or_else(|| "Webview not found".to_string())?;

    webview.reload().map_err(|e| format!("Reload failed: {e}"))
}

/// Update webview position and size.
///
/// Owner-scoped: every tab of the panel lives in the same rectangle, so the
/// cached geometry is written to all of them while only the visible one is
/// moved natively. A hidden tab is re-placed by the SHOW path, which restores
/// the cached geometry.
#[tauri::command]
pub async fn cmd_browser_resize(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Drop degenerate resizes (width/height ≤ 0) instead of collapsing the
    // webview and caching zeros that a later SHOW would restore (issue #290).
    // Keep the last good geometry untouched so the next valid resize wins.
    if is_degenerate_bounds(width, height) {
        ulog_info!(
            "[browser] cmd_browser_resize: ignoring degenerate bounds for tab {} — pos=({},{}) size={}x{}",
            tab_id,
            x,
            y,
            width,
            height
        );
        return Ok(());
    }

    // Update cached position, then release the session lock before touching
    // the native webview — the Linux path waits on a main-thread round trip
    // and must not block the other browser commands behind it.
    let selected_label = {
        let mut sessions = state.sessions.lock().await;
        let mut selected_label: Option<String> = None;
        let mut found = false;
        for session in sessions.values_mut() {
            if session.owner_tab_id != tab_id {
                continue;
            }
            found = true;
            session.last_x = x;
            session.last_y = y;
            session.last_width = width;
            session.last_height = height;
            if session.selected {
                selected_label = Some(session.webview_label.clone());
            }
        }
        if !found {
            return Err(format!("No browser for tab {}", tab_id));
        }
        selected_label
    };

    let Some(webview_label) = selected_label else {
        return Ok(());
    };
    let webview = app
        .get_webview(&webview_label)
        .ok_or_else(|| "Webview not found".to_string())?;

    // Propagate (don't swallow) native geometry failures: the renderer's
    // reconciler marks bounds as synced when this command resolves, so a
    // silently-dropped set_position/set_size would park the OS webview at
    // stale bounds with no retry scheduled and zero diagnostic trail (issue
    // #339 post-mortem). Returning Err makes the renderer clear its synced
    // marker and retry on the next frame. Errors are exceptional (webview
    // teardown races), so the log cannot spam.
    apply_geometry(&app, &webview, x, y, width, height)?;
    Ok(())
}

/// Show the browser panel (owner's tabs).
///
/// The panel's frontmost tab goes on screen, the rest stay hidden.
#[tauri::command]
pub async fn cmd_browser_show(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().await;
        let mut found = false;
        for session in sessions.values_mut() {
            if session.owner_tab_id == tab_id {
                session.panel_visible = true;
                found = true;
            }
        }
        if !found {
            return Err(format!("No browser for tab {}", tab_id));
        }
    }
    apply_visibility(&app, &state, &tab_id).await;
    Ok(())
}

/// Hide the browser panel (owner's tabs).
#[tauri::command]
pub async fn cmd_browser_hide(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().await;
        let mut found = false;
        for session in sessions.values_mut() {
            if session.owner_tab_id == tab_id {
                session.panel_visible = false;
                found = true;
            }
        }
        if !found {
            return Err(format!("No browser for tab {}", tab_id));
        }
    }
    apply_visibility(&app, &state, &tab_id).await;
    Ok(())
}

/// Destroy one browser tab.
///
/// Closing the frontmost tab promotes the next-newest one, so the panel never
/// ends up with a tab that is registered but not on screen.
#[tauri::command]
pub async fn cmd_browser_close_tab(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    browser_tab_id: String,
) -> Result<(), String> {
    let (owner_tab_id, was_selected, label) = {
        let mut sessions = state.sessions.lock().await;
        let session = sessions
            .remove(&browser_tab_id)
            .ok_or_else(|| format!("No browser tab {}", browser_tab_id))?;
        (
            session.owner_tab_id.clone(),
            session.selected,
            session.webview_label.clone(),
        )
    };

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }
    state.forget_url(&browser_tab_id);

    if was_selected {
        // Promote the newest remaining tab of this owner.
        let tabs = state.tabs_of_owner(&owner_tab_id).await;
        if let Some((promote_id, _)) = tabs.last() {
            let mut sessions = state.sessions.lock().await;
            for (id, session) in sessions.iter_mut() {
                if session.owner_tab_id == owner_tab_id {
                    session.selected = id == promote_id;
                }
            }
            let _ = app.emit(
                &format!("browser:tab-selected:{}", owner_tab_id),
                promote_id.clone(),
            );
        }
    }

    apply_visibility(&app, &state, &owner_tab_id).await;
    ulog_info!(
        "[browser] Closed tab {} of owner {}",
        browser_tab_id,
        owner_tab_id
    );
    Ok(())
}

/// Destroy every browser tab of one owner (panel unmount).
#[tauri::command]
pub async fn cmd_browser_close_owner(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserManager>>,
    tab_id: String,
) -> Result<(), String> {
    let closed: Vec<(String, String)> = {
        let mut sessions = state.sessions.lock().await;
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, session)| session.owner_tab_id == tab_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| {
                sessions
                    .remove(&id)
                    .map(|session| (id, session.webview_label))
            })
            .collect()
    };
    for (id, label) in closed {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
        }
        state.forget_url(&id);
    }
    ulog_info!("[browser] Closed all tabs of owner {}", tab_id);
    Ok(())
}

// ──────────────────────────────────────────────────────────
// Agent control surface
// ──────────────────────────────────────────────────────────
//
// Lets the `hamuna` CLI drive the embedded browser that the user is already
// looking at: navigate, click, fill, submit, read the page back as markdown.
//
// Transport note: `eval_with_callback` serializes the JS result into a JSON
// string. On Windows the underlying WebView2 `ExecuteScript` DROPS script
// exceptions (documented in wry) — so every script we send must catch its own
// errors and return `{ok:false,error}` rather than throwing, or the caller
// would hang waiting for a result that never arrives.

/// Wrap a JS expression so it always yields a JSON envelope.
///
/// The returned string is the CONTRACT with the page: `{"ok":true,"data":…}`
/// or `{"ok":false,"error":"…"}`. Windows swallows uncaught exceptions, so
/// the try/catch has to live inside the script we send.
fn wrap_eval_script(expression: &str) -> String {
    format!(
        r#"(() => {{
  try {{
    const __data = (function(){{ return ({expression}); }})();
    return JSON.stringify({{ ok: true, data: __data === undefined ? null : __data }});
  }} catch (e) {{
    return JSON.stringify({{ ok: false, error: String((e && e.message) || e) }});
  }}
}})()"#
    )
}

/// Decode the transport payload into our `{ok, data|error}` envelope.
///
/// Every script returns `JSON.stringify({...})` — a JS *string* — so the
/// backend's result serialization double-encodes it: the payload arrives as
/// a JSON string whose content is the envelope, e.g.
/// `"{\"ok\":true,\"data\":\"hi\"}"`. Scripts return a string rather than an
/// object because Windows drops uncaught script exceptions, so the
/// try/catch has to live inside the script and its result has to be
/// stringified. A plain object payload is accepted too, so a script that
/// skips `JSON.stringify` still works.
fn decode_envelope(raw: &str) -> Result<serde_json::Value, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Browser returned malformed JSON: {e}"))?;
    match parsed {
        serde_json::Value::String(inner) => serde_json::from_str(&inner)
            .map_err(|e| format!("Browser returned malformed envelope: {e}")),
        other => Ok(other),
    }
}

/// Evaluate JS in a webview and await the result.
///
/// The callback fires on the webview's own thread, so the value is handed to
/// the async caller over a oneshot channel. A webview that never calls back
/// (page still loading, renderer wedged) would park the caller forever —
/// `timeout` bounds that.
pub async fn eval_in_webview(
    webview: &tauri::Webview,
    expression: &str,
    timeout: std::time::Duration,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    // `eval_with_callback` takes an `Fn` (not `FnOnce`) — it may fire more
    // than once. Wrap the sender so only the first delivery sends.
    let tx = std::sync::Mutex::new(Some(tx));

    webview
        .eval_with_callback(wrap_eval_script(expression), move |raw| {
            if let Ok(mut guard) = tx.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(raw);
                }
            }
        })
        .map_err(|e| format!("Failed to evaluate script: {e}"))?;

    let raw = tokio::time::timeout(timeout, rx)
        .await
        .map_err(|_| "Browser evaluation timed out".to_string())?
        .map_err(|_| "Browser evaluation channel closed unexpectedly".to_string())?;

    decode_envelope(&raw)
}

// ──────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────

/// Close all browser webviews (app exit cleanup).
pub async fn close_all_browsers(state: &Arc<BrowserManager>, app: &AppHandle) {
    let mut sessions = state.sessions.lock().await;
    let count = sessions.len();
    for (_tab_id, session) in sessions.drain() {
        if let Some(webview) = app.get_webview(&session.webview_label) {
            let _ = webview.close();
        }
    }
    if count > 0 {
        ulog_info!("[browser] Closed {} browser(s) on shutdown", count);
    }
}

#[cfg(test)]
mod tests {
    use super::cookie_domain_matches_host;
    use super::decode_envelope;
    use super::device_px;
    use super::is_degenerate_bounds;
    use super::parse_agent_url;
    #[cfg(target_os = "windows")]
    use super::wide_null_terminated;

    /// Cookie 域匹配 —— 登录态判据的地基。
    ///
    /// 抖音的 `sessionid` 存在 `.douyin.com` 上（域 cookie），而查的是
    /// `creator.douyin.com`：不做后缀匹配就永远读不到那个 cookie，登录态
    /// 判定就永远不成立。反过来，同一个工作区里所有平台共用一套浏览器
    /// profile，别人家的 `sessionid` 也不该被当成抖音已登录。
    #[test]
    fn cookie_domain_matching() {
        // 域 cookie（带前导点）适用于子域。
        assert!(cookie_domain_matches_host(
            Some(".douyin.com"),
            "creator.douyin.com"
        ));
        // 主机 cookie 只适用于自己。
        assert!(cookie_domain_matches_host(
            Some("creator.douyin.com"),
            "creator.douyin.com"
        ));
        assert!(!cookie_domain_matches_host(
            Some("creator.douyin.com"),
            "www.douyin.com"
        ));
        // 别人的域 cookie 不算数。
        assert!(!cookie_domain_matches_host(
            Some(".example.com"),
            "creator.douyin.com"
        ));
        // 后缀不能裸比：`notdouyin.com` 不是 `douyin.com`。
        assert!(!cookie_domain_matches_host(
            Some("douyin.com"),
            "notdouyin.com"
        ));
        // 大小写不敏感。
        assert!(cookie_domain_matches_host(
            Some(".DouYin.com"),
            "creator.douyin.com"
        ));
        // 没有域的 cookie 归属不明 —— 不算命中（宁可漏判不可误判）。
        assert!(!cookie_domain_matches_host(None, "creator.douyin.com"));
        assert!(!cookie_domain_matches_host(Some(""), "creator.douyin.com"));
        assert!(!cookie_domain_matches_host(Some("."), "creator.douyin.com"));
    }

    // Issue #290: the renderer can hand us a 0-width container reading while
    // the split panel's width transition is mid-flight. These must be rejected
    // so the OS webview is never collapsed / mis-positioned over the chat.
    #[test]
    fn degenerate_bounds_are_rejected() {
        assert!(is_degenerate_bounds(0.0, 662.0)); // the exact bug read
        assert!(is_degenerate_bounds(640.0, 0.0));
        assert!(is_degenerate_bounds(0.0, 0.0));
        assert!(is_degenerate_bounds(-1.0, 600.0));
        assert!(is_degenerate_bounds(600.0, -1.0));
        assert!(is_degenerate_bounds(f64::NAN, 600.0));
    }

    #[test]
    fn real_bounds_are_accepted() {
        assert!(!is_degenerate_bounds(694.0, 662.0));
        assert!(!is_degenerate_bounds(1.0, 1.0));
    }

    // ── Multi-tab model ──
    //
    // One Chat tab owns up to MAX_BROWSER_TABS browser tabs. The agent never
    // sees their ids: it addresses them by index (creation order) and always
    // lands on the owner's *selected* tab — "the browser" is the tab the user
    // is looking at.

    fn test_session(
        owner: &str,
        session_id: &str,
        created_at: u64,
        selected: bool,
    ) -> super::BrowserSession {
        super::BrowserSession {
            webview_label: format!("browser-{created_at}"),
            owner_tab_id: owner.to_string(),
            session_id: Some(session_id.to_string()),
            created_at,
            selected,
            panel_visible: true,
            last_x: 0.0,
            last_y: 0.0,
            last_width: 100.0,
            last_height: 100.0,
        }
    }

    async fn manager_with(
        tabs: Vec<super::BrowserSession>,
    ) -> std::sync::Arc<super::BrowserManager> {
        let manager = super::BrowserManager::new();
        {
            let mut sessions = manager.sessions.lock().await;
            for (index, session) in tabs.into_iter().enumerate() {
                sessions.insert(format!("bt-{}", index + 1), session);
            }
        }
        manager
    }

    #[tokio::test]
    async fn tabs_are_grouped_by_owner_and_listed_in_creation_order() {
        let manager = manager_with(vec![
            test_session("chat-2", "s2", 30, true),
            test_session("chat-1", "s1", 20, true),
            test_session("chat-1", "s1", 10, false),
        ])
        .await;

        let tabs = manager.tabs_of_owner("chat-1").await;
        assert_eq!(tabs.len(), 2);
        // Creation order IS the agent-facing index space — the tab strip
        // shows them in exactly this order.
        assert_eq!(tabs[0].1.created_at, 10);
        assert_eq!(tabs[1].1.created_at, 20);

        // Another owner's tabs never leak into the list.
        assert_eq!(manager.tabs_of_owner("chat-2").await.len(), 1);
    }

    #[tokio::test]
    async fn the_selected_tab_is_the_one_the_agent_drives() {
        let manager = manager_with(vec![
            test_session("chat-1", "s1", 10, false),
            test_session("chat-1", "s1", 20, true),
            test_session("chat-1", "s1", 30, false),
        ])
        .await;

        let (tab_id, _) = manager.selected_tab_of_owner("chat-1").await.unwrap();
        assert_eq!(tab_id, "bt-2");

        // The agent's session lookup lands on the same tab.
        let (_, label) = manager.session_for_session_id("s1").await.unwrap();
        assert_eq!(label, "browser-20");
    }

    #[tokio::test]
    async fn tab_capacity_is_capped_at_three_per_owner() {
        let manager = manager_with(vec![
            test_session("chat-1", "s1", 10, true),
            test_session("chat-1", "s1", 20, false),
            test_session("chat-1", "s1", 30, false),
            // A different owner's tab does NOT consume chat-1's capacity.
            test_session("chat-2", "s2", 40, true),
        ])
        .await;

        assert_eq!(super::MAX_BROWSER_TABS, 3);
        assert!(!manager.has_tab_capacity("chat-1").await);
        assert!(manager.has_tab_capacity("chat-2").await);
    }

    #[tokio::test]
    async fn any_owner_falls_back_to_the_most_recently_used_panel() {
        let manager = manager_with(vec![
            test_session("chat-1", "s1", 10, true),
            test_session("chat-2", "s2", 40, true),
        ])
        .await;

        assert_eq!(manager.any_owner().await.as_deref(), Some("chat-2"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_external_open_preserves_oauth_query_parameters() {
        let url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=437924003108-example.apps.googleusercontent.com&response_type=code&scope=openid%20email&redirect_uri=https%3A%2F%2Fspace.hamuna.io%2Fapi%2Fauth%2Fgoogle%2Fcallback&state=abc";
        let encoded = wide_null_terminated(url);
        assert_eq!(encoded.last().copied(), Some(0));
        assert_eq!(
            String::from_utf16(&encoded[..encoded.len() - 1]).unwrap(),
            url
        );
    }

    #[test]
    fn agent_navigation_rejects_non_http_schemes() {
        assert!(parse_agent_url("javascript:alert(1)").is_err());
        assert!(parse_agent_url("data:text/html,<h1>x</h1>").is_err());
        assert!(parse_agent_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn agent_navigation_rejects_private_and_loopback_hosts() {
        // The agent must not be able to point the embedded browser at this
        // app's own admin endpoints, cloud metadata, or the user's LAN.
        for url in [
            "http://127.0.0.1:7788/api/admin/config",
            "http://localhost:7788/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/admin",
            "http://192.168.1.1/",
            "http://172.16.0.1/",
            "http://[::1]:7788/",
            "http://[::ffff:127.0.0.1]/",
        ] {
            assert!(
                parse_agent_url(url).is_err(),
                "expected private host to be rejected: {url}"
            );
        }
    }

    #[test]
    fn agent_navigation_accepts_public_urls() {
        assert!(parse_agent_url("https://example.com").is_ok());
        assert!(parse_agent_url("http://example.com/path?q=1").is_ok());
        // 172.32.x is outside the RFC1918 172.16/12 block.
        assert!(parse_agent_url("http://172.32.0.1/").is_ok());
    }

    #[test]
    fn css_pixels_are_scaled_to_device_pixels() {
        // The renderer hands us CSS px; GDK wants device px.
        assert_eq!(device_px(640.0, 1.0), 640);
        assert_eq!(device_px(640.0, 2.0), 1280);
        assert_eq!(device_px(640.0, 1.5), 960);
        // Fractional device pixels round to the nearest one, never truncate.
        assert_eq!(device_px(101.0, 1.5), 152); // 151.5
        assert_eq!(device_px(0.0, 2.0), 0);
        assert_eq!(device_px(-50.0, 1.0), -50);
    }

    /// Regression guard for "every `hamuna browser` command fails with
    /// `Unknown browser error`".
    ///
    /// The scripts return `JSON.stringify(envelope)`, so the transport hands
    /// back a JSON string that *contains* the envelope. Decoding only one
    /// layer yields `Value::String`, every `.get("ok")` misses, and the
    /// caller falls through to the generic error text — with no diagnostic
    /// pointing at the real cause.
    #[test]
    fn eval_envelope_is_unwrapped_from_the_transport_string() {
        // Both real transport shapes.
        let stringified = r#""{\"ok\":true,\"data\":{\"title\":\"hi\"}}""#;
        let envelope = decode_envelope(stringified).expect("stringified envelope");
        assert_eq!(envelope.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            envelope.get("data").and_then(|v| v.get("title")),
            Some(&serde_json::Value::String("hi".into()))
        );

        let plain = r#"{"ok":false,"error":"no such element"}"#;
        let envelope = decode_envelope(plain).expect("plain envelope");
        assert_eq!(
            envelope.get("error").and_then(|v| v.as_str()),
            Some("no such element")
        );

        // A truncated / non-JSON payload must stay an error, not a silent null.
        assert!(decode_envelope("not json").is_err());
        assert!(decode_envelope(r#""{broken"#).is_err());
    }

    /// Regression guard for "the whole UI goes unclickable once the browser
    /// panel is open".
    ///
    /// The browser host is a `GtkFixed` used as a `GtkOverlay` overlay child.
    /// Overlay children are FILL-aligned by default, so that fixed is
    /// allocated the entire window — and GTK3 dispatches pointer events by
    /// "which GdkWindow owns the event", never by coordinates
    /// (`gtk_main_do_event` → `gtk_get_event_widget` →
    /// `gdk_window_get_user_data`). The full-window fixed therefore sat above
    /// the app webview's window and ate every press: the app looked alive but
    /// nothing outside the page responded.
    ///
    /// `set_overlay_pass_through` is the fix — GDK then hit-tests *through*
    /// that window while the browser webview's own window stays clickable.
    /// Both host-creation paths must call it, so this guards the call count
    /// against the `add_overlay` count.
    #[test]
    fn browser_host_fixed_passes_pointer_events_through() {
        // Scan production code only — this test's own source contains the
        // literal it counts.
        let source = include_str!("browser.rs");
        let source = source
            .split_once("#[cfg(test)]\nmod tests {")
            .map(|(prod, _)| prod)
            .expect("test module marker moved; update this split");
        let adds = source.matches("overlay.add_overlay(&fixed)").count();
        let passthrough = source
            .matches("set_overlay_pass_through(&fixed, true)")
            .count();
        assert_eq!(
            adds, 2,
            "expected exactly two host-creation paths (first use + repair)"
        );
        assert_eq!(
            adds, passthrough,
            "every overlay child fixed must be pass-through, otherwise it \
             swallows every pointer event aimed at the app webview and the \
             entire UI outside the browser page goes dead"
        );
    }

    /// Regression guard for "the browser page is squeezed into a narrow strip
    /// after the panel finishes expanding".
    ///
    /// `gtk_widget_set_size_request` silently skips `gtk_widget_queue_resize`
    /// for a hidden widget, so `resize_needed` stays false, the size-request
    /// cache keeps the creation-time width, and `gtk_fixed_size_allocate`
    /// allocates the widget at that stale width until the process exits. The
    /// browser webview *is* resized while hidden — React hides it for the
    /// blank page and the width reconciler keeps calling `cmd_browser_resize`
    /// — so every webview resize must go through `apply_size_request`, which
    /// pairs `queue_resize` with `set_size_request`.
    #[test]
    fn linux_webview_resize_invalidates_the_gtk_size_request_cache() {
        let source = include_str!("browser.rs");
        let (_, after_mod) = source
            .split_once("mod linux_layout {")
            .expect("linux_layout module moved; update this split");
        // rustfmt keeps the module's closing brace at column 0; everything
        // nested inside is indented, so this is the module body.
        let (module, _) = after_mod
            .split_once("\n}\n")
            .expect("linux_layout module no longer ends at column 0");

        assert!(
            module.contains("widget.queue_resize();"),
            "apply_size_request must invalidate the cached size request, \
             otherwise a webview resized while hidden keeps its old width"
        );
        // Two webview call sites (place + reposition) plus the definition.
        assert_eq!(
            module.matches("apply_size_request(&widget,").count(),
            2,
            "place() and reposition() must both size the webview through \
             apply_size_request(); a bare set_size_request() is a silent no-op \
             for a hidden widget and leaves the stale width cached forever"
        );
        // The only other `widget.set_size_request` allowed is the one inside
        // apply_size_request itself.
        assert_eq!(
            module.matches("widget.set_size_request(").count(),
            1,
            "webview sizing must go through apply_size_request() so the GTK \
             size request cache is invalidated"
        );
    }

    /// Body of every `#[cfg(target_os = "linux")] { … }` block in this file.
    ///
    /// Brace matching is done by indentation instead of counting braces:
    /// rustfmt puts the closing brace of a block at the same column as the
    /// `#[cfg]` attribute, and string literals in this file (`{e}` inside
    /// `format!`) would otherwise unbalance a naive counter.
    fn linux_cfg_blocks(source: &str) -> Vec<String> {
        let mut blocks = Vec::new();
        let mut lines = source.lines();
        while let Some(line) = lines.next() {
            if !line
                .trim_start()
                .starts_with("#[cfg(target_os = \"linux\")]")
            {
                continue;
            }
            let indent = line.len() - line.trim_start().len();
            let mut body = String::new();
            for inner in lines.by_ref() {
                let inner_indent = inner.len() - inner.trim_start().len();
                if inner.trim_start().starts_with('}') && inner_indent == indent {
                    break;
                }
                body.push_str(inner);
                body.push('\n');
            }
            blocks.push(body);
        }
        blocks
    }

    /// Regression guard for the Linux "browser renders in the wrong place"
    /// bug.
    ///
    /// On Linux, `set_position` / `set_size` are silent no-ops: wry only
    /// applies them when the webview's parent was a `GtkFixed` at creation
    /// time, and Tauri builds child webviews into the window's `GtkBox`. The
    /// webview therefore ended up filling the bottom of the window instead of
    /// the panel rect. The fix routes every Linux placement through the GTK
    /// host (`linux_layout`), so no Linux branch may call the platform
    /// bounds APIs again.
    #[test]
    fn linux_paths_never_call_platform_bounds_apis() {
        let source = include_str!("browser.rs");
        let blocks = linux_cfg_blocks(source);
        assert!(
            !blocks.is_empty(),
            "no `#[cfg(target_os = \"linux\")]` block found — the source parser broke"
        );
        for block in &blocks {
            assert!(
                !block.contains("set_position("),
                "Linux branch must place the webview through the GTK host, \
                 not set_position():\n{block}"
            );
            assert!(
                !block.contains("set_size("),
                "Linux branch must place the webview through the GTK host, \
                 not set_size():\n{block}"
            );
        }
    }
}
