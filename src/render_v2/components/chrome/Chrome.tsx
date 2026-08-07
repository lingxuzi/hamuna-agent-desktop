/**
 * Chrome — the 44px fused titlebar for the v2 renderer (u9fa6). Order left→right:
 *
 *   [Windows edge-drag 30px] → TabBar (v1, sortable, cap 12) → UpdateBtn → WinControls
 *
 * The design puts the tab strip directly in the titlebar (no separate LogoMark /
 * NavCluster — global nav moved to the per-page Sidebar). The drag-region
 * contract matches v1 CustomTitleBar: data-tauri-drag-region on empty spacers,
 * data-no-drag on interactive slots. All visual values map to theme tokens.
 */
import { memo } from 'react';

import TabBar from '@/components/TabBar';
import { type Tab } from '@/types/tab';
import { isWindowsRendererPlatform } from '@/utils/overlayScrollbarActivity';

import UpdateBtn from './UpdateBtn';
import WinControls from './WinControls';

const TITLEBAR_HEIGHT_PX = 44;
const isWindows = isWindowsRendererPlatform();

interface ChromeProps {
    tabs: Tab[];
    activeTabId: string;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onReorderTabs: (activeId: string, overId: string) => void;
}

export default memo(function Chrome({
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
    onNewTab,
    onReorderTabs,
}: ChromeProps) {
    return (
        <header
            className="flex flex-shrink-0 items-center border-b border-[var(--line)] bg-[var(--paper)]"
            style={{ height: TITLEBAR_HEIGHT_PX }}
        >
            {/* Windows left-edge drag target (matches v1 EDGE_DRAG_REGION_WIDTH). */}
            {isWindows && (
                <div
                    className="h-full flex-shrink-0"
                    style={{ width: 30 }}
                    data-tauri-drag-region
                    aria-hidden="true"
                />
            )}

            {/* Tab strip — flex-1 owns the available slot; unused space is draggable. */}
            <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden" data-no-drag>
                <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onNewTab={onNewTab}
                    onReorderTabs={onReorderTabs}
                />
            </div>

            {/* Update indicator (only when an update is ready). */}
            <UpdateBtn />

            {/* Right-edge drag target — kept fixed so crowded tabs never cover it. */}
            <div
                className="h-full flex-shrink-0"
                style={{ width: 30 }}
                data-tauri-drag-region
                aria-hidden="true"
            />

            {/* Window controls (Windows only). */}
            <WinControls />
        </header>
    );
});
