/**
 * 广电充值表单 — Settings 卡片 + Chat 余额不足弹窗共用。
 * 内含：金额选择（10/30/50/100/200 预设 + 自定义）+ 调 /api/nxgd/recharge
 * 拿到 payFormHtml 后嵌入 sandboxed iframe。
 *
 * 不在 module 顶层副作用 — 等用户点「确认充值」才发请求。
 */
import { Loader2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiPostJson } from '@/api/apiFetch';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200] as const;

interface RechargeResult {
  orderNo: string;
  payFormHtml: string;
  expiresAt: string;
}

export interface NxgdRechargeFormProps {
  /** 充值完成后回调（用于刷新余额或关闭 modal） */
  onCompleted?: (order: RechargeResult) => void;
  /** 取消回调（modal 用 — 让父组件关闭弹窗） */
  onCancel?: () => void;
  /** 父组件可注入额外按钮文字 / 文案 */
  cancelLabel?: string;
}

export default function NxgdRechargeForm({
  onCompleted,
  onCancel,
  cancelLabel,
}: NxgdRechargeFormProps) {
  const { t } = useTranslation('settings');
  const [amount, setAmount] = useState<number>(50);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<RechargeResult | null>(null);

  const effectiveAmount = customAmount ? Number(customAmount) : amount;
  const valid = Number.isFinite(effectiveAmount) && effectiveAmount >= 0.1 && effectiveAmount <= 5000;

  const submit = async () => {
    if (!valid || paying) return;
    setPaying(true);
    setError(null);
    try {
      const result = await apiPostJson<RechargeResult>('/api/nxgd/recharge', { amount: effectiveAmount });
      setOrder(result);
      onCompleted?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('providers.nxgd.recharge.failed'));
    } finally {
      setPaying(false);
    }
  };

  if (order) {
    // 拿到 payFormHtml → 嵌入 iframe；支付宝 form 提交后浏览器自动跳转收银台
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--ink-muted)]">
          {t('providers.nxgd.recharge.iframeHint')}
        </p>
        <iframe
          title={t('providers.nxgd.recharge.confirm')}
          srcDoc={order.payFormHtml}
          sandbox="allow-forms allow-scripts allow-same-origin"
          className="h-64 w-full rounded-lg border border-[var(--line)] bg-white"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            {t('providers.nxgd.recharge.modal.later')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { setAmount(preset); setCustomAmount(''); }}
            disabled={paying}
            className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
              amount === preset && !customAmount
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--paper-inset)]'
            }`}
          >
            ¥{preset}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-xs text-[var(--ink-muted)]">{t('providers.nxgd.recharge.custom')}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0.1}
          max={5000}
          step={0.01}
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          placeholder={t('providers.nxgd.recharge.customPlaceholder')}
          disabled={paying}
          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        />
      </label>

      {error && (
        <p className="break-words text-xs text-[var(--error)]">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={paying}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-60"
          >
            {cancelLabel ?? t('providers.nxgd.recharge.modal.later')}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!valid || paying}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)] disabled:cursor-wait disabled:opacity-60"
        >
          {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
          {t('providers.nxgd.recharge.confirm')}
        </button>
      </div>
    </div>
  );
}