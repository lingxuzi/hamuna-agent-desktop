/**
 * Chrome — the 38px fused titlebar for the v2 renderer (Variation A, frame
 * u9fa6 in docs/SIDEBAR-TABBAR-IDEAS.md). Order left→right:
 *
 *   LogoMark → NavCluster (4×26 nav) → TabsGroup (sortable, cap 12) → WinControls
 *
 * All visual values map to theme tokens (--paper/--ink/--accent/--line/…), no
 * orphan hex/px. Only transform/opacity animate, and prefers-reduced-motion is
 * respected. The drag-region contract matches v1 CustomTitleBar:
 * data-tauri-drag-region on empty spacers, data-no-drag on interactive slots.
 */
import { Sparkles } from 'lucide-react';
import { memo } from 'react';

import NavCluster from './NavCluster';
import TabsGroup from './TabsGroup';
import WinControls from './WinControls';
import { useResolvedTheme } from '@/theme';
import { type Tab } from '@/types/tab';
import { isWindowsRendererPlatform } from '@/utils/overlayScrollbarActivity';

const TITLEBAR_HEIGHT_PX = 38;
const isWindows = isWindowsRendererPlatform();

interface ChromeProps {
    tabs: Tab[];
    activeTabId: string;
    activeView: Tab['view'];
    onNavigate: (view: Tab['view']) => void;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onReorderTabs: (activeId: string, overId: string) => void;
}

export default memo(function Chrome({
    tabs,
    activeTabId,
    activeView,
    onNavigate,
    onSelectTab,
    onCloseTab,
    onNewTab,
    onReorderTabs,
}: ChromeProps) {
    const resolvedTheme = useResolvedTheme();

    return (
        <header
            className="flex flex-shrink-0 items-center border-b border-[var(--line)] bg-gradient-to-b from-[var(--paper)] to-[var(--paper-inset)]/30"
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

            {/* LogoMark — brand wordmark, non-drag so it stays clickable. */}
            <div className="flex h-full flex-shrink-0 items-center px-3 gap-1.5" data-no-drag>
                <Sparkles className="h-4 w-4 text-[var(--accent-warm)]" aria-hidden="true" />
                <span
                    className="select-none text-sm font-semibold tracking-[0.02em] text-[var(--ink)]"
                    aria-label={resolvedTheme.hero.productName}
                >
                    {resolvedTheme.hero.productName}
                </span>
            </div>

            {/* Nav cluster — 4 global nav entries (Home/Tasks/Team/Settings). */}
            <NavCluster activeView={activeView} onNavigate={onNavigate} />

            {/* Tabs — flex-1 owns the available slot; TabBar leaves unused space draggable. */}
            <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden" data-no-drag>
                <TabsGroup
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onNewTab={onNewTab}
                    onReorderTabs={onReorderTabs}
                />
            </div>

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
