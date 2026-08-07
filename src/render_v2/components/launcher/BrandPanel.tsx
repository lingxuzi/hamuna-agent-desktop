/**
 * BrandPanel — left 60% of the v2 Launcher (qjQtx "品牌驱动" comp).
 *
 * Magazine-cover composition: sage logo mark + wordmark, a two-line serif
 * headline (the second line in accent), a muted supporting sub, and the
 * QuickInput card with its toolbar + context chips. Live per the comp —
 * the input is the launch affordance, but message composition lives in Chat,
 * so this panel only forwards the "launch" intent up.
 *
 * All visual values trace to theme tokens (--paper / --paper-elevated /
 * --ink / --accent-primary / --accent-warm-subtle, etc.).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { SendHorizontal, Plus, Plug, CalendarClock, Boxes, ChevronUp } from 'lucide-react';

interface BrandPanelProps {
    isLoading: boolean;
    onLaunchChat: (workspaceId?: string) => void;
}

export default memo(function BrandPanel({ isLoading, onLaunchChat }: BrandPanelProps) {
    const { t } = useTranslation('app');

    return (
        <section className="flex h-full w-[60%] min-w-0 shrink-0 flex-col justify-center gap-0 px-[72px] py-12">
            {/* Logo row */}
            <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-[var(--accent-primary)]" aria-hidden="true" />
                <span className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                    hamuna
                </span>
            </div>

            {/* Hero headline — serif, two lines, second line accent */}
            <div className="mt-[88px]">
                <h1 className="max-w-[600px] font-serif text-[52px] font-semibold leading-[1.28] tracking-[-0.02em] text-[var(--ink)]">
                    {t('v2.launcher.heroLine1')}
                    <br />
                    <span className="text-[var(--accent-primary)]">{t('v2.launcher.heroLine2')}</span>
                </h1>
                <p className="mt-7 max-w-[520px] font-sans text-[15px] leading-[1.6] text-[var(--ink-muted)]">
                    {t('v2.launcher.heroSub')}
                </p>
            </div>

            {/* Quick input card */}
            <div className="mt-14 flex max-w-[520px] flex-col gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-3 pb-2.5 pt-2.5">
                {/* Input area */}
                <button
                    type="button"
                    onClick={() => onLaunchChat()}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--paper-inset)]/50"
                >
                    <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
                    <span className="flex-1 truncate text-sm text-[var(--ink-subtle)]">
                        {t('v2.launcher.inputPlaceholder')}
                    </span>
                </button>

                {/* Toolbar */}
                <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-0.5">
                        <ToolBtn title={t('v2.launcher.attach')} ariaLabel={t('v2.launcher.attach')}>
                            <Plus className="h-4 w-4" />
                        </ToolBtn>
                        <ToolBtn title={t('v2.launcher.permission')} ariaLabel={t('v2.launcher.permission')}>
                            <span className="text-[13px]">⚡</span>
                            <span className="text-[13px] font-medium text-[var(--ink-muted)]">
                                {t('v2.launcher.permissionAuto')}
                            </span>
                            <ChevronUp className="h-3.5 w-3.5 text-[var(--ink-subtle)]" />
                        </ToolBtn>
                        <ToolBtn title={t('v2.launcher.tools')} ariaLabel={t('v2.launcher.tools')}>
                            <Plug className="h-4 w-4" />
                        </ToolBtn>
                        <ToolBtn title={t('v2.launcher.cron')} ariaLabel={t('v2.launcher.cron')}>
                            <CalendarClock className="h-4 w-4" />
                        </ToolBtn>
                    </div>

                    <div className="flex items-center gap-2">
                        <ToolBtn title={t('v2.launcher.chooseModel')} ariaLabel={t('v2.launcher.chooseModel')}>
                            <Boxes className="h-4 w-4" />
                            <span className="max-w-24 truncate text-[13px] font-medium text-[var(--ink-muted)]">
                                {t('v2.launcher.modelDefault')}
                            </span>
                        </ToolBtn>
                        <button
                            type="button"
                            onClick={() => onLaunchChat()}
                            title={t('v2.launcher.send')}
                            aria-label={t('v2.launcher.send')}
                            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-white transition-colors hover:bg-[var(--accent-primary-hover)]"
                        >
                            <SendHorizontal className="h-[15px] w-[15px]" />
                        </button>
                    </div>
                </div>

                {/* Context chips */}
                <div className="flex w-full items-center gap-2">
                    <Chip icon="🗂" label={t('v2.launcher.wsChip')} />
                    <Chip icon="🤖" label={t('v2.launcher.runtimeChip')} />
                </div>
            </div>

            {isLoading && (
                <p className="mt-3 text-xs text-[var(--ink-subtle)]" role="status">
                    {t('v2.inProgress')}
                </p>
            )}
        </section>
    );
});

/** Compact toolbar pill — 28px tall, no fill until hover, matches comp. */
function ToolBtn({ title, ariaLabel, children }: { title: string; ariaLabel: string; children: React.ReactNode }) {
    return (
        <button
            type="button"
            title={title}
            aria-label={ariaLabel}
            className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)]"
        >
            {children}
        </button>
    );
}

/** Small context chip — warm-tinted pill with emoji glyph + label. */
function Chip({ icon, label }: { icon: string; label: string }) {
    return (
        <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-warm-subtle)] px-2 text-xs font-medium text-[var(--ink-secondary)]">
            <span aria-hidden="true" className="text-[11px]">{icon}</span>
            <span className="truncate">{label}</span>
        </span>
    );
}
