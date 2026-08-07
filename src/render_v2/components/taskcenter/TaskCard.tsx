/**
 * TaskCard — a task row in the Task Center task list (F6p4ws TaskCard). Status
 * dot + title/meta + status badge. Status tints the dot and badge text via the
 * accent tokens: 待办=--warning, 进行中=--accent-primary, 已完成=--accent-sky.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type TaskStatus = 'todo' | 'inProgress' | 'done';

/** Theme token for each status — dot fill + badge text share it. */
const STATUS_TINT: Record<TaskStatus, string> = {
    todo: 'var(--warning)',
    inProgress: 'var(--accent-primary)',
    done: 'var(--accent-sky)',
};

interface TaskCardProps {
    title: string;
    meta: string;
    status: TaskStatus;
}

export default memo(function TaskCard({ title, meta, status }: TaskCardProps) {
    const { t } = useTranslation('app');
    const tint = STATUS_TINT[status];

    return (
        <div className="flex w-full items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3">
            <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tint }}
                aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-xs text-[var(--ink)]">{title}</p>
                <p className="truncate text-xs text-[var(--ink-subtle)]">{meta}</p>
            </div>
            <span
                className="flex h-[18px] shrink-0 items-center rounded-full bg-[var(--paper-inset)] px-2 text-xs"
                style={{ color: tint }}
            >
                {t(`v2.taskCenter.status.${status}`)}
            </span>
        </div>
    );
});
