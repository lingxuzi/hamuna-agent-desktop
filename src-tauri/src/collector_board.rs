// collector_board.rs — the window that lets a user watch (and log into) the
// hidden collectors an agent opened for itself.
//
// 背景：定时任务里的 agent 没有 Chat 面板，所以浏览器被开成隐藏采集器
// （见 `browser.rs` 的 headless 文档）。它跑得通，但用户完全看不见——于是
// 「让 agent 去抓榜单」和「你登录一下再抓」之间没有桥：验证码、扫码、二次
// 确认全都无处可去。
//
// 这个窗口就是那座桥。它是**一块板**，不是一个浏览器：
//
// - 收起态是一个小窗，点一下展开；
// - 展开态左边一列是工作区名，右边是选中那个工作区的实时页面；
// - 右边那片区域不是 webview 容器，而是**让真正的采集器 webview 挪进来**。
//   这是唯一正确的做法：采集器的价值在它的 cookie / 登录态 / 页面滚动位置，
//   复制一份就等于让用户对着一个假页面登录。
//
// 为什么是独立 `WindowBuilder` 而不是复用 `floating_ball`：后者在三平台里是
// macOS NSPanel + Windows 面板，Linux 只有 `supported: false` 的桩。采集器板
// 必须三平台都能用（Linux 正是主力开发环境），所以这里一律走普通窗口 + 平台
// 各自的 re-parent。
//
// 关键不变量：**一次只显示一个采集器**。原生 webview 一次只能被一个父窗口
// 持有，而这块板只有一个右侧区域。切换就是「把上一个挪出去、把下一个挪进
// 来」，不是并列渲染。
//
// 收起 / 关闭语义（2026-11 定）：
// - 收起 → 窗口 `hide()`，采集器**留在板上**，再展开就是刚才那个页面，滚动
//   位置和未提交的输入全在。
// - 关闭 → 采集器退回隐藏态、重新开始计闲置，窗口销毁。这是「我不用了但别把
//   页面弄丢」和「关掉就结束」之间的中间档。

use std::sync::Arc;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

use crate::browser::{BrowserManager, BrowserSession, MAIN_WINDOW_LABEL};
use crate::{ulog_info, ulog_warn};

/// Label of the board window. `cb-` would be the `fb-` style prefix; here the
/// label doubles as the *content webview* label (the board is a plain window
/// plus one child webview), which is why it must not collide with `browser-*`.
pub const BOARD_LABEL: &str = "collector-board";

// The board loads the app bundle like `fb-*` does; `main.tsx` routes on the
// webview label. No separate entry file — one bundle, one build.

const BOARD_WIDTH: f64 = 980.0;
const BOARD_HEIGHT: f64 = 640.0;

/// Where the collector's webview goes *when nothing is showing* — parked far
/// outside the window so a hidden collector can never flash on screen.
///
/// Not 0×0: sites serve their desktop layout and scroll-lazy rows only to a
/// real viewport, and the collector is created before anyone takes it over.
pub const PARKED: (f64, f64, f64, f64) = (-20_000.0, -20_000.0, 1280.0, 900.0);

/// Left column (workspace list) and header band width/height, in CSS px.
///
/// The React tree renders an empty box at exactly this geometry and the native
/// webview is parked on top of it. Constants on both sides rather than a
/// measured handshake on purpose: a measurement arrives one frame late, so the
/// first frame would show the page at a stale rect, and the two sides would
/// then need a loop to stay agreed.
pub const LIST_COLUMN_W: f64 = 268.0;
pub const HEADER_H: f64 = 44.0;

/// The right-hand slot for a board window of `(width, height)` CSS px.
fn slot_for(width: f64, height: f64) -> (f64, f64, f64, f64) {
    // The list column and header are chrome with fixed sizes; only the page
    // gets the rest. A floor of 1px keeps a heavily-shrunk window from handing
    // the webview a degenerate rect (which the panel path also refuses).
    let w = (width - LIST_COLUMN_W).max(1.0);
    let h = (height - HEADER_H).max(1.0);
    (LIST_COLUMN_W, HEADER_H, w, h)
}

/// The slot at the window's current size.
fn current_slot(app: &AppHandle) -> (f64, f64, f64, f64) {
    let size = app
        .get_window(BOARD_LABEL)
        .and_then(|w| w.inner_size().ok())
        .map(|px| {
            let scale = app
                .get_window(BOARD_LABEL)
                .and_then(|w| w.scale_factor().ok())
                .unwrap_or(1.0);
            (px.width as f64 / scale, px.height as f64 / scale)
        });
    match size {
        Some((w, h)) => slot_for(w, h),
        None => slot_for(BOARD_WIDTH, BOARD_HEIGHT),
    }
}

