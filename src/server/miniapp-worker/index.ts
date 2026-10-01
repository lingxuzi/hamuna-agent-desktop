// miniapp-worker/index.ts — barrel for Phase 3 + Phase 4 MiniApp worker sandbox.
//
// Importing this barrel triggers each `kinds/<name>.ts` self-register via
// `registerKind()`. Sidecar startup mounts the pool via `registerWorkerPool()`
// (no-op today; pool is a module-level singleton). HTTP forward-port routes
// (`/api/miniapp/worker/{spawn,call,terminate}`) import `pool` directly.

import './kinds/git-graph';
import './kinds/file-explorer';

export {
  pool,
  registerWorkerPool,
  PER_APP_WORKER_CAP,
  type WorkerHandle,
  type SpawnWorkerRequest,
  type SpawnWorkerResult,
  type CallRequest,
  type CallResult,
} from './worker-pool';

export {
  getKindDef,
  registerKind,
  listKinds,
  type WorkerKindDef,
  type WorkerMethodDef,
  type WorkerMethodHandler,
} from './worker-rpc';

export {
  DENY_MODULES,
  DENY_BYPASS_TOKENS,
  scanBlacklist,
  formatBlacklistError,
  type BlacklistHit,
} from './worker-blacklist';

export { scanAst, formatAstError, type AstHit } from './ast-policy';

export {
  installRequireShim,
  __resetRequireShimForTest,
  __getRequireShimState,
  type RequireShimOptions,
  type RequireShimState,
} from './require-shim';