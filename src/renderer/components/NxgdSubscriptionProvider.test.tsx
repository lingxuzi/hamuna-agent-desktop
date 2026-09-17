/**
 * NxgdSubscriptionProvider DOM 测试 — 覆盖状态徽章 + 刷新余额 + 充值按钮。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => mockGet(...args),
  apiPostJson: (...args: unknown[]) => mockPost(...args),
}));
vi.mock('@/utils/openExternal', () => ({
  openExternal: (...args: unknown[]) => mockOpenExternal(...args),
}));

import NxgdSubscriptionProvider from './NxgdSubscriptionProvider';

function renderProvider() {
  return render(
    <I18nextProvider i18n={i18n}>
      <NxgdSubscriptionProvider />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockOpenExternal.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NxgdSubscriptionProvider', () => {
  it('绿章 + 充值按钮可见（balance=10）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText('¥10.00')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /充值|Top up/i })).toBeTruthy();
  });

  it('红章 + 充值按钮仍黑底白字（balance=2）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 2, usedBalance: 8, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 2, usedBalance: 8, status: 1, lastCheckedAt: Date.now(), lowBalance: true });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/余额不足|Low balance/)).toBeTruthy();
    });
    const btn = screen.getByRole('button', { name: /充值|Top up/i });
    expect(btn.className).toContain('button-primary-bg');
  });

  it('registering 状态显示「正在自动注册…」', async () => {
    mockGet.mockResolvedValueOnce({ status: 'registering', registered: false, balance: null, usedBalance: null, balanceCheckedAt: null, error: null });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/正在自动注册|Auto-registering/)).toBeTruthy();
    });
  });

  it('充值按钮点击 → 弹出表单 → 点 ¥50 预设不自动提交，需点「去支付」才 POST', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    mockPost.mockResolvedValueOnce({ orderNo: 'RC001', checkoutUrl: 'https://example.com/checkout', expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));
    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);

    // v7 user 拍板「不要用户选了金额自动跳转」：点预设只切 selected 视觉，不 POST
    expect(mockPost).not.toHaveBeenCalled();

    // 点「去支付」按钮才真正提交
    const goPay = screen.getByRole('button', { name: /去支付|Go to pay/i });
    fireEvent.click(goPay);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/nxgd/recharge', expect.objectContaining({ amount: 50 }));
    });
  });

  it('点 ¥50 → 「去支付」 → POST 返回 checkoutUrl → 订单摘要 + 自动打开收银台 URL + 「重新打开」兜底按钮', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    // v7：选金额（preset/custom）不直接跳，必须点「去支付」才 POST + openExternal。
    const checkoutUrl = 'https://openapi.alipay.com/gateway.do?out_trade_no=RC001&total=50.00';
    mockPost.mockResolvedValueOnce({ orderNo: 'RC001', checkoutUrl, expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));

    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);

    // 1. 点「去支付」才 POST + openExternal
    fireEvent.click(screen.getByRole('button', { name: /去支付|Go to pay/i }));

    await waitFor(() => {
      // 自动调 openExternal 打开收银台
      expect(mockOpenExternal).toHaveBeenCalledWith(checkoutUrl);
      // 订单摘要可见
      expect(screen.getByText('RC001')).toBeTruthy();
      expect(screen.getByText('¥50.00')).toBeTruthy();
      // 「重新打开」兜底按钮可见
      const reopen = screen.getByRole('button', { name: /重新打开支付页面|Reopen checkout page/i });
      expect(reopen).toBeTruthy();
    });

    // 点「重新打开」再次调 openExternal 兜底
    fireEvent.click(screen.getByRole('button', { name: /重新打开支付页面|Reopen checkout page/i }));
    await waitFor(() => {
      expect(mockOpenExternal).toHaveBeenCalledTimes(2);
    });
  });

  it('点「自定义」→ 输入框可见 → 输入金额 → 点「去支付」 → POST + openExternal', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    const checkoutUrl = 'https://openapi.alipay.com/gateway.do?out_trade_no=RC002&total=88.88';
    mockPost.mockResolvedValueOnce({ orderNo: 'RC002', checkoutUrl, expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));

    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    // 点「自定义」按钮 → 显示输入框（之前 6 个按钮都在，默认 preset mode）
    fireEvent.click(screen.getByRole('button', { name: /^自定义$|^Custom$/ }));

    // 1. 输入框可见（input[type=number]）
    const input = await waitFor(() => document.querySelector('input[type="number"]') as HTMLInputElement);
    expect(input).toBeTruthy();

    // 2. 切到 custom 模式后点预设不再有效；点「去支付」必须用输入金额
    expect(mockPost).not.toHaveBeenCalled();

    // 3. 输入金额 88.88
    fireEvent.change(input, { target: { value: '88.88' } });

    // 4. 点「去支付」
    fireEvent.click(screen.getByRole('button', { name: /去支付|Go to pay/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/nxgd/recharge', expect.objectContaining({ amount: 88.88 }));
      expect(mockOpenExternal).toHaveBeenCalledWith(checkoutUrl);
    });
  });

  it('刷新余额按钮 → 重新调 /api/nxgd/balance', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false })
      .mockResolvedValueOnce({ balance: 25, usedBalance: 5, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));

    fireEvent.click(screen.getByRole('button', { name: /刷新余额|Refresh balance/i }));

    await waitFor(() => {
      expect(screen.getByText('¥25.00')).toBeTruthy();
    });
  });

  it('POST /api/nxgd/recharge 返服务端 message → 显示真因（i18n fallback 兜底）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    // v10: 服务端 index.ts:4560-4568 失败路径返 502 + { error: 'recharge-failed', message: '...' }，
    // apiFetch.ts::buildApiError 把 message 挂到 Error.serverMessage（code 走 err.message）。
    // 用户应看到 serverMessage 真因（不是 i18n 兜底），且裸 code 不显示。
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('recharge-failed'), { serverMessage: 'recharge failed (code 403): upstream rejected' }),
    );

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));
    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);
    fireEvent.click(screen.getByRole('button', { name: /去支付|Go to pay/i }));

    await waitFor(() => {
      expect(screen.getByText(/recharge failed \(code 403\)/)).toBeTruthy();
      expect(screen.queryByText('recharge-failed')).toBeNull();
    });
  });

  it('POST /api/nxgd/recharge 返 serverMessage 为空 → fallback i18n 文案', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    // serverMessage 缺失 / undefined 时走 i18n 兜底；旧 case 的"裸 code 永不出现"契约仍要保。
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('recharge-failed'), { serverMessage: undefined }),
    );

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));
    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);
    fireEvent.click(screen.getByRole('button', { name: /去支付|Go to pay/i }));

    await waitFor(() => {
      expect(screen.getByText(/创建订单失败|Failed to create order/)).toBeTruthy();
      expect(screen.queryByText('recharge-failed')).toBeNull();
    });
  });
});
