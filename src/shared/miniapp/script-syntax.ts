// Parse-only syntax gate for a MiniApp's behaviour layer.
//
// ## What this guards
//
// A MiniApp's `ui.js` is inlined into the iframe's HTML by
// `inline_miniapp_siblings` (Rust) and then executed. If it does not *parse*,
// the browser discards the entire script: no listener is ever bound, no render
// ever runs, and the page keeps whatever static markup the HTML happened to
// carry. The result is not an error state — it is a plausible-looking page that
// does nothing.
//
// ## Why it matters more than it looks
//
// This is not hypothetical. Generating a MiniApp from the skill's own playbook
// through a real provider produced a 6.5k-token app whose only defect was
//
//     div.innerHTML = '
//       <label class="todo-checkbox">
//
// A single-quoted string literal spanning real newlines. `node --check` calls it
// `SyntaxError: Invalid or unexpected token`; the browser calls it a silently
// dead app. Its header, three stat tiles and add-form all rendered, because
// those come from the static HTML — so a screenshot review saw "a competent but
// plain todo app" instead of "an app that never boots". Nothing in the stack
// reported it: `meta.json` parsed, the entry resolved, the iframe mounted, and
// the host installs no global error handler.
//
// The shape of the bug is the point. Models emit well-structured, well-commented
// code and then make one token-level mistake in it. Reviewing the *result* by
// eye cannot see that, because the part that broke is the part that never runs.
//
// ## Why a parse gate and not a lint rule
//
// ESLint would need the same parser and would report style opinions this project
// does not want enforced on generated code. All we need to know is the narrower
// question "would the browser execute this at all", and that is exactly one
// `acorn.parse` call. See `ast-policy.ts` for why acorn is the parser already
// used on MiniApp source.
//
// This is a *parse* check, not a *safety* check. It says nothing about what the
// script does once running; `ast-policy.ts` owns that, fail-closed.

import { parse } from 'acorn';

/** Names the host actually inlines. `main.js` is the legacy entry. */
export const MINIAPP_SCRIPT_NAMES = ['ui.js', 'main.js'] as const;

export interface ScriptSyntaxError {
  /** File the error came from, as the caller labelled it. */
  file: string;
  /** 1-based line, or null when acorn could not attribute the failure. */
  line: number | null;
  /** 1-based column, or null when acorn could not attribute the failure. */
  column: number | null;
  /** acorn's message, e.g. `Invalid or unexpected token`. */
  message: string;
  /** The offending source line, trimmed, so a retry prompt can quote it. */
  excerpt: string;
}

/**
 * Parse one behaviour layer. Returns null when the script is syntactically
 * valid, otherwise the first syntax error found.
 *
 * Deliberately *not* a throw: the caller is usually an agent that needs to read
 * the failure back into a retry prompt, and a returned value cannot be dropped
 * on the floor the way an uncaught throw can.
 */
export function findScriptSyntaxError(
  source: string,
  file: string,
): ScriptSyntaxError | null {
  try {
    parse(source, {
      ecmaVersion: 'latest',
      // MiniApp behaviour layers are classic scripts (IIFE-wrapped), not modules.
      sourceType: 'script',
      allowReturnOutsideFunction: true,
    });
    return null;
  } catch (error) {
    const err = error as { message?: string; loc?: { line: number; column: number } };
    const line = err.loc?.line ?? null;
    const column = err.loc?.column != null ? err.loc.column + 1 : null;
    const excerpt = line == null ? '' : (source.split(/\r?\n/)[line - 1] ?? '').trim();
    return {
      file,
      line,
      column,
      message: err.message ?? 'unknown parse error',
      excerpt,
    };
  }
}

/**
 * Render a syntax error the way an agent should see it when asked to retry:
 * position first, then the exact text that broke, then the reason. Vague
 * "invalid code" feedback is what produced the original bad file.
 */
export function formatScriptSyntaxError(error: ScriptSyntaxError): string {
  const where = error.line == null
    ? error.file
    : `${error.file}:${error.line}${error.column == null ? '' : `:${error.column}`}`;
  return [
    `${where}: ${error.message}`,
    error.excerpt ? `  ${error.excerpt}` : '',
    'The script never executed — the browser discards the whole file on a parse',
    'error, so the page you are looking at is static markup only.',
  ].filter(Boolean).join('\n');
}