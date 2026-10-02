/**
 * `app.ai.complete` 在途请求的中止注册表。
 *
 * ## 为什么要独立成文件
 *
 * 它是**有状态的生命周期管理**，而"怎么发起一次 AI 补全"是 I/O。两者混在
 * `miniapp-ai.ts` 里时，中止逻辑只能靠 mock 掉整个 SDK 才能测 —— 而本仓库的
 * vitest 配置下那组 mock 拿不到干净隔离，很容易退化成"看起来在测、其实在等
 * 真实超时"的假测试。拆开后寻址逻辑可以纯逻辑单测，覆盖真实的并发/隔离场景。
 *
 * ## 寻址规则
 *
 * key 是 `<appId>:<runId>` 而不是只用 appId。同一 MiniApp 并发起多个补全是
 * 常见写法（并行分类），只按 appId 记会让 cancel 命中"最近一个"——中止错了
 * 对象比不能中止更糟：作者以为停了 A，实际停了 B，而 A 继续烧用户的 token。
 */

/** 兜底清理阈值：进程内残留的 controller 只是内存，不会泄漏到磁盘。 */
const INFLIGHT_TTL_MS = 10 * 60_000;

interface InflightCall {
  controller: AbortController;
  appId: string;
  startedAt: number;
}

const inflight = new Map<string, InflightCall>();

function key(appId: string, runId: string): string {
  return `${appId}:${runId}`;
}

/**
 * 登记一个在途调用，返回它的 controller。
 *
 * 同 key 重复登记会**替换**旧 controller 而不 abort 它：旧的那次要么已经 settle
 * （`releaseCall` 应该已摘除），要么是重复发起的误操作 —— 无论哪种，abort 一个
 * 已经没人等待的句柄都没有意义，而保留它会让 cancel 打到空句柄上、真正在跑的
 * 请求反而停不下来。
 */
export function registerCall(appId: string, runId: string): AbortController {
  pruneExpired(Date.now());
  const controller = new AbortController();
  inflight.set(key(appId, runId), { controller, appId, startedAt: Date.now() });
  return controller;
}

/** 调用 settle（成功 / 超时 / 抛错）后摘除，保证注册表不随调用次数单调增长。 */
export function releaseCall(appId: string, runId: string): void {
  inflight.delete(key(appId, runId));
}

/**
 * 中止指定 run。返回是否真的命中了一个在途请求。
 *
 * 未命中返回 false 而不抛错：作者在"请求已完成后再 cancel"是完全正常的时序
 * （网络往返的必然结果），把它当错误会逼每个调用点都写 try/catch。
 */
export function cancelCall(
  appId: string,
  runId: string,
): { cancelled: boolean; inflightCount: number } {
  pruneExpired(Date.now());
  const entry = inflight.get(key(appId, runId));
  if (!entry) return { cancelled: false, inflightCount: countForApp(appId) };
  inflight.delete(key(appId, runId));
  // abort 而非 kill：SDK 收到 abortSignal 后会走正常清理路径（关子进程、
  // 释放句柄）；直接丢引用会让 SDK subprocess 变成孤儿进程。
  entry.controller.abort();
  return { cancelled: true, inflightCount: countForApp(appId) };
}

/** 该 app 名下还有多少个在途调用。报总数会让作者误判自己的负载，故按 app 计。 */
export function countForApp(appId: string): number {
  let n = 0;
  for (const call of inflight.values()) if (call.appId === appId) n += 1;
  return n;
}

/** 清掉超过 TTL 的条目。永不 settle 的补全不该让注册表单调增长。 */
export function pruneExpired(now: number): void {
  for (const [k, call] of inflight) {
    if (now - call.startedAt > INFLIGHT_TTL_MS) inflight.delete(k);
  }
}

/** abort 全部并清空。进程退出与测试隔离用。 */
export function resetAll(): void {
  for (const call of inflight.values()) call.controller.abort();
  inflight.clear();
}

/** 测试专用：把某个条目的时间戳改旧，用于验证 TTL 剪枝。 */
export function shiftStartTimeForTest(appId: string, runId: string, startedAt: number): void {
  const entry = inflight.get(key(appId, runId));
  if (entry) entry.startedAt = startedAt;
}
