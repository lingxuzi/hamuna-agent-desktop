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

import { isPathAllowed } from '../../shared/miniapp/app-permissions';

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
  ctx: { appId: string; signal?: AbortSignal; fsScope: WorkerFsScope },
) => Promise<TResult> | TResult;

/**
 * 一个 MiniApp 的 `permissions.fs` 展开成绝对前缀后的样子。
 *
 * 由 spawn 路由在**创建 worker 之前**从 meta.json 解析好，经 `workerData` 带进来。
 * 为什么必须在 spawn 时定死而不是每次 call 再查：worker 线程拿不到 meta.json
 * 的权威副本（它是另一个线程里的另一个进程视图），而"读一次就固定"正好是权限
 * 该有的语义 —— 作者改 meta 不应该让已经跑起来的 worker 突然多出能力。
 *
 * 两个 kind 以前完全没有这个概念，于是 `file.read` 能读全盘、`git.checkout` 能
 * 写任意仓库，且零 fs 权限：handler 只做 `lstat` 反 symlink，那是防 symlink 的，
 * 不是范围边界。注释里那句 "$WORKSPACE/** defines the scope" 描述的展开从来没
 * 存在过。
 */
export interface WorkerFsScope {
  /** 绝对路径前缀；空数组 = 该 app 一个字节都读不到。 */
  read: string[];
  /** 同上，写侧单独一份 —— `read` 不蕴含 `write`。 */
  write: string[];
}

/**
 * handler 碰任何路径之前必须过这一道。**不要**在 kind 里另写一套前缀比较：
 * shared 的 `isPathAllowed` 就是 `app.fs.*` 用的那一份，语义必须一致，否则
 * `app.fs` 与 `app.call` 会对同一个路径给出不同答案。
 *
 * 读侧 / 写侧分开判：能读不等于能写，这正是 `permissions.fs` 两份数组的含义。
 */
export function assertWithinFsScope(
  target: string,
  scope: WorkerFsScope,
  mode: 'read' | 'write',
  ctx: { appId: string },
): string {
  const prefixes = scope[mode];
  if (!isPathAllowed(target, prefixes)) {
    throw new Error(
      `path not covered by permissions.fs.${mode} for '${ctx.appId}': ${target}`,
    );
  }
  return target;
}

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