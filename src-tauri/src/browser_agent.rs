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

    // Everything the agent can act on. `locate` and `fields` share this list
    // so a target the agent discovered is always a target it can click.
    const __hamunaInteractiveSel = 'a,button,input,textarea,select,[role=button],[role=link],[role=tab],[contenteditable],[onclick]';

    // ── Frames ────────────────────────────────────────────────
    // The document of a same-origin frame is another tree that a shallow
    // query cannot see into. The contentDocument of a cross-origin frame is
    // null, and of a detached frame it throws; both are unreachable by
    // design rather than errors.
    const __hamunaIsFrame = (el) => {
      const tag = String((el && el.tagName) || '').toLowerCase();
      return tag === 'iframe' || tag === 'frame';
    };
    const __hamunaFrameDoc = (el) => {
      try { return el.contentDocument || null; } catch (e) { return null; }
    };
    // The window that owns a document. Style and hit-testing questions must
    // be asked of the window the element actually lives in, not the top one:
    // coordinates inside a frame are relative to that frame viewport, and an
    // event built by the wrong realm is a stranger to the page code that
    // receives it.
    const __hamunaOwnerWindow = (el) => {
      try {
        const doc = el && el.ownerDocument;
        return (doc && doc.defaultView) || window;
      } catch (e) { return window; }
    };

    const __hamunaVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      // The style of an element inside a frame comes from the frame document.
      const st = __hamunaOwnerWindow(el).getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    };
    const __hamunaLabel = (el) => {
      const t = (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
      return t.length > 80 ? t.slice(0, 80) + '…' : t;
    };
    const __hamunaAttr = (el, name) => {
      try { return el.getAttribute(name); } catch (e) { return null; }
    };

    // ── The deep tree ─────────────────────────────────────────
    // `document.querySelectorAll` stops at a shadow boundary and at an
    // iframe. A growing share of component libraries — the Douyin creator
    // backend included — render their real controls inside a shadow root,
    // so a shallow query only ever sees the host element, whose innerText
    // is the entire toolbar. That is exactly how `click --text 发布`
    // ended up clicking a container labelled "发布图文 支持常用……".
    const __hamunaRoots = () => {
      const roots = [document];
      const seen = new Set([document]);
      // One recursion covers both boundary kinds, at any nesting depth: a
      // shadow root and a same-origin iframe document are both "another tree
      // that a shallow query cannot see into". Cross-origin frames yield null
      // or throw on `contentDocument` and are skipped silently by design.
      const visit = (root) => {
        let all;
        try { all = root.querySelectorAll('*'); } catch (e) { return; }
        for (const el of all) {
          const sr = el.shadowRoot;
          if (sr && !seen.has(sr)) { seen.add(sr); roots.push(sr); visit(sr); }
          if (__hamunaIsFrame(el)) {
            const doc = __hamunaFrameDoc(el);
            if (doc && !seen.has(doc)) { seen.add(doc); roots.push(doc); visit(doc); }
          }
        }
      };
      visit(document);
      return roots;
    };

    // How many file inputs the page offers, counted across every tree it
    // hides one in. A count taken from the top document alone says "one"
    // while the publish form carries a second one inside a frame, and the
    // agent then uploads into the wrong control without being warned.
    const __hamunaFileInputCount = () => {
      let count = 0;
      for (const root of __hamunaRoots()) {
        let found;
        try { found = root.querySelectorAll('input[type=file]'); } catch (e) { continue; }
        count += found.length;
      }
      return count;
    };

    const __hamunaCssPath = (el) => {
      // A CSS selector that resolves to exactly this element WITHIN ITS ROOT.
      // `#id` when the id is unique there; otherwise a structural path up to
      // the nearest ancestor with an id, with `:nth-of-type` disambiguating
      // siblings. The root scope matters: an id lookup scoped to `document`
      // never sees an element living inside a shadow root.
      const root = el.getRootNode ? el.getRootNode() : document;
      if (el.id) {
        const byId = '#' + CSS.escape(el.id);
        try {
          if (root.querySelectorAll(byId).length === 1) return byId;
        } catch (e) { /* fall through to the structural path */ }
      }
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 12) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift('#' + CSS.escape(node.id));
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    // A selector that resolves from the top document even when the target
    // lives inside a shadow root or a same-origin iframe. Each boundary
    // becomes one hop, joined by the boundary marker: the frame is addressed
    // by the selector of the frame ELEMENT, then the selector continues
    // inside the document of that frame.
    //
    // Returns the empty string for anything we cannot address (a cross-origin
    // frame, a detached node). Emitting a plausible-looking selector would
    // send the agent to the wrong element, which is worse than admitting it
    // cannot.
    const __hamunaCssPathDeep = (el) => {
      const segs = [];
      let node = el;
      let guard = 0;
      while (node && node.nodeType === 1 && guard < 12) {
        guard += 1;
        const root = node.getRootNode ? node.getRootNode() : document;
        if (root === document) { segs.unshift(__hamunaCssPath(node)); return segs.join(' >>> '); }
        if (root.host) { segs.unshift(__hamunaCssPath(node)); node = root.host; continue; }
        // An iframe document: address the frame element, then continue inside.
        let frame = null;
        try { frame = root.defaultView && root.defaultView.frameElement; } catch (e) { frame = null; }
        if (!frame) return '';
        segs.unshift(__hamunaCssPath(node));
        node = frame;
      }
      return segs.join(' >>> ');
    };

    const __hamunaFindBySelector = (selector) => {
      const raw = String(selector);
      if (raw.indexOf('>>>') === -1) {
        try { return document.querySelector(raw); } catch (e) { return null; }
      }
      const segs = raw.split('>>>').map((s) => s.trim()).filter(Boolean);
      let root = document;
      let el = null;
      for (let i = 0; i < segs.length; i += 1) {
        let found = null;
        try { found = root.querySelector(segs[i]); } catch (e) { found = null; }
        if (!found) return null;
        el = found;
        if (i < segs.length - 1) {
          // One hop down a boundary: a shadow root, or the document of a
          // same-origin frame. A frame element never has a shadow root, so
          // the two cases do not collide.
          root = el.shadowRoot || (__hamunaIsFrame(el) ? __hamunaFrameDoc(el) : null);
          if (!root) {
            if (__hamunaIsFrame(el)) {
              throw new Error('The selector crosses an iframe whose document this page cannot reach (cross-origin). Match the control by visible text instead.');
            }
            throw new Error('The selector crosses a shadow host with no open shadow root: ' + String(el.tagName || '').toLowerCase());
          }
        }
      }
      return el;
    };

    // Would a real mouse actually land on this element? A control inside a
    // modal that is covered by a mask still reports a non-zero rect, so
    // visibility alone says "clickable" when the click would hit the overlay.
    const __hamunaHitTest = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      // The hit-test surface belongs to the document the element lives in. An
      // element inside a frame is positioned relative to the frame viewport,
      // so the top document would answer with whatever sits at those numbers
      // over there — a wrong hit, read as an overlay covering the target.
      const doc = el.ownerDocument || document;
      const win = __hamunaOwnerWindow(el);
      const x = Math.min(Math.max(r.left + r.width / 2, 0), Math.max(win.innerWidth - 1, 0));
      const y = Math.min(Math.max(r.top + r.height / 2, 0), Math.max(win.innerHeight - 1, 0));
      let top = null;
      try { top = doc.elementFromPoint(x, y); } catch (e) { return true; }
      if (!top) return false;
      // `elementFromPoint` never descends into a shadow root — it answers with
      // the host — so walk our own host chain and accept the moment the two
      // meet. Both directions matter:
      //   - the point landed on the element itself, or on one of its own
      //     children (`node.contains(top)`) — a real hit that bubbles up;
      //   - the point landed on a shadow host we live inside.
      // Deliberately NOT accepted: `top.contains(node)`. That means top is an
      // ancestor of us and the point is on a *sibling* — the element is
      // covered, which is exactly the dead-overlay case this check exists to
      // catch.
      let node = el;
      let guard = 0;
      while (node && guard < 12) {
        guard += 1;
        if (node === top) return true;
        if (node.contains && node.contains(top)) return true;
        const root = node.getRootNode ? node.getRootNode() : document;
        if (!root || root === document || !root.host) break;
        node = root.host;
      }
      return false;
    };

    // Rank a candidate for a text query. The job is to pick the button, not
    // the toolbar that happens to contain the word.
    const __hamunaScore = (el, needle) => {
      const label = __hamunaLabel(el).toLowerCase();
      if (!label) return 0;
      let score = 0;
      if (label === needle) score += 1000;
      else if (label.indexOf(needle) !== -1) score += 400;
      else return 0;
      const tag = String(el.tagName || '').toLowerCase();
      const role = String(__hamunaAttr(el, 'role') || '').toLowerCase();
      if (tag === 'button' || tag === 'a') score += 120;
      else if (role === 'button' || role === 'link' || role === 'tab') score += 100;
      else if (tag === 'input' || tag === 'textarea' || tag === 'select') score += 80;
      // A container that merely CONTAINS the text must lose to a leaf that
      // carries it. Without this the toolbar wrapper — whose innerText is all
      // of the editor chrome — outranks the actual 发布 button.
      score += Math.max(0, 60 - label.length);
      if (el.disabled === true || __hamunaAttr(el, 'aria-disabled') === 'true') score -= 600;
      if (__hamunaAttr(el, 'aria-hidden') === 'true') score -= 600;
      try {
        if (__hamunaOwnerWindow(el).getComputedStyle(el).pointerEvents === 'none') score -= 300;
      } catch (e) { /* ignore */ }
      return score;
    };

    const __hamunaFieldAttrs = (el) => [
      __hamunaAttr(el, 'placeholder'),
      __hamunaAttr(el, 'aria-label'),
      __hamunaAttr(el, 'data-placeholder'),
      __hamunaAttr(el, 'name'),
      __hamunaAttr(el, 'title'),
    ].filter(Boolean).join(' ').toLowerCase();

    const __hamunaLocateDetailed = (selector, text) => {
      if (selector) {
        const el = __hamunaFindBySelector(selector);
        if (!el) throw new Error('No element matches CSS selector: ' + selector);
        return { el, label: __hamunaLabel(el), matches: [] };
      }
      if (!text) throw new Error('Either a CSS selector or a text query is required');

      const needle = String(text).trim().toLowerCase();
      const roots = __hamunaRoots();
      const pool = (sel) => {
        const out = [];
        for (const root of roots) {
          let found;
          try { found = root.querySelectorAll(sel); } catch (e) { continue; }
          for (const el of found) out.push(el);
        }
        return out;
      };

      const visible = pool(__hamunaInteractiveSel).filter(__hamunaVisible);
      const scored = [];
      for (const el of visible) {
        const score = __hamunaScore(el, needle);
        if (score > 0) scored.push({ el, score });
      }
      if (scored.length) {
        // Sort before hit-testing: elementFromPoint forces layout, so only the
        // leading group is worth paying for.
        scored.sort((a, b) => b.score - a.score);
        const lead = scored.slice(0, 8);
        for (const m of lead) {
          if (!__hamunaHitTest(m.el)) m.score -= 400;
        }
        lead.sort((a, b) => b.score - a.score);
        return {
          el: lead[0].el,
          label: __hamunaLabel(lead[0].el),
          matches: lead.slice(0, 5).map((m) => ({
            tag: String(m.el.tagName || '').toLowerCase(),
            label: __hamunaLabel(m.el),
            selector: __hamunaCssPathDeep(m.el) || undefined,
            score: m.score,
          })),
        };
      }

      // Second pass: a form field identified by its placeholder / aria-label.
      // The label pass cannot see it — the "text" of a textbox is its value, and
      // an empty textbox has no text at all. Without this pass there is no way
      // to say "the 作品描述 box" and no way to publish anything.
      const fields = pool('input,textarea,select,[contenteditable]').filter(__hamunaVisible);
      const byField = fields.find((el) => __hamunaFieldAttrs(el).indexOf(needle) !== -1);
      if (byField) return { el: byField, label: __hamunaLabel(byField), matches: [] };

      const cands = visible.map((el) => __hamunaLabel(el)).filter(Boolean);
      throw new Error('No visible element matches text: ' + text + '. Candidates: ' + (cands.slice(0, 20).join(' | ') || '(none)'));
    };

    window.__hamunaLocate = (selector, text) => __hamunaLocateDetailed(selector, text).el;
    window.__hamunaLocateDetailed = __hamunaLocateDetailed;
    window.__hamunaRoots = __hamunaRoots;
    window.__hamunaCssPathDeep = __hamunaCssPathDeep;
    window.__hamunaVisible = __hamunaVisible;
    window.__hamunaLabel = __hamunaLabel;
    window.__hamunaOwnerWindow = __hamunaOwnerWindow;
    window.__hamunaFileInputCount = __hamunaFileInputCount;
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

