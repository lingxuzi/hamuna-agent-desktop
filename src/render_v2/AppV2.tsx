/**
 * AppV2 — root of the v2 renderer layer.
 *
 * Mounted by main.tsx only when VITE_UI_RENDER_LAYER === 'v2' (compile-time env
 * switch). Self-contained: owns its tab state via useV2Tabs (never TabProvider),
 * renders the fused Chrome on top and the current view below. Every non-launcher
 * view shows a PlaceholderV2 card — switching back to the full v1 UI requires
 * flipping the env var and restarting dev/build.
 */
import { useCallback, useRef } from 'react';

import { useV2Tabs } from './tabs/useTabs';
import Chrome from './chrome/Chrome';
import LauncherV2 from './pages/LauncherV2';
import PlaceholderV2 from './pages/PlaceholderV2';
import { useConfig } from '@/hooks/useConfig';
import type { LauncherLaunchContext } from './hooks/useLauncherDataV2';
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

    // Launcher → Chat handoff: the launch context is transient. Store it in a
    // ref so ChatV2 (Step 5) can consume it on mount and clear it; a state would
    // force a re-render just to carry a one-shot handoff value.
    const chatLaunchRef = useRef<LauncherLaunchContext | null>(null);

    const handleNavigate = useCallback(
        (view: Tab['view']) => {
            if (view !== activeView) setView(view);
        },
        [activeView, setView],
    );

    const launchChat = useCallback(
        (ctx: LauncherLaunchContext) => {
            chatLaunchRef.current = ctx;
            setView('chat');
        },
        [setView],
    );

    const openSettings = useCallback(() => setView('settings'), [setView]);

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
                    <LauncherV2
                        launchChat={launchChat}
                        openSettings={openSettings}
                        isActive={activeView === 'launcher'}
                    />
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
