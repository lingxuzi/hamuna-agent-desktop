// browser-api.ts — Sidecar-side handlers for the `hamuna browser …` command
// family.
//
// The CLI talks to the Sidecar Admin API (`/api/admin/browser/*`), not to
// Rust directly — the CLI only knows `HAMUNA_PORT`. The Sidecar then calls
// the Rust Management API (`/api/browser/*`), which is the only layer that
// can reach the native child Webview and evaluate scripts in it.
//
// Addressing: every request carries the Chat `sessionId`. The CLI knows it
// from `HAMUNA_SESSION_ID`; the renderer knows it as the Chat's session id.
// The renderer-side tab id stays private to the renderer.

import { managementApi } from '../utils/management-api-client';
import { getSessionEngine } from '../session-engine/selector';
import { recordEmbeddedBrowserOutcome } from '../utils/embedded-browser-quota';
import { htmlToMarkdown } from './html-to-markdown';
import {
  getSocialPlatformPublishProfile,
  isPlatformPublishHost,
  isSocialPlatformId,
} from '../../shared/socialPlatforms';

export interface AdminResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
  code?: string;
  suggestion?: string;
  suggestedCommand?: string;
  recoveryHint?: { recoveryCommand?: string; message?: string };
  [key: string]: unknown;
}

export interface BrowserActionPayload {
  /** Chat session that owns the browser. Empty = "whichever browser is open". */
  sessionId?: string;
  url?: string;
  /** CSS selector for the target element. */
  selector?: string;
  /** Visible text of the target element (used when `selector` is empty). */
  text?: string;
  /** Value for `fill`. */
  value?: string;
  /** Search query for `search`. */
  query?: string;
  /** Search engine for `search` ("bing" | "360" | "baidu"). Defaults to bing. */
  engine?: string;
  /** Absolute path of the file to put into a file input, for `upload`. */
  file?: string;
  /** Target platform id, for `publish` (e.g. `douyin`). */
  platform?: string;
  /** Username for `login`. Never echoed back or logged. */
  username?: string;
  /** Password for `login`. Never echoed back or logged. */
  password?: string;
  /** Image index (from `images`) for `image-data`. */
  index?: number;
  /** Tab index (from `tabs`) for `select`. */
  tab?: number;
  /** Open the URL in a new browser tab instead of the current one. */
  newTab?: boolean;
  /** Scroll offset in pixels for `scroll` (positive scrolls down). */
  delta?: number;
  /** Scroll destination for `scroll`: "top" or "bottom". */
  to?: string;
}

/**
 * The Management API's browser endpoints can take longer than the default
 * loopback timeout: opening the panel waits for the renderer to lay out the
 * split view, and evaluating on a heavy page can take seconds.
 */
const BROWSER_TIMEOUT_MS = 40_000;

/**
 * Which Chat session the browser action belongs to.
 *
 * Priority: the explicitly-passed `--session` wins, then the Sidecar's live
 * session id, then the subprocess env.
 *
 * The live id (from the session-engine facade) is preferred over
 * `process.env.HAMUNA_SESSION_ID` because the env var is snapshotted when the
 * SDK subprocess is spawned — which for a fresh Chat is still the
 * `pending-<tabId>` placeholder. The engine's id is the upgraded, real one
 * that Rust knows the browser by.
 */
function sessionIdFor(payload: BrowserActionPayload): string {
  const explicit = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (explicit) return explicit;

  const live = getSessionEngine().getCurrentSessionContext().sessionId;
  if (live && live.trim()) return live.trim();

  return (process.env.HAMUNA_SESSION_ID ?? '').trim();
}

function mgmtError(resp: Record<string, unknown>, fallback: string): AdminResponse {
  const response: AdminResponse = {
    success: false,
    error: String(resp.error ?? fallback),
  };
  for (const field of ['code', 'suggestion', 'suggestedCommand'] as const) {
    if (typeof resp[field] === 'string' && resp[field]) response[field] = resp[field];
  }
  const hint = resp.recoveryHint;
  if (hint && typeof hint === 'object' && !Array.isArray(hint)) {
    response.recoveryHint = hint as AdminResponse['recoveryHint'];
  }
  return response;
}

