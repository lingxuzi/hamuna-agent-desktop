/**
 * 广电 — Chat 内余额不足提示弹窗（dismissable）。
 * 用户点「稍后」可关闭继续用其它 provider；Esc 也关闭。
 * 不拦截 Cmd+W / F5（用户可能想关掉去看 Settings 用法）。
 */
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import OverlayBackdrop from './OverlayBackdrop';
import NxgdRechargeForm from './nxgd/NxgdRechargeForm';

export interface NxgdRechargeModalProps {
  open: boolean;
  balance: number;
  onClose: () => void;
  /** 用户点「我已支付」后回调（关闭 modal + 通知 Chat 重试发送） */
  onPaid?: () => void;
}

export default function NxgdRechargeModal({ open, balance, onClose, onPaid }: NxgdRechargeModalProps) {
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <OverlayBackdrop onClose={onClose} className="z-[200] overflow-y-auto px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-[var(--ink)]">
          {t('nxgd.modal.title')}
        </h2>
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          {t('nxgd.modal.subtitle', { balance: balance.toFixed(2) })}
        </p>
        <NxgdRechargeForm
          onCompleted={onPaid ? () => onPaid() : undefined}
          onCancel={onClose}
        />
      </div>
    </OverlayBackdrop>,
    document.body,
  );
}