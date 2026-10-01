// workerCallBridge.ts — Phase 3 (PRD v0.4 §B.4) MiniApp iframe ↔ Worker pool.
//
// Mirrors `bubbleClaimBridge.ts`'s trust boundary pattern but for a request/
// response RPC: the iframe posts `{ kind: 'worker.call', nonce, id, payload:
// { method, params } }`, the renderer host calls `/api/miniapp/worker/call`
// against a pool-spawned worker, then posts `{ kind: 'worker.result', nonce,
// id, ok, result | error }` back to the iframe.
//
// Trust rules (CLAUDE.md §Pit-of-Success postMessage 红线):
//   1. event.source === iframe.contentWindow (strict equality)
//   2. nonce must match session-bound nonce
//   3. method name must match the per-kind allow-list (defends against a
//      MiniApp author invoking a method the host never registered for this
//      kind — e.g. git-graph cannot call `fs.read` even though worker_threads
//      permits it)
//   4. appId must match the iframe's bound appId (defends against a sibling
//      MiniApp reusing this listener)
//
// Response semantics: the renderer always posts exactly ONE `worker.result`
// per `worker.call`, even on timeout / network failure / abort. The `id`
// field ties the response to the original request.
//
// Architecture: this file is renderer-only. The server side has its own
// type definitions in `src/server/miniapp-worker/worker-pool.ts`; we
// mirror them locally rather than import across the renderer ↔ server
// boundary (CLAUDE.md §依赖-cruiser 边界).
//
// Phase 4.2: the kind→methods allow-list is fetched once at MiniAppRunner
// mount via `loadWorkerKinds()` (GET /api/miniapp/kinds). The cache is
// renderer-scoped — single in-flight fetch per app mount, not per call.
// The runner MUST `await loadWorkerKinds()` before posting `worker.ready`
// so the iframe can't fire `worker.call` before the host knows the
// allow-list (fail-closed: cache miss → reject).

import { apiGetJson } from '@/api/apiFetch';

export type WorkerCallMessageKind = 'worker.call';
export type WorkerResultMessageKind = 'worker.result';

export interface WorkerCallPayload {
  method: string;
  params: unknown;
  /** Stable MiniApp id; renderer echoes it to defend against sibling reuse. */
  appId: string;
}

export interface WorkerCallMessage {
  kind: WorkerCallMessageKind;
  nonce: string;
  /** Per-request correlation id. The renderer echoes the SAME id in the response. */
  id: string;
  payload: WorkerCallPayload;
}

export interface WorkerResultMessage {
  kind: WorkerResultMessageKind;
  nonce: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export const WORKER_CALL_KINDS: readonly WorkerCallMessageKind[] = ['worker.call'];

export interface PostMessageEnvelope {
  /** Same as `MessageEvent.source` but narrowed to `Window | null` because
   *  iframe postMessage always comes from a Window. Bridge signature must
   *  match the bubbleClaimBridge pattern. */
  source: Window | null;
  origin: string;
  data: unknown;
}

export type SpawnOutcome =
  | { ok: true; workerId: string; methods: string[] }
  | { ok: false; error: string };

/**
 * Pure decision: is this a valid Worker Call message from the bound iframe?
 * Returns the parsed envelope on success, or null on any rule violation
 * (caller logs + drops).
 */
export function verifyWorkerCall(
  envelope: PostMessageEnvelope,
  iframeContentWindow: HTMLIFrameElement['contentWindow'] | null,
  expectedNonce: string,
  boundAppId: string,
  kindAllowlist: readonly string[] | undefined,
): WorkerCallMessage | null {
  // Rule 1: strict equality on the source
  if (!iframeContentWindow || envelope.source !== iframeContentWindow) {
    return null;
  }
  const parsed = parseCallEnvelope(envelope.data);
  if (!parsed) return null;
  // Rule 2: nonce must match
  if (parsed.nonce !== expectedNonce) return null;
  // Rule 3: method allow-list. undefined = cache not loaded yet → fail closed.
  if (!kindAllowlist || !kindAllowlist.includes(parsed.payload.method)) {
    return null;
  }
  // Rule 4: appId must match the iframe's bound appId
  if (parsed.payload.appId !== boundAppId) return null;
  return parsed;
}

function parseCallEnvelope(data: unknown): WorkerCallMessage | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (
    typeof rec.kind !== 'string' ||
    typeof rec.nonce !== 'string' ||
    typeof rec.id !== 'string' ||
    !rec.payload ||
    typeof rec.payload !== 'object'
  ) {
    return null;
  }
  if (rec.kind !== 'worker.call') return null;
  const payload = rec.payload as Record<string, unknown>;
  if (
    typeof payload.method !== 'string' ||
    typeof payload.appId !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'worker.call',
    nonce: rec.nonce,
    id: rec.id,
    payload: {
      method: payload.method,
      params: payload.params,
      appId: payload.appId,
    },
  };
}

/**
 * Build the response envelope that the renderer posts back to the iframe.
 * The `id` ties response → request; the `nonce` is the same session-bound
 * nonce so the iframe can verify the response came from the host.
 */
export function buildWorkerResult(
  expectedNonce: string,
  id: string,
  result: WorkerCallResult,
): WorkerResultMessage {
  return {
    kind: 'worker.result',
    nonce: expectedNonce,
    id,
    ok: result.ok,
    ...(result.ok
      ? { result: result.result }
      : { error: result.error ?? { code: 'UNKNOWN', message: 'unknown error' } }),
  };
}

/**
 * Worker call result mirror. Matches the shape returned by
 * `/api/miniapp/worker/call` (which itself mirrors the server-side `CallResult`).
 */
export interface WorkerCallResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Mint a session-bound nonce for the worker call channel. Separate from
 * BubbleClaimNonce so a MiniApp can't reuse a bubble-claim nonce to call
 * workers (or vice versa).
 */
export function mintWorkerCallNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `worker-nonce-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Mint a per-request correlation id. iframe-supplied ids are not trusted —
 * the renderer mints its own so the iframe can't reuse ids to confuse
 * in-flight responses.
 */
export function mintWorkerCallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `worker-call-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ───── Phase 4.2: runtime kinds cache ─────────────────────────────────────────

/**
 * Single-flight kinds fetch. Subsequent calls return the same promise
 * (renderer-scoped; one mount = one fetch). The fetch returns a flat
 * `{kind: methods[]}` map; the host (`/api/miniapp/kinds`) is the single
 * source of truth — no static mirror here.
 */
let kindsPromise: Promise<Readonly<Record<string, readonly string[]>>> | null = null;

export function loadWorkerKinds(): Promise<Readonly<Record<string, readonly string[]>>> {
  if (kindsPromise) return kindsPromise;
  kindsPromise = (async () => {
    const json = await apiGetJson<
      | { ok: true; kinds: Array<{ kind: string; methods: string[] }> }
      | { ok: false; error: string }
    >('/api/miniapp/kinds');
    if (!json.ok) {
      kindsPromise = null; // allow retry on next call
      throw new Error(`loadWorkerKinds failed: ${json.error}`);
    }
    const out: Record<string, readonly string[]> = {};
    for (const k of json.kinds) {
      out[k.kind] = Object.freeze([...k.methods]);
    }
    return Object.freeze(out);
  })();
  return kindsPromise;
}

/**
 * Test-only: reset the single-flight promise. Production code MUST NOT
 * call this — the cache is intentionally sticky for the renderer session
 * so a Sidecar restart that adds a new kind is observed by user reload,
 * not by surprise mid-call.
 */
export function __resetWorkerKindsForTest(): void {
  kindsPromise = null;
}

