// MiniAppModelSetting — 为 MiniApp 的 app.ai / app.agent 选模型供应商。
//
// 挂在设置 → 模型供应商 页面顶部，而不是新建一个 section：MiniApp 的 LLM 用的
// 就是这里配的 provider 与 Key，把它放到同一个页面里，用户改 Key 与改"谁在用"
// 在同一个心智模型下；新建 section 反而多一层导航。
//
// 复用 `HelperModelPicker` 而不是再写一个下拉：那个组件已经处理好了
// "按供应商分组 / 只列可用 provider / 没有可用 provider 时给一个去配置的入口"，
// 第二份实现只会漂移。
//
// "跟随对话" 是一个真实的选项而不是占位符：MiniApp 的默认行为（本次改动之前）
// 就是沿用宿主会话 provider，清空 pin 就能回到那个行为。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppConfig, Provider, ProviderVerifyStatus } from '@/config/types';
import { HelperModelPicker, resolveInitialHelperModel } from '@/components/HelperModelPicker';

interface MiniAppModelSettingProps {
  providers: Provider[];
  apiKeys: Record<string, string>;
  verifyStatus: Record<string, ProviderVerifyStatus>;
  config: AppConfig;
  onChange: (providerId: string | undefined, model: string | undefined) => void;
}

export function MiniAppModelSetting({
  providers,
  apiKeys,
  verifyStatus,
  config,
  onChange,
}: MiniAppModelSettingProps) {
  const { t } = useTranslation('settings');

  // 只读配置、不落本地 state —— 磁盘是唯一真相，改完由 ConfigProvider 重新推下来。
  // 与 SettingsHelperInbox 的 `picked` 同一套推导逻辑，差别只在这里多一个
  // "未配置 = 跟随对话" 的空态（`resolveInitialHelperModel` 会回落到第一个可用
  // provider，所以要先判 pin 是否真的存在）。
  const pinned = useMemo(
    () => !!(config.miniappProviderId && config.miniappProviderId.trim()),
    [config.miniappProviderId],
  );

  const picked = useMemo(
    () =>
      resolveInitialHelperModel(providers, apiKeys, verifyStatus, {
        providerId: config.miniappProviderId,
        model: config.miniappModel,
      }),
    [providers, apiKeys, verifyStatus, config.miniappProviderId, config.miniappModel],
  );

  return (
    <div className="mb-8 rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--ink)]">
            {t('providers.miniappModel.title')}
          </h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
            {t('providers.miniappModel.description')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pinned ? (
            <button
              type="button"
              onClick={() => onChange(undefined, undefined)}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
            >
              {t('providers.miniappModel.followSession')}
            </button>
          ) : (
            <span className="rounded-lg bg-[var(--paper-inset)] px-2.5 py-1.5 text-sm font-medium text-[var(--ink-muted)]">
              {t('providers.miniappModel.followingSession')}
            </span>
          )}
          <HelperModelPicker
            providers={providers}
            apiKeys={apiKeys}
            verifyStatus={verifyStatus}
            value={picked}
            placement="bottom-end"
            triggerClassName="flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)]"
            onChange={(providerId, model) => onChange(providerId, model)}
          />
        </div>
      </div>
    </div>
  );
}