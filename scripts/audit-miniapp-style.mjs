/**
 * audit-miniapp-style — turn the MiniApp design playbook from advice into a gate.
 *
 * The playbook (bundled-skills/miniapp-creator/references/design-playbook.md) has
 * always said "every colour must come from a --hamuna-* token". Nothing checked it.
 * The consequence is measurable in real generated output: an app shipped on this
 * machine used `var(--hamuna-accent-text, …)` — a variable that does not exist in
 * the 43-var contract — and, like every wrong token name, it failed *silently*.
 * Same file also had zero `color-mix` derivations, zero motion tokens, and a
 * `filter: brightness()` hover that the playbook's own state-token table names
 * as the anti-pattern it forbids.
 *
 * This script is the enforcement v2 has and this repo doesn't. It fails on:
 *
 *   1. an appearance variable that isn't in the contract
 *   2. an author redefining a host-owned variable
 *   3. a raw colour in value position that nobody owns
 *   4. a bespoke palette entry that never reaches the CSS (stale carve-outs rot)
 *   5. a MiniApp root nobody registered
 *
 * What it deliberately does NOT do — v2 forbids `var(--hamuna-bg, #fff)`, and
 * this repo does not. Fallbacks are required here on purpose: a MiniApp exported
 * as a standalone page has no host, and without a fallback every rule silently
 * collapses to the browser default. Rule 3 therefore *masks* fallbacks before
 * looking for raw colours instead of banning them.
 *
 * The one sanctioned way to ship a real palette is `meta.json::appearance` with
 * `mode: 'bespoke'`. That is not an exemption — it is a declaration: the colours
 * must be listed in meta.json, so they show up in review, and rule 4 makes a
 * declared-but-unused colour an error rather than dead weight.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Where MiniApps live, and whether new roots have to be added here. */
const MINIAPP_ROOTS = [
  'bundled-miniapps',
  'bundled-skills/miniapp-creator/source/miniapp-template',
  'bundled-skills/miniapp-creator/references/examples',
];

/**
 * Copy-paste modules the agent pastes into a MiniApp. Scanned like an app even
 * though they have no `meta.json` — a snippet that teaches a hardcoded hex is
 * worse than no snippet, because it is copied verbatim into every app that uses it.
 */
const SNIPPET_ROOTS = ['bundled-skills/miniapp-creator/references/tweaks'];

const SCANNED_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);

/** Fails the run. Prefix matches the other verify:* scripts in this folder. */
const problems = [];
const fail = (file, line, message) => problems.push(`${file}:${line}  ${message}`);

/** Contract variable names, e.g. `--hamuna-bg-primary`. */
const CONTRACT = new Set(
  JSON.parse(readFileSync(join(ROOT, 'src/shared/miniapp-appearance/contract.json'), 'utf8'))
    .variables.map((v) => v.name),
);

const HOST_VAR_RE = /--(hamuna)-([a-z0-9-]+)/g;
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(([^()]*)\)/g;
const DECL_RE = /(--hamuna-[a-z0-9-]+)\s*:/g;

/**
 * The playbook's other hard constraints, in the same shape as the rules above.
 *
 * These were all written down as forbidden long before anything checked them,
 * and the repo's own style files quote them in their header comments — which is
 * why they are enforced against comment-stripped source. Prose that names a
 * banned pattern is not a violation of it.
 */
