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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiPostJson } from '@/api/apiFetch';

import { postAppResult, verifyAppCall } from '../../../shared/miniapp/app-protocol';
import { hostAllowed } from '../../../shared/miniapp/app-permissions';
import type { MiniAppDependency, MiniAppPermissions } from '../../../shared/miniapp/types';

import { runAppCall } from './appBridge';
import { createAppDispatcher, clearWorkerId, registerWorkerId } from './appHostDispatch';
import { createAgentBridge, type AgentEventPayload } from './agentEventBridge';
import { buildAppRuntimeScript } from './appRuntimeScript';
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
  /**
   * `meta.json::permissions`. 宿主侧 `window.app.*` 的授权依据 —— 没有它
   * 所有能力调用都会被拒（默认空 = 无授权，fail-closed）。
   */
  permissions?: MiniAppPermissions;
  /**
   * `meta.json::dependencies` — CDN `<script>` / `<link>` to inject, and the
   * *only* thing that widens the iframe CSP beyond `default-src 'none'`.
   * Omit (or pass hosts outside `permissions.net.allow`) and loading is
   * blocked, which is the fail-closed default.
   */
  dependencies?: readonly MiniAppDependency[];
  /**
   * 宿主环境事实（平台 / 语言 / 工作区路径），随 `host.ready` 下发给
   * iframe 侧 runtime，填充 `app.platform` / `app.locale` / `app.workspaceDir`。
   * 缺省时 runtime 用保守默认值，不影响能力调用。
   */
  env?: MiniAppRuntimeEnv;
  /**
   * Tab 是否为当前激活页。驱动 `app.onActivate` / `app.onDeactivate` ——
   * MiniApp 据此暂停轮询、停止动画或断开长任务。缺省视为恒激活
   * （裸挂载场景没有 tab 概念），不会误发 deactivate。
   */
  isActive?: boolean;
}

