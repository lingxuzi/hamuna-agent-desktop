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

/// Longest edge, in pixels, that `image-data` will encode. A captcha is tens
/// of pixels; the cap exists so a full-page hero banner cannot push a huge
/// base64 blob through the eval transport (which is a JS source string, not a
/// binary channel).
const MAX_IMAGE_EDGE: u32 = 1024;

/// Bound on waiting for the renderer to open the browser panel and report
/// its bounds.
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);

/// Bound on waiting for the renderer to create an extra browser tab.
///
/// The renderer owns the webview creation (it knows the container geometry),
/// so an agent-requested tab is a round trip: ask, then wait for it to land.
const NEW_TAB_TIMEOUT: Duration = Duration::from_secs(15);

/// Bound on a search: the engine page has to load AND paint its result list
/// before the DOM holds anything to extract.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(25);

/// Bound on waiting for the engine's search box to appear on its homepage.
///
/// The homepage renders the box with its own scripts, so the box can land
/// after `readyState` says "complete".
const SEARCH_BOX_TIMEOUT: Duration = Duration::from_secs(8);

/// Bound on waiting for the engine to act on the typed query — the URL has
/// to change, which is the only proof from the outside that a search was
/// actually sent.
const SUBMIT_TIMEOUT: Duration = Duration::from_secs(4);

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

/// Ceiling on an uploaded file's raw size, **for the single-shot inline path**.
///
/// The file has to travel inside a JS string literal (`upload_script`), so it
/// is base64-inflated 4/3 and then held in memory twice (agent payload +
/// webview heap). 12 MiB covers the real image case — every publish target
/// caps stills at 10 MB or less — and lands well under the 50 MB management
/// API body limit.
///
/// Bigger files go through the chunked path below; this constant is the
/// line where the handler switches.
const MAX_UPLOAD_BYTES: usize = 12 * 1024 * 1024;

/// Ceiling on a chunked upload (video).
///
/// A one-minute 1080p clip is 50–200 MB. The ceiling is 256 MiB: past that
/// the page's own uploader would reject it anyway, and the file has to fit in
/// the webview heap twice (bytes + the `File` the page builds from them).
const MAX_VIDEO_UPLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Raw bytes per chunk in the chunked upload path.
///
/// The chunk's base64 travels inside one eval, so the eval carries 4/3 of
/// this. 8 MiB raw → ~10.7 MiB of base64, which is below the 12 MiB / 16 MiB
/// the single-shot inline path already proves every day.
const UPLOAD_CHUNK_BYTES: usize = 8 * 1024 * 1024;

/// Split a file of `len` bytes into the ranges the chunked path sends.
///
/// Split on **raw byte** boundaries, not on base64 character boundaries: each
/// chunk is encoded on its own (the page's `atob` needs a self-contained
/// string) and the page concatenates the decoded pieces, so the file
/// reassembles byte-for-byte even though every chunk carries its own padding.
fn chunk_ranges(len: usize) -> Vec<std::ops::Range<usize>> {
    if len == 0 {
        return Vec::new();
    }
    (0..len)
        .step_by(UPLOAD_CHUNK_BYTES)
        .map(|start| start..(start + UPLOAD_CHUNK_BYTES).min(len))
        .collect()
}

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
    /// Search engine for `search` ("bing" | "360" | "baidu"). Defaults to bing.
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
    /// Username for `login`. Never logged; see `browser_agent::login_script`.
    #[serde(default)]
    pub username: String,
    /// Password for `login`. Never logged; see `browser_agent::login_script`.
    #[serde(default)]
    pub password: String,
    /// Image index (from `browser images`) for `image-data`.
    #[serde(default)]
    pub index: u32,
    /// Tab index (from `browser tabs`) for `select`.
    #[serde(default)]
    pub tab: u32,
    /// Open the URL in a NEW browser tab instead of the current one.
    #[serde(default)]
    pub new_tab: bool,
    /// Scroll offset in pixels for `scroll` (positive scrolls down, negative up).
    #[serde(default)]
    pub delta: i64,
    /// Scroll destination for `scroll`: "top" or "bottom". Empty means the
    /// offset is relative to wherever the page currently is.
    #[serde(default)]
    pub to: String,
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

