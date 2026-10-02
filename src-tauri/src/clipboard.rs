//! System clipboard access for MiniApp `app.clipboard.*`.
//!
//! ## Why these commands exist at all
//!
//! The renderer already has `navigator.clipboard`, so the obvious question is
//! "why not just use that?". Because a MiniApp runs inside a **sandboxed
//! `<iframe>`** whose CSP forbids the Web APIs it would need, and — more
//! importantly — because a MiniApp's clipboard access must be **auditable at
//! the host boundary**. `navigator.clipboard` inside the iframe would be an
//! opaque capability the host cannot gate; routing through an explicit Tauri
//! command keeps every read/write visible to the host's permission layer and
//! to the unified log.
//!
//! ## Why `arboard` and not `tauri-plugin-clipboard-manager`
//!
//! `arboard` is already in `Cargo.lock` as a transitive dependency of `tao`
//! (window drag-and-drop), so promoting it to a direct dependency adds **no new
//! transitive closure**. `tauri-plugin-clipboard-manager` would additionally
//! pull `wl-clipboard-rs` and force a `wry` / `webview2-com` upgrade — a
//! core WebView dependency bump for the sake of two functions.
//!
//! ## Clipboard lifetime
//!
//! `arboard::Clipboard` is **not** `Send` on macOS and holds an OS handle that
//! goes stale on Wayland/X11. These commands therefore construct a fresh
//! `Clipboard` per call and drop it immediately. That is deliberate: a cached
//! handle is the classic source of "the first copy works, the second silently
//! does nothing" on Linux desktops.

use tauri::AppHandle;

/// Read plain text from the system clipboard.
///
/// Returns an empty string when the clipboard holds no text (e.g. an image was
/// copied). That is a *successful* read of a text clipboard, not an error —
/// erroring here would force every caller into a try/catch for a routine state.
#[tauri::command]
pub async fn cmd_clipboard_read_text() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("failed to open clipboard: {e}"))?;
    // `Clipboard::new()` must not run on the main thread on macOS; the
    // `async fn` + this explicit hop keeps the OS handle off the UI thread,
    // which is the same pit documented in CLAUDE.md for sync Tauri commands.
    let read = tauri::async_runtime::spawn_blocking(move || clipboard.get_text())
        .await
        .map_err(|e| format!("clipboard read task failed: {e}"))?;
    match read {
        Ok(text) => Ok(text),
        // arboard uses a dedicated error variant for "no text on clipboard".
        Err(arboard::Error::ContentNotAvailable) => Ok(String::new()),
        Err(e) => Err(format!("failed to read clipboard: {e}")),
    }
}

/// Write plain text to the system clipboard.
#[tauri::command]
pub async fn cmd_clipboard_write_text(_app: AppHandle, text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("failed to open clipboard: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || clipboard.set_text(text))
        .await
        .map_err(|e| format!("clipboard write task failed: {e}"))?
        .map_err(|e| format!("failed to write clipboard: {e}"))
}
