// RichComposer — a contentEditable composer that renders `/skill` and `@asset`
// markers as inline chips while keeping one plain-string source of truth.
//
// Why a facade: `SimpleChatInput` drives its input through a
// `RefObject<HTMLTextAreaElement>` in ~30 places (selectionStart,
// setSelectionRange, style.height, scrollHeight, offsetParent, value). Rather
// than rewrite every call site, this component installs an object that mimics
// those members on the same ref. Callers keep speaking textarea.
//
// IME: never rewrite innerHTML while `isComposing` is true. WebKit + macOS IME
// (the Bug #123 trigger) duplicates candidate text when the composer mutates
// the DOM mid-composition — so composition input only updates the value, and
// the chip rewrite happens on the first post-commit input.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { applyTextDiff, caretOffset, chipDeleteRange, chipsMatch, composerHtml, rendersSame, setCaretOffset, textDiff } from './composerModel';

/** The subset of HTMLTextAreaElement that composer call sites actually use. */
export type ComposerFacade = Pick<
  HTMLTextAreaElement,
  'value' | 'selectionStart' | 'selectionEnd' | 'scrollTop' | 'scrollHeight' | 'offsetParent' | 'style'
  | 'focus' | 'blur' | 'select' | 'setSelectionRange'
>;

/** Call sites keep typing `HTMLTextAreaElement`; this is the one place we lie. */
export const asTextarea = (f: ComposerFacade | null): HTMLTextAreaElement | null =>
  f as unknown as HTMLTextAreaElement | null;

interface RichComposerProps {
  value: string;
  /** Fires on every edit with the new plain text and the caret offset. */
  onChange: (value: string, caret: number) => void;
  facadeRef: React.RefObject<ComposerFacade | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  placeholder: string;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function RichComposer({
  value,
  onChange,
  facadeRef,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  readOnly = false,
  className = '',
  style,
}: RichComposerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  // Offset the caller last asked for; re-applied after any innerHTML rewrite.
  const pendingCaretRef = useRef<number | null>(null);

  // Install the textarea-shaped facade on the caller's ref for the lifetime of
  // the composer. Defined once — the object reads the live DOM on each access.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !facadeRef) return;
    const facade: ComposerFacade = {
      get value() {
        return root.textContent ?? '';
      },
      get selectionStart() {
        return caretOffset(root);
      },
      get selectionEnd() {
        return caretOffset(root);
      },
      get scrollTop() {
        return root.scrollTop;
      },
      set scrollTop(v: number) {
        root.scrollTop = v;
      },
      get scrollHeight() {
        return root.scrollHeight;
      },
      get offsetParent() {
        return root.offsetParent;
      },
      get style() {
        return root.style;
      },
      focus() {
        root.focus();
      },
      blur() {
        root.blur();
      },
      select() {
        const range = document.createRange();
        range.selectNodeContents(root);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      },
      setSelectionRange(start: number, end: number) {
        // Textareas select a range; the composer only needs the caret anchor,
        // and every caller passes start === end.
        void end;
        setCaretOffset(root, start);
      },
    };
    facadeRef.current = facade;
    return () => {
      facadeRef.current = null;
    };
  }, [facadeRef]);

  // Render chips. Runs on every value change INCLUDING user typing — the plain
  // text offsets are stable across the rewrite, so restoring the caret to the
  // same offset puts the cursor exactly where the user left it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    const caret = pendingCaretRef.current;
    // The offset only describes THIS change — a later value change that did
    // not come from typing must not restore a stale caret.
    pendingCaretRef.current = null;
    // Only rewrite when the rendering really differs. Rewriting on every
    // keystroke would drop the live selection each time and leave the
    // browser's editing state stale — the next keystroke then wipes the chip.
    if (rendersSame(root, value, caret)) return;

    const hadFocus = document.activeElement === root;
    const domText = root.textContent ?? '';
    let textOk = domText === value;
    // Where the caret belongs after the change: the offset the caller asked
    // for while typing, or the end of the changed region for a programmatic
    // change.
    let offset = caret;
    if (!textOk) {
      // A text change has to go THROUGH the browser. Mutating the DOM behind
      // the browser's back leaves its cached editing state stale: the next
      // keystroke then re-parses the field and drops the chip. The command
      // needs an active editor, and every caller that changes the value
      // focuses the composer right after anyway.
      if (!hadFocus) root.focus();
      offset = textDiff(domText, value).toEnd;
      textOk = applyTextDiff(root, domText, value);
    }
    // The markup rewrite only changes the structure, never the text — that
    // keeps the browser's cache truthful.
    if (!textOk || !chipsMatch(root, value, caret)) {
      root.innerHTML = composerHtml(value, caret);
    }
    // Only touch the selection when the composer owns it — a value change
    // must not steal the caret from another field.
    if (!hadFocus && domText === value) return;
    if (document.activeElement !== root) root.focus();
    setCaretOffset(root, Math.min(offset ?? caretOffset(root), value.length));
  }, [value]);

  const handleInput = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const caret = caretOffset(root);
    pendingCaretRef.current = caret;
    onChange(root.textContent ?? '', caret);
  }, [onChange]);

  // Backspace / Delete must take a whole chip out, not eat it one character
  // at a time — the marker would survive as plain text (the chip falls back to
  // text instead of disappearing). RichComposer owns the chip rendering, so it
  // owns this rule; the browser's own deletion never runs.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || composingRef.current || readOnly) return;
      // Cmd/Ctrl+Backspace means "delete to line start" — leave it alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const root = rootRef.current;
      if (!root) return;
      // A selection deletes itself; only a collapsed caret can mean "one chip".
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const caret = caretOffset(root);
      const range = chipDeleteRange(value, caret, e.key === 'Backspace' ? 'backward' : 'forward');
      if (!range) return;
      e.preventDefault();
      pendingCaretRef.current = range.start;
      onChange(value.slice(0, range.start) + value.slice(range.end), range.start);
    },
    [onKeyDown, value, onChange, readOnly],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    onCompositionStart?.();
  }, [onCompositionStart]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    pendingCaretRef.current = null;
    onCompositionEnd?.();
    // Re-render now that composition committed, so a marker completed by the
    // IME gets its chip.
    const root = rootRef.current;
    if (root) onChange(root.textContent ?? '', caretOffset(root));
  }, [onChange, onCompositionEnd]);

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBlur={() => {
        // Leaving the field completes any half-typed marker: chip it.
        pendingCaretRef.current = null;
        const root = rootRef.current;
        if (root) onChange(root.textContent ?? '', caretOffset(root));
      }}
      className={`cc-root ${className}`}
      style={style}
    />
  );
}
