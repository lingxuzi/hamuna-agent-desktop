//
// 回归护栏：`app.agent.run` / `turnText` / `cancel` 必须发到 **MiniApp 自己的
// sidecar**，而不是默认的全局 sidecar。
//
// 为什么这条值得单独占一个文件：Agent 回合在 sidecar 侧是用**本进程**的
// `getCurrentSessionContext().sessionId` 决定跑在哪个会话的，而事件订阅挂在
// `cmd_miniapp_ensure_session` 起的那个专用 sidecar 的 SSE 上。两处一旦分家，
// 同一个缺陷会同时表现成三个互不相干的现象：
//
//   1. `agent.onEvent` 永远收不到 delta/complete —— "注册成功但没有事件"；
//   2. MiniApp（第三方代码）的提示词与产出写进**用户的全局会话历史**；
//   3. `agent.cancel` 静默停不下来 —— abort registry 是进程内状态。
//
// 没有任何一个现象会指向"发错进程了"，所以必须由一条直接断言 URL 的护栏兜住。
// 名单类测试（app-parity）与权限闸门测试都看不到这里：它们从没检查过
// 请求最终落到哪个进程。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBridge } from './agentEventBridge';
import { createAppDispatcher } from './appHostDispatch';
import { APP_ERROR_CODES } from '../../../shared/miniapp/app-protocol';

const { apiPostJsonMock, proxyFetchMock } = vi.hoisted(() => ({
  apiPostJsonMock: vi.fn(),
  proxyFetchMock: vi.fn(),
}));

// 全局 sidecar 通道。Agent 回合一旦走到这里，就是本文件要防的缺陷。
vi.mock('@/api/apiFetch', () => ({ apiPostJson: apiPostJsonMock }));
// 专用 sidecar 通道。
vi.mock('@/api/tauriClient', () => ({ proxyFetch: proxyFetchMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));

const MINIAPP_PORT = 51234;

function makeBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
  return {
    setPost: vi.fn(),
    ensureSession: vi.fn(async () => ({ sessionId: 'miniapp_demo_main', port: MINIAPP_PORT })),
    subscribe: vi.fn(async () => () => {}),
    release: vi.fn(async () => {}),
    ...overrides,
  };
}

function sidecarResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

function agentUrl(method: string): string {
  return `http://127.0.0.1:${MINIAPP_PORT}/api/miniapp/app/${method}`;
}

beforeEach(() => {
  apiPostJsonMock.mockReset();
  proxyFetchMock.mockReset();
  proxyFetchMock.mockResolvedValue(sidecarResponse({ ok: true, result: { text: 'ok' } }));
});

describe('appHostDispatch: agent turns target the MiniApp sidecar', () => {
  it.each(['agent.run', 'agent.turnText', 'agent.cancel'])(
    '%s posts to the MiniApp sidecar, never to the global sidecar',
    async (method) => {
      const bridge = makeBridge();
      const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

      const res = await dispatch(method, { prompt: 'hi', run_id: 'r1' });

      expect(res).toEqual({ ok: true, result: { text: 'ok' } });
      expect(proxyFetchMock).toHaveBeenCalledTimes(1);
      expect(proxyFetchMock.mock.calls[0][0]).toBe(agentUrl(method));
      // 全局 sidecar 一次都不能碰：碰了就是回合跑进用户全局会话。
      expect(apiPostJsonMock).not.toHaveBeenCalled();
    },
  );

  it('carries appId and the original params so the sidecar re-checks permissions', async () => {
    const bridge = makeBridge();
    const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

    await dispatch('agent.run', { prompt: 'hi', run_id: 'r1' });

    const init = proxyFetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      appId: 'demo',
      params: { prompt: 'hi', run_id: 'r1' },
    });
  });

  it('ensureSession asks the bridge first so the turn reuses that exact session', async () => {
    const bridge = makeBridge();
    const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

    const res = await dispatch('agent.run', { prompt: 'hi' });

    // 第二个参数是 appDataWorkspace。`undefined` 表示"作者没表达偏好"，与显式
    // 请求 appdata 根（`''`）对 bridge 的含义不同，所以这里断的是 undefined 本身。
    expect(bridge.ensureSession).toHaveBeenCalledWith('main', undefined);
    // ensureSession 返回的 port 必须被 run 用上 —— 这就是"同一个会话"的全部含义。
    expect(proxyFetchMock.mock.calls[0][0]).toContain(String(MINIAPP_PORT));
    expect(res.ok).toBe(true);
  });

  it('without a bridge it fails loudly instead of silently using the global sidecar', async () => {
    const dispatch = createAppDispatcher('demo');

    const res = await dispatch('agent.run', { prompt: 'hi' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error.code).toBe('HOST_ERROR');
    expect(apiPostJsonMock).not.toHaveBeenCalled();
  });

  it('a failing bridge surfaces as an error envelope and never throws', async () => {
    const bridge = makeBridge({
      ensureSession: vi.fn(async () => {
        throw new Error('sidecar refused to start');
      }),
    });
    const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

    const res = await dispatch('agent.run', { prompt: 'hi' });

    expect(res).toEqual({
      ok: false,
      error: { code: 'HOST_ERROR', message: 'sidecar refused to start' },
    });
  });

  it('an unreachable sidecar becomes NETWORK_ERROR, not a hung promise', async () => {
    proxyFetchMock.mockRejectedValue(new Error('connection refused'));
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('agent.run', { prompt: 'hi' });

    expect(res).toEqual({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'connection refused' },
    });
  });

  it("preserves the sidecar's own error code instead of flattening it to HOST_ERROR", async () => {
    proxyFetchMock.mockResolvedValue(
      sidecarResponse({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'agent disabled' } }),
    );
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('agent.run', { prompt: 'hi' });

    expect(res).toEqual({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'agent disabled' },
    });
  });
});

