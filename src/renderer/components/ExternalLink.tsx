// External link component that opens URLs using system default browser
// Supports text selection for copying while allowing click-to-open

import { type ReactNode, type MouseEvent } from 'react';
import { openExternal } from '@/utils/openExternal';

interface ExternalLinkProps {
    href: string;
    children: ReactNode;
    className?: string;
    title?: string;
    /**
     * Optional click observer. Fires AFTER the default text-selection guard
     * but BEFORE the openExternal call. Use this for tap-counter easter
     * eggs (`event.preventDefault()` + `stopPropagation()` will fully cancel
     * the default navigation). When the user has selected text the observer
     * is intentionally skipped so text-selection copy keeps the original
     * UX, matching the standard ExternalLink contract.
     */
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A link component that opens external URLs in the system browser
 * while still allowing text selection for copying.
 *
 * Click behavior:
 * - Single click without text selection: opens the link
 * - Click after selecting text: does not open (allows copy)
 */
export function ExternalLink({ href, children, className, title, onClick }: ExternalLinkProps) {
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();

        // Check if user is selecting text (has selection)
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().length > 0;

        if (!hasSelection) {
            onClick?.(e);
        }

        if (!hasSelection && !e.defaultPrevented && href) {
            openExternal(href);
        }
    };

    return (
        <a
            href={href}
            onClick={handleClick}
            className={className}
            title={title}
            // Allow text selection
            style={{ userSelect: 'text' }}
        >
            {children}
        </a>
    );
}

export default ExternalLink;
