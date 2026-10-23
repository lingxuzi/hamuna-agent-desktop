import { memo, useCallback, useRef, useState } from 'react';
import { BarChart2, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SessionTagBadge from '@/components/SessionTagBadge';
import UnreadNotificationIndicator from '@/components/UnreadNotificationIndicator';
import { MenuItem } from '@/components/ui/MenuItem';
import { Popover } from '@/components/ui/Popover';
import type { SessionMetadata } from '@/api/sessionClient';
import type { Project } from '@/config/types';
import type { SessionTag } from '@/hooks/useTaskCenterData';
import { isSupportedLocale } from '../../../shared/i18n';
import { formatTime, formatTurnCount, getFolderName, getSessionDisplayText } from '@/utils/taskCenterUtils';

const getProjectDisplayName = (project: Project): string =>
    project.displayName || getFolderName(project.path);

export interface LauncherHistoryRowProps {
    session: SessionMetadata;
    project: Project;
    tags: SessionTag[];
    unreadNotificationCount: number;
    isCronProtected: boolean;
    onOpen: (session: SessionMetadata, project: Project) => void;
    onToggleFavorite: (session: SessionMetadata) => void;
    onShowStats: (session: SessionMetadata) => void;
    onRequestDelete: (session: SessionMetadata) => void;
    menuOpen: boolean;
    onMenuOpenChange: (sessionId: string, open: boolean) => void;
    /** Narrower time column, no project name column — for the global sidebar. */
    compact?: boolean;
}

export const LauncherHistoryRow = memo(function LauncherHistoryRow({
    session,
    project,
    tags,
    unreadNotificationCount,
    isCronProtected,
    onOpen,
    onToggleFavorite,
    onShowStats,
    onRequestDelete,
    menuOpen,
    onMenuOpenChange,
    compact = false,
}: LauncherHistoryRowProps) {
    const { t, i18n } = useTranslation('launcher');
    const locale = isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN';
    const menuAnchorRef = useRef<HTMLSpanElement | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<{
        x: number;
        y: number;
        placement: 'bottom-start' | 'bottom-end';
    } | null>(null);
    const displayText = getSessionDisplayText(session);
    const turnCount = formatTurnCount(session, locale);

    const closeMenu = useCallback(() => {
        setMenuAnchor(null);
        onMenuOpenChange(session.id, false);
    }, [onMenuOpenChange, session.id]);

    const openMenuAt = useCallback((x: number, y: number, placement: 'bottom-start' | 'bottom-end' = 'bottom-start') => {
        setMenuAnchor(current => {
            if (current?.x === x && current.y === y && current.placement === placement) return current;
            return { x, y, placement };
        });
        onMenuOpenChange(session.id, true);
    }, [onMenuOpenChange, session.id]);

    const handleOpen = useCallback(() => onOpen(session, project), [onOpen, project, session]);
    const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        handleOpen();
    }, [handleOpen]);
    const handleMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        openMenuAt(event.clientX, event.clientY);
    }, [openMenuAt]);
    const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openMenuAt(event.clientX, event.clientY);
    }, [openMenuAt]);
    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleOpen();
    }, [handleOpen]);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onMouseDownCapture={handleMouseDownCapture}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
            className="group relative flex w-full cursor-pointer select-none items-center gap-1 overflow-hidden rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
            <div className={`flex shrink-0 items-center text-xs tabular-nums text-[var(--ink-muted)]/50 ${compact ? 'w-11' : 'w-16'}`}>
                <span className="min-w-0 truncate">{formatTime(session.lastActiveAt, new Date(), locale)}</span>
            </div>
            {!compact && (
                <div className="flex w-16 shrink-0 items-center text-xs text-[var(--ink-muted)]/55">
                    <span className="min-w-0 truncate">{getProjectDisplayName(project)}</span>
                </div>
            )}
            {tags.map((tag) => (
                <SessionTagBadge
                    key={tag.type === 'im' ? `im:${tag.platform}` : tag.type}
                    tag={tag}
                />
            ))}
            <UnreadNotificationIndicator
                count={unreadNotificationCount}
                label={t('rightRail.unreadNotifications', { count: unreadNotificationCount })}
            />
            <span className="launcher-history-row-title-fade min-w-0 flex-1 truncate text-sm text-[var(--ink-secondary)] transition-colors group-hover:text-[var(--ink)]">
                {displayText}
                {turnCount && (
                    <span className="ml-1.5 text-xs text-[var(--ink-muted)]/40">
                        {turnCount}
                    </span>
                )}
            </span>
            <div
                className={`launcher-history-row-action-overlay pointer-events-none absolute inset-y-0 right-0 flex w-16 items-center justify-end pr-2 transition-opacity ${
                    menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                }`}
            >
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        if (menuOpen) {
                            closeMenu();
                            return;
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        openMenuAt(rect.right, rect.bottom, 'bottom-end');
                    }}
                    className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] focus-visible:opacity-100"
                    title={t('rightRail.more')}
                    aria-label={t('rightRail.more')}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </div>
            {menuOpen && menuAnchor && (
                <>
                    <span
                        ref={menuAnchorRef}
                        className="fixed h-px w-px"
                        style={{ left: menuAnchor.x, top: menuAnchor.y }}
                        aria-hidden
                    />
                    <Popover
                        open
                        onClose={closeMenu}
                        anchorRef={menuAnchorRef}
                        placement={menuAnchor.placement}
                        className="w-40 py-1"
                    >
                        <MenuItem
                            icon={<Star className="h-3.5 w-3.5" fill={session.favorite ? 'currentColor' : 'none'} />}
                            label={session.favorite ? t('rightRail.unfavorite') : t('rightRail.favorite')}
                            onClick={() => {
                                closeMenu();
                                onToggleFavorite(session);
                            }}
                        />
                        <MenuItem
                            icon={<BarChart2 className="h-3.5 w-3.5" />}
                            label={t('rightRail.viewStats')}
                            onClick={() => {
                                closeMenu();
                                onShowStats(session);
                            }}
                        />
                        <MenuItem
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            label={t('rightRail.delete')}
                            tone="danger"
                            disabled={isCronProtected}
                            title={isCronProtected ? t('rightRail.stopCronBeforeDelete') : undefined}
                            onClick={() => {
                                if (isCronProtected) return;
                                closeMenu();
                                onRequestDelete(session);
                            }}
                        />
                    </Popover>
                </>
            )}
        </div>
    );
});
