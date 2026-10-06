/**
 * `window.app.*` 跨 HTTP 接缝的**契约测试**。
 *
 * ## 为什么单独一个文件，而且不 mock `@/api/apiFetch`
 *
 * `appHostDispatch.unit.test.ts` 把 `@/api/apiFetch` 整个 mock 掉，直接让
 * `apiPostJson` 返回一个 `{ok:false, error:{...}}` 的对象。那个 mock 曾经
 * **不够真实**：真实的 `apiPostJson`（`apiFetch.ts:59`）在 `!response.ok` 时是
 * **throw**，不是返回。
 *
 * 这不是理论问题 —— 它真的发生过。sidecar 路由曾经对每一次 dispatch 失败回
 * **400**（`index.ts` 的 `outcome.ok ? 200 : 400`），于是：
 *
 *   1. `apiPostJson` throw；
 *   2. `createAppDispatcher` 只走得到 catch，`PERMISSION_DENIED` 被降级成
 *      `NETWORK_ERROR`；
 *   3. `buildApiError` 把 `error:{code,message}` 这个**对象**当字符串塞进
 *      `new Error()`，作者看到字面量 `"[object Object]"`。
 *
 * 真因和 code 一起消失。而 `app.agent.*` 走的是同一条路由，只是那条路用
 * `proxyFetch` 直读信封、不看状态码，所以一直是好的 —— 同一个失败，两种答案。
 *
 * 本文件只 mock **传输层**（`proxyFetch` / `isTauriEnvironment`），
 * `apiPostJson` 与 `createAppDispatcher` 都用生产实现，因此它是这条接缝上
 * 唯一会说真话的地方。
 *
 * ## 为什么还要钉一份源码绑定
 *
 * 路由住在 `src/server/index.ts` 里一大坨启动逻辑中间，而 dependency-cruiser
 * 禁止 `renderer` import `server`（CLAUDE.md「架构边界」），所以本文件只能
 * **复刻**路由产出的那个 Response。复刻会漂 —— 路由改回 400 时，这里不会红，
 * 除非有人在复刻里手动同步。
 *
 * 因此最后那节 `route contract` 直接读 `index.ts` 源码并把复刻钉在被复刻的
 * 那一���上。这不是"用 grep 代替测试"：行为断言在上面（对 renderer 半边），
 * 这条只负责让前提不漂。`miniapp-lifecycle.unit.test.ts` 对 appId 正则做的
 * 也是同一件事。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBridge } from './agentEventBridge';

const { proxyFetchMock } = vi.hoisted(() => ({ proxyFetchMock: vi.fn() }));

// 只 mock 传输。`apiPostJson` 走真实现 —— 它的 throw 行为正是本文件要钉的东西。
vi.mock('@/api/tauriClient', () => ({
  proxyFetch: proxyFetchMock,
  getGlobalServerUrlWithWait: async () => 'http://127.0.0.1:51234',
}));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));

const { createAppDispatcher } = await import('./appHostDispatch');

type DispatchOutcome = Awaited<ReturnType<ReturnType<typeof createAppDispatcher>>>;

/** 收窄失败信封；拿到成功分支就直接炸，避免断言"错误码"时静默通过。 */
function errorOf(res: DispatchOutcome): { code: string; message: string } {
  if (res.ok) throw new Error(`expected a failure envelope, got ${JSON.stringify(res)}`);
  return res.error;
}

/**
 * 复刻 `index.ts` 的 `jsonResponse(outcome)`：RPC 信道，**恒 200**，
 * 成败在 body 的 `ok` 里。信封的 `error` 是**对象** `{code,message}`。
 */
