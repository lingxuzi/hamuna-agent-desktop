// browser_api.rs — Management API endpoints for the agent-driven browser
//
// The `hamuna browser …` CLI commands land here. Each request carries the
// Chat `sessionId` (the CLI knows it from `HAMUNA_SESSION_ID`); the handler
// resolves it to a browser session and drives the webview.
//
// Addressing model: the CLI has NO way to know the renderer-side tab id, so
// every call is scoped by Chat session id. A Chat that never opened the
// browser panel has no session — the handler then asks the renderer to open
// one (see `request_browser_open`).

use std::time::Duration;

use axum::{extract::Query, Json};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::browser::{eval_in_webview, get_browser_manager};
use crate::browser_agent;
use crate::browser_throttle;
use crate::logger::get_app_handle;
use crate::ulog_warn;

/// Bound on a single page evaluation. A page that never settles (infinite
/// loader) must not hang the agent's turn forever.
const EVAL_TIMEOUT: Duration = Duration::from_secs(20);

/// Bound on waiting for the renderer to open the browser panel and report
/// its bounds.
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);

/// Bound on a search: the engine page has to load AND paint its result list
/// before the DOM holds anything to extract.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(25);

/// Bound on waiting for a page to finish loading before its DOM is read.
///
/// A page that never settles (infinite XHR, a hung third-party script) must
/// not hang the agent's turn, so the wait gives up and reads whatever is
/// there — partial content beats an error.
const LOAD_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a navigation that did NOT change the URL is allowed to settle
/// before it is treated as loaded.
///
/// A same-URL reload looks identical to "nothing happened" from the outside,
/// so waiting for a URL change would stall every reload for the full
/// `LOAD_TIMEOUT`. See `wait_for_loaded` for the ceiling this leaves.
const SAME_URL_SETTLE: Duration = Duration::from_millis(700);

/// Ceiling on an uploaded file's raw size.
///
/// The file has to travel inside a JS string literal (`upload_script`), so it
/// is base64-inflated 4/3 and then held in memory twice (agent payload +
/// webview heap). 12 MiB covers the real image case — every publish target
/// caps stills at 10 MB or less — and lands well under the 50 MB management
/// API body limit. Video is deliberately out of reach: a 1-minute upload is
/// 50–200 MB, so it would blow the body limit, the eval string, and the
/// agent's context. Video posts must go through a headless runtime instead;
/// see `agent-templates/easel/CLAUDE.md`.
const MAX_UPLOAD_BYTES: usize = 12 * 1024 * 1024;

// ──────────────────────────────────────────────────────────
// Request / response shapes
// ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BrowserRequest {
    /// Chat session that owns the browser. Empty means "whichever browser is
    /// currently in use" — the fallback for agents that run outside a Chat
    /// context (cron, IM) and for the CLI's `status` command.
    #[serde(default)]
    pub session_id: String,
    /// Target URL for `navigate`.
    #[serde(default)]
    pub url: String,
    /// CSS selector for the target element.
    #[serde(default)]
    pub selector: String,
    /// Visible text of the target element (used when `selector` is empty).
    #[serde(default)]
    pub text: String,
    /// Value for `fill`.
    #[serde(default)]
    pub value: String,
    /// Search query for `search`.
    #[serde(default)]
    pub query: String,
    /// Search engine for `search` ("360" | "bing" | "baidu").
    #[serde(default)]
    pub engine: String,
    /// Absolute path of the file to select in a file input, for `upload`.
    ///
    /// Must already be inside the workspace or an allowed attachment prefix —
    /// this endpoint does no path validation of its own, because every caller
    /// (the CLI) is the agent's own process and the browser is sandboxed. A
    /// future HTTP-facing caller would need `path_safety` first.
    #[serde(default)]
    pub file: String,
}

#[derive(Debug, Serialize)]
pub struct BrowserResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Set when the browser panel had to be opened before the action could
    /// run — the caller can surface this to the user ("opening the browser…").
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub opened: bool,
}

impl BrowserResponse {
    fn ok(data: serde_json::Value, opened: bool) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
            opened,
        }
    }

    fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(message.into()),
            opened: false,
        }
    }
}

// ──────────────────────────────────────────────────────────
// Session resolution
// ──────────────────────────────────────────────────────────

