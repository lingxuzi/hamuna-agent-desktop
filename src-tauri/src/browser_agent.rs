// browser_agent.rs — DOM scripts the agent CLI runs inside the embedded browser
//
// Every script here is a self-contained JS EXPRESSION (WebView2's
// `ExecuteScript` and WKWebView's `evaluateJavaScript` both take an
// expression, not a statement list — no `await`, no multi-statement body).
// `browser::eval_in_webview` wraps each one in a try/catch envelope, because
// Windows silently drops uncaught script exceptions.
//
// Selector matching supports both forms the CLI accepts:
//   - CSS selector      → `document.querySelector(sel)`
//   - visible text      → scan candidate elements for matching text content
//
// Text matching is tried EXACT first, then CONTAINS. When nothing matches,
// the error carries the visible candidate labels so the agent can retry with
// a different target instead of guessing blind.

// ──────────────────────────────────────────────────────────
// Shared JS helpers (inlined into each script)
// ──────────────────────────────────────────────────────────

/// Installs the locate helpers on `window` exactly once, then evaluates to
/// `true`.
///
/// The helpers live on `window` so a single script can install them and the
/// next one reuse them — but each script is still self-contained (it calls
/// the installer first), because a navigation wipes `window` and the next
/// agent command must work on a freshly loaded page.
const INSTALL_HELPERS: &str = r#"
(() => {
  if (!window.__hamunaAgentHelpers) {
    window.__hamunaAgentHelpers = true;
    const __hamunaVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = window.getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    };
    const __hamunaLabel = (el) => {
      const t = (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
      return t.length > 80 ? t.slice(0, 80) + '…' : t;
    };
    const __hamunaCandidates = () => {
      const sel = 'a,button,input,textarea,select,[role=button],[role=link],[onclick]';
      return Array.from(document.querySelectorAll(sel)).filter(__hamunaVisible).slice(0, 60).map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: __hamunaLabel(el),
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
      }));
    };
    const __hamunaLocate = (selector, text) => {
      if (selector) {
        const el = document.querySelector(selector);
        if (!el) throw new Error('No element matches CSS selector: ' + selector);
        return el;
      }
      if (!text) throw new Error('Either a CSS selector or a text query is required');
      const needle = text.trim().toLowerCase();
      const pool = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link]'));
      const visible = pool.filter(__hamunaVisible);
      const texts = visible.map((el) => __hamunaLabel(el).toLowerCase());
      let idx = texts.findIndex((t) => t === needle);
      if (idx === -1) idx = texts.findIndex((t) => t.includes(needle));
      if (idx === -1) {
        const cands = __hamunaCandidates().map((c) => c.label).filter(Boolean);
        throw new Error('No visible element matches text: ' + text + '. Candidates: ' + (cands.slice(0, 20).join(' | ') || '(none)'));
      }
      return visible[idx];
    };
    window.__hamunaLocate = __hamunaLocate;
    window.__hamunaCandidates = __hamunaCandidates;
    window.__hamunaLabel = __hamunaLabel;
  }
  return true;
})()
"#;

// ──────────────────────────────────────────────────────────
// Scripts
// ──────────────────────────────────────────────────────────

/// Page title + current URL + whether the document looks loaded.
pub fn page_state_script() -> String {
    format!(
        "{INSTALL_HELPERS} && (() => ({{ title: document.title || '', url: location.href, readyState: document.readyState }}))()"
    )
}

/// Full document HTML. Kept raw — the Node side converts it to markdown.
pub fn document_html_script() -> String {
    format!(
        "{INSTALL_HELPERS} && (() => document.documentElement ? document.documentElement.outerHTML : '')()"
    )
}

/// Click an element located by CSS selector or visible text.
///
/// Returns a description of what was clicked so the agent can confirm it hit
/// the intended target. Form submits are NOT performed here — a separate
/// `submit` script exists so the CLI can gate that action behind approval.
pub fn click_script(selector: &str, text: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const el = window.__hamunaLocate({sel}, {txt});
  const label = window.__hamunaLabel(el);
  const tag = el.tagName.toLowerCase();
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  el.click();
  return {{ tag, label, id: el.id || undefined }};
}})()"
    )
}

/// Fill an input / textarea / contenteditable element.
///
/// Dispatches `input` and `change` events so frameworks with controlled
/// components (React, Vue) actually register the new value — setting
/// `.value` alone is silently ignored by many of them.
pub fn fill_script(selector: &str, text: &str, value: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    let val = js_string(value);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const el = window.__hamunaLocate({sel}, {txt});
  const tag = el.tagName.toLowerCase();
  const isEditable = tag === 'input' || tag === 'textarea' || el.isContentEditable;
  if (!isEditable) throw new Error('Element is not fillable (tag=' + tag + ')');
  const proto = tag === 'input' ? window.HTMLInputElement.prototype
    : tag === 'textarea' ? window.HTMLTextAreaElement.prototype
    : window.HTMLDivElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, {val}); else el.value = {val};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return {{ tag, label: window.__hamunaLabel(el) }};
}})()"
    )
}

