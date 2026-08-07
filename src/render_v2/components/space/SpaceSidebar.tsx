/**
 * SpaceSidebar — the 256px left rail of the Space view (IlVr6). Space identity
 * block (join/create), the space header with avatar + policy + the four-nav
 * (Issues/Goals/Skills/Settings), and a bottom account bar.
 *
 * Design colors: rail bg #F2EFEB (midway between --paper and --paper-inset,
 * synthesized as inset/35 over the paper root); primary warm accent #C4956A →
 * --accent-warm family; active nav = --accent-warm-subtle bg. Selected nav
 * stays on Issues (static prototype, no nav switching).
 *
 * Font notes: 13px labels → text-sm; 11px policy/meta + 12px account → text-xs.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    UserPlus,
    Plus,
    ChevronDown,
    MessageSquare,
    GitBranch,
    Package,
    Settings,
} from 'lucide-react';

interface NavItem {
    key: 'issues' | 'goals' | 'skills' | 'settings';
    icon: typeof MessageSquare;
    active: boolean;
    badge?: string;
}

const NAV_ITEMS: NavItem[] = [
    { key: 'issues', icon: MessageSquare, active: true },
    { key: 'goals', icon: GitBranch, active: false },
    { key: 'skills', icon: Package, active: false },
    { key: 'settings', icon: Settings, active: false, badge: '3' },
];

export default memo(function SpaceSidebar() {
    const { t } = useTranslation('app');

    return (
        <aside className="flex h-full w-[256px] shrink-0 flex-col justify-between bg-[var(--paper-inset)]/35 px-3.5 py-3">
            <div className="flex flex-col gap-2.5">
                {/* Join / create actions */}
                <div className="flex flex-col gap-1">
                    {(['join', 'create'] as const).map((kind) => (
                        <div
                            key={kind}
                            className="flex h-8 items-center gap-2 rounded-lg bg-[var(--paper-elevated)] px-2.5 text-sm text-[var(--ink-muted)]"
                        >
                            {kind === 'join' ? (
                                <UserPlus className="h-4 w-4 shrink-0" />
                            ) : (
                                <Plus className="h-4 w-4 shrink-0" />
                            )}
                            {t(`v2.space.sidebar${kind === 'join' ? 'Join' : 'Create'}`)}
                        </div>
                    ))}
                </div>

                {/* Space identity */}
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-primary)] text-sm text-[var(--on-accent)]">
                        {t('v2.space.spaceName').charAt(0)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                        <p className="truncate text-sm text-[var(--ink)]">{t('v2.space.spaceName')}</p>
                        <p className="truncate text-xs text-[var(--ink-muted)]">{t('v2.space.spacePolicy')}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                </div>

                {/* Nav */}
                <nav className="flex flex-col gap-0.5">
                    {NAV_ITEMS.map((item) => (
                        <div
                            key={item.key}
                            aria-current={item.active ? 'page' : undefined}
                            className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm ${
                                item.active
                                    ? 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]'
                                    : 'text-[var(--ink-muted)]'
                            }`}
                        >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1">{t(`v2.space.nav${item.key[0].toUpperCase()}${item.key.slice(1)}`)}</span>
                            {item.badge && (
                                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent-warm-subtle)] px-1 text-xs text-[var(--accent-warm)]">
                                    {item.badge}
                                </span>
                            )}
                        </div>
                    ))}
                </nav>
            </div>

            {/* Account bar */}
            <div className="flex h-10 items-center gap-2 rounded-[10px] bg-[var(--paper-elevated)] px-2">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-[var(--accent-warm)] text-xs text-[var(--on-accent)]">
                    {t('v2.space.accountName').charAt(0)}
                </span>
                <span className="flex-1 truncate text-xs text-[var(--ink-muted)]">{t('v2.space.accountName')}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
            </div>
        </aside>
    );
});