/// List the page's visible form fields and buttons, each with a CSS selector
/// that resolves to exactly that element.
///
/// WHY THIS EXISTS
/// ---------------
/// The agent can only act on a page through `click --selector` / `fill
/// --selector`, and it cannot invent a selector for a page it has never seen.
/// Text lookup finds buttons — but a textbox has no text to find: its "text"
/// is its value, and an empty textbox has none. So there was no way to say
/// "the 作品描述 box", and every publish flow stalled exactly there.
///
/// This is the discovery primitive: read the fields, pick one by placeholder
/// or label, then act with the returned selector. It is what keeps a
/// publish skill free of hardcoded selectors — the DOM differs per platform
/// and changes without notice, so guessing is guaranteed to rot.
///
/// Only visible elements are listed: an invisible input is one the agent
/// cannot act on, and a page with hundreds of hidden inputs (every framework
/// ships some) would drown the useful ones.
pub fn fields_script() -> String {
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const sel = 'input,textarea,select,[contenteditable],button,a,[role=button],[role=tab]';
  const attr = (el, name) => el.getAttribute(name) || undefined;
  const fields = [];
  // Walk the deep tree, for the same reason `locate` does: a control inside a
  // shadow root is invisible to `document.querySelectorAll`, and a selector
  // handed back from here has to be one `click --selector` can resolve.
  for (const root of window.__hamunaRoots()) {{
    let found;
    try {{ found = root.querySelectorAll(sel); }} catch (e) {{ continue; }}
    for (const el of found) {{
      if (fields.length >= 150) break;
      if (!window.__hamunaVisible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
      const selector = window.__hamunaCssPathDeep(el);
      // A control inside a same-origin frame does have a selector now: the
      // frame element, then the selector inside the frame, joined by the
      // boundary marker. Only a node that cannot be addressed at all (a
      // detached one) has none, and listing it with a selector that resolves
      // somewhere else would send the agent to the wrong control — worse
      // than not listing it.
      if (!selector) continue;
      fields.push({{
        kind: editable ? 'field' : (tag === 'a' ? 'link' : 'button'),
        tag,
        type: attr(el, 'type'),
        placeholder: attr(el, 'placeholder') || attr(el, 'data-placeholder'),
        ariaLabel: attr(el, 'aria-label'),
        name: attr(el, 'name'),
        accept: attr(el, 'accept'),
        text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        selector,
      }});
    }}
  }}
  return {{ count: fields.length, fields }};
}})()"
    )
}

