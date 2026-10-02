// miniapp-ai-abort.unit.test.ts — `app.ai.cancel` 的在途请求注册表（纯逻辑）。
//
// 与 `miniapp-ai-cancel.unit.test.ts` 分开是因为**依赖面**不同：
//   - 本文件只测寻址逻辑（哪个 runId 命中哪个 controller），零 I/O、零 SDK。
//   - 那个文件要驱动 `runMiniAppAiComplete` 走完整路径，必须 mock 掉 SDK 与
//     agent-session；那组 mock 在本仓库的 vitest 配置下拿不到干净的隔离，
//     容易退化成"看起来在测、其实在等真实超时"的假测试。
//
// 中止注册表因此被抽成一个可独立测试的纯模块（见 miniapp-ai-abort.ts）：
// 它本来就该独立 —— 有状态的生命周期管理与"怎么发起一次补全"是两个关注点，
// 混在一个文件里正是它们无法分别测试的原因。

import { beforeEach, describe, expect, it } from 'vitest';

import {
  cancelCall,
  countForApp,
  registerCall,
  releaseCall,
  resetAll,
  shiftStartTimeForTest,
} from './miniapp-ai-abort';

beforeEach(() => {
  resetAll();
});

/** 登记一个在途调用，返回它的 controller 供断言。 */
function register(appId: string, runId: string): AbortController {
  return registerCall(appId, runId);
}

describe('register / cancel addressing', () => {
  it('cancels exactly the run that was named', () => {
    // 中止错了对象比不能中止更糟：作者以为停了 A，实际停了 B，
    // 而 A 继续烧用户的 token。
    const a = register('app-x', 'run-A');
    const b = register('app-x', 'run-B');

    expect(cancelCall('app-x', 'run-A').cancelled).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });

  it('never crosses app boundaries even with an identical runId', () => {
    // 两个 MiniApp 都会用 'default' / 'main' 这类默认 runId
    const mine = register('app-mine', 'default');
    const theirs = register('app-theirs', 'default');

    expect(cancelCall('app-mine', 'default').cancelled).toBe(true);
    expect(mine.signal.aborted).toBe(true);
    expect(theirs.signal.aborted).toBe(false);
  });

  it('reports false rather than throwing when nothing matches', () => {
    // 作者在请求完成后再 cancel 是网络往返的必然结果，不是异常
    expect(cancelCall('app-x', 'ghost')).toEqual({ cancelled: false, inflightCount: 0 });
  });

  it('is idempotent across repeated cancels', () => {
    register('app-x', 'run-1');
    expect(cancelCall('app-x', 'run-1').cancelled).toBe(true);
    expect(cancelCall('app-x', 'run-1').cancelled).toBe(false);
  });

  it('reports how many calls remain for that app after a cancel', () => {
    register('app-x', 'r1');
    register('app-x', 'r2');
    register('app-x', 'r3');
    expect(cancelCall('app-x', 'r2')).toEqual({ cancelled: true, inflightCount: 2 });
  });

  it('counts only the queried app, not every app in the process', () => {
    register('app-x', 'r1');
    register('app-y', 'r1');
    register('app-y', 'r2');
    // 全局有 3 个在途，但 app-x 名下只有 1 个 —— 报总数会让作者误判自己的负载
    expect(cancelCall('app-x', 'r1').inflightCount).toBe(0);
    expect(countForApp('app-y')).toBe(2);
  });

  it('forgets a run once it settles so the map cannot grow unbounded', () => {
    register('app-x', 'r1');
    releaseCall('app-x', 'r1');
    expect(cancelCall('app-x', 'r1').cancelled).toBe(false);
  });

  it('re-registering the same key replaces the previous controller', () => {
    // 同 key 重复登记时，旧 controller 早已失去意义；保留它会让 cancel 打到
    // 一个没有任何人在等的句柄上，真正的请求反而停不下来。
    const first = register('app-x', 'r1');
    const second = register('app-x', 'r1');
    expect(cancelCall('app-x', 'r1').cancelled).toBe(true);
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
  });

  it('aborts every outstanding controller on reset', () => {
    // 进程退出 / 测试隔离时用；漏掉会让 mock 的 controller 永远挂着
    const a = register('app-x', 'r1');
    const b = register('app-y', 'r1');
    resetAll();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(countForApp('app-x')).toBe(0);
  });

  it('prunes entries older than the TTL without touching fresh ones', () => {
    // 长驻进程里，一个永不 settle 的补全不该让注册表单调增长
    const old = register('app-x', 'old');
    const fresh = register('app-x', 'fresh');
    shiftStartTimeForTest('app-x', 'old', Date.now() - 60 * 60_000);
    cancelCall('app-x', 'nothing-matches');
    // 触发剪枝后只剩 fresh
    expect(countForApp('app-x')).toBe(1);
    // 剪枝不等于中止：被剪掉的条目没有人在等，abort 它只会制造噪声
    expect(fresh.signal.aborted).toBe(false);
    expect(old.signal.aborted).toBe(false);
    expect(cancelCall('app-x', 'fresh').cancelled).toBe(true);
  });
});
