/**
 * nxgd 首次启动向导 — 右下浮窗，5 段渐进引导。
 *
 * 视觉决策（避免 AI-default 套路）：
 *  - 不用 cream + terracotta SaaS kit；用广电红 #C8401B + paper #FBFAF7 单一记忆点
 *  - 不用 16px 圆角 SaaS card；corner 8px
 *  - 不用 ALL-CAPS eyebrow / 01/02/03 序号；用 5-dot 进度条（第 N 段亮红，其它 ink-muted）
 *  - 段间单一节奏 200ms opacity transition，不堆砌多动效
 *
 * 行为：
 *  - 窄条 pill 态默认可见，点开 → 展开 5 段卡片
 *  - Esc / 稍后再说 / X / Cmd+W / 跑完 5 段 → onClose
 *  - step 4 选「不充」→ 直接 step 5；选「充 ¥X」→ 调 onRecharge 打开 NxgdRechargeModal，wizard 保持打开
 *  - step 5 「去 Chat」按钮 auto-focus
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCloseLayer } from '@/hooks/useCloseLayer';
import { apiPostJson } from '@/api/apiFetch';
import { openExternal } from '@/utils/openExternal';
import { discoverNxgdModels } from '@/config/services/nxgdSubscriptionService';
import OverlayBackdrop from './OverlayBackdrop';

const NXGD_RED = '#C8401B';
const TOTAL_STEPS = 5;

// preset choice → 充值金额。'custom' 走输入框，'none' = 不充（不进这表）。
const PRESET_AMOUNTS: Record<'30' | '100', number> = {
  '30': 30,
  '100': 100,
};
const MIN_CUSTOM_AMOUNT = 0.1;
const MAX_AMOUNT = 5000;

export type NxgdAuthStatus = 'idle' | 'registering' | 'registered' | 'error';

export interface NxgdOnboardingAuthLite {
  status: NxgdAuthStatus;
  registered: boolean;
  setup: boolean;
}

export interface NxgdOnboardingBalanceLite {
  balance: number | null;
  usedBalance: number | null;
}

export interface NxgdOnboardingWizardProps {
  auth: NxgdOnboardingAuthLite;
  balance: NxgdOnboardingBalanceLite | null;
  primaryModel: string;
  primaryModelLabel?: string;
  /**
   * 关闭后触发；wizard 内部会 fire-and-forget 调 `/api/nxgd/auth/setup` 写 setup:true。
   * 若用户在 step 2 选了 model，关闭前还会调 onPinModel 把该 model 写入
   * `presetCustomModels[nxgd]`（一次性免空下拉）。失败不阻塞 wizard 关闭。
   */
  onClose: () => void;
  /** 把 user 选中的 model pin 进 presetCustomModels；wizard 关闭前 fire-and-forget 调用。 */
  onPinModel?: (modelId: string, displayName?: string) => Promise<void>;
}

type RechargeChoice = 'none' | '30' | '100' | 'custom';

interface CandidateModel {
  id: string;
  displayName: string;
}

