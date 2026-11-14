// composerModel — the text ⇄ DOM mapping behind RichComposer.
//
// The composer keeps ONE source of truth: the plain string. Chips are a pure
// rendering of that string — a `/skill` or `@asset` marker wrapped in an
// `contenteditable=false` span. `textContent` of the editable element is
// therefore always byte-identical to the value the send path receives, so
// nothing downstream (slash dispatch, skill lookup, message payload) changes.
//
// Caret handling is offset-based rather than node-based: callers speak in
// character offsets into the plain string, and these helpers translate.

import { tokenizeForHighlight, type InputToken } from './inputHighlight';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c]);

/**
 * Does this token render as a chip?
 *
 * A marker whose end is at or after the caret is still being typed (`/comp`
 * on the way to `/compact`), so it stays plain text — chipping it mid-word
 * would yank the cursor out of a `contenteditable=false` island on the next
 * keystroke. `caret: null` means "not editing" (initial value, menu
 * insertion): every complete marker is a chip.
 */
function isChip(tok: InputToken, caret: number | null): boolean {
  if (tok.type === 'plain') return false;
  return caret === null || caret <= tok.start || caret > tok.end;
}

/**
 * Render plain text as composer HTML.
 *
 * `caret` is the live cursor offset while the user types — see `isChip` for
 * which markers it keeps as plain text.
 */
export function composerHtml(text: string, caret: number | null): string {
  return tokenizeForHighlight(text)
    .map((tok) => {
      if (!isChip(tok, caret)) return esc(tok.text);
      // The marker's leading `/` or `@` is semantically redundant — the chip's
      // own styling already says "this is a reference". Hide it visually but
      // keep it in the DOM: textContent must stay byte-identical to the value
      // (display:none text still counts), and caret offsets must not shift.
      const prefix = tok.text[0];
      return `<span class="cc-chip cc-chip-${tok.type}" contenteditable="false" data-ref="${tok.type}"><span class="cc-chip-prefix">${esc(prefix)}</span>${esc(tok.text.slice(1))}</span>`;
    })
    .join('');
}

/** The markers that render as chips for `text` at `caret`. */
export function chipTokens(text: string, caret: number | null): InputToken[] {
  return tokenizeForHighlight(text).filter((tok) => isChip(tok, caret));
}

/**
 * The range a Backspace / Delete at `caret` must remove as one unit.
 *
 * A chip is a marker rendered as a pill — but underneath it is still plain
 * text, so the browser's own deletion eats one character at a time and the
 * marker survives as text: the chip falls back to plain text instead of
 * disappearing. This returns the whole chip instead, so one keystroke takes
 * it out.
 *
 * Only a marker that is actually rendered as a chip qualifies. A marker the
 * caret is still inside — or that ends exactly at the caret — is plain text
 * while it is being typed, and deleting it character by character is what the
 * user expects then. So `backward` only reaches a chip across the whitespace
 * that committed it, and `forward` takes the chip that starts at the caret.
 */
export function chipDeleteRange(
  text: string,
  caret: number,
  dir: 'backward' | 'forward',
): { start: number; end: number } | null {
  const tokens = tokenizeForHighlight(text);
  if (dir === 'forward') {
    const chip = tokens.find((tok) => tok.type !== 'plain' && tok.start === caret);
    return chip ? { start: chip.start, end: chip.end } : null;
  }
  // A chip is committed by the whitespace right after it, and the caret sits
  // past that whitespace. Reaching the marker any other way means the caret is
  // on the marker itself — still being typed — so delete that normally.
  if (!/\s/.test(text[caret - 1] ?? '')) return null;
  const chip = tokens.find((tok) => tok.type !== 'plain' && tok.end === caret - 1);
  return chip ? { start: chip.start, end: caret } : null;
}

/** Cursor position as a character offset into the composer's plain text. */
export function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * The editable's text nodes, with their offsets into the plain string.
 *
 * A chip's text (the hidden prefix included) counts like any other text, so
 * the offsets line up with the plain string; the chip element itself is
 * reported so callers can treat it as one atomic unit.
 */
type TextSpan = { node: Text; start: number; end: number; chip: Element | null };

function textSpans(root: HTMLElement): TextSpan[] {
  const spans: TextSpan[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    spans.push({
      node: node as Text,
      start: offset,
      end: offset + len,
      chip: node.parentElement?.closest('.cc-chip') ?? null,
    });
    offset += len;
  }
  return spans;
}

