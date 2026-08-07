/**
 * SpaceV2 — v2 Space view per the [final] IlVr6 "Space — A: 项目管理（Linear 流式
 * Issue 台）" comp. Frame = TabBar (handled by AppV2 Chrome) + MainArea (this
 * page): 256px SpaceSidebar + Content (Toolbar + IssueList).
 *
 * Toolbar: search box, status segment (全部/进行中, active on 全部), goal select,
 * "与我相关", and the warm accent 新建问题 button + refresh. IssueList is six
 * hard-coded rows (design data) with status pills, meta and optional goal tags.
 *
 * Static prototype: nav stays on Issues, segment stays on 全部, issues are sample
 * rows until the Space store wires up. Design sidebar tone #F2EFEB is
 * synthesized as --paper-inset/35 (token-derived, no orphan hex).
 *
 * Font notes: 13px labels/titles → text-sm; 12/11/10px meta/pills/tags → text-xs.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, UserRoundCheck, Plus, RefreshCw } from 'lucide-react';

import SpaceSidebar from '../components/space/SpaceSidebar';
import IssueRow, { type IssueStatus } from '../components/space/IssueRow';

interface IssueRowData {
    title: string;
    meta: string;
    status: IssueStatus;
    goal?: string;
}

const ISSUES: IssueRowData[] = [
    { title: '需要整理 v0.4 的发布清单与灰度计划', meta: '#HAM-42 · 林墨 · 2 天前 · 5 条评论', status: 'todo' },
    { title: '重新设计桌面宠物的一整套状态机', meta: '#HAM-38 · 阿枫 · 昨天 · 3 条评论 · 由 小助理 处理', status: 'inProgress', goal: '宠物状态机' },
    { title: '清理 Launcher 页残留的幽灵字阶', meta: '#HAM-35 · 苏珊 · 5 天前 · 8 条评论', status: 'done' },
    { title: '补充 Agent 注册后的连接状态指引', meta: '#HAM-29 · 阿枫 · 1 周前 · 2 条评论', status: 'todo' },
    { title: '完成 Space 概览 Dashboard 的原型图', meta: '#HAM-21 · 林墨 · 3 天前 · 6 条评论 · 由 小助理 处理', status: 'inProgress', goal: 'Space v2' },
    { title: '修复 Windows 下长路径文件打开失败', meta: '#HAM-15 · 苏珊 · 2 周前 · 1 条评论', status: 'todo' },
];

export default memo(function SpaceV2() {
    const { t } = useTranslation('app');

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--paper)]">
            <SpaceSidebar />

            {/* Content */}
            <section className="flex min-w-0 flex-1 flex-col">
                {/* Toolbar */}
                <div className="flex h-12 shrink-0 items-center gap-2 bg-[var(--paper-elevated)] px-5">
                    {/* Search */}
                    <div className="flex h-9 w-60 shrink-0 items-center gap-2 rounded-[10px] bg-[var(--paper)] px-3 text-sm text-[var(--ink-muted)]">
                        <Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                        {t('v2.space.searchHint')}
                    </div>

                    {/* Status segment */}
                    <div className="flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-[var(--paper-inset)] p-0.5">
                        <span className="flex h-7 items-center rounded-md bg-[var(--paper-elevated)] px-3 text-xs text-[var(--ink)]">
                            {t('v2.space.statusAll')}
                        </span>
                        <span className="flex h-7 items-center gap-1 rounded-md px-2.5 text-xs text-[var(--ink-muted)]">
                            {t('v2.space.statusOpen')}
                            <ChevronDown className="h-3 w-3" />
                        </span>
                    </div>

                    {/* Goal select */}
                    <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--paper)] px-3 text-sm text-[var(--ink-muted)]">
                        {t('v2.space.goalAll')}
                        <ChevronDown className="h-3.5 w-3.5" />
                    </div>

                    {/* Related to me */}
                    <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--paper)] px-3 text-xs text-[var(--ink-muted)]">
                        <UserRoundCheck className="h-4 w-4" />
                        {t('v2.space.relatedToMe')}
                    </div>

                    <div className="flex-1" />

                    {/* New issue + refresh */}
                    <div className="flex h-9 items-center gap-2 rounded-[10px] bg-[var(--accent-warm)] px-3 text-sm text-[var(--on-accent)]">
                        <Plus className="h-4 w-4" />
                        {t('v2.space.newIssue')}
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--paper)]">
                        <RefreshCw className="h-4 w-4 text-[var(--ink-muted)]" />
                    </div>
                </div>

                {/* Issue list */}
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    <div className="divide-y divide-[var(--line-subtle)] rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
                        {ISSUES.map((issue) => (
                            <IssueRow
                                key={issue.title}
                                title={issue.title}
                                meta={issue.meta}
                                status={issue.status}
                                goal={issue.goal}
                            />
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
});