const BANNED_PATTERNS = [
  {
    re: /transition\s*:\s*all\b/g,
    rule: 'no-transition-all',
    why:
      '`transition: all` also transitions width/height/top, which forces a reflow ' +
      'the author never asked for. List the properties explicitly.',
  },
  {
    re: /scale\(\s*0(?![.\d])\s*[),]/g,
    rule: 'no-scale-zero',
    why:
      '`scale(0)` collapses the element to nothing and drops its border, so the ' +
      'animation starts from an invisible frame. Start at .96 / .94.',
  },
  {
    // A brightness filter dims every descendant at once and ignores the theme.
    // `--hamuna-accent-hover` exists precisely to cover this.
    re: /filter\s*:\s*brightness\(/g,
    rule: 'no-brightness-filter',
    why:
      '`filter: brightness()` darkens the whole subtree and does not follow the ' +
      'theme. Use the state token (--hamuna-accent-hover and friends).',
  },
  {
    re: /box-shadow\s*:[^;{}]*\brgba?\(/g,
    rule: 'no-hardcoded-shadow',
    why:
      'A hardcoded shadow does not change with the theme and each MiniApp invents ' +
      'its own depth, which is what makes elevation read as cheap. Use the ' +
      '--hamuna-shadow-* scale, or color-mix for a tinted one.',
  },
];

/** `@keyframes` names must be namespaced — two MiniApps can share a document. */
const KEYFRAMES_RE = /@keyframes\s+([A-Za-z_-][\w-]*)/g;

/**
 * Blank out `mask-image` declaration values.
 *
 * A mask gradient's colour channels are discarded — only alpha is read, and the
 * convention is `#000` for the opaque stop and `transparent` for the faded one.
 * So a literal in that position is not a palette decision and never was; it is
 * part of the mask's *syntax*. Flagging it pushes authors toward a token that
 * renders the wrong mask, which is worse than the violation it prevents.
 *
 * Scoped to mask declarations only. A literal anywhere else is still a violation.
 */
function maskMaskImages(css) {
  const out = [...css];
  const re = /(-webkit-)?mask-image\s*:/g;
  for (const m of css.matchAll(re)) {
    // Blank to the end of the declaration (next ';' or '}' at depth 0).
    for (let k = m.index + m[0].length; k < css.length; k++) {
      if (css[k] === ';' || css[k] === '}') break;
      // Keep newlines so reported line numbers stay true.
      if (css[k] !== '\n') out[k] = ' ';
    }
  }
  return out.join('');
}

/**
 * Blank out comment bodies (keeping every byte position, so reported line
 * numbers stay true) — otherwise prose that merely *mentions* a token counts as
 * using it. The header comment in the bundled apps says
 * "全部从宿主 --hamuna-duration-* 派生", and a name-matching regex reads that
 * wildcard as the variable `--hamuna-duration-`, which is not a contract member.
 */
function maskComments(text) {
  const out = [...text];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop - 1;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop - 1;
    }
  }
  return out.join('');
}

/**
 * Blank out the fallback argument of every `var(--hamuna-*, …)` so rule 3 doesn't
 * read a sanctioned fallback as an unowned colour.
 *
 * Hand-rolled rather than a regex because the fallback is usually a colour
 * function, which is itself full of parentheses: `var(--hamuna-bg, rgba(0,0,0,.5))`.
 * `[^)]*` stops at the colour function's own `)` and leaves the tail looking
 * like a stray unowned colour — the audit would then fire on the project's own
 * blessed pattern. So walk the parens by depth.
 *
 * Only the *fallback* is masked; the variable name stays so rule 1 still sees it.
 */
function maskVarFallbacks(css) {
  const masked = [...css];
  const OPEN = 'var('.length; // 4
  let i = 0;

  while (i < css.length - OPEN) {
    if (!css.startsWith('var(', i)) {
      i++;
      continue;
    }
    // Walk to the matching ')' of this var(). Starting at the '(' itself means
    // depth goes 1 → 0 at the close, which is the pair we want.
    let depth = 0;
    let j = i + 3;
    for (; j < css.length; j++) {
      const c = css[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= css.length) break; // unterminated — leave it for other rules

    // Find the top-level comma separating name from fallback. This scan must
    // start *after* var()'s own paren with depth 0 — starting at the paren
    // leaves depth at 1, and then `depth === 0` never holds, so the comma is
    // never found and nothing gets masked.
    depth = 0;
    let comma = -1;
    for (let k = i + OPEN; k < j; k++) {
      const c = css[k];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        comma = k;
        break;
      }
    }

    if (comma !== -1) {
      const firstArg = css.slice(i + OPEN, comma).trim();
      // Only host-token fallbacks are sanctioned colours. A fallback on an
      // author's own alias may legitimately be anything, and rule 3's owning
      // mechanism is what has to cover that.
      if (firstArg.startsWith('--hamuna-')) {
        for (let k = comma; k <= j; k++) masked[k] = ' ';
      }
    }
    i = j + 1;
  }

  return masked.join('');
}

