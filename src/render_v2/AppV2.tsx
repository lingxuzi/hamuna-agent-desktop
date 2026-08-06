/**
 * AppV2 — root of the v2 renderer layer.
 *
 * Mounted by main.tsx only when VITE_UI_RENDER_LAYER === 'v2' (compile-time env
 * switch). Self-contained: owns its tab state via useV2Tabs (never TabProvider),
 * renders the fused Chrome on top and the current view below. Every non-launcher
 * view shows a PlaceholderV2 card — switching back to the full v1 UI requires
 * flipping the env var and restarting dev/build.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useV2Tabs } from './tabs/useTabs';
import Chrome from './chrome/Chrome';
import PlaceholderV2 from './pages/PlaceholderV2';
import { useConfig } from '@/hooks/useConfig';
import type { Tab } from '@/types/tab';

export default function AppV2() {
    const { isLoading } = useConfig();
    const {
        tabs,
        activeTabId,
        activeView,
        newTab,
        closeTab,
        selectTab,
        setView,
        reorderTabs,
    } = useV2Tabs();

    const handleNavigate = useCallback(
        (view: Tab['view']) => {
            if (view !== activeView) setView(view);
        },
        [activeView, setView],
    );

    const handleCloseTab = useCallback(
        (tabId: string) => {
            closeTab(tabId);
            // Closing the active tab may switch the active tab; after close the
            // activeView is recomputed from state, so no extra work needed here.
        },
        [closeTab],
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
            <Chrome
                tabs={tabs}
                activeTabId={activeTabId}
                activeView={activeView}
                onNavigate={handleNavigate}
                onSelectTab={selectTab}
                onCloseTab={handleCloseTab}
                onNewTab={newTab}
                onReorderTabs={reorderTabs}
            />

            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {isLoading ? (
                    <LoadingSkeleton />
                ) : activeView === 'launcher' ? (
                    <LauncherPreview />
                ) : (
                    <PlaceholderV2 view={activeView} onBack={() => setView('launcher')} />
                )}
            </main>
        </div>
    );
}

/** Minimal loading skeleton while config resolves — avoids a jarring mount. */
function LoadingSkeleton() {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="h-3 w-32 rounded-full bg-[var(--paper-inset)]" />
            <div className="h-2.5 w-56 rounded-full bg-[var(--paper-inset)]/60" />
        </div>
    );
}

/**
 * LauncherPreview — placeholder for the Launcher page until LauncherV2 lands.
 * Keeps the view alive so the tab strip / nav still feel wired; the real
 * 60/40 brand-driven launcher replaces this in Step 3.
 */
function LauncherPreview() {
    const { t } = useTranslation('app');
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            <h2 className="text-2xl font-light tracking-[-0.01em] text-[var(--ink)]">
                {t('v2.inProgress')}
            </h2>
            <p className="max-w-md text-center text-sm text-[var(--ink-muted)]">
                {t('v2.placeholderBody')}
            </p>
        </div>
    );
}
