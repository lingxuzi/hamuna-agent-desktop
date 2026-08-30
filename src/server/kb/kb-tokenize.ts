// kb-tokenize.ts — jieba-wasm tokenization for Chinese fulltext.
//
// REQUIRED (not a nice-to-have): TypeGraph's SQLite backend hard-codes the
// FTS5 tokenizer as `porter unicode61 remove_diacritics 2`. `unicode61` treats
// a contiguous CJK run as ONE unbreakable token, so a Chinese query against a
// raw `searchable()` field returns ZERO matches (verified at raw SQLite level
// in the Phase 0 spike). The fix is to pre-tokenize with jieba `cut_for_search`
// into a space-joined word sequence on write, and tokenize queries the same
// way on read. jieba-wasm ships as a lazy-loaded static ESM module (pure WASM,
// no init needed), and is `external` in the esbuild bundle — its node entry
// reads the .wasm from disk relative to __dirname at runtime.

import { cut_for_search } from 'jieba-wasm';

/** Common Chinese/English stopwords — noise as entities/tokens. Mirrors
 * `src-tauri/src/kb/mod.rs::STOPWORDS`. */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '也', '都', '而', '但', '并', '且', '等',
  '一', '不', '这', '那', '之', '其', '被', '把', '对', '从', '向', '为', '以', '于',
  '我们', '你们', '他们', '它们', '这个', '那个', '这些', '那些', '可以', '能够', '因为',
  '所以', '但是', '如果', '没有', '不是', '就是', '什么', '怎么', '一个', '进行', '通过',
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'is', 'are', 'was', 'were', 'for', 'with',
  'on', 'at', 'by', 'from', 'as', 'it', 'this', 'that', 'these', 'those', 'we', 'you',
  'they', 'he', 'she', 'i', 'be', 'not', 'or', 'but', 'if', 'so', 'can', 'will',
]);

/** Split a text chunk into jieba tokens, filtering stopwords, single-char
 * tokens, and pure punctuation/whitespace. Mirrors Rust `tokenize()`. */
export function tokenizeText(text: string): string[] {
  const tokens = cut_for_search(text);
  const out: string[] = [];
  for (const raw of tokens) {
    const s = raw.trim().toLowerCase();
    // Require >= 2 chars (a single Chinese char is one code point; a single
    // ASCII char is noise too).
    if (s.length < 2) continue;
    // Skip pure punctuation / whitespace.
    if ([...s].every((c) => /[\p{P}\p{Z}\s]/u.test(c))) continue;
    if (STOPWORDS.has(s)) continue;
    out.push(s);
  }
  return out;
}

/** Build the FTS5 indexable string for a chunk (space-joined tokens). */
export function tokenizeForIndex(text: string): string {
  return tokenizeText(text).join(' ');
}
