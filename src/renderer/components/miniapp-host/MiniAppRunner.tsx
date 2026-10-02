/**
 * MiniApp Runner（PRD v0.4 §B.1 #5 + PRD v0.3 §5）。
 *
 * 渲染一个 iframe 加载 MiniApp source/index.html，postMessage 桥 + CSS Token
 * 注入 + sandbox 安全。Phase 0 MVP：仅本地加载，无 Sidecar / 无权限弹窗 /
 * 无 Bubble Claim。
 *
 * 安全红线（PRD v0.3 §11.1）：
 * - sandbox = allow-scripts allow-same-origin allow-forms
 *   （**禁** allow-popups / allow-top-navigation / allow-pointer-lock / allow-modals）
 * - CSP `connect-src` 只放 MiniApp 自身 + Rust 代理层白名单端口；不放
 *   Cowork Sidecar port（Phase 2 防 iframe 直连旁路）
 * - postMessage `event.source === iframe.contentWindow` 严格相等
 *
 * Phase 3 (PRD §B.4): when `kind === 'worker'`, the runner also spawns a
 * worker_thread pool via `/api/miniapp/worker/{spawn,call,terminate}` and
 * bridges iframe `worker.call` postMessages to the worker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPostJson } from '@/api/apiFetch';

import {
  mintBubbleClaimNonce,
  verifyBubbleClaim,
  type BubbleClaimMessage,
} from './bubbleClaimBridge';
import {
  buildWorkerResult,
  loadWorkerKinds,
  mintWorkerCallNonce,
  verifyWorkerCall,
  type WorkerCallMessage,
  type WorkerCallResult,
} from './workerCallBridge';
import { buildThemeTokenCss, readThemeTokens } from './theme-tokens';

export type MiniAppKind = 'iframe' | 'worker';

export interface MiniAppRunnerProps {
  /** MiniApp 应用 ID，对应 `meta.json.id`。 */
  appId: string;
  /** MiniApp `source/index.html` 编译后 HTML（含 `<style>` + `<script>`）。 */
  srcDoc: string;
  /** iframe 高（默认 100%）。 */
  height?: string | number;
  /**
   * Bubble Claim 回调：MiniApp 通过 postMessage 投递有效 claim 时触发。
   * 父组件决定是把 claim 写入 Chat composer、还是先弹 FloatingMiniChat 让用户确认。
   */
  onBubbleClaim?: (msg: BubbleClaimMessage) => void;
  /**
   * Phase 3: optional MiniApp kind. `worker` triggers worker-pool spawn + RPC
   * bridge. Defaults to `iframe` (Phase 0/1/2 behavior).
   */
  kind?: MiniAppKind;
  /**
   * Required when `kind === 'worker'`. Mirrors `meta.json::kind` mapping:
   * `kind: 'worker'` requires `workerKind: 'git-graph'` (etc.). Phase 3
   * hardcodes git-graph; Phase 4 will read from `meta.json`.
   */
  workerKind?: string;
}

const SANDBOX_FLAGS = 'allow-scripts allow-same-origin allow-forms';
const IFRAME_NAME_PREFIX = 'miniapp-iframe';

/**
 * PRD v0.3 §11.1 — the iframe must not be able to reach the sidecar directly
 * ("Phase 2 防 iframe 直连旁路").
 *
 * `'self'` is required in script-src/style-src, not optional: a MiniApp's
 * `source/index.html` references its siblings as `<link rel="stylesheet"
 * href="style.css">` and `<script src="ui.js">`. `default-src 'none'` +
 * `'unsafe-inline'` alone blocks those (it only permits *inline* style/script),
 * which strips the app bare. The source endpoint inlines both files before
 * handing the HTML over, so in practice the tags are already gone — `'self'`
 * is the safety net for a MiniApp whose sibling file failed to inline.
 *
 * `connect-src 'none'` is the directive that actually does the work: the
 * sidecar is a different origin, so no fetch/XHR/WebSocket from the iframe can
 * reach it. Every legitimate capability already goes through postMessage.
 *
 * ponytail: `img-src https:` is a covert exfil channel (URL params, beacons).
 * Lock it to `data: blob:` when the marketplace starts shipping third-party
 * authors — the bundled apps don't need it, but a generated one might.
 */
const IFRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'self'",
  "style-src 'unsafe-inline' 'self'",
  "img-src data: blob: https:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export default function MiniAppRunner({
  appId,
  srcDoc,
  height = '100%',
  onBubbleClaim,
  kind = 'iframe',
  workerKind,
}: MiniAppRunnerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [themeCss, setThemeCss] = useState<string>('');
  // Per-iframe-session nonce. Re-minted on appId change so a stale claim from
  // the previous iframe can't survive a re-mount. See bubbleClaimBridge.ts
  // for the trust rules (source === iframe.contentWindow + nonce + kind).
  const nonceRef = useRef<string>(mintBubbleClaimNonce());
  // Phase 3: separate nonce for worker-call channel. Independent from
  // BubbleClaim so the iframe can't replay across channels.
  const workerNonceRef = useRef<string>(mintWorkerCallNonce());
  // Pool-spawned worker id; null until spawn succeeds. Held in a ref so the
  // unmount cleanup can terminate even if state changes haven't flushed.
  const workerIdRef = useRef<string | null>(null);
  // Phase 4.2: kind→methods allow-list for this runner's workerKind.
  // `undefined` = cache miss → fail-closed (verifyWorkerCall drops unknown
  // methods). The spawn effect gates on this state so `worker.ready` isn't
  // posted before the host knows which methods are legal.
  const [kindAllowlist, setKindAllowlist] = useState<readonly string[] | undefined>(undefined);
  useEffect(() => {
    nonceRef.current = mintBubbleClaimNonce();
    workerNonceRef.current = mintWorkerCallNonce();
    if (!workerKind) {
      setKindAllowlist(undefined);
      return;
    }
    let cancelled = false;
    void loadWorkerKinds()
      .then((map) => {
        if (!cancelled) setKindAllowlist(map[workerKind]);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('[MiniAppRunner] loadWorkerKinds failed:', e);
          // Leave allowlist undefined → all worker.call rejected. The user
          // can reload to retry the fetch.
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appId, workerKind]);

  // mount 时注入 Theme Token；后续 Theme 切换时刷新（PRD v0.3 §5.3 row 4）
  useEffect(() => {
    const apply = () => {
      const tokens = readThemeTokens();
      setThemeCss(buildThemeTokenCss(tokens));
    };
    apply();
    // Phase 0 简化：监听 Theme 切换靠 document `data-theme-id` attribute mutation
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-id'] });
    return () => obs.disconnect();
  }, [appId]);

  // 拼 srcDoc：Theme `<style>` + CSP meta + 用户 HTML + appId 注入 script
  const fullSrcDoc = `${themeCss}\n${injectAppId(injectCsp(srcDoc), appId)}`;

  // 卸载 / appId 切换时解绑 iframe 引用，触发 GC（PRD v0.3 §5.3 row 2）
  useEffect(() => {
    const el = iframeRef.current;
    return () => {
      if (el) {
        // contentWindow 是 read-only；用 srcDoc='' 断引用
        try {
          el.srcdoc = '';
        } catch {
          // 卸载竞态：忽略
        }
      }
    };
  }, [appId]);

  // Phase 3: spawn worker when kind === 'worker'. Cleanup terminates the
  // worker on unmount / appId change. Failure is silent — MiniApp is allowed
  // to render without a worker (Bubble Claim UI still works).
  //
  // Phase 4.2: wait for the kinds cache to load BEFORE posting
  // `worker.ready`. Otherwise the iframe can call `worker.call` before the
  // host has the allow-list, and verifyWorkerCall will reject everything.
  useEffect(() => {
    if (kind !== 'worker' || !workerKind) return;
    if (kindAllowlist === undefined) return; // kinds cache not loaded yet
    let cancelled = false;
    (async () => {
      try {
        const result = await apiPostJson<{ ok: boolean; workerId?: string; error?: string }>(
          '/api/miniapp/worker/spawn',
          { appId, kind: workerKind },
        );
        if (cancelled) {
          // Mount unmounted before spawn returned — terminate immediately.
          if (result.ok && result.workerId) {
            void apiPostJson('/api/miniapp/worker/terminate', { workerId: result.workerId });
          }
          return;
        }
        if (result.ok && result.workerId) {
          workerIdRef.current = result.workerId;
          // Tell the iframe that the worker is ready + which nonce to use.
          // iframe-side ui.js sets `window.__workerNonce` and starts calling
          // `app.worker.call(method, params)`. The nonce must match
          // `workerNonceRef.current` for the host to accept the call.
          iframeRef.current?.contentWindow?.postMessage(
            { kind: 'worker.ready', nonce: workerNonceRef.current },
            '*',
          );
        } else {
          console.error('[MiniAppRunner] worker spawn failed:', result.error);
        }
      } catch (e) {
        console.error('[MiniAppRunner] worker spawn threw:', e);
      }
    })();
    return () => {
      cancelled = true;
      const workerId = workerIdRef.current;
      workerIdRef.current = null;
      if (workerId) {
        try {
          const p = apiPostJson('/api/miniapp/worker/terminate', { workerId });
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              // ignore: cleanup best-effort
            });
          }
        } catch {
          // ignore: cleanup best-effort
        }
      }
    };
  }, [appId, kind, workerKind, kindAllowlist]);

  // Bubble Claim postMessage listener（PRD v0.4 §B.3 + CLAUDE.md §Pit-of-Success
  // postMessage 红线）。trust decisions live in `verifyBubbleClaim`; this
  // effect just plumbs the iframe ref into it.
  const handleClaim = useCallback(
    (msg: BubbleClaimMessage) => onBubbleClaim?.(msg),
    [onBubbleClaim],
  );

  // Phase 3: worker-call bridge listener. Same listener object as bubble
  // claim (single `message` event on window) — `verifyWorkerCall` is the
  // second pass. Methods are looked up at handler-call time so the spawn /
  // terminate lifecycle doesn't have to drive React state.
  //
  // Phase 4.2: `kindAllowlist` is fetched once via `loadWorkerKinds()` (see
  // workerCallBridge). The cache miss state (`undefined`) fail-closes the
  // listener — verifyWorkerCall drops unknown methods.
  useEffect(() => {
    if (kind !== 'worker') return;
    const handler = async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      // Narrow MessageEventSource to Window — iframe postMessage is always
      // a Window; MessagePort / ServiceWorker don't apply here.
      const windowSource = event.source instanceof Window ? event.source : null;
      const call: WorkerCallMessage | null = verifyWorkerCall(
        { source: windowSource, origin: event.origin, data: event.data },
        iframe?.contentWindow ?? null,
        workerNonceRef.current,
        appId,
        kindAllowlist,
      );
      if (!call) return;
      const workerId = workerIdRef.current;
      if (!workerId || !iframe?.contentWindow) {
        return;
      }
      // Always reply — even on timeout / network failure — so the iframe
      // doesn't hang on a missing response.
      let result: WorkerCallResult;
      try {
        result = await apiPostJson<WorkerCallResult>('/api/miniapp/worker/call', {
          workerId,
          method: call.payload.method,
          params: call.payload.params,
        });
      } catch (e) {
        result = {
          ok: false,
          error: {
            code: 'NETWORK_ERROR',
            message: e instanceof Error ? e.message : 'unknown network error',
          },
        };
      }
      const response = buildWorkerResult(workerNonceRef.current, call.id, result);
      iframe.contentWindow.postMessage(response, '*');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appId, kind, kindAllowlist]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      const claim = verifyBubbleClaim(
        { source: event.source, origin: event.origin, data: event.data },
        iframe?.contentWindow ?? null,
        nonceRef.current,
        appId,
      );
      if (claim) handleClaim(claim);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appId, handleClaim]);

  /**
   * Hand the MiniApp the Bubble Claim nonce it cannot invent for itself.
   *
   * `verifyBubbleClaim` rejects any claim whose nonce doesn't match, and the
   * nonce lives in the host's `nonceRef` — so without this the MiniApp can only
   * guess, and every claim it posts is silently dropped. Delivered on `load`
   * rather than on mount because a srcDoc iframe's document is not parsed yet
   * at mount, and a postMessage into an unparsed document is lost.
   */
  const handleFrameLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { kind: 'host.ready', nonce: nonceRef.current },
      '*',
    );
  }, []);

  return (
    <iframe
      ref={iframeRef}
      name={`${IFRAME_NAME_PREFIX}-${appId}`}
      title={`MiniApp ${appId}`}
      sandbox={SANDBOX_FLAGS}
      srcDoc={fullSrcDoc}
      onLoad={handleFrameLoad}
      style={{
        width: '100%',
        height,
        border: 0,
        display: 'block',
        colorScheme: 'dark light',
      }}
    />
  );
}

/** 在 srcDoc `</head>` 前注入 `<meta name="x-miniapp-id">` 让 iframe JS 自识身份。 */
function injectAppId(html: string, appId: string): string {
  const meta = `<meta name="x-miniapp-id" content="${escapeHtml(appId)}">`;
  if (html.includes('</head>')) return html.replace('</head>', `${meta}</head>`);
  return `${meta}${html}`;
}

/** 在 srcDoc `</head>` 前注入 CSP meta。MiniApp 自带的 CSP 会被移除，避免叠加放宽。 */
function injectCsp(html: string): string {
  // A MiniApp that ships its own <meta http-equiv="Content-Security-Policy">
  // would otherwise have its policy combined with ours, and the spec takes
  // the *intersection* only for the directives both name — so a MiniApp
  // naming a permissive `connect-src` would silently re-open the bypass this
  // policy exists to close. Strip theirs; ours is the only one.
  const stripped = html.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    '',
  );
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(IFRAME_CSP)}">`;
  if (stripped.includes('</head>')) return stripped.replace('</head>', `${meta}</head>`);
  return `${meta}${stripped}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}