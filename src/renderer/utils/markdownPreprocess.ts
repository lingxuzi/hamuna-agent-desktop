/**
 * Preprocess markdown content for better streaming compatibility.
 *
 * Markdown Priority (highest to lowest):
 * 1. Code blocks (``` ```) - content is literal, no parsing
 * 2. Inline code (` `) - content is literal, no parsing
 * 3. Everything else (headers, lists, emphasis, etc.)
 *
 * This function respects the priority by:
 * 1. Extracting and protecting code blocks and inline code
 * 2. Applying format fixes to the remaining content
 * 3. Restoring the protected code
 */
export function preprocessMarkdownContent(content: string): string {
  if (!content) return '';

  // Step 1: Extract and protect code blocks and inline code
  const protected_: string[] = [];
  let processed = content;

  // Protect fenced code blocks (``` ... ```)
  processed = processed.replace(/```[\s\S]*?```/g, (match) => {
    protected_.push(match);
    return `\x00CODE${protected_.length - 1}\x00`;
  });

  // Protect inline code (` ... `) - handle both single and multiple backticks
  processed = processed.replace(/`[^`]+`/g, (match) => {
    protected_.push(match);
    return `\x00CODE${protected_.length - 1}\x00`;
  });

  // Protect GFM table blocks (2+ consecutive lines starting with |)
  // Without this, regexes below (e.g. heading fix) corrupt table cells containing #
  processed = processed.replace(/(?:^[ \t]*\|[^\n]*(?:\n|$)){2,}/gm, (match) => {
    protected_.push(match);
    return `\x00CODE${protected_.length - 1}\x00`;
  });

  // Step 2: Apply format fixes to unprotected content

  // 2a-pre. Normalize full-width punctuation that Chinese-tuned models
  // (DeepSeek, MiniMax, Qwen, GLM, …) emit in place of ASCII markdown markers.
  // CommonMark only recognizes ASCII `*`, `_`, `~`, `#` etc. — when a model
  // outputs `＊＊P1＊＊` (U+FF0A) instead of `**P1**`, the bold renders as
  // literal full-width asterisks (issue #167). We only convert *paired*
  // patterns so an isolated full-width char in legitimate Chinese text
  // (e.g., a name with `＊` for redaction) stays untouched.
  // - `＊＊...＊＊` → `**...**` (bold)
  // - `＊...＊` → `*...*` (italic — applied after bold so triple-stars work)
  // - `＿＿...＿＿` → `__...__` (alt bold)
  // - `～～...～～` → `~~...~~` (GFM strikethrough)
  processed = processed.replace(/＊＊([^＊\n]+?)＊＊/g, '**$1**');
  processed = processed.replace(/＊([^＊\n]+?)＊/g, '*$1*');
  processed = processed.replace(/＿＿([^＿\n]+?)＿＿/g, '__$1__');
  processed = processed.replace(/～～([^～\n]+?)～～/g, '~~$1~~');

  // 2a. Escape currency dollar signs ($100, $3,000, $1.50 etc.)
  // remark-math treats $...$ as inline LaTeX, causing false positives like
  // "$3000 亿...$1880 亿" being rendered as a math expression.
  // Pattern: $ followed by digit, not preceded by another $ (preserves $$...$$)
  processed = processed.replace(/(?<!\$)\$(?=\d)/g, '\\$');

  // 2b. Ensure headers have a blank line before them when the marker is not
  // attached to a word token. This prevents language names like "C# WPF" and
  // "F# tutorial" from being rewritten into headings.
  processed = processed.replace(/([^\n#\p{L}\p{N}])(#{1,6}\s+)(?=\S)/gu, '$1\n\n$2');

  // 2c removed: We used to auto-insert a space after a leading `#` to fix
  // AI-emitted `##Title` (missing space). But that rule can't distinguish a
  // heading from a tag — `#210`, `#heihei`, `#标题` are all common as plain
  // tags / issue refs, and rewriting them into `# 210` / `# heihei` / `# 标题`
  // turned the whole line into an `<h1>` (CommonMark requires the space). Per
  // spec, `#text` (no space) is NOT a heading; trust the spec rather than
  // guess the model's intent.

  // 2d. Fix unordered list items at LINE START ONLY
  // "-item" -> "- item". Exclude digits so negative-leading values like
  // "-50% drop" at line start don't get rewritten into a list item.
  processed = processed.replace(/^-([^\s\-\n\d])/gm, '- $1');

  // 2e. Fix ordered list items at LINE START ONLY
  // "1.item" -> "1. item". Exclude digits so version numbers / dates /
  // IPs like "0.2.18", "2026.5.18", "192.168.1.1" at line start don't get
  // rewritten into an ordered list (which then swallows the rest of the line).
  processed = processed.replace(/^(\d+\.)([^\s\n\d])/gm, '$1 $2');

  // 2f. Render BARE absolute local media paths and bare http(s) media URLs
  // inline. AI tools (multimedia-creator, etc.) frequently emit the output
  // path as PLAIN TEXT — e.g. "本地：/home/…/out.png" / "远程：https://…/a.png"
  // — rather than markdown image syntax. Nothing renders; the message just
  // shows a path string. Convert to `![path](path)` so the existing media
  // pipeline (MarkdownLocalMedia / URL img) displays it.
  //
  // Matching rules (conservative):
  // - ONLY absolute local paths (`/…`, drive `C:\…`/`C:/…`, `~/…`) and
  //   http(s) URLs with an image/video extension — relative paths are too
  //   ambiguous in prose to auto-render.
  // - Negative lookbehinds: `(?<![\w:~\/])` — not preceded by a word char (so
  //   "path/a.png" mid-word stays text), ASCII `:` or `/` (so the `//` after
  //   `https:` inside an already-linked URL can't leak a partial re-match
  //   starting at the second slash), or `~` (so the `/` right after `~/` in an
  //   existing `](~/…)` destination can't leak either — the match must start
  //   AT the `~`/scheme/drive, not inside it. `(?<!\]\()` — not preceded by
  //   `](` (the markdown link/image destination boundary), so
  //   `[x](/abs/a.png)` is not double-wrapped — MarkdownLink already renders
  //   that. Plain prose parens like `见 (https://…/a.png)` ARE converted (the
  //   `(` alone is allowed).
  // - Trailing boundary: end-of-string or whitespace / CJK / ASCII
  //   punctuation, so "…/a.png。后面" and "…/a.png) 结束" don't swallow the
  //   next sentence.
  // Alt text is the full token — if the read later fails, the fallback link
  // still shows the complete path instead of a bare basename.
  processed = processed.replace(
    /(?<![\w:~/])(?<!\]\()((?:https?:\/\/|~\/|\/|[A-Za-z]:[\\/])[^\s<>()（），。；、]*?\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogg|ogv|mov|m4v)(?:[?#][^\s<>()（），。；、]*)?)(?=$|[\s，。；、)）])/g,
    (_match, token) => `![${token}](${token})`,
  );

  // 2g. Protect Windows drive-letter paths inside link/image destinations.
  // micromark treats `C:` as a malformed URI scheme and drops the WHOLE
  // destination → `[x](C:\Users\a\b.png)` parses to `href=""` (verified).
  // Percent-encoding the colon keeps the destination intact; MarkdownLocalMedia
  // decodes it back before reading the file. Backslashes are kept as-is
  // (micromark percent-encodes them to %5C, which decodes back identically).
  // Only match inside `](`/`![](` so plain-text "C: 盘" is untouched. Runs
  // AFTER 2f because 2f's generated `![..](C:\..)` destinations need encoding.
  processed = processed.replace(/(\]\()([A-Za-z]):(?=[\\/])/g, '$1$2%3A');

  // Step 3: Restore protected code blocks and inline code
  // Multiple passes needed: table blocks may contain inline code placeholders,
  // so restoring the table in one pass leaves inner placeholders unresolved.
  // eslint-disable-next-line no-control-regex -- Intentional use of NUL as placeholder
  while (/\x00CODE\d+\x00/.test(processed)) {
    // eslint-disable-next-line no-control-regex
    processed = processed.replace(/\x00CODE(\d+)\x00/g, (_, index) => {
      return protected_[parseInt(index, 10)];
    });
  }

  return processed;
}
