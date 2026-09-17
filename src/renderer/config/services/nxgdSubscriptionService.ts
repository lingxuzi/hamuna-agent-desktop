/**
 * 中国广电 Token 平台 — renderer 端薄壳。
 * 模型发现走 server 端 `/api/nxgd/models`（apiKey 永不出 server）。
 */
import { apiGetJson } from '@/api/apiFetch';
import { parseModelsResponse } from './modelDiscoveryService';
import type { DiscoveredModel } from './modelDiscoveryService';

interface NxgdModelsEnvelope {
  models: unknown;
  checkedAt: number;
}

/**
 * 调 `/api/nxgd/models` 拉广电可用模型。
 *
 * - 200 → 正常返回解析后的模型列表
 * - 429 → 上游限流，server 端已进入冷却期；throw 带「N 秒后重试」错误
 * - 502 → 其它失败（401/500 等），如果 server 端有上次成功缓存会一并透传
 */
export async function discoverNxgdModels(): Promise<DiscoveredModel[]> {
  try {
    const resp = await apiGetJson<NxgdModelsEnvelope>('/api/nxgd/models');
    return parseModelsResponse(resp.models);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 429：限流 → 提取 retryAfterSeconds
    const retryMatch = /retryAfterSeconds["':\s]+(\d+)/.exec(msg);
    if (retryMatch) {
      throw new Error(`上游限流，${retryMatch[1]} 秒后重试`);
    }
    // 502 包含 cached：降级返回上次成功缓存（让用户至少能看到模型列表）
    const cachedMatch = /"cached":\s*(\[.*?\])/.exec(msg);
    if (cachedMatch) {
      try {
        const cached = JSON.parse(cachedMatch[1]) as unknown;
        const parsed = parseModelsResponse(cached);
        if (parsed.length > 0) return parsed;
      } catch {
        // 缓存解析失败 → 抛原错误
      }
    }
    throw err;
  }
}