// Static method-contract gate for a MiniApp's behaviour layer.
//
// ## What this guards
//
// `app.*` is the only host surface a MiniApp has, and it is a *runtime* facade:
// `app.fs.readFile` is a plain property holding a function. A model that writes
// `app.fs.readFileSync(...)` or `app.http.get(...)` produces code that parses,
// renders, and passes every colour and token probe — and then dies the moment a
// button is pressed, with `TypeError: app.fs.readFileSync is not a function`.
// The static markup is already on screen, so a screenshot review reads it as
// "plain" rather than "broken".
//
// ## Why this exists when a permission check already exists
//
// `bundled-apps-permissions.test.ts` enumerates calls by longest-matching the
// names in `listAppMethods()`. That is correct for what it guards — a declared
// method used without permission — but it is blind to a method that is *not in
// the list at all*: a hallucinated name matches nothing, is never probed, and
// passes. Both checks are needed, and they fail in opposite directions.
//
// ## Why a static check and not only a runtime one
//
// The runtime channel already answers UNKNOWN_METHOD (the real host does), and
// `shoot-miniapp.mjs` now exercises it in a browser. Static wins anyway because
// it is free, needs no browser, and reports the *line* — which is what lets a
// model fix the call instead of rewriting the file. It also covers calls that
// sit behind a branch the browser smoke test never enters.
//
// This is a *shape* check, not a safety or a permission check. It says nothing
// about whether the argument satisfies `permissions.*` (that is
// `app-permissions.ts`, driven by the bundled-app test) and nothing about what
// the call does once it lands.

import { parse } from 'acorn';

import { APP_METHODS } from './app-protocol';

/**
 * Keys on the injected `window.app` facade that are *not* dispatch methods:
 * values, getters, and event subscriptions. These are read or called, but never
 * produce an `{kind:'app.call'}` envelope, so they cannot be checked against
 * `APP_METHODS`.
 *
 * Kept here rather than derived from the runtime script because this module
 * lives in `shared/` and importing the renderer facade from here would drag
 * React/DOM into the sidecar bundle — `app-parity.unit.test.ts` explains that
 * direction of dependency. `app-parity.unit.test.ts` and
 * `miniapp-docs-parity.unit.test.ts` both assert this set against the real
 * runtime, so a rename there turns into a test failure rather than drift.
 */
export const APP_FACADE_VALUE_KEYS: ReadonlySet<string> = new Set([
  'appId',
  'mode',
  'appearanceMode',
  'locale',
  'platform',
  'workspaceDir',
  'appDataDir',
]);

/**
 * Facade keys that are functions rather than values. `app.t(table, fallback)`
 * is the locale picker; the `on*` family subscribes and each returns an
 * unsubscribe closure. Everything in `APP_FACADE_VALUE_KEYS` is a string, so
 * calling it is always a mistake — `app.locale('zh-CN')` reads like "set the
 * locale" and throws at click time.
 */
const APP_FACADE_CALLABLE_KEYS: ReadonlySet<string> = new Set([
  't',
  'on',
  'onAppearanceChange',
  'onLocaleChange',
  'onActivate',
  'onDeactivate',
]);

const DISPATCH_GROUPS = new Set(Object.keys(APP_METHODS));

/** `app.call(method, params)` — the one legal single-segment call. */
const APP_CALL = 'call';

export interface AppMethodError {
  /** File the error came from, as the caller labelled it. */
  file: string;
  /** 1-based line, or null when acorn could not attribute the failure. */
  line: number | null;
  /** 1-based column, or null when acorn could not attribute the failure. */
  column: number | null;
  /** What was written, e.g. `app.fs.readFileSync`. */
  expression: string;
  /** What went wrong, phrased so the fix is obvious from the sentence. */
  message: string;
  /** The offending source line, trimmed, so a retry prompt can quote it. */
  excerpt: string;
}

interface Locatable {
  line: number | null;
  column: number | null;
}

function positionOf(node: unknown, source: string): Locatable {
  const loc = (node as { loc?: { start?: { line: number; column: number } } } | null)?.loc;
  const line = loc?.start?.line ?? null;
  const column = loc?.start?.column != null ? loc.start.column + 1 : null;
  return { line, column };
}

function excerptAt(source: string, line: number | null): string {
  if (line == null) return '';
  return (source.split(/\r?\n/)[line - 1] ?? '').trim();
}

/**
 * Property name of a member expression, or null for a dynamic key we cannot
 * resolve (`app[userInput]`). Null means "check what we can, stay quiet" — a
 * computed key is legitimate code, just not statically checkable.
 */
function propertyName(node: unknown): string | null {
  const me = node as { type?: string; computed?: boolean; property?: unknown };
  if (!me || me.type !== 'MemberExpression') return null;
  const prop = me.property as { type?: string; name?: string; value?: unknown };
  if (!me.computed) return prop?.type === 'Identifier' ? prop.name ?? null : null;
  if (prop?.type === 'Literal' && typeof prop.value === 'string') return prop.value;
  return null;
}

/**
 * Walk the AST looking for `CallExpression`s whose callee is rooted at an
 * identifier named `app`, and classify the callee's shape.
 *
 * A hand-rolled visitor because `acorn-walk` is not a dependency here (see
 * `script-syntax.ts`, which deliberately keeps the surface to one `parse`
 * call). The generic branch recurses into any child object carrying a `type`,
 * which is exactly acorn's node shape, so new node kinds are traversed without
 * a case.
 */
