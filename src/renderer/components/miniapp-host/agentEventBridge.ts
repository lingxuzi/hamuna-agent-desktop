/**
 * `app.agent.onEvent` 的真实生产者。
 *
 * ## 为什么事件源是 renderer 而不是 sidecar
 *
 * MiniApp 的 iframe 就在 renderer 里。让 sidecar 再开一条 SSE、再想办法把事件
 * 推给 renderer、renderer 再 postMessage 给 iframe —— 这条链路上多出一个连接
 * 生命周期要管，而 iframe 侧完全看不出这层间接。
 *
 * 关键事实让这件事变得干净：MiniApp 的 Agent 跑在**自己的 sidecar 进程**里
 * （Rust `cmd_miniapp_ensure_session` 为每个 `miniapp_<appId>_<runId>` 起 1:1
 * Sidecar）。因此 `SseConnection` 只要用那个 sessionId 去订阅，收到的
 * `chat:message-chunk` 就**天然只属于这个 MiniApp**，不需要任何过滤。
 *
 * ## 生命周期
 *
 * 订阅是**懒建立**的：只有 MiniApp 真的调了 `onEvent(fn)` 或
 * `agent.ensureSession()` 才起 session。理由是 Agent session = 一个真实的
 * Node 进程，为一个从不使用 Agent 的 MiniApp 常驻一个进程是纯浪费
 * （CLAUDE.md Sidecar Owner 模型的核心约束：资源随 owner 释放）。
 */

import { invoke } from '@tauri-apps/api/core';

import { createSseConnection, type SseConnection } from '@/api/SseConnection';

interface EnsureOutcome {
  session_id: string;
  port: number;
  owner_id: string;
}

/** 推给 iframe 的 agent 事件负载。 */
export interface AgentEventPayload {
  type: 'agent.delta' | 'agent.complete' | 'agent.stopped' | 'agent.error';
  text?: string;
  runId?: string;
}

export interface AgentBridge {
  /**
   * 注入「把事件送进 iframe」的转发器。由 owner（MiniAppRunner）在 commit 后
   * 调用，因为它的实现必须读 `iframeRef.current` / `nonceRef.current`，而
   * bridge 的构造发生在 render 期间 —— react-hooks/refs 不允许把 ref 以任何
   * 形式（直接传、包一层、包两层）交给渲染期调用的工厂。改成 setter 注入后，
   * 工厂彻底不碰 ref，规则与真实时序（事件只在 commit 之后到达）对齐。
   */
  setPost(post: (payload: AgentEventPayload) => void): void;
  /** 确保 Agent session 存在，返回 sessionId。幂等。 */
  ensureSession(runId: string): Promise<string>;
  /** 订阅流式事件。返回退订函数。 */
  subscribe(runId: string, handler: (payload: AgentEventPayload) => void): Promise<() => void>;
  /** 释放 session + 断开 SSE。 */
  release(): Promise<void>;
}

export interface AgentBridgeDeps {
  appId: string;
}

/**
 * 每个 MiniApp runner 一个实例。
 *
 * `runId` 固定为 `'main'`：一个 iframe = 一个 Agent 会话。作者想并发多轮就用
 * `turnText` 接上下文，而不是开多个 run —— 多 run 会各自起一个 Node 进程，
 * 而 MiniApp 的 `agent.workspace_scope` 又把工作区锁在同一个 appdata 下，
 * 并发 run 之间会互相踩文件。
 */
const DEFAULT_RUN_ID = 'main';