/// List the page's images with a stable index, src, dimensions and alt text.
///
/// WHY THIS EXISTS
/// ---------------
/// The agent needs to *see* a captcha before it can read it, and the only
/// reliable way to get those pixels is in-page: a captcha image URL usually
/// resolves to a different image per cookie, so downloading it from the
/// sidecar would return a picture that does not match what the user sees.
/// The returned `src` is an index into this list, not a URL — see
/// `image_data_script` for how the agent turns it back into bytes.
///
/// `visible` filters out tracking pixels and `display:none` assets that would
/// otherwise waste the agent's attention. Only same-document images are
/// listed; iframes are skipped because `contentDocument` is cross-origin on
/// most login pages, and a cross-origin canvas read would fail anyway.
pub fn document_images_script() -> String {
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const imgs = Array.from(document.images || []);
  const out = [];
  imgs.forEach((img, index) => {{
    const r = img.getBoundingClientRect();
    const st = window.getComputedStyle(img);
    const visible = r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    if (!visible) return;
    out.push({{
      index,
      src: img.currentSrc || img.src || '',
      alt: (img.alt || '').slice(0, 200),
      width: Math.round(r.width),
      height: Math.round(r.height),
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0
    }});
  }});
  return {{ count: out.length, images: out }};
}})()"
    )
}

/// Read one image's pixels into a data URL, by the index `document_images_script`
/// returned. `max_edge` downscales very large images before encoding so the
/// payload stays inside the eval transport — a captcha is tens of pixels, but
/// a hero banner is thousands.
///
/// WHY CANVAS AND NOT `fetch`
/// --------------------------
/// `wrap_eval_script` evaluates a SYNCHRONOUS expression; a returned Promise
/// stringifies to `{}`. Canvas drawing plus `toDataURL` is synchronous, so it
/// fits the existing transport with no change to the shared wrapper. The
/// image must be same-origin (or CORS-enabled) or the canvas is tainted and
/// `toDataURL` throws — that is the correct outcome here: a cross-origin
/// image cannot be trusted to be the captcha anyway.
pub fn image_data_script(index: u32, max_edge: u32) -> String {
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const img = Array.from(document.images || [])[{index}];
  if (!img) throw new Error('No image at that index — call `hamuna browser images` again for the current list');
  if (!img.complete) throw new Error('Image has not finished loading yet');
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) throw new Error('Image has no pixel data (broken or blocked src)');
  const scale = Math.min(1, {max_edge} / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas context');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let url;
  try {{
    url = canvas.toDataURL('image/png');
  }} catch (e) {{
    throw new Error('Image is cross-origin and cannot be read (canvas tainted). Ask the user to look at it instead.');
  }}
  return {{
    dataUrl: url,
    mime: 'image/png',
    width: canvas.width,
    height: canvas.height,
    originalWidth: w,
    originalHeight: h,
    alt: (img.alt || '').slice(0, 200),
    src: (img.currentSrc || img.src || '').slice(0, 500)
  }};
}})()"
    )
}

/// Click an element located by CSS selector or visible text.
///
/// Returns what was clicked PLUS the runner-up candidates, so that a text
/// query matching several controls is visible to the agent instead of being
/// silently resolved to whichever one happened to come first.
///
/// WHY THE EVENT SEQUENCE
/// ----------------------
/// `el.click()` alone fires only `click`. Component libraries built on
/// pointer events — Ant Design, and the byte-dance creator backend in
/// particular — never enter their pressed state and never run the handler,
/// so the call "succeeds" while the page does nothing. The sequence below is
/// the one a real mouse produces: `pointerdown` → `mousedown` → `pointerup` →
/// `mouseup` → `click`, all `composed: true` so they cross shadow boundaries.
/// `el.click()` is used for the final step rather than a synthetic MouseEvent
/// because only it also runs the element's default action.
///
/// Form submits are NOT performed here — a separate `submit` script exists so
/// the CLI can gate that action behind approval.
pub fn click_script(selector: &str, text: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const hit = window.__hamunaLocateDetailed({sel}, {txt});
  const el = hit.el;
  const tag = el.tagName.toLowerCase();
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  // The realm the element lives in, not the top one: a control inside a
  // frame must be clicked with events built by that frame, or page code that
  // checks the event against its own constructor sees a stranger. The
  // coordinates stay in the frame viewport, which is the space the frame
  // event reports.
  const view = window.__hamunaOwnerWindow(el);
  const fire = (type, Ctor, buttons) => {{
    let ev;
    try {{
      ev = new Ctor(type, {{ bubbles: true, cancelable: true, composed: true, view: view, clientX: x, clientY: y, button: 0, buttons }});
    }} catch (e) {{
      ev = new view.MouseEvent(type, {{ bubbles: true, cancelable: true, composed: true, view: view, clientX: x, clientY: y, button: 0 }});
    }}
    el.dispatchEvent(ev);
  }};
  const P = view.PointerEvent || view.MouseEvent;
  fire('pointerdown', P, 1);
  fire('mousedown', view.MouseEvent, 1);
  if (typeof el.focus === 'function') {{ try {{ el.focus(); }} catch (e) {{}} }}
  fire('pointerup', P, 0);
  fire('mouseup', view.MouseEvent, 0);
  el.click();
  return {{
    tag,
    label: hit.label,
    id: el.id || undefined,
    selector: window.__hamunaCssPathDeep(el) || undefined,
    matches: hit.matches,
  }};
}})()"
    )
}

