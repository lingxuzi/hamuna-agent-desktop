// GlobalDefaultModelSetting — 全局「默认模型」：一个 (供应商, 模型) 二元组。
//
// 为什么不是单独一个 model 字段：model id 是供应商私有的（claude-sonnet-5 只在
// Anthropic 有，deepseek-v4-flash 只在 DeepSeek 有），没有跨供应商的模型命名空间。
// 「全局默认模型」落盘必然是两件事：config.defaultProviderId + 该供应商的
// providerPrimaryModels。二者组成的链路已经是既有事实：
//   agent 没指定 provider → config.defaultProviderId → 该 provider 的 primaryModel
// 前端（Chat / Launcher / resolveBuiltinSelection）与 sidecar
// （resolveWorkspaceConfig / getAllEffectiveProviders）读的都是这一条。
//
// 所以这里只做一件事：让这条链路可见、可改。不新造字段，也不会出现
// 「模型属于 A、供应商指向 B」的非法组合 —— 换供应商时模型跟着换。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getEffectivePrimaryModel, type AppConfig, type Provider, type ProviderVerifyStatus } from '@/config/types';
import { isProviderAvailable } from '@/config/configService';
import CustomSelect from '@/components/CustomSelect';

interface GlobalDefaultModelSettingProps {
  providers: Provider[];
  apiKeys: Record<string, string>;
  verifyStatus: Record<string, ProviderVerifyStatus>;
  config: AppConfig;
  onChange: (providerId: string, model: string) => void;
}

export function GlobalDefaultModelSetting({
  providers,
  apiKeys,
  verifyStatus,
  config,
  onChange,
}: GlobalDefaultModelSettingProps) {
  const { t } = useTranslation('settings');

  // 只列真能用的供应商：默认模型指向一个没 Key 的供应商，等于每次冷启动都拿不到。
  const usableProviders = useMemo(
    () => providers.filter(p => isProviderAvailable(p, apiKeys, verifyStatus)),
    [providers, apiKeys, verifyStatus],
  );

  const selectedProvider = usableProviders.find(p => p.id === config.defaultProviderId);
  const selectedModel = selectedProvider
    ? getEffectivePrimaryModel(selectedProvider, config.providerPrimaryModels)
    : '';

  return (
    <div className="mb-8 rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
      {/* 标题与下拉同一行、说明独占其下：说明带 max-w 时会把下拉挤到第二行，
          卡片白空一整行。说明放整卡宽度也就一行。 */}
      <div className="flex items-center justify-between gap-4">
        <h3 className="min-w-0 truncate text-base font-semibold text-[var(--ink)]">
          {t('providers.defaultModel.title')}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <CustomSelect
            value={config.defaultProviderId ?? ''}
            options={usableProviders.map(p => ({ value: p.id, label: p.name }))}
            placeholder={t('providers.defaultModel.autoProvider')}
            ariaLabel={t('providers.defaultModel.providerAria')}
            onChange={(providerId) => {
              const provider = usableProviders.find(p => p.id === providerId);
              if (!provider) return;
              // 换供应商必须同时换模型，否则二元组会指向一个这家没有的 model id。
              const model = getEffectivePrimaryModel(provider, config.providerPrimaryModels)
                || provider.models[0]?.model
                || '';
              onChange(providerId, model);
            }}
            className="w-[168px]"
            size="toolbar"
          />
          <CustomSelect
            value={selectedModel}
            // 还没选供应商时没有模型可选 —— 禁用而不是给一个空下拉。
            options={(selectedProvider?.models ?? []).map(m => ({
              value: m.model,
              label: m.modelName || m.model,
            }))}
            placeholder={t('providers.defaultModel.modelPlaceholder')}
            ariaLabel={t('providers.defaultModel.modelAria')}
            onChange={(model) => {
              if (!selectedProvider) return;
              onChange(selectedProvider.id, model);
            }}
            disabled={!selectedProvider || (selectedProvider.models?.length ?? 0) === 0}
            className="w-[200px]"
            size="toolbar"
          />
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
        {t('providers.defaultModel.description')}
      </p>
    </div>
  );
}
