/**
 * AgentDock — compact agent status pinned to the bottom of the FileTree (yzoEt).
 * Dock header + idle/busy status line + a slim context track. Static for now.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp } from 'lucide-react';

interface AgentDockProps {
    /** Number of in-flight tasks (0 = idle). */
    busyCount?: number;
    /** Context usage percent, 0-100. */
    contextPct?: number;
}

export default memo(function AgentDock({ busyCount = 3, contextPct = 42 }: AgentDockProps) {
    const { t } = useTranslation('app');
    const pct = Math.min(100, Math.max(0, contextPct));
    const busy = busyCount > 0;

    return (
        <div className="flex shrink-0 flex-col gap-3 px-3 pb-4 pt-4">
            {/* Dock header */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-[0.3px] text-[var(--ink-muted)]">
                    {t('v2.chat.agentDockTitle')}
                </span>
                <ChevronUp className="h-3.5 w-3.5 text-[var(--ink-subtle)]" aria-hidden="true" />
            </div>

            {/* Status line — 13px in the comp; closest locked step is text-xs (12px) */}
            <p className="text-xs text-[var(--ink)]">
                {busy
                    ? t('v2.chat.agentDockBusy', { count: busyCount })
                    : t('v2.chat.agentDockIdle')}
            </p>

            {/* Context track */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--paper-inset)]">
                <div
                    className="h-full rounded-full bg-[var(--accent-sky)]"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
});
