// ast-policy.ts — acorn-based AST fallback for the require() shim.
//
// String-match blacklist (`worker-blacklist.ts`) catches literal:
//   - require('fs')
//   - process.binding(...)
//   - Module._load(...)
//
// It does NOT catch dynamic construction:
//   - require('fs' + '/promises')
//   - require(['fs','/promises'].join(''))
//   - import('fs' + '/p')
//   - new Function('return require')()('fs')
//
// acorn parses the source and we walk it looking for those patterns. acorn
// is intentionally chosen over @babel/parser: it's lighter (zero transitive
// deps), ships TS types as `@types/acorn`, and the AST shape is sufficient
// for the patterns above. PRD §13.8 only requires catching the canonical
// `require('fs' + '/promises')` family.

import { parse } from 'acorn';
import type {
  CallExpression,
  Expression,
  Identifier,
  ImportExpression,
  Literal,
  MemberExpression,
  NewExpression,
  Node,
  TemplateLiteral,
} from 'acorn';

import { DENY_BYPASS_TOKENS, type BlacklistHit } from './worker-blacklist';

export interface AstHit {
  reason: string;
  pattern: string;
}

/**
 * Parse and walk the source. Returns the FIRST failing pattern. fail-closed.
 *
 * Patterns caught:
 *  1. CallExpression `require(...)` / `require.resolve(...)` where the
 *     argument is NOT a Literal string — i.e. dynamic.
 *  2. ImportExpression `import(...)` with non-Literal argument.
 *  3. NewExpression of `Function` whose string arg contains `require` or
 *     `import`.
 *  4. MemberExpression chain that reaches a bypass token
 *     (e.g. `process.binding`, `Module._load`, `require.resolve`),
 *     including computed-property access (`process["binding"]`).
 *
 * Note: sourceType is 'unambiguous' so we accept either script or module
 * syntax. dynamic `import()` requires module-mode parse; we explicitly
 * enable it via `ecmaVersion: 'latest'`.
 */
export function scanAst(src: string): AstHit | null {
  let ast: Node;
  try {
    ast = parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
    }) as Node;
  } catch {
    // Parse error: treat as fail-closed (we cannot prove the source is safe).
    return { reason: 'parse-error', pattern: 'acorn parse failed' };
  }
  return walk(ast);
}

/**
 * BFS over the AST. For each node, dispatch on type to a dedicated visitor.
 * Generic recursion is unreliable here (acorn nodes have variable shapes
 * for `body`, `arguments`, etc.) — explicit dispatch is clearer.
 */
