/**
 * useTabs — lightweight v2 tab state.
 *
 * Deliberately NOT TabProvider: the v2 renderer is a self-contained layer that
 * reuses the shared Tab types (createNewTab / MAX_TABS) but owns a minimal
 * in-memory tab list. No persistence, no sidecar coupling — tabs are chrome
 * only until the Chat page lands. Kept as a tiny reducer so the actions are
 * stable and testable without a component tree.
 */
import { useCallback, useReducer } from 'react';

import { type Tab, createNewTab, MAX_TABS } from '@/types/tab';

type V2View = Tab['view'];

interface V2TabsState {
    tabs: Tab[];
    activeTabId: string;
}

type V2TabsAction =
    | { type: 'new-tab' }
    | { type: 'close-tab'; tabId: string }
    | { type: 'select-tab'; tabId: string }
    | { type: 'set-view'; view: V2View }
    | { type: 'reorder-tabs'; activeId: string; overId: string };

function initialV2State(): V2TabsState {
    const tab = createNewTab();
    return { tabs: [tab], activeTabId: tab.id };
}

function v2TabsReducer(state: V2TabsState, action: V2TabsAction): V2TabsState {
    switch (action.type) {
        case 'new-tab': {
            if (state.tabs.length >= MAX_TABS) return state;
            const tab = createNewTab();
            return { tabs: [...state.tabs, tab], activeTabId: tab.id };
        }
        case 'close-tab': {
            const index = state.tabs.findIndex((t) => t.id === action.tabId);
            if (index === -1) return state;
            const tabs = state.tabs.filter((t) => t.id !== action.tabId);
            if (tabs.length === 0) {
                // Never leave the strip empty — a fresh launcher tab takes over.
                const tab = createNewTab();
                return { tabs: [tab], activeTabId: tab.id };
            }
            let activeTabId = state.activeTabId;
            if (activeTabId === action.tabId) {
                activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
            }
            return { tabs, activeTabId };
        }
        case 'select-tab':
            return { ...state, activeTabId: action.tabId };
        case 'set-view':
            return {
                ...state,
                tabs: state.tabs.map((t) =>
                    t.id === state.activeTabId ? { ...t, view: action.view } : t,
                ),
            };
        case 'reorder-tabs': {
            const from = state.tabs.findIndex((t) => t.id === action.activeId);
            const to = state.tabs.findIndex((t) => t.id === action.overId);
            if (from === -1 || to === -1 || from === to) return state;
            const tabs = [...state.tabs];
            const [moved] = tabs.splice(from, 1);
            tabs.splice(to, 0, moved);
            return { ...state, tabs };
        }
        default:
            return state;
    }
}

export interface V2TabsApi {
    tabs: Tab[];
    activeTabId: string;
    activeView: V2View;
    newTab: () => void;
    closeTab: (tabId: string) => void;
    selectTab: (tabId: string) => void;
    setView: (view: V2View) => void;
    reorderTabs: (activeId: string, overId: string) => void;
}

export function useV2Tabs(): V2TabsApi {
    const [state, dispatch] = useReducer(v2TabsReducer, undefined, initialV2State);

    const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
    const activeView = activeTab?.view ?? 'launcher';

    const newTab = useCallback(() => dispatch({ type: 'new-tab' }), []);
    const closeTab = useCallback((tabId: string) => dispatch({ type: 'close-tab', tabId }), []);
    const selectTab = useCallback((tabId: string) => dispatch({ type: 'select-tab', tabId }), []);
    const setView = useCallback((view: V2View) => dispatch({ type: 'set-view', view }), []);
    const reorderTabs = useCallback(
        (activeId: string, overId: string) => dispatch({ type: 'reorder-tabs', activeId, overId }),
        [],
    );

    return { tabs: state.tabs, activeTabId: state.activeTabId, activeView, newTab, closeTab, selectTab, setView, reorderTabs };
}
