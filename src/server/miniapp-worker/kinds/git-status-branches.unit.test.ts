// git-status-branches.unit.test.ts — `git.status` 必须真的返回 `branches`。
//
// ## 这条护栏拦的是一个已经发生过的死功能
//
// git-graph 的分支下拉框 gate 在 `Array.isArray(status.branches)` 上，checkout
// 又从下拉框的 value 取分支名。而 `gitStatus` 以前只返回
// `{ current, tracking, files }` —— **没有 `branches`**。于是下拉框永远渲染
// "(no branches)"，checkout 永远走不到：repo 加载成功、commit 图画出来、
// 状态栏一切正常，只是**切不了分支**。没有任何一层报错，因为"字段不存在"在
// JS 里不是错误。
//
// 症状之所以能活下来，是因为它是"读源码列字段"这种检查天然看不见的：写一个
// "handler 返回了这些 key"的断言时，人会照着自己以为的契约写，于是断言和实现
// 一起错。**所以这里不写字段清单断言，而是拿真 repo 调真 handler**，看它到底
// 返回什么 —— `branches` 是不是真在结果里，由 simple-git 说了算。
//
// `simple-git` 是既有依赖，git-graph 的 `getSimpleGit()` 本来就调它，所以这条
// 不引入新依赖、不需要网络（本地临时 repo）。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_GRAPH_KIND } from './git-graph';

type Handler = (p: unknown, c: unknown) => Promise<Record<string, unknown>>;
type Result = Record<string, unknown>;

const call = (name: string): Handler =>
  GIT_GRAPH_KIND.methods.find((m) => m.name === name)!.handler as Handler;

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

describe('git.status returns the branch list the app UI gates on', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'miniapp-git-branches-'));
    // 显式指定分支名：不同 git 版本的 init 默认名不同（master / main），
    // 让它自己选会让断言在不同机器上飘。这里锁死 `main`。
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'probe@example.invalid');
    git(repo, 'config', 'user.name', 'probe');
    writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-qm', 'first');
    git(repo, 'checkout', '-qb', 'feature-x');
    writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    git(repo, 'add', 'b.txt');
    git(repo, 'commit', '-qm', 'second');
    git(repo, 'checkout', '-q', 'main');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const ctx = (): unknown => ({ appId: 'probe', fsScope: { read: [`${repo}/**`], write: [] } });

  it('includes branches, and the repo really has more than one', async () => {
    // 先钉住前提：repo 只有一个分支的话，"返回了 branches" 可能只是返回了
    // 一个单元素数组，测不出"漏掉了别的分支"。git 自己的输出是权威。
    const fromGit = git(repo, 'branch', '--format=%(refname:short)').trim().split(/\r?\n/).filter(Boolean);
    expect(fromGit.sort(), '测试 repo 应该有两个分支，否则下面那条测不出东西').toEqual(['feature-x', 'main']);

    const res: Result = await call('git.status')({ cwd: repo }, ctx());

    // 精确比内容而不是"含有 branches"：app 的下拉框要列出**所有**分支，
    // 少一个就是又一处静默的半死功能。
    expect(res.branches, 'git.status 没返回 branches —— 分支下拉框会是空的').toEqual(fromGit.sort());
  });

  it('still returns the fields the app reads alongside branches', async () => {
    // 修 branches 时最容易把别的字段挤掉。这几个是 app 真正读的：
    // `current` 用来标 "(current)"，`files` 用来画状态。
    const res: Result = await call('git.status')({ cwd: repo }, ctx());
    expect(res.current).toBe('main');
    expect(Array.isArray(res.files)).toBe(true);
    expect(Object.hasOwn(res, 'tracking')).toBe(true);
  });
});
