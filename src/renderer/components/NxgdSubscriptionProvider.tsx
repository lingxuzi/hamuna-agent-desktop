/**
 * 广电 (云广智能) — Settings 卡片。
 * 视觉壳复用 `SubscriptionProviderCardContent`；充值表单复用 `NxgdRechargeForm`。
 *
 * 状态机：自动注册 → 余额展示 → 余额 < 5元时高亮「充值」按钮。
 * 用户可手动「刷新余额」或「刷新连接」（强制重新注册）。
 */
import { Loader2, RefreshCw, Wallet, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { apiGetJson, apiPostJson } from '@/api/apiFetch';
import OverlayBackdrop from './OverlayBackdrop';
import SubscriptionProviderCardContent from './SubscriptionProviderCardContent';
import NxgdRechargeForm from './nxgd/NxgdRechargeForm';

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
  const [refreshing, setRefreshing] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiPostJson('/api/nxgd/auth/refresh', {});
      await loadAuth();
      await loadBalance();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRechargeCompleted = () => {
    // 用户支付完 → 关闭 modal + 刷新余额
    setRechargeOpen(false);
    void loadBalance();
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
    <>
      <SubscriptionProviderCardContent
        description={t('providers.nxgd.description')}
        status={
          <span className="flex items-center gap-2 font-mono text-xs">{statusBadge}</span>
        }
        actions={
          <>
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
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title={t('providers.nxgd.reconnect')}
              className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setRechargeOpen(true)}
              disabled={!auth?.registered}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                balance?.lowBalance
                  ? 'bg-[var(--error)] text-[var(--error-fg)] hover:opacity-90'
                  : 'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)]'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              {t('providers.nxgd.recharge.title')}
            </button>
          </>
        }
        error={
          auth?.error ? (
            <p className="break-words text-xs text-[var(--error)]">{auth.error}</p>
          ) : undefined
        }
      />

      {rechargeOpen && createPortal(
        <OverlayBackdrop onClose={() => setRechargeOpen(false)} className="z-[200] overflow-y-auto px-4 py-8">
          <div className="w-full max-w-md rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
            <h2 className="mb-1 text-lg font-semibold text-[var(--ink)]">
              {t('providers.nxgd.recharge.title')}
            </h2>
            <p className="mb-4 text-sm text-[var(--ink-muted)]">
              {t('providers.nxgd.recharge.subtitle')}
            </p>
            <NxgdRechargeForm
              onCompleted={handleRechargeCompleted}
              onCancel={() => setRechargeOpen(false)}
            />
          </div>
        </OverlayBackdrop>,
        document.body,
      )}
    </>
  );
}