/// Resolve a Chat session id to a browser webview label, **without** the
/// "any live browser" fallback.
///
/// The fallback in [`resolve_browser`] picks the most recently created browser
/// in the whole app — and now that each workspace has its own browser profile,
/// that browser may hold a **different workspace's** login. The session id is
/// what ties a browser to a workspace (session ids are globally unique), so
/// anything that reaches *through* the browser into another workspace's data has
/// no business running without one.
///
/// The line is drawn by **effect, not by verb**:
/// - strict: clicking / filling / uploading / submitting / logging in changes
///   the page (typing into somebody else's account, publishing from it), and
///   `read` / `image-data` pull page content *out* of that browser and into
///   this session's context or workspace;
/// - loose: `state` / `tabs` / `select` / `fields` / `images` only report what
///   is on screen, which is how you find out whether a browser is open at all.
async fn resolve_browser_strict(session_id: &str) -> Result<(String, String), String> {
    if session_id.trim().is_empty() {
        return Err(
            "This browser action needs a Chat session id — it must not act on a browser that belongs to another workspace. Open the browser panel in this workspace, or pass --session <id>."
                .to_string(),
        );
    }
    resolve_browser(session_id).await
}

/// Resolve a Chat session id to the owner tab id that groups the browser tabs.
///
/// Same fallback ladder as [`resolve_browser`]: an explicit session id wins,
/// an empty one falls back to the most recently used browser.
async fn resolve_owner(session_id: &str) -> Result<String, String> {
    let manager =
        get_browser_manager().ok_or_else(|| "Browser manager not initialized".to_string())?;

    if !session_id.trim().is_empty() {
        if let Some(owner) = manager.owner_for_session_id(session_id).await {
            return Ok(owner);
        }
        return Err(format!(
            "No browser is open for session {}. Ask the user to open the browser panel, or run `hamuna browser open <url>` to open one.",
            session_id
        ));
    }

    manager.any_owner().await.ok_or_else(|| {
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

/// `POST /api/browser/tabs` — list the tabs of the session's browser panel.
///
/// The agent never sees browser tab ids — those are a renderer-side concept.
/// It addresses tabs by their index in creation order, which is exactly the
/// order the tab strip shows them in.
pub async fn browser_tabs_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let manager = match get_browser_manager() {
        Some(manager) => manager,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("Browser manager not initialized"))
                    .unwrap_or_default(),
            )
        }
    };
    let owner = match resolve_owner(&input.session_id).await {
        Ok(owner) => owner,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let tabs = manager.tabs_of_owner(&owner).await;
    let items: Vec<serde_json::Value> = tabs
        .iter()
        .enumerate()
        .map(|(index, (id, session))| {
            serde_json::json!({
                "index": index,
                "url": manager.url_of(id).unwrap_or_default(),
                "selected": session.is_selected(),
            })
        })
        .collect();

    Json(
        serde_json::to_value(BrowserResponse::ok(
            serde_json::json!({
                "tabs": items,
                "count": tabs.len(),
                "max": crate::browser::MAX_BROWSER_TABS,
            }),
            false,
        ))
        .unwrap_or_default(),
    )
}

/// `POST /api/browser/select` — make tab `tab` the frontmost one.
///
/// Selecting a tab also makes it the one the agent drives: the agent's next
/// `browser read` lands on whatever is on screen.
pub async fn browser_select_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let manager = match get_browser_manager() {
        Some(manager) => manager,
        None => {
            return Json(
                serde_json::to_value(BrowserResponse::err("Browser manager not initialized"))
                    .unwrap_or_default(),
            )
        }
    };
    let owner = match resolve_owner(&input.session_id).await {
        Ok(owner) => owner,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let tabs = manager.tabs_of_owner(&owner).await;
    let Some((browser_tab_id, _)) = tabs.get(input.tab as usize) else {
        return Json(serde_json::to_value(BrowserResponse::err(format!(
            "Tab {} does not exist — this browser has {} tab(s). Run `hamuna browser tabs` to list them.",
            input.tab,
            tabs.len()
        )))
        .unwrap_or_default());
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

    if let Err(e) = crate::browser::select_browser_tab(&app, &manager, browser_tab_id).await {
        return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default());
    }

    Json(
        serde_json::to_value(BrowserResponse::ok(
            serde_json::json!({ "index": input.tab, "url": manager.url_of(browser_tab_id).unwrap_or_default() }),
            false,
        ))
        .unwrap_or_default(),
    )
}

