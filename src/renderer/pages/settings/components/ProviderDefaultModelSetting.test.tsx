import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Provider } from '@/config/types';

import { ProviderDefaultModelSetting } from './ProviderDefaultModelSetting';

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

describe('ProviderDefaultModelSetting', () => {
  it('shows the provider default model and reports the picked model with its provider id', () => {
    const onChange = vi.fn();
    render(<ProviderDefaultModelSetting provider={provider()} onChange={onChange} />);

    expect(screen.getByText('默认模型')).toBeInTheDocument();

    // 关闭态显示的是当前的默认模型（用户设过的那个），不是预设里的第一个。
    const trigger = screen.getByRole('button', { name: /DeepSeek V4 Flash/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek V4 Pro' }));

    expect(onChange).toHaveBeenCalledWith('deepseek', 'deepseek-v4-pro');
  });

  it('renders nothing when the provider has no known model', () => {
    const { container } = render(
      <ProviderDefaultModelSetting provider={provider({ models: [] })} onChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
