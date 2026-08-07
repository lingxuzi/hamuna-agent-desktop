/**
 * WorkspaceConfigV2 — v2 Workspace Config overlay per the [final] HivP2
 * "Workspace Config — A: 文档编辑器风格（Notion 式）" comp. Rendered as a full-
 * screen overlay covering the app chrome (its own OverlayHeader, no TabBar),
 * reached via `/#workspace-config` for smoke testing.
 *
 * Header: sliders icon + title, the five config tabs (通用 active with an
 * underline, rest inactive — static), and a close button. Body: a centered
 * 672w column with the 基础设置 card (workspace name + path inputs) and the
 * 主动 Agent 模式 card (heart-pulse icon + desc + an on-state toggle). Footer:
 * "按 Esc 关闭 · 配置修改会立即生效".
 *
 * The tab active state and toggle are static; the design's terracotta #C4956A
 * maps to --accent-warm, and the toggle-on fill #7B8F6B is --accent-primary.
 *
 * Font notes: 18px title → text-lg, 16px card titles → text-base, 14/13px
 * labels → text-sm, 12px hints → text-xs — all locked steps.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Settings2, HeartPulse, X } from 'lucide-react';

const TABS = [
    { key: 'general', active: true },
    { key: 'systemPrompts', active: false },
    { key: 'introduction', active: false },
    { key: 'skills', active: false },
] as const;

export default memo(function WorkspaceConfigV2() {
    const { t } = useTranslation('app');

    return (
        <div className="relative z-50 flex h-screen w-full flex-col bg-[var(--paper)]">
            {/* Overlay header */}
            <header className="flex h-16 shrink-0 items-center justify-between px-7">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ink)] text-[var(--paper)]">
                        <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <h1 className="text-lg font-semibold text-[var(--ink)]">{t('v2.workspaceConfig.panelTitle')}</h1>
                </div>

                <div className="flex items-center gap-4 pl-6">
                    {TABS.map((tab) => (
                        <span
                            key={tab.key}
                            className={
                                tab.active
                                    ? 'text-sm font-medium text-[var(--accent-warm)]'
                                    : 'text-sm font-medium text-[var(--ink-muted)]'
                            }
                        >
                            {t(`v2.workspaceConfig.tab${tab.key[0].toUpperCase()}${tab.key.slice(1)}`)}
                            {tab.active && (
                                <span className="mt-0.5 block h-0.5 w-6 rounded-full bg-[var(--accent-warm)]" />
                            )}
                        </span>
                    ))}
                </div>

                <div className="flex h-8 w-10 items-center justify-center rounded-[10px] bg-[var(--paper-inset)]">
                    <X className="h-5 w-5 text-[var(--ink-muted)]" />
                </div>
            </header>

            {/* Body */}
            <div className="flex min-h-0 flex-1 flex-col bg-[var(--paper)]">
                <div className="min-h-0 flex-1 overflow-y-auto py-6">
                    <div className="mx-auto flex w-[672px] flex-col gap-6 pb-6">
                        {/* Basics card */}
                        <section className="flex flex-col gap-4 rounded-xl bg-[var(--paper-elevated)] p-5">
                            <div className="flex items-center gap-2">
                                <Settings2 className="h-[18px] w-[18px] text-[var(--ink-muted)]" />
                                <h2 className="text-base font-medium text-[var(--ink)]">
                                    {t('v2.workspaceConfig.basicsTitle')}
                                </h2>
                            </div>

                            <div className="flex w-[400px] flex-col gap-3">
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-xs text-[var(--ink-muted)]">
                                        {t('v2.workspaceConfig.nameLabel')}
                                    </span>
                                    <span className="flex h-9 items-center rounded-md bg-[var(--paper-inset)] px-3 text-sm text-[var(--ink)]">
                                        {t('v2.workspaceConfig.nameValue')}
                                    </span>
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-xs text-[var(--ink-muted)]">
                                        {t('v2.workspaceConfig.pathLabel')}
                                    </span>
                                    <span className="flex h-9 items-center rounded-md bg-[var(--paper-inset)] px-3 text-sm text-[var(--ink-secondary)]">
                                        {t('v2.workspaceConfig.pathValue')}
                                    </span>
                                </label>
                            </div>
                        </section>

                        {/* Proactive agent card */}
                        <section className="flex flex-col gap-4 rounded-xl bg-[var(--paper-elevated)] p-5">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                        <HeartPulse className="h-[18px] w-[18px] text-[var(--ink)]" />
                                        <h2 className="text-base font-medium text-[var(--ink)]">
                                            {t('v2.workspaceConfig.proactiveTitle')}
                                        </h2>
                                    </div>
                                    <p className="text-xs text-[var(--ink-muted)]">
                                        {t('v2.workspaceConfig.proactiveDesc')}
                                    </p>
                                </div>

                                {/* Toggle — on state */}
                                <span
                                    role="switch"
                                    aria-checked="true"
                                    className="flex h-6 w-11 shrink-0 items-center justify-end rounded-full bg-[var(--accent-primary)] p-0.5"
                                >
                                    <span className="h-5 w-5 rounded-full bg-[var(--on-accent)]" />
                                </span>
                            </div>
                        </section>
                    </div>
                </div>

                {/* Footer */}
                <footer className="flex h-8 shrink-0 items-center justify-center bg-[var(--paper-inset)] px-6 text-xs text-[var(--ink-muted)]">
                    {t('v2.workspaceConfig.footerHint')}
                </footer>
            </div>
        </div>
    );
});