/** 宿主注入给 MiniApp 的环境事实。 */
export interface MiniAppRuntimeEnv {
  platform?: string;
  locale?: string;
  appearanceMode?: string;
  workspaceDir?: string;
  appDataDir?: string;
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

/**
 * CSP with declared CDN hosts added to `script-src` / `style-src`.
 *
 * Deliberately NOT widened to `script-src https:` — that would let a
 * compromised dependency fetch and execute a second-stage script from
 * anywhere. Hosts come from `meta.json::dependencies`, which the schema
 * already constrained to `permissions.net.allow` and https-only.
 *
 * font-src stays `data:` on purpose: a webfont fetched cross-origin needs
 * CORS headers the CDN may not send, and letting arbitrary font hosts in
 * buys nothing that inline @font-face / data: doesn't already cover.
 */
function buildIframeCsp(scriptHosts: readonly string[]): string {
  if (scriptHosts.length === 0) return IFRAME_CSP;
  const hosts = [...new Set(scriptHosts)].join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'self' ${hosts}`,
    `style-src 'unsafe-inline' 'self' ${hosts}`,
    "img-src data: blob: https:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * `<script src>` / `<link rel=stylesheet>` for declared CDN dependencies.
 *
 * `defer` on the script mirrors what a normal document does: a srcDoc
 * srcdoc attribute is parsed as a document, so a non-deferred external
 * script would block the parser while the network is cold, delaying the
 * app's own inline bootstrap. Stylesheets stay blocking on purpose —
 * FOUC on first paint is a worse artifact than a blocked one.
 */
function injectDependencyTags(html: string, deps: readonly MiniAppDependency[]): string {
  if (deps.length === 0) return html;
  const tags = deps
    .map((d) =>
      d.type === 'script'
        ? `<script src="${escapeHtml(d.url)}" defer></script>`
        : `<link rel="stylesheet" href="${escapeHtml(d.url)}">`,
    )
    .join('');
  if (html.includes('</head>')) return html.replace('</head>', `${tags}</head>`);
  return `${tags}${html}`;
}

export default function MiniAppRunner({
  appId,
  srcDoc,
  height = '100%',
  onBubbleClaim,
  kind = 'iframe',
  workerKind,
  permissions,
  dependencies,
  env,
  isActive,
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
  // 「没有 workerKind ⇒ 没有 allow-list」是**派生**出来的，不是存出来的。
  //
  // 之前这里在 effect 里同步 `setKindAllowlist(undefined)`，被
  // react-hooks/set-state-in-effect 拦下（同步 setState 会触发级联渲染）。改成
  // 派生顺带消掉一个真实的陈旧窗口：workerKind 从 'a' 变 null 时，旧 allowlist
  // 仍留在 state 里，而 listener 那个 effect 只判了 `kind !== 'worker'`、没判
  // workerKind，可能拿上一轮的名单去校验新的一轮。现在两种情况都直接 fail-closed。
  const effectiveKindAllowlist = workerKind ? kindAllowlist : undefined;
  useEffect(() => {
    nonceRef.current = mintBubbleClaimNonce();
    workerNonceRef.current = mintWorkerCallNonce();
    if (!workerKind) return;
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

  // 拼 srcDoc：Theme `<style>` + CSP meta + `window.app` runtime + 用户 HTML
  //
  // runtime 必须排在用户 HTML 之前：`ui.js` 在解析期就可能调用 `app.*`，
  // 放后面会撞上 "Cannot read properties of undefined"。
  const appRuntimeScript = useMemo(() => buildAppRuntimeScript(appId), [appId]);
  // CDN 依赖先注入（进 `<head>`），再算 CSP —— 顺序反了 CSP 会按旧的无依赖
  // 版本算好、放宽的源就永远用不上。两步都只在声明了依赖时改变输出。
  // 双重过滤：schema 已经要求 https + net.allow，但 meta 是磁盘上的文件，
  // 可能被手工改过 —— 宿主不能假设上游一定校验过。`hostAllowed` 对非法 URL
  // 返回 false，所以走到这里的 url 必定可解析。
  const usableDeps = useMemo(
    () => (dependencies ?? []).filter((d) => hostAllowed(d.url, permissions?.net?.allow ?? [])),
    [dependencies, permissions],
  );
  const fullSrcDoc = `${themeCss}\n${injectAppId(
    injectCsp(
      injectAppRuntime(injectDependencyTags(srcDoc, usableDeps), appRuntimeScript),
      [...new Set(usableDeps.map((d) => new URL(d.url).host))],
    ),
    appId,
  )}`;

  // `window.app.*` 派发器。绑定 appId（闭包），因此多个 MiniApp Tab 并存时
  // 互不串号。`useMemo` 而非 ref：dispatch 在 listener 里被调用，重建函数
  // 无副作用，重建代价是一次对象字面量。
  //
  // `agentBridge` 让 `app.agent.ensureSession` / `onEvent` 能在 renderer 侧起
  // Agent sidecar —— 那是 sidecar 进程自己做不到的事（它没法给自己起 sibling）。
  //
  // bridge 工厂在 render 期间**不接触任何 ref**（react-hooks/refs）：`post` 的
  // 实现要读 `iframeRef.current` / `nonceRef.current`，而构造发生在 render 里，
  // 规则不接受把 ref 交给渲染期调用的工厂（包几层都不行）。改成 owner 在
  // commit 后调 `setPost` 注入，工厂彻底不碰 ref，语义也对 —— 事件必然晚于
  // commit 到达。
  const agentBridge = useMemo(() => createAgentBridge({ appId }), [appId]);
  useEffect(() => {
    agentBridge.setPost((payload: AgentEventPayload) => {
      // 展开顺序要紧：payload 自带 `type`，放在 `type:` 之后会把它覆盖成
      // undefined，iframe 侧就再也分不出 delta / complete 了。
      iframeRef.current?.contentWindow?.postMessage(
        { kind: 'app.event', nonce: nonceRef.current, ...payload },
        '*',
      );
    });
  }, [agentBridge]);

  const dispatcher = useMemo(
    () => createAppDispatcher(appId, { agentBridge }),
    [appId, agentBridge],
  );

  // 卸载时释放 Agent session 与 SSE。Agent session = 一个真实的 Node 进程，
  // 不释放就会一直挂在后台（CLAUDE.md Sidecar Owner 模型：资源随 owner 走）。
  useEffect(() => {
    return () => {
      void agentBridge.release();
    };
  }, [agentBridge]);

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
    if (effectiveKindAllowlist === undefined) return; // kinds cache not loaded yet
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
          // Register so `app.call(...)` inside the iframe routes to this same
          // worker. Without this, every call would spawn an orphan — the map is
          // keyed by appId because one iframe owns exactly one worker.
          registerWorkerId(appId, result.workerId);
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
      // Drop the routing entry even if terminate fails — a stale workerId would
      // let `app.call` hit a dead pool and surface as a confusing RPC error.
      clearWorkerId(appId);
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
  }, [appId, kind, workerKind, effectiveKindAllowlist]);

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
        effectiveKindAllowlist,
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
  }, [appId, kind, effectiveKindAllowlist]);

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

  // `window.app.*` 调用通道。信任判定在 `verifyAppCall`，权限判定在
  // `runAppCall`，本 effect 只做「验证 → 派发 → 回信」。
  //
  // 对 `kind === 'iframe'` 与 `'worker'` 都监听：`app.fs.*` / `app.shell.exec`
  // 这类框架原语在无 Node 模式下同样可用（对齐 OpenBitFun 的 host_dispatch
  // 设计），不需要 MiniApp 升级成 worker kind。
  const permissionsRef = useRef<MiniAppPermissions | undefined>(permissions);
  useEffect(() => {
    // Sync in an effect, not during render: writing a ref mid-render is what
    // the react-hooks/refs rule bans, and it is also wrong — a render that is
    // thrown away would have already mutated the ref.
    permissionsRef.current = permissions;
  }, [permissions]);
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      const windowSource = event.source instanceof Window ? event.source : null;
      const call = verifyAppCall(
        { source: windowSource, origin: event.origin, data: event.data },
        iframe?.contentWindow ?? null,
        nonceRef.current,
        appId,
      );
      if (!call) return;
      if (!iframe?.contentWindow) return;
      // 永远回信（含超时 / 异常），否则 iframe 的 Promise 永久 pending。
      const result = await runAppCall(
        call.payload.method,
        call.payload.params,
        permissionsRef.current ?? {},
        dispatcher,
      );
      // 回信本身也可能抛：postMessage 走结构化克隆，结果里有不可克隆的值时
      // 会抛 DataCloneError，这条回信就发不出去，作者侧永远 pending。降级成
      // 纯对象错误信封的逻辑与理由见 app-protocol.ts::postAppResult。
      postAppResult(
        iframe.contentWindow,
        nonceRef.current,
        call.id,
        result,
        call.payload.method,
      );
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appId, dispatcher]);

  /**
   * Hand the MiniApp the Bubble Claim nonce it cannot invent for itself, plus
   * the environment facts the `window.app` runtime exposes as getters.
   *
   * `verifyBubbleClaim` rejects any claim whose nonce doesn't match, and the
   * nonce lives in the host's `nonceRef` — so without this the MiniApp can only
   * guess, and every claim it posts is silently dropped. Delivered on `load`
   * rather than on mount because a srcDoc iframe's document is not parsed yet
   * at mount, and a postMessage into an unparsed document is lost.
   */
  const runtimeEnv = useMemo(
    () => ({
      platform: env?.platform ?? 'unknown',
      locale: env?.locale ?? 'en-US',
      appearanceMode: env?.appearanceMode ?? 'dark',
      workspaceDir: env?.workspaceDir ?? '',
      appDataDir: env?.appDataDir ?? '',
    }),
    [env?.platform, env?.locale, env?.appearanceMode, env?.workspaceDir, env?.appDataDir],
  );

  const handleFrameLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { kind: 'host.ready', nonce: nonceRef.current, env: runtimeEnv },
      '*',
    );
  }, [runtimeEnv]);

  // `app.onActivate` / `app.onDeactivate` 的真实来源。
  //
  // 之前 runtime 暴露了这两个回调但宿主从不发送 —— 作者按文档写
  // `onDeactivate(() => clearInterval(t))`，回调永远不触发，轮询在用户切走
  // 后继续烧 CPU。这类"API 存在但没有生产者"的缺陷比缺 API 更难排查。
  //
  // 首帧不重复发 activate：`host.ready` 之后 runtime 立刻 emit 一个 `ready`
  // 事件，iframe 侧把 `onActivate` 注册在 ready 之后才收得到；这里只在
  // `isActive` 真正**变化**时推送，语义才是"状态迁移"而非"当前状态"。
  const lastActiveRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (isActive === undefined) return;
    if (lastActiveRef.current === isActive) return;
    const isFirst = lastActiveRef.current === null;
    lastActiveRef.current = isActive;
    // 首次挂载不发：iframe 的 runtime 此刻可能还没注入完监听器，发了也是
    // 丢失。等作者自己 onActivate/onDeactivate 注册即可。
    if (isFirst) return;
    iframeRef.current?.contentWindow?.postMessage(
      { kind: 'app.event', type: isActive ? 'activate' : 'deactivate', nonce: nonceRef.current },
      '*',
    );
  }, [isActive]);

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

/**
 * 在 srcDoc `<head>` 前注入 `window.app` runtime。
 *
 * CSP 是 `script-src 'unsafe-inline' 'self'`，所以内联 `<script>` 可执行。
 * 注入点必须在用户 HTML 之前 —— `ui.js` 在解析期就可能调 `app.*`。
 */
function injectAppRuntime(html: string, runtimeScript: string): string {
  const tag = `<script>${runtimeScript}</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
  return `${tag}${html}`;
}

/** 在 srcDoc `</head>` 前注入 `<meta name="x-miniapp-id">` 让 iframe JS 自识身份。 */
function injectAppId(html: string, appId: string): string {
  const meta = `<meta name="x-miniapp-id" content="${escapeHtml(appId)}">`;
  if (html.includes('</head>')) return html.replace('</head>', `${meta}</head>`);
  return `${meta}${html}`;
}

/** 在 srcDoc `</head>` 前注入 CSP meta。MiniApp 自带的 CSP 会被移除，避免叠加放宽。 */
function injectCsp(html: string, scriptHosts: readonly string[] = []): string {
  // A MiniApp that ships its own <meta http-equiv="Content-Security-Policy">
  // would otherwise have its policy combined with ours, and the spec takes
  // the *intersection* only for the directives both name — so a MiniApp
  // naming a permissive `connect-src` would silently re-open the bypass this
  // policy exists to close. Strip theirs; ours is the only one.
  const stripped = html.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    '',
  );
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(buildIframeCsp(scriptHosts))}">`;
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
