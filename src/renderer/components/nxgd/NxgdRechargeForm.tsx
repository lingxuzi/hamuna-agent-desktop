/**
 * 广电充值表单 — Settings 卡片 + Chat 余额不足弹窗共用。
 * 内含：金额选择（10/30/50/100/200 预设 + 「自定义」按钮）+ 显式「去支付」按钮
 * 点「去支付」后调 /api/nxgd/recharge 拿 checkoutUrl，openExternal 走系统默认浏览器打开
 * （Tauri shell.open / 浏览器模式 window.open fallback）。user 在 OS 浏览器完成支付后
 * 回 app 点「稍后」即可。
 *
 * 为何要显式「去支付」按钮（不在 preset 点击时自动跳）：
 *  - user 拍板"不要用户选了金额自动跳转" —— 选金额 ≠ 确认支付，避免误触
 *  - 选金额 → 看一眼 → 点「去支付」→ 跳浏览器，三步走符合支付 UX 惯例（淘宝 / 微信支付同款）
 *
 * 为何不用内嵌 iframe：
 *  - 上游（v6 起）直接返 `checkoutUrl` 收银台 URL，**不再**返 payFormHtml —— 旧 iframe 流
 *    (v1~v5: srcDoc 渲染 payFormHtml + sandbox 阻断 auto-submit) 完全废弃
 *  - 走系统浏览器而非内嵌：user 已有支付 cookie / 密码管理器 / 多端一致体验；
 *    内嵌 iframe 反而要解决 sandbox + 跨域 cookie + 支付宝风控
 *
 * 「预设 vs 自定义」互斥：点 ¥X 预设 → 进入 preset mode；点「自定义」→ 进入 custom mode
 * 且下方显示输入框；切换 mode 时另一边选择清空。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiPostJson } from '@/api/apiFetch';
import { openExternal } from '@/utils/openExternal';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200] as const;

interface RechargeResult {
  orderNo: string;
  checkoutUrl: string;
  expiresAt: string;
}

type Mode = 'preset' | 'custom';

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
  const [mode, setMode] = useState<Mode>('preset');
  const [amount, setAmount] = useState<number>(50);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<RechargeResult | null>(null);

  const effectiveAmount = mode === 'custom' ? Number(customAmount) : amount;
  const valid = Number.isFinite(effectiveAmount) && effectiveAmount >= 0.1 && effectiveAmount <= 5000;

  // 调系统默认浏览器打开收银台（Tauri shell.open / 浏览器模式 window.open fallback）。
  // 失败时不抛 — user 可以再点「重新打开支付页面」按钮兜底（popup blocker 场景）。
  const openCheckout = (url: string) => { void openExternal(url); };

  // 显式「去支付」点击 → POST → setOrder → 打开收银台。选金额（preset 点击 / custom 输入）
  // 不再触发任何自动提交，符合 user 拍板的"选金额 ≠ 确认支付"。
  const handleGoPay = async () => {
    if (!valid || paying) return;
    setPaying(true);
    setError(null);
    try {
      const result = await apiPostJson<RechargeResult>('/api/nxgd/recharge', { amount: effectiveAmount });
      // 不在这里同步调 onCompleted —— 父级 handler 通常会立即关 modal，
      // 导致 React 在 commit 当前分支之前就把分支卸载，order summary 永远不显示。
      // 用户明示「完成本轮流程」（点「稍后」）时再通知父级。
      setOrder(result);
      openCheckout(result.checkoutUrl);
    } catch (err) {
      // 服务端返 `{ error, message, status }`（`src/server/index.ts:4553-4568`）：
      //  - err.message = code（如 'recharge-failed'）—— `apiFetch.ts::buildApiError` 注入
      //  - err.serverMessage = 服务端真实原因（如 "recharge failed (code 403)" / "fetch failed"）
      // 优先级：serverMessage > i18n fallback；裸 code 单独显示对用户 / 排查都没价值，
      // serverMessage 才有"为什么失败"信息。i18n 仅在 serverMessage 缺失时兜底。
      const code = err instanceof Error ? err.message : '';
      const serverMessage = err && typeof err === 'object' && 'serverMessage' in err
        ? (err as { serverMessage?: string }).serverMessage : undefined;
      const fallback = t('providers.nxgd.recharge.failed');
      setError(serverMessage?.trim() || fallback);
      // code 留作 console 日志用于排查（不显示给用户）
      console.error('[nxgd] recharge failed', { code, serverMessage });
    } finally {
      setPaying(false);
    }
  };

  if (order) {
    return (
      <div className="space-y-3">
        {/* 订单摘要：orderNo / 金额 / 过期时间 —— 给用户可视锚点，不依赖外部浏览器也能核对 */}
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
          {t('providers.nxgd.recharge.openedHint')}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => openCheckout(order.checkoutUrl)}
            className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper-inset)]"
          >
            {t('providers.nxgd.recharge.reopen')}
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
      <div className="grid grid-cols-6 gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { setMode('preset'); setAmount(preset); }}
            disabled={paying}
            className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
              mode === 'preset' && amount === preset
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--paper-inset)]'
            }`}
          >
            ¥{preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setMode('custom'); setCustomAmount(''); }}
          disabled={paying}
          className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
            mode === 'custom'
              ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
              : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--paper-inset)]'
          }`}
        >
          {t('providers.nxgd.recharge.custom')}
        </button>
      </div>

      {mode === 'custom' && (
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
            autoFocus
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
          />
        </label>
      )}

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
          onClick={handleGoPay}
          disabled={!valid || paying}
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('providers.nxgd.recharge.modal.goPay')}
        </button>
      </div>
    </div>
  );
}