export default function NxgdOnboardingWizard({
  auth,
  balance,
  primaryModel,
  primaryModelLabel,
  onClose,
  onPinModel,
}: NxgdOnboardingWizardProps) {
  const { t } = useTranslation('app');
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [rechargeChoice, setRechargeChoice] = useState<RechargeChoice>('none');
  const [customAmount, setCustomAmount] = useState<string>('');
  const [recharging, setRecharging] = useState(false);
  const [rechargeError, setRechargeError] = useState<string | null>(null);
  // step 2 自 fetch：discovery 失败 fallback 到 primaryModel 单选（仍可推进）
  const [candidates, setCandidates] = useState<CandidateModel[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [pickedModelId, setPickedModelId] = useState<string>(primaryModel);
  const step5ButtonRef = useRef<HTMLButtonElement | null>(null);
  // step 2 列表可能 N>5（上游多 model），滚动容器 + 每个 card 的 ref 用于 picked
  // 改变时 scrollIntoView，保持选中视觉边框可见。
  const candidatesScrollRef = useRef<HTMLDivElement | null>(null);
  const candidateCardRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // 展开时拉一次候选列表（pill 折叠态不拉，避免挂载期抢资源）
  useEffect(() => {
    if (!expanded || candidates.length > 0 || candidatesLoading) return;
    let cancelled = false;
    setCandidatesLoading(true);
    discoverNxgdModels()
      .then((models) => {
        if (cancelled) return;
        const list: CandidateModel[] = models.length > 0
          ? models.map(m => ({ id: m.id, displayName: m.displayName ?? m.id }))
          : [{ id: primaryModel, displayName: primaryModelLabel ?? primaryModel }];
        setCandidates(list);
        // 默认选 primaryModel（若在列表中）；否则选第一个
        const defaultPick = list.some(m => m.id === primaryModel)
          ? primaryModel
          : list[0].id;
        setPickedModelId(defaultPick);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[nxgd-wizard] discover failed, falling back to primaryModel', err);
        setCandidates([{ id: primaryModel, displayName: primaryModelLabel ?? primaryModel }]);
        setPickedModelId(primaryModel);
      })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, primaryModel, primaryModelLabel]);

  // custom 金额校验：NaN / 0 / 负 / 越界 → 按钮 disabled
  const parsedCustom = Number.parseFloat(customAmount);
  const customValid = Number.isFinite(parsedCustom) && parsedCustom >= MIN_CUSTOM_AMOUNT && parsedCustom <= MAX_AMOUNT;
  const effectiveAmount: number | null = rechargeChoice === 'none'
    ? null
    : rechargeChoice === 'custom'
      ? (customValid ? parsedCustom : null)
      : PRESET_AMOUNTS[rechargeChoice];
  const ctaDisabled = recharging || (rechargeChoice !== 'none' && effectiveAmount === null);

  // 统一 close：先 fire-and-forget pin model（若选了）→ 写 setup:true → 触发父 onClose。
  // 任意路径（Cmd+W / Esc / X / "稍后" / step 5 "去 Chat"）都走这里。
  const closeAndMarkSetup = useCallback(() => {
    if (onPinModel && pickedModelId) {
      const candidate = candidates.find(c => c.id === pickedModelId);
      void onPinModel(pickedModelId, candidate?.displayName).catch((err: unknown) => {
        console.error('[nxgd-wizard] pin model failed', err);
      });
    }
    void apiPostJson('/api/nxgd/auth/setup', {}).catch((err: unknown) => {
      console.error('[nxgd-wizard] mark setup failed', err);
    });
    onClose();
  }, [onClose, onPinModel, pickedModelId, candidates]);

  // Cmd+W 关闭（handler 返回 true 表示消费掉 close 事件，不冒泡到下一层）
  useCloseLayer(() => {
    closeAndMarkSetup();
    return true;
  }, 240);

  // Esc 关闭（keydown handler 直接挂在 window 上）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndMarkSetup();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeAndMarkSetup]);

  // step 5 切到后把「去 Chat」按钮聚焦
  useEffect(() => {
    if (step === 5) {
      step5ButtonRef.current?.focus();
    }
  }, [step]);

  // step 2：用户切换 pickedModelId → 把对应 card 滚到容器可视区（nearest，
  // 已经在视口里就不动；smooth 让翻页不突兀）。屏幕阅读器无影响。
  useEffect(() => {
    if (step !== 2) return;
    const card = candidateCardRefs.current.get(pickedModelId);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pickedModelId, step]);

  const handleStepAdvance = () => {
    setStep((s) => (s < TOTAL_STEPS ? ((s + 1) as 1 | 2 | 3 | 4 | 5) : s));
  };

  const handleRechargeConfirm = async () => {
    if (rechargeChoice === 'none' || effectiveAmount === null || recharging) {
      if (rechargeChoice === 'none') handleStepAdvance();
      return;
    }
    setRecharging(true);
    setRechargeError(null);
    try {
      // 直接调 recharge endpoint 拿收银台 URL —— 不走 NxgdRechargeModal 中转，
      // first-run wizard 的 "充 ¥30" 路径应是 1 步到浏览器。Modal 文案"余额不足"
      // 在首启语境下也不合适。
      const result = await apiPostJson<{ checkoutUrl: string }>('/api/nxgd/recharge', { amount: effectiveAmount });
      void openExternal(result.checkoutUrl);
    } catch (err) {
      const serverMessage = err && typeof err === 'object' && 'serverMessage' in err
        ? (err as { serverMessage?: string }).serverMessage : undefined;
      const code = err instanceof Error ? err.message : '';
      console.error('[nxgd-wizard] recharge failed', { code, serverMessage });
      setRechargeError(serverMessage?.trim() || t('wizard.step4.errorFallback'));
    } finally {
      setRecharging(false);
    }
  };

  const handleFinish = closeAndMarkSetup;

  // 全屏半透 overlay + 右下 wizard —— OverlayBackdrop 已 pit-of-success 内嵌正确
  // onMouseDown 文本拖选 dismiss 防护。点 overlay 不关 wizard：omit onClose（first-run
  // 引导应强制走完 5 段或显式 Esc/X，误点 overlay 不应 dismiss）。
  const wizardContent = !expanded ? (
      <div
        className="absolute bottom-6 right-6 flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--paper-elevated)] px-4 py-2 shadow-md"
        role="complementary"
        aria-label={t('wizard.pill')}
      >
        <span className="inline-block size-2 rounded-full" style={{ background: NXGD_RED }} aria-hidden />
        <span className="text-sm text-[var(--ink)]">{t('wizard.pill')}</span>
        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ color: NXGD_RED }}
          onClick={() => setExpanded(true)}
        >
          {t('wizard.pillCta')}
        </button>
        <button
          type="button"
          className="ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          onClick={closeAndMarkSetup}
          aria-label={t('wizard.laterCta')}
        >
          ×
        </button>
      </div>
    ) : (
      <div
        className="absolute bottom-6 right-6 w-[420px] max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] p-6 shadow-md"
        role="dialog"
        aria-modal="false"
      aria-labelledby="nxgd-onboarding-title"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="nxgd-onboarding-title" className="text-base font-semibold text-[var(--ink)]">
          {t(`wizard.step${step}.title`)}
        </h2>
        <button
          type="button"
          className="text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          onClick={closeAndMarkSetup}
          aria-label={t('wizard.laterCta')}
        >
          ×
        </button>
      </div>

      <ProgressDots current={step} />

      <div className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]" key={step}>
        {step === 1 && t('wizard.step1.body')}
        {step === 2 && (
          <div>
            <p className="mb-3">{t('wizard.step2.body')}</p>
            {candidatesLoading ? (
              <p className="text-xs text-[var(--ink-muted)]" data-testid="nxgd-wizard-candidates-loading">
                {t('wizard.step2.loading')}
              </p>
            ) : (
              <div
                ref={candidatesScrollRef}
                className="flex max-h-72 flex-col gap-2 overflow-y-auto"
                data-testid="nxgd-wizard-model-list"
              >
                {candidates.map((candidate) => {
                  const selected = candidate.id === pickedModelId;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      ref={(el) => { candidateCardRefs.current.set(candidate.id, el); }}
                      onClick={() => setPickedModelId(candidate.id)}
                      data-testid="nxgd-wizard-model-card"
                      className="rounded-md border p-3 text-left transition-colors hover:border-[var(--accent)]"
                      style={{
                        borderColor: selected ? NXGD_RED : 'var(--line)',
                        background: selected ? 'var(--paper-inset)' : 'var(--paper)',
                        color: 'var(--ink)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 rounded-full border-2"
                          style={{
                            borderColor: NXGD_RED,
                            background: selected ? NXGD_RED : 'transparent',
                          }}
                          aria-hidden
                        />
                        <span className="font-medium">{candidate.displayName}</span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-[var(--ink-muted)]">{candidate.id}</p>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--ink-muted)]">{t('wizard.step2.modelBadge')}</p>
          </div>
        )}
        {step === 3 && (
          <div>
            <p className="mb-2">{t('wizard.step3.body')}</p>
            <BalanceProgress
              balance={balance?.balance ?? null}
              usedBalance={balance?.usedBalance ?? null}
            />
            <p className="mt-2 text-xs">
              {auth.status === 'registered'
                ? t('wizard.step3.registered')
                : t('wizard.step3.loading')}
            </p>
          </div>
        )}
        {step === 4 && (
          <div>
            <p className="mb-3">{t('wizard.step4.body')}</p>
            <div className="grid grid-cols-2 gap-2">
              {(['none', '30', '100', 'custom'] as RechargeChoice[]).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  data-testid={`nxgd-wizard-recharge-${choice}`}
                  className="rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: rechargeChoice === choice ? NXGD_RED : 'var(--line)',
                    background: rechargeChoice === choice ? 'var(--paper-inset)' : 'var(--paper)',
                    color: 'var(--ink)',
                  }}
                  onClick={() => { setRechargeChoice(choice); setRechargeError(null); }}
                  disabled={recharging}
                >
                  {t(`wizard.step4.options.${choice}`)}
                </button>
              ))}
            </div>
            {rechargeChoice === 'custom' && (
              <label className="mt-2 block">
                <span className="text-xs text-[var(--ink-muted)]">{t('wizard.step4.customHint')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_CUSTOM_AMOUNT}
                  max={MAX_AMOUNT}
                  step={0.01}
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setRechargeError(null); }}
                  placeholder={t('wizard.step4.customPlaceholder')}
                  disabled={recharging}
                  data-testid="nxgd-wizard-custom-amount"
                  className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
                />
              </label>
            )}
            {rechargeError && (
              <p className="mt-2 break-words text-xs text-[var(--error)]" data-testid="nxgd-wizard-recharge-error">
                {rechargeError}
              </p>
            )}
          </div>
        )}
        {step === 5 && (
          <div>
            <p>{t('wizard.step5.body')}</p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              {t('wizard.step5.meta')}
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          onClick={closeAndMarkSetup}
        >
          {t('wizard.laterCta')}
        </button>
        {step === 1 && (
          <PrimaryButton onClick={handleStepAdvance}>
            {t('wizard.step1.cta')}
          </PrimaryButton>
        )}
        {step === 2 && (
          <PrimaryButton onClick={handleStepAdvance}>
            {t('wizard.step2.cta')}
          </PrimaryButton>
        )}
        {step === 3 && (
          <PrimaryButton onClick={handleStepAdvance}>
            {t('wizard.step3.cta')}
          </PrimaryButton>
        )}
        {step === 4 && (
          <PrimaryButton
            onClick={handleRechargeConfirm}
            disabled={ctaDisabled}
          >
            {recharging
              ? t('wizard.step4.ctaLoading')
              : rechargeChoice === 'none'
                ? t('wizard.step4.ctaSkip')
                : t('wizard.step4.cta')}
          </PrimaryButton>
        )}
        {step === 5 && (
          <PrimaryButton ref={step5ButtonRef} onClick={handleFinish}>
            {t('wizard.step5.cta')}
          </PrimaryButton>
        )}
      </div>
      </div>
    );

  return (
    <OverlayBackdrop className="z-[240]">
      {wizardContent}
    </OverlayBackdrop>
  );
}

function ProgressDots({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="flex items-center gap-2" aria-label={`step ${current} of ${TOTAL_STEPS}`}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className="inline-block size-1.5 rounded-full transition-opacity"
          style={{
            background: n === current ? NXGD_RED : 'var(--ink-muted)',
            opacity: n === current ? 1 : 0.4,
          }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function BalanceProgress({
  balance,
  usedBalance,
}: {
  balance: number | null;
  usedBalance: number | null;
}) {
  const total = (balance ?? 0) + (usedBalance ?? 0);
  const usedPct = total > 0 ? Math.min(100, ((usedBalance ?? 0) / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--ink-muted)]">
        <span>¥{(usedBalance ?? 0).toFixed(2)}</span>
        <span>¥{(balance ?? 0).toFixed(2)}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--paper-inset)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${usedPct}%`, background: NXGD_RED }}
        />
      </div>
    </div>
  );
}

const PrimaryButton = ({
  children,
  onClick,
  disabled,
  ref,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    style={{ background: NXGD_RED }}
  >
    {children}
  </button>
);