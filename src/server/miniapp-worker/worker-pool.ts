// worker-pool.ts — singleton MiniAppWorkerPool.
//
// PRD §B.4 + Phase 3 plan: MiniApp workers = Node `worker_threads` inside
// the Sidecar address space (NOT `child_process.fork`). All worker lifecycle
// lives here; the Sidecar exposes it via `/api/miniapp/worker/{spawn,call,terminate}`.
//
// ponytail: ceiling=Node-only worker_threads (in-process); upgrade path=
// Phase 4 untrusted authors -> switch to child_process.fork (real OS-level
// isolation). Until then, worker_threads share Sidecar's V8 isolate.
//
// Worker threads INHERIT Sidecar's `process.env` (HTTP_PROXY / NO_PROXY /
// provider-aware env). No additional proxy config is needed at this layer —
// see CLAUDE.md §Pit-of-Success "apply-to-subprocess". Workers spawn via
// `new Worker(path, { workerData: {...} })` which doesn't go through Node's
// child_process, so env inheritance is automatic.

import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { withAbortSignal } from '../utils/cancellation';

import { getKindDef, type WorkerCallMessage, type WorkerShutdownMessage, type WorkerOutbound } from './worker-rpc';
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_MEMORY_MB, type NodeLimits } from './node-limits';

export const PER_APP_WORKER_CAP = 4;
const DEFAULT_TERMINATE_GRACE_MS = 200;

export interface SpawnWorkerRequest {
  appId: string;
  kind: string;
  init?: Record<string, unknown>;
  /**
   * `meta.json` `permissions.node`, resolved by the caller. The pool stays
   * filesystem-free; `node-limits.ts` is the single place that knows where
   * installed MiniApps live.
   */
  limits?: Partial<NodeLimits>;
}

export interface WorkerHandle {
  id: string;
  appId: string;
  kind: string;
  worker: Worker;
  methods: string[];
  spawnedAt: number;
  lastUsedAt: number;
  limits: NodeLimits;
}

export interface SpawnWorkerResult {
  workerId: string;
  methods: string[];
}

export interface CallRequest {
  workerId: string;
  method: string;
  params: unknown;
  timeoutMs?: number;
}

export interface CallResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface WorkerPoolEvents {
  'worker:spawned': (handle: WorkerHandle) => void;
  'worker:terminated': (workerId: string, appId: string, reason: string) => void;
  'worker:error': (workerId: string, error: Error) => void;
}

// Typed EventEmitter surface. We expose `on`/`off`/`emit` via explicit
// generics (instead of declaration-merging WorkerPool) so the typed-event
// shape lives at the call site; EventEmitter's own overloads remain
// available via the parent class for any untyped event.
type Listener<E extends keyof WorkerPoolEvents> = WorkerPoolEvents[E];

class WorkerPool extends EventEmitter {
  on<E extends keyof WorkerPoolEvents>(event: E, listener: Listener<E>): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  off<E extends keyof WorkerPoolEvents>(event: E, listener: Listener<E>): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  emitTyped<E extends keyof WorkerPoolEvents>(
    event: E,
    ...args: Parameters<Listener<E>>
  ): boolean {
    return super.emit(event, ...args);
  }
  private workers = new Map<string, WorkerHandle>();
  private pendingCalls = new Map<string, {
    resolve: (r: CallResult) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
    workerId: string;
  }>();
  private monotonicCounter = 0;

