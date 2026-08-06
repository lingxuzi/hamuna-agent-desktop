/**
 * TabsGroup — the v2 tab strip slot. The sortable/drag/scroll/overflow logic
 * lives in the shared v1 TabBar component (components/TabBar.tsx) which is pure
 * token + @dnd-kit with zero App coupling, so v2 reuses it as-is instead of
 * rebuilding the reorder pipeline. Its props map 1:1 to useV2Tabs actions.
 */
import { memo } from 'react';

import TabBar from '@/components/TabBar';
import { type Tab } from '@/types/tab';

interface TabsGroupProps {
    tabs: Tab[];
    activeTabId: string;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onReorderTabs: (activeId: string, overId: string) => void;
}

export default memo(function TabsGroup({
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
    onNewTab,
    onReorderTabs,
}: TabsGroupProps) {
    return (
        <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onNewTab={onNewTab}
            onReorderTabs={onReorderTabs}
        />
    );
});
