/**
 * IssueRow — a single issue row in the Space issue flow (IlVr6). Status pill
 * (tinted dot-less pill: warm/primary/sky + matching bg), title, meta line with
 * optional goal tag, and a trailing chevron.
 *
 * Status tints map to theme tokens: 待办(todo)=--accent-warm, 进行中(inProgress)
 * =--accent-primary, 已完成(done)=--accent-sky. Pill bg is the same token at 20%
 * via the /20 modifier (design used the hex's own alpha channel).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

export type IssueStatus = 'todo' | 'inProgress' | 'done';

/** Theme token for each status — pill text and pill bg share it. */
const STATUS_TINT: Record<IssueStatus, string> = {
    todo: 'var(--accent-warm)',
    inProgress: 'var(--accent-primary)',
    done: 'var(--accent-sky)',
};

/** Tailwind /20 class matching the token in STATUS_TINT (bg at 20% alpha).
 *  color-mix() in an inline style resolves to the solid color under this build,
 *  so the tinted bg must be a compiled class, not an inline style. */
const STATUS_BG: Record<IssueStatus, string> = {
    todo: 'bg-[var(--accent-warm)]/20',
    inProgress: 'bg-[var(--accent-primary)]/20',
    done: 'bg-[var(--accent-sky)]/20',
};

interface IssueRowProps {
    title: string;
    meta: string;
    status: IssueStatus;
    /** Optional goal chip, e.g. 宠物状态机. */
    goal?: string;
}

export default memo(function IssueRow({ title, meta, status, goal }: IssueRowProps) {
    const { t } = useTranslation('app');
    const tint = STATUS_TINT[status];

    return (
        <div className="flex w-full items-center gap-3 px-4 py-2.5">
            <span
                className={`flex h-[22px] shrink-0 items-center rounded-md px-2 text-xs ${STATUS_BG[status]}`}
                style={{ color: tint }}
            >
                {t(`v2.space.status.${status}`)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-sm text-[var(--ink)]">{title}</p>
                <div className="flex items-center gap-2">
                    <p className="truncate text-xs text-[var(--ink-muted)]">{meta}</p>
                    {goal && (
                        <span className="flex h-[18px] shrink-0 items-center rounded-md bg-[var(--paper-inset)] px-1.5 text-xs text-[var(--ink-muted)]">
                            {goal}
                        </span>
                    )}
                </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-subtle)]" />
        </div>
    );
});