  /**
   * Spawn a new worker. Rejects with `per-app-cap` if the appId already has
   * PER_APP_WORKER_CAP workers (Phase 3 hard limit; LRU evict is the trigger
   * mechanism in `enforcePerAppCap`).
   */
  async spawn(req: SpawnWorkerRequest): Promise<SpawnWorkerResult> {
    const kindDef = getKindDef(req.kind);
    if (!kindDef) {
      throw new Error(`MiniAppWorkerPool: unknown kind '${req.kind}'`);
    }

    this.enforcePerAppCap(req.appId);

    const id = `miniapp-worker-${++this.monotonicCounter}-${randomUUID().slice(0, 8)}`;
    const limits: NodeLimits = {
      maxMemoryMb: req.limits?.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
      timeoutMs: req.limits?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    };
    // Phase 4: entry path comes from the kind def (registered at startup
    // by `kinds/<name>.ts`). The pool no longer hardcodes any kind.
    const worker = new Worker(kindDef.entryPath, {
      workerData: {
        appId: req.appId,
        kind: req.kind,
        init: req.init ?? {},
      },
      // PRD §B.4 sandbox ceilings, tightened or widened per MiniApp via
      // `meta.json` `permissions.node.max_memory_mb` (64MB default). Cheap
      // process-level isolation that catches runaway user code.
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxMemoryMb,
        maxYoungGenerationSizeMb: 16,
      },
    });

    const handle: WorkerHandle = {
      id,
      appId: req.appId,
      kind: req.kind,
      worker,
      methods: kindDef.methods.map((m) => m.name),
      spawnedAt: Date.now(),
      lastUsedAt: Date.now(),
      limits,
    };

