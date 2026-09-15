/**
 * NxgdSubscriptionProvider DOM 测试 — 覆盖状态徽章 + 充值按钮 + 充值表单。
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

  it('红章 + 高亮「充值」按钮（balance=2）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 2, usedBalance: 8, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 2, usedBalance: 8, status: 1, lastCheckedAt: Date.now(), lowBalance: true });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/余额不足|Low balance/)).toBeTruthy();
    });
    const btn = screen.getByRole('button', { name: /充值|Top up/i });
    expect(btn.className).toContain('error'); // red color via [var(--error)]
  });

  it('registering 状态显示「正在自动注册…」', async () => {
    mockGet.mockResolvedValueOnce({ status: 'registering', registered: false, balance: null, usedBalance: null, balanceCheckedAt: null, error: null });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/正在自动注册|Auto-registering/)).toBeTruthy();
    });
  });

  it('充值按钮点击 → 打开 modal + 提交充值后调 /api/nxgd/recharge', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    mockPost.mockResolvedValueOnce({ orderNo: 'RC001', payFormHtml: '<form action="https://alipay.com"></form>', expiresAt: '2026-09-15T12:00:00' });

    renderProvider();
    await waitFor(() => screen.getByText('¥10.00'));
    fireEvent.click(screen.getByRole('button', { name: /Top up|充值/i }));

    // 等 modal 出现（用 confirm 按钮匹配 — 避免与卡片上的「充值」按钮冲突）
    const confirmBtn = await waitFor(() => screen.getByRole('button', { name: /Confirm top-up|确认充值/i }));
    fireEvent.click(confirmBtn);

    // 关键契约：调了 POST /api/nxgd/recharge，body 包含 amount
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/nxgd/recharge', expect.objectContaining({ amount: expect.any(Number) }));
    });
  });
});
