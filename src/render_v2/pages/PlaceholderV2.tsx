/**
 * PlaceholderV2 — the "this page is not yet built on v2" card. Shown for every
 * non-launcher view (tasks / team / settings / workspace-launched chat). Because
 * the v2 switch is a compile-time env var there is no runtime fallback to v1 —
 * the card explains how to get the full feature back.
 */
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Tab } from '@/types/tab';

interface PlaceholderV2Props {
    view: Exclude<Tab['view'], 'launcher'>;
    onBack: () => void;
}

export default memo(function PlaceholderV2({ view, onBack }: PlaceholderV2Props) {
    const { t } = useTranslation('app');
    const title =
        view === 'settings'
            ? t('tabs.settings')
            : view === 'taskcenter'
              ? t('tabs.taskCenter')
              : view === 'space'
                ? t('tabs.team')
                : t('tabs.launcher');

    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-16">
            <div className="flex flex-col items-center gap-3 text-center">
                <h2 className="text-2xl font-light tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
                <p className="max-w-md text-sm text-[var(--ink-muted)]">{t('v2.placeholderBody')}</p>
            </div>
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-[var(--accent-warm)] transition-colors hover:bg-[var(--accent-warm-subtle)]"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t('v2.placeholderBack')}
            </button>
        </div>
    );
});
