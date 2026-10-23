// Behavior test for the "恢复对话" pill (Issue #309). The pill is opt-in
// session restore surfaced in the title bar only after a non-clean exit. We
// mock the Tauri-heavy deps (effects bail when isTauri() is false) and assert
// the pill's visibility gate + click wiring.
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('@/api/tauriClient', () => ({ isTauri: () => mocks.isTauri() }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        close: vi.fn(),
        isFullscreen: vi.fn().mockResolvedValue(false),
        isMaximized: vi.fn().mockResolvedValue(false),
        maximize: vi.fn(),
        minimize: vi.fn(),
        unmaximize: vi.fn(),
    }),
}));

import { i18n } from '@/i18n';
import { GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET } from '@/utils/globalSidebarPreference';
import CustomTitleBar from './CustomTitleBar';

function renderBar(over: Partial<React.ComponentProps<typeof CustomTitleBar>> = {}) {
    const onRestoreSession = vi.fn();
    const onDismissRestore = vi.fn();
    const result = render(
        <CustomTitleBar
            onRestoreSession={onRestoreSession}
            onDismissRestore={onDismissRestore}
            {...over}
        >
            <div data-testid="tabbar" />
        </CustomTitleBar>,
    );
    return { ...result, onRestoreSession, onDismissRestore };
}

describe('CustomTitleBar — 恢复对话 pill (Issue #309)', () => {
    let userAgentSpy: ReturnType<typeof vi.spyOn>;

    /** Pretend to run on macOS, where the native traffic lights float over the
     *  webview and the sidebar toggle has to clear them. */
    const setMacUserAgent = () => userAgentSpy.mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    );

    beforeEach(async () => {
        mocks.isTauri.mockReturnValue(false);
        await i18n.changeLanguage('zh-CN');
        userAgentSpy = vi.spyOn(navigator, 'userAgent', 'get');
        setMacUserAgent();
    });

    afterEach(() => {
        userAgentSpy.mockRestore();
    });

    it('is hidden when restoreCount is 0 (clean quit → no nag)', () => {
        renderBar({ restoreCount: 0 });
        expect(screen.queryByText('恢复上次对话')).toBeNull();
    });

    it('shows the pill and the count badge when there are restorable tabs', () => {
        renderBar({ restoreCount: 3 });
        expect(screen.getByText('恢复上次对话')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('omits the count badge for a single conversation', () => {
        renderBar({ restoreCount: 1 });
        expect(screen.getByText('恢复上次对话')).toBeTruthy();
        expect(screen.queryByText('1')).toBeNull();
    });

    it('restores on body click, dismisses on ✕ click', () => {
        const { onRestoreSession, onDismissRestore } = renderBar({ restoreCount: 2 });

        fireEvent.click(screen.getByText('恢复上次对话'));
        expect(onRestoreSession).toHaveBeenCalledTimes(1);
        expect(onDismissRestore).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTitle('忽略'));
        expect(onDismissRestore).toHaveBeenCalledTimes(1);
        expect(onRestoreSession).toHaveBeenCalledTimes(1);
    });

    it('keeps explicit draggable regions around and between titlebar actions', () => {
        const { container } = renderBar({ restoreCount: 0 });
        const tauriDragRegions = Array.from(container.querySelectorAll('[data-tauri-drag-region]'));
        const tabbarHost = screen.getByTestId('tabbar').parentElement;

        expect(tauriDragRegions.length).toBeGreaterThanOrEqual(3);
        expect(tauriDragRegions.some((node) => (node as HTMLElement).style.width === '30px')).toBe(true);
        expect(tauriDragRegions.some((node) => (node as HTMLElement).className.includes('w-1'))).toBe(true);
        expect(container.querySelector('[data-hamuna-titlebar-drag-region]')).toBeNull();
        expect(tabbarHost?.className).toContain('flex-1');
    });

    it('keeps only the Team entry in the titlebar (other shortcuts moved to the sidebar)', async () => {
        mocks.isTauri.mockReturnValue(true);
        await i18n.changeLanguage('en-US');

        renderBar({ teamSpaceEnabled: true });

        expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /MiniApp/ })).not.toBeInTheDocument();
    });

    it('reserves the rail toggle slot only when the sidebar is collapsed', async () => {
        const { container, rerender } = renderBar({ restoreCount: 0 });
        const spacerWidth = () => Array.from(container.querySelectorAll('[data-tauri-drag-region]'))
            .map((node) => (node as HTMLElement).style.width)
            .filter((w) => w !== '') ;

        rerender(
            <CustomTitleBar onRestoreSession={() => {}} onDismissRestore={() => {}} restoreCount={0}>
                <div data-testid="tabbar" />
            </CustomTitleBar>,
        );
        // Rail mode: the toggle overhangs the 64px rail onto this bar, so its
        // slot is reserved. Expanded mode: the sidebar covers the slot itself.
        expect(spacerWidth()).toContain(`${GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET}px`);

        rerender(
            <CustomTitleBar onRestoreSession={() => {}} onDismissRestore={() => {}} restoreCount={0} sidebarExpanded>
                <div data-testid="tabbar" />
            </CustomTitleBar>,
        );
        expect(spacerWidth()).not.toContain(`${GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET}px`);
    });

    it('reserves no rail slot off macOS, where the toggle never leaves the rail', () => {
        userAgentSpy.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15');
        const { container } = renderBar({ restoreCount: 0 });
        const spacerWidth = Array.from(container.querySelectorAll('[data-tauri-drag-region]'))
            .map((node) => (node as HTMLElement).style.width)
            .filter((w) => w !== '');

        expect(spacerWidth).not.toContain(`${GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET}px`);
    });
});
