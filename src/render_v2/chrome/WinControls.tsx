/**
 * WinControls — v2 window controls for the fused titlebar. Same contract as the
 * v1 CustomTitleBar handlers (dynamic `getCurrentWindow()` import so browser
 * dev mode never hits the Tauri API, guarded by isTauri()). 30×28 hit areas per
 * SIDEBAR-TABBAR-IDEAS review round 1; Windows-only like v1 (macOS traffic
 * lights are native).
 */
import { Minus, Square, X, Copy } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/tauriClient';
import { isWindowsRendererPlatform } from '@/utils/overlayScrollbarActivity';

const isWindows = isWindowsRendererPlatform();

async function withWindow<T>(fn: (win: import('@tauri-apps/api/window').Window) => Promise<T>): Promise<void> {
    if (!isTauri()) return;
    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await fn(getCurrentWindow());
    } catch (err) {
        console.error('[v2] window control failed:', err);
    }
}

export default memo(function WinControls() {
    const { t } = useTranslation('app');
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        if (!isTauri()) return;
        let mounted = true;
        const check = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            try {
                const max = await getCurrentWindow().isMaximized();
                if (mounted) setIsMaximized(max);
            } catch (err) {
                console.error('[v2] window state check failed:', err);
            }
        };
        void check();
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => void check(), 150);
        };
        window.addEventListener('resize', onResize);
        return () => {
            mounted = false;
            window.removeEventListener('resize', onResize);
            clearTimeout(debounce);
        };
    }, []);

    if (!isWindows) return null;

    const controlClass =
        'flex w-[30px] h-[28px] items-center justify-center text-[var(--ink-faint)] transition-colors duration-150 hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]';

    return (
        <div className="flex h-full flex-shrink-0 items-stretch" data-no-drag>
            <button
                type="button"
                className={controlClass}
                title={t('titlebar.minimize')}
                aria-label={t('titlebar.minimize')}
                onClick={() => void withWindow((win) => win.minimize())}
            >
                <Minus className="h-4 w-4" />
            </button>
            <button
                type="button"
                className={controlClass}
                title={isMaximized ? t('titlebar.restoreWindow') : t('titlebar.maximize')}
                aria-label={isMaximized ? t('titlebar.restoreWindow') : t('titlebar.maximize')}
                onClick={() => void withWindow(async (win) => {
                    if (await win.isMaximized()) await win.unmaximize();
                    else await win.maximize();
                })}
            >
                {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </button>
            <button
                type="button"
                className={`${controlClass} hover:bg-[var(--error)] hover:text-[var(--on-error)]`}
                title={t('titlebar.close')}
                aria-label={t('titlebar.close')}
                onClick={() => void withWindow((win) => win.close())}
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
});
