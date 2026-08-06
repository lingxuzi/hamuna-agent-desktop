/**
 * useChatLaunchV2 — Launcher / TaskCenter → Chat handoff for the v2 renderer.
 *
 * Owns the flip fields (agentDir / sessionId / title / initialMessage /
 * sidecarConfigDisposition) and the two-phase sidecar reconciliation. It is the
 * v2 analogue of v1 App.handleLaunchProject's flip+ensure half — WITHOUT the
 * instant-nav machinery (v2 has no background-tab / deferred-mount pipeline), so
 * the flip is synchronous and the disposition resolver is the only async step.
 *
 * Reconciliation rules (v1 #300/#301 redlines, preserved exactly):
 *  - disposition starts 'pending' on the flipped tab. autoSend / config-push
 *    effects in useChatControllerV2 gate on it — nothing pushes before the
 *    resolver decides.
 *  - The SINGLE resolver is `ensureSessionSidecar(...).isNew` (Rust lock-side
 *    decision): new → 'push', joined → 'adopt'. Never guessed from a
 *    pre-ensure readiness probe.
 *  - For a brand-new session the placeholder `pending-<tabId>` is used so the
 *    tab is a valid chat tab from the start (D1: non-empty sessionId). TabProvider
 *    itself ensures+creates the real session from that placeholder and reports
 *    it back via onSessionIdChange — the v2 tab is patched to the real id.
 */
import { useCallback } from 'react';

import { type Tab, type InitialMessage, type SidecarConfigDisposition } from '@/types/tab';
import { isPendingSessionId } from '../../shared/constants';
import { ensureSessionSidecar } from '@/api/tauriClient';
import { getFolderName } from '@/types/tab';
import type { LauncherLaunchContext } from './useLauncherDataV2';

/** Thought-discuss handoff into a Chat tab (TaskCenter → Chat). */
export interface DiscussLaunchContext {
    thoughtId: string;
    content: string;
    tags: string[];
    workspaceId: string;
}

export interface ChatLaunchV2Handlers {
    /** Launcher → Chat: flip active tab + ensure sidecar (async disposition resolve). */
    launchChat: (ctx: LauncherLaunchContext) => void;
    /** TaskCenter discuss → Chat: same flip, message text as initialMessage. */
    discussInChat: (ctx: DiscussLaunchContext) => void;
}

interface UseChatLaunchV2Options {
    activeTab: Tab;
    activeTabId: string;
    launchChatTab: (tabId: string, fields: import('../tabs/useTabs').LaunchChatFields) => void;
    patchTab: (tabId: string, patch: Partial<Tab>) => void;
}

/** Build the flip fields for a launch ctx. sessionId: real history id, or
 *  `pending-<tabId>` placeholder for a new session (D1 non-empty). */
export function buildLaunchFields(
    tab: Tab,
    ctx: LauncherLaunchContext | DiscussLaunchContext,
): import('../tabs/useTabs').LaunchChatFields {
    const agentDir = 'project' in ctx ? ctx.project.path : ctx.workspaceId;
    const title = getFolderName(agentDir);
    const sessionId = 'sessionId' in ctx && ctx.sessionId
        ? ctx.sessionId
        : `pending-${tab.id}`;
    // Launcher passes a ready InitialMessage; a discuss launch carries thought
    // content that becomes the message text (tags are thought metadata, not an
    // InitialMessage field). Both must survive the flip or the chat opens blank.
    const initialMessage: InitialMessage | undefined = 'initialMessage' in ctx
        ? ctx.initialMessage
        : 'content' in ctx
          ? { text: ctx.content }
          : undefined;
    return {
        agentDir,
        sessionId,
        title,
        ...(initialMessage ? { initialMessage } : {}),
        sidecarConfigDisposition: 'pending',
    };
}

/** Resolve 'pending' → 'push' | 'adopt' from the authoritative ensure result. */
async function resolveDisposition(tabId: string, agentDir: string, sessionId: string): Promise<SidecarConfigDisposition> {
    if (isPendingSessionId(sessionId)) {
        // TabProvider owns session creation for placeholders — disposition stays
        // 'pending' until TabProvider reports the real session id and this
        // resolver runs again (via onSessionIdChange → re-ensure).
        return 'pending';
    }
    const result = await ensureSessionSidecar(sessionId, agentDir, 'tab', tabId);
    return result.isNew ? 'push' : 'adopt';
}

export function useChatLaunchV2(options: UseChatLaunchV2Options): ChatLaunchV2Handlers {
    const { activeTab, activeTabId, launchChatTab, patchTab } = options;

    const launchChat = useCallback((ctx: LauncherLaunchContext) => {
        const fields = buildLaunchFields(activeTab, ctx);
        // Synchronous flip — the tab is a valid chat tab immediately.
        launchChatTab(activeTabId, fields);
        // Async disposition resolve (pending → push/adopt). Re-enters the tab
        // via patchTab with the authoritative decision.
        const agentDir = ctx.project.path;
        const sessionId = fields.sessionId;
        void resolveDisposition(activeTabId, agentDir, sessionId).then((disposition) => {
            if (disposition === 'pending') return;
            patchTab(activeTabId, { sidecarConfigDisposition: disposition });
        });
    }, [activeTab, activeTabId, launchChatTab, patchTab]);

    const discussInChat = useCallback((ctx: DiscussLaunchContext) => {
        const fields = buildLaunchFields(activeTab, ctx);
        launchChatTab(activeTabId, fields);
        const agentDir = ctx.workspaceId;
        const sessionId = fields.sessionId;
        void resolveDisposition(activeTabId, agentDir, sessionId).then((disposition) => {
            if (disposition === 'pending') return;
            patchTab(activeTabId, { sidecarConfigDisposition: disposition });
        });
    }, [activeTab, activeTabId, launchChatTab, patchTab]);

    return { launchChat, discussInChat };
}
