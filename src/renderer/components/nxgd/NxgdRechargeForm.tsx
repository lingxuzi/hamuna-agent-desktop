/**
 * 广电充值表单 — Settings 卡片 + Chat 余额不足弹窗共用。
 * 内含：金额选择（10/30/50/100/200 预设 + 自定义）+ 调 /api/nxgd/recharge
 * 拿到 payFormHtml 后嵌入 sandboxed iframe。
 *
 * 自动提交：预设金额点击立即提交；自定义金额 onBlur / Enter 提交。无显式「确认充值」按钮。
 */
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
  /** 平台返回的数字用户 ID（注册时 `data.user.id`）— 充值时展示供用户对账 */
  userId?: number | null;
  /** 充值完成后回调（用于刷新余额或关闭 modal） */
  onCompleted?: (order: RechargeResult) => void;
  /** 取消回调（modal 用 — 让父组件关闭弹窗） */
  onCancel?: () => void;
  /** 父组件可注入额外按钮文字 / 文案 */
  cancelLabel?: string;
}

export default function NxgdRechargeForm({
  userId,
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
      // 注意：不在这里同步调 onCompleted —— 父级 handler 通常会立即关 modal，
      // 导致 React 在 commit iframe DOM 之前就把分支卸载，payFormHtml 永远不显示。
      // 用户明示「完成本轮流程」（点 iframe 分支的「稍后」）时再通知父级。
      setOrder(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('providers.nxgd.recharge.failed'));
    } finally {
      setPaying(false);
    }
  };

  if (order) {
    // 拿到 payFormHtml → 嵌入 iframe，并按 API 规范自动提交。
    // 规范（docs/广电token平台API接口.md §309-323）明示 payFormHtml 只含 <form action="..."> 裸 markup，
    // 没有 submit 按钮，客户端必须注入 script 调 form.submit() 触发跳转。
    // 包到 <div id="alipay-wap-pay"> 里 + 同源 script 调 .submit()，与官方示例一致。
    // sandbox 保持 allow-forms allow-scripts allow-same-origin（pit-of-success：allow-top-navigation 禁，
    // 否则 iframe 能把整个 app 跳到 alipay.com — 让支付流程留在 iframe 内即可）。
    const iframeSrcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="alipay-wap-pay">${order.payFormHtml}</div><script>document.querySelector('#alipay-wap-pay form').submit();</script></body></html>`;
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--ink-muted)]">
          {t('providers.nxgd.recharge.iframeHint')}
        </p>
        <iframe
          title={t('providers.nxgd.recharge.iframeTitle')}
          srcDoc={iframeSrcDoc}
          sandbox="allow-forms allow-scripts allow-same-origin"
          className="h-64 w-full rounded-lg border border-[var(--line)] bg-white"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              // 用户明示「完成本轮流程」：通知父级关闭 + 刷新余额。
              // 父级两个调用方（Settings / Chat）的 onCompleted 语义都是「关闭 + 可选 refresh」，
              // 同时再调 onCancel 仅在父级 onCancel 与 onCompleted 不一致时有副作用 —— 当前两者都是 close，安全双发。
              onCompleted?.(order);
              onCancel?.();
            }}
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
      {userId != null && userId > 0 && (
        <p className="font-mono text-xs text-[var(--ink-subtle)]">
          {t('providers.nxgd.recharge.userId', { id: userId })}
        </p>
      )}
      <div className="grid grid-cols-5 gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { setAmount(preset); setCustomAmount(''); void submit(); }}
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
          onBlur={() => { if (valid && !paying) void submit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid && !paying) void submit(); }}
          placeholder={t('providers.nxgd.recharge.customPlaceholder')}
          disabled={paying}
          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        />
      </label>

      {error && (
        <p className="break-words text-xs text-[var(--error)]">{error}</p>
      )}

      <div className="flex justify-end">
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
      </div>
    </div>
  );
}