// require-shim.ts — installed as the FIRST thing worker-entry files do.
//
// ponytail: ceiling=Node-only worker_threads (in-process); upgrade path=
// Phase 4 untrusted authors -> switch to child_process.fork (real OS-level
// isolation). Until then, this shim is the only thing standing between a
// MiniApp's user code and `process.exit` / `process.binding` / `Module._load`
// that would happily kill the whole Sidecar.
//
// Worker entry pattern (see worker-entry-git-graph.ts):
//
//   import { installRequireShim } from './require-shim.ts';
//   installRequireShim();
//   // rest of user code, including any `require('fs')` etc.
//
// `require-shim.ts` is .ts so it can import `worker-blacklist.ts` and
// `ast-policy.ts` via the bundler. The bundled output is plain JS that the
// worker thread loads directly.

import { realpathSync } from 'node:fs';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  DENY_MODULES,
  formatBlacklistError,
} from './worker-blacklist';
import { scanAst } from './ast-policy';

let installed = false;

export interface RequireShimState {
  installCount: number;
}

export interface RequireShimOptions {
  /** Additional module names to deny (per-MiniApp grants could narrow this). */
  denyModules?: readonly string[];
}

const state: RequireShimState = {
  installCount: 0,
};

/**
 * The worker's OWN entry bundle is not user code, so it must not be scanned.
 *
 * The AST hook below fires for every `.js` the worker loads, and in the
 * shipped build the entry, the kind, simple-git and the require shim are all
 * inlined into ONE file. The kind's handlers legitimately do `require('fs')`
 * (that is how file-explorer reads a directory), so once the shim installs,
 * the first lazy require from a handler is scanned, flagged, and the worker
 * dies with `module require blocked by MiniApp sandbox: module='fs'`.
 *
 * Scanning the entry is also pointless: its source is the trusted server build,
 * not something a MiniApp author controls. MiniApp user code is loaded
 * separately (per-app worker entry from the installed app dir) and is still
 * scanned -- only the trusted bootstrap is exempt.
 *
 * Identity is exact (same realpath as this module's own file), not a prefix
 * match: a prefix would exempt anything under the server bundle directory,
 * which is exactly the directory untrusted per-app entries do NOT live in.
 */
const SELF_FILENAME = ((): string | null => {
  try {
    return realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
})();

function isTrustedWorkerSelf(filename: string): boolean {
  return __isTrustedForTest(filename);
}

/**
 * The predicate, with identity injectable so the "identity could not be
 * resolved" branch is reachable from a test.
 *
 * Exported because otherwise it is unreachable: `installRequireShim` only
 * patches the loader, so exercising the branch needs a file that *is* this
 * module, and in vitest the loader sees the test file, never the shim. Without
 * this, every mutation of the predicate (trust everything, match by prefix,
 * fail open, drop the exemption) leaves the suite green -- verified, not
 * assumed.
 */
export function __isTrustedForTest(filename: string, self: string | null = SELF_FILENAME): boolean {
  if (!self) return false;
  try {
    return realpathSync(filename) === self;
  } catch {
    return false;
  }
}

/** Test-only view of the resolved identity. */
export function __trustedSelfForTest(): { self: string | null } {
  return { self: SELF_FILENAME };
}

export function installRequireShim(options: RequireShimOptions = {}): void {
  if (installed) return;
  installed = true;
  state.installCount += 1;

  const originalRequire = Module.prototype.require as unknown as (
    this: unknown,
    id: string,
  ) => unknown;
  const denyModules = new Set<string>([...DENY_MODULES, ...(options.denyModules ?? [])]);

  // Patch 1 — require() interceptor. We catch BOTH:
  //  - moduleId is a string in deny list -> throw
  //  - source for that module contains bypass tokens -> throw
  //
  // Source-level (AST) checks happen at the Module._extensions['.js'] level
  // below, BEFORE user code is evaluated. That's how we catch
  // `require('fs' + '/promises')` etc.
  Module.prototype.require = function patchedRequire(this: unknown, id: string) {
    // Normalize the `node:` prefix before the deny lookup. Node treats
    // `require('fs')` and `require('node:fs')` as the same module, so a
    // literal-only Set lookup let every denied builtin through its own
    // canonical spelling — `require('node:fs')` returned a real, working
    // `fs` (verified end-to-end; see the regression test). Denying one
    // spelling of a builtin while allowing the other is not a policy, it is
    // a typo with a sandbox-shaped hole in it.
    const bare = typeof id === 'string' && id.startsWith('node:') ? id.slice(5) : id;
    if (typeof bare === 'string' && denyModules.has(bare)) {
      throw new Error(formatBlacklistError({ reason: 'module', pattern: id }));
    }
    return originalRequire.call(this, id);
  };

  // Patch 1b — Module._extensions['.js'] hook to intercept and AST-scan
  // user source BEFORE it's evaluated. Required because the patched
  // require() only sees the module id, not the source.
  const moduleInternal = Module as unknown as {
    _extensions: Record<string, (mod: unknown, filename: string) => void>;
  };
  const ext = moduleInternal._extensions['.js'];
  moduleInternal._extensions['.js'] = function workerExtension(
    mod: unknown,
    filename: string,
  ) {
    const fs = originalRequire.call(null, 'node:fs') as typeof import('node:fs');
    let raw: string;
    try {
      raw = fs.readFileSync(filename, 'utf8');
    } catch {
      // Native or non-FS-backed modules fall through to original loader.
      return ext(mod, filename);
    }

    // The worker's own bootstrap bundle is trusted server code, not MiniApp user
    // code -- see isTrustedWorkerSelf. Everything else is still scanned.
    if (isTrustedWorkerSelf(filename)) {
      return ext(mod, filename);
    }

    const astHit = scanAst(raw);
    if (astHit) {
      throw new Error(`module require blocked by MiniApp sandbox: ${astHit.reason}`);
    }
    return ext(mod, filename);
  };

  // Patch 2 — process.exit. worker_threads share V8 isolate; calling
  // process.exit() would kill the Sidecar. Phase 3 doesn't have a real
  // "exit this worker" path; users call worker.terminate() from the pool.
  // We throw so the worker dies noisily rather than silently.
  process.exit = function workerExitGuard(code?: number): never {
    throw new Error(
      `worker calling process.exit(${code ?? ''}) is blocked; use worker.terminate() from MiniAppWorkerPool`,
    );
  };

  // Patch 3 — freeze host V8 internals the attacker might mutate.
  // (These are read-only by spec; `Object.freeze` makes accidental mutation
  // throw at runtime — useful diagnostic, not a real barrier.)
  try {
    const proc = process as unknown as { binding?: unknown };
    if (typeof proc.binding === 'function') {
      Object.freeze(proc.binding);
    }
  } catch {
    // process.binding may not exist on all platforms; ignore.
  }
}

/**
 * Test-only: reset installed flag so installRequireShim() can re-run.
 * Production code MUST NOT call this — install once at worker boot.
 */
export function __resetRequireShimForTest(): void {
  installed = false;
  state.installCount = 0;
}

/**
 * Test-only: get the shim state for assertions.
 */
export function __getRequireShimState(): RequireShimState {
  return state;
}
