import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import NxgdOnboardingWizard from './NxgdOnboardingWizard';

// jsdom 不实现 scrollIntoView；wizard step 2 scroll-into-view effect 需要它。
// no-op polyfill；测试只关心 effect 跑了不抛，不关心滚动结果。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/useCloseLayer', () => ({
  useCloseLayer: () => {},
}));

const apiPostJson = vi.fn().mockResolvedValue({ checkoutUrl: 'https://pay.example/c/abc' });
const openExternal = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
}));
vi.mock('@/utils/openExternal', () => ({
  openExternal: (...args: unknown[]) => openExternal(...args),
}));

const discoverNxgdModels = vi.fn();
vi.mock('@/config/services/nxgdSubscriptionService', () => ({
  discoverNxgdModels: (...args: unknown[]) => discoverNxgdModels(...args),
  getNxgdAuthState: (...args: unknown[]) => getNxgdAuthState(...args),
}));
const getNxgdAuthState = vi.fn();

const auth = { status: 'registered' as const, registered: true, setup: false };
const balance = { balance: 80, usedBalance: 20 };

describe('NxgdOnboardingWizard', () => {
  beforeEach(() => {
    apiPostJson.mockClear();
    openExternal.mockClear();
    apiPostJson.mockResolvedValue({ checkoutUrl: 'https://pay.example/c/abc' });
    discoverNxgdModels.mockReset();
    // 默认：discovery 返 primaryModel 单选 —— 旧测试期望列表 ≥ 1。
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
    ]);
    getNxgdAuthState.mockReset();
    getNxgdAuthState.mockResolvedValue({ status: 'registered', registered: true, setup: false });
  });

  test('shows pill collapsed state by default with "选择第一个模型" CTA', () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByText('wizard.pill')).toBeTruthy();
    expect(screen.getByText('wizard.pillCta')).toBeTruthy();
  });

  test('renders a fullscreen overlay (fixed inset-0 backdrop) wrapping the wizard', () => {
    const { container } = render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    // OverlayBackdrop uses `fixed inset-0` on its root — pill is nested inside.
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    // Wizard 仍是右下定位（absolute — 相对 overlay 而非 viewport）
    const wizard = overlay?.querySelector('.absolute.bottom-6.right-6');
    expect(wizard).toBeTruthy();
  });

  test('clicking the overlay backdrop does NOT fire onClose (first-run wizard forces explicit dismiss)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    // OverlayBackdrop 用 onMouseDown + target===currentTarget 判断 dismiss;
    // omit onClose prop = no dismiss handler attached = click on backdrop is no-op.
    fireEvent.mouseDown(overlay!, { target: overlay, currentTarget: overlay });
    fireEvent.click(overlay!, { target: overlay, currentTarget: overlay });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('pill CTA click expands into the 5-step card (step 1)', () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByText('wizard.step1.title')).toBeTruthy();
    expect(screen.getByText('wizard.step1.body')).toBeTruthy();
  });

  test('steps advance through 1 → 2 → 3 on CTA click', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        primaryModelLabel="DeepSeek V4 Flash"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));

    fireEvent.click(screen.getByText('wizard.step1.cta'));
    expect(screen.getByText('wizard.step2.title')).toBeTruthy();
    // step 2 candidate list 是 useEffect 自拉的，等卡片出现
    await screen.findByTestId('nxgd-wizard-model-card');
    expect(screen.getByText('DeepSeek V4 Flash')).toBeTruthy();

    fireEvent.click(screen.getByText('wizard.step2.cta'));
    expect(screen.getByText('wizard.step3.title')).toBeTruthy();
  });

  test('step 4 "none" → step 5 without firing recharge', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));

    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-none'));
    fireEvent.click(screen.getByText('wizard.step4.ctaSkip'));
    expect(screen.getByText('wizard.step5.title')).toBeTruthy();
    await waitFor(() => expect(apiPostJson).not.toHaveBeenCalled());
    expect(openExternal).not.toHaveBeenCalled();
  });

  test('step 4 "30" → POSTs recharge + opens external browser (no intermediate modal)', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));
    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-30'));
    fireEvent.click(screen.getByText('wizard.step4.cta'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/nxgd/recharge', { amount: 30 });
    });
    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('https://pay.example/c/abc');
    });
  });

  test('step 4 "custom" with valid amount → POSTs that amount', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));
    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-custom'));
    const input = screen.getByTestId('nxgd-wizard-custom-amount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '88' } });
    fireEvent.click(screen.getByText('wizard.step4.cta'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/nxgd/recharge', { amount: 88 });
    });
  });

  test('step 4 "custom" with invalid amount → CTA disabled, no POST fires', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));
    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-custom'));
    const input = screen.getByTestId('nxgd-wizard-custom-amount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    const cta = screen.getByText('wizard.step4.cta');
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cta);
    await waitFor(() => expect(apiPostJson).not.toHaveBeenCalled());
  });

  test('step 4 recharge server error → renders fallback message, wizard stays open', async () => {
    apiPostJson.mockRejectedValueOnce(Object.assign(new Error('recharge-failed'), { serverMessage: '网关超时' }));
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));
    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-30'));
    fireEvent.click(screen.getByText('wizard.step4.cta'));

    await waitFor(() => {
      expect(screen.getByTestId('nxgd-wizard-recharge-error').textContent).toContain('网关超时');
    });
    // wizard still on step 4 (not advanced)
    expect(screen.getByText('wizard.step4.title')).toBeTruthy();
    expect(screen.queryByText('wizard.step5.title')).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });

  test('"稍后再说" / X close button fires onClose', () => {
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('wizard.laterCta'));
    expect(onClose).toHaveBeenCalled();
  });

  test('Escape key fires onClose', () => {
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('step 5 "去 Chat" → POSTs /api/nxgd/auth/setup + fires onClose', async () => {
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    fireEvent.click(screen.getByText('wizard.step2.cta'));
    fireEvent.click(screen.getByText('wizard.step3.cta'));
    fireEvent.click(screen.getByTestId('nxgd-wizard-recharge-none'));
    fireEvent.click(screen.getByText('wizard.step4.ctaSkip'));
    fireEvent.click(screen.getByText('wizard.step5.cta'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/nxgd/auth/setup', {});
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('Esc → POSTs /api/nxgd/auth/setup (first-run wizard setup marks done on any close)', async () => {
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/nxgd/auth/setup', {});
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('wizard finish POST rejection does not throw (fire-and-forget — UX must not block on disk IO)', async () => {
    apiPostJson.mockImplementationOnce(() => {
      return Promise.reject(new Error('disk full'));
    });
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    // give microtask queue a tick to flush the catch
    await new Promise((r) => setTimeout(r, 10));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('wizard step 2 model picker', () => {
  beforeEach(() => {
    apiPostJson.mockClear();
    openExternal.mockClear();
    discoverNxgdModels.mockReset();
    getNxgdAuthState.mockReset();
    getNxgdAuthState.mockResolvedValue({ status: 'registered', registered: true, setup: false });
  });

  test('discovery 返 N 个 model → step 2 渲染 N 个候选卡，默认选 primaryModel', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
      { id: 'qwen3-max', displayName: 'Qwen3 Max' },
    ]);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        primaryModelLabel="DeepSeek V4 Flash"
        onClose={vi.fn()}
        onPinModel={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    const cards = await screen.findAllByTestId('nxgd-wizard-model-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Qwen3 Max')).toBeTruthy();
  });

  test('discovery 失败 → step 2 渲染 primaryModel 单选', async () => {
    discoverNxgdModels.mockRejectedValue(new Error('upstream 503'));
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        primaryModelLabel="DeepSeek V4 Flash"
        onClose={vi.fn()}
        onPinModel={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    const cards = await screen.findAllByTestId('nxgd-wizard-model-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('deepseek-v4-flash-0731');
  });

  test('用户选非默认 model → 关闭 wizard → 调 onPinModel with 选中的 id + displayName', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
      { id: 'qwen3-max', displayName: 'Qwen3 Max' },
    ]);
    const onPinModel = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={onClose}
        onPinModel={onPinModel}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    const cards = await screen.findAllByTestId('nxgd-wizard-model-card');
    fireEvent.click(cards[1]); // 选 qwen3-max
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onPinModel).toHaveBeenCalledWith('qwen3-max', 'Qwen3 Max'));
    expect(onClose).toHaveBeenCalled();
  });

  test('用户没改默认选 → 关闭 wizard → 调 onPinModel with primaryModel', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
      { id: 'qwen3-max', displayName: 'Qwen3 Max' },
    ]);
    const onPinModel = vi.fn().mockResolvedValue(undefined);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
        onPinModel={onPinModel}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    await screen.findAllByTestId('nxgd-wizard-model-card');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onPinModel).toHaveBeenCalledWith('deepseek-v4-flash-0731', 'DeepSeek V4 Flash'));
  });

  test('wizard 没传 onPinModel → 关闭不抛', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
    ]);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    await screen.findAllByTestId('nxgd-wizard-model-card');
    expect(() => fireEvent.keyDown(window, { key: 'Escape' })).not.toThrow();
  });

  test('discovery 返多 model → 列表容器 max-h + overflow-y-auto，避免 N 多时撑爆 wizard', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
      { id: 'qwen3-max', displayName: 'Qwen3 Max' },
      { id: 'kimi-k2', displayName: 'Kimi K2' },
    ]);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    const list = await screen.findByTestId('nxgd-wizard-model-list');
    expect(list.className).toContain('max-h-72');
    expect(list.className).toContain('overflow-y-auto');
  });
});

