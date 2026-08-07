/**
 * SettingTile — a Bento card on the v2 Settings page (cTjk2 BentoGrid). Each
 * tile has a header row (icon + title + hairline divider) and a stack of rows;
 * each row is icon + label + dashed spacer + value, per the comp's Tile_* nodes.
 *
 * Static prototype: rows are hard-coded sample values until the settings config
 * is wired (see SETTINGS-IDEAS caveats).
 *
 * Font note: row labels are 14px (text-sm) and row values 13px — 13 is not in
 * the locked seven-step scale, so values use text-xs (12px).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

interface SettingRow {
    icon: LucideIcon;
    /** i18n key of the row label, resolved as v2.settings.rows.<label>. */
    label: string;
    /** i18n key of the row value, resolved as v2.settings.rows.<value>. */
    value: string;
}

interface SettingTileProps {
    /** i18n key of the tile header, resolved as v2.settings.tiles.<title>. */
    titleKey: string;
    headerIcon: LucideIcon;
    rows: SettingRow[];
    /** Width class — the comp fixes tile widths (776/392, 584/584). */
    className?: string;
}

export default memo(function SettingTile({
    titleKey,
    headerIcon: HeaderIcon,
    rows,
    className,
}: SettingTileProps) {
    const { t } = useTranslation('app');

    return (
        <section
            className={`flex flex-col gap-3 rounded-lg bg-[var(--paper-elevated)] p-5 ${className ?? ''}`}
        >
            {/* Header: icon + title + hairline */}
            <header className="flex h-5 items-center gap-2">
                <HeaderIcon className="h-[15px] w-[15px] text-[var(--ink-muted)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--ink)]">
                    {t(`v2.settings.tiles.${titleKey}`)}
                </h3>
            </header>
            <div className="h-px w-full bg-[var(--line)]" />

            {/* Rows */}
            <div className="flex flex-col">
                {rows.map((row, i) => {
                    const RowIcon = row.icon;
                    return (
                        <div key={row.label}>
                            <div className="flex h-8 items-center gap-2.5">
                                <RowIcon className="h-3.5 w-3.5 text-[var(--ink-muted)]" aria-hidden="true" />
                                <span className="text-sm font-medium text-[var(--ink)]">
                                    {t(`v2.settings.rows.${row.label}`)}
                                </span>
                                <span className="mx-1 flex-1 border-t border-dashed border-[var(--line)]" />
                                <span className="text-xs text-[var(--ink-muted)]">
                                    {t(`v2.settings.rows.${row.value}`)}
                                </span>
                            </div>
                            {i < rows.length - 1 && <div className="h-px w-full bg-[var(--line)]" />}
                        </div>
                    );
                })}
            </div>
        </section>
    );
});