function ok(data: Record<string, unknown>): AdminResponse {
  return { success: true, data };
}

/**
 * The Rust Management API wraps every browser response as
 * `{ ok, data, error?, opened? }`. `data` is the payload (a string for
 * `read`, an object for the rest).
 */
function payloadOf(resp: Record<string, unknown>): Record<string, unknown> {
  const data = resp.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/**
 * Call one of the Rust Management API's browser endpoints.
 *
 * GET carries its parameters in the query string (Rust's `state` handler
 * reads a `Query`); POST carries them in a JSON body.
 */
async function callBrowser(
  path: string,
  method: 'GET' | 'POST',
  payload: BrowserActionPayload,
): Promise<{ response: Record<string, unknown>; error: AdminResponse | null }> {
  const fields: Array<[string, string | undefined]> = [
    ['session_id', sessionIdFor(payload) || undefined],
    ['url', payload.url],
    ['selector', payload.selector],
    ['text', payload.text],
    ['value', payload.value],
    ['query', payload.query],
    ['engine', payload.engine],
    // Scroll destination. A number would not survive the string filter
    // below, so `delta` is added to the body separately.
    ['to', payload.to],
    // Credentials are POST-only. A query string lands in Rust's request log
    // and in any URL a future caller prints, so they are added below, after
    // the GET branch has already built its target.
    ['username', method === 'POST' ? payload.username : undefined],
    ['password', method === 'POST' ? payload.password : undefined],
    // Same reasoning as the credentials: a local path in the query string
    // would end up in Rust's request log.
    ['file', method === 'POST' ? payload.file : undefined],
  ];

  let target = path;
  let body: Record<string, unknown> | undefined;
  if (method === 'GET') {
    const qs = fields
      .filter(([, value]) => typeof value === 'string' && value !== '')
      .map(([name, value]) => `${name}=${encodeURIComponent(value as string)}`)
      .join('&');
    if (qs) target = `${path}?${qs}`;
  } else {
    body = Object.fromEntries(
      fields.filter(([, value]) => typeof value === 'string' && value !== ''),
    );
    if (typeof payload.index === 'number') body.index = payload.index;
    if (typeof payload.tab === 'number') body.tab = payload.tab;
    if (typeof payload.delta === 'number') body.delta = payload.delta;
    if (payload.newTab) body.new_tab = true;
  }

  // managementApi never throws — transport errors come back as `ok: false`,
  // which is exactly a real embedded-browser failure (Rust bridge down, open
  // timeout, dead webview). This is the ONLY place that health is observable;
  // argument validation happens in the handlers above and never reaches here,
  // so a model typo cannot spend the Playwright quota.
  const resp = await managementApi(target, method, body, { timeoutMs: BROWSER_TIMEOUT_MS });
  const ok = resp.ok === true;
  recordEmbeddedBrowserOutcome(ok);
  if (!ok) {
    return { response: resp, error: mgmtError(resp, `Browser request failed: ${path}`) };
  }
  return { response: resp, error: null };
}

/** `hamuna browser status` — current URL, title, readiness. */
export async function handleBrowserState(payload: BrowserActionPayload): Promise<AdminResponse> {
  const { response, error } = await callBrowser('/api/browser/state', 'GET', payload);
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    title: data.title,
    url: data.url,
    readyState: data.readyState,
  });
}

/** `hamuna browser open <url>` — navigate (creating the panel if needed). */
export async function handleBrowserNavigate(payload: BrowserActionPayload): Promise<AdminResponse> {
  const url = (payload.url ?? '').trim();
  if (!url) {
    return {
      success: false,
      error: 'A URL is required.',
      suggestedCommand: 'hamuna browser open https://example.com',
    };
  }
  const { response, error } = await callBrowser('/api/browser/navigate', 'POST', {
    ...payload,
    url,
  });
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    url: typeof data.url === 'string' ? data.url : url,
    opened: response.opened === true,
    newTab: payload.newTab === true,
  });
}

/**
 * `hamuna browser tabs` — list the open tabs of the browser panel.
 *
 * Tabs are addressed by index in creation order, which is the order the tab
 * strip shows them in — the agent never sees the internal browser tab ids.
 */
