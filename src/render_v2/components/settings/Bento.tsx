/**
 * SettingsV2 primitives — the Bento tile layout + setting row that Pencil
 * [final] t2DE7F specifies. Each tile = header + header divider + rows; each
 * row = label/description (left) + control (right), rows separated by a hairline.
 *
 * These are the only layout atoms the general section needs; shared panels
 * (GlobalPluginsPanel, ToolboxSection, …) render their own card structures.
 */
import type { ReactNode } from 'react';

/** A single grid tile: header + divider + rows. Maps to Pencil Tile_* nodes. */
export function BentoCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
            <h3 className="text-base font-medium text-[var(--ink)]">{title}</h3>
            <div className="mt-3 mb-1 h-px bg-[var(--line-subtle)]" />
            <div className="flex flex-col">{children}</div>
        </div>
    );
}

/** One setting row: label + description on the left, control on the right.
 *  Rows are separated by a hairline (matches Pencil Row_* + Div). */
export function SettingRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-3 first:pt-2 last:pb-1">
            <div className="min-w-0 flex-1 pr-4">
                <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
                {description && <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{description}</p>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

/** Row separator — a hairline between settings rows. */
export function RowDivider() {
    return <div className="h-px bg-[var(--line-subtle)]" />;
}
