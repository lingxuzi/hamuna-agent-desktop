import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, type AppConfig, type Provider } from '@/config/types';

import { GlobalDefaultModelSetting } from './GlobalDefaultModelSetting';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    cloudProvider: '模型官方',
    type: 'api',
    primaryModel: 'deepseek-v4-flash',
    isBuiltin: true,
    config: { baseUrl: 'https://api.deepseek.com/anthropic' },
    models: [
      { model: 'deepseek-v4-pro', modelName: 'DeepSeek V4 Pro', modelSeries: 'deepseek' },
      { model: 'deepseek-v4-flash', modelName: 'DeepSeek V4 Flash', modelSeries: 'deepseek' },
    ],
    ...overrides,
  };
}

const PROVIDERS = [
  provider(),
  provider({ id: 'anthropic-sub', name: 'Anthropic (订阅)', type: 'subscription', primaryModel: 'claude-sonnet-5',
    models: [{ model: 'claude-sonnet-5', modelName: 'Claude Sonnet 5', modelSeries: 'claude' }] }),
];

function renderSetting(config: Partial<AppConfig> = {}, providers: Provider[] = PROVIDERS) {
  const onChange = vi.fn();
  render(
    <GlobalDefaultModelSetting
      providers={providers}
      apiKeys={{ deepseek: 'sk-test' }}
      verifyStatus={{ 'anthropic-sub': { status: 'valid', verifiedAt: '2026-11-18T00:00:00.000Z' } }}
      config={{ ...DEFAULT_CONFIG, defaultProviderId: 'deepseek', ...config }}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('GlobalDefaultModelSetting', () => {
  it('shows one pair for the whole app, reading the provider’s effective default model', () => {
    renderSetting({ providerPrimaryModels: { deepseek: 'deepseek-v4-pro' } });

    expect(screen.getByText('默认模型')).toBeInTheDocument();
    // 供应商下拉显示当前默认供应商；模型下拉显示用户设过的那个模型，不是预设默认。
    expect(screen.getByRole('button', { name: '默认供应商' })).toHaveTextContent('DeepSeek');
    expect(screen.getByRole('button', { name: '默认模型' })).toHaveTextContent('DeepSeek V4 Pro');
  });

  it('reports the new model together with the current provider id', () => {
    const onChange = renderSetting();

    fireEvent.click(screen.getByRole('button', { name: '默认模型' }));
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4 Pro' }));

    expect(onChange).toHaveBeenCalledWith('deepseek', 'deepseek-v4-pro');
  });

  it('switching provider also reports that provider’s model, never a model id it does not serve', () => {
    const onChange = renderSetting();

    fireEvent.click(screen.getByRole('button', { name: '默认供应商' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anthropic (订阅)' }));

    // 换供应商 = 换整个二元组；否则会落成「供应商 A + 只有 B 才有的 model id」。
    expect(onChange).toHaveBeenCalledWith('anthropic-sub', 'claude-sonnet-5');
  });

  it('leaves unusable providers out of the list — a default pointing at one can never start', () => {
    // 没 Key 的供应商不能当默认：指向它等于每次冷启动都起不来。
    renderSetting({}, [...PROVIDERS, provider({ id: 'no-key', name: 'No Key Provider' })]);

    fireEvent.click(screen.getByRole('button', { name: '默认供应商' }));

    expect(screen.queryByRole('button', { name: 'No Key Provider' })).not.toBeInTheDocument();
  });
});
