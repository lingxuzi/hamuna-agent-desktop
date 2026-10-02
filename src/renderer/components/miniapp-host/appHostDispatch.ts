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

import { APP_ERROR_CODES, type AppMethod } from '../../../shared/miniapp/app-protocol';

interface DispatchResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export type AppDispatcher = (method: AppMethod, params: unknown) => Promise<DispatchResult>;

function err(code: string, message: string): DispatchResult {
  return { ok: false, error: { code, message } };
}

/** 为某个 appId 绑定一个派发器。宿主侧已验证过身份，sidecar 侧会再校验一次。 */
export function createAppDispatcher(appId: string): AppDispatcher {
  return async function dispatch(method, params) {
    try {
      if (method === 'call.call') {
        return await callWorkerMethod(appId, params);
      }
      // 原生能力在离开 renderer 前就地消化，不进 sidecar。
      if (method.startsWith('dialog.') || method.startsWith('clipboard.')) {
        return await dispatchNative(method, params);
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
        defaultPath: typeof p.default_path === 'string' ? p.default_path : undefined,
        filters: pickFilters(p),
      });
      return { ok: true, result: picked ?? null };
    }
    case 'save': {
      const target = await dialog.save({
        title: typeof p.title === 'string' ? p.title : undefined,
        defaultPath: typeof p.default_path === 'string' ? p.default_path : undefined,
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