function walk(node: unknown, visit: (n: unknown) => void): void {
  if (!node || typeof node !== 'object') return;
  const rec = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    visit(n);
    for (const key of Object.keys(n as Record<string, unknown>)) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
      const child = (n as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(rec);
      else if (child && typeof child === 'object') rec(child);
    }
  };
  rec(node);
}

/** `app` / `app.fs` / `app.fs.writeFile` → the chain, or null if not rooted at `app`. */
function appChain(node: unknown): string[] | null {
  const parts: string[] = [];
  let cur = node as { type?: string; name?: string; object?: unknown } | null;
  while (cur && cur.type === 'MemberExpression') {
    const name = propertyName(cur);
    if (name === null) return null;
    parts.unshift(name);
    cur = cur.object as typeof cur;
  }
  if (!cur || cur.type !== 'Identifier') return null;
  if (parts.length === 0) return null; // bare `app()`, not a capability call
  const root = cur.name;
  if (typeof root !== 'string' || root !== 'app') return null;
  parts.unshift(root);
  return parts;
}

/**
 * Classify one `app.*` call. Returns null when the call is legal or not
 * statically resolvable.
 */
function classify(chain: string[]): { expression: string; message: string } | null {
  const expression = chain.join('.');
  const [, ...rest] = chain;

  // app.call('fs.readFile', ...) — the single legal single-segment call.
  if (rest.length === 0) return null;

  if (rest.length === 1) {
    const name = rest[0]!;
    // A bare call on a value key: app.t(...) is legal, app.locale(...) is not.
    if (name === APP_CALL || APP_FACADE_CALLABLE_KEYS.has(name)) return null;
    const kind = APP_FACADE_VALUE_KEYS.has(name) ? 'a value, not a function' : 'not a capability';
    return {
      expression,
      message:
        `\`app.${name}(...)\` is ${kind}. \`window.app\` exposes capability groups `
        + `(${[...DISPATCH_GROUPS].join(', ')}), value keys `
        + `(${[...APP_FACADE_VALUE_KEYS].join(', ')}), the callable \`app.t(table, fallback)\`, `
        + `and \`app.call(method, params)\` for custom backends.`,
    };
  }

  const [group, method] = rest as [string, string];
  const deeper = rest.length > 2;

  if (deeper) {
    return {
      expression,
      message:
        `\`${expression}\` is too deep — capabilities are exactly two segments `
        + `(\`app.<group>.<method>\`).`,
    };
  }

  if (!DISPATCH_GROUPS.has(group)) {
    return {
      expression,
      message:
        `\`app.${group}\` is not a capability group. The host implements `
        + `${[...DISPATCH_GROUPS].join(', ')}.`,
    };
  }

  const known = (APP_METHODS as Record<string, readonly string[]>)[group] ?? [];
  if (!known.includes(method)) {
    const suggestion = closest(method, known);
    return {
      expression,
      message:
        `\`app.${group}.${method}\` does not exist. \`app.${group}\` implements `
        + `${known.join(', ')}.${suggestion}`,
    };
  }
  return null;
}

/** Closest real method name, so the error says what to write instead. */
function closest(input: string, candidates: readonly string[]): string {
  let best = '';
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = levenshtein(input, c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // Beyond this distance "did you mean" is noise.
  return bestScore <= Math.max(2, Math.ceil(input.length / 3)) ? ` Did you mean \`${best}\`?` : '';
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/**
 * Find every `app.*` call in a behaviour layer that the host cannot serve.
 *
 * Returns an empty array when the script has no statically resolvable mistake,
 * which is the normal case. A parse failure is *not* reported here — that is
 * `findScriptSyntaxError`'s job, and this function is only ever called on
 * source that already parsed.
 */
export function findAppMethodErrors(source: string, file: string): AppMethodError[] {
  let ast: unknown;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      // MiniApp behaviour layers are classic scripts (IIFE-wrapped), not modules.
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      // Without this acorn attaches no positions on success, and every reported
      // line would be null — which is the one field that makes the error
      // actionable instead of "something in ui.js is wrong".
      locations: true,
    });
  } catch {
    // Unparseable source has no reliable call sites. The parse gate owns it.
    return [];
  }

  const errors: AppMethodError[] = [];
  walk(ast, (node) => {
    const call = node as { type?: string; callee?: unknown };
    if (call.type !== 'CallExpression') return;
    const chain = appChain(call.callee);
    if (!chain) return;
    const verdict = classify(chain);
    if (!verdict) return;
    const { line, column } = positionOf(call.callee, source);
    errors.push({
      file,
      line,
      column,
      expression: verdict.expression,
      message: verdict.message,
      excerpt: excerptAt(source, line),
    });
  });
  // Source order, so the report reads top-to-bottom like the file does.
  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
  return errors;
}

/**
 * Render a method error the way an agent should see it when asked to retry:
 * position first, then the exact text that broke, then what to write instead.
 * Vague "invalid API" feedback is what produces the bad file in the first place.
 */
export function formatAppMethodError(error: AppMethodError): string {
  const where = error.line == null
    ? error.file
    : `${error.file}:${error.line}${error.column == null ? '' : `:${error.column}`}`;
  return [
    `${where}: ${error.message}`,
    error.excerpt ? `  ${error.excerpt}` : '',
    'The host answers UNKNOWN_METHOD for anything outside its list, so this call',
    'fails at click time, not at load time — the page renders and then does nothing.',
    'Fix the call, or drop it. Do not rewrite the file around it.',
  ].filter(Boolean).join('\n');
}
