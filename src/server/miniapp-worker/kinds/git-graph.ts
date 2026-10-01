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

import { z } from 'zod';

import {
  registerKind,
  type WorkerKindDef,
  type WorkerMethodHandler,
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
function assertReadableCwd(cwd: string): void {
  const resolved = path.resolve(cwd);
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

let simpleGitMod: typeof import('simple-git') | null = null;
async function getSimpleGit() {
  if (!simpleGitMod) {
    simpleGitMod = await import('simple-git');
  }
  return simpleGitMod;
}

const gitLog: WorkerMethodHandler<z.infer<typeof GitLogParams>> = async (params) => {
  assertReadableCwd(params.cwd);
  const sg = (await getSimpleGit()).default(params.cwd);
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

const gitShow: WorkerMethodHandler<z.infer<typeof GitShowParams>> = async (params) => {
  assertReadableCwd(params.cwd);
  const sg = (await getSimpleGit()).default(params.cwd);
  const summary = await sg.show([params.hash]);
  return {
    hash: params.hash,
    summary: typeof summary === 'string' ? summary : String(summary),
  };
};

const gitCheckout: WorkerMethodHandler<z.infer<typeof GitCheckoutParams>> = async (params) => {
  assertReadableCwd(params.cwd);
  const sg = (await getSimpleGit()).default(params.cwd);
  await sg.checkout(params.branch);
  return { ok: true, branch: params.branch };
};

const gitDiff: WorkerMethodHandler<z.infer<typeof GitDiffParams>> = async (params) => {
  assertReadableCwd(params.cwd);
  const sg = (await getSimpleGit()).default(params.cwd);
  const diff = await sg.diff([params.from ?? 'HEAD~1', params.to ?? 'HEAD']);
  return { diff: typeof diff === 'string' ? diff : String(diff) };
};

const gitStatus: WorkerMethodHandler<z.infer<typeof GitStatusParams>> = async (params) => {
  assertReadableCwd(params.cwd);
  const sg = (await getSimpleGit()).default(params.cwd);
  const status = await sg.status();
  return {
    current: status.current,
    tracking: status.tracking,
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
  // Entry script lives next to the pool (sibling of `kinds/`) so worker_threads
  // can `new Worker(fileURLToPath(...))` it. esbuild follows the import chain
  // from `src/server/index.ts` so the file is bundled into server-dist.js.
  entryPath: path.join(here, '..', 'worker-entry-git-graph.js'),
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