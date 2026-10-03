import { describe, expect, it } from 'vitest';

import { resolveShellTimeoutMs } from './miniapp-app-dispatch';

/**
 * timeout 是 MiniApp 自己传的，而 Node 把 `timeout: 0` 读成"永不超时"。
 * 不夹住它的后果不是"跑得久一点"，是一个 sidecar 永远不回收、abort 也不杀的
 * 子进程 —— 所以这里逐个钉住边界，而不是只测一个"正常值"。
 */
describe('resolveShellTimeoutMs', () => {
  it('不传 / 传垃圾 → 30s 默认', () => {
    expect(resolveShellTimeoutMs(undefined)).toBe(30_000);
    expect(resolveShellTimeoutMs(null)).toBe(30_000);
    expect(resolveShellTimeoutMs('5000')).toBe(30_000);
    expect(resolveShellTimeoutMs({})).toBe(30_000);
    expect(resolveShellTimeoutMs(Number.NaN)).toBe(30_000);
    expect(resolveShellTimeoutMs(Number.POSITIVE_INFINITY)).toBe(30_000);
  });

  it('timeout: 0 不等于"永不超时" —— Node 就是这么解释的', () => {
    // 这是最危险的一个值：作者大概以为"0 = 用默认"，实际换来的是一个
    // 永远不 settle 的子进程。
    expect(resolveShellTimeoutMs(0)).toBe(1_000);
  });

  it('负数同样被抬到下限，而不是透传给 Node', () => {
    expect(resolveShellTimeoutMs(-1)).toBe(1_000);
    expect(resolveShellTimeoutMs(-999_999)).toBe(1_000);
  });

  it('超大值被压到 5min 上限，MiniApp 不能钉住进程', () => {
    expect(resolveShellTimeoutMs(2 ** 31 - 1)).toBe(300_000);
    expect(resolveShellTimeoutMs(999_999_999)).toBe(300_000);
  });

  it('范围内的值原样保留（截断小数），作者仍能要更短的超时', () => {
    expect(resolveShellTimeoutMs(5_000)).toBe(5_000);
    expect(resolveShellTimeoutMs(120_000)).toBe(120_000);
    expect(resolveShellTimeoutMs(1_500.9)).toBe(1_500);
  });
});
