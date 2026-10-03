// kinds/git-graph.ts — git-graph worker kind definition (Phase 4 registry).
//
// Each kind lives in its own file under `kinds/<name>.ts` and exports a
// `WorkerKindDef` with schemas + handlers + entry script path. The pool
// imports this file (side effect: self-register via `registerKind()`) and
// uses `kindDef.entryPath` to spawn the right worker thread.
//
// ponytail: kind registry ceiling = static self-register via top-level
// `registerKind(GIT_GRAPH_KIND)` call. Upgrade path when untrusted authors
// ship new kinds: dynamic discovery from `bundled-miniapps/` at startup.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { simpleGit as createSimpleGit } from 'simple-git';
import { z } from 'zod';

import {
  registerKind,
  type WorkerKindDef,
  type WorkerMethodHandler,
  type WorkerFsScope,
  assertWithinFsScope,
} from '../worker-rpc';

const here = path.dirname(fileURLToPath(import.meta.url));

// ───── schemas ────────────────────────────────────────────────────────────────

const GitLogParams = z.object({
  cwd: z.string().min(1),
  max: z.number().int().min(1).max(1000).optional(),
  branch: z.string().optional(),
});

const GitShowParams = z.object({
  cwd: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{4,64}$/i),
});

const GitCheckoutParams = z.object({
  cwd: z.string().min(1),
  branch: z.string().min(1),
});

