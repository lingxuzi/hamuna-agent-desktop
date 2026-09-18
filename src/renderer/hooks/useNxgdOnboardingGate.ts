/**
 * nxgd 首次启动向导 gate hook — 决定是否显示右下浮窗。
 *
 * 唯一权威：`auth.setup`（来自 `/api/nxgd/auth/state`，由 `nxgd-auth.json::setup` 持久化）。
 *  - `setup === false`（新注册或用户手动 `rm nxgd-auth.json`） → 弹
 *  - `setup === true`（wizard 跑完或点了稍后再说，server 端写盘） → 不弹
 *
 * 不读 `providerVerifyStatus`（`/api/nxgd/models` 200 自动 stamp 的 cache，sticky 写盘到
 * `config.json`，rm auth 文件不清它会"卡住"老用户）。
 *
 * `auth.status !== 'registered'` → 不弹（注册中 / 注册失败时 wizard 空状态误导）。
 */
import { useMemo } from 'react';

export interface NxgdAuthStatusLike {
  status: 'idle' | 'registering' | 'registered' | 'error';
  registered: boolean;
  setup: boolean;
}

export interface UseNxgdOnboardingGateInput {
  auth: NxgdAuthStatusLike | null;
}

export interface UseNxgdOnboardingGateOutput {
  show: boolean;
}

export function shouldShowNxgdOnboarding(
  input: UseNxgdOnboardingGateInput,
): boolean {
  if (input.auth?.status !== 'registered') return false;
  return input.auth.setup !== true;
}

export function useNxgdOnboardingGate(
  input: UseNxgdOnboardingGateInput,
): UseNxgdOnboardingGateOutput {
  const show = useMemo(() => shouldShowNxgdOnboarding(input), [input]);
  return { show };
}