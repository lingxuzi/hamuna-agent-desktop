/**
 * 中国广电 Token 平台 — renderer 端薄壳。
 * 模型发现走 server 端 `/api/nxgd/models`（apiKey 永不出 server）。
 */
import { apiGetJson } from '@/api/apiFetch';
import { parseModelsResponse } from './modelDiscoveryService';
import type { DiscoveredModel } from './modelDiscoveryService';

interface NxgdModelsEnvelope {
  models: unknown;
  checkedAt?: number;
}

/** `discoverNxgdModels()` 的结构化返回：
 *  - `models`：发现的模型列表
 *  - `checkedAt`：undefined = 本次 fresh fetch；number = server 端上次成功时间（陈旧 fallback 路径）
 *
 *  陈旧 fallback = server 端 502 + 上次成功 cached，让 user 至少能看到模型列表
 *  但 UI 渲染 stale banner 告知「上次 N 秒前更新」。 */
export interface NxgdDiscoveryResult {
  models: DiscoveredModel[];
  checkedAt?: number;
}

/** 结构化错误 kind：
 *  - `rate-limit`：上游限流，retry 在 N 秒后（renderer 据 retryAfterSeconds 渲染倒计时提示）
 *  - `network`：其它网络错误 / 上游 5xx / 解析失败（renderer 渲染网络失败 + retry）
 */
export type NxgdDiscoveryErrorKind =
  | { kind: 'rate-limit'; retryAfterSeconds: number }
  | { kind: 'network'; message: string };

/** 结构化 Error：caller 可用 `instanceof NxgdDiscoveryError` + `err.detail.kind` 分流；
 *  老 caller（如 ModelManagementPanel）仍能从 `Error.message` 拿到人类可读字符串，
 *  `setDiscoveryError(err.message)` 兼容老路径。 */
export class NxgdDiscoveryError extends Error {
  readonly detail: NxgdDiscoveryErrorKind;
  constructor(detail: NxgdDiscoveryErrorKind) {
    super(NxgdDiscoveryError.formatMessage(detail));
    this.name = 'NxgdDiscoveryError';
    this.detail = detail;
  }
  private static formatMessage(d: NxgdDiscoveryErrorKind): string {
    if (d.kind === 'rate-limit') return `upstream rate-limited, retry in ${d.retryAfterSeconds}s`;
    return d.message;
  }
}

export interface NxgdAuthLite {
  status: 'idle' | 'registering' | 'registered' | 'error';
  registered: boolean;
  setup: boolean;
}

/** 读 server 端 nxgd auth 状态（用于 verifyStatus 信号源）。 */
export async function getNxgdAuthState(): Promise<NxgdAuthLite> {
  return apiGetJson<NxgdAuthLite>('/api/nxgd/auth/state');
}

/**
 * 调 `/api/nxgd/models` 拉广电可用模型。
 *
 * 返回类型 = `NxgdDiscoveryResult`：
 * - 200 → `{ models, checkedAt: <fresh> }`
 * - 429 (限流) → throw `NxgdDiscoveryError({ kind: 'rate-limit', retryAfterSeconds })`
 * - 502 (其它失败) + cached → `{ models: <上次成功缓存>, checkedAt: <上次成功时间> }`
 *   （让 caller 渲染 stale banner + 仍能展示 cached models；不 throw）
 * - 502 + 无缓存 / 解析失败 → throw `NxgdDiscoveryError({ kind: 'network', message })`
 *
 * 与 v1 silent cache fallback 的关键区别：
 * - v1 = silent 返 `[cached]`，user 不知情；现 = 返 `{ models, checkedAt }`，caller 据 checkedAt 渲染 stale banner
 */
export async function discoverNxgdModels(): Promise<NxgdDiscoveryResult> {
  try {
    const resp = await apiGetJson<NxgdModelsEnvelope>('/api/nxgd/models');
    const models = parseModelsResponse(resp.models);
    return { models, checkedAt: resp.checkedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // 限流：retryAfterSeconds 来自 server 端 envelope 字段。
    const retryMatch = /retryAfterSeconds["':\s]+(\d+)/.exec(msg);
    if (retryMatch) {
      throw new NxgdDiscoveryError({
        kind: 'rate-limit',
        retryAfterSeconds: Number(retryMatch[1]),
      });
    }

    // 502 + cached：返 stale-cache 形态（不 throw，让 caller 渲染 warning banner）。
    // server 端 envelope 现在透传 checkedAt（`/api/nxgd/models` 502 body 含 `checkedAt` 字段）。
    const cachedMatch = /"cached":\s*(\[.*?\])/.exec(msg);
    const checkedAtMatch = /"checkedAt":\s*(\d+)/.exec(msg);
    if (cachedMatch) {
      try {
        const cached = JSON.parse(cachedMatch[1]) as unknown;
        const parsed = parseModelsResponse(cached);
        if (parsed.length > 0) {
          return {
            models: parsed,
            checkedAt: checkedAtMatch ? Number(checkedAtMatch[1]) : undefined,
          };
        }
      } catch {
        // 缓存解析失败 → 落到下面的 network error 分支
      }
    }
    throw new NxgdDiscoveryError({ kind: 'network', message: msg || 'unknown' });
  }
}