/// Whether the board window exists right now (regardless of visibility).
pub fn is_open(app: &AppHandle) -> bool {
    app.get_window(BOARD_LABEL).is_some()
}

/// Create the board window if it does not exist.
///
/// `visible(false)` then an explicit `show()`: a window built visible presents
/// one frame before the React tree has drawn, which reads as a flash.
fn ensure_window(app: &AppHandle) -> Result<(), String> {
    if is_open(app) {
        return Ok(());
    }
    let win = tauri::window::WindowBuilder::new(app, BOARD_LABEL)
        .title("采集器")
        .inner_size(BOARD_WIDTH, BOARD_HEIGHT)
        .min_inner_size(520.0, 320.0)
        .resizable(true)
        .decorations(true)
        .visible(false)
        .build()
        .map_err(|e| format!("[collector-board] create window: {e}"))?;

    // The content webview is a *child*, not the window's own webview: on Linux
    // the board has to own a `GtkOverlay` host (same shape the chat panel
    // uses) before the collector can be re-parented into it. Building the
    // window as a `WebviewWindow` would make Android-style `add_child`
    // unavailable and take that path away.
    let position = LogicalPosition::new(0.0, 0.0);
    let size = LogicalSize::new(BOARD_WIDTH, BOARD_HEIGHT);
    let content = tauri::webview::WebviewBuilder::new(BOARD_LABEL, WebviewUrl::default());
    win.add_child(content, position, size)
        .map_err(|e| format!("[collector-board] add content webview: {e}"))?;

    ulog_info!("[collector-board] window created");
    Ok(())
}

/// Show the board with `browser_tab_id`'s page in the right-hand slot.
///
/// This is the 接管 action: it *moves* the collector webview in (keeping its
/// cookies, scroll position, half-typed form) instead of opening a second
/// browser, so a captcha the agent hit is the same captcha the user solves.
pub async fn show(
    app: &AppHandle,
    manager: &Arc<BrowserManager>,
    browser_tab_id: &str,
) -> Result<(), String> {
    let session = manager
        .collector_by_id(browser_tab_id)
        .await
        .ok_or_else(|| format!("No browser tab {browser_tab_id}"))?;
    if !session.is_headless() {
        return Err(
            "That tab is already in a chat panel — the board is for collecting browsers.".into(),
        );
    }

    ensure_window(app)?;

    // Whatever the board was showing goes back to being a plain collector
    // before the new page moves in: two webviews cannot share the slot, and
    // leaving the old one `board_visible` would make `apply_visibility` try to
    // show a page the board no longer contains.
    release_current(app, manager, Some(browser_tab_id)).await;

    move_into_board(app, manager, browser_tab_id, &session).await?;

    if let Some(win) = app.get_window(BOARD_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }

    let _ = app.emit("collector-board:showing", browser_tab_id.to_string());
    ulog_info!("[collector-board] showing tab {}", browser_tab_id);
    Ok(())
}

/// Move one collector's webview into the board's slot.
///
/// `board_visible` is flipped only after the native move succeeded, so a
/// failure leaves the tab hidden rather than half-shown.
async fn move_into_board(
    app: &AppHandle,
    manager: &Arc<BrowserManager>,
    browser_tab_id: &str,
    session: &BrowserSession,
) -> Result<(), String> {
    let webview = app
        .get_webview(session.webview_label())
        .ok_or_else(|| "The collecting browser is no longer alive.".to_string())?;
    let board = app
        .get_window(BOARD_LABEL)
        .ok_or_else(|| "The collector board window is missing.".to_string())?;

    // Tells the runtime which window the webview belongs to. On Linux the GTK
    // widget is re-packed into the board's box (the overlay host is fixed up
    // right after, by `host_webview`).
    webview
        .reparent(&board)
        .map_err(|e| format!("Could not move the collecting browser into the board: {e}"))?;

    let (x, y, width, height) = current_slot(app);
    host_webview(app, BOARD_LABEL, &webview, x, y, width, height)?;

    manager
        .mark_moved_to_board(browser_tab_id, true, BOARD_LABEL, Some((x, y, width, height)))
        .await;
    let _ = webview.show();
    let _ = app.emit("collector-board:changed", ());
    Ok(())
}