/// `POST /api/browser/navigate` — open a URL in the embedded browser.
///
/// When the Chat has no browser session yet, the handler asks the renderer
/// to open the panel, waits for the webview to appear, then navigates.
///
/// With `new_tab`, the URL lands in an extra tab of the same panel instead of
/// the frontmost one — the agent's way of keeping a reference page open while
/// it works on another.
pub async fn browser_navigate_handler(
    Json(input): Json<BrowserRequest>,
) -> Json<serde_json::Value> {
    let url = input.url.trim().to_string();
    if url.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err("A URL is required")).unwrap_or_default(),
        );
    }

    if input.new_tab {
        return match open_in_new_tab(&input.session_id, &url).await {
            Ok(tab_id) => Json(
                serde_json::to_value(BrowserResponse::ok(
                    serde_json::json!({ "url": url, "tabId": tab_id }),
                    false,
                ))
                .unwrap_or_default(),
            ),
            Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
        };
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

/// One search engine the agent can drive.
///
/// The query is deliberately **not** part of the URL: the browser opens the
/// engine's homepage and types the query into its search box. See
/// `browser_agent::search_type_script` for why a URL is the wrong shape.
struct SearchEngine {
    /// Homepage to open before the query is typed.
    home: &'static str,
    /// Selectors for the engine's search box, most specific first.
    inputs: &'static [&'static str],
}

/// The engines `hamuna browser search` can drive.
///
/// Bing China is the default: its homepage renders for every query without a
/// challenge, and its result markup is what the extractor already knows.
/// 360 and Baidu remain available as alternatives — they are driven the same
/// way, through their own homepages.
const SEARCH_ENGINES: &[(&str, SearchEngine)] = &[
    (
        "bing",
        SearchEngine {
            home: "https://cn.bing.com/",
            inputs: &[
                "#sb_form_q",
                "input[name=q]",
                "textarea[name=q]",
                "input[type=search]",
            ],
        },
    ),
    (
        "360",
        SearchEngine {
            home: "https://www.so.com/",
            inputs: &["#kw", "input[name=q]", "input[type=search]"],
        },
    ),
    (
        "baidu",
        SearchEngine {
            home: "https://www.baidu.com/",
            inputs: &["#kw", "input[name=wd]", "input[type=search]"],
        },
    ),
];

/// The engine to drive when the caller did not name one.
fn resolve_engine_name(raw: &str) -> String {
    let name = raw.trim().to_lowercase();
    if name.is_empty() {
        "bing".to_string()
    } else {
        name
    }
}

/// Look up an engine by name.
fn search_engine_for(name: &str) -> Option<&'static SearchEngine> {
    SEARCH_ENGINES
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, spec)| spec)
}

