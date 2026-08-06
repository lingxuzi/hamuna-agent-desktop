/**
 * TaskCenterV2 — v2 Task Center page (Pencil [final] F6p4ws "任务中心").
 * 40/60 thought-driven split: Thought stream (left 40%) + Task list (right 60%).
 *
 * Highest-reuse page: the data layer (taskCenterStore / useTaskCenterData /
 * api/taskCenter) and every leaf component (ThoughtPanel / TaskListPanel /
 * DispatchTaskDialog) drop in unchanged. Only the shell is rewritten — page
 * title, 40/60 ratio with a weak line-subtle divider, and the dispatch dialog
 * + discuss handoff — matching the v1 TaskCenter contract so nothing in the
 * task-center machinery needs touching.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ThoughtPanel } from '@/components/task-center/ThoughtPanel';
import { TaskListPanel } from '@/components/task-center/TaskListPanel';
import { DispatchTaskDialog } from '@/components/task-center/DispatchTaskDialog';
import { taskCenterAvailable } from '@/api/taskCenter';
import { track } from '@/analytics';
import type { Thought } from '../../shared/types/thought';
import type { Task } from '../../shared/types/task';

interface TaskCenterV2Props {
    isActive?: boolean;
    /** Same contract as v1 TaskCenter: latest OPEN_TASK_CENTER event payload,
     *  forwarded so navigation with `{ autofocusSearch: true }` opens the
     *  task-list search input without a second interaction. */
    pendingIntent?: { autofocusSearch?: boolean; nonce: number } | null;
    /** v2 handoff: discuss a thought inside a fresh Chat tab. AppV2 owns tab
     *  creation; it passes this down instead of v1's window CustomEvent (v2
     *  has no App.tsx-level OPEN_AI_DISCUSSION listener). */
    onDiscussInChat?: (ctx: { thoughtId: string; content: string; tags: string[]; workspaceId: string }) => void;
}

export default function TaskCenterV2({ isActive, pendingIntent, onDiscussInChat }: TaskCenterV2Props) {
    const { t } = useTranslation('task');
    const [dispatching, setDispatching] = useState<Thought | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    // Child panels react to `isActive` transitions on their own (via refreshKey
    // derived from it). We do NOT setState in an effect here. `isActive` is
    // passed straight through as the refresh signal — same as v1.

    const handleDispatch = useCallback((t: Thought) => {
        setDispatching(t);
    }, []);

    const handleDiscuss = useCallback(
        (t: Thought, workspaceId: string) => {
            track('task_align_discuss', {});
            // v1 dispatches a window CustomEvent that App.tsx listens for;
            // v2 hands off via prop since AppV2 owns tab creation.
            onDiscussInChat?.({
                thoughtId: t.id,
                content: t.content,
                tags: t.tags,
                workspaceId,
            });
        },
        [onDiscussInChat],
    );

    const handleDispatched = useCallback((task: Task) => {
        track('task_create', {
            source: 'desktop',
            origin: 'thought_dispatch',
            has_workspace: !!task.workspacePath,
        });
        setDispatching(null);
        setRefreshKey((k) => k + 1);
    }, []);

    if (!taskCenterAvailable()) {
        return (
            <div className="flex h-full items-center justify-center bg-[var(--paper)] px-8 text-center">
                <div className="max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
                    <p className="font-medium text-[var(--ink-secondary)]">{t('center.title')}</p>
                    <p className="mt-2">{t('center.desktopOnly')}</p>
                    <p className="mt-2 text-[var(--ink-muted)]/70">{t('center.desktopUnavailable')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-[var(--paper)]">
            {/* Page title — same tier as v1 (text-xl heading, vertical breathing
                room instead of a hairline divider). */}
            <div className="flex shrink-0 items-center px-5 pt-5 pb-3">
                <h1 className="text-xl font-semibold text-[var(--ink)]">{t('center.title')}</h1>
            </div>

            {/* Two-column body — 40/60 per Pencil F6p4ws; divider is line-subtle
                so both panels read as one continuous surface. */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left: Thought stream (40%) */}
                <div className="flex flex-col overflow-hidden" style={{ width: '40%' }}>
                    <ThoughtPanel
                        onDispatchThought={handleDispatch}
                        onDiscussThought={handleDiscuss}
                        refreshKey={`${refreshKey}:${isActive ? '1' : '0'}`}
                        // Suppress thought-input autofocus when arriving via the
                        // task-center search icon — caret belongs in TaskListPanel.
                        autoFocusInput={!!isActive && !pendingIntent?.autofocusSearch}
                    />
                </div>

                <div className="w-px bg-[var(--line-subtle)]" />

                {/* Right: Task list (60%) */}
                <div className="flex flex-1 flex-col overflow-hidden">
                    <TaskListPanel refreshKey={`${refreshKey}:${isActive ? '1' : '0'}`} pendingIntent={pendingIntent ?? null} />
                </div>
            </div>

            {dispatching && (
                <DispatchTaskDialog
                    thought={dispatching}
                    onClose={() => setDispatching(null)}
                    onDispatched={handleDispatched}
                />
            )}
        </div>
    );
}
