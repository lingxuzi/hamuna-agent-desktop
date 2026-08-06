/**
 * Unit tests for the v2 tab reducer. Covers the D1 invariant (launch-chat must
 * produce a non-empty sessionId + explicit disposition via buildChatFlipPatch)
 * and the tab lifecycle actions. The reducer is a pure function, so it is
 * driven directly without a component tree (per repo test discipline: decision
 * logic extracted to a pure function).
 */
import { describe, expect, it } from 'vitest';

import { createNewTab, MAX_TABS } from '@/types/tab';
import { v2TabsReducer, type LaunchChatFields } from './useTabs';

function initialSeed() {
  const tab = createNewTab();
  return { tabs: [tab], activeTabId: tab.id };
}

const launchFields: LaunchChatFields = {
  agentDir: '/work/alpha',
  sessionId: 'pending-tab1',
  title: 'alpha',
  sidecarConfigDisposition: 'pending',
};

describe('useTabs reducer', () => {
  it('launch-chat flips the tab to chat view with the D1 fields', () => {
    const state = initialSeed();
    const next = v2TabsReducer(state, {
      type: 'launch-chat',
      tabId: state.activeTabId,
      fields: launchFields,
    });

    const tab = next.tabs.find((t) => t.id === state.activeTabId)!;
    expect(tab.view).toBe('chat');
    // D1: non-empty sessionId and explicit disposition, never blank.
    expect(tab.sessionId).toBe('pending-tab1');
    expect(tab.sidecarConfigDisposition).toBe('pending');
    expect(tab.agentDir).toBe('/work/alpha');
    expect(next.activeTabId).toBe(state.activeTabId);
  });

  it('launch-chat resolves disposition via patch-tab to push/adopt', () => {
    let state = initialSeed();
    state = v2TabsReducer(state, {
      type: 'launch-chat',
      tabId: state.activeTabId,
      fields: launchFields,
    });
    const next = v2TabsReducer(state, {
      type: 'patch-tab',
      tabId: state.activeTabId,
      patch: { sidecarConfigDisposition: 'push' },
    });
    const tab = next.tabs.find((t) => t.id === state.activeTabId)!;
    expect(tab.sidecarConfigDisposition).toBe('push');
  });

  it('new-tab appends a fresh launcher tab and activates it', () => {
    const state = initialSeed();
    const next = v2TabsReducer(state, { type: 'new-tab' });
    expect(next.tabs.length).toBe(2);
    const added = next.tabs[next.tabs.length - 1];
    expect(added.view).toBe('launcher');
    expect(next.activeTabId).toBe(added.id);
  });

  it('new-tab is capped at MAX_TABS', () => {
    let state = initialSeed();
    for (let i = 1; i < MAX_TABS; i++) {
      state = v2TabsReducer(state, { type: 'new-tab' });
    }
    const next = v2TabsReducer(state, { type: 'new-tab' });
    expect(next.tabs.length).toBe(MAX_TABS);
  });

  it('close-tab re-activates the neighbour and never leaves the strip empty', () => {
    let state = initialSeed();
    state = v2TabsReducer(state, { type: 'new-tab' });
    const first = state.tabs[0].id;
    const second = state.tabs[1].id;
    expect(state.activeTabId).toBe(second);

    // Close the active (second) tab → falls back to the first.
    const closed = v2TabsReducer(state, { type: 'close-tab', tabId: second });
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeTabId).toBe(first);

    // Close the last tab → a fresh launcher tab replaces it.
    const emptied = v2TabsReducer(closed, { type: 'close-tab', tabId: first });
    expect(emptied.tabs).toHaveLength(1);
    expect(emptied.tabs[0].view).toBe('launcher');
  });

  it('set-view patches only the active tab', () => {
    let state = initialSeed();
    state = v2TabsReducer(state, { type: 'new-tab' });
    const [first, second] = state.tabs.map((t) => t.id);
    // Activate the first tab so the second is a non-active sibling.
    state = v2TabsReducer(state, { type: 'select-tab', tabId: first });
    const next = v2TabsReducer(state, { type: 'set-view', view: 'taskcenter' });

    const active = next.tabs.find((t) => t.id === next.activeTabId)!;
    expect(active.view).toBe('taskcenter');
    const other = next.tabs.find((t) => t.id === second);
    expect(other?.view).not.toBe('taskcenter');
  });

  it('patch-tab shallow-merges runtime fields', () => {
    const state = initialSeed();
    const next = v2TabsReducer(state, {
      type: 'patch-tab',
      tabId: state.activeTabId,
      patch: { title: 'renamed', isGenerating: true },
    });
    const tab = next.tabs.find((t) => t.id === state.activeTabId)!;
    expect(tab.title).toBe('renamed');
    expect(tab.isGenerating).toBe(true);
  });

  it('reorder-tabs moves the active tab over the target', () => {
    let state = initialSeed();
    state = v2TabsReducer(state, { type: 'new-tab' });
    state = v2TabsReducer(state, { type: 'new-tab' });
    const [a, b, c] = state.tabs.map((t) => t.id);

    const next = v2TabsReducer(state, {
      type: 'reorder-tabs',
      activeId: c,
      overId: a,
    });
    expect(next.tabs.map((t) => t.id)).toEqual([c, a, b]);
  });
});