/// The engine names, for error messages.
fn search_engine_names() -> String {
    SEARCH_ENGINES
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// `POST /api/browser/search` — run a web search in the embedded browser.
///
/// The search runs in the user's own browser session, so a search that
/// needs a login (or that the engine gates by region) behaves exactly as
/// it does for them.
///
/// WHY A TYPED QUERY, NOT A URL
/// ----------------------------
/// The obvious implementation — navigate to `…/search?q=…` and read the DOM
/// — is the one that gets rate-limited. That request is *cold*: no referrer,
/// no warm session, and a shape no human browser produces, so the engine
/// answers with a challenge page, a 429, or an empty result list.
///
/// So the browser opens the engine's homepage, waits for it to render, types
/// the query into the search box and presses Enter — the way a person does
/// it. The engine sees one of its own pages, used the way it is meant to be
/// used, and the rendered result list is read back from the DOM.
pub async fn browser_search_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let query = input.query.trim().to_string();
    if query.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err("A search query is required"))
                .unwrap_or_default(),
        );
    }

    let engine = resolve_engine_name(&input.engine);
    let Some(spec) = search_engine_for(&engine) else {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!(
                "Unknown search engine '{engine}'. Supported: {}.",
                search_engine_names()
            )))
            .unwrap_or_default(),
        );
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

    // ── 1. Open the engine's homepage (no query in the URL) ─────────────
    let parsed = match crate::browser::parse_agent_url(spec.home) {
        Ok(parsed) => parsed,
        Err(e) => {
            return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default());
        }
    };
    // Same per-host pacing as an explicit navigate: a search starts a page
    // load at the engine's host and must not be fired faster than a human
    // would.
    let host = parsed.host_str().unwrap_or_default().to_string();
    browser_throttle::wait_for_host(&host).await;

    let before = current_url(&label).await;
    if let Err(e) = webview.navigate(parsed) {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!("Navigation failed: {e}")))
                .unwrap_or_default(),
        );
    }
    wait_for_loaded(&label, before.as_deref(), spec.home, &host).await;

    // ── 2. Wait for the search box, then type the query into it ────────
    if !wait_for_search_box(&label, spec.inputs).await {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!(
                "The search engine's page ({}) loaded but its search box never appeared.",
                spec.home
            )))
            .unwrap_or_default(),
        );
    }

    let home_url = current_url(&label).await;
    if let Err(e) = run_script(
        &label,
        &browser_agent::search_type_script(&query, spec.inputs),
    )
    .await
    {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!(
                "Could not type the query into the search box: {e}"
            )))
            .unwrap_or_default(),
        );
    }

    // ── 3. Press Enter; fall back to submitting the form ───────────────
    // Enter is what a human presses and most engines act on it. Some ignore
    // a synthetic key event, so the engine's own form submit stands behind
    // it — same fields, same action, same referrer.
    if !wait_for_url_change(&label, home_url.as_deref()).await {
        if let Err(e) = run_script(&label, &browser_agent::search_submit_script(spec.inputs)).await
        {
            return Json(
                serde_json::to_value(BrowserResponse::err(format!(
                    "The search box accepted the query but the engine never searched: {e}"
                )))
                .unwrap_or_default(),
            );
        }
        if !wait_for_url_change(&label, home_url.as_deref()).await {
            return Json(
                serde_json::to_value(BrowserResponse::err(
                    "The search box accepted the query but the engine never searched for it.",
                ))
                .unwrap_or_default(),
            );
        }
    }

    // ── 4. Read the rendered result list ───────────────────────────────
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
                                "pageUrl": data.get("pageUrl").cloned().unwrap_or_default(),
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
                        "pageUrl": last.get("pageUrl").cloned().unwrap_or_default(),
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