/// Set a file input's selection from base64 bytes.
///
/// WHY BASE64 AND NOT A URL
/// ------------------------
/// The only channel into the page is `eval_with_callback`'s script string
/// (WebView2 `ExecuteScript` / WKWebView `evaluateJavaScript` both take a
/// string). So the file has to be *inside* the script. That rules out
/// `fetch('hamuna://…')` in the page: several publish targets (Xiaohongshu,
/// Douyin) ship a `connect-src` CSP that rejects custom schemes, and the
/// failure would surface as "upload did nothing" rather than an error.
///
/// Base64 costs 4/3 size and a JS string literal per file. That is acceptable
/// for images (a 5 MB photo becomes ~7 MB of script) and is why video is
/// rejected before it reaches here — see `MAX_UPLOAD_BYTES`.
///
/// `DataTransfer` is the only way to populate `input.files` from script;
/// assigning to `.files` directly is ignored. React-controlled uploaders also
/// need the `change` event dispatched, same reason `fill_script` dispatches
/// `input`/`change`.
///
/// Returns `{ selector, name, size, inputCount }` — `inputCount` > 1 means the
/// page has several file inputs and only the located one was touched.
///
/// `mime` comes from the caller (derived from the real file extension), NOT
/// from `input.accept`: `accept` is frequently written as `.png,.jpg` or left
/// empty, and copying that verbatim into `File.type` hands the site an
/// extension where it expects a MIME type — some uploaders reject that.
pub fn upload_script(selector: &str, text: &str, file_name: &str, mime: &str, base64: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    let name = js_string(file_name);
    let mime = js_string(mime);
    let b64 = js_string(base64);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const el = window.__hamunaLocate({sel}, {txt});
  const tag = el.tagName.toLowerCase();
  const input = tag === 'input' && el.type === 'file'
    ? el
    : el.querySelector && el.querySelector('input[type=file]');
  if (!input) throw new Error('Target is not a file input and contains none (tag=' + tag + ')');

  const bin = atob({b64});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], {name}, {{ type: {mime} }});

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', {{ bubbles: true }}));
  input.dispatchEvent(new Event('change', {{ bubbles: true }}));

  return {{
    selector: {sel} || {txt},
    name: file.name,
    size: file.size,
    inputCount: document.querySelectorAll('input[type=file]').length
  }};
}})()"
    )
}

/// Submit a form — either the form containing the target, or the target
/// itself when it IS a form.
///
/// The agent CLI gates this action behind user approval because submitting is
/// an externally-visible side effect (an order, a post, a message).
pub fn submit_script(selector: &str, text: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const el = window.__hamunaLocate({sel}, {txt});
  const tag = el.tagName.toLowerCase();
  let form = null;
  if (tag === 'form') form = el;
  else if (typeof el.form === 'object' && el.form) form = el.form;
  else form = el.closest ? el.closest('form') : null;
  if (!form) throw new Error('No form found for the target element');
  const label = window.__hamunaLabel(el);
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.submit();
  return {{ submitted: true, label }};
}})()"
    )
}