/// Resolve a Chat session id to a browser webview label.
///
/// Falls back to "the only browser in use" when the session id is empty —
/// the CLI's `status` command and agents running outside a Chat have no
/// session id to offer.
async fn resolve_browser(session_id: &str) -> Result<(String, String), String> {
    let manager =
        get_browser_manager().ok_or_else(|| "Browser manager not initialized".to_string())?;

    if !session_id.trim().is_empty() {
        if let Some(found) = manager.session_for_session_id(session_id).await {
            return Ok(found);
        }
        return Err(format!(
            "No browser is open for session {}. Ask the user to open the browser panel, or run `hamuna browser open <url>` to open one."
        , session_id));
    }

    // No session id: fall back to any live browser session.
    manager.any_session().await.ok_or_else(|| {
        "No browser is open. Run `hamuna browser open <url>` to open one.".to_string()
    })
}

// ──────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────

/// `GET /api/browser/state` — current URL, title, and readiness.
pub async fn browser_state_handler(Query(query): Query<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&query.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    match run_script(&label, &browser_agent::page_state_script()).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/navigate` — open a URL in the embedded browser.
///
/// When the Chat has no browser session yet, the handler asks the renderer
/// to open the panel, waits for the webview to appear, then navigates.
pub async fn browser_navigate_handler(
    Json(input): Json<BrowserRequest>,
) -> Json<serde_json::Value> {
    let url = input.url.trim().to_string();
    if url.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err("A URL is required")).unwrap_or_default(),
        );
    }

    let (tab_id, label, opened) = match resolve_or_open_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let app = match get_app_handle() {
        Some(app) => app,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("App handle not initialized"))
                    .unwrap_or_default(),
            )
        }
    };
    let webview = match app.get_webview(&label) {
        Some(webview) => webview,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("Browser webview is no longer alive"))
                    .unwrap_or_default(),
            )
        }
    };
    let webview = &webview;

    let parsed = match crate::browser::parse_agent_url(&url) {
        Ok(parsed) => parsed,
        Err(e) => {
            return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default());
        }
    };

    navigate_and_wait(&label, webview, parsed).await;

    Json(
        serde_json::to_value(BrowserResponse::ok(
            serde_json::json!({ "url": url, "tabId": tab_id }),
            opened,
        ))
        .unwrap_or_default(),
    )
}

/// Navigate `webview` to `url`, pacing the request and waiting for the page.
///
/// The agent's very next command is almost always `browser read`, and reading
/// a DOM that has not been rendered yet returns a skeleton — so the navigate
/// call itself has to mean "the page is there". Waiting here (rather than in
/// `read`) also keeps `read` cheap for the follow-up calls that do not need to
/// wait at all.
///
/// Pacing lives here too: this is the only place the agent starts a
/// navigation, so it is the only place a per-host minimum interval can be
/// enforced. See `browser_throttle` for why reads are exempt.
async fn navigate_and_wait(label: &str, webview: &tauri::Webview, parsed: tauri::Url) {
    let host = parsed.host_str().unwrap_or_default().to_string();
    let target = parsed.to_string();
    browser_throttle::wait_for_host(&host).await;

    let before = current_url(label).await;
    if let Err(e) = webview.navigate(parsed) {
        ulog_warn!("[browser] navigate failed: {e}");
        return;
    }
    wait_for_loaded(label, before.as_deref(), &target, &host).await;
}

/// Current `location.href`, or None when the page cannot be evaluated (fresh
/// webview still booting, mid-navigation).
async fn current_url(label: &str) -> Option<String> {
    let data = run_script(label, &browser_agent::page_state_script())
        .await
        .ok()?;
    data.get("url").and_then(|v| v.as_str()).map(str::to_string)
}

/// Has the page the agent asked for taken over the webview yet?
///
/// `before` is the URL from just before `navigate()`; `None` means it was
/// unreadable, so the pre-navigation document was `about:blank` and only that
/// one must be excluded.
fn has_landed(before: Option<&str>, ready: bool, current_url: &str) -> bool {
    if !ready {
        return false;
    }
    match before {
        // Nothing was readable before the navigate: the webview was blank, so
        // this poll is the first document — provided it is not still blank.
        None => !current_url.is_empty() && current_url != "about:blank",
        // A URL change proves the new document committed. Requirement, not
        // optimisation: the *old* page already reports `complete`, so a poll
        // landing between `navigate()` and the new document would otherwise
        // return the previous page's DOM as if it were the new one.
        Some(prior) => prior != current_url,
    }
}

/// Wait until the webview has finished loading the page it was told to open.
///
/// What "finished" can be observed from: the URL changed away from `before`
/// (proof the new document took over). `readyState` alone is not enough on its
/// own — the *old* page is already `complete`, so a poll that lands before the
/// new document starts would see `complete` and return a skeleton.
///
/// Two cases need a different rule:
/// - `before` is `None` (nothing was readable, e.g. a webview that was still
///   booting): the only page that can be `complete` without being the target
///   is `about:blank`, so that one is excluded and everything else counts.
/// - `before` equals the target (an explicit reload): the URL will never
///   change, so wait `SAME_URL_SETTLE` and give up there. The alternative —
///   waiting `LOAD_TIMEOUT` on every reload — is much worse, and a reload that
///   takes longer than that still returns partial content rather than hanging.
async fn wait_for_loaded(label: &str, before: Option<&str>, target: &str, host: &str) {
    let script = browser_agent::page_state_script();
    let deadline = tokio::time::Instant::now() + LOAD_TIMEOUT;
    let started = tokio::time::Instant::now();
    let is_reload = before == Some(target);
    loop {
        if let Ok(data) = run_script(label, &script).await {
            let ready = data.get("readyState").and_then(|v| v.as_str()) == Some("complete");
            let url = data.get("url").and_then(|v| v.as_str()).unwrap_or_default();
            if has_landed(before, ready, url) || (is_reload && started.elapsed() >= SAME_URL_SETTLE)
            {
                // Record the landing so the next navigation to this host is
                // paced from when the page actually finished, not from when
                // the request was issued.
                browser_throttle::record_navigation(host);
                return;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            ulog_warn!(
                "[browser] page did not finish loading within {:?}; reading whatever rendered",
                LOAD_TIMEOUT
            );
            browser_throttle::record_navigation(host);
            return;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Resolve the browser session for `session_id`, opening the panel if needed.
///
/// Returns `(tab_id, webview_label, opened)`. `opened` is true when the
/// panel had to be created for this call.
async fn resolve_or_open_browser(session_id: &str) -> Result<(String, String, bool), String> {
    let manager =
        get_browser_manager().ok_or_else(|| "Browser manager not initialized".to_string())?;

    if let Some(found) = manager.session_for_session_id(session_id).await {
        return Ok((found.0, found.1, false));
    }

    if session_id.trim().is_empty() {
        return Err(
            "No browser is open and no session id was provided — a Chat session is required to open one."
                .to_string(),
        );
    }

    request_browser_open(session_id)
        .await
        .map_err(|e| format!("Could not ask the app to open the browser: {e}"))?;

    match manager.wait_for_session(session_id, OPEN_TIMEOUT).await {
        Some(found) => Ok((found.0, found.1, true)),
        None => Err(
            "Timed out waiting for the browser panel to open. The user may need to allow it, or the Chat may not be visible."
                .to_string(),
        ),
    }
}

/// `POST /api/browser/search` — run a web search in the embedded browser.
///
/// The browser navigates to the engine's result page and the DOM is
/// extracted from the rendered page. That is the point: the embedded
/// WebView is a real browser (JS runs, bot challenges are solved by the
/// engine's own scripts), so it sees the results a user would see — while
/// a plain HTTP fetch of the same URL gets a degraded or challenge page.
///
/// The search runs in the user's own browser session, so a search that
/// needs a login (or that the engine gates by region) behaves exactly as
/// it does for them.
pub async fn browser_search_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let query = input.query.trim().to_string();
    if query.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err("A search query is required"))
                .unwrap_or_default(),
        );
    }

    let engine = input.engine.trim().to_lowercase();
    let engine = if engine.is_empty() {
        "360"
    } else {
        engine.as_str()
    };
    let search_url = match search_url_for(engine, &query) {
        Some(url) => url,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err(format!(
                    "Unknown search engine '{engine}'. Supported: 360, bing, baidu."
                )))
                .unwrap_or_default(),
            )
        }
    };

    let (tab_id, label, opened) = match resolve_or_open_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let app = match get_app_handle() {
        Some(app) => app,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("App handle not initialized"))
                    .unwrap_or_default(),
            )
        }
    };
    let webview = match app.get_webview(&label) {
        Some(webview) => webview,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("Browser webview is no longer alive"))
                    .unwrap_or_default(),
            )
        }
    };
    let webview = &webview;

    let parsed = match crate::browser::parse_agent_url(&search_url) {
        Ok(parsed) => parsed,
        Err(e) => {
            return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default());
        }
    };
    // Same per-host pacing as an explicit navigate: a search is a page load
    // at the engine's host and must not be fired faster than a human would.
    browser_throttle::wait_for_host(parsed.host_str().unwrap_or_default()).await;

    if let Err(e) = webview.navigate(parsed) {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!("Navigation failed: {e}")))
                .unwrap_or_default(),
        );
    }

    // The engine renders its result list after the page load event (its own
    // scripts fetch and paint the rows), so the first extraction right after
    // navigation usually sees an empty list. Poll instead of guessing a
    // fixed delay: stop as soon as results appear.
    let script = browser_agent::search_results_script();
    let deadline = std::time::Instant::now() + SEARCH_TIMEOUT;
    let mut last: serde_json::Value = serde_json::json!({ "count": 0 });
    loop {
        match run_script(&label, &script).await {
            Ok(data) => {
                let count = data.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
                if count > 0 {
                    return Json(
                        serde_json::to_value(BrowserResponse::ok(
                            serde_json::json!({
                                "query": query,
                                "engine": engine,
                                "tabId": tab_id,
                                "searchUrl": search_url,
                                "results": data.get("results").cloned().unwrap_or_default(),
                                "count": count,
                            }),
                            opened,
                        ))
                        .unwrap_or_default(),
                    );
                }
                last = data;
            }
            Err(e) => {
                // The webview can be mid-navigation, where evaluation fails.
                // Keep polling until the deadline; the last error is only
                // reported if nothing ever succeeds.
                last = serde_json::json!({ "error": e });
            }
        }

        if std::time::Instant::now() >= deadline {
            let count = last.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
            if count == 0 {
                let page_url = last
                    .get("pageUrl")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                return Json(
                    serde_json::to_value(BrowserResponse::err(format!(
                        "The search page loaded but no results could be extracted (engine '{engine}', page: {page_url}). The engine may have changed its markup, or it may be blocking this request."
                    )))
                    .unwrap_or_default(),
                );
            }
            return Json(
                serde_json::to_value(BrowserResponse::ok(
                    serde_json::json!({
                        "query": query,
                        "engine": engine,
                        "tabId": tab_id,
                        "searchUrl": search_url,
                        "results": last.get("results").cloned().unwrap_or_default(),
                        "count": count,
                    }),
                    opened,
                ))
                .unwrap_or_default(),
            );
        }

        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    }
}

/// Build the result-page URL for `engine`.
///
/// 360 is the default because it renders results for every query without a
/// bot challenge; Bing and Baidu are available as alternatives (they work
/// in the embedded WebView but degrade for plain HTTP clients).
fn search_url_for(engine: &str, query: &str) -> Option<String> {
    let encoded = percent_encode(query);
    match engine {
        "360" | "so" | "so360" => Some(format!("https://www.so.com/s?q={encoded}")),
        "bing" => Some(format!("https://cn.bing.com/search?q={encoded}")),
        "baidu" => Some(format!("https://www.baidu.com/s?wd={encoded}")),
        _ => None,
    }
}

/// Percent-encode a query string for use in a URL's query component.
///
/// Only unreserved characters (RFC 3986) survive; everything else becomes
/// `%XX`. A space is `+` rather than `%20` — every engine this feeds
/// accepts the form-encoded form, and `%20` in `q=` is parsed as a literal
/// space by all of them anyway.
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// `POST /api/browser/read` — page content.
///
/// Returns raw HTML by default; the Node side converts it to markdown. The
/// `format` field selects a different representation for callers that don't
/// want the round trip.
pub async fn browser_read_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::document_html_script();
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/click` — click an element.
pub async fn browser_click_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::click_script(&input.selector, &input.text);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/fill` — set an input's value.
pub async fn browser_fill_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::fill_script(&input.selector, &input.text, &input.value);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/upload` — select a local file in a file input.
///
/// Reads the file, base64-encodes it, and hands it to `upload_script`. See
/// `MAX_UPLOAD_BYTES` for why this is bounded and image-only, and
/// `browser_agent::upload_script` for why the bytes have to be inline rather
/// than fetched from a URL.
///
/// Fails loudly instead of silently doing nothing when the page has no file
/// input: a publish flow that "succeeded" without the media attached is worse
/// than one that stopped.
pub async fn browser_upload_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let raw = input.file.trim();
    if raw.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err(
                "A local file path is required (--file <path>)",
            ))
            .unwrap_or_default(),
        );
    }

    let path = match crate::commands::validate_file_path(raw) {
        Ok(p) => p,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            return Json(
                serde_json::to_value(BrowserResponse::err(format!(
                    "Could not read {}: {e}",
                    path.display()
                )))
                .unwrap_or_default(),
            )
        }
    };
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!(
                "File is {} MiB, over the {} MiB limit for in-page uploads. \
                 Large files (video, long audio) cannot be injected through the \
                 embedded browser — use a headless browser runtime instead.",
                bytes.len() / (1024 * 1024),
                MAX_UPLOAD_BYTES / (1024 * 1024)
            )))
            .unwrap_or_default(),
        );
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload.bin".to_string());
    // Same extension→MIME table the attachment protocol uses, so an upload
    // and a preview of the same file agree on its type.
    let mime = crate::attachment_protocol::mime_from_ext(&path);

    let script = browser_agent::upload_script(&input.selector, &input.text, &file_name, mime, &b64);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/submit` — submit a form.
///
/// The CLI gates this behind user approval; the handler itself does not
/// re-check, because by the time it runs the approval already happened.
pub async fn browser_submit_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::submit_script(&input.selector, &input.text);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

// ──────────────────────────────────────────────────────────
// Shared execution
// ──────────────────────────────────────────────────────────

/// Run a script in the webview identified by `label` and unwrap the envelope.
async fn run_script(label: &str, script: &str) -> Result<serde_json::Value, String> {
    let app = get_app_handle().ok_or_else(|| "App handle not initialized".to_string())?;
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("Browser webview '{label}' is no longer alive"))?;

    let envelope = eval_in_webview(&webview, script, EVAL_TIMEOUT).await?;

    // The envelope is `{"ok":true,"data":…}` or `{"ok":false,"error":…}`.
    if envelope
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        Ok(envelope
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    } else {
        let message = envelope
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown browser error")
            .to_string();
        Err(message)
    }
}

/// Ask the renderer to open the browser panel for a Chat session.
///
/// The webview is an OS-level overlay positioned over a React container, so
/// only the renderer knows where to put it. Rust emits a request event; the
/// renderer opens the split panel and reports back the container bounds.
pub async fn request_browser_open(session_id: &str) -> Result<(), String> {
    let app = get_app_handle().ok_or_else(|| "App handle not initialized".to_string())?;
    use tauri::Emitter;
    app.emit(
        "browser:agent-open-request",
        serde_json::json!({ "sessionId": session_id }),
    )
    .map_err(|e| format!("Failed to request browser open: {e}"))
}

#[cfg(test)]
mod tests {
    use super::has_landed;

    /// Regression guard for "`hamuna browser open https://x` followed by
    /// `hamuna browser read` returns the *previous* page".
    ///
    /// The old page already reports `readyState == complete`, so a poll that
    /// lands between `navigate()` and the new document starting would look
    /// settled. Requiring the URL to change is what makes the wait honest.
    #[test]
    fn a_still_complete_previous_page_has_not_landed() {
        assert!(!has_landed(
            Some("https://example.com/old"),
            true,
            "https://example.com/old"
        ));
        // Mid-navigation the URL can be the new one while the document is
        // still loading; that is not landed either.
        assert!(!has_landed(
            Some("https://example.com/old"),
            false,
            "https://example.com/new"
        ));
    }

    #[test]
    fn a_committed_new_document_has_landed() {
        assert!(has_landed(
            Some("https://example.com/old"),
            true,
            "https://example.com/new"
        ));
    }

    /// A webview that was blank before the navigate has nothing to compare
    /// against, so `about:blank` itself must be the only thing rejected.
    #[test]
    fn a_blank_webview_lands_on_the_first_real_document() {
        assert!(!has_landed(None, true, "about:blank"));
        assert!(!has_landed(None, true, ""));
        assert!(!has_landed(None, false, "https://example.com/new"));
        assert!(has_landed(None, true, "https://example.com/new"));
    }
}