export async function handleBrowserTabs(payload: BrowserActionPayload): Promise<AdminResponse> {
  const { response, error } = await callBrowser('/api/browser/tabs', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  const tabs = Array.isArray(data.tabs) ? data.tabs : [];
  return ok({
    tabs,
    count: typeof data.count === 'number' ? data.count : tabs.length,
    max: typeof data.max === 'number' ? data.max : 0,
  });
}

/**
 * `hamuna browser select --tab N` — bring tab N to the front.
 *
 * The selected tab is the one every later browser command drives.
 */
export async function handleBrowserSelect(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (typeof payload.tab !== 'number' || !Number.isInteger(payload.tab) || payload.tab < 0) {
    return {
      success: false,
      error: 'A tab index is required: pass --tab <n> from `hamuna browser tabs`.',
      suggestedCommand: 'hamuna browser tabs',
    };
  }
  const { response, error } = await callBrowser('/api/browser/select', 'POST', payload);
  if (error) return error;
  return ok(payloadOf(response));
}

/**
 * `hamuna browser read` — page content as markdown.
 *
 * The Rust side returns raw HTML; converting here keeps the (much larger)
 * HTML out of the CLI's JSON payload and gives the agent prose.
 */
export async function handleBrowserRead(payload: BrowserActionPayload): Promise<AdminResponse> {
  const { response, error } = await callBrowser('/api/browser/read', 'POST', payload);
  if (error) return error;

  const raw = response.data;
  const html = typeof raw === 'string'
    ? raw
    : (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).html === 'string'
      ? (raw as Record<string, unknown>).html as string
      : '');

  return ok({
    markdown: html ? htmlToMarkdown(html) : '',
    url: typeof response.url === 'string' ? response.url : '',
  });
}

/**
 * `hamuna browser click --selector <css> | --text <label>`
 *
 * The response carries an **effect verdict**, not just an acknowledgement.
 * `changed` is whether any visible interactive element (or the URL) differed
 * after the click; `matches` lists the other elements the text query could
 * have meant. Both exist because "clicked" was previously indistinguishable
 * from "the click did nothing", which is what made the agent keep clicking.
 */
export async function handleBrowserClick(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (!payload.selector && !payload.text) {
    return {
      success: false,
      error: 'A target is required: pass --selector <css> or --text <visible label>.',
      suggestedCommand: 'hamuna browser click --text "Sign in"',
    };
  }
  const { response, error } = await callBrowser('/api/browser/click', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    clicked: true,
    tag: data.tag,
    label: data.label,
    // Selector of what actually got clicked, so a follow-up can target the
    // same element even when the text query was ambiguous.
    selector: data.selector,
    // `null` = the page could not be measured; `false` = measured, nothing
    // moved. Collapsing those would tell the agent to give up on a click we
    // never observed.
    changed: data.changed ?? null,
    urlChanged: data.urlChanged ?? null,
    page: data.page,
    fromUrl: data.fromUrl,
    // Other candidates the text query matched, best first. Present only when
    // the click was made by text and more than one element matched.
    matches: Array.isArray(data.matches) && data.matches.length > 1 ? data.matches : undefined,
  });
}

/**
 * `hamuna browser scroll` — move the viewport.
 *
 * Two input devices, two flag shapes:
 * - a **mouse wheel** is discrete → `--down N` / `--up N` count notches;
 * - a **trackpad** is continuous → `--delta <px>` is a pixel distance.
 *
 * Plus the two positions that need no distance at all (`--to top|bottom`) and
 * the one that needs no scrolling at all (`--selector` / `--text`: bring that
 * element into view).
 *
 * The answer reports where the viewport ended up (`offset`, `moved`,
 * `atTop` / `atBottom`) so the agent can tell "scrolled to the end of the
 * feed" from "the page does not scroll".
 */
