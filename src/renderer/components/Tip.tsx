/** Lightweight tooltip — appears instantly on hover/focus, no timers.
 *  `position="top"` (default) shows above; `"bottom"` below; `"right"` beside
 *  (use for rail icons). `align="center"` (default) centers; `"end"` aligns to
 *  the right edge. `disabled` suppresses the tooltip while the trigger owns an
 *  open Popover.
 *  `shortcut` adds a muted second line (e.g. "⌘ + Enter") rendered below the
 *  main label. Use for actions with a keyboard accelerator worth teaching —
 *  keep it to a short inline string, no raw JSX.
 *
 *  The bubble is portaled through Popover, so scroll containers cannot clip it
 *  and floating-ui flips it at viewport edges — an absolutely positioned child
 *  would be cut off by the sidebar's `overflow: auto` column. */
import { useRef, useState } from 'react';

import { Popover, type PopoverPlacement } from './ui/Popover';

function tipPlacement(
  position: 'top' | 'bottom' | 'right',
  align: 'center' | 'end',
): PopoverPlacement {
  if (position === 'right') return 'right';
  if (align === 'end') return `${position}-end`;
  return position;
}

export default function Tip({
  label,
  shortcut,
  children,
  position = 'top',
  align = 'center',
  disabled = false,
  className = '',
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'right';
  align?: 'center' | 'end';
  disabled?: boolean;
  /** Wrapper classes — pass `w-full` so a full-width trigger keeps its width. */
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const visible = (hovered || focusedWithin) && !disabled;
  const dismiss = () => {
    setHovered(false);
    setFocusedWithin(false);
  };

  return (
    <span
      ref={anchorRef}
      className={`relative inline-flex ${className}`.trim()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={dismiss}
      // Activation consumes the hint even if the child stops bubbling.
      onClickCapture={dismiss}
      onContextMenuCapture={dismiss}
      onFocusCapture={() => setFocusedWithin(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusedWithin(false);
      }}
    >
      {children}
      {visible && (
        <Popover
          open
          onClose={dismiss}
          anchorRef={anchorRef}
          placement={tipPlacement(position, align)}
          offset={position === 'right' ? 12 : 6}
          closeOnOutsideClick={false}
          closeOnEscape={false}
          zIndex={280}
          unstyled
          className="pointer-events-none"
        >
          <span
            role="tooltip"
            className="block whitespace-nowrap rounded-md bg-[var(--button-dark-bg)]/90 px-2.5 py-1.5 text-xs leading-tight text-[var(--button-dark-text)]"
          >
            {label}
            {shortcut && (
              <span className="mt-0.5 block text-xs text-[var(--button-dark-text)]/70">
                {shortcut}
              </span>
            )}
          </span>
        </Popover>
      )}
    </span>
  );
}
