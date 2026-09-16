/**
 * 广电充值表单 — Settings 卡片 + Chat 余额不足弹窗共用。
 * 内含：金额选择（10/30/50/100/200 预设 + 自定义）+ 调 /api/nxgd/recharge
 * 拿到 payFormHtml 后**解析**出 action/method/inputs，渲染到 iframe 作为只读预览，
 * 真正提交的 form 在用户点「去支付宝支付」时由 JS 动态构建到 iframe.contentDocument 内，
 * 再调 submit() —— iframe 跳到 alipay.com 收银台，用户在 iframe 内付款。
 *
 * 为何不直接 srcDoc={payFormHtml}：
 *  - 只含 <form action="..."> + hidden inputs，没有可见内容，原样嵌入 iframe 也是空白
 *  - 上游（Alipay 标准 PC 收银台）常在 payFormHtml 内嵌 `<script>form.submit()</script>`，
 *    用 srcDoc 会立即 auto-submit 跳走，user 看不到表单 + iframe 跳到浏览器收银台
 * 解析 + 重构表单既给 user 可视预览，也彻底切断上游的 auto-submit。
 *
 * 提交：预设金额点击立即提交；自定义金额 onBlur / Enter 提交。无显式「确认充值」按钮。
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiPostJson } from '@/api/apiFetch';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200] as const;

interface RechargeResult {
  orderNo: string;
  payFormHtml: string;
  expiresAt: string;
}

interface ParsedPayForm {
  action: string;
  method: string;
  /** form 内 <input name value> 对，去除 name 为空者 */
  inputs: Array<{ name: string; value: string }>;
}

/** 用 DOMParser 解 payFormHtml —— 跨浏览器安全（Chromium/WebKit 都内置 DOMParser）。 */
function parsePayFormHtml(html: string): ParsedPayForm | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form');
    if (!form) return null;
    const inputs = Array.from(form.querySelectorAll('input'))
      .map((el) => ({
        name: el.getAttribute('name') ?? '',
        value: el.getAttribute('value') ?? '',
      }))
      .filter((i) => i.name.length > 0);
    return {
      action: form.getAttribute('action') ?? '',
      method: (form.getAttribute('method') ?? 'POST').toUpperCase(),
      inputs,
    };
  } catch {
    return null;
  }
}

/** HTML attribute 转义 —— form 字段值可能含 `"` `<` `>` 等（极少但 sign 值里有 `&`）。 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把解析出的 form fields 渲染成可读表格（iframe 内容）。 */
function buildPreviewHtml(parsed: ParsedPayForm): string {
  const rows = parsed.inputs.map(({ name, value }) =>
    `<tr><td>${escapeAttr(name)}</td><td>${escapeAttr(value)}</td></tr>`,
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:8px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;background:#fafafa;color:#333;}
table{width:100%;border-collapse:collapse;}
td{padding:4px 6px;border-bottom:1px solid #eee;word-break:break-all;vertical-align:top;}
td:first-child{color:#666;width:32%;font-family:ui-monospace,Menlo,monospace;}
caption{font-size:10px;color:#999;padding-bottom:6px;text-align:left;caption-side:top;}
</style></head><body><table><caption>支付表单字段（只读预览 · ${parsed.inputs.length} 项）</caption>${rows}</table></body></html>`;
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const effectiveAmount = customAmount ? Number(customAmount) : amount;
  const valid = Number.isFinite(effectiveAmount) && effectiveAmount >= 0.1 && effectiveAmount <= 5000;

  // 解析 payFormHtml —— 只算一次，结果 memo 避免重渲染重复 parse
  const parsedPayForm = useMemo(
    () => (order ? parsePayFormHtml(order.payFormHtml) : null),
    [order],
  );

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

  // 手动提交：在 iframe.contentDocument 里动态构建一个**纯净的** form（无 auto-submit script，
  // 无原始 payFormHtml 任何 markup），再调 .submit() —— iframe 跳到 alipay.com。
  // sandbox 包含 allow-forms（form submit）+ allow-same-origin（父 frame 可访问 contentDocument 注入节点），
  // 不加 allow-scripts（我们不需要在 iframe 内跑 JS）+ 不加 allow-top-navigation
  // （pit-of-success 红线 —— 否则 form submit 跳走的是整个 app 窗口，不是 iframe）。
  const submitIframeForm = () => {
    if (!parsedPayForm) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const form = doc.createElement('form');
    form.method = parsedPayForm.method;
    form.action = parsedPayForm.action;
    for (const { name, value } of parsedPayForm.inputs) {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    doc.body.appendChild(form);
    form.submit();
  };

  if (order) {
    return (
      <div className="space-y-3">
        {/* 订单摘要：orderNo / 金额 / 过期时间 —— 给用户可视锚点，不依赖 iframe 也能核对 */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-inset)] px-3 py-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--ink-muted)]">{t('providers.nxgd.recharge.summary.orderNo')}</span>
            <span className="font-mono text-[var(--ink)]">{order.orderNo}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-[var(--ink-muted)]">{t('providers.nxgd.recharge.summary.amount')}</span>
            <span className="font-mono text-[var(--ink)]">¥{effectiveAmount.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-[var(--ink-muted)]">{t('providers.nxgd.recharge.summary.expiresAt')}</span>
            <span className="font-mono text-[var(--ink)]">{new Date(order.expiresAt).toLocaleTimeString()}</span>
          </div>
        </div>

        <p className="text-sm text-[var(--ink-muted)]">
          {t('providers.nxgd.recharge.iframeHint')}
        </p>

        {/* iframe 仅渲染只读预览（parsedPayForm 决定的 key-value 表），不嵌入原始 payFormHtml
            —— 切断上游可能的 auto-submit script，也给用户可见的字段核对界面 */}
        {parsedPayForm ? (
          <iframe
            ref={iframeRef}
            title={t('providers.nxgd.recharge.iframeTitle')}
            srcDoc={buildPreviewHtml(parsedPayForm)}
            sandbox="allow-forms allow-same-origin"
            className="h-40 w-full rounded-lg border border-[var(--line)] bg-white"
          />
        ) : (
          <p className="text-xs text-[var(--error)]">{t('providers.nxgd.recharge.parseFailed')}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={submitIframeForm}
            disabled={!parsedPayForm}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('providers.nxgd.recharge.modal.goPay')}
          </button>
          <button
            type="button"
            onClick={() => {
              // 用户明示「完成本轮流程」：通知父级关闭 + 刷新余额。
              onCompleted?.(order);
              onCancel?.();
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            {cancelLabel ?? t('providers.nxgd.recharge.modal.later')}
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