/// Cheap fingerprint of "what the agent could act on right now".
///
/// Used to answer the question the click response could not: **did anything
/// actually happen?** Without it the agent gets `clicked` for a click that hit
/// a dead overlay and has no way to tell that from a click that worked, so it
/// keeps clicking — which is how "点发布" turned into eight page reloads.
///
/// Only visible interactive elements are counted: a change confined to a
/// hidden DOM fragment (analytics beacons, preloaded menus) is not an effect
/// the user would see, and counting it would report success for a no-op.
pub fn page_snapshot_script() -> String {
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const roots = window.__hamunaRoots();
  let count = 0;
  let digest = 0;
  for (const root of roots) {{
    let found;
    try {{ found = root.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=tab],[contenteditable],[onclick]'); }} catch (e) {{ continue; }}
    for (const el of found) {{
      if (!window.__hamunaVisible(el)) continue;
      count += 1;
      const label = window.__hamunaLabel(el);
      // djb2 — cheap, stable, and only needs to notice that something moved.
      for (let i = 0; i < label.length; i += 1) {{
        digest = ((digest * 33) ^ label.charCodeAt(i)) | 0;
      }}
      digest = ((digest * 33) ^ 31) | 0;
    }}
  }}
  return {{ url: location.href, title: document.title || '', count, digest }};
}})()"
    )
}

/// Fill an input / textarea / contenteditable element.
///
/// Dispatches `input` and `change` events so frameworks with controlled
/// components (React, Vue) actually register the new value — setting
/// `.value` alone is silently ignored by many of them.
///
/// **A contenteditable has no `value`.** Writing `el.value = …` on a div
/// creates a stray JS property and the page shows nothing — which looks like
/// "the fill silently did nothing". The text of a contenteditable lives in
/// `textContent`, so that is what gets written.
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
  // The realm the element lives in: a control inside a frame has its value
  // setter and its Event constructor in that frame, not in the top one.
  const view = window.__hamunaOwnerWindow(el);
  if (tag === 'input' || tag === 'textarea') {{
    const proto = tag === 'input' ? view.HTMLInputElement.prototype
      : view.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, {val}); else el.value = {val};
  }} else {{
    el.textContent = {val};
  }}
  el.dispatchEvent(new view.Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new view.Event('change', {{ bubbles: true }}));
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
/// **The new file is APPENDED, not substituted.** `input.files = dt.files`
/// replaces the whole `FileList`, so a fresh `DataTransfer` would drop every
/// image uploaded before this call — and a multi-image publish (Douyin 图文
/// wants up to 12) would silently end up with one. So the existing files are
/// copied into the new `DataTransfer` first.
///
/// Returns `{ selector, name, size, inputCount }` — `inputCount` > 1 means the
/// page has several file inputs and only the located one was touched.
///
/// `mime` comes from the caller (derived from the real file extension), NOT
/// from `input.accept`: `accept` is frequently written as `.png,.jpg` or left
/// empty, and copying that verbatim into `File.type` hands the site an
/// extension where it expects a MIME type — some uploaders reject that.
pub fn upload_script(
    selector: &str,
    text: &str,
    file_name: &str,
    mime: &str,
    base64: &str,
) -> String {
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
  // The realm the input lives in: a file input inside a frame needs its File
  // and DataTransfer built there, or the page never sees the selection.
  const view = window.__hamunaOwnerWindow(input);
  const file = new view.File([bytes], {name}, {{ type: {mime} }});

  const dt = new view.DataTransfer();
  // Append: keep the files that were already in the input. A fresh
  // DataTransfer would replace the FileList and drop earlier images.
  if (input.files) Array.from(input.files).forEach((f) => dt.items.add(f));
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new view.Event('input', {{ bubbles: true }}));
  input.dispatchEvent(new view.Event('change', {{ bubbles: true }}));

  return {{
    selector: {sel} || {txt},
    name: file.name,
    size: file.size,
    inputCount: window.__hamunaFileInputCount()
  }};
}})()"
    )
}

/// Open a chunked upload: find the file input and reset the accumulator.
///
/// WHY A SECOND PATH
/// -----------------
/// [`upload_script`] puts the whole file into one JS string literal. That is
/// fine for stills (≤ 12 MiB) and impossible for video: a one-minute clip is
/// 50–200 MB, and one eval carrying that would blow the IPC payload and the
/// webview heap long before the page ever saw it.
///
/// Chunking keeps every eval at the scale the inline path already proves
/// works, and the bytes never leave the machine: the page assembles a `File`
/// from the chunks exactly like the inline path builds one from a single
/// base64 blob.
///
/// The accumulator lives on `window` so the chunks can arrive in separate
/// evals. A navigation wipes it — that is what [`upload_chunk_script`]'s
/// "session was not opened" error is for.
pub fn upload_begin_script(selector: &str, text: &str, file_name: &str, mime: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    let name = js_string(file_name);
    let mime = js_string(mime);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const el = window.__hamunaLocate({sel}, {txt});
  const tag = el.tagName.toLowerCase();
  const input = tag === 'input' && el.type === 'file'
    ? el
    : el.querySelector && el.querySelector('input[type=file]');
  if (!input) throw new Error('Target is not a file input and contains none (tag=' + tag + ')');
  window.__hamunaUpload = {{ chunks: [], name: {name}, mime: {mime} }};
  return {{ selector: {sel} || {txt}, chunks: 0 }};
}})()"
    )
}

