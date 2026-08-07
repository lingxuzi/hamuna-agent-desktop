/**
 * RailPanel — right 40% of the v2 Launcher (qjQtx comp). A warm paper rail
 * (--paper-elevated, inner hairline + soft shadow) holding the workspace card
 * stack and the recent-session list. Cards render live workspace data; the
 * comp's staggered card offsets are an empty-state flourish.
 */
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '@/config/types';
import { getFolderName } from '@/types/tab';
import { shortenPathForDisplay } from '@/utils/pathDetection';
import { relativeTime } from '@/utils/taskCenterUtils';

import type { V2RecentSession } from '../../hooks/useLauncherData';

interface RailPanelProps {
    workspaces: Project[];
    recentSessions: V2RecentSession[];
    onLaunchChat: (workspaceId?: string) => void;
}

export default memo(function RailPanel({ workspaces, recentSessions, onLaunchChat }: RailPanelProps) {
    const { t } = useTranslation('app');
    // Top 3 for the stacked card flourish; the rest fold under (design shows 3).
    const top = useMemo(() => workspaces.slice(0, 3), [workspaces]);

    return (
        <section className="relative flex h-full w-[40%] min-w-0 shrink-0 flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--paper-elevated)] px-12 py-10">
            {/* Header */}
            <div className="flex w-full items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--ink)]">{t('v2.launcher.railTitle')}</h2>
                <button
                    type="button"
                    className="text-[13px] font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
                    onClick={() => onLaunchChat()}
                >
                    {t('v2.launcher.railNew')}
                </button>
            </div>

            {/* Workspace card stack */}
            <div className="mt-5 flex flex-col gap-3">
                {top.length === 0 && (
                    <p className="text-xs text-[var(--ink-subtle)]">{t('v2.launcher.emptyWorkspaces')}</p>
                )}
                {top.map((ws) => (
                    <WsCard key={ws.id} project={ws} onClick={() => onLaunchChat(ws.id)} />
                ))}
                {workspaces.length > 3 && (
                    <button
                        type="button"
                        onClick={() => onLaunchChat()}
                        className="self-end text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
                    >
                        {t('v2.launcher.viewAll', { count: workspaces.length })}
                    </button>
                )}
            </div>

            {/* Recent sessions */}
            <div className="mt-6">
                <h3 className="text-xs font-semibold text-[var(--ink-muted)]">{t('v2.launcher.recentTitle')}</h3>
            </div>
            <div className="mt-3 flex flex-col gap-3.5">
                {recentSessions.length === 0 ? (
                    <p className="text-xs text-[var(--ink-subtle)]">{t('v2.launcher.emptyRecent')}</p>
                ) : (
                    recentSessions.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => onLaunchChat()}
                            className="flex h-11 w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-left shadow-sm transition-colors hover:bg-[var(--paper-inset)]/60"
                        >
                            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--ink)]">
                                {s.title}
                            </span>
                            <span className="ml-3 shrink-0 text-[11.5px] text-[var(--ink-subtle)]">
                                {relativeTime(new Date(s.lastActiveAt).getTime())}
                            </span>
                        </button>
                    ))
                )}
            </div>
        </section>
    );
});

/** Workspace card — name, mono path, sage "最近" badge, session count. */
function WsCard({ project, onClick }: { project: Project; onClick: () => void }) {
    const { t } = useTranslation('app');
    const name = project.displayName || getFolderName(project.path);
    const path = shortenPathForDisplay(project.path);

    return (
        <button
            type="button"
            onClick={onClick}
            className="flex flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--paper)] px-5 py-4 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
        >
            <span className="truncate text-[15px] font-semibold text-[var(--ink)]">{name}</span>
            <span className="mt-1 truncate font-mono text-xs text-[var(--ink-subtle)]">{path}</span>
            <span className="mt-3 flex items-center justify-between">
                <span className="flex h-[22px] items-center rounded-md bg-[var(--accent-primary)]/15 px-1.5 text-[11px] font-semibold text-[var(--accent-primary)]">
                    {t('v2.launcher.recentBadge')}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">{t('v2.launcher.sessionCount')}</span>
            </span>
        </button>
    );
}
