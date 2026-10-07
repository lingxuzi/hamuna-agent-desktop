/**
 * MiniApp Runner（PRD v0.4 §B.1 #5 + PRD v0.3 §5）。
 *
 * 渲染一个 iframe 加载 MiniApp source/index.html，postMessage 桥 + CSS Token
 * 注入 + sandbox 安全。Phase 0 MVP：仅本地加载，无 Sidecar / 无权限弹窗 /
 * 无 Bubble Claim。
 *
 * 安全红线（PRD v0.3 §11.1）：
 * - sandbox = allow-scripts allow-forms
 *   （**禁** allow-same-origin / allow-popups / allow-top-navigation /
 *   allow-pointer-lock / allow-modals）
 *   `allow-same-origin` 曾在这里，理由是"srcdoc 的 opaque origin 会让 nonce 校验
 *   与 storage 分片失效"。实测那个前提两头都不成立，已移除：
 *   - nonce 校验全在宿主侧（`event.source === iframe.contentWindow` + nonce +
 *     appId），从不看 `event.origin`；opaque origin 下 origin 是 `"null"`，但没有
 *     任何一处读它。
 *   - MiniApp 持久化走 `app.storage`，落在宿主侧的 `storage.json`；没有一个内建
 *     app 碰 `localStorage`（icon-generator 早期那份 `window.__miniappStorage`
 *     模板从来就不存在，早就换成 `app.storage` 了）。
 *   留着它的代价则是整个沙箱形同虚设，见 SANDBOX_FLAGS 处的说明。
 * - CSP `connect-src 'none'`：不是"只放白名单端口"，是一个端口都不放。sidecar 是
 *   另一个 origin，iframe 里的 fetch / XHR / WebSocket 全都够不着，合法能力一律走
 *   postMessage
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
import { buildAppRuntimeScript, countAuthorLineOffset } from './appRuntimeScript';
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
import { buildThemeTokenCss, readThemeTokens, THEME_TOKEN_STYLE_ID } from './theme-tokens';

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

/**
 * `allow-same-origin` 是**不能**加回来的那一个，它和 `allow-scripts` 同时出现时
 * 等于把整个沙箱关掉。
 *
 * 原因不是理论上的：MiniApp 的文档是 `srcdoc`，默认继承宿主的 origin，于是
 * `window.parent` 直接可达。Tauri v2 **总是**往页面注入
 * `window.__TAURI_INTERNALS__`（`withGlobalTauri: false` 只关掉 `__TAURI__` 那个
 * 便捷命名空间，关不掉它 —— `@tauri-apps/api/core` 的 invoke 就是走
 * `window.__TAURI_INTERNALS__.invoke(cmd, args)`，本仓 renderer 自己也用
 * `"__TAURI_INTERNALS__" in window` 做特性探测）。所以同源 MiniApp 一行
 * `window.parent.__TAURI_INTERNALS__.invoke('cmd_read_workspace_file', …)` 就能
 * 拿到任意 Tauri 命令，把 `app-permissions.ts` / `resolvePolicyForSidecar` /
 * `checkAppPermission` / `path-safety` 以及本轮所有修过的那几道闸**全部绕过**。
 * 顺带还能读宿主的 `localStorage`（设备身份、Tab 状态、配置）与整个 DOM。
 *
 * 去掉之后 MiniApp 拿到的是 opaque origin：`event.origin` 变成 `"null"`、
 * `window.parent.document` / `localStorage` 抛 SecurityError、Tauri IPC 不可达。
 * 代价是 `'self'` 不再匹配任何东西 —— 这正是下面 CSP 里把 `'self'` 一起去掉的
 * 原因，两处必须一起改，否则 CSP 会假装还有一个同源关系。
 */
const SANDBOX_FLAGS = 'allow-scripts allow-forms';
const IFRAME_NAME_PREFIX = 'miniapp-iframe';

