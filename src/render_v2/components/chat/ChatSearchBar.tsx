/**
 * ChatSearchBar — floating in-conversation search bar (GUp8L). Absolute overlay
 * at the top of the ChatArea: search icon + placeholder, then prev/next arrows,
 * a mono result count, an esc hint, and a close glyph. Static for now.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

interface ChatSearchBarProps {
    /** Current / total match count, e.g. "3 / 12". */
    count?: string;
}

export default memo(function ChatSearchBar({ count = '3 / 12' }: ChatSearchBarProps) {
    const { t } = useTranslation('app');

    return (
        <div className="absolute left-[120px] top-3 flex h-10 w-[720px] max-w-[calc(100%-240px)] items-center gap-2.5 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-elevated)]/90 px-3.5 shadow-sm backdrop-blur-sm">
            <Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-subtle)]">
                {t('v2.chat.searchPlaceholder')}
            </span>
            <button
                type="button"
                aria-label="prev"
                className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
                <ChevronUp className="h-4 w-4" />
            </button>
            <button
                type="button"
                aria-label="next"
                className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
                <ChevronDown className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs text-[var(--ink-subtle)]">{count}</span>
            <span className="hidden font-mono text-xs text-[var(--ink-subtle)] sm:inline">esc</span>
            <button
                type="button"
                aria-label="close"
                className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
});