/// Wait until the engine's search box is in the DOM and can be typed into.
///
/// The homepage's own scripts render the box, and they are not done when
/// `readyState` says "complete" — so the box itself is what gets waited for.
async fn wait_for_search_box(label: &str, inputs: &[&str]) -> bool {
    let script = browser_agent::search_box_script(inputs);
    let deadline = tokio::time::Instant::now() + SEARCH_BOX_TIMEOUT;
    loop {
        if let Ok(data) = run_script(label, &script).await {
            if data.get("found").and_then(|v| v.as_bool()) == Some(true) {
                return true;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Wait until the page navigated away from `before`.
///
/// Proof that the query was actually sent: the engine either rendered its
/// result page (the URL changed) or nothing happened (it did not).
async fn wait_for_url_change(label: &str, before: Option<&str>) -> bool {
    let script = browser_agent::page_state_script();
    let deadline = tokio::time::Instant::now() + SUBMIT_TIMEOUT;
    loop {
        if let Ok(data) = run_script(label, &script).await {
            let ready = data.get("readyState").and_then(|v| v.as_str()) == Some("complete");
            let url = data.get("url").and_then(|v| v.as_str()).unwrap_or_default();
            if ready && before != Some(url) {
                return true;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
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
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
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

/// `POST /api/browser/scroll` — move the viewport of the current page.
///
/// Scrolling is not a page-content read but it is not a no-op either: it moves
/// what the user is looking at. It therefore goes through the **strict**
/// session resolution, like every other verb that changes the page — an agent
/// must not scroll a browser that belongs to another workspace.
pub async fn browser_scroll_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let to = match input.to.trim().to_ascii_lowercase().as_str() {
        "" => "",
        "top" => "top",
        "bottom" => "bottom",
        other => {
            let msg = format!("Unknown scroll destination '{other}'. Use top or bottom.");
            return Json(serde_json::to_value(BrowserResponse::err(msg)).unwrap_or_default());
        }
    };

    if to.is_empty() && input.delta == 0 && input.selector.is_empty() && input.text.is_empty() {
        return Json(serde_json::to_value(BrowserResponse::err(
            "Nothing to scroll: pass a pixel offset, top/bottom, or a target to bring into view.",
        ))
        .unwrap_or_default());
    }

    let script = browser_agent::scroll_script(input.delta, to, &input.selector, &input.text);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/fill` — set an input's value.
pub async fn browser_fill_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
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
/// Reads the file and hands it to the page two ways, picked by size:
///
/// - **≤ `MAX_UPLOAD_BYTES`** — base64-inline, one eval. The proven path for
///   stills.
/// - **bigger** — chunked (`upload_begin` / `upload_chunk` / `upload_finalize`).
///   This is the video path: a clip no longer has to fit in a single JS
///   string literal. See `browser_agent::upload_begin_script`.
///
/// The bytes always travel **inline**, never fetched from a URL: the page is
/// a third-party site (creator.douyin.com), and handing it a URL to pull
/// bytes from would be both a CORS gamble and a way to point a logged-in
/// session at an address of our choosing. The chunks arrive as script text
/// and are decoded in place.
///
/// Fails loudly instead of silently doing nothing when the page has no file
/// input: a publish flow that "succeeded" without the media attached is worse
/// than one that stopped.
pub async fn browser_upload_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
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
    if bytes.len() > MAX_VIDEO_UPLOAD_BYTES {
        return Json(
            serde_json::to_value(BrowserResponse::err(format!(
                "File is {} MiB, over the {} MiB ceiling for in-page uploads.",
                bytes.len() / (1024 * 1024),
                MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024)
            )))
            .unwrap_or_default(),
        );
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload.bin".to_string());
    // Same extension→MIME table the attachment protocol uses, so an upload
    // and a preview of the same file agree on its type.
    let mime = crate::attachment_protocol::mime_from_ext(&path);

    if bytes.len() <= MAX_UPLOAD_BYTES {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let script =
            browser_agent::upload_script(&input.selector, &input.text, &file_name, mime, &b64);
        return match run_script(&label, &script).await {
            Ok(data) => {
                Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
            }
            Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
        };
    }

    match upload_chunked(&label, &input.selector, &input.text, &file_name, mime, &bytes).await {
        Ok(data) => Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default()),
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// Push a file into the page in chunks and assemble it there.
///
/// The single-shot path puts the whole file into one JS string literal, which
/// caps it at `MAX_UPLOAD_BYTES`. Video does not fit in that, so the bytes
/// travel as several evals and the page builds the `File` from them.
///
/// The bytes are split on **raw** byte boundaries and each piece is base64'd
/// on its own: `atob` needs a self-contained string, and the page concatenates
/// the decoded pieces, so the file reassembles byte-for-byte.
async fn upload_chunked(
    label: &str,
    selector: &str,
    text: &str,
    file_name: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<serde_json::Value, String> {
    use base64::Engine;

    let begin = browser_agent::upload_begin_script(selector, text, file_name, mime);
    run_script(label, &begin).await?;

    let ranges = chunk_ranges(bytes.len());
    for (i, range) in ranges.iter().enumerate() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes[range.clone()]);
        let script = browser_agent::upload_chunk_script(&b64);
        run_script(label, &script)
            .await
            .map_err(|e| format!("Upload chunk {}/{} failed: {e}", i + 1, ranges.len()))?;
    }

    let finalize = browser_agent::upload_finalize_script(selector, text);
    run_script(label, &finalize).await
}

/// `POST /api/browser/submit` — submit a form.
///
/// The CLI gates this behind user approval; the handler itself does not
/// re-check, because by the time it runs the approval already happened.
pub async fn browser_submit_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
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

/// `POST /api/browser/images` — list the page's visible images.
///
/// The agent needs this before it can see a captcha: it returns a stable
/// index per image, and `image-data` takes that index back. The `src` URL is
/// informational only — a captcha URL usually resolves differently per
/// cookie, so the agent must not fetch it from outside the page.
pub async fn browser_images_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::document_images_script();
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/fields` — the page's visible form fields and buttons,
/// each with a CSS selector that resolves to it.
///
/// The discovery primitive for agent-driven forms: without it the agent can
/// click buttons it can read but cannot find the textbox it has to type into.
pub async fn browser_fields_handler(
    Json(input): Json<BrowserRequest>,
) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::fields_script();
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/image-data` — one image's pixels, as a data URL.
///
/// Read in-page via canvas (`browser_agent::image_data_script` explains why),
/// so the bytes are exactly what the user is looking at. A cross-origin image
/// fails loudly instead of returning a different picture.
pub async fn browser_image_data_handler(
    Json(input): Json<BrowserRequest>,
) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    let script = browser_agent::image_data_script(input.index, MAX_IMAGE_EDGE);
    match run_script(&label, &script).await {
        Ok(data) => {
            Json(serde_json::to_value(BrowserResponse::ok(data, false)).unwrap_or_default())
        }
        Err(e) => Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    }
}

/// `POST /api/browser/login` — fill username + password and report whether a
/// captcha stands in the way.
///
/// Deliberately does NOT submit: the caller needs a chance to read the captcha
/// first. `submit` stays a separate, user-approved step.
pub async fn browser_login_handler(Json(input): Json<BrowserRequest>) -> Json<serde_json::Value> {
    let (_tab_id, label) = match resolve_browser_strict(&input.session_id).await {
        Ok(found) => found,
        Err(e) => return Json(serde_json::to_value(BrowserResponse::err(e)).unwrap_or_default()),
    };

    if input.username.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err(
                "A username is required (--user <name>)",
            ))
            .unwrap_or_default(),
        );
    }
    if input.password.is_empty() {
        return Json(
            serde_json::to_value(BrowserResponse::err(
                "A password is required (--password-stdin reads it from stdin)",
            ))
            .unwrap_or_default(),
        );
    }

    let script = browser_agent::login_script(&input.username, &input.password);
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

/// Open `url` in an extra tab of the session's browser panel.
///
/// Only the renderer can create a webview (it owns the container geometry), so
/// this is a round trip: ask the renderer, then wait for the new tab to show
/// up in the registry. The new tab becomes the owner's frontmost one, which is
/// also the one the agent drives next.
async fn open_in_new_tab(session_id: &str, url: &str) -> Result<String, String> {
    let manager =
        get_browser_manager().ok_or_else(|| "Browser manager not initialized".to_string())?;

    let owner = manager
        .owner_for_session_id(session_id)
        .await
        .ok_or_else(|| {
            format!(
                "No browser is open for session {session_id}. Run `hamuna browser open <url>` first."
            )
        })?;

    let before = manager.tabs_of_owner(&owner).await.len();
    if !manager.has_tab_capacity(&owner).await {
        return Err(format!(
            "This browser already has {before} tabs (max {}) — close one before opening another.",
            crate::browser::MAX_BROWSER_TABS
        ));
    }

    request_browser_new_tab(&owner, url).await?;

    let deadline = std::time::Instant::now() + NEW_TAB_TIMEOUT;
    loop {
        let tabs = manager.tabs_of_owner(&owner).await;
        if tabs.len() > before {
            let (tab_id, _) = tabs.last().expect("tabs is non-empty");
            return Ok(tab_id.clone());
        }
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for the new browser tab to open.".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    }
}

/// Ask the renderer to create one more browser tab for `owner_tab_id`.
///
/// The event name carries the owner so a Chat tab only reacts to its own
/// request — several browser panels can be open at once.
pub async fn request_browser_new_tab(owner_tab_id: &str, url: &str) -> Result<(), String> {
    let app = get_app_handle().ok_or_else(|| "App handle not initialized".to_string())?;
    use tauri::Emitter;
    app.emit(
        &format!("browser:agent-new-tab-request:{owner_tab_id}"),
        serde_json::json!({ "url": url }),
    )
    .map_err(|e| format!("Failed to request a new browser tab: {e}"))
}

#[cfg(test)]
mod tests {
    use super::has_landed;
    use super::{
        resolve_engine_name, search_engine_for, search_engine_names, MAX_UPLOAD_BYTES,
        MAX_VIDEO_UPLOAD_BYTES, SEARCH_ENGINES,
    };

    /// A write without a session id must be refused — not silently aimed at
    /// whichever browser was opened last (which may be another workspace's).
    #[tokio::test]
    async fn write_actions_refuse_to_act_without_a_session_id() {
        let err = super::resolve_browser_strict("")
            .await
            .expect_err("must refuse");
        assert!(
            err.contains("session id"),
            "错误要说清缺的是 session id: {err}"
        );
    }

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

    /// The whole point of the typed search: the query never rides in a URL.
    ///
    /// A cold `…/search?q=…` request is what the engine's anti-bot measures
    /// a scraper by, and it answers with a challenge page or an empty result
    /// list. If an engine homepage ever grows a query string, the search
    /// silently goes back to that shape.
    #[test]
    fn no_engine_home_carries_a_query() {
        for (name, spec) in SEARCH_ENGINES {
            assert!(
                !spec.home.contains('?'),
                "engine '{name}' would put the query in the URL: {}",
                spec.home
            );
            assert!(
                !spec.inputs.is_empty(),
                "engine '{name}' has no search box to type into"
            );
        }
    }

    #[test]
    fn the_default_engine_is_bing_china() {
        assert_eq!(resolve_engine_name(""), "bing");
        assert_eq!(resolve_engine_name("  "), "bing");
        assert_eq!(resolve_engine_name("BING"), "bing");
        assert_eq!(resolve_engine_name("360"), "360");
        let spec = search_engine_for(&resolve_engine_name("")).expect("bing must exist");
        assert_eq!(spec.home, "https://cn.bing.com/");
    }

    #[test]
    fn an_unknown_engine_is_refused_by_name() {
        assert!(search_engine_for("bing").is_some());
        assert!(search_engine_for("duckduckgo").is_none());
        // The error has to name the engines that do work.
        assert!(search_engine_names().contains("bing"));
        assert!(search_engine_names().contains("baidu"));
    }

    /// The chunk split has to cover the file exactly — no gap, no overlap.
    ///
    /// A dropped byte range means the page assembles a **truncated** file, and
    /// the uploader accepts it: the video posts, but it is short. Silent
    /// truncation is the failure mode this guards.
    #[test]
    fn chunk_ranges_cover_the_file_exactly() {
        for len in [0usize, 1, 1024, MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1] {
            let ranges = super::chunk_ranges(len);
            let covered: usize = ranges.iter().map(|r| r.len()).sum();
            assert_eq!(covered, len, "len={len} lost or duplicated bytes");
            // The ranges must be contiguous and in order.
            let mut cursor = 0usize;
            for r in &ranges {
                assert_eq!(r.start, cursor, "len={len} has a gap");
                assert!(r.end <= len);
                cursor = r.end;
            }
        }
    }

    /// A file over the inline ceiling must still be uploadable.
    ///
    /// The old handler refused anything over 12 MiB, which made video
    /// unpublishable. The chunked path is the whole point of the ceiling
    /// split, so the split point has to actually route big files to it.
    #[test]
    fn a_file_over_the_inline_ceiling_still_fits_under_the_video_ceiling() {
        assert!(MAX_UPLOAD_BYTES < MAX_VIDEO_UPLOAD_BYTES);
        let big = MAX_UPLOAD_BYTES + 1;
        assert!(big <= MAX_VIDEO_UPLOAD_BYTES);
        // And it takes more than one chunk, so the chunked path is the one
        // that has to be exercised.
        assert!(super::chunk_ranges(big).len() > 1);
    }
}
