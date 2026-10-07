/**
 * MiniApp 的模型供应商解析 —— 纯函数，零 I/O、零模块级状态。
 *
 * ## 为什么单独一个文件
 *
 * `app.ai` 与 `app.agent` 两条路都要"这个 MiniApp 该用哪个 provider"，而两条路的
 * 宿主不同（前者跑在全局 sidecar，后者跑在 MiniApp 自己的 sidecar）。把判定放在
 * 这一个纯函数里，两边共用，且能被 `*.unit.test.ts` 直接断言 —— 不必为了验证
 * 一行 provider 选择而去 mock 掉整个 SDK。
 *
 * ## 优先级
 *
 *   配置 pin（`miniappProviderId`）→ 宿主会话当前 provider
 *
 * 配置 pin 优先，因为它存在的全部理由就是**用户显式指定**。留空 / 指向一个不存在
 * 的 provider 时才回落到会话 provider —— 那正是本次改动之前的行为，不配置的人
 * 感知不到任何变化。
 */

import { SUBSCRIPTION_PROVIDER_ID } from '../shared/config-types';
import {
  findEffectiveProvider,
  resolveProviderEnv,
  type AdminAppConfig,
  type ResolvedProviderEnv,
} from './utils/admin-config';

/** 一条已解析的 MiniApp 供应商选择。 */
export interface MiniAppModelPin {
  providerId: string;
  /** 该 provider 的 SDK env。订阅类 provider 返回 undefined —— 它们走
   *  SDK 自带凭据，没有 baseUrl/apiKey 可注入。 */
  providerEnv?: ResolvedProviderEnv;
  /** 配置里钉死的模型；未钉则 undefined，由 SDK 按 provider 自选。 */
  model?: string;
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 解析 MiniApp 该用的 provider。
 *
 * @param config 宿主配置。调用方负责 `loadConfig()` —— 这里只读字段，方便测试注入。
 * @param sessionProviderId 宿主会话**当前**的 provider（`getSessionProviderEnv()`
 *   读到的那个进程级全局）。仅在没有配置 pin 时作为回落。
 */
export function resolveMiniAppModelPin(
  config: AdminAppConfig,
  sessionProviderId?: string,
): MiniAppModelPin {
  const pinnedId = trimmed(config.miniappProviderId);

  // 钉住了一个 provider 就照它走，哪怕解析不出 env（被禁用 / 缺 Key）——
  // `resolveProviderEnv` 对这些情况本就返回 undefined。调用方先用
  // `describeMiniAppPinProblem` 把这两种情况报成一条可执行的错误，而不是
  // 悄悄回落到会话 provider —— 那正是用户想逃离的"用的不是我选的那个"。
  if (pinnedId) {
    // model 只在有 pin 时才读：模型 id 属于它自己的 provider，把 provider A 的
    // model 配到 provider B 上只会得到一个上游不认的 id（手工编辑 config 时
    // 很容易造出这个半配置状态）。
    return { providerId: pinnedId, providerEnv: resolveProviderEnv(pinnedId, config), model: trimmed(config.miniappModel) };
  }

  const fallback = trimmed(sessionProviderId) ?? SUBSCRIPTION_PROVIDER_ID;
  return { providerId: fallback, providerEnv: resolveProviderEnv(fallback, config) };
}

/**
 * 配置 pin 存在、却拿不到可用 env 时的解释文案。
 *
 * 与 `getProviderSelectionError` 同一套判定，只是换成了 MiniApp 语境 —— 作者看到
 * 的是"你选的 MiniApp 供应商不能用"，而不是一句没有主语的 "no API key"。
 * 返回 null 表示这条 pin 是好的。
 */
export function describeMiniAppPinProblem(config: AdminAppConfig): string | null {
  const pinnedId = trimmed(config.miniappProviderId);
  if (!pinnedId) return null;

  const provider = findEffectiveProvider(pinnedId, config);
  if (!provider) {
    return `MiniApp model provider '${pinnedId}' no longer exists. Pick another one in Settings → Model Providers.`;
  }
  if (!resolveProviderEnv(pinnedId, config)) {
    const name = typeof provider.name === 'string' ? provider.name : pinnedId;
    return `MiniApp model provider '${name}' has no usable credential. Configure its API key in Settings → Model Providers.`;
  }
  return null;
}