/// Send the board's current page back to being a hidden collector.
///
/// `keep` is the tab about to come back into the board — excluding it avoids a
/// pointless out-and-back re-parent when the user clicks another row that
/// resolves to the same tab.
///
/// The idle timer restarts here: the collector is invisible again, so "nobody
/// has touched this in ten minutes" has to start over.
async fn release_current(
    app: &AppHandle,
    manager: &Arc<BrowserManager>,
    keep: Option<&str>,
) -> Option<String> {
    let (browser_tab_id, session) = manager.board_collector().await?;
    if keep == Some(browser_tab_id.as_str()) {
        return Some(browser_tab_id);
    }
    let label = session.webview_label().to_string();

    if let Some(webview) = app.get_webview(&label) {
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            if let Err(e) = webview.reparent(&main) {
                ulog_warn!(
                    "[collector-board] could not return tab {} to main: {}",
                    browser_tab_id,
                    e
                );
            }
        }
        // Back to the parked rect before hiding. Ordering matters: hiding
        // first and moving later would let one frame of the board-sized slot
        // land inside the chat window.
        let (x, y, w, h) = PARKED;
        if let Err(e) = host_webview(app, MAIN_WINDOW_LABEL, &webview, x, y, w, h) {
            ulog_warn!("[collector-board] re-park tab {} failed: {}", browser_tab_id, e);
        }
        let _ = webview.hide();
    }

    manager
        .mark_moved_to_board(&browser_tab_id, false, MAIN_WINDOW_LABEL, Some(PARKED))
        .await;
    manager.touch_now(&browser_tab_id);
    let _ = app.emit("collector-board:changed", ());
    ulog_info!(
        "[collector-board] released tab {} back to hidden",
        browser_tab_id
    );
    Some(browser_tab_id)
}

/// Collapse the board: hide the window, leave the page where it is.
///
/// The distinction from [`close`] is the point — collapsing is "get out of my
/// way", closing is "I'm done".
pub fn collapse(app: &AppHandle) {
    if let Some(win) = app.get_window(BOARD_LABEL) {
        let _ = win.hide();
        ulog_info!("[collector-board] collapsed");
    }
}

/// Close the board: its collector returns to hidden, then the window dies.
pub async fn close(app: &AppHandle, manager: &Arc<BrowserManager>) {
    release_current(app, manager, None).await;
    if let Some(win) = app.get_window(BOARD_LABEL) {
        // The content webview goes with the window; the collector was already
        // moved out, so this cannot take a live page down with it.
        let _ = win.destroy();
        ulog_info!("[collector-board] closed");
    }
}