/// Append one base64 chunk to the accumulator.
///
/// The chunk is decoded to bytes **immediately**: keeping the base64 string
/// around would make the page hold the file twice (base64 is 4/3 the size of
/// the bytes, and the bytes are what the `File` ends up holding).
pub fn upload_chunk_script(base64: &str) -> String {
    let b64 = js_string(base64);
    format!(
        "(() => {{
  const st = window.__hamunaUpload;
  if (!st) throw new Error('Upload session was not opened (the page navigated?)');
  const bin = atob({b64});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  st.chunks.push(bytes);
  let size = 0;
  for (const c of st.chunks) size += c.length;
  return {{ chunks: st.chunks.length, size }};
}})()"
    )
}

/// Assemble the chunks into one `File` and attach it to the input.
///
/// Same contract as [`upload_script`]: the new file is **appended** to the
/// existing `FileList`, and `input` / `change` are dispatched so the page's
/// own uploader notices.
pub fn upload_finalize_script(selector: &str, text: &str) -> String {
    let sel = js_string(selector);
    let txt = js_string(text);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const st = window.__hamunaUpload;
  if (!st) throw new Error('Upload session was not opened (the page navigated?)');
  const el = window.__hamunaLocate({sel}, {txt});
  const tag = el.tagName.toLowerCase();
  const input = tag === 'input' && el.type === 'file'
    ? el
    : el.querySelector && el.querySelector('input[type=file]');
  if (!input) throw new Error('Target is not a file input and contains none (tag=' + tag + ')');

  let total = 0;
  for (const c of st.chunks) total += c.length;
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of st.chunks) {{ all.set(c, off); off += c.length; }}
  // The realm the input lives in, same reason as the inline upload path.
  const view = window.__hamunaOwnerWindow(input);
  const file = new view.File([all], st.name, {{ type: st.mime }});
  // 分片已经拼进 file 了，累加器留着只是白占一份内存。
  window.__hamunaUpload = null;

  const dt = new view.DataTransfer();
  if (input.files) Array.from(input.files).forEach((f) => dt.items.add(f));
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new view.Event('input', {{ bubbles: true }}));
  input.dispatchEvent(new view.Event('change', {{ bubbles: true }}));

  return {{
    selector: {sel} || {txt},
    name: file.name,
    size: file.size,
    inputCount: window.__hamunaFileInputCount()
  }};
}})()"
    )
}

/// Fill a username/password pair and submit the login form.
///
/// WHY THIS IS ONE SCRIPT AND NOT `fill` + `fill` + `submit`
/// --------------------------------------------------------
/// Splitting it lets the password land in two extra places: the CLI's Bash
/// command string (history, logs) and the agent's own tool-call records. As a
/// single script the password only ever exists in this one eval payload, which
/// is never logged.
///
/// FIELD DETECTION is deliberately heuristic and ordered, because login forms
/// are not standardised:
///   - password: the first visible `input[type=password]`
///   - username: the first visible `input[type=email|tel]`, else an input whose
///     `name`/`id`/`autocomplete` looks like a user field, else the first
///     visible text input preceding the password field in DOM order.
///
/// Returns the discovered metadata so the caller can report what it filled
/// WITHOUT echoing the values. `captcha` tells the agent a challenge exists and
/// it must read the image before submitting, so it can stop here instead of
/// bouncing off a failed submit.
pub fn login_script(user: &str, password: &str) -> String {
    let u = js_string(user);
    let p = js_string(password);
    format!(
        "{INSTALL_HELPERS} && (() => {{
  const visible = (el) => {{
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.__hamunaOwnerWindow(el).getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  }};
  const setValue = (el, value) => {{
    const view = window.__hamunaOwnerWindow(el);
    const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new view.Event('input', {{ bubbles: true }}));
    el.dispatchEvent(new view.Event('change', {{ bubbles: true }}));
  }};
  // A login form inside a same-origin frame is a real thing (an embedded
  // account form on some creator backends). Collect the inputs from every
  // tree the page hides one in, not just from the top document.
  const all = [];
  for (const root of window.__hamunaRoots()) {{
    let found;
    try {{ found = root.querySelectorAll('input, textarea'); }} catch (e) {{ continue; }}
    for (const el of found) all.push(el);
  }};
  const passwordEl = all.find((el) => visible(el) && el.type === 'password');
  if (!passwordEl) throw new Error('No visible password field found on this page. Navigate to the login page first.');

  const USER_HINT = /user|email|phone|mobile|account|login|identifier/i;
  const described = (el) => ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '') + ' ' + (el.placeholder || ''));
  const candidates = all.filter((el) => visible(el) && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'email' || el.type === 'tel'));
  const usernameEl =
    candidates.find((el) => el.type === 'email' || el.type === 'tel')
    || candidates.find((el) => USER_HINT.test(described(el)))
    || candidates.find((el) => all.indexOf(el) < all.indexOf(passwordEl));

  if (!usernameEl) throw new Error('No visible username field found — this may be a passwordless or phone-code login.');
  setValue(usernameEl, {u});
  setValue(passwordEl, {p});

  // Captcha detection: a visible image whose alt/src/class/id says captcha, or
  // a visible input named like one. Reported, not solved — the caller decides.
  const CAPTCHA_HINT = /captcha|verify|vcode|checkcode|验证码|認証/i;
  const captchaInput = all.find((el) => visible(el) && CAPTCHA_HINT.test(described(el)));
  const images = [];
  for (const root of window.__hamunaRoots()) {{
    let found;
    try {{ found = root.querySelectorAll('img'); }} catch (e) {{ continue; }}
    for (const el of found) images.push(el);
  }}
  const captchaImage = images.find((img) => visible(img) && CAPTCHA_HINT.test((img.alt || '') + ' ' + (img.id || '') + ' ' + (img.className || '') + ' ' + (img.src || '')));

  return {{
    usernameFilled: {{ tag: usernameEl.tagName.toLowerCase(), type: usernameEl.type || 'text' }},
    passwordFilled: true,
    captcha: Boolean(captchaInput || captchaImage),
    captchaKind: captchaInput && captchaImage ? 'image+input' : captchaImage ? 'image' : captchaInput ? 'input' : 'none'
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

// ──────────────────────────────────────────────────────────
// Search-engine scripts
// ──────────────────────────────────────────────────────────

/// Installs the search-box finder on `window` exactly once.
///
/// The finder is shared by the three search scripts (probe → type → submit),
/// so the engine's search box is located the same way in all of them: the
/// engine's own selectors first, then the generic shapes the engines share.
///
/// It lives on `window` so one script can install it and the next reuse it —
/// but every script installs it first anyway, because a navigation wipes
/// `window` and the next agent command must work on a freshly loaded page.
const INSTALL_SEARCH_HELPER: &str = r#"
(() => {
  if (!window.__hamunaFindSearchInput) {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = window.getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    };
    window.__hamunaFindSearchInput = (selectors) => {
      let fallback = null;
      for (const sel of selectors) {
        let hits = [];
        try { hits = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
        if (!hits.length) continue;
        const shown = hits.filter(visible)[0];
        if (shown) return shown;
        // A hidden box (the engine collapses it in a narrow panel) is still
        // typeable: the events land on it and its form still submits.
        if (!fallback) fallback = hits[0];
      }
      return fallback;
    };
  }
  return true;
})()
"#;

/// Probe: is the engine's search box in the DOM yet?
///
/// The homepage's own scripts render the box, and they are not done when
/// `readyState` says "complete" — so the box itself is what gets waited for.
pub fn search_box_script(input_selectors: &[&str]) -> String {
    let sels = js_string_array(input_selectors);
    format!(
        "{INSTALL_SEARCH_HELPER} && (() => {{
  const el = window.__hamunaFindSearchInput({sels});
  return {{
    found: !!el,
    id: el ? (el.id || undefined) : undefined,
    tag: el ? el.tagName.toLowerCase() : undefined
  }};
}})()"
    )
}

