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
import { htmlToMarkdown } from './html-to-markdown';

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
  /** Search engine for `search` ("360" | "bing" | "baidu"). */
  engine?: string;
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
  }

  const resp = await managementApi(target, method, body, { timeoutMs: BROWSER_TIMEOUT_MS });
  if (resp.ok !== true) {
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
  });
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

/** `hamuna browser click --selector <css> | --text <label>` */
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
 * `hamuna browser search <query>` — web search through the embedded browser.
 *
 * The search happens in the user's own browser window: the engine's result
 * page is opened, rendered, and scraped. That is what makes it work where
 * a plain HTTP request does not — the engine sees a real browser (JS runs,
 * bot challenges resolve), and the user's cookies apply, so a search that
 * needs a logged-in session behaves as it does for them.
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
    case 'read':
      return handleBrowserRead(payload);
    case 'search':
      return handleBrowserSearch(payload);
    case 'click':
      return handleBrowserClick(payload);
    case 'fill':
      return handleBrowserFill(payload);
    case 'submit':
      return handleBrowserSubmit(payload);
    default:
      return {
        success: false,
        error: `Unknown browser action: ${action}. Use state | open | read | search | click | fill | submit.`,
      };
  }
}
