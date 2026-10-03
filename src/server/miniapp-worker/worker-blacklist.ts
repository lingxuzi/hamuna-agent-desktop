// worker-blacklist.ts — string-match deny list for require() shim.
//
// PRD §13.8: MiniApp worker_threads in Sidecar address space can NOT use
// Node built-ins like `fs`, `child_process`, `vm` etc. without explicit
// per-MiniApp grants. This file is the deterministic layer (cheaper than
// AST) — `ast-policy.ts` is the fallback that catches dynamic concat.

export const DENY_MODULES: readonly string[] = [
  'fs',
  'fs/promises',
  'child_process',
  'os',
  'path',
  'crypto',
  'net',
  'http',
  'https',
  'http2',
  'https2',
  'tls',
  'dgram',
  'dns',
  'worker_threads',
  'cluster',
  'vm',
  'inspector',
  'perf_hooks',
  'trace_events',
  'async_hooks',
];

// Tokens that reach host V8 internals even when require() is patched.
// `Module._load`, `process.binding`, etc. — string-match on the WHOLE source
// so an attacker can't smuggle them inside a comment or string literal then
// eval-later. (Eval content is opaque; that's what `ast-policy.ts` covers.)
export const DENY_BYPASS_TOKENS: readonly string[] = [
  'process.binding',
  'process.dlopen',
  'process._linkedBinding',
  'process.mainModule',
  'process._linkedBinding',
  'Module._load',
  'Module._cache',
  'Module._resolveFilename',
  'require.resolve',
  'createRequire',
  '__non_webpack_require__',
  '__webpack_require__',
  'Reflect.get',
  'Object.getPrototypeOf',
];

export interface BlacklistHit {
  reason: 'module' | 'bypass-token';
  pattern: string;
}

/**
 * Fail-closed scan. Returns the first hit (if any). The whole source is
 * matched — not just literal `require('fs')` calls — so a `//` comment can't
 * smuggle a banned token past this layer.
 *
 * @param src Full source text of the file the worker is about to require()
 * @param moduleId The string passed as the first arg to require() (already
 *                 isolated for the module deny-list check).
 */
export function scanBlacklist(src: string, moduleId: string): BlacklistHit | null {
  if (DENY_MODULES.includes(moduleId)) {
    return { reason: 'module', pattern: moduleId };
  }
  // Bypass tokens: case-sensitive substring match against the full source.
  // We do NOT use regex here — the goal is "if these tokens appear at all,
  // refuse". An attacker can't hide `process.binding` in a string and later
  // eval it under this layer; the eval content is opaque to the AST layer.
  //
  // 修正一处曾经为假的断言：上面括号里的 "covered by AST" 说的是 `ast-policy.ts`
  // 会兜住 eval 的内容。实测不会 —— `scanAst('eval("require(\'fs\')")')` 返回
  // `null`（AST 看得到 `eval` 这个 CallExpression，但它的参数是个 Literal 字符串，
  // 规则 1 只匹配 callee 为 `require` 的调用，规则 3 只覆盖 `new Function`）。
  // 换句话说这层是**唯一**能看见字符串字面量里藏 token 的地方，而它当时没被接线。
  //
  // 同时提醒：本函数在生产路径上**目前没有任何调用方**（只有 `index.ts` 的再导出与
  // 单测），真正生效的只有 `require-shim.ts` 里的 `scanAst`。
  for (const token of DENY_BYPASS_TOKENS) {
    if (src.includes(token)) {
      return { reason: 'bypass-token', pattern: token };
    }
  }
  return null;
}

/**
 * Render a hit as the error message the worker should throw. Phase 3 uses
 * this exact prefix so callers can pattern-match (e.g. a Phase 4 logging
 * helper could count "blocked by MiniApp sandbox" lines per appId).
 */
export function formatBlacklistError(hit: BlacklistHit): string {
  return `module require blocked by MiniApp sandbox: ${hit.reason}='${hit.pattern}'`;
}