/// Extract organic search results from a search-engine result page.
///
/// Returns `{ engine, results: [{ title, url, snippet }] }`. The script tries
/// each engine profile in order and stops at the first one that yields
/// results — engine markup changes without notice, and a single hard-coded
/// selector would break silently (an empty result list looks like "no
/// matches" rather than "selector changed").
///
/// The URL is read from the profile's real-URL attribute when present
/// (360 hides the destination behind a `so.com/link?m=…` redirect and keeps
/// the real one in `data-mdurl`). Falling back to the anchor's `href` would
/// hand the agent a redirect it cannot use.
pub fn search_results_script() -> String {
    r#"(function () {
  const text = (el) => el ? (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ') : '';
  const PROFILES = [
    { engine: 'so360',   container: '.res-list',                       title: 'h3.res-title a',              url: 'a[data-mdurl]',        snippet: '.res-desc, .res-comm-con, .mh-detail' },
    { engine: 'bing',    container: 'li.b_algo',                        title: 'h2 a',                        url: 'h2 a',                 snippet: '.b_caption p' },
    { engine: 'baidu',   container: '#content_left .result, #content_left .c-container', title: 'h3 a',          url: '[mu], a[href]',        snippet: '.c-abstract, [class*=content-right]' },
    { engine: 'ddg',     container: '.result, .web-result',            title: 'a.result__a, h2 a',          url: 'a.result__a, h2 a',    snippet: '.result__snippet' },
    { engine: 'sogou',   container: '.vrwrap, .rb',                    title: 'h3 a, h4 a',                  url: 'h3 a, h4 a',           snippet: '.str-info, .text-layout' },
    { engine: 'generic', container: 'li.result, article.result, div.result', title: 'h2 a, h3 a',             url: 'h2 a, h3 a',           snippet: 'p' }
  ];
  const results = [];
  let engine = null;
  for (const profile of PROFILES) {
    const nodes = Array.from(document.querySelectorAll(profile.container));
    if (!nodes.length) continue;
    const found = [];
    for (const node of nodes) {
      const anchor = node.querySelector(profile.title);
      if (!anchor) continue;
      const title = text(anchor);
      if (!title) continue;
      let url = '';
      const urlHost = node.querySelector(profile.url);
      if (urlHost) {
        const real = urlHost.getAttribute('data-mdurl') || urlHost.getAttribute('mu') || urlHost.getAttribute('href') || '';
        if (/^https?:\/\//.test(real)) url = real;
      }
      if (!url) {
        const href = anchor.getAttribute('href') || '';
        if (/^https?:\/\//.test(href)) url = href;
      }
      if (!url) continue;
      let snippet = text(node.querySelector(profile.snippet));
      if (!snippet) {
        // No dedicated snippet element: take the container text minus the
        // title line, which is always present in some form.
        snippet = text(node).slice(0, 400);
        if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
      }
      found.push({ title: title.slice(0, 300), url: url.slice(0, 1000), snippet: snippet.slice(0, 600) });
      if (found.length >= 10) break;
    }
    if (found.length) {
      engine = profile.engine;
      results.push.apply(results, found);
      break;
    }
  }
  return {
    engine: engine,
    count: results.length,
    results: results,
    pageTitle: document.title || '',
    pageUrl: location.href
  };
})()"#
    .to_string()
}

/// Escape a Rust string as a JS string literal.
fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_string_escapes_quotes_and_newlines() {
        assert_eq!(js_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(js_string("line1\nline2"), "\"line1\\nline2\"");
    }

    /// The upload script carries the file as a JS string literal, so a base64
    /// payload must not be able to terminate the literal and inject code.
    /// Base64's alphabet has no quote or backslash, but the value is
    /// attacker-adjacent (it comes from a path the agent was told to read), so
    /// it goes through `js_string` like every other interpolated value.
    #[test]
    fn upload_script_embeds_payload_safely() {
        let script = upload_script(
            "input[type=file]",
            "",
            "cover.png",
            "image/png",
            "a\"+alert(1)+\"",
        );
        assert!(!script.contains("a\"+alert(1)"), "{script}");
        assert!(script.contains(r#"a\"+alert(1)+\""#), "{script}");
    }

    #[test]
    fn scripts_are_self_contained_expressions() {
        // Each script must be a single expression — WebView2's ExecuteScript
        // returns the value of the last expression, and the envelope in
        // eval_in_webview embeds the script as `return (<script>)`. A top-level
        // statement (a `;` outside any bracket) would turn that into a syntax
        // error instead of a value.
        for script in [
            page_state_script(),
            document_html_script(),
            click_script("button", ""),
            fill_script("input", "", "hello"),
            upload_script("input[type=file]", "", "a.png", "image/png", "iVBORw0KGgo="),
            submit_script("form", ""),
            search_results_script(),
        ] {
            assert!(
                script.contains("__hamunaLocate") || script.contains("document"),
                "{script}"
            );
            assert!(
                is_single_expression(&script),
                "script must be one expression:\n{script}"
            );
            // A Promise would serialize to `{}` — the scripts stay synchronous.
            assert!(!script.contains("await"), "{script}");
        }
    }

    /// Is `script` one expression rather than a statement list?
    ///
    /// Walks the text tracking bracket depth and skipping string literals, so
    /// a `;` inside a function body (legal) does not count as a top-level
    /// statement separator (not legal).
    fn is_single_expression(script: &str) -> bool {
        let chars: Vec<char> = script.chars().collect();
        let mut depth = 0i32;
        let mut i = 0;
        while i < chars.len() {
            match chars[i] {
                q @ ('\'' | '"' | '`') => {
                    i += 1;
                    while i < chars.len() {
                        if chars[i] == '\\' {
                            i += 2;
                            continue;
                        }
                        if chars[i] == q {
                            break;
                        }
                        i += 1;
                    }
                    if i >= chars.len() {
                        return false; // unterminated string
                    }
                }
                '(' | '{' | '[' => depth += 1,
                ')' | '}' | ']' => {
                    depth -= 1;
                    if depth < 0 {
                        return false;
                    }
                }
                ';' if depth == 0 => return false,
                _ => {}
            }
            i += 1;
        }
        depth == 0
    }

    #[test]
    fn fill_script_embeds_value_safely() {
        let script = fill_script("input", "", "he said \"hi\"");
        assert!(script.contains("he said \\\"hi\\\""));
    }
}
