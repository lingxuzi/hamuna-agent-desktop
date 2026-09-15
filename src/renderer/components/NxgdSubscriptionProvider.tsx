/**
 * 广电 (云广智能) — Settings 卡片。
 * 视觉壳复用 `SubscriptionProviderCardContent`。
 *
 * 卡片只读 + 「刷新余额」按钮：API key 是机器码自动注册并写盘，用户无需输入。
 * 充值入口在 Chat 端 — `NxgdRechargeModal` 在余额 < 5 元时自动弹出。
 */
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiGetJson } from '@/api/apiFetch';
import SubscriptionProviderCardContent from './SubscriptionProviderCardContent';

interface NxgdAuthState {
  status: 'idle' | 'registering' | 'registered' | 'error';
  registered: boolean;
  balance: number | null;
  usedBalance: number | null;
  balanceCheckedAt: number | null;
  error: string | null;
}

interface NxgdBalanceResponse {
  balance: number;
  usedBalance: number;
  status: number;
  lastCheckedAt: number;
  lowBalance: boolean;
}

export default function NxgdSubscriptionProvider() {
  const { t } = useTranslation('settings');
  const [auth, setAuth] = useState<NxgdAuthState | null>(null);
  const [balance, setBalance] = useState<NxgdBalanceResponse | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // 挂载时拉一次 auth state + balance
  useEffect(() => {
    void loadAuth();
    void loadBalance();
  }, []);

  const loadAuth = async () => {
    try {
      const state = await apiGetJson<NxgdAuthState>('/api/nxgd/auth/state');
      setAuth(state);
    } catch (err) {
      setAuth({ status: 'error', registered: false, balance: null, usedBalance: null, balanceCheckedAt: null, error: err instanceof Error ? err.message : 'load failed' });
    }
  };

  const loadBalance = async () => {
    setLoadingBalance(true);
    try {
      const b = await apiGetJson<NxgdBalanceResponse>('/api/nxgd/balance');
      setBalance(b);
    } catch {
      // 静默 — auth state 会显示错误
    } finally {
      setLoadingBalance(false);
    }
  };

  // --- render ---

  const statusBadge = (() => {
    if (!auth) return <Loader2 className="h-3 w-3 animate-spin text-[var(--ink-muted)]" />;
    if (auth.status === 'registering') {
      return <span className="text-[var(--warning)]">{t('providers.nxgd.status.registering')}</span>;
    }
    if (auth.status === 'error') {
      return (
        <span className="flex items-center gap-1 text-[var(--error)]">
          <AlertCircle className="h-3 w-3" />
          {t('providers.nxgd.status.error')}
        </span>
      );
    }
    if (auth.registered && balance) {
      const low = balance.lowBalance;
      return (
        <span className={low ? 'text-[var(--error)] font-medium' : 'text-[var(--success)] font-medium'}>
          ¥{balance.balance.toFixed(2)}
          {low && <span className="ml-1.5 text-xs">· {t('providers.nxgd.status.lowBalance')}</span>}
        </span>
      );
    }
    if (auth.registered) {
      return <span className="text-[var(--success)]">{t('providers.nxgd.status.registered')}</span>;
    }
    return <span className="text-[var(--ink-muted)]">{t('providers.nxgd.status.idle')}</span>;
  })();

  return (
    <SubscriptionProviderCardContent
      description={t('providers.nxgd.description')}
      status={
        <span className="flex items-center gap-2 font-mono text-xs">{statusBadge}</span>
      }
      actions={
        <button
          type="button"
          onClick={() => { void loadBalance(); }}
          disabled={loadingBalance}
          title={t('providers.nxgd.balance.refresh')}
          aria-label={t('providers.nxgd.balance.refresh')}
          className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loadingBalance ? 'animate-spin' : ''}`} />
        </button>
      }
      error={
        auth?.error ? (
          <p className="break-words text-xs text-[var(--error)]">{auth.error}</p>
        ) : undefined
      }
    />
  );
}