/**
 * `window.app.*` 宿主派发实现。
 *
 * ## 派发按能力归属 owner，而不是"一律发 sidecar"
 *
 * | 能力族 | owner | 理由 |
 * |---|---|---|
 * | fs / shell / net / os / storage / ai / agent | sidecar | Node 侧的 fs、child_process、SDK |
 * | dialog / clipboard | renderer (Tauri) | OS 原生对话框与剪贴板，sidecar 进程**永远够不到** |
 * | call | worker 池 | 自定义代码必须跑在 `worker_threads` 沙箱里 |
 *
 * 把 dialog/clipboard 也发去 sidecar 只会得到一句"够不到"——那不是实现，是把
 * 缺陷伪装成错误码。它们在**发请求之前**就在这里被截走，走
 * `@tauri-apps/plugin-dialog` 与 `cmd_clipboard_*`。
 *
 * `appId` 用闭包绑定而不是模块级变量：多个 MiniApp Tab 可以同时打开，模块
 * 级可变状态会让后一个挂载的 appId 覆盖前一个，导致跨 app 越权。
 */

import { invoke } from '@tauri-apps/api/core';
import type { DialogFilter } from '@tauri-apps/plugin-dialog';

import { apiPostJson } from '@/api/apiFetch';
import { proxyFetch } from '@/api/tauriClient';

import { APP_ERROR_CODES, type AppErrorCode, type AppMethod } from '../../../shared/miniapp/app-protocol';
import { normalizeAppDataWorkspace } from '../../../shared/miniapp/app-data-workspace';
import type { AgentBridge, AgentSessionTarget } from './agentEventBridge';

interface DispatchResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: AppErrorCode; message: string };
}

type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: AppErrorCode; message: string } };

export type AppDispatcher = (method: AppMethod, params: unknown) => Promise<DispatchResult>;

function err(code: AppErrorCode, message: string): DispatchResult {
  return { ok: false, error: { code, message } };
}

export interface AppDispatcherOptions {
  /**
   * Agent 事件桥。`agent.ensureSession` / `agent.onEvent` 必须由 **renderer**
   * 回答：它们要起一个真实的 Sidecar 进程（Rust `cmd_miniapp_ensure_session`），
   * 而 sidecar 进程自己没法给自己起 sibling。缺省时这两个方法显式失败，
   * 而不是假装成功。
   */
  agentBridge?: AgentBridge;
}

