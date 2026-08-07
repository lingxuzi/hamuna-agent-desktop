/**
 * AgentPanel — left status rail of the v2 Chat (CZuvC). 260px warm-inset panel:
 * panel header, a status card (model / context usage), the context progress bar,
 * and the pending-tasks list. Values are static for now — the comp is a visual
 * prototype; live agent state hooks in later (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface AgentPanelProps {
    /** Active model id (mono, e.g. "claude-sonnet"). */
    model?: string;
    /** Context usage percent, 0-100. */
    contextPct?: number;
    /** Pending-actions list — each shown as a warm-dot mono row. */
    tasks?: string[];
}

export default memo(function AgentPanel({
    model = 'claude-sonnet',
    contextPct = 42,
    tasks = ['读取 App.tsx', '重构 session 模块'],
}: AgentPanelProps) {
    const { t } = useTranslation('app');
    const pct = Math.min(100, Math.max(0, contextPct));

    return (
        <aside className="flex w-[260px] shrink-0 flex-col gap-4 overflow-y-auto bg-[var(--paper-inset)] px-3.5 py-4">
            <h2 className="text-xs font-semibold tracking-[0.3px] text-[var(--ink-muted)]">
                {t('v2.chat.agentPanelTitle')}
            </h2>

            {/* Status card */}
            <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-3">
                <StatusRow label={t('v2.chat.currentModel')} value={model} mono />
                <StatusRow
                    label={t('v2.chat.ctxLabel')}
                    value={t('v2.chat.ctxValue', { pct })}
                    accent
                    mono
                />
            </div>

            {/* Context bar */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--paper-inset)]">
                <div
                    className="h-full rounded-full bg-[var(--accent-primary)]"
                    style={{ width: `${pct}%` }}
                />
            </div>

            {/* Pending tasks */}
            <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-[0.3px] text-[var(--ink-muted)]">
                    {t('v2.chat.pendingTasks')}
                </h3>
                {tasks.map((task) => (
                    <div
                        key={task}
                        className="flex items-center gap-2 rounded-md border border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-2.5 py-2"
                    >
                        <span className="text-xs text-[var(--accent-warm)]" aria-hidden="true">•</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">
                            {task}
                        </span>
                    </div>
                ))}
            </div>
        </aside>
    );
});

/** Label / value row — value mono, optionally accent-colored. */
function StatusRow({
    label,
    value,
    accent,
    mono,
}: {
    label: string;
    value: string;
    accent?: boolean;
    mono?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs text-[var(--ink-muted)]">{label}</span>
            <span
                className={`min-w-0 flex-1 truncate text-right text-xs ${
                    mono ? 'font-mono' : ''
                } ${accent ? 'text-[var(--accent-primary)]' : 'text-[var(--ink)]'}`}
            >
                {value}
            </span>
        </div>
    );
}
