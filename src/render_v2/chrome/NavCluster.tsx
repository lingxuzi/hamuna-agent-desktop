/**
 * NavCluster — four global navigation entries (Home / Tasks / Team / Settings)
 * as 26×26 icon buttons in the v2 chrome, placed between the logo mark and the
 * tab strip. Mirrors decision #1 + review round 1 of docs/SIDEBAR-TABBAR-IDEAS.md
 * (frame u9fa6): the active entry gets the $accent fill, the rest are $ink-muted.
 * Routing inside v2 is placeholder-first — every non-launcher view renders the
 * PlaceholderV2 card until its page lands.
 */
import { LayoutDashboard, CheckSquare, Cloud, Settings } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Tab } from '@/types/tab';

export type V2View = Tab['view'];

const NAV_ITEMS: Array<{ view: Exclude<V2View, 'chat'>; labelKey: string }> = [
    { view: 'launcher', labelKey: 'tabs.launcher' },
    { view: 'taskcenter', labelKey: 'tabs.taskCenter' },
    { view: 'space', labelKey: 'tabs.team' },
    { view: 'settings', labelKey: 'tabs.settings' },
];

const NAV_ICONS: Record<Exclude<V2View, 'chat'>, typeof LayoutDashboard> = {
    launcher: LayoutDashboard,
    taskcenter: CheckSquare,
    space: Cloud,
    settings: Settings,
};

interface NavClusterProps {
    activeView: V2View;
    onNavigate: (view: V2View) => void;
}

export default memo(function NavCluster({ activeView, onNavigate }: NavClusterProps) {
    const { t } = useTranslation('app');

    return (
        <div className="flex h-full flex-shrink-0 items-center gap-1" data-no-drag>
            {NAV_ITEMS.map(({ view, labelKey }) => {
                const Icon = NAV_ICONS[view];
                const isActive = activeView === view;
                return (
                    <button
                        key={view}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={t(labelKey)}
                        title={t(labelKey)}
                        onClick={() => onNavigate(view)}
                        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150 ${
                            isActive
                                ? 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]'
                                : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]/60 hover:text-[var(--ink)]'
                        }`}
                    >
                        <Icon className="h-4 w-4" />
                    </button>
                );
            })}
        </div>
    );
});
