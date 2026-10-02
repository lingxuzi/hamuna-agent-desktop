/**
 * MiniApp `window.app.*` runtime 协议（对齐 OpenBitFun `miniapp-dev` 设计）。
 *
 * 为什么有这一层：本项目原先只有 `worker.call` / `chat.claimComposer` 两个
 * 私有 postMessage 协议，MiniApp 作者（尤其是 AI）没有任何稳定 API 可依赖
 * —— `window.__miniappStorage` 这类指引在 `src/` 里根本没有实现。OpenBitFun
 * 的做法是把全部宿主能力收敛到 iframe 内的单一全局 `window.app`，作者只认
 * 这一个契约。
 *
 * 传输形态：iframe 侧注入的 runtime 脚本把 `app.fs.readFile(...)` 之类的调用
 * 编码成 `{kind:'app.call', nonce, id, payload:{method, params}}`，宿主验证后
 * 执行，回应 `{kind:'app.result', nonce, id, ok, result|error}`。与
 * `workerCallBridge.ts` 同构的 request/response + 单一 nonce 信任模型。
 *
 * 本文件是**纯协议定义**（无 I/O、无 DOM、无进程特定 API），因此放在
 * `src/shared/`：runtime 注入脚本以字符串形式消费它，宿主侧 bridge 也消费
 * 它，两边共用一份 method 名单，避免"文档写了但宿主没实现"再次发生。
 *
 * 方法名用点分命名空间（`'fs.readFile'`）而非嵌套对象字面量，是为了让
 * allow-list 检查退化成一次 `Set.has()`，并且错误方法名能被原样回传给作者
 * 便于排错。
 */

/** 宿主已实现的方法。宿主收到名单外的方法一律拒绝（fail-closed）。 */
export const APP_METHODS = {
  fs: [
    'readFile',
    'writeFile',
    'appendFile',
    'readdir',
    'mkdir',
    'rm',
    'rmdir',
    'stat',
    'lstat',
    'access',
    'unlink',
    'copyFile',
    'rename',
  ],
  shell: ['exec'],
  net: ['fetch'],
  os: ['info'],
  storage: ['get', 'set', 'remove'],
  dialog: ['open', 'save', 'message'],
  clipboard: ['readText', 'writeText'],
  /** 宿主 AI（复用宿主 Provider，无需 MiniApp 自带 Key）。 */
  ai: ['complete', 'chat', 'cancel', 'getModels'],
  /** MiniApp 自有隐藏 Agent 会话。 */
  agent: ['ensureSession', 'run', 'turnText', 'cancel', 'onEvent'],
  /** 自定义 worker 方法；`node.enabled !== true` 时宿主显式报错。 */
  call: ['call'],
} as const;

export type AppMethodGroup = keyof typeof APP_METHODS;

/** 点分方法名，如 `'fs.readFile'`。 */
export type AppMethod = string;

const ALL_METHODS: ReadonlySet<string> = new Set(
  Object.entries(APP_METHODS).flatMap(([group, names]) => names.map((n) => `${group}.${n}`)),
);

/** 该方法名是否在宿主实现名单内。 */
export function isKnownAppMethod(method: string): boolean {
  return ALL_METHODS.has(method);
}

/** 列出全部方法名（供测试与文档同步守卫使用）。 */
export function listAppMethods(): readonly string[] {
  return [...ALL_METHODS];
}

export const APP_CALL_KIND = 'app.call';
export const APP_RESULT_KIND = 'app.result';

export interface AppCallPayload {
  method: AppMethod;
  params: unknown;
  /** 绑定到本 iframe 的 appId，防冒用兄弟 MiniApp 的通道。 */
  appId: string;
}

export interface AppCallMessage {
  kind: typeof APP_CALL_KIND;
  nonce: string;
  /** 每次调用唯一；宿主原样回传，用于 iframe 侧配对 Promise。 */
  id: string;
  payload: AppCallPayload;
}

export interface AppResultMessage {
  kind: typeof APP_RESULT_KIND;
  nonce: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * 错误码。`E_*` 是宿主拒绝（权限不足 / 方法未知 / 路径越界），
 * `NETWORK_ERROR` 是宿主自身调用失败 —— 作者据此区分"我权限不够"和
 * "宿主故障"，不要笼统重试。
 */
export const APP_ERROR_CODES = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  INVALID_PARAMS: 'INVALID_PARAMS',
  HOST_ERROR: 'HOST_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

export interface PostMessageEnvelope {
  /** 收窄为 `Window`：iframe postMessage 恒为 Window 来源。 */
  source: Window | null;
  origin: string;
  data: unknown;
}

function parseCallEnvelope(data: unknown): AppCallMessage | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.kind !== 'string' || rec.kind !== APP_CALL_KIND) return null;
  if (typeof rec.nonce !== 'string' || typeof rec.id !== 'string') return null;
  if (!rec.payload || typeof rec.payload !== 'object') return null;
  const payload = rec.payload as Record<string, unknown>;
  if (typeof payload.method !== 'string' || typeof payload.appId !== 'string') return null;
  return {
    kind: APP_CALL_KIND,
    nonce: rec.nonce,
    id: rec.id,
    payload: { method: payload.method, params: payload.params, appId: payload.appId },
  };
}

/**
 * 纯判定：这条消息是不是来自本 iframe 的合法 `app.*` 调用。
 *
 * 四条信任规则，缺一不可（与 `workerCallBridge.verifyWorkerCall` 同构）：
 *   1. `event.source === iframe.contentWindow` 严格相等
 *   2. nonce 与本次会话一致（宿主铸造，iframe 无法自造）
 *   3. appId 与本 iframe 绑定的 appId 一致
 *   4. method 在宿主实现名单内
 *
 * 任一不满足返回 null（调用方静默丢弃）。
 */
export function verifyAppCall(
  envelope: PostMessageEnvelope,
  iframeContentWindow: HTMLIFrameElement['contentWindow'] | null,
  expectedNonce: string,
  boundAppId: string,
): AppCallMessage | null {
  if (!iframeContentWindow || envelope.source !== iframeContentWindow) return null;
  const parsed = parseCallEnvelope(envelope.data);
  if (!parsed) return null;
  if (parsed.nonce !== expectedNonce) return null;
  if (parsed.payload.appId !== boundAppId) return null;
  if (!isKnownAppMethod(parsed.payload.method)) return null;
  return parsed;
}

/** 构造回应信封。`id` 关联请求，`nonce` 让 iframe 验证来源。 */
export function buildAppResult(
  expectedNonce: string,
  id: string,
  result: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } },
): AppResultMessage {
  return {
    kind: APP_RESULT_KIND,
    nonce: expectedNonce,
    id,
    ...(result.ok
      ? { ok: true, result: result.result }
      : { ok: false, error: result.error }),
  };
}
