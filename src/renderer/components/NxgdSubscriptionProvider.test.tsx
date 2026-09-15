/**
 * NxgdSubscriptionProvider DOM 测试 — 卡片只读 + 「刷新余额」按钮。
 * 充值流程在 Chat 端的 `NxgdRechargeModal`，不在卡片。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';

const mockGet = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => mockGet(...args),
  apiPostJson: vi.fn(),
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NxgdSubscriptionProvider', () => {
  it('绿章 + 余额显示（balance=10）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 10, usedBalance: 0, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 10, usedBalance: 0, status: 1, lastCheckedAt: Date.now(), lowBalance: false });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText('¥10.00')).toBeTruthy();
    });
  });

  it('红章 + 「余额不足」标记（balance=2）', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'registered', registered: true, balance: 2, usedBalance: 8, balanceCheckedAt: Date.now(), error: null })
      .mockResolvedValueOnce({ balance: 2, usedBalance: 8, status: 1, lastCheckedAt: Date.now(), lowBalance: true });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/余额不足|Low balance/)).toBeTruthy();
    });
  });

  it('registering 状态显示「正在自动注册…」', async () => {
    mockGet.mockResolvedValueOnce({ status: 'registering', registered: false, balance: null, usedBalance: null, balanceCheckedAt: null, error: null });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByText(/正在自动注册|Auto-registering/)).toBeTruthy();
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
      expect(mockGet).toHaveBeenCalledTimes(3); // 初次 auth/state + balance + 刷新 balance
      expect(screen.getByText('¥25.00')).toBeTruthy();
    });
  });
});