/** 1-based line number of a character offset. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Colours a bespoke app is allowed to write literally: exactly the ones its
 * meta.json declares. Anything else is still a violation.
 */
function bespokePalette(appDir) {
  const metaPath = join(appDir, 'meta.json');
  if (!existsSync(metaPath)) return { owned: new Set(), bespoke: false };
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return { owned: new Set(), bespoke: false };
  }
  const appearance = meta?.appearance;
  if (!appearance || appearance.mode !== 'bespoke') return { owned: new Set(), bespoke: false };

  const declared = [...Object.values(appearance.palette ?? {}), ...Object.values(appearance.palette_dark ?? {})];
  return { owned: new Set(declared.map((c) => String(c).trim().toLowerCase())), bespoke: true };
}

function scanFile(file, ownedColors, usedColors, isCssSource) {
  const raw = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  // Comments first (prose about a token isn't using it), then fallbacks. Both
  // masks preserve byte offsets, so `lineAt` on the masked text still reports
  // the real line in the real file.
  const text = maskMaskImages(maskComments(raw));

  // Rule 1 + 2.
  for (const m of text.matchAll(HOST_VAR_RE)) {
    const full = `--${m[1]}-${m[2]}`;
    if (!CONTRACT.has(full)) {
      fail(rel, lineAt(text, m.index), `uses unregistered MiniApp appearance variable ${full}.`);
    }
  }
  for (const m of text.matchAll(DECL_RE)) {
    fail(
      rel,
      lineAt(text, m.index),
      `redefines host-owned MiniApp variable ${m[1]}. The host injects it; ` +
        'declaring "host mode" locally is what makes a theme switch look broken.',
    );
  }

  // Rule 3. Scan the fallback-masked copy so sanctioned fallbacks don't count.
  const scannable = maskVarFallbacks(text);
  for (const m of scannable.matchAll(COLOR_RE)) {
    const value = m[0].trim().toLowerCase();
    if (ownedColors.has(value)) {
      usedColors.add(value);
      continue;
    }
    fail(
      rel,
      lineAt(scannable, m.index),
      `unowned colour ${m[0]}. Use a --hamuna-* token, derive with color-mix, ` +
        'or (for a palette that IS the product) declare it in meta.json::appearance.',
    );
  }

  // Rule 4's bookkeeping reads the *unmasked* text on purpose. A bespoke app's
  // colours normally live inside `var(--hamuna-accent, #8a3d58)` — that fallback
  // is the whole reason the standalone export still looks right. Masking it away
  // before recording usage would report every declared colour as unused.
  for (const m of text.matchAll(COLOR_RE)) {
    const value = m[0].trim().toLowerCase();
    if (ownedColors.has(value)) usedColors.add(value);
  }

  // Playbook hard constraints.
  //
  // Only the CSS-*grammar* rules run against CSS sources. `transition: all` and
  // friends are declarations; in a .js file the same text is far more often a
  // string the author is showing the user — design-reference ships a to-do
  // labelled "确认没有任何 transition: all", which is prose about the rule, not
  // a breach of it. Token, colour, keyframe and reduced-motion rules are
  // language-agnostic and run everywhere.
  //
  // `ponytail:` this means a MiniApp that inlines a stylesheet as a JS template
  // literal escapes the CSS-grammar checks. Move those checks into a real CSS
  // parser if that ever becomes a pattern; today every MiniApp keeps its styles
  // in style.css, which the file-type gate covers.
  if (isCssSource) {
    for (const { re, rule, why } of BANNED_PATTERNS) {
      for (const m of text.matchAll(re)) {
        fail(rel, lineAt(text, m.index), `[${rule}] ${m[0].trim()} — ${why}`);
      }
    }
  }

  // @keyframes must be namespaced: several MiniApps can share one document.
  for (const m of text.matchAll(KEYFRAMES_RE)) {
    const name = m[1];
    if (!/^[a-z][a-z0-9]*-/.test(name)) {
      fail(
        rel,
        lineAt(text, m.index),
        `[unscoped-keyframes] @keyframes ${name} has no app prefix. Two MiniApps ` +
          'open in the same document will collide on a global name.',
      );
    }
  }

  // Motion that cannot be switched off is an accessibility defect, not a
  // preference — so the file must carry the global opt-out block if it animates.
  const animates = /@keyframes\b/.test(text) || /\banimation(-name)?\s*:/.test(text);
  if (animates && !/prefers-reduced-motion/.test(text)) {
    fail(
      rel,
      1,
      '[no-reduced-motion] this stylesheet animates but has no ' +
        '`@media (prefers-reduced-motion: reduce)` block. Vestibular disorders ' +
        'cause actual nausea from looping motion; the block is mandatory.',
    );
  }

  // Rule 4 runs per-app, not per-file — see the caller.
}

