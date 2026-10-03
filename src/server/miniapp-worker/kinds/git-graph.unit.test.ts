// git-graph.unit.test.ts — GIT_GRAPH_KIND 的 fs 范围闸。
//
// 只测闸，不测 git 本身：`getSimpleGit()` 要真 simple-git + 真仓库，而闸跑在
// 它**之前**，所以"一个没声明 fs.write 的 app 想 checkout"这个拒绝可以在完全不
// 碰 git 的情况下钉住 —— 这也正是最值得钉的那条。
//
// 背景：`app.call` 不经过 `runAppCall`、`/api/miniapp/worker/call` 不读
// meta.json，所以 kind 以前完全不知道自己被授权到哪。加上这道闸之前，
// `git.checkout` 可以改这台机器上任意 git 仓库的工作树，且零 fs 权限。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_GRAPH_KIND } from './git-graph';
import { getKindDef, listKinds } from '../worker-rpc';

type Ctx = { appId: string; fsScope: { read: string[]; write: string[] } };
type Handler = (p: unknown, c: Ctx) => Promise<unknown>;

const call = (name: string): Handler =>
  GIT_GRAPH_KIND.methods.find((m) => m.name === name)!.handler as Handler;

describe('GIT_GRAPH_KIND', () => {
  it('registers itself and exposes the five documented methods', () => {
    expect(getKindDef('git-graph')).toBe(GIT_GRAPH_KIND);
    expect(listKinds().map((k) => k.kind)).toContain('git-graph');
    expect(GIT_GRAPH_KIND.methods.map((m) => m.name).sort()).toEqual([
      'git.checkout',
      'git.diff',
      'git.log',
      'git.show',
      'git.status',
    ]);
  });
});

describe('GIT_GRAPH_KIND fs scope', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'miniapp-gitgraph-scope-'));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const readOnly = (): Ctx => ({
    appId: 'gitgraph-probe',
    fsScope: { read: [`${repo}/**`], write: [] },
  });

  it('git.checkout is refused when the app declared no fs.write', async () => {
    // 这条是本文件的核心：checkout 会改工作树，而 `read` 不蕴含 `write`。
    // 内置 git-graph 恰好声明的就是 `fs.write: []`，所以这个拒绝是它的真实状态。
    await expect(async () => call('git.checkout')({ cwd: repo, branch: 'main' }, readOnly()))
      .rejects.toThrow(/not covered by permissions\.fs\.write/);
  });

  it('git.checkout is refused when the app declared no scope at all', async () => {
    const none: Ctx = { appId: 'gitgraph-probe', fsScope: { read: [], write: [] } };
    // Write scope is checked first, so that is the message — the point of the
    // case is the refusal, not which of the two guards got there.
    await expect(async () => call('git.checkout')({ cwd: repo, branch: 'main' }, none))
      .rejects.toThrow(/not covered by permissions\.fs\.(read|write)/);
  });

  it('a cwd outside fs.read is refused before any git work happens', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'miniapp-gitgraph-outside-'));
    try {
      await expect(
        async () => call('git.log')({ cwd: outside }, readOnly()),
      ).rejects.toThrow(/not covered by permissions\.fs\.read/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('every method refuses an undeclared cwd, not just checkout', async () => {
    // 单点修补的典型反例：只给 checkout 加闸，git.log 仍然能读任意仓库。
    for (const name of ['git.log', 'git.show', 'git.diff', 'git.status', 'git.checkout']) {
      const params =
        name === 'git.show' ? { cwd: repo, hash: 'HEAD' } : name === 'git.checkout'
          ? { cwd: repo, branch: 'main' }
          : { cwd: repo };
      await expect(
        async () => call(name)(params, { appId: 'g', fsScope: { read: [], write: [] } }),
        name,
      ).rejects.toThrow(/not covered by permissions\.fs\.(read|write)/);
    }
  });
});