export function createAgentBridge(deps: AgentBridgeDeps): AgentBridge {
  let sessionId: string | null = null;
  let sse: SseConnection | null = null;
  let pending: Promise<string> | null = null;
  const handlers = new Set<(payload: AgentEventPayload) => void>();
  // owner 通过 setPost 注入。未注入时是 no-op 而不是 throw：bridge 可能比
  // owner 的 effect 先被调用（ensureSession 由 capability dispatch 触发），
  // 那种时刻 iframe 确实还不该收事件，静默丢弃是正确的。
  let post: (payload: AgentEventPayload) => void = () => {};
  // 刻意用普通对象而不是 React 的 `createRef` —— 后者只在 class 组件里成立，
  // 且不接受初始值。这里需要的只是"一个可变的 current 盒子"给 SseConnection
  // 读（它靠 ref 拿到 sessionId 后再去查端口）。
  const sessionIdRef: { current: string | null } = { current: null };

  function emit(payload: AgentEventPayload): void {
    // 没有监听者就什么都不做 —— 包括不推 iframe。
    // 早先的实现在 handlers 清空后仍无条件 `deps.post(payload)`，于是作者
    // 退订之后事件仍源源不断灌进 iframe：订阅已经不存在，iframe 却还在收。
    // 顺带也让 SSE 断开后残留的 in-flight 事件有了去处。
    if (handlers.size === 0) return;
    // 先本地派发再推 iframe：iframe 还没 ready 时本地监听器仍能收到，
    // 事件不会因为 postMessage 的时序而凭空消失。
    for (const fn of handlers) {
      try {
        fn(payload);
      } catch (e) {
        console.error('[agentBridge] handler failed', e);
      }
    }
    post(payload);
  }

  async function doEnsure(): Promise<string> {
    const outcome = await invoke<EnsureOutcome>('cmd_miniapp_ensure_session', {
      appId: deps.appId,
      runId: DEFAULT_RUN_ID,
    });
    sessionId = outcome.session_id;
    sessionIdRef.current = outcome.session_id;
    return outcome.session_id;
  }

  function ensureSse(): SseConnection | null {
    if (sse || !sessionIdRef.current) return sse;
    // connectionId 只用于 Tauri 事件路由与 stop_sse_proxy 的键，用 sessionId
    // 保证同一 session 不会起两条代理。
    sse = createSseConnection(sessionIdRef.current, sessionIdRef);
    sse.setEventHandler((eventName, data) => {
      switch (eventName) {
        case 'chat:message-chunk':
          // chunk 是裸字符串 delta
          if (typeof data === 'string' && data) {
            emit({ type: 'agent.delta', text: data, runId: DEFAULT_RUN_ID });
          }
          break;
        case 'chat:message-complete':
          emit({ type: 'agent.complete', runId: DEFAULT_RUN_ID });
          break;
        case 'chat:message-stopped':
          emit({ type: 'agent.stopped', runId: DEFAULT_RUN_ID });
          break;
        case 'chat:message-error':
          emit({
            type: 'agent.error',
            text: typeof data === 'string' ? data : 'agent turn failed',
            runId: DEFAULT_RUN_ID,
          });
          break;
        default:
          // 其余 chat:* 事件（thinking / plan / context-usage）与 MiniApp 作者
          // 无关，不转发 —— 转过去只会污染他注册的那个高频通道。
          break;
      }
    });
    return sse;
  }

  // `runId` 恒为 DEFAULT_RUN_ID（见上方说明），保留参数是为了让 interface
  // 与 dispatch 侧的签名一致；这里显式忽略而不是留一个未用参数给 lint 报。
  async function ensureSession(_runId: string): Promise<string> {
    if (sessionId) return sessionId;
    // 并发去重：iframe 里连着调两次 ensureSession 不该起两个 Node 进程。
    pending ??= doEnsure().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    setPost(fn) {
      post = fn;
    },
    async ensureSession(runId: string) {
      const id = await ensureSession(runId);
      if (handlers.size > 0) void ensureSse()?.connect().catch(() => {
        // SSE 起不来不该让 ensureSession 失败：作者仍可用 run() 拿终态文本，
        // 只是没有流式。静默降级好过整个 Agent 能力不可用。
      });
      return id;
    },

    async subscribe(runId, handler) {
      handlers.add(handler);
      await ensureSession(runId);
      const conn = ensureSse();
      if (conn && !conn.isConnected()) {
        try {
          await conn.connect();
        } catch (e) {
          console.error('[agentBridge] SSE connect failed', e);
        }
      }
      return () => {
        handlers.delete(handler);
        // 最后一个监听者离开就断开：SSE 是长连接，留着会一直占着 sidecar 的
        // 一个 client 槽位。session 本身留给 ensureSession 复用。
        if (handlers.size === 0 && sse) {
          void sse.disconnect().catch(() => undefined);
        }
      };
    },

    async release() {
      handlers.clear();
      if (sse) {
        await sse.disconnect().catch(() => undefined);
        sse = null;
      }
      if (sessionId) {
        await invoke('cmd_miniapp_release_session', {
          appId: deps.appId,
          runId: DEFAULT_RUN_ID,
        }).catch(() => undefined);
        sessionId = null;
        sessionIdRef.current = null;
      }
    },
  };
}