/// Type a query into the engine's search box and press Enter.
///
/// WHY A TYPED QUERY AND NOT A URL
/// ------------------------------
/// Hitting `…/search?q=…` directly is a *cold* request: no referrer, no warm
/// session, and a shape no human browser produces. Search engines answer that
/// with a challenge page, a 429, or an empty result list — it is what their
/// anti-bot measures a scraper by. Typing the query into the homepage's
/// search box is what a person does, and it is what the engine sees as one.
///
/// The value is written through the native setter (like `fill_script`) so a
/// framework-controlled box registers it, and the `input` / `change` events
/// are dispatched for the same reason.
///
/// Enter is dispatched as a real `KeyboardEvent` — `keyCode` included,
/// because that is what the engines' own handlers read. Submitting stays a
/// separate script so the caller can check whether the key was enough
/// before forcing a form submit.
pub fn search_type_script(query: &str, input_selectors: &[&str]) -> String {
    let sels = js_string_array(input_selectors);
    let q = js_string(query);
    format!(
        "{INSTALL_SEARCH_HELPER} && (() => {{
  const el = window.__hamunaFindSearchInput({sels});
  if (!el) throw new Error('The search engine page has no search box');
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {{
    const proto = tag === 'input' ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, {q}); else el.value = {q};
  }} else {{
    el.textContent = {q};
  }}
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  try {{ el.focus(); }} catch (e) {{ /* focusing is a nicety, not a requirement */ }}
  for (const type of ['keydown', 'keypress', 'keyup']) {{
    el.dispatchEvent(new KeyboardEvent(type, {{
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13,
      bubbles: true, cancelable: true
    }}));
  }}
  return {{ id: el.id || undefined, tag }};
}})()"
    )
}