describe('wizard animation', () => {
  beforeEach(() => {
    apiPostJson.mockClear();
    openExternal.mockClear();
    discoverNxgdModels.mockReset();
    discoverNxgdModels.mockResolvedValue([
      { id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' },
    ]);
    getNxgdAuthState.mockReset();
    getNxgdAuthState.mockResolvedValue({ status: 'registered', registered: true, setup: false });
  });

  test('expanded 卡片含 popoverIn 180ms ease-out-quart + motion-reduce fallback', async () => {
    const { container } = render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    // expanded 卡片是 role="dialog"
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('animate-[popoverIn_180ms_cubic-bezier(0.25,1,0.5,1)_both]');
    expect(dialog.className).toContain('motion-reduce:animate-none');
    expect(container).toBeTruthy();
  });

  test('step body 含 wizard-step-in 180ms ease-out-quart + motion-reduce fallback', async () => {
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    const stepBody = screen.getByTestId('nxgd-wizard-step-body');
    expect(stepBody.className).toContain('animate-[wizard-step-in_180ms_cubic-bezier(0.25,1,0.5,1)_both]');
    expect(stepBody.className).toContain('motion-reduce:animate-none');

    // step 切到 2 → key={step} 触发 remount，新 step body 仍含同一 className
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    await screen.findByTestId('nxgd-wizard-model-list');
    const stepBody2 = screen.getByTestId('nxgd-wizard-step-body');
    expect(stepBody2.className).toContain('animate-[wizard-step-in_180ms_cubic-bezier(0.25,1,0.5,1)_both]');
  });

  test('pill 态不加入场动画（保持低优先通知语义）', () => {
    const { container } = render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    const complementary = screen.getByRole('complementary');
    expect(complementary.className).not.toContain('animate-[');
    expect(complementary.className).not.toContain('motion-reduce:animate-none');
    expect(container).toBeTruthy();
  });
});

describe('wizard step 2 discovery error', () => {
  beforeEach(() => {
    apiPostJson.mockClear();
    openExternal.mockClear();
    discoverNxgdModels.mockReset();
    getNxgdAuthState.mockReset();
    getNxgdAuthState.mockResolvedValue({ status: 'registered', registered: true, setup: false });
  });

  test('discovery 失败 → 错误条 + retry 按钮可见，CTA 不 disabled，candidate 列表仍含 primaryModel fallback', async () => {
    discoverNxgdModels.mockRejectedValueOnce(new Error('upstream 503'));
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        primaryModelLabel="DeepSeek V4 Flash"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));

    // 等错误条出现 + candidate 列表渲染 primaryModel fallback
    const errorBanner = await screen.findByTestId('nxgd-wizard-discovery-error');
    expect(errorBanner).toBeTruthy();
    expect(errorBanner.textContent).toContain('wizard.step2.errorTitle');
    expect(errorBanner.textContent).toContain('upstream 503');

    const retryBtn = screen.getByTestId('nxgd-wizard-discovery-retry');
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.textContent).toContain('wizard.step2.errorRetry');

    // candidate 列表 fallback 到 primaryModel
    const cards = await screen.findAllByTestId('nxgd-wizard-model-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('deepseek-v4-flash-0731');

    // CTA 不 disabled（wizard 仍可推进）
    const cta = screen.getByText('wizard.step2.cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
  });

  test('点 retry → 错误条消失，candidate 列表更新为 retry 后的真实 discovery', async () => {
    // 第一次 reject，第二次 resolve（模拟 retry 后网络恢复）
    discoverNxgdModels
      .mockRejectedValueOnce(new Error('upstream 503'))
      .mockResolvedValueOnce([
        { id: 'qwen3-max', displayName: 'Qwen3 Max' },
      ]);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        primaryModelLabel="DeepSeek V4 Flash"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    await screen.findByTestId('nxgd-wizard-discovery-error');

    // 点 retry
    fireEvent.click(screen.getByTestId('nxgd-wizard-discovery-retry'));

    // 等错误条消失 + candidate 列表更新
    await waitFor(() => {
      expect(screen.queryByTestId('nxgd-wizard-discovery-error')).toBeNull();
    });
    await screen.findByText('Qwen3 Max');
    expect(discoverNxgdModels).toHaveBeenCalledTimes(2);
  });

  test('discovery 成功 → 不渲染错误条（online happy path）', async () => {
    discoverNxgdModels.mockResolvedValue([
      { id: 'qwen3-max', displayName: 'Qwen3 Max' },
    ]);
    render(
      <NxgdOnboardingWizard
        auth={auth}
        balance={balance}
        primaryModel="deepseek-v4-flash-0731"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('wizard.pillCta'));
    fireEvent.click(screen.getByText('wizard.step1.cta'));
    await screen.findByText('Qwen3 Max');
    expect(screen.queryByTestId('nxgd-wizard-discovery-error')).toBeNull();
  });
});