export async function handleBrowserScroll(payload: BrowserActionPayload): Promise<AdminResponse> {
  const to = typeof payload.to === 'string' ? payload.to.trim().toLowerCase() : '';
  const delta = typeof payload.delta === 'number' && Number.isFinite(payload.delta)
    ? payload.delta
    : 0;
  const hasTarget = Boolean(payload.selector || payload.text);

  if (delta === 0 && !to && !hasTarget) {
    return {
      success: false,
      error: 'A scroll target is required: a pixel offset, top/bottom, or an element to bring into view.',
      suggestedCommand: 'hamuna browser scroll --down 3',
    };
  }
  if (to && to !== 'top' && to !== 'bottom') {
    return {
      success: false,
      error: `Unknown scroll destination '${to}'. Use top or bottom.`,
      suggestedCommand: 'hamuna browser scroll --to bottom',
    };
  }

  const { response, error } = await callBrowser('/api/browser/scroll', 'POST', { ...payload, to });
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    scrolled: true,
    mode: data.mode,
    target: data.target,
    offset: data.offset,
    moved: data.moved,
    atTop: data.atTop,
    atBottom: data.atBottom,
    scrollable: data.scrollable,
  });
}

/** `hamuna browser fill --selector <css> --value <text>` */
export async function handleBrowserFill(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (!payload.selector && !payload.text) {
    return {
      success: false,
      error: 'A target is required: pass --selector <css> or --text <visible label>.',
    };
  }
  if (payload.value === undefined) {
    return {
      success: false,
      error: 'A value is required: pass --value <text>.',
      suggestedCommand: 'hamuna browser fill --selector "#q" --value "hamuna"',
    };
  }
  const { response, error } = await callBrowser('/api/browser/fill', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    filled: true,
    tag: data.tag,
    label: data.label,
  });
}

/**
 * `hamuna browser fields` — the page's visible form fields and buttons, each
 * with a CSS selector that resolves to it.
 *
 * The discovery primitive. Text lookup finds buttons, but a textbox has no
 * text to find — its "text" is its value, and an empty textbox has none. So
 * without this, an agent can press "发布" but cannot find the description box
 * to type into. Each entry carries a selector so the agent never has to guess
 * one.
 */
export async function handleBrowserFields(payload: BrowserActionPayload): Promise<AdminResponse> {
  const { response, error } = await callBrowser('/api/browser/fields', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  const fields = Array.isArray(data.fields) ? data.fields : [];
  return ok({ count: typeof data.count === 'number' ? data.count : fields.length, fields });
}

/**
 * `hamuna browser upload --selector <css> | --text <label> --file <path>`
 *
 * Puts a local file into a `<input type=file>`. This is how media gets onto a
 * publish page — the Rust side reads the bytes and inlines them as base64.
 *
 * **The Rust side owns the path rules** (`validate_file_path`: absolute, not
 * blacklisted) and the size ceilings (`MAX_UPLOAD_BYTES`, 12 MiB for the
 * inline path, `MAX_VIDEO_UPLOAD_BYTES`, 256 MiB for the chunked one that
 * carries video). This layer only forwards the path; it deliberately does not
 * re-implement either check, because two implementations of the same rule
 * drift.
 */
export async function handleBrowserUpload(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (!payload.selector && !payload.text) {
    return {
      success: false,
      error: 'A target is required: pass --selector <css> or --text <visible label>.',
      suggestedCommand: 'hamuna browser upload --selector "input[type=file]" --file ./cover.png',
    };
  }
  const file = (payload.file ?? '').trim();
  if (!file) {
    return {
      success: false,
      error: 'A file path is required: pass --file <path>.',
      suggestedCommand: 'hamuna browser upload --selector "input[type=file]" --file ./cover.png',
    };
  }
  const { response, error } = await callBrowser('/api/browser/upload', 'POST', { ...payload, file });
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    uploaded: true,
    name: data.name,
    size: data.size,
    inputCount: data.inputCount,
    selector: data.selector,
  });
}

/**
 * `hamuna browser submit --selector <css> | --text <label>`
 *
 * Submitting is the one externally-visible side effect (an order, a post, a
 * message), so the CLI gates it behind user approval before it reaches here.
 */
