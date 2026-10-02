//
// 位置说明：本文件断言 shared 的协议名单与 renderer 的 runtime 门面一致，天然跨
// 进程边界。它曾放在 `src/shared/miniapp/`，但那会让 shared 反向依赖 renderer ——
// dependency-cruiser 的 `shared-stays-pure` 会拦（shared 被前后端同时打包，
// 一旦它拉进 renderer 代码就会把 React / DOM 拖进 sidecar bundle）。协议侧只
// 作为数据源被 import，方向是 renderer → shared，合法。
// 「声明的方法都有生产者」这条不变量的可执行版本。
//
// 这不是又一份方法清单测试，而是对**清单本身的结构**加护栏。本项目踩过三次
// 同样的坑：能力在文档 / 协议 / runtime 里都存在，宿主却没有真实生产者
// （onActivate / onDeactivate 无推送、ai.cancel 无中止点、agent.onEvent 无事件
// 源）。每次都是靠人工审计发现的，而人工审计不会在下次加方法时自动重跑。
//
// 声明在三处，任何一处漂移都不会编译报错：
//   1. `APP_METHODS`            —— 协议层名单（作者能调什么）
//   2. `buildAppRuntimeScript`  —— 注入 iframe 的 runtime 门面（作者怎么调）
//   3. `dispatchMiniAppApp`     —— 执行层路由（调了会发生什么）
//
// 第 3 处尤其危险：它按 **group** 分派，组内 method 名走各自的 switch。所以
// 名单里加一个 `fs.foo` 而忘了在 dispatchFs 里加 case，类型系统完全沉默，
// 作者只在运行时拿到一句 "Unknown fs method"。这里把它变成编译期可见的失败。

import { describe, expect, it } from 'vitest';

import { APP_METHODS, isKnownAppMethod, listAppMethods } from '../../../shared/miniapp/app-protocol';

/**
 * runtime 脚本里出现的 `dispatch('<group>.<name>', ...)` 字面量。
 *
 * 直接从源码正则抽取，而不是维护一份"runtime 支持什么"的副本：副本必然漂移，
 * 而漂移正是本文件要消灭的东西。runtime 是一个模板字符串，只能按文本匹配 ——
 * 代价是 runtime 重命名会误报，那属于**应该**被注意到的改动。
 */
function runtimeDispatchTargets(source: string): Set<string> {
  return new Set([...source.matchAll(/dispatch\('([a-z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]));
}

describe('app capability parity', () => {
  it('every declared method exists in the injected runtime facade', async () => {
    const { buildAppRuntimeScript } = await import('./appRuntimeScript');
    const targets = runtimeDispatchTargets(buildAppRuntimeScript('parity-probe'));
    const missing = listAppMethods().filter((m) => !targets.has(m));
    expect(missing).toEqual([]);
  });

  it('the runtime dispatches nothing that is not a declared method', async () => {
    // 反向同样重要：runtime 里多出一个 dispatch 而协议层没声明，意味着宿主
    // 会以 UNKNOWN_METHOD 拒绝它 —— 作者能看见函数，调用必失败。
    const { buildAppRuntimeScript } = await import('./appRuntimeScript');
    const targets = runtimeDispatchTargets(buildAppRuntimeScript('parity-probe'));
    const undeclared = [...targets].filter((m) => !isKnownAppMethod(m));
    expect(undeclared).toEqual([]);
  });

  it('isKnownAppMethod agrees with the declared list in both directions', () => {
    // isKnownAppMethod 是宿主 fail-closed 的闸门。它若对名单里的方法返回 false，
    // 能力就是"文档里有、宿主永远拒绝"。
    for (const m of listAppMethods()) {
      expect(isKnownAppMethod(m)).toBe(true);
    }
    for (const m of ['fs.nope', 'ai.exfiltrate', 'workspace.read', 'git.log', '']) {
      expect(isKnownAppMethod(m)).toBe(false);
    }
  });

  it('method groups match the documented namespace set', () => {
    // 组名进的是 permission policy 的 key（`checkAppPermission`），也是作者
    // 读文档时的第一层心智模型。多一个组就多一份必须同步的授权面。
    expect(Object.keys(APP_METHODS).sort()).toEqual([
      'agent',
      'ai',
      'call',
      'clipboard',
      'dialog',
      'fs',
      'net',
      'os',
      'shell',
      'storage',
    ]);
  });
});