function makeRouteResponse(outcome: unknown): Response {
  return new Response(JSON.stringify(outcome), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 一次失败派发在真实链路上的完整样子。 */
const DENIED = {
  ok: false,
  error: { code: 'PERMISSION_DENIED', message: "fs.read is not granted: '/etc/passwd'" },
};

function makeBridge(): AgentBridge {
  return {
    setPost: vi.fn(),
    ensureSession: vi.fn(async () => ({ sessionId: 'miniapp_demo_main', port: 51234 })),
    subscribe: vi.fn(async () => () => {}),
    release: vi.fn(async () => {}),
  };
}

function dispatch() {
  return createAppDispatcher('demo', { agentBridge: makeBridge() });
}

beforeEach(() => {
  proxyFetchMock.mockReset();
});

describe('app.* failures survive the HTTP seam with their real code', () => {
  it('a denied call reaches the MiniApp as PERMISSION_DENIED, not NETWORK_ERROR', async () => {
    proxyFetchMock.mockResolvedValue(makeRouteResponse(DENIED));

    const res = await dispatch()('fs.read', { path: '/etc/passwd' });

    // 作者要靠 code 分支处理"没权限"（提示去 Settings 开权限）。若这里变成
    // NETWORK_ERROR，作者只能看到一个网络错误文案，去错误的地方排查。
    expect(res.ok).toBe(false);
    expect(errorOf(res).code).toBe('PERMISSION_DENIED');
    expect(errorOf(res).message).toContain('fs.read is not granted');
  });

  it('never leaks "[object Object]" into an author-visible message', async () => {
    proxyFetchMock.mockResolvedValue(makeRouteResponse(DENIED));

    const message = errorOf(await dispatch()('fs.read', { path: '/etc/passwd' })).message;

    // 回归原点：`buildApiError` 读 `errorData.error` 当字符串用。路由一旦把
    // 这个 400 放回来，作者看到的就是字面量 "[object Object]"，
    // `serverMessage` 又因为 `message` 嵌在 `error` 里而取到 undefined ——
    // 真因和 code 一起消失。
    expect(message).not.toBe('[object Object]');
    expect(message.length).toBeGreaterThan(0);
  });

  it('an unknown method keeps UNKNOWN_METHOD across the seam', async () => {
    proxyFetchMock.mockResolvedValue(
      makeRouteResponse({
        ok: false,
        error: { code: 'UNKNOWN_METHOD', message: "Unknown fs method 'nope'" },
      }),
    );

    const res = errorOf(await dispatch()('fs.nope', {}));

    expect(res.code).toBe('UNKNOWN_METHOD');
    expect(res.message).toContain('Unknown fs method');
  });

  it('a success response is unaffected by the failure-path contract', async () => {
    // 正向护栏：改失败路径时最容易把 200 也一起改坏。
    proxyFetchMock.mockResolvedValue(
      makeRouteResponse({ ok: true, result: { isFile: true, size: 12 } }),
    );

    const res = await dispatch()('fs.stat', { path: 'a.txt' });

    expect(res).toEqual({ ok: true, result: { isFile: true, size: 12 } });
  });

  it('a genuinely unreachable sidecar still reports NETWORK_ERROR', async () => {
    // 反向护栏：修失败路径不等于取消 NETWORK_ERROR —— 真正的网络失败必须
    // 继续用它，否则"权限不足"和"sidecar 挂了"会再次同形。
    proxyFetchMock.mockRejectedValue(new Error('Failed to fetch'));

    const res = errorOf(await dispatch()('fs.read', { path: 'a.txt' }));

    expect(res.code).toBe('NETWORK_ERROR');
    expect(res.message).toBe('Failed to fetch');
  });

  it('posts the appId and params to the documented route', async () => {
    proxyFetchMock.mockResolvedValue(makeRouteResponse({ ok: true, result: null }));

    await dispatch()('fs.read', { path: 'a.txt' });

    const [url, init] = proxyFetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/miniapp/app/fs.read');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      appId: 'demo',
      params: { path: 'a.txt' },
    });
  });
});

describe('route contract: the sidecar must not re-encode `ok` into the HTTP status', () => {
  // 上面所有行为断言都建立在"路由恒回 200"这个前提上。前提变了它们不会红，
  // 所以在这里把它钉在源码上。改路由的人会先撞到这一条。
  const SERVER_INDEX = join(process.cwd(), 'src', 'server', 'index.ts');

  it('returns the dispatch outcome verbatim, with no status argument', () => {
    const src = readFileSync(SERVER_INDEX, 'utf8');
    const start = src.indexOf("pathname.startsWith('/api/miniapp/app/')");
    expect(start, 'route not found in index.ts').toBeGreaterThan(-1);
    // 截到下一个 route 起点为止。**必须包含那个 return 语句本身** —— 只截到它
    // 之前再去找 `jsonResponse(outcome,` 的话，违规文本正好落在被切掉的那一段，
    // 断言恒真（本文件第一版就踩了这个坑，变异验证时 M1 存活才发现）。
    const next = src.indexOf("if (pathname.startsWith(", start + 1);
    const routeBlock = src.slice(start, next === -1 ? src.length : next);

    // 曾经的写法：`jsonResponse(outcome, outcome.ok ? 200 : 400)`。
    expect(routeBlock).not.toMatch(/jsonResponse\(\s*outcome\s*,/);
    // 逐字返回：信封是协议本体，路由不得改写它（把 ok 拍平成 true 同样会让
    // 上面的行为断言失去意义）。
    expect(routeBlock).toContain('return jsonResponse(outcome);');
  });

  it('still rejects a malformed appId at the route with a 400', () => {
    // 反向护栏：RPC 恒 200 只适用于"请求被听懂了"。连 appId 都不合法时，
    // 那是一个 HTTP 层的坏请求，400 是对的，而且 `error` 是**字符串**，
    // 正好是 `buildApiError` 期待的形状（这是它与上面对象信封的刻意差异）。
    const src = readFileSync(SERVER_INDEX, 'utf8');
    expect(src).toContain('return jsonResponse({ ok: false, error: APP_ID_ERROR }, 400);');
  });
});
