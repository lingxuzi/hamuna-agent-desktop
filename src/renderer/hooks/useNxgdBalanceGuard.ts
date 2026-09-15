/**
 * nxgd 余额守卫 hook — Chat send 之前 / App 启动 时复用。
 *
 * 行为：
 * - check(): 调 /api/nxgd/balance，余额 < 5 → showModal = true；
 * - hide(): 用户关掉弹窗后调用，避免再次自动弹出；
 * - refresh(): 拉一次余额并返 balance（用于 Chat send 之前的同步门控）。
 *
 * 不在 module 顶层副作用 — 等调用方决定时机。
 */
import { useCallback, useEffect, useState } from 'react';

import { apiGetJson } from '@/api/apiFetch';

interface BalanceResponse {
  balance: number;
  usedBalance: number;
  status: number;
  lastCheckedAt: number;
  lowBalance: boolean;
}

const LOW_BALANCE_THRESHOLD = 5;

export interface NxgdBalanceGuard {
  showModal: boolean;
  balance: number | null;
  hide: () => void;
  check: () => Promise<boolean>;
}

export function useNxgdBalanceGuard(enabled: boolean): NxgdBalanceGuard {
  const [showModal, setShowModal] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const fetchOnce = useCallback(async (): Promise<BalanceResponse | null> => {
    if (!enabled) return null;
    try {
      return await apiGetJson<BalanceResponse>('/api/nxgd/balance');
    } catch {
      return null;
    }
  }, [enabled]);

  const check = useCallback(async (): Promise<boolean> => {
    const snap = await fetchOnce();
    if (!snap) return false; // 拉不到余额不阻断（fail-soft）
    setBalance(snap.balance);
    if (snap.balance < LOW_BALANCE_THRESHOLD) {
      setShowModal(true);
      return true; // true = low balance, should block send
    }
    return false;
  }, [fetchOnce]);

  const hide = useCallback(() => setShowModal(false), []);

  // 挂载时跑一次（App / Chat 切换 provider 时）
  useEffect(() => {
    if (!enabled) {
      setShowModal(false);
      return;
    }
    void check();
  }, [enabled, check]);

  return { showModal, balance, hide, check };
}