/**
 * Rule 4: a colour declared in `appearance` that no file in the app ever writes.
 *
 * Scoped to the whole app on purpose. Checking per-file would flag every colour
 * the CSS actually uses every time `ui.js` is scanned, because `ui.js` never
 * repeats the palette — that's the point of the declaration.
 */
function reportStalePalette(appDir, ownedColors, usedColors) {
  const rel = relative(ROOT, join(appDir, 'meta.json')).replace(/\\/g, '/');
  for (const color of ownedColors) {
    if (!usedColors.has(color)) {
      fail(
        rel,
        1,
        `appearance palette declares ${color} but no file in this MiniApp writes it. ` +
          'A carve-out nobody exercises is one nobody reviews.',
      );
    }
  }
}

/** Every MiniApp directory under the registered roots. */
function discoverApps() {
  const apps = [];
  const seenRoots = new Set();
  for (const root of MINIAPP_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    seenRoots.add(root);
    // A root that IS an app (the template) vs a root that CONTAINS apps.
    if (existsSync(join(abs, 'meta.json'))) {
      apps.push(abs);
      continue;
    }
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isDirectory() && existsSync(join(child, 'meta.json'))) apps.push(child);
    }
  }
  if (seenRoots.size !== MINIAPP_ROOTS.length) {
    fail('scripts/audit-miniapp-style.mjs', 1, 'a registered MiniApp root does not exist');
  }
  return apps;
}

const apps = discoverApps();
if (apps.length === 0) {
  throw new Error('[miniapp-style] no MiniApps discovered — the root list is stale');
}

let fileCount = 0;
for (const appDir of apps) {
  const { owned } = bespokePalette(appDir);
  const usedColors = new Set();
  const sourceDir = join(appDir, 'source');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) continue;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SCANNED_EXTENSIONS.has(ext)) continue;
    scanFile(join(sourceDir, entry.name), owned, usedColors, ext === '.css');
    fileCount++;
  }
  reportStalePalette(appDir, owned, usedColors);
}

// Snippets have no meta.json and no bespoke palette — every colour in them has to
// come from a token or a derivation.
for (const root of SNIPPET_ROOTS) {
  const dir = join(ROOT, root);
  if (!existsSync(dir)) {
    fail(root, 1, 'a registered snippet root does not exist');
    continue;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SCANNED_EXTENSIONS.has(ext)) continue;
    scanFile(join(dir, entry.name), new Set(), new Set(), ext === '.css');
    fileCount++;
  }
}

if (problems.length > 0) {
  throw new Error(
    `[miniapp-style] ${problems.length} violation(s) across ${apps.length} MiniApps ` +
      `(${fileCount} files). The design playbook is enforced here, not by good intentions:\n  ` +
      `${problems.join('\n  ')}\n` +
      '  Fix: use --hamuna-* tokens, derive intermediates with color-mix, or declare a\n' +
      '  real palette in meta.json::appearance (mode: "bespoke").',
  );
}

console.log(`[miniapp-style] ok — ${apps.length} MiniApps, ${fileCount} files`);