/** 为某个 appId 绑定一个派发器。宿主侧已验证过身份，sidecar 侧会再校验一次。 */
export function createAppDispatcher(
  appId: string,
  options: AppDispatcherOptions = {},
): AppDispatcher {
  return async function dispatch(method, params) {
    try {
      if (method === 'call.call') {
        return await callWorkerMethod(appId, params);
      }
      // 原生能力在离开 renderer 前就地消化，不进 sidecar。
      if (method.startsWith('dialog.') || method.startsWith('clipboard.')) {
        return await dispatchNative(method, params);
      }
      // Agent session 生命周期同样归 renderer：它要 invoke Rust 起进程。
      if (method === 'agent.ensureSession' || method === 'agent.onEvent') {
        return await dispatchAgentHost(method, params, options.agentBridge);
      }
      // Agent **回合**必须发到上面那个专用 sidecar，而不是走下面的全局 sidecar。
      // 回合跑在哪个进程，决定了 SSE 事件和 abort 能不能命中同一个 turn。
      if (method === 'agent.run' || method === 'agent.turnText' || method === 'agent.cancel') {
        return await dispatchAgentTurn(appId, method, params, options.agentBridge);
      }
      const res = await apiPostJson<DispatchResponse>(`/api/miniapp/app/${method}`, {
        appId,
        params: params ?? null,
      });
      if (res.ok) return { ok: true, result: res.result };
      return {
        ok: false,
        error: res.error ?? { code: APP_ERROR_CODES.HOST_ERROR, message: 'dispatch failed' },
      };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: APP_ERROR_CODES.NETWORK_ERROR,
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  };
}

async function dispatchAgentHost(
  method: string,
  params: unknown,
  bridge: AgentBridge | undefined,
): Promise<DispatchResult> {
  if (!bridge) {
    return err(
      APP_ERROR_CODES.HOST_ERROR,
      'app.agent session control is unavailable: the host did not provide an agent bridge',
    );
  }
  const p = asRecord(params);
  const runId = typeof p.run_id === 'string' && p.run_id ? p.run_id : 'main';
  // 参考文档给的是 `session.sessionId`（camelCase），本项目内部一路 snake_case。
  // 两个键都返回：作者照文档读 sessionId 才不会拿到 undefined，而读
  // session_id 的既有 MiniApp 不受影响。
  const sessionResult = (sessionId: string, appDataWorkspace?: string | null) => ({
    session_id: sessionId,
    sessionId,
    // 只在 ensureSession 上出现。`agent.onEvent` 没有这个入参，硬塞一个恒为
    // null 的字段进去只是让它的返回形状无谓地变一次。
    ...(appDataWorkspace === undefined ? {} : { app_data_workspace: appDataWorkspace }),
  });
  if (method === 'agent.ensureSession') {
    // 参考文档把 `appDataWorkspace` 放在 ensureSession 上。本项目的 Agent cwd 是
    // 进程级 `--agent-dir`，SDK 子进程 spawn 时读一次，所以这个选择**必须**跟着
    // ensure 一起走 —— 它决定建出来的 session 跑在哪个目录，不能等到 run 再补。
    //
    // 仍然要在这里**校验**：这个分支在 renderer 里就地截走了，请求根本不会到
    // sidecar。放任参数被吞掉的话，作者会以为挑了子目录，实际下一个 run 静默
    // 跑在 appdata 根上 —— 正是本文件其它地方反复在防的"传了但被忽略"。
    // 判定用 shared 里那一份纯函数，与 sidecar、Rust 三处同规则。
    const raw = p.appDataWorkspace;
    const workspace = normalizeAppDataWorkspace(raw);
    if (!workspace.ok) {
      return err(APP_ERROR_CODES.INVALID_PARAMS, workspace.reason);
    }
    // undefined = 作者没表达偏好 → bridge 用现有 session 的 workspace（或建在根上）；
    // 显式字符串（含 `''`，即"我要 appdata 根"）= 一条会被校验的请求。
    const requested = raw === undefined || raw === null ? undefined : workspace.segment;
    try {
      const target = await bridge.ensureSession(runId, requested);
      // 回显必须**说真话**：没有偏好时回显这个 session 实际待着的目录，而不是
      // 假装作者挑的 `''` 生效了。bridge 建的 session 就是唯一那个。
      return {
        ok: true,
        result: sessionResult(target.sessionId, requested ?? null),
      };
    } catch (e) {
      return err(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
    }
  }
  // `agent.onEvent(fn)` 订阅的是 runtime 侧的本地 `agent` channel —— 事件由
  // host 经 `app.event` postMessage 推入，**不经过 dispatch**。dispatch 在这里
  // 只负责把流式通道拉起来：作者注册监听时通常也期待 session 与 SSE 已就绪，
  // 否则 `subscribe` 永远没有生产者，就成了"暴露给作者却收不到事件"的空壳。
  try {
    const target = await bridge.ensureSession(runId);
    void bridge.subscribe(runId, () => undefined).catch(() => undefined);
    return { ok: true, result: sessionResult(target.sessionId) };
  } catch (e) {
    return err(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
  }
}

/**
 * `agent.run` / `agent.turnText` / `agent.cancel` —— 发到 MiniApp 自己的 sidecar。
 *
 * ## 为什么不能走默认的全局 sidecar
 *
 * sidecar 侧 `runMiniAppAgentTurn` 用的是 **本进程** 的
 * `getCurrentSessionContext().sessionId`。发到全局 sidecar 意味着：
 *
 * 1. 回合跑进**用户的全局会话** —— MiniApp（第三方代码）的提示词与产出写进
 *    用户自己的聊天历史，这是隔离失效，不只是"流式不工作"；
 * 2. `chat:message-chunk` 发在全局 sidecar 的 SSE 上，而 bridge 订阅的是专用
 *    sidecar 的 SSE → `agent.onEvent` 永远收不到任何事件；
 * 3. `stopOwnedTurn` 的 abort registry 是进程内状态，`agent.cancel` 发到全局
 *    sidecar 会报"停不下"，而作者已经收到过一次 run，看起来像竞态。
 *
 * 三条同源：`ensureSession` 建的会话必须就是 `run` 执行的会话。
 */
async function dispatchAgentTurn(
  appId: string,
  method: string,
  params: unknown,
  bridge: AgentBridge | undefined,
): Promise<DispatchResult> {
  if (!bridge) {
    return err(
      APP_ERROR_CODES.HOST_ERROR,
      'app.agent is unavailable: the host did not provide an agent bridge',
    );
  }
  const p = asRecord(params);
  const runId = typeof p.run_id === 'string' && p.run_id ? p.run_id : 'main';
  // `run` 也可能先于 `ensureSession` 成为**第一个**用到 Agent 的调用。若不把
  // workspace 一起带去建 session，那个 session 就会固定在 appdata 根上，之后
  // 作者再 `ensureSession({appDataWorkspace})` 也搬不动（bridge 会明确报错）。
  //
  // 但 `agent.cancel` 不参与这件事：它只瞄准一个已有的 turn，既不建 session 也不该
  // 关心 workspace。带一条校验进来会让"这个 app 挑过子目录"之后**所有 cancel 都
  // 失败** —— 一个纯属自伤的限制。
  //
  // `requested` 保留"作者没表达偏好"这层意思：归一函数把 undefined 与显式空串都
  // 收敛成 `''`，而这两者对 bridge 的含义不同（前者 = 用现有的，后者 = 我要根）。
  let requested: string | undefined;
  if (method !== 'agent.cancel') {
    const raw = p.appDataWorkspace;
    const workspace = normalizeAppDataWorkspace(raw);
    if (!workspace.ok) {
      return err(APP_ERROR_CODES.INVALID_PARAMS, workspace.reason);
    }
    requested = raw === undefined || raw === null ? undefined : workspace.segment;
  }
  let target: AgentSessionTarget;
  try {
    target = await bridge.ensureSession(runId, requested);
  } catch (e) {
    return err(APP_ERROR_CODES.HOST_ERROR, e instanceof Error ? e.message : String(e));
  }
  try {
    const res = await proxyFetch(`http://127.0.0.1:${target.port}/api/miniapp/app/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, params: p }),
    });
    const payload = (await res.json().catch(() => ({}))) as DispatchResponse;
    if (payload.ok) return { ok: true, result: payload.result };
    return {
      ok: false,
      error: payload.error ?? { code: APP_ERROR_CODES.HOST_ERROR, message: 'agent dispatch failed' },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: APP_ERROR_CODES.NETWORK_ERROR,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * dialog / clipboard —— Tauri 原生能力。
 *
 * 懒加载 plugin：它在浏览器开发模式（`start_dev.sh`）下没有 Tauri 后端，
 * 顶层静态 import 会在该模式下直接抛 "invoke is not a function"，
 * 连带整个 MiniApp 面板打不开。动态 import 让"没有原生能力"降级成一条
 * 可读错误，而不是白屏。
 */
async function dispatchNative(method: string, params: unknown): Promise<DispatchResult> {
  const p = asRecord(params);
  try {
    if (method.startsWith('dialog.')) return await dispatchDialog(method.slice(7), p);
    if (method.startsWith('clipboard.')) return await dispatchClipboard(method.slice(10), p);
    return err(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown native method '${method}'`);
  } catch (e) {
    // Tauri 在浏览器模式下不存在：给作者一句能照着改的话，而不是原始栈。
    return err(
      APP_ERROR_CODES.HOST_ERROR,
      `native capability unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

type DialogSpec = Record<string, unknown>;

/**
 * 把 MiniApp 作者写的宽松 filter 形态收敛成 Tauri 的 `DialogFilter`。
 *
 * 显式只保留 `name` / `extensions` 两个键：直接把 `Record<string, string[]>`
 * 断言成 `DialogFilter` 会让任意额外键混进 IPC 载荷，而 Tauri 侧的 schema 校验
 * 并不严格 —— 少写一个键是运行时才炸，多写一个键则可能触发上游的非预期分支。
 */
function pickFilters(spec: DialogSpec): DialogFilter[] {
  const raw = Array.isArray(spec.filters) ? spec.filters : [];
  const out: DialogFilter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const f = entry as DialogSpec;
    if (typeof f.name !== 'string') continue;
    out.push({
      name: f.name,
      extensions: Array.isArray(f.extensions)
        ? f.extensions.filter((e): e is string => typeof e === 'string')
        : [],
    });
  }
  return out;
}

/**
 * 起始路径：SKILL.md 教作者写 `defaultPath`（与 Tauri 原生同名），而本文件早期
 * 实现读的是 snake_case 的 `default_path` —— 两种拼法都真实存在：一种被文档化、
 * 一种被实现且被测试钉住。逐键丢一个不报错、只是静默失效（对话框照常打开，只是不
 * 在作者指定的位置），所以这里两种都收，而不是逼作者记住该用哪套命名。
 * snake_case 优先，保持既有行为不变。
 */
function pickDefaultPath(spec: DialogSpec): string | undefined {
  if (typeof spec.default_path === 'string') return spec.default_path;
  if (typeof spec.defaultPath === 'string') return spec.defaultPath;
  return undefined;
}

async function dispatchDialog(name: string, p: DialogSpec): Promise<DispatchResult> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  switch (name) {
    case 'open': {
      // 取消返回 null 是 Tauri 的约定，透传 null 而非转成错误：用户主动取消
      // 是一个正常结果，抛错会逼作者写 try/catch 吞掉本属正常的状态。
      const picked = await dialog.open({
        multiple: p.multiple === true,
        directory: p.directory === true,
        title: typeof p.title === 'string' ? p.title : undefined,
        defaultPath: pickDefaultPath(p),
        filters: pickFilters(p),
      });
      return { ok: true, result: picked ?? null };
    }
    case 'save': {
      const target = await dialog.save({
        title: typeof p.title === 'string' ? p.title : undefined,
        defaultPath: pickDefaultPath(p),
        filters: pickFilters(p),
      });
      return { ok: true, result: target ?? null };
    }
    case 'message': {
      const text = typeof p.message === 'string' ? p.message : '';
      if (!text) return err(APP_ERROR_CODES.INVALID_PARAMS, 'dialog.message requires a message');
      // `kind` 决定用哪个原生 API：'confirm' 走 ask()（Yes/No 按钮），
      // 其余走 message()（单 Ok 按钮）。confirm 单独取值而不是并入 kind，
      // 因为 Tauri 的 MessageDialogKind 里并没有 confirm 这一档。
      if (p.kind === 'confirm') {
        const confirmed = await dialog.ask(text, {
          title: typeof p.title === 'string' ? p.title : undefined,
          kind: 'warning',
        });
        return { ok: true, result: { confirmed } };
      }
      const kind = p.kind === 'warning' || p.kind === 'error' ? p.kind : 'info';
      await dialog.message(text, {
        title: typeof p.title === 'string' ? p.title : undefined,
        kind,
      });
      return { ok: true, result: { confirmed: null } };
    }
    default:
      return err(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown dialog method '${name}'`);
  }
}

async function dispatchClipboard(name: string, p: DialogSpec): Promise<DispatchResult> {
  switch (name) {
    case 'readText': {
      const text = await invoke<string>('cmd_clipboard_read_text');
      return { ok: true, result: text };
    }
    case 'writeText': {
      const text = p.text;
      if (typeof text !== 'string') {
        return err(APP_ERROR_CODES.INVALID_PARAMS, 'clipboard.writeText requires a string');
      }
      await invoke('cmd_clipboard_write_text', { text });
      return { ok: true, result: null };
    }
    default:
      return err(APP_ERROR_CODES.UNKNOWN_METHOD, `Unknown clipboard method '${name}'`);
  }
}

/**
 * `app.call(method, params)` → worker 池 RPC。
 *
 * 与框架原语分开走：`app.fs.*` 这类不需要 Node 运行时（对齐 OpenBitFun 的
 * "无 Node 模式"），而自定义方法必须跑在 `worker_threads` 沙箱里，生命周期由
 * MiniAppRunner 的 spawn effect 管理。
 *
 * workerId 从注册表按 appId 取，而不是这里新建 —— 同一个 iframe 的所有
 * `app.call` 必须命中同一个 worker 实例，否则每次调用都 spawn 一个孤儿进程。
 */
const workerIdsByApp = new Map<string, string>();

export function registerWorkerId(appId: string, workerId: string): void {
  workerIdsByApp.set(appId, workerId);
}

export function clearWorkerId(appId: string): void {
  workerIdsByApp.delete(appId);
}

async function callWorkerMethod(appId: string, params: unknown): Promise<DispatchResult> {
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const method = typeof p.method === 'string' ? p.method : '';
  if (!method) {
    return err(APP_ERROR_CODES.INVALID_PARAMS, 'app.call requires a method name');
  }
  const workerId = workerIdsByApp.get(appId);
  if (!workerId) {
    return err(
      APP_ERROR_CODES.HOST_ERROR,
      'app.call requires a running worker. Set meta.kind = "worker" and meta.worker_kind, then reload.',
    );
  }
  const res = await apiPostJson<DispatchResponse>('/api/miniapp/worker/call', {
    workerId,
    method,
    params: p.params ?? null,
  });
  if (res.ok) return { ok: true, result: res.result };
  return {
    ok: false,
    error: res.error ?? { code: APP_ERROR_CODES.HOST_ERROR, message: 'worker call failed' },
  };
}
