/**
 * `meta.json` 校验错误码（PRD v0.4 §B.1 #3 + PRD v0.3 §8）。
 * 镜像 `src/shared/agent-protocol/error-codes.ts` 的形态。
 *
 * ## 这**不是** `window.app.*` 的运行时错误码表
 *
 * 运行时 envelope 的唯一权威是 `app-protocol.ts::APP_ERROR_CODES`
 * （`PERMISSION_DENIED` / `UNKNOWN_METHOD` / `INVALID_PARAMS` / `HOST_ERROR` /
 * `NETWORK_ERROR`）。作者在 `catch` 里拿到的是**那些**码，不是这里的 `E_*`。
 *
 * 本文件此前把头注释写成"MiniApp 错误码 envelope"，并同时声明"禁止并行错误码表"
 * —— 而它自己就是那张并行表，且下面 10 个码里只有 `E_SCHEMA_INVALID` 有真实
 * 生产者（`meta-schema.ts`）。读到这里的人会以为作者契约是 `E_PERMISSION_DENIED`，
 * 于是按错误的码写 `catch` 分支，而宿主发的是 `PERMISSION_DENIED`，分支永不命中。
 *
 * 运行时那一侧现在由类型兜住：`miniapp-app-dispatch.ts` / `miniapp-ai.ts` /
 * `miniapp-agent.ts` 三个 `fail()` 的 code 参数都是 `AppErrorCode`，写错一个码
 * 编译期就红，不需要靠注释维持纪律。
 *
 * 下面除 `E_SCHEMA_INVALID` 外都没有生产者 —— 它们是留给 meta 校验细分用的，
 * **不要**当成作者可见的契约。
 */

export type MiniAppErrorCode =
  | 'E_PERMISSION_DENIED'
  | 'E_PATH_DENIED'
  | 'E_SHELL_DENIED'
  | 'E_NET_DENIED'
  | 'E_AI_DENIED'
  | 'E_SCHEMA_INVALID'
  | 'E_INCOMPATIBLE_HOST'
  | 'E_NOT_FOUND'
  | 'E_INVALID_ARGS'
  | 'E_INTERNAL';

export interface MiniAppError {
  code: MiniAppErrorCode;
  message: string;
  detail?: unknown;
}

export type MiniAppResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: MiniAppError };

export function ok<T>(result: T): MiniAppResponse<T> {
  return { ok: true, result };
}

export function err(
  code: MiniAppErrorCode,
  message: string,
  detail?: unknown,
): MiniAppResponse<never> {
  return { ok: false, error: { code, message, detail } };
}
