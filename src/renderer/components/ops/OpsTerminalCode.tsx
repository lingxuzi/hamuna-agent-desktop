// 终端口令 —— 让人手动跑的 CLI 在台账里记成「人」，而不是「Agent」。
//
// 门在 Rust 那边（`src-tauri/src/ops_user_code.rs`）：口令由**界面铸造**、只活在
// GUI 进程内存里，Agent 拿不到有效口令。这个组件只做三件事：铸、给人看、给
// 人复制。
//
// 为什么不做成「设置里的一串 token」：Agent 和人共用同一个用户、同一个 shell，
// 落盘的 token Agent 直接读得到 —— 那只是把 `--as-user` 换个写法，门形同虚设。
// 唯一 Agent 拿不到的，是人在界面上刚点的那一下。

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound } from 'lucide-react';

import Popover from '@/components/ui/Popover';
import { useToastOptional } from '@/components/Toast';
import { clockTime } from './opsFormat';

/** Rust `OpsUserCode` 的 camelCase 序列化。 */
interface OpsUserCode {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
}

export function OpsTerminalCode() {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language;
  const toast = useToastOptional();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<OpsUserCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const mint = useCallback(async () => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const next = await invoke<OpsUserCode>('cmd_ops_user_code');
      setCode(next);
      setCopied(false);
      setOpen(true);
    } catch (err) {
      setCode(null);
      toast?.error(
        t('ops.code.failed', { reason: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setBusy(false);
    }
  }, [toast, t]);

  const copy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error(t('ops.code.copyFailed'));
    }
  }, [code, toast, t]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ops-ghost"
        onClick={() => void mint()}
        disabled={busy}
        title={t('ops.code.open')}
      >
        <KeyRound size={14} aria-hidden="true" />
        {t('ops.code.open')}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="bottom-end"
      >
        <div className="ops-code">
          <div className="ops-code-head">
            <strong>{t('ops.code.title')}</strong>
            <span className="ops-meta">
              {code ? t('ops.code.expires', { time: clockTime(code.expiresAt, locale) }) : ''}
            </span>
          </div>
          <div className="ops-code-row">
            <code className="ops-code-value">{code?.code ?? ''}</code>
            <button type="button" className="ops-ghost ops-code-btn" onClick={() => void copy()}>
              {copied ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <Copy size={13} aria-hidden="true" />
              )}
              {copied ? t('ops.code.copied') : t('ops.code.copy')}
            </button>
            <button type="button" className="ops-ghost ops-code-btn" onClick={() => void mint()}>
              {t('ops.code.regenerate')}
            </button>
          </div>
          <p className="ops-code-hint">{t('ops.code.hint')}</p>
        </div>
      </Popover>
    </>
  );
}
