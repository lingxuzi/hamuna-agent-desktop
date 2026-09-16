/**
 * NxgdSubscriptionProvider DOM 测试 — 覆盖状态徽章 + 刷新余额 + 充值按钮。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => mockGet(...args),
  apiPostJson: (...args: unknown[]) => mockPost(...args),
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

  it('充值按钮点击 → 弹出表单 → 点 ¥50 预设 → 自动提交 POST /api/nxgd/recharge', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    mockPost.mockResolvedValueOnce({ orderNo: 'RC001', payFormHtml: '<form action="https://alipay.com"></form>', expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));
    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/nxgd/recharge', expect.objectContaining({ amount: 50 }));
    });
  });

  it('点 ¥50 → POST 返回 payFormHtml → iframe 渲染 payFormHtml 原样（不自动提交）+ 显式「去支付宝支付」按钮存在', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    const payFormHtml = '<form action="https://alipay.com"><input name="out_trade_no" value="RC001"/></form>';
    mockPost.mockResolvedValueOnce({ orderNo: 'RC001', payFormHtml, expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));

    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    const preset50 = await waitFor(() => screen.getByRole('button', { name: '¥50' }));
    fireEvent.click(preset50);

    await waitFor(() => {
      const iframe = document.querySelector('iframe[srcdoc]');
      expect(iframe).toBeTruthy();
      const srcdoc = iframe?.getAttribute('srcdoc') ?? '';
      // 原始 payFormHtml 必须原样保留，让用户能看到订单字段
      expect(srcdoc).toBe(payFormHtml);
      // 不要 auto-submit：iframe 内若自动跳到 alipay.com，原 form HTML 来不及看清
      expect(srcdoc).not.toMatch(/<script>[\s\S]*?\.submit\(\)/);
      // 显式「去支付宝支付」按钮必须可见，用户点它才跳收银台
      expect(screen.getByRole('button', { name: /去支付宝支付|Go to Alipay/i })).toBeTruthy();
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
});
