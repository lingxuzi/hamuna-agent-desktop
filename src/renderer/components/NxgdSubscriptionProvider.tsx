/**
 * 广电 (云广智能) — Settings 卡片。
 * 视觉壳复用 `SubscriptionProviderCardContent`；充值表单复用 `NxgdRechargeForm`。
 *
 * 状态机：自动注册 → 余额展示 → 用户可「刷新余额」或「充值」。
 * API key 由机器码自动注册并写盘，用户无需输入。
 */
import { Loader2, RefreshCw, Wallet, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { apiGetJson } from '@/api/apiFetch';
import OverlayBackdrop from './OverlayBackdrop';
import SubscriptionProviderCardContent from './SubscriptionProviderCardContent';
import NxgdRechargeForm from './nxgd/NxgdRechargeForm';

interface NxgdAuthState {
  status: 'idle' | 'registering' | 'registered' | 'error';
  registered: boolean;
  userId: number | null;
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
      setAuth({ status: 'error', registered: false, userId: null, balance: null, usedBalance: null, balanceCheckedAt: null, error: err instanceof Error ? err.message : 'load failed' });
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

  const handleRechargeCompleted = () => {
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
              onClick={() => setRechargeOpen(true)}
              disabled={!auth?.registered}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wallet className="h-3.5 w-3.5" />
              {t('providers.nxgd.recharge.title')}
            </button>
          </>
        }
        error={
          // v14: 只在 status='error'（真 auth 失败）时显示 error —— createRechargeOrder 失败
          // 会写 state.error 但不改 status='registered'，card 上既显示绿章余额又显示红字错误
          // 自相矛盾。recharge 失败的真因用户已经在 form 错误区看到（v11 已透出），
          // 这里再显示就是"卡片上一直显示错误"。
          auth?.error && auth.status === 'error' ? (
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
              userId={auth?.userId ?? null}
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