    this.wireWorkerEvents(handle);
    this.workers.set(id, handle);
    this.emitTyped('worker:spawned', handle);
    return { workerId: id, methods: handle.methods };
  }

  /**
   * JSON-RPC call. Returns a Promise that resolves with the worker's reply.
   * Timeout (default 5s) is honored via `setTimeout`; cancellation via
   * optional `signal`.
   */
  call(req: CallRequest, opts: { signal?: AbortSignal } = {}): Promise<CallResult> {
    const handle = this.workers.get(req.workerId);
    if (!handle) {
      return Promise.resolve({
        ok: false,
        error: { code: 'WORKER_NOT_FOUND', message: `worker ${req.workerId} not found` },
      });
    }
    if (!handle.methods.includes(req.method)) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `method '${req.method}' not in allow-list for kind '${handle.kind}'`,
        },
      });
    }

    handle.lastUsedAt = Date.now();
    const id = randomUUID();
    const timeoutMs = req.timeoutMs ?? handle.limits.timeoutMs;

    return withAbortSignal(opts.signal, (signal: AbortSignal) => {
      return new Promise<CallResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingCalls.delete(id);
          resolve({
            ok: false,
            error: { code: 'TIMEOUT', message: `call timed out after ${timeoutMs}ms` },
          });
        }, timeoutMs);

        this.pendingCalls.set(id, {
          resolve,
          reject: () => {
            /* resolve already called by timer; nothing to do */
          },
          timer,
          workerId: req.workerId,
        });

        const msg: WorkerCallMessage = {
          type: 'call',
          id,
          method: req.method,
          params: req.params,
        };
        try {
          handle.worker.postMessage(msg);
        } catch (e) {
          this.pendingCalls.delete(id);
          clearTimeout(timer);
          resolve({
            ok: false,
            error: { code: 'POST_MESSAGE_FAILED', message: (e as Error).message },
          });
        }

        signal.addEventListener('abort', () => {
          const pending = this.pendingCalls.get(id);
          if (!pending) return;
          this.pendingCalls.delete(id);
          clearTimeout(pending.timer);
          resolve({
            ok: false,
            error: { code: 'CANCELLED', message: `call cancelled` },
          });
        });
      });
    });
  }

  /**
   * Graceful terminate: send `shutdown`, wait `gracefulMs`, then `terminate()`.
   * If the worker exits cleanly before grace, fine — listener handles cleanup.
   */
  async terminate(workerId: string, opts: { gracefulMs?: number } = {}): Promise<void> {
    const handle = this.workers.get(workerId);
    if (!handle) return;
    const gracefulMs = opts.gracefulMs ?? DEFAULT_TERMINATE_GRACE_MS;

    try {
      handle.worker.postMessage({ type: 'shutdown' } satisfies WorkerShutdownMessage);
    } catch {
      // Worker may already be dead; skip graceful path.
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const onExit = () => {
        if (done) return;
        done = true;
        resolve();
      };
      handle.worker.once('exit', onExit);
      setTimeout(() => {
        if (done) return;
        try {
          handle.worker.terminate();
        } catch {
          // Already gone
        }
        // give the listener a tick to fire
        setTimeout(onExit, 50);
      }, gracefulMs);
    });

    // worker:exit listener will remove from map; double-guard here.
    if (this.workers.has(workerId)) {
      this.workers.delete(workerId);
      this.emitTyped('worker:terminated', workerId, handle.appId, 'manual');
    }
  }

  /** LRU: enforce per-app cap by terminating the oldest lastUsedAt. */
  private enforcePerAppCap(appId: string): void {
    const appWorkers = [...this.workers.values()].filter((w) => w.appId === appId);
    if (appWorkers.length < PER_APP_WORKER_CAP) return;

    // Sort by lastUsedAt ascending — first is the oldest.
    appWorkers.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const evict = appWorkers[0];
    // Best-effort async; the caller will continue and the eviction completes
    // in the background. We don't `await` because the pool API is sync-ish
    // here; the next spawn() call will see the cap respected shortly.
    void this.terminate(evict.id, { gracefulMs: 50 }).catch((e) => {
      this.emitTyped('worker:error', evict.id, e as Error);
    });
  }

  private wireWorkerEvents(handle: WorkerHandle): void {
    handle.worker.on('message', (raw: unknown) => {
      // Worker sends either a response (call-result) or an event (shutdown-ack).
      if (!raw || typeof raw !== 'object') return;
      const msg = raw as Partial<WorkerOutbound>;
      if (msg.type === 'response' && typeof msg.id === 'string') {
        const pending = this.pendingCalls.get(msg.id);
        if (!pending) return;
        this.pendingCalls.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve({ ok: true, result: msg.result });
        } else {
          pending.resolve({
            ok: false,
            error: msg.error ?? { code: 'UNKNOWN', message: 'unknown error' },
          });
        }
      } else if (msg.type === 'event' && msg.event === 'error') {
        this.emitTyped('worker:error', handle.id, new Error(msg.detail ?? 'worker error'));
      }
    });

    handle.worker.on('error', (err) => {
      this.emitTyped('worker:error', handle.id, err);
    });

    handle.worker.on('exit', (code) => {
      // Reject any pending calls
      for (const [id, pending] of this.pendingCalls) {
        if (pending.workerId === handle.id) {
          this.pendingCalls.delete(id);
          clearTimeout(pending.timer);
          pending.resolve({
            ok: false,
            error: { code: 'WORKER_EXITED', message: `worker exited with code ${code}` },
          });
        }
      }
      this.workers.delete(handle.id);
      this.emitTyped('worker:terminated', handle.id, handle.appId, `exit ${code}`);
    });
  }

  /** Test-only: clear all state. Production code MUST NOT call this. */
  __resetForTest(): void {
    for (const w of this.workers.values()) {
      try {
        w.worker.terminate();
      } catch {
        // ignore
      }
    }
    for (const p of this.pendingCalls.values()) {
      clearTimeout(p.timer);
    }
    this.workers.clear();
    this.pendingCalls.clear();
    this.monotonicCounter = 0;
  }

  /** Diagnostics: snapshot of current pool state. */
  snapshot(): { workerCount: number; byApp: Record<string, number> } {
    const byApp: Record<string, number> = {};
    for (const w of this.workers.values()) {
      byApp[w.appId] = (byApp[w.appId] ?? 0) + 1;
    }
    return { workerCount: this.workers.size, byApp };
  }
}

export const pool = new WorkerPool();

/**
 * Mount point for Sidecar startup. Mirror Phase 2's `registerBridge` pattern
 * at `agent-session.ts:13`. Phase 3 doesn't yet wire this into the boot path
 * because git-graph isn't user-facing until the bundled-miniapps/git-graph
 * MiniApp is opened; the lazy registration is fine.
 */
export function registerWorkerPool(): void {
  // No-op for now; pool is module-level singleton. This function exists so
  // the boot path can call it for symmetry with other modules.
}