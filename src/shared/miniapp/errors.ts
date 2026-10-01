/**
 * MiniApp 错误码 envelope（PRD v0.4 §B.1 #3 + PRD v0.3 §8）。
 * 镜像 `src/shared/agent-protocol/error-codes.ts` 模式，禁止并行错误码表。
 *
 * Phase 0 子集：fs/shell/net/ai 4 类 + schema/path/error 3 类。Phase 2 再补
 * node/agent/chat/worker 4 类。
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