const GitDiffParams = z.object({
  cwd: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

const GitStatusParams = z.object({
  cwd: z.string().min(1),
});

// ───── handlers ───────────────────────────────────────────────────────────────

/**
 * Verify the requested cwd is allowed for this MiniApp. The MiniApp's
 * meta.json declares `permissions.fs.read: ['{workspace}/**']` (path-templates
 * expands it at install time). We just enforce "is this an actual git repo".
 */
function assertReadableCwd(cwd: string, ctx: { appId: string; fsScope: WorkerFsScope }): void {
  const resolved = path.resolve(cwd);
  assertWithinFsScope(resolved, ctx.fsScope, 'read', ctx);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`cwd not accessible: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`cwd is not a directory: ${resolved}`);
  }
  const gitDir = path.join(resolved, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(`not a git repo: ${resolved}`);
  }
}

/**
 * simple-git instance factory.
 *
 * This is a **static** import on purpose. A lazy `await import('simple-git')`
 * works under vitest and breaks in the shipped worker bundle, and the reason is
 * worth keeping in mind before "optimising" it back:
 *
 *   esbuild emits a lazily-imported ESM module as a bare `esm_exports` object
 *   plus a `__esm` lazy-init wrapper. With several ESM modules in one bundle only
 *   the FIRST gets a wrapper -- later ones are emitted without their init
 *   function, so the dynamic import site calls the *wrong* module's init.
 *   simple-git's `esm_default` therefore stayed `undefined`, `.default` was not
 *   a function, and every handler died with
 *   `(intermediate value).default is not a function`.
 *
 *   That failure is invisible to every test in the repo: vitest resolves
 *   simple-git through Node's own loader, where `.default` works. It appears
 *   only in the built worker -- i.e. only in the shipped app.
 *
 * A static import has no interop step at all: esbuild wires the binding
 * directly, and vitest and the bundle observe the same function.
 *
 * ponytail: ceiling = none of the above applies while the import is static.
 * Upgrade path: if simple-git ever needs to be lazy for startup cost, measure
 * first, and prefer a static import in the worker entry over restoring the
 * dynamic one.
 */
const getSimpleGit = createSimpleGit;

const gitLog: WorkerMethodHandler<z.infer<typeof GitLogParams>> = async (params, ctx) => {
  assertReadableCwd(params.cwd, ctx);
  const sg = getSimpleGit(params.cwd);
  const log = await sg.log({
    maxCount: params.max ?? 50,
    ...(params.branch ? { from: params.branch, to: params.branch } : {}),
  });
  return {
    total: log.total,
    latest: log.latest?.hash ?? null,
    all: log.all.map((entry: {
      hash: string;
      date: string;
      message: string;
      author_name: string;
      author_email: string;
      refs: string;
    }) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author_name: entry.author_name,
      author_email: entry.author_email,
      refs: entry.refs,
    })),
  };
};

const gitShow: WorkerMethodHandler<z.infer<typeof GitShowParams>> = async (params, ctx) => {
  assertReadableCwd(params.cwd, ctx);
  const sg = getSimpleGit(params.cwd);
  const summary = await sg.show([params.hash]);
  return {
    hash: params.hash,
    summary: typeof summary === 'string' ? summary : String(summary),
  };
};

const gitCheckout: WorkerMethodHandler<z.infer<typeof GitCheckoutParams>> = async (params, ctx) => {
  // Write scope FIRST, then `assertReadableCwd`'s read scope, then the repo
  // shape check. "is this even a repo?" is a fact about the path; "are you
  // allowed to change it?" is the question that must be answered first, and
  // answering it first also means an undeclared cwd can't learn whether it
  // happens to point at a repository.
  assertWithinFsScope(path.resolve(params.cwd), ctx.fsScope, 'write', ctx);
  assertReadableCwd(params.cwd, ctx);
  const sg = getSimpleGit(params.cwd);
  await sg.checkout(params.branch);
  return { ok: true, branch: params.branch };
};

const gitDiff: WorkerMethodHandler<z.infer<typeof GitDiffParams>> = async (params, ctx) => {
  assertReadableCwd(params.cwd, ctx);
  const sg = getSimpleGit(params.cwd);
  const diff = await sg.diff([params.from ?? 'HEAD~1', params.to ?? 'HEAD']);
  return { diff: typeof diff === 'string' ? diff : String(diff) };
};

const gitStatus: WorkerMethodHandler<z.infer<typeof GitStatusParams>> = async (params, ctx) => {
  assertReadableCwd(params.cwd, ctx);
  const sg = getSimpleGit(params.cwd);
  const status = await sg.status();
  // `branches` 是作者契约的一部分：git-graph 的分支下拉框 gate 在
  // `Array.isArray(status.branches)` 上，缺了它下拉框永远是 "(no branches)"，
  // 而 checkout 按钮从下拉框取值 —— 于是整个 checkout 功能是死的，且**无声**：
  // 加载成功、图画出来、只是没法切分支。`sg.status()` 本身不带分支列表（实测
  // 它的 key 里没有 branches），分支列表来自 `branchLocal()`，所以这里必须
  // 显式合并进去。
  const local = await sg.branchLocal();
  return {
    current: status.current,
    tracking: status.tracking,
    // `branchLocal().all` 是**字符串**数组，不是 `{ name }` 对象 —— 这里写成
    // `.map(b => b.name)` 会得到一整排 `undefined`，而 `Array.isArray` 仍然
    // 为真，于是下拉框列出 "(no branches)" 之外的一堆空项。已实测确认形状。
    branches: local.all,
    files: status.files.map((f: { path: string; index: string; working_dir: string }) => ({
      path: f.path,
      index: f.index,
      working_dir: f.working_dir,
    })),
  };
};

// ───── kind export ────────────────────────────────────────────────────────────

export const GIT_GRAPH_KIND: WorkerKindDef = {
  kind: 'git-graph',
  // `new Worker(entryPath)` needs a real file, so the entry is emitted as its
  // own bundle **next to** server-dist.js by scripts/esbuild-bundle.mjs.
  //
  // The '..' that used to be here was wrong: `here` is the directory of the
  // *running bundle*, which in a packaged app is the install root, so '..'
  // resolved to the app's **parent** directory. Nothing is ever written there,
  // and under Program Files it is not even writable. `new Worker(<missing
  // path>)` does not throw -- it emits `error` asynchronously -- so `spawn()`
  // reported success and handed the MiniApp a worker id that could never
  // answer. Sibling, not parent.
  entryPath: path.join(here, 'worker-entry-git-graph.js'),
  methods: [
    { name: 'git.log', schema: GitLogParams, handler: gitLog as never },
    { name: 'git.show', schema: GitShowParams, handler: gitShow as never },
    { name: 'git.checkout', schema: GitCheckoutParams, handler: gitCheckout as never },
    { name: 'git.diff', schema: GitDiffParams, handler: gitDiff as never },
    { name: 'git.status', schema: GitStatusParams, handler: gitStatus as never },
  ],
};

// Self-register at module load. The pool barrel `./index.ts` imports each
// kind file at startup, triggering this side-effect.
registerKind(GIT_GRAPH_KIND);
