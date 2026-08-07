/**
 * PlaceholderV2 — interim body for views whose page isn't landed yet. Keeps
 * the v2 shell navigable end-to-end before each page lands (Launcher first,
 * then Chat/Settings/TaskCenter/Space).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PlaceholderV2Props {
    view: string;
    onBack: () => void;
}

export default memo(function PlaceholderV2({ view, onBack }: PlaceholderV2Props) {
    const { t } = useTranslation('app');
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--ink-muted)]">
            <p className="text-sm">{t('v2.placeholderBody', { view })}</p>
            <button
                type="button"
                onClick={onBack}
                className="rounded-md bg-[var(--paper-elevated)] px-3 py-1.5 text-xs text-[var(--ink)] shadow-sm transition-colors hover:bg-[var(--paper-inset)]"
            >
                {t('v2.placeholderBack')}
            </button>
        </div>
    );
});
