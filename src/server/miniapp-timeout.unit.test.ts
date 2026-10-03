import { describe, expect, it } from 'vitest';

import { resolveMiniAppTimeoutMs } from './miniapp-app-dispatch';

/**
 * timeout 是 MiniApp 自己传的，而两个 sink 对 0 / 巨型值的解释都不安全：
 * `shell.exec` 把它交给 `run()`，Node 把 0 读成"永不超时"；`net.fetch` 把它
 * 交给 `setTimeout`，2^31-1 以内照单全收。
 *
 * 不夹住它的后果不是"跑得久一点"，是一个 sidecar 永远不回收、abort 也不杀的
 * 子进程，或一条挂满一天的请求 —— 所以这里逐个钉住边界，而不是只测一个"正常值"。
 *
 * 这条夹取**只**发生在 MiniApp 边界。`cancellableFetch` 本体刻意不设上限：它同时
 * 服务 tool-attachments / kb-ingest / provider-probe，那些地方要下大文件，5min
 * 上限会把正常下载打断。所以断掉这两个调用点的人会静默失去这道闸，而下面
 * `miniapp-net-timeout` 那条 integration 才是真正钉住"调用点还在"的。
 */
describe('resolveMiniAppTimeoutMs', () => {
  it('不传 / 传垃圾 → 30s 默认', () => {
    expect(resolveMiniAppTimeoutMs(undefined)).toBe(30_000);
    expect(resolveMiniAppTimeoutMs(null)).toBe(30_000);
    expect(resolveMiniAppTimeoutMs('5000')).toBe(30_000);
    expect(resolveMiniAppTimeoutMs({})).toBe(30_000);
    expect(resolveMiniAppTimeoutMs(Number.NaN)).toBe(30_000);
    expect(resolveMiniAppTimeoutMs(Number.POSITIVE_INFINITY)).toBe(30_000);
  });

  it('timeout: 0 不等于"永不超时" —— Node 就是这么解释的', () => {
    // 这是最危险的一个值：作者大概以为"0 = 用默认"，实际换来的分两种：
    // shell.exec 得到一个永远不 settle 的子进程；net.fetch 更干脆 ——
    // cancellableFetch 的闸是 `timeoutMs > 0`，于是 0 意味着**根本不设定时器**。
    expect(resolveMiniAppTimeoutMs(0)).toBe(1_000);
  });

  it('负数同样被抬到下限，而不是透传给 Node', () => {
    expect(resolveMiniAppTimeoutMs(-1)).toBe(1_000);
    expect(resolveMiniAppTimeoutMs(-999_999)).toBe(1_000);
  });

  it('超大值被压到 5min 上限，MiniApp 不能钉住进程', () => {
    expect(resolveMiniAppTimeoutMs(2 ** 31 - 1)).toBe(300_000);
    expect(resolveMiniAppTimeoutMs(999_999_999)).toBe(300_000);
  });

  it('一整天这种"看起来很合理"的值同样被压住', () => {
    // 这是 net.fetch 的实际受害值：86400000 远在 2^31-1 以内，Node 原样接受，
    // 请求就真的挂满一天。没有实测过很难相信"作者填个 1 天"能成立。
    expect(resolveMiniAppTimeoutMs(86_400_000)).toBe(300_000);
    expect(resolveMiniAppTimeoutMs(3_600_000)).toBe(300_000);
  });

  it('范围内的值原样保留（截断小数），作者仍能要更短的超时', () => {
    expect(resolveMiniAppTimeoutMs(5_000)).toBe(5_000);
    expect(resolveMiniAppTimeoutMs(120_000)).toBe(120_000);
    expect(resolveMiniAppTimeoutMs(1_500.9)).toBe(1_500);
  });
});
