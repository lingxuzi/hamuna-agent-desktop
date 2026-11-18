// ProviderDefaultModelSetting — 每个供应商的「默认模型」。
//
// 这个模型是 agent 第一次启动时用的那个：agent / project 都没指定模型时，
// sidecar 回退到 provider 的 primaryModel，而这里的设置写进
// config.providerPrimaryModels —— 渲染层与 sidecar 读的是同一份值。
//
// 放在卡片底部单独一行：它是「这个供应商喂给 agent 的那个模型」，不是供应商
// 自己的属性，跟上面的 Key / 登录态不是一回事，混在 Key 区里会被当成"配 Key
// 的附属项"。

import { useTranslation } from 'react-i18next';

import type { Provider } from '@/config/types';
import CustomSelect from '@/components/CustomSelect';

interface ProviderDefaultModelSettingProps {
  provider: Provider;
  onChange: (providerId: string, modelId: string) => void;
}

export function ProviderDefaultModelSetting({ provider, onChange }: ProviderDefaultModelSettingProps) {
  const { t } = useTranslation('settings');

  // 没有可用模型时这一行没有意义（模型列表通常是发现后才填上的）。
  if (provider.models.length === 0) return null;

  return (
    <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-sm font-medium text-[var(--ink)]">
          {t('providers.defaultModel')}
        </p>
        <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
          {t('providers.defaultModelHint')}
        </p>
      </div>
      <CustomSelect
        value={provider.primaryModel}
        options={provider.models.map(m => ({ value: m.model, label: m.modelName || m.model }))}
        onChange={(value) => { onChange(provider.id, value); }}
        className="w-[180px] shrink-0"
        size="sm"
      />
    </div>
  );
}