export async function handleBrowserSubmit(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (!payload.selector && !payload.text) {
    return {
      success: false,
      error: 'A target is required: pass --selector <css> or --text <visible label>.',
    };
  }
  const { response, error } = await callBrowser('/api/browser/submit', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  return ok({
    submitted: true,
    label: data.label,
  });
}

/**
 * `hamuna browser publish --platform <id> --selector <css> | --text <label>`
 *
 * 发布的**唯一合规路径**。机制上它是一次点击，但它是**带名字的点击**：平台跟
 * 命令一起走，所以两道闸各有其位：
 *
 * - 审批层（`agent-session.ts`）：这个平台有没有用户的常驻授权？有就免打扰，
 *   没有就弹审批。
 * - 范围层（这里）：当前页面是不是这个平台的创作者后台？不是就拒绝。
 *
 * 范围检查是 `--platform` 不是装饰的原因 —— 抖音的授权是"在抖音后台发不用问"，
 * 不是"在任何地方发都不用问"。
 */
export async function handleBrowserPublish(payload: BrowserActionPayload): Promise<AdminResponse> {
  const platform = (payload.platform ?? '').trim();
  if (!platform) {
    return {
      success: false,
      error: 'A platform is required: pass --platform <id>.',
      suggestedCommand: 'hamuna browser publish --platform douyin --text "发布"',
    };
  }
  if (!isSocialPlatformId(platform)) {
    return {
      success: false,
      error: `Unknown social platform '${platform}'. Run \`hamuna platforms\` to list the supported ids.`,
    };
  }
  if (!payload.selector && !payload.text) {
    return {
      success: false,
      error: 'A target is required: pass --selector <css> or --text <visible label>.',
      suggestedCommand: `hamuna browser publish --platform ${platform} --text "发布"`,
    };
  }

  // 范围检查：先看当前页面在不在这个平台的创作者后台域内。
  // 只带 session —— 发布目标的文字不进 query string（Rust 把请求 URL 记进日志）。
  const state = await callBrowser('/api/browser/state', 'GET', { sessionId: payload.sessionId });
  if (state.error) return state.error;
  const currentUrl = typeof payloadOf(state.response).url === 'string'
    ? (payloadOf(state.response).url as string)
    : '';
  if (!isPlatformPublishHost(platform, currentUrl)) {
    return {
      success: false,
      error: `Current page (${currentUrl || 'unknown url'}) is not ${platform}'s creator backend — refusing to publish.`,
      recoveryHint: {
        recoveryCommand: `hamuna browser open ${
          getSocialPlatformPublishProfile(platform).creatorHomeUrl
        }`,
        message: 'Open the platform creator backend first; publishing is only allowed inside it.',
      },
    };
  }

  const { response, error } = await callBrowser('/api/browser/click', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  const page = data.page as Record<string, unknown> | undefined;
  // `published` used to be unconditional, so a click that hit a dead overlay
  // reported a publish. It now follows the same effect verdict as `click`:
  // `false` here means "the click was delivered but the page did not react",
  // which the agent must treat as "not published" and re-read the page. It is
  // still NOT proof of publication — 台账 requires a read-back from the
  // platform's own work list, and this flag must not be used to skip it.
  return ok({
    published: data.changed === true,
    platform,
    url: typeof page?.url === 'string' ? page.url : currentUrl,
    tag: data.tag,
    label: data.label,
    changed: data.changed ?? null,
    urlChanged: data.urlChanged ?? null,
    matches: Array.isArray(data.matches) && data.matches.length > 1 ? data.matches : undefined,
  });
}

/**
 * `hamuna browser search <query>` — web search through the embedded browser.
 *
 * The search happens in the user's own browser window: the engine's homepage
 * is opened, the query is typed into its search box, and the rendered result
 * page is scraped. That is what makes it work where a plain HTTP request
 * does not — the engine sees a real browser (JS runs, bot challenges
 * resolve), the user's cookies apply, and the request looks like the one a
 * person makes rather than a cold `…/search?q=…` hit, which is what the
 * engines rate-limit.
 */
export async function handleBrowserSearch(payload: BrowserActionPayload): Promise<AdminResponse> {
  const query = (payload.query ?? '').trim();
  if (!query) {
    return {
      success: false,
      error: 'A search query is required.',
      suggestedCommand: 'hamuna browser search "tauri webview"',
    };
  }
  const { response, error } = await callBrowser('/api/browser/search', 'POST', {
    ...payload,
    query,
  });
  if (error) return error;
  const data = payloadOf(response);
  const results = Array.isArray(data.results) ? data.results : [];
  return ok({
    query,
    engine: typeof data.engine === 'string' ? data.engine : '',
    count: results.length,
    results,
  });
}

/**
 * `hamuna browser images` — list the page's visible images with indices.
 *
 * The index is what `image-data` takes back, so the agent never has to hold a
 * URL: a captcha's URL usually resolves to a different picture per cookie, and
 * fetching it from the sidecar would hand the agent an image that is not the
 * one on screen.
 */
export async function handleBrowserImages(payload: BrowserActionPayload): Promise<AdminResponse> {
  const { response, error } = await callBrowser('/api/browser/images', 'POST', payload);
  if (error) return error;
  const data = payloadOf(response);
  const images = Array.isArray(data.images) ? data.images : [];
  return ok({ count: typeof data.count === 'number' ? data.count : images.length, images });
}

/**
 * `hamuna browser image-data --index N` — one image's pixels as a data URL.
 *
 * Kept separate from `images` because the payload is large (hundreds of KB of
 * base64) and most listings do not need it.
 */
export async function handleBrowserImageData(payload: BrowserActionPayload): Promise<AdminResponse> {
  if (typeof payload.index !== 'number' || !Number.isInteger(payload.index) || payload.index < 0) {
    return {
      success: false,
      error: 'An image index is required: pass --index <n> from `hamuna browser images`.',
      suggestedCommand: 'hamuna browser images',
    };
  }
  const { response, error } = await callBrowser('/api/browser/image-data', 'POST', payload);
  if (error) return error;
  return ok(payloadOf(response));
}

/**
 * `hamuna browser login --user X --password-stdin` — fill a login form.
 *
 * Returns what was filled and whether a captcha blocks submission, but never
 * echoes the values. The caller decides whether to read the captcha first;
 * submitting stays a separate, user-approved `submit`.
 */
export async function handleBrowserLogin(payload: BrowserActionPayload): Promise<AdminResponse> {
  const username = (payload.username ?? '').trim();
  if (!username) {
    return {
      success: false,
      error: 'A username is required.',
      suggestedCommand: 'hamuna browser login --user me@example.com --password-stdin',
    };
  }
  if (typeof payload.password !== 'string' || payload.password === '') {
    return {
      success: false,
      error: 'A password is required. Pipe it in with --password-stdin so it never lands in shell history.',
      suggestedCommand: 'hamuna browser login --user me@example.com --password-stdin',
    };
  }
  const { response, error } = await callBrowser('/api/browser/login', 'POST', {
    ...payload,
    username,
  });
  if (error) return error;
  return ok(payloadOf(response));
}

/**
 * Dispatch a `browser/<action>` admin route.
 *
 * Lives behind a dynamic import at the call site so the HTML→markdown
 * converter's dependency tree stays out of the admin-api cold start.
 */
export async function handleBrowserAction(
  action: string,
  payload: BrowserActionPayload,
): Promise<AdminResponse> {
  switch (action) {
    case 'state':
    case 'status':
      return handleBrowserState(payload);
    case 'navigate':
    case 'open':
      return handleBrowserNavigate(payload);
    case 'tabs':
      return handleBrowserTabs(payload);
    case 'select':
      return handleBrowserSelect(payload);
    case 'read':
      return handleBrowserRead(payload);
    case 'search':
      return handleBrowserSearch(payload);
    case 'images':
      return handleBrowserImages(payload);
    case 'image-data':
      return handleBrowserImageData(payload);
    case 'login':
      return handleBrowserLogin(payload);
    case 'click':
      return handleBrowserClick(payload);
    case 'scroll':
      return handleBrowserScroll(payload);
    case 'fill':
      return handleBrowserFill(payload);
    case 'upload':
      return handleBrowserUpload(payload);
    case 'fields':
      return handleBrowserFields(payload);
    case 'submit':
      return handleBrowserSubmit(payload);
    case 'publish':
      return handleBrowserPublish(payload);
    default:
      return {
        success: false,
        error: `Unknown browser action: ${action}. Use state | open | tabs | select | read | search | click | scroll | fill | upload | fields | submit | publish | images | image-data | login.`,
      };
  }
}
