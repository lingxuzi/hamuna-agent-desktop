// worker-rpc.ts — JSON-RPC envelopes + per-kind registry.
//
// Phase 4 (PRD v0.4 §B.5) replaces Phase 3's hardcoded `getKindDef` with a
// dynamic `Map<string, WorkerKindDef>` registry. Each kind file under
// `kinds/<name>.ts` self-registers via `registerKind(GIT_GRAPH_KIND)` at
// module-load time; the pool barrel `index.ts` imports all known kinds so
// the side effect runs at Sidecar startup.
//
// ponytail: kind discovery ceiling = static import from `kinds/index.ts`.
// Upgrade path when untrusted authors ship new kinds: scan
// `bundled-miniapps/*/worker-entry-*.js` and `registerKind()` at startup.

import { z } from 'zod';

/** Wire envelopes (parent thread <-> worker thread). */

export interface WorkerCallMessage {
  type: 'call';
  id: string;
  method: string;
  params: unknown;
}

export interface WorkerShutdownMessage {
  type: 'shutdown';
}

export type WorkerInbound = WorkerCallMessage | WorkerShutdownMessage;

/** Worker thread side: response envelope (worker -> parent). */
export interface WorkerResponseMessage {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface WorkerEventMessage {
  type: 'event';
  event: 'shutdown-ack' | 'error';
  detail?: string;
}

export type WorkerOutbound = WorkerResponseMessage | WorkerEventMessage;

/** Per-method handler signature. Worker entry files register one per method. */
export type WorkerMethodHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  ctx: { appId: string; signal?: AbortSignal },
) => Promise<TResult> | TResult;

export interface WorkerMethodDef<TParams = unknown, TResult = unknown> {
  /** Method name as called by `app.worker.call('git.log', {...})`. */
  name: string;
  /** zod schema for params. Runtime fails closed on schema mismatch. */
  schema: z.ZodType<TParams>;
  handler: WorkerMethodHandler<TParams, TResult>;
}

export interface WorkerKindDef {
  /** Kind name (matches `meta.json::worker_kind`). */
  kind: string;
  /**
   * Absolute (or pool-relative) path to the worker-thread entry script.
   * The pool spawns `new Worker(fileURLToPath(...))` against this. esbuild
   * tracks the entry from `src/server/index.ts` import chain so it ships
   * in `server-dist.js`.
   */
  entryPath: string;
  methods: WorkerMethodDef[];
}

// ───── registry ───────────────────────────────────────────────────────────────

const KIND_REGISTRY = new Map<string, WorkerKindDef>();

/**
 * Register a kind. Called at module load by each `kinds/<name>.ts`. Throws on
 * duplicate so a typo'd kind-name + bundle collision surfaces at startup, not
 * at first user-visible "open git-graph" attempt.
 */
export function registerKind(kind: WorkerKindDef): void {
  if (KIND_REGISTRY.has(kind.kind)) {
    const existing = KIND_REGISTRY.get(kind.kind);
    if (existing && existing !== kind) {
      throw new Error(`registerKind: duplicate kind '${kind.kind}'`);
    }
    return;
  }
  KIND_REGISTRY.set(kind.kind, kind);
}

/** Look up a registered kind by name. Returns null if unknown. */
export function getKindDef(kind: string): WorkerKindDef | null {
  return KIND_REGISTRY.get(kind) ?? null;
}

/** List all registered kinds. Used by tests + the pool for diagnostics. */
export function listKinds(): readonly WorkerKindDef[] {
  return [...KIND_REGISTRY.values()];
}

/** Test-only: wipe the registry. Kinds must be re-imported to re-register. */
export function __resetRegistryForTest(): void {
  KIND_REGISTRY.clear();
}