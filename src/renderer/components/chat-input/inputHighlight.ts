// tokenizeForHighlight — split chat input text into plain / skill / asset
// segments, so the composer can render selected `/skill` and `@asset`
// references as removable pill chips above the textarea.
//
// Matching is intentionally conservative: a marker only counts at the start
// of the text or after whitespace, so URLs (https://…) and emails never
// become chips. `start`/`end` are indices into the original string so a chip's
// × can cut exactly that range back out.

export type InputToken = { type: 'plain' | 'skill' | 'asset'; text: string; start: number; end: number };

// Asset body stops at whitespace and at sentence/quote/bracket punctuation, so
// "看看 @a/b.ts，继续" chips `@a/b.ts`. Dots, slashes, dashes and colons stay
// inside (file extensions, nested paths, Windows drive letters).
const MARK_RE = /(^|\s)(\/[A-Za-z0-9][A-Za-z0-9_.:-]*|@[^\s，。；：！？、,;!?()（）[\]【】"'“”‘’]+)/g;

export function tokenizeForHighlight(text: string): InputToken[] {
  const tokens: InputToken[] = [];
  let last = 0;
  MARK_RE.lastIndex = 0;
  for (let m = MARK_RE.exec(text); m; m = MARK_RE.exec(text)) {
    // m[1] is the preceding whitespace (or empty at text start) — it stays plain.
    const wsEnd = m.index + m[1].length;
    if (wsEnd > last) tokens.push({ type: 'plain', text: text.slice(last, wsEnd), start: last, end: wsEnd });
    const body = m[2];
    tokens.push({
      type: body.startsWith('/') ? 'skill' : 'asset',
      text: body,
      start: wsEnd,
      end: wsEnd + body.length,
    });
    last = wsEnd + body.length;
  }
  if (last < text.length) tokens.push({ type: 'plain', text: text.slice(last), start: last, end: text.length });
  return tokens;
}