/// Submit the search form — the fallback for engines that ignore the Enter
/// key (or a page that swallowed it).
///
/// The form is the engine's own, so the request it sends is the request the
/// engine expects: same fields, same action, same referrer.
pub fn search_submit_script(input_selectors: &[&str]) -> String {
    let sels = js_string_array(input_selectors);
    format!(
        "{INSTALL_SEARCH_HELPER} && (() => {{
  const el = window.__hamunaFindSearchInput({sels});
  if (!el) throw new Error('The search engine page has no search box');
  const form = el.form || (el.closest ? el.closest('form') : null);
  if (form) {{
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return {{ submitted: 'form' }};
  }}
  // No form to submit: the search button on the page is the only way left.
  const button = document.querySelector('#sb_form_go, button[type=submit], input[type=submit]');
  if (!button) throw new Error('The search box is not in a form and the page has no search button');
  button.click();
  return {{ submitted: 'button' }};
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
  // Bing wraps every result in a click-tracking redirect
  // (`bing.com/ck/a?...&u=a1<base64url>`); the real destination rides in
  // `u`. Handing the agent the tracking URL would give it a link it cannot
  // follow — the redirect only resolves inside a browser session.
  const real = (url) => {
    if (!/^https?:\/\//.test(url || '')) return url;
    const m = url.match(/[?&]u=a1([A-Za-z0-9_\-%.]+)/);
    if (!m) return url;
    try {
      let raw = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
      while (raw.length % 4) raw += '=';
      const bin = atob(raw);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return /^https?:\/\//.test(decoded) ? decoded : url;
    } catch (e) {
      return url;
    }
  };
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
      found.push({ title: title.slice(0, 300), url: real(url).slice(0, 1000), snippet: snippet.slice(0, 600) });
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

// ──────────────────────────────────────────────────────────
// Scroll
// ──────────────────────────────────────────────────────────

/// JS body of the scroll action.
///
/// The four placeholders are substituted instead of interpolated through
/// `format!`: the script is long and every literal brace in it would have to
/// be escaped — that escape noise is exactly where a script bug hides.
///
/// **Prose in this body must avoid apostrophes and backticks.** The CI guard
/// that checks "is this one expression" scans the raw script text and treats
/// every `'` and `` ` `` as a string delimiter without understanding comments
/// or regex literals. An apostrophe in a comment ("the page's own scroller")
/// opens a phantom literal that runs to the next quote in the file, and the
/// guard then rejects a perfectly good script while pointing at the wrong
/// line. Upgrade path: teach that guard about comments and regex literals,
/// then this restriction can go away.
const SCROLL_SCRIPT_BODY: &str = r#"
(() => {
  const delta = __DELTA__;
  const mode = __MODE__;
  const sel = __SEL__;
  const txt = __TXT__;

  const canScroll = (el) => !!el && (el.scrollHeight - el.clientHeight) > 1;
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.__hamunaOwnerWindow(el).getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const visibleArea = (el) => {
    const r = el.getBoundingClientRect();
    // The viewport the element is positioned in: inside a frame that is the
    // frame viewport, and comparing against the top one would score the
    // element as fully visible (or fully clipped) for the wrong reason.
    const win = window.__hamunaOwnerWindow(el);
    const w = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
    return w * h;
  };
  const describe = (el) => {
    if (!el) return '';
    const doc = el.ownerDocument || document;
    if (el === doc.scrollingElement || el === doc.documentElement || el === doc.body) {
      return 'document';
    }
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return (el.tagName || '?').toLowerCase() + id + cls;
  };
  const scrollerOf = (el) => {
    let node = el.parentElement;
    while (node) {
      if (canScroll(node)) return node;
      node = node.parentElement;
    }
    // The scroller that actually holds the target: inside a frame that is
    // the frame document, not the page around it.
    const doc = el.ownerDocument || document;
    return doc.scrollingElement || doc.documentElement;
  };
  const shape = (scroller, offset, moved, m, target) => ({
    mode: m,
    target: target,
    offset: Math.round(offset),
    moved: Math.round(moved),
    scrollHeight: scroller ? scroller.scrollHeight : 0,
    clientHeight: scroller ? scroller.clientHeight : 0,
    atTop: scroller ? offset <= 1 : true,
    atBottom: scroller ? offset >= scroller.scrollHeight - scroller.clientHeight - 1 : true,
    scrollable: !!scroller
  });

  // An explicit target: bring that element into view.
  if (sel || txt) {
    const el = window.__hamunaLocate(sel, txt);
    const scroller = scrollerOf(el);
    const before = scroller ? scroller.scrollTop : 0;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const after = scroller ? scroller.scrollTop : 0;
    const out = shape(scroller, after, after - before, 'element', window.__hamunaLabel(el));
    out.rectTop = Math.round(el.getBoundingClientRect().top);
    return out;
  }

  // No target: find the container that actually scrolls. A modern SPA
  // (抖音 / 小红书 creator backends) scrolls an inner box, not the
  // document — scrolling the document there moves nothing at all. The same
  // holds for a page whose content lives inside a frame: the scroller is in
  // the frame document, and the page around it does not move.
  const roots = window.__hamunaRoots();
  let scroller = null;
  for (const root of roots) {
    const rdoc = root.scrollingElement || root.documentElement;
    if (rdoc && canScroll(rdoc)) { scroller = rdoc; break; }
  }
  if (!scroller) {
    let best = null;
    let bestArea = 0;
    for (const root of roots) {
      let all;
      try { all = root.querySelectorAll('*'); } catch (e) { continue; }
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (!canScroll(el) || !isVisible(el)) continue;
        const a = visibleArea(el);
        if (a > bestArea) {
          bestArea = a;
          best = el;
        }
        // A box that fills the viewport is the scroller of the page itself —
        // no need to keep scanning the rest of the tree.
        const win = window.__hamunaOwnerWindow(el);
        if (bestArea >= Math.max(1, win.innerWidth * win.innerHeight) * 0.9) break;
      }
    }
    scroller = best;
  }
  if (!scroller) {
    return shape(null, 0, 0, mode, '');
  }

  const before = scroller.scrollTop;
  let wanted = before;
  if (mode === 'top') wanted = 0;
  else if (mode === 'bottom') wanted = scroller.scrollHeight;
  else wanted = before + delta;
  // The instant behavior option overrides the CSS scroll-behavior property.
  // A page that turns on smooth scrolling would otherwise animate the scroll
  // and the offset read back right after would still be the old one.
  scroller.scrollTo({ top: wanted, behavior: 'instant' });
  const after = scroller.scrollTop;
  return shape(scroller, after, after - before, mode, describe(scroller));
})()
"#;

/// Scroll the page, a scrollable container inside it, or an element into view.
///
/// `delta` is a pixel offset (positive scrolls down). `to` jumps to an edge
/// ("top" / "bottom"). A `selector` / `text` target scrolls that element into
/// view instead of moving by an offset.
///
/// **Why the scrolling container is discovered instead of assumed**: a modern
/// SPA scrolls an inner `<div>`, not the document. `window.scrollBy` on such a
/// page moves nothing and the agent sees a successful call that changed
/// nothing. So the script picks the document's scrolling element when it can
/// scroll, and otherwise the largest visible element that actually can.
pub fn scroll_script(delta: i64, to: &str, selector: &str, text: &str) -> String {
    let mode = match to {
        "top" => "\"top\"",
        "bottom" => "\"bottom\"",
        _ => "\"delta\"",
    };
    let body = SCROLL_SCRIPT_BODY
        .replace("__DELTA__", &delta.to_string())
        .replace("__MODE__", mode)
        .replace("__SEL__", &js_string(selector))
        .replace("__TXT__", &js_string(text));
    format!("{INSTALL_HELPERS} && {body}")
}

/// Escape a Rust string as a JS string literal.
fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Escape a list of strings as a JS array literal.
fn js_string_array(values: &[&str]) -> String {
    let items: Vec<String> = values.iter().map(|v| js_string(v)).collect();
    format!("[{}]", items.join(", "))
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

    /// A contenteditable has no `value` — writing one creates a stray JS
    /// property and the page shows nothing, which reads as "the fill silently
    /// did nothing". The text of a contenteditable lives in `textContent`.
    #[test]
    fn fill_script_writes_text_content_for_contenteditable() {
        let script = fill_script("", "作品描述", "hello");
        assert!(script.contains("el.textContent ="), "{script}");
        // The input / textarea path must keep using the native value setter —
        // React-controlled inputs ignore a plain `el.value =`.
        assert!(script.contains("setter.set.call(el"), "{script}");
    }

    /// The agent can only act on a page through a selector, and it cannot
    /// invent one. `fields` is the discovery primitive; it must hand back a
    /// selector that resolves to each element.
    #[test]
    fn fields_script_returns_a_selector_per_field() {
        let script = fields_script();
        assert!(script.contains("__hamunaCssPath"), "{script}");
        assert!(script.contains("fields"), "{script}");
        // A publish form's file input is the one thing the agent MUST find.
        assert!(script.contains("input"), "{script}");
    }

    /// The typed query is interpolated into a JS string literal, so a query
    /// that contains a quote must not be able to terminate the literal and
    /// run code of its own in the page.
    #[test]
    fn the_typed_query_cannot_break_out_of_the_js_literal() {
        let script = search_type_script("a\"; alert(1); //", &["#sb_form_q"]);
        // The raw payload must not appear: it would close the literal and
        // turn the rest of the query into code.
        assert!(!script.contains("a\"; alert(1); //"), "{script}");
        assert!(script.contains(r#"a\"; alert(1); //"#), "{script}");
    }

    /// The three search scripts must find the box the same way, or the
    /// probe would report "no search box" for a box the typing script can
    /// actually type into.
    #[test]
    fn every_search_script_uses_the_shared_box_finder() {
        let selectors = ["#sb_form_q", "input[name=q]"];
        for script in [
            search_box_script(&selectors),
            search_type_script("q", &selectors),
            search_submit_script(&selectors),
        ] {
            assert!(script.contains("__hamunaFindSearchInput"), "{script}");
            assert!(script.contains("#sb_form_q"), "{script}");
        }
    }

    /// The Enter key has to be a real key event: the engines' own handlers
    /// read `keyCode`, not just `key`.
    #[test]
    fn the_typed_search_presses_enter() {
        let script = search_type_script("q", &["#sb_form_q"]);
        assert!(script.contains("KeyboardEvent"), "{script}");
        assert!(script.contains("keyCode: 13"), "{script}");
    }

    /// Text lookup finds buttons, but a textbox has no text to find — its
    /// "text" is its value, and an empty textbox has none. Without matching
    /// the placeholder / aria-label there is no way to say "the 作品描述 box".
    #[test]
    fn locate_can_find_a_field_by_its_placeholder() {
        assert!(INSTALL_HELPERS.contains("__hamunaFieldAttrs"), "{INSTALL_HELPERS}");
        assert!(INSTALL_HELPERS.contains("data-placeholder"), "{INSTALL_HELPERS}");
    }

    /// A multi-image publish (Douyin 图文 up to 12) uploads one file per call
    /// into the SAME input. `input.files = dt.files` replaces the FileList, so
    /// a fresh DataTransfer would leave only the last image. The script must
    /// carry the previous files over.
    #[test]
    fn upload_script_appends_instead_of_replacing() {
        let script = upload_script(
            "input[type=file]",
            "",
            "cover.png",
            "image/png",
            "iVBORw0KGgo=",
        );
        assert!(
            script.contains("Array.from(input.files)"),
            "upload must carry over the files already in the input:\n{script}"
        );
        assert!(
            script.contains("dt.items.add(file)"),
            "upload must add the new file:\n{script}"
        );
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
            page_snapshot_script(),
            document_html_script(),
            fields_script(),
            click_script("button", ""),
            fill_script("input", "", "hello"),
            upload_script("input[type=file]", "", "a.png", "image/png", "iVBORw0KGgo="),
            submit_script("form", ""),
            search_box_script(&["#sb_form_q"]),
            search_type_script("tauri webview", &["#sb_form_q"]),
            search_submit_script(&["#sb_form_q"]),
            search_results_script(),
            scroll_script(300, "", "", ""),
            scroll_script(0, "bottom", "#feed", ""),
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

    /// The scroll action has to move the container that ACTUALLY scrolls. A
    /// modern SPA (抖音 / 小红书 creator backends) scrolls an inner box, not
    /// the document — scrolling the document there moves nothing while still
    /// reporting success, which is the exact failure the agent cannot see.
    #[test]
    fn scroll_script_finds_the_container_that_can_scroll() {
        let script = scroll_script(300, "", "", "");
        assert!(
            script.contains("scrollHeight - el.clientHeight"),
            "{script}"
        );
        // The document is a candidate, not an assumption: the inner boxes
        // have to be scanned too — and a page whose content lives inside a
        // frame scrolls in the frame document, so every root is a candidate.
        assert!(script.contains("window.__hamunaRoots()"), "{script}");
        assert!(script.contains("scrollingElement"), "{script}");
        assert!(script.contains("querySelectorAll('*')"), "{script}");
    }

    /// A page that sets `scroll-behavior: smooth` animates the scroll, so the
    /// offset read back right afterwards is still the old one and the agent
    /// concludes nothing moved. `behavior: 'instant'` overrides the CSS.
    #[test]
    fn scroll_script_forces_an_instant_scroll() {
        let script = scroll_script(300, "", "", "");
        assert!(script.contains("behavior: 'instant'"), "{script}");
    }

    /// A pixel offset and an edge destination are different things: one moves
    /// by an amount, the other jumps. Mixing them up silently turns
    /// "scroll to the bottom" into "scroll 0 pixels".
    #[test]
    fn scroll_script_keeps_delta_and_destination_apart() {
        assert!(scroll_script(-200, "", "", "").contains("const delta = -200;"));
        assert!(scroll_script(0, "bottom", "", "").contains("const mode = \"bottom\";"));
        assert!(scroll_script(0, "", "", "").contains("const mode = \"delta\";"));
    }

    /// The selector / text target is agent-supplied, so it must not be able to
    /// terminate the JS literal and run code of its own in the page.
    #[test]
    fn scroll_script_embeds_the_target_safely() {
        let script = scroll_script(0, "", "\"; alert(1); //", "");
        assert!(!script.contains("\"); alert(1); //"), "{script}");
        assert!(script.contains("\\\"; alert(1); //"), "{script}");
    }

    /// The chunk payload travels inside a JS string literal, so it must not be
    /// able to terminate the literal and inject code.
    #[test]
    fn upload_chunk_script_embeds_payload_safely() {
        let script = upload_chunk_script("a\"+alert(1)+\"");
        assert!(!script.contains("a\"+alert(1)"), "{script}");
        assert!(script.contains(r#"a\"+alert(1)+\""#), "{script}");
    }

    /// The chunk scripts only work as a sequence: open → chunks → finalize.
    ///
    /// A chunk arriving without an open session (the page navigated between
    /// them) must fail **loudly**. Silently dropping the chunk would produce
    /// a video that is short by exactly the dropped part — and it posts fine.
    #[test]
    fn a_chunk_without_an_open_session_fails_loudly() {
        let chunk = upload_chunk_script("AAAA");
        assert!(chunk.contains("Upload session was not opened"), "{chunk}");
        let finalize = upload_finalize_script("input[type=file]", "");
        assert!(
            finalize.contains("Upload session was not opened"),
            "{finalize}"
        );
    }

    /// The finalize step must APPEND to the existing file list.
    ///
    /// A fresh `DataTransfer` replaces the whole `FileList`, so a
    /// multi-image publish (Douyin 图文 wants up to 12) would silently end up
    /// with only the last file.
    #[test]
    fn upload_finalize_appends_to_the_existing_file_list() {
        let script = upload_finalize_script("input[type=file]", "");
        assert!(script.contains("Array.from(input.files).forEach"), "{script}");
        assert!(script.contains("dt.items.add(file)"), "{script}");
    }

    /// The begin step must open the accumulator **and** find the input.
    ///
    /// Opening on a page with no file input would let every chunk succeed and
    /// the finalize step fail — three round trips wasted before the error.
    #[test]
    fn upload_begin_requires_a_file_input() {
        let script = upload_begin_script("input[type=file]", "", "a.mp4", "video/mp4");
        assert!(script.contains("Target is not a file input"), "{script}");
        assert!(script.contains("window.__hamunaUpload"), "{script}");
    }
}
