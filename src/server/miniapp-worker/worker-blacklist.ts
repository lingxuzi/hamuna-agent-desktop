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
  // eval it under this layer; the eval content is opaque (covered by AST).
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