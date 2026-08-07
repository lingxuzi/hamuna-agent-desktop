/**
 * NavSidebar — left settings navigation of the v2 Settings page (zNRla / cTjk2).
 * Four groups × ten items; the active item (通用设置) gets the accent fill with
 * on-accent text per the comp, the rest are transparent with muted icons. The
 * sidebar bg is transparent — Body carries --paper.
 *
 * Static prototype: the active highlight is hard-coded to 通用设置 and item
 * clicks don't switch panels (only that panel is designed). Live nav wiring is
 * deferred with the settings data connection (see SETTINGS-IDEAS caveats).
 *
 * Font notes: 11px group headers and 13px item labels are not in the locked
 * seven-step scale (12/14/16/18/20/22/28); closest step text-xs (12px) is used.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Bot,
    Cable,
    ChartColumn,
    Heart,
    Info,
    Keyboard,
    Puzzle,
    Server,
    Settings,
    Sparkles,
    type LucideIcon,
} from 'lucide-react';

interface NavItem {
    key: string;
    icon: LucideIcon;
    active?: boolean;
}

interface NavGroup {
    groupKey: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        groupKey: 'model',
        items: [
            { key: 'providers', icon: Server },
            { key: 'skills', icon: Sparkles },
            { key: 'plugins', icon: Puzzle },
            { key: 'mcp', icon: Cable },
        ],
    },
    {
        groupKey: 'connect',
        items: [
            { key: 'agent', icon: Bot },
            { key: 'desktopPet', icon: Heart },
        ],
    },
    {
        groupKey: 'data',
        items: [{ key: 'usageStats', icon: ChartColumn }],
    },
    {
        groupKey: 'general',
        items: [
            { key: 'general', icon: Settings, active: true },
            { key: 'shortcuts', icon: Keyboard },
            { key: 'about', icon: Info },
        ],
    },
];

export default memo(function NavSidebar() {
    const { t } = useTranslation('app');

    return (
        <nav className="flex w-[208px] shrink-0 flex-col gap-1 p-6">
            {/* Header row — SidebarTitle + Logs button */}
            <div className="flex items-center justify-between pb-1">
                <span className="text-xl font-semibold text-[var(--ink)]">
                    {t('v2.settings.title')}
                </span>
                <button
                    type="button"
                    className="rounded-md px-2.5 py-1.5 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
                >
                    {t('v2.settings.logs')}
                </button>
            </div>

            {NAV_GROUPS.map((group) => (
                <div key={group.groupKey} className="flex flex-col gap-1 pt-6">
                    <span className="px-2.5 pb-0.5 text-xs font-semibold text-[var(--ink-subtle)]">
                        {t(`v2.settings.navGroups.${group.groupKey}`)}
                    </span>
                    {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                aria-current={item.active ? 'page' : undefined}
                                className={`flex h-10 items-center gap-2.5 rounded-md px-2.5 transition-colors ${
                                    item.active
                                        ? 'bg-[var(--accent-primary)] text-[var(--on-accent)]'
                                        : 'text-[var(--ink-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]'
                                }`}
                            >
                                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span className="truncate text-xs font-medium">
                                    {t(`v2.settings.nav.${item.key}`)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ))}
        </nav>
    );
});