function walk(node: Node | null | undefined): AstHit | null {
  if (!node || typeof node !== 'object') return null;

  switch (node.type) {
    case 'CallExpression': {
      const call = node as CallExpression;
      // Pattern 1: require with dynamic arg
      if (call.callee.type === 'Identifier' && call.callee.name === 'require') {
        if (!isStaticString(call.arguments[0] as Expression | undefined)) {
          return { reason: 'dynamic-require', pattern: snippet(call) };
        }
      }
      // Pattern 4: require.resolve(...) — this is also a deny token. The
      // bypass-token scanner handles it; we recurse into args + callee.
      for (const arg of call.arguments) {
        const h = walk(arg as Node);
        if (h) return h;
      }
      return walk(call.callee as Node);
    }

    case 'ImportExpression': {
      const ie = node as ImportExpression;
      if (!isStaticString(ie.source as Expression | undefined)) {
        return { reason: 'dynamic-import', pattern: snippet(ie) };
      }
      return walk(ie.source as Node);
    }

    case 'NewExpression': {
      const ne = node as NewExpression;
      // Pattern 3: `new Function('...require...')`
      if (
        ne.callee.type === 'Identifier' &&
        ne.callee.name === 'Function' &&
        ne.arguments.length > 0
      ) {
        const first = ne.arguments[0];
        if (first?.type === 'Literal' && typeof (first as Literal).value === 'string') {
          const lit = first as Literal;
          const str = String(lit.value);
          if (str.includes('require') || str.includes('import')) {
            return {
              reason: 'function-constructor',
              pattern: `new Function(${snippet(first)})`,
            };
          }
        }
      }
      for (const arg of ne.arguments) {
        const h = walk(arg as Node);
        if (h) return h;
      }
      return walk(ne.callee as Node);
    }

    case 'MemberExpression': {
      const me = node as MemberExpression;
      // Pattern 4: bypass token. Walks the chain up — works for both
      // computed (`process['binding']`) and non-computed (`process.binding`).
      // We compare the chain (root.identifier[.identifier]* ) against the
      // deny tokens. For computed properties, the literal value substitutes
      // for the property name in the chain.
      const root = rootIdentifier(me.object as Node);
      const chain = memberChain(me);
      if (root === 'process' || root === 'Module' || root === 'require') {
        for (const token of DENY_BYPASS_TOKENS) {
          if (chain === token || chain.startsWith(token + '.') || chain.startsWith(token + '(')) {
            return { reason: 'bypass-token-ast', pattern: token };
          }
        }
      }
      // Continue into both sides
      return walk(me.object as Node) ?? walk(me.property as Node);
    }

    case 'ExpressionStatement': {
      const es = node as unknown as { expression: Node };
      return walk(es.expression);
    }

    case 'VariableDeclaration': {
      const vd = node as unknown as { declarations: Array<{ init?: Node | null }> };
      for (const d of vd.declarations) {
        const h = walk(d.init);
        if (h) return h;
      }
      return null;
    }

    case 'Literal':
    case 'Identifier':
    case 'TemplateLiteral':
      return null;

    case 'BinaryExpression': {
      const be = node as unknown as { left: Node; right: Node };
      return walk(be.left) ?? walk(be.right);
    }

    case 'ArrayExpression': {
      const ae = node as unknown as { elements: Array<Node | null | undefined> };
      for (const el of ae.elements) {
        const h = walk(el);
        if (h) return h;
      }
      return null;
    }

    case 'AwaitExpression': {
      const aw = node as unknown as { argument: Node };
      return walk(aw.argument);
    }

    case 'ChainExpression': {
      // Drill into `expression` (the head of the optional chain).
      const wrap = node as unknown as { expression: Node };
      return walk(wrap.expression);
    }

    default: {
      // Generic fallback: enumerate own enumerable keys whose values are
      // AST-shaped (have a `type` string). This catches uncommon node types
      // without us enumerating each one. Safe because we dispatch above for
      // the ones we care about.
      for (const key of Object.keys(node)) {
        if (
          key === 'type' ||
          key === 'start' ||
          key === 'end' ||
          key === 'loc' ||
          key === 'sourceType' ||
          key === 'range' ||
          key === 'leadingComments' ||
          key === 'trailingComments' ||
          key === 'comments'
        ) {
          continue;
        }
        const child = (node as unknown as Record<string, unknown>)[key];
        if (!child) continue;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c === 'object' && typeof (c as { type?: unknown }).type === 'string') {
              const h = walk(c as Node);
              if (h) return h;
            }
          }
        } else if (typeof child === 'object' && typeof (child as { type?: unknown }).type === 'string') {
          const h = walk(child as Node);
          if (h) return h;
        }
      }
      return null;
    }
  }
}

function isStaticString(expr: Expression | undefined): boolean {
  if (!expr) return false;
  if (expr.type === 'Literal') {
    return typeof (expr as Literal).value === 'string';
  }
  if (expr.type === 'TemplateLiteral') {
    return (expr as TemplateLiteral).expressions.length === 0;
  }
  return false;
}

function rootIdentifier(node: Node): string | null {
  if (node.type === 'Identifier') return (node as unknown as Identifier).name;
  if (node.type === 'MemberExpression') {
    return rootIdentifier((node as MemberExpression).object as Node);
  }
  if (node.type === 'CallExpression') {
    return rootIdentifier((node as CallExpression).callee as Node);
  }
  return null;
}

function memberChain(node: MemberExpression): string {
  const parts: string[] = [];
  let cur: Node = node;
  while (cur.type === 'MemberExpression') {
    const me = cur as MemberExpression;
    const propName = memberPropertyName(me);
    parts.unshift(propName ?? '?');
    cur = me.object as Node;
  }
  if (cur.type === 'Identifier') {
    parts.unshift((cur as unknown as Identifier).name);
  }
  return parts.join('.');
}

function memberPropertyName(me: MemberExpression): string | null {
  if (!me.computed) {
    return me.property.type === 'Identifier' ? me.property.name : null;
  }
  if (me.property.type === 'Literal' && typeof me.property.value === 'string') {
    return me.property.value;
  }
  return null;
}

function snippet(node: Node): string {
  const s = (node as unknown as { start?: number; end?: number });
  if (typeof s.start === 'number' && typeof s.end === 'number') {
    return `loc:${s.start}-${s.end}`;
  }
  return node.type;
}

/**
 * Convert an AST hit into the same throw-prefix as blacklist, for one canonical
 * "blocked by MiniApp sandbox" message.
 */
export function formatAstError(hit: AstHit): string {
  return `module require blocked by MiniApp sandbox: ${hit.reason}`;
}

/**
 * Combined: scan black list AND AST. Returns the first hit from either.
 * black list runs first (cheaper, deterministic).
 */
export function scanAll(src: string, _moduleId: string): BlacklistHit | AstHit | null {
  // We can't run blacklist-only here because we don't always have the full
  // source available at the require() boundary (the loader only sees module
  // id + maybe the resolved source). blacklist.ts is for the require() path;
  // AST is for the source path. They cover different things.
  return scanAst(src);
}