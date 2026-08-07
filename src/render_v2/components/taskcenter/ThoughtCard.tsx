/**
 * ThoughtCard — a single thought card in the Task Center "思想流" panel
 * (F6p4ws ThoughtPanel → ThoughtCard). Title + a meta row of tag pills and a
 * "→ 派发为任务" action, per the comp. Static sample content for now.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ThoughtCardProps {
    title: string;
    tag: string;
}

export default memo(function ThoughtCard({ title, tag }: ThoughtCardProps) {
    const { t } = useTranslation('app');

    return (
        <article className="flex w-full flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-3.5">
            <p className="text-xs text-[var(--ink)]">{title}</p>
            <div className="flex w-full items-center justify-between gap-2">
                <span className="flex h-[18px] items-center rounded-full bg-[var(--paper-inset)] px-2 text-xs text-[var(--ink-muted)]">
                    {tag}
                </span>
                <span className="text-xs text-[var(--accent-cool)]">
                    {t('v2.taskCenter.dispatch')}
                </span>
            </div>
        </article>
    );
});
