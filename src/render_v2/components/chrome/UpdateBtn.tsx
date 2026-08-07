/**
 * UpdateBtn — the fused-titlebar update indicator (u9fa6: UpdateBtn 26×26,
 * UpdateDot 8×8 accent-sky). Only renders when an update is downloaded and
 * ready to install; clicking restarts the app to apply it. Kept as a compact
 * dot per the comp — the full pill lives in v1 CustomTitleBar.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUpdater } from '@/hooks/useUpdater';

export default memo(function UpdateBtn() {
    const { t } = useTranslation('app');
    const { updateReady, updateVersion, restartAndUpdate, installing } = useUpdater();

    if (!updateReady) return null;

    return (
        <button
            type="button"
            onClick={installing ? undefined : () => void restartAndUpdate()}
            disabled={installing}
            title={updateVersion
                ? t('titlebar.updateToVersion', { version: updateVersion })
                : t('titlebar.restartAndUpdate')}
            aria-label={t('titlebar.restartAndUpdate')}
            data-no-drag
            className="relative flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[10px] text-[var(--ink-faint)] transition-colors duration-150 hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait"
        >
            <span className="h-2 w-2 rounded-full bg-[var(--accent-sky)]" aria-hidden="true" />
        </button>
    );
});