/**
 * Place the cursor at a character offset, clamping past the end.
 *
 * A chip is an ATOMIC node — the same rule the canvas agent's inline chips
 * follow. The browser does not keep a caret inside a `contenteditable=false`
 * island: the selection is silently dropped, the cursor stops blinking and
 * the field stops receiving keystrokes. So a chip's text still counts towards
 * the offset, but the caret is placed before or after the pill — never inside.
 */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  /** Collapse the selection at a DOM position. */
  const place = (node: Node, o: number) => {
    const range = document.createRange();
    range.setStart(node, o);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  /** Collapse the selection right before / right after an element. */
  const placeBeside = (el: Element, after: boolean) => {
    const parent = el.parentNode;
    if (!parent) return false;
    const index = Array.prototype.indexOf.call(parent.childNodes, el);
    place(parent, after ? index + 1 : index);
    return true;
  };

  for (const span of textSpans(root)) {
    if (offset < span.start) break;
    if (offset > span.end) continue;
    if (span.chip) {
      // Inside the pill, or exactly at its edge → the far edge of it.
      placeBeside(span.chip, offset <= span.start ? false : true);
      return;
    }
    place(span.node, offset - span.start);
    return;
  }
  // Past the last text node: collapse at the very end.
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** A DOM range covering the plain-text offsets [start, end). */
export function rangeForOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const spans = textSpans(root);
  /** The DOM position for one offset. */
  const locate = (offset: number): { node: Node; offset: number } | null => {
    for (const span of spans) {
      if (offset < span.start) break;
      if (offset > span.end) continue;
      if (span.chip) {
        // A chip is atomic: its text is only addressable from outside.
        const parent = span.chip.parentNode;
        if (!parent) return null;
        const index = Array.prototype.indexOf.call(parent.childNodes, span.chip);
        return { node: parent, offset: offset <= span.start ? index : index + 1 };
      }
      return { node: span.node, offset: offset - span.start };
    }
    const tail = document.createRange();
    tail.selectNodeContents(root);
    tail.collapse(false);
    return { node: tail.startContainer, offset: tail.startOffset };
  };
  const from = locate(start);
  const to = locate(end);
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range;
}

/** Where two texts differ: the changed range in `from` and in `to`. */
export function textDiff(
  from: string,
  to: string,
): { start: number; fromEnd: number; toEnd: number } {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let fromEnd = from.length;
  let toEnd = to.length;
  while (fromEnd > start && toEnd > start && from[fromEnd - 1] === to[toEnd - 1]) {
    fromEnd--;
    toEnd--;
  }
  return { start, fromEnd, toEnd };
}

/**
 * Apply a text change to the editable through the browser's own command.
 *
 * The browser caches the text it knows about the editable. Rewrite the DOM
 * behind its back (innerHTML) and that cache goes stale: on the next
 * keystroke the browser re-parses the container from its cache, which drops
 * the chip markup we injected — the chip vanishes and the caret goes with it.
 * Going through the browser's editing command keeps its cache truthful.
 */
export function applyTextDiff(root: HTMLElement, from: string, to: string): boolean {
  const sel = window.getSelection();
  if (!sel) return false;
  const { start, fromEnd, toEnd } = textDiff(from, to);
  const range = rangeForOffsets(root, start, fromEnd);
  if (!range) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  // insertText replaces the selection, so one command does both halves.
  const inserted = to.slice(start, toEnd);
  // The command is missing in jsdom and can be refused in locked-down
  // embeddings — the caller falls back to rewriting the markup.
  if (typeof document.execCommand !== 'function') return false;
  try {
    return inserted
      ? document.execCommand('insertText', false, inserted)
      : document.execCommand('delete');
  } catch {
    return false;
  }
}

/**
 * Does the DOM already show `text` with exactly the chips `caret` renders?
 *
 * Comparing the serialized HTML is not enough: the browser inserts a
 * non-breaking space for a space typed at the end of an editable and escapes
 * it as `&nbsp;`, while our markup holds the raw character — the strings then
 * differ on every keystroke after a chip, and a rewrite would throw the live
 * selection away for nothing.
 */
/** The chips the DOM currently shows, as a comparable signature. */
function chipSignature(root: HTMLElement): string {
  return Array.from(root.querySelectorAll('.cc-chip'))
    .map((el) => `${el.getAttribute('data-ref') ?? ''}:${el.textContent}`)
    .join('\u0001');
}

/** Does the DOM show exactly the chips `text` renders at `caret`? */
export function chipsMatch(root: HTMLElement, text: string, caret: number | null): boolean {
  const want = chipTokens(text, caret)
    .map((tok) => `${tok.type}:${tok.text}`)
    .join('\u0001');
  return chipSignature(root) === want;
}

export function rendersSame(root: HTMLElement, text: string, caret: number | null): boolean {
  return root.textContent === text && chipsMatch(root, text, caret);
}