/**
 * PRD v0.3 §11.1 — the iframe must not be able to reach the sidecar directly
 * ("Phase 2 防 iframe 直连旁路").
 *
 * 这里**没有** `'self'`，而且是刻意的：sandbox 不再给 `allow-same-origin`
 * （理由见 SANDBOX_FLAGS），iframe 拿到的是 opaque origin，CSP 规范下 `'self'`
 * 匹配不到任何来源 —— 留着它只会让人误以为 MiniApp 与宿主同源。
 *
 * MiniApp 的 `source/index.html` 会用 `<link rel="stylesheet" href="style.css">` /
 * `<script src="ui.js">` 引同目录文件，**曾经**靠 `'self'` 兜底。现在不需要了：
 * Rust 的 `inline_miniapp_siblings` 在把 HTML 交给渲染层之前就把这些兄弟文件
 * 内联掉，而凡是它内联不了的引用，今天**本来就是坏的** ——
 *   - 文件不存在 → 请求打到宿主 origin，那里不提供 MiniApp 资源，必然 404
 *   - `../` / `./` 段 → `read_inline_target` 明确拒绝，理由是 `starts_with` 逐段
 *     比较不规范化，`/a/b/../c` 仍以 `/a/b` 开头
 *   - 远程 URL → 不在 `dependencies` 里就已经被 `script-src` 挡住；声明了的走
 *     `injectDependencyTags` + `buildIframeCsp` 的显式 host 白名单，不依赖 `'self'`
 * 所以删掉 `'self'` 不会让任何原本能跑的 MiniApp 变成不能跑。
 *
 * `connect-src 'none'` 是真正干活的那条：sidecar 是另一个 origin，iframe 里的
 * fetch/XHR/WebSocket 一个都够不着。所有合法能力都走 postMessage。
 *
 * ponytail: `img-src https:` 是一条隐蔽的外传通道（URL 参数、beacon）。等
 * marketplace 开始上架第三方作者时收紧到 `data: blob:` —— 内建 app 用不到，
 * 但生成的 app 可能会用。
 */
const IFRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
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
    `script-src 'unsafe-inline' ${hosts}`,
    `style-src 'unsafe-inline' ${hosts}`,
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

  // 首屏 Theme Token：**冻结**在 srcDoc 里，不再随主题变化改写。
  //
  // 冻结是刻意的。`fullSrcDoc` 一变，React 就改 iframe 的 `srcDoc` 属性，iframe
  // 重载 —— 用户切一次主题/亮暗，MiniApp 里的状态就全丢。所以 token CSS 只在 mount
  // 时烤一次（首屏无 FOUC），之后的变更走下面的推送。
  //
  // `ponytail:` ceiling —— 若某个 MiniApp 在同一 mount 内依赖列表发生变化，
  // `fullSrcDoc` 会重算并重载 iframe，而烤进去的仍是 mount 时的 token。
  // 当前 `dependencies` / `permissions` 来自一次性加载的 meta.json，mount 内不变，
  // 所以这条路径走不到。要放开依赖热更新时，得同时让推送路径补发一次。
  const [themeCss] = useState(
    () => buildThemeTokenCss(readThemeTokens(), document.documentElement.dataset.colorScheme),
  );

  // 主题 / 亮暗变更 → 重算 token CSS 并推给 iframe（不重载文档）。
  //
  // `appearanceMode` 取 `dataset.colorScheme` 而不是 `env.appearanceMode` prop：
  // 它就是**产出这段 CSS 的那个值**，两者同源，`app.appearanceMode` 与作者看到的
  // 颜色不可能互相矛盾。ThemeRuntime 直接写 DOM，没有可依赖的 prop。
  useEffect(() => {
    // 只在真的变了才发。两个理由：换个 theme id 但 token 值一模一样时不值得惊动作者
    // （onAppearanceChange 会被打一遍，而他们无从分辨"换了主题"和"主题算出来没变"）；
    // 以及首帧那次 mutation 已由 srcDoc 承担，再推一遍是纯浪费。
    let lastPushed = themeCss;
    const push = () => {
      const appearanceMode = document.documentElement.dataset.colorScheme;
      const next = buildThemeTokenCss(readThemeTokens(), appearanceMode);
      if (next === lastPushed) return;
      lastPushed = next;
      iframeRef.current?.contentWindow?.postMessage(
        { kind: 'app.event', type: 'theme.change', appearanceMode, tokenCss: next },
        '*',
      );
    };
    const obs = new MutationObserver(push);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-id', 'data-color-scheme'],
    });
    return () => obs.disconnect();
  }, [themeCss]);

  // CDN 依赖先注入（进 `<head>`），再算 CSP —— 顺序反了 CSP 会按旧的无依赖
  // 版本算好、放宽的源就永远用不上。两步都只在声明了依赖时改变输出。
  // 双重过滤：schema 已经要求 https + net.allow，但 meta 是磁盘上的文件，
  // 可能被手工改过 —— 宿主不能假设上游一定校验过。`hostAllowed` 对非法 URL
  // 返回 false，所以走到这里的 url 必定可解析。
  const usableDeps = useMemo(
    () => (dependencies ?? []).filter((d) => hostAllowed(d.url, permissions?.net?.allow ?? [])),
    [dependencies, permissions],
  );

  // 拼 srcDoc：Theme `<style>` + CSP meta + `window.app` runtime + 用户 HTML
  //
  // runtime 必须排在用户 HTML 之前：`ui.js` 在解析期就可能调用 `app.*`，
  // 放后面会撞上 "Cannot read properties of undefined"。
  //
  // 两趟拼装：第一趟只为量出「runtime 结束 → 作者脚本开始」之间的行数，第二趟
  // 把它烤进 runtime，好让脚本错误横幅报 ui.js 的真实行号而不是拼装后文档的
  // 行号。偏移量写成单行整数，所以 `0` → `1090` 的替换不改变本段脚本行数，
  // 第一趟量到的值在第二趟依然成立 —— 这个不变量由
  // `buildAppRuntimeScript` 的参数注入方式保证。
  const fullSrcDoc = useMemo(() => {
    const assemble = (runtime: string): string =>
      `<style id="${THEME_TOKEN_STYLE_ID}">${themeCss}</style>\n${injectAppId(
        injectCsp(
          injectAppRuntime(injectDependencyTags(srcDoc, usableDeps), runtime),
          [...new Set(usableDeps.map((d) => new URL(d.url).host))],
        ),
        appId,
      )}`;
    const offset = countAuthorLineOffset(assemble(buildAppRuntimeScript(appId, 0)));
    return assemble(buildAppRuntimeScript(appId, offset));
  }, [appId, srcDoc, themeCss, usableDeps]);

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
      // 这里**不**做 `instanceof Window` 收窄：它不增加安全性 —— 真正的闸门是
      // `verifyAppCall` 里的 `source === iframe.contentWindow` 严格相等（MessagePort
      // 之类永远不等于 contentWindow，已经被挡掉了）。而它有实实在在的代价：iframe 的
      // contentWindow 在 jsdom 里是**另一个 realm** 的对象（实测 `instanceof` 恒为
      // false），于是这条通道在组件层一次都跑不通 —— 只能退回测三段各自的纯函数，
      // 而那种测法保不住"iframe 脚本发的形状"与"宿主 listener 认的形状"是否对得上
      // （`appDataWorkspace` 就是这么被一个硬写的 `null` 参数吞掉的，三段单测全绿）。
      const windowSource = (event.source ?? null) as Window | null;
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

  // 语言变更下发。`host.ready` 只在 iframe load 时发一次，发完 iframe 内的 `env`
  // 就冻结了。Theme 切换会顺带自愈：themeCss 变 → srcDoc 变 → iframe 重载 →
  // host.ready 重发。但语言切换不动 themeCss，也就不重载，于是 `app.t()` 永远
  // 返回首帧语言，而 `onLocaleChange` 在此之前连生产者都没有 —— 作者注册了
  // 监听也只能收到一个永远不会来的事件。
  //
  // 用 ref 记上次下发的值，而不是跳过首次的布尔量：iframe 因别的原因重载时
  // `host.ready` 会重新带上最新 locale，此时不该补发一条多余的 locale.change。
  const lastPushedLocaleRef = useRef(runtimeEnv.locale);
  useEffect(() => {
    if (lastPushedLocaleRef.current === runtimeEnv.locale) return;
    lastPushedLocaleRef.current = runtimeEnv.locale;
    iframeRef.current?.contentWindow?.postMessage(
      { kind: 'app.event', type: 'locale.change', locale: runtimeEnv.locale },
      '*',
    );
  }, [runtimeEnv.locale]);

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
 * CSP 是 `script-src 'unsafe-inline'`，所以内联 `<script>` 可执行。
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
