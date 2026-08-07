/**
 * TaskCenterV2 — v2 Task Center page per the [final] F6p4ws "思想驱动（40/60）" comp.
 *
 * Frame = TabBar (ref qbbQI, handled by AppV2 Chrome) + MainArea (Eor8A). This
 * page implements MainArea only: ThoughtPanel (480w) + Divider + TaskListPanel
 * (flex-1). ThoughtPanel holds a title row, a thought input, and a stack of
 * ThoughtCards. TaskListPanel holds the "任务" header + search pill + list/
 * board segment + three status buckets (待办/进行中/已完成).
 *
 * Static prototype: thoughts and tasks are hard-coded sample rows until the
 * task store wires up. Segment stays on "列表", nav stays on the default bucket.
 *
 * Font notes: 13px titles / 11px meta / 12px labels — all fall to the closest
 * locked steps (text-xs / text-xs); the 40/60 split is hard-coded as the comp's
 * 480w ThoughtPanel (≈ 40% of 1200 content width).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ThoughtCard from '../components/taskcenter/ThoughtCard';
import TaskCard, { type TaskStatus } from '../components/taskcenter/TaskCard';

interface ThoughtRow {
    title: string;
    tag: string;
}

interface TaskRow {
    title: string;
    meta: string;
    status: TaskStatus;
}

const THOUGHTS: ThoughtRow[] = [
    { title: '想法：让 AI 自动整理周报', tag: '#思考' },
    { title: '灵感：命令行效率清单', tag: '#灵感' },
    { title: '回顾：本周已完成 3 个任务', tag: '#回顾' },
    { title: '想法：跨窗口拖拽附件到会话', tag: '#思考' },
    { title: '灵感：给模型配专属快捷键', tag: '#灵感' },
];

interface Bucket {
    status: TaskStatus;
    tasks: TaskRow[];
}

const BUCKETS: Bucket[] = [
    {
        status: 'todo',
        tasks: [
            { title: '让 AI 整理本周代码提交记录', meta: '#提交记录 · 今天 09:00', status: 'todo' },
            { title: 'Review 新 UI 变体', meta: '#设计 · 明天', status: 'todo' },
        ],
    },
    {
        status: 'inProgress',
        tasks: [{ title: '优化 Task Center 首屏性能', meta: '#性能 · 今天 14:00', status: 'inProgress' }],
    },
    {
        status: 'done',
        tasks: [
            { title: '迁移文档到新结构', meta: '#文档 · 昨天', status: 'done' },
            { title: '补充单元测试', meta: '#测试 · 前天', status: 'done' },
            { title: '整理 API mock', meta: '#接口 · 8-01', status: 'done' },
        ],
    },
];

export default memo(function TaskCenterV2() {
    const { t } = useTranslation('app');

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--paper)]">
            {/* Left: thought panel — 480w fixed */}
            <section className="flex w-[480px] shrink-0 flex-col gap-3 overflow-y-auto p-5">
                {/* Header row */}
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[var(--ink)]">
                        {t('v2.taskCenter.thoughtTitle')}
                    </h2>
                    <span className="text-xs text-[var(--ink-muted)]" aria-hidden="true">
                        🔍
                    </span>
                </div>

                {/* Thought input */}
                <div className="flex h-9 items-center rounded-md bg-[var(--paper-inset)] px-3 text-xs text-[var(--ink-muted)]">
                    {t('v2.taskCenter.thoughtPlaceholder')}
                </div>

                {/* Thought cards */}
                {THOUGHTS.map((thought) => (
                    <ThoughtCard key={thought.title} title={thought.title} tag={thought.tag} />
                ))}
            </section>

            {/* Divider */}
            <div className="w-px shrink-0 bg-[var(--line-subtle)]" aria-hidden="true" />

            {/* Right: task list panel */}
            <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                {/* Header row */}
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[var(--ink)]">
                        {t('v2.taskCenter.taskTitle')}
                    </h2>
                    <div className="flex items-center gap-1.5 rounded-full bg-[var(--paper-inset)] px-3 py-1.5 text-xs text-[var(--ink-muted)]">
                        <span className="text-[var(--ink-subtle)]" aria-hidden="true">
                            ⌕
                        </span>
                        {t('v2.taskCenter.searchPlaceholder')}
                    </div>
                </div>

                {/* List / board segment */}
                <div className="inline-flex w-fit gap-0.5 rounded-md bg-[var(--paper-inset)] p-0.5">
                    <span className="rounded-md bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs text-[var(--on-accent)]">
                        {t('v2.taskCenter.mode.list')}
                    </span>
                    <span className="rounded-md px-3.5 py-1.5 text-xs text-[var(--ink-muted)]">
                        {t('v2.taskCenter.mode.board')}
                    </span>
                </div>

                {/* Status buckets */}
                {BUCKETS.map((bucket) => (
                    <div key={bucket.status} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--ink-muted)]">
                                {t(`v2.taskCenter.bucket.${bucket.status}`)}
                            </span>
                            <span className="text-xs text-[var(--ink-subtle)]">{bucket.tasks.length}</span>
                        </div>
                        {bucket.tasks.map((task) => (
                            <TaskCard key={task.title} title={task.title} meta={task.meta} status={task.status} />
                        ))}
                    </div>
                ))}
            </section>
        </div>
    );
});
