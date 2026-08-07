/**
 * AppV2 — root of the v2 renderer layer.
 *
 * Mounted by main.tsx only when VITE_UI_RENDER_LAYER === 'v2' (compile-time env
 * switch). Self-contained: owns its tab state via useV2Tabs (never TabProvider
 * at the app root — TabProvider is mounted per-chat-tab below), renders the
 * fused Chrome on top and the current view below.
 *
 * Directory layout mirrors src/renderer/ (components/chrome, hooks, pages) so
 * the two renderers stay structurally parallel.
 */
import { useCallback } from 'react';

import { useV2Tabs } from './hooks/useTabs';
import Chrome from './components/chrome/Chrome';
import LauncherV2 from './pages/LauncherV2';
import ChatV2 from './pages/ChatV2';
import SettingsV2 from './pages/SettingsV2';
import PlaceholderV2 from './pages/PlaceholderV2';
import { useConfig } from '@/hooks/useConfig';

export default function AppV2() {
    const { isLoading } = useConfig();
    const {
        tabs,
        activeTabId,
        activeView,
        newTab,
        closeTab,
        selectTab,
        reorderTabs,
        setView,
    } = useV2Tabs();

    const handleCloseTab = useCallback((tabId: string) => closeTab(tabId), [closeTab]);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
            <Chrome
                tabs={tabs}
                activeTabId={activeTabId}
                onSelectTab={selectTab}
                onCloseTab={handleCloseTab}
                onNewTab={newTab}
                onReorderTabs={reorderTabs}
            />

            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {isLoading ? (
                    <LoadingSkeleton />
                ) : activeView === 'launcher' ? (
                    <LauncherV2 onLaunchChat={() => setView('chat')} />
                ) : activeView === 'taskcenter' ? (
                    <PlaceholderV2 view="taskcenter" onBack={() => setView('launcher')} />
                ) : activeView === 'settings' ? (
                    <SettingsV2 />
                ) : activeView === 'space' ? (
                    <PlaceholderV2 view="space" onBack={() => setView('launcher')} />
                ) : (
                    <ChatV2 />
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
