/**
 * AppV2 — root of the v2 renderer layer.
 *
 * Mounted by main.tsx only when VITE_UI_RENDER_LAYER === 'v2' (compile-time env
 * switch). Self-contained: owns its tab state via useV2Tabs (never TabProvider
 * at the app root — TabProvider is mounted per-chat-tab below), renders the
 * fused Chrome on top and the current view below.
 *
 * Chat wiring (Step 5):
 *  - Launcher / TaskCenter hand off launch context through refs; useChatLaunchV2
 *    flips the active tab into a chat tab (agentDir/sessionId/initialMessage/
 *    disposition) and reconciles disposition against the sidecar.
 *  - When activeView === 'chat', a TabProvider wraps the ChatTab subcomponent
 *    with the tab's session fields. TabProvider owns session creation from the
 *    `pending-<tabId>` placeholder and reports the real session id back via
 *    onSessionIdChange, which patches the v2 tab. ChatTab consumes the handoff
 *    refs and mounts useChatControllerV2 INSIDE the TabProvider (useTabState
 *    requires it).
 */
import { useCallback, useRef } from 'react';

import { useV2Tabs } from './tabs/useTabs';
import Chrome from './chrome/Chrome';
import LauncherV2 from './pages/LauncherV2';
import TaskCenterV2 from './pages/TaskCenterV2';
import SettingsV2 from './pages/SettingsV2';
import PlaceholderV2 from './pages/PlaceholderV2';
import ChatV2 from './pages/ChatV2';
import TabProvider from '@/context/TabProvider';
import { useChatControllerV2 } from './hooks/useChatControllerV2';
import { useChatLaunchV2 } from './hooks/useChatLaunchV2';
import { useConfig } from '@/hooks/useConfig';
import type { LauncherLaunchContext } from './hooks/useLauncherDataV2';
import type { DiscussLaunchContext } from './hooks/useChatLaunchV2';
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
        patchTab,
        launchChatTab,
    } = useV2Tabs();

    // Launcher → Chat handoff: the launch context is transient. Stored in refs
    // so ChatTab can consume it on mount and clear it; a state would force a
    // re-render just to carry a one-shot handoff value.
    const chatLaunchRef = useRef<LauncherLaunchContext | null>(null);
    const discussRef = useRef<DiscussLaunchContext | null>(null);

    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

    const { launchChat, discussInChat } = useChatLaunchV2({
        activeTab,
        activeTabId,
        launchChatTab,
        patchTab,
    });

    // useChatLaunchV2 flips the active tab; stash the ctx in the refs for
    // ChatTab's mount-time consumption (and clear after use).
    const handleLauncherLaunch = useCallback(
        (ctx: LauncherLaunchContext) => {
            chatLaunchRef.current = ctx;
            launchChat(ctx);
        },
        [launchChat],
    );

    const handleDiscussInChat = useCallback(
        (ctx: DiscussLaunchContext) => {
            discussRef.current = ctx;
            discussInChat(ctx);
        },
        [discussInChat],
    );

    const handleNavigate = useCallback(
        (view: Tab['view']) => {
            if (view !== activeView) setView(view);
        },
        [activeView, setView],
    );

    const openSettings = useCallback(() => setView('settings'), [setView]);

    const handleCloseTab = useCallback(
        (tabId: string) => {
            closeTab(tabId);
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
                        launchChat={handleLauncherLaunch}
                        openSettings={openSettings}
                        isActive={activeView === 'launcher'}
                    />
                ) : activeView === 'taskcenter' ? (
                    <TaskCenterV2
                        isActive={activeView === 'taskcenter'}
                        onDiscussInChat={handleDiscussInChat}
                    />
                ) : activeView === 'settings' ? (
                    <SettingsV2 onShowLogs={() => setView('settings')} />
                ) : activeView === 'space' ? (
                    <PlaceholderV2 view={activeView} onBack={() => setView('launcher')} />
                ) : activeView === 'chat' ? (
                    <TabProvider
                        tabId={activeTab.id}
                        agentDir={activeTab.agentDir ?? ''}
                        sessionId={activeTab.sessionId}
                        isActive={activeView === 'chat'}
                        onSessionIdChange={(newSessionId) => {
                            patchTab(activeTab.id, { sessionId: newSessionId });
                            return false;
                        }}
                        onTitleChange={(title) => patchTab(activeTab.id, { title })}
                        onGeneratingChange={(isGenerating) => patchTab(activeTab.id, { isGenerating })}
                        onUnreadChange={(hasUnread) => patchTab(activeTab.id, { hasUnread })}
                    >
                        <ChatTab
                            isActive={activeView === 'chat'}
                            chatLaunchRef={chatLaunchRef}
                            discussRef={discussRef}
                        />
                    </TabProvider>
                ) : (
                    <PlaceholderV2 view={activeView} onBack={() => setView('launcher')} />
                )}
            </main>
        </div>
    );
}

/** ChatTab — the per-chat-tab controller + view. Lives INSIDE TabProvider so
 *  useChatControllerV2's useTabState/useTabActive have a provider. */
function ChatTab({
    isActive,
    chatLaunchRef,
    discussRef,
}: {
    isActive: boolean;
    chatLaunchRef: React.RefObject<LauncherLaunchContext | null>;
    discussRef: React.RefObject<DiscussLaunchContext | null>;
}) {
    const launchCtx = chatLaunchRef.current;
    const discussCtx = discussRef.current;

    const controller = useChatControllerV2({
        initialMessage: launchCtx?.initialMessage
            ?? (discussCtx ? { text: discussCtx.content } : undefined),
        onInitialMessageConsumed: () => {
            chatLaunchRef.current = null;
            discussRef.current = null;
        },
        sidecarConfigDisposition: 'pending',
        isActive,
    });

    return <ChatV2 controller={controller} isActive={isActive} />;
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