/// Show/hide the board, creating it if needed.
pub async fn toggle(app: &AppHandle, manager: &Arc<BrowserManager>) {
    if let Some(win) = app.get_window(BOARD_LABEL) {
        if win.is_visible().unwrap_or(false) {
            collapse(app);
            return;
        }
        // Collapsed for a while: collectors may have been reaped or created in
        // the meantime, and a hidden window gets no events that matter. Re-read
        // instead of trusting whatever the React tree last drew.
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("collector-board:changed", ());
        return;
    }
    // Nothing open yet: land on content instead of an empty list.
    match newest_collector(manager).await {
        Some(tab_id) => {
            if let Err(e) = show(app, manager, &tab_id).await {
                ulog_warn!("[collector-board] toggle could not show tab {}: {}", tab_id, e);
            }
        }
        None => {
            if let Err(e) = ensure_window(app) {
                ulog_warn!("[collector-board] toggle could not create window: {}", e);
                return;
            }
            if let Some(win) = app.get_window(BOARD_LABEL) {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

/// Keep the page glued to the slot while the user resizes the board.
///
/// Rust owns this because the React tree cannot measure a native webview that
/// lives outside its own layer tree — a CSS-measured rect would always be the
/// *empty box*, and the box only matches the slot as long as the window keeps
/// the size used at creation.
pub fn on_resized(app: &AppHandle, manager: &Arc<BrowserManager>) {
    // One task per resize event (a drag emits dozens), and each has an `.await`
    // between reading the size and moving the widget — so two of them can reach
    // the FFI out of order and leave the page at a stale rect. The stamp makes
    // every task but the newest a no-op.
    static RESIZE_STAMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let stamp = RESIZE_STAMP.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

    let app = app.clone();
    let manager = manager.clone();
    tauri::async_runtime::spawn(async move {
        let Some(win) = app.get_window(BOARD_LABEL) else {
            return;
        };
        let Some((tab_id, session)) = manager.board_collector().await else {
            return;
        };
        let Ok(size) = win.inner_size() else { return };
        let scale = win.scale_factor().unwrap_or(1.0);
        let (x, y, width, height) =
            slot_for(size.width as f64 / scale, size.height as f64 / scale);

        manager
            .mark_moved_to_board(&tab_id, true, BOARD_LABEL, Some((x, y, width, height)))
            .await;
        // Last check, with no `.await` after it: from here to the FFI call this
        // task cannot be preempted, so "I am still the newest" stays true.
        if RESIZE_STAMP.load(std::sync::atomic::Ordering::SeqCst) != stamp {
            return;
        }
        let label = session.webview_label().to_string();
        let Some(webview) = app.get_webview(&label) else {
            return;
        };
        if let Err(e) = host_webview(&app, BOARD_LABEL, &webview, x, y, width, height) {
            ulog_warn!("[collector-board] resize follow failed: {}", e);
        }
    });
}

/// The most recently created collector, if any — the board's default selection.
pub async fn newest_collector(manager: &Arc<BrowserManager>) -> Option<String> {
    manager.all_collectors().await.into_iter().next().map(|(id, _)| id)
}

/// One row of the board's left column.
#[derive(Clone, serde::Serialize)]
pub struct BoardRow {
    pub browser_tab_id: String,
    pub workspace: String,
    pub url: String,
    pub session_id: String,
    /// Whether this is the page currently in the right-hand slot.
    pub showing: bool,
}

/// The board's current contents, for the React list.
pub async fn rows(app: &AppHandle, manager: &Arc<BrowserManager>) -> Vec<BoardRow> {
    let _ = app;
    manager
        .all_collectors()
        .await
        .into_iter()
        .map(|(browser_tab_id, session)| BoardRow {
            url: manager.url_of(&browser_tab_id).unwrap_or_default(),
            workspace: session.workspace().unwrap_or("").to_string(),
            session_id: session.session_id().unwrap_or("").to_string(),
            showing: session.is_board_visible(),
            browser_tab_id,
        })
        .collect()
}

// ──────────────────────────────────────────────────────────
// Geometry
// ──────────────────────────────────────────────────────────

/// Put `webview` at the given rect inside `host_label`, whatever platform.
///
/// The Linux arm reuses the chat panel's `linux_layout` host: it is the only
/// container that honours absolute coordinates (`GtkFixed` inside a
/// `GtkOverlay` whose MAIN child is the host window's own webview), and the
/// same reasoning applies to the board — no second implementation.
///
/// `attach` is idempotent for the host (the overlay is created once) but
/// always re-`put`s the browser webview, so it serves both "just moved in" and
/// "the window was resized".
#[cfg(target_os = "linux")]
fn host_webview(
    app: &AppHandle,
    host_label: &str,
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app
        .get_window(host_label)
        .ok_or_else(|| format!("Host window '{host_label}' not found"))?;
    let host_content = app
        .get_webview(host_label)
        .ok_or_else(|| format!("Host webview '{host_label}' not found"))?;
    crate::browser::linux_layout::attach(&window, &host_content, webview, x, y, width, height)
}

#[cfg(not(target_os = "linux"))]
fn host_webview(
    _app: &AppHandle,
    _host_label: &str,
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("set_size failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The slot is the *only* thing the React tree and the native webview
    /// agree on, and they agree by both hardcoding these numbers. Shrink it
    /// past the list column and the page gets a negative rect; grow it past
    /// the window and the page covers the list.
    #[test]
    fn slot_fills_the_window_minus_fixed_chrome() {
        assert_eq!(slot_for(980.0, 640.0), (268.0, 44.0, 712.0, 596.0));
        // Headroom preserved: the slot never bulges over the chrome.
        let (x, y, w, h) = slot_for(300.0, 100.0);
        assert_eq!((x, y), (LIST_COLUMN_W, HEADER_H));
        assert!(x + w <= 300.0 && y + h <= 100.0);
    }

    /// A window dragged smaller than the chrome must not hand wry a 0 or
    /// negative size — that panics inside GTK rather than failing the call.
    #[test]
    fn slot_floors_at_one_pixel() {
        let (_, _, w, h) = slot_for(100.0, 10.0);
        assert_eq!((w, h), (1.0, 1.0));
    }

    /// CSS is the other half of the contract; a mismatch shows as a white seam
    /// or a clipped page, and neither side can detect it at runtime.
    #[test]
    fn css_matches_the_rust_geometry() {
        let css = include_str!("../../src/renderer/collector-board/collector-board.css");
        assert!(
            css.contains(&format!("grid-template-columns: {LIST_COLUMN_W}px 1fr")),
            "collector-board.css list column must be {LIST_COLUMN_W}px"
        );
        assert!(
            css.contains(&format!("grid-template-rows: {HEADER_H}px 1fr")),
            "collector-board.css header band must be {HEADER_H}px"
        );
    }
}