describe('appHostDispatch: session lifecycle stays renderer-side', () => {
  it('agent.ensureSession answers from the bridge and hits no HTTP route', async () => {
    const bridge = makeBridge();
    const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

    const res = await dispatch('agent.ensureSession', null);

    // 完整形状由下面那条 camelCase 别名用例断言；这里只关心"谁来答"和"没走 HTTP"。
    expect(res).toMatchObject({ ok: true, result: { session_id: 'miniapp_demo_main' } });
    expect(apiPostJsonMock).not.toHaveBeenCalled();
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it('ensureSession exposes the camelCase alias the reference reads', async () => {
    // 参考文档写的是 `session.sessionId`。只回 session_id 的话，照文档写的作者
    // 拿到 undefined，然后把它回传给 run —— 一路 undefined 传下去。
    // `app_data_workspace: null` 是"作者没挑子目录，用 appdata 根"，与 undefined
    // 区分：后者会让人以为读错了字段。
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('agent.ensureSession', null);

    expect(res).toEqual({
      ok: true,
      result: {
        session_id: 'miniapp_demo_main',
        sessionId: 'miniapp_demo_main',
        app_data_workspace: null,
      },
    });
  });

  it('agent.onEvent returns the same session shape as ensureSession', async () => {
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('agent.onEvent', null);

    // onEvent 没有 appDataWorkspace 入参，所以**不得**多出那个字段。
    // 反向护栏：这里若也长出 app_data_workspace，说明分支共用错了。
    expect(res).toEqual({
      ok: true,
      result: { session_id: 'miniapp_demo_main', sessionId: 'miniapp_demo_main' },
    });
  });

  it('echoes the normalized appDataWorkspace instead of dropping it', async () => {
    // ensureSession 在 renderer 里就地截走，请求**不会**到 sidecar。参数若被
    // 吞掉，作者会以为挑了子目录，下一个 run 实际静默跑在 appdata 根上。
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('agent.ensureSession', { appDataWorkspace: '  notes  ' });

    expect(res).toEqual({
      ok: true,
      result: {
        session_id: 'miniapp_demo_main',
        sessionId: 'miniapp_demo_main',
        app_data_workspace: 'notes',
      },
    });
  });

  it('rejects an illegal appDataWorkspace at ensureSession, before any session is created', async () => {
    const bridge = makeBridge();
    const dispatch = createAppDispatcher('demo', { agentBridge: bridge });

    const res = await dispatch('agent.ensureSession', { appDataWorkspace: '../escape' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error.code).toBe('INVALID_PARAMS');
    // 校验没过就不该去起 sidecar —— 非法名字不该留下一个空跑的后台进程。
    expect(bridge.ensureSession).not.toHaveBeenCalled();
  });

  it('forwards appDataWorkspace verbatim to the sidecar on run', async () => {
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    await dispatch('agent.run', { prompt: 'hi', appDataWorkspace: 'notes' });

    const init = proxyFetchMock.mock.calls[0][1] as RequestInit;
    // sidecar 那边要自己再判一次：renderer 是 WebView，它的判定不是唯一信任源。
    expect(JSON.parse(init.body as string).params).toEqual({
      prompt: 'hi',
      appDataWorkspace: 'notes',
    });
  });

  it('non-agent methods still use the global sidecar', async () => {    apiPostJsonMock.mockResolvedValue({ ok: true, result: { isFile: true } });
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('fs.stat', { path: 'a.txt' });

    expect(res).toEqual({ ok: true, result: { isFile: true } });
    expect(apiPostJsonMock).toHaveBeenCalledTimes(1);
    expect(apiPostJsonMock.mock.calls[0][0]).toBe('/api/miniapp/app/fs.stat');
    // 反向护栏：只有 agent.* 被改道，其它能力族不许被顺手带偏。
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});

describe('appHostDispatch: the generic sidecar channel answers every failure in-band', () => {
  // 本文件已有的错误路径测试（L105/L131/L143）打的是 agent.* 专用通道
  // （dispatchAgentTurn / dispatchAgentHost）。createAppDispatcher 里
  // `apiPostJson` 之后那几支 —— 通用能力族（fs / shell / net / storage / os）
  // 的 "ok:false" 与 "请求抛异常" —— 此前是零覆盖的，而那正是 MiniApp 作者最常撞到的
  // 失败形态：sidecar 已经不在了。
  //
  // 契约：dispatch 永不 reject，永远回 `{ok:false,error}`。调用方是第三方作者写的
  // iframe 代码，一个 unhandled rejection 在那里表现为"静默卡住"，作者拿不到任何原因。

  it('a sidecar refusal keeps the sidecar error code instead of flattening it', async () => {
    apiPostJsonMock.mockResolvedValue({
      ok: false,
      error: { code: APP_ERROR_CODES.PERMISSION_DENIED, message: 'fs.read is not granted' },
    });
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('fs.read', { path: 'a.txt' });

    expect(res).toEqual({
      ok: false,
      error: { code: APP_ERROR_CODES.PERMISSION_DENIED, message: 'fs.read is not granted' },
    });
  });

  it('a refusal carrying no error field still answers with a readable envelope', async () => {
    // 兜底不能塌成 undefined —— 作者要在 UI 上拿得到一个能显示的 code + message。
    apiPostJsonMock.mockResolvedValue({ ok: false });
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('fs.read', { path: 'a.txt' });

    expect(res).toEqual({
      ok: false,
      error: { code: APP_ERROR_CODES.HOST_ERROR, message: 'dispatch failed' },
    });
  });

  it('an unreachable sidecar becomes NETWORK_ERROR carrying the original message', async () => {
    apiPostJsonMock.mockRejectedValue(new Error('Failed to fetch'));
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('fs.read', { path: 'a.txt' });

    expect(res).toEqual({
      ok: false,
      error: { code: APP_ERROR_CODES.NETWORK_ERROR, message: 'Failed to fetch' },
    });
  });

  it('a non-Error rejection is stringified rather than surfacing as undefined', async () => {
    // 代理层在部分失败形态下 reject 的不是 Error 实例。`e instanceof Error` 为假时若
    // 少了 String(e) 兜底，作者在界面上看到的就是字面量 "undefined"。
    apiPostJsonMock.mockRejectedValue('socket hang up');
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    const res = await dispatch('fs.read', { path: 'a.txt' });

    expect(res).toEqual({
      ok: false,
      error: { code: APP_ERROR_CODES.NETWORK_ERROR, message: 'socket hang up' },
    });
  });

  it('the failure never reroutes onto the agent sidecar channel', async () => {
    apiPostJsonMock.mockRejectedValue(new Error('down'));
    const dispatch = createAppDispatcher('demo', { agentBridge: makeBridge() });

    await dispatch('fs.read', { path: 'a.txt' });

    // 反向护栏：catch 里若顺手改走 proxyFetch，"fs 请求失败"会变成"打到了 agent 专用
    // sidecar 上"，症状与本文件头描述的三种分家故障一模一样。
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it('agent.ensureSession with no bridge fails loudly instead of falling through', async () => {
    const dispatch = createAppDispatcher('demo'); // 刻意不传 agentBridge

    const res = await dispatch('agent.ensureSession', {});

    expect(res).toEqual({
      ok: false,
      error: {
        code: APP_ERROR_CODES.HOST_ERROR,
        message: expect.stringContaining('agent bridge'),
      },
    });
    // 不允许退化成"发去全局 sidecar"：那正是把 MiniApp 回合写进用户全局会话的起点。
    expect(apiPostJsonMock).not.toHaveBeenCalled();
  });
});
