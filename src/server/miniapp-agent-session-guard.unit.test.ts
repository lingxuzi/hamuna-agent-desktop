//
// `app.agent.run` 的 sessionId 校验。
//
// 参考文档让作者把 `ensureSession()` 的返回值回传给 `run`：
//
//   const session = await app.agent.ensureSession({ sessionName: 'Market Lens' });
//   await app.agent.run('分析当前盘面。', { sessionId: session.sessionId });
//
// 本项目每个 MiniApp 只有一个 Agent 会话（Rust 按 miniapp_<appId>_<runId> 起
// 1:1 Sidecar），所以不按 id 选会话。但**静默忽略**同样不可接受：作者传一个
// 别的 MiniApp 的 sessionId 时，会拿到一段他自己无法解释来源的输出 —— 回合
// 照跑，只是跑在他没预期的会话里。
//
// 这条判定只能在这里测：它依赖"本进程绑的是哪个会话"这个进程内事实，
// 而 `miniapp-dispatch-routing.integration.test.ts` 把整个 `miniapp-agent`
// mock 掉了，在那边写断言只会复述 mock 自己的逻辑（等于没测）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const CURRENT_SESSION_ID = 'miniapp_demo_main';

const runInjectedTurnMock = vi.fn(async () => ({
  success: true,
  text: 'ok',
  assistantMessagePresent: true,
}));

vi.mock('./session-engine/selector', () => ({
  getSessionEngine: () => ({
    getCurrentSessionContext: () => ({ sessionId: CURRENT_SESSION_ID }),
    runInjectedTurn: runInjectedTurnMock,
  }),
  stopOwnedTurn: vi.fn(async () => ({ success: true })),
}));

const { runMiniAppAgentTurn } = await import('./miniapp-agent');

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'hello',
    workspacePath: '/tmp/demo',
    runId: 'default',
    ...overrides,
  } as Parameters<typeof runMiniAppAgentTurn>[0];
}

beforeEach(() => {
  runInjectedTurnMock.mockClear();
});

describe('runMiniAppAgentTurn sessionId contract', () => {
  it('runs when no sessionId is supplied', async () => {
    const res = await runMiniAppAgentTurn(baseParams());

    expect(res.ok).toBe(true);
    expect(runInjectedTurnMock).toHaveBeenCalledTimes(1);
  });

  it('runs when the sessionId matches the session this sidecar is bound to', async () => {
    const res = await runMiniAppAgentTurn(baseParams({ sessionId: CURRENT_SESSION_ID }));

    expect(res.ok).toBe(true);
    expect(runInjectedTurnMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a foreign sessionId instead of running anyway', async () => {
    const res = await runMiniAppAgentTurn(baseParams({ sessionId: 'miniapp_other_main' }));

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error?.code).toBe('INVALID_PARAMS');
    // 关键：拒绝之后**不能**还去跑这个 turn。
    expect(runInjectedTurnMock).not.toHaveBeenCalled();
  });

  it('the error names both ids so the author can see the mismatch', async () => {
    const res = await runMiniAppAgentTurn(baseParams({ sessionId: 'miniapp_other_main' }));

    expect(res.ok === false && res.error?.message).toContain('miniapp_other_main');
    expect(res.ok === false && res.error?.message).toContain(CURRENT_SESSION_ID);
  });

  it('an empty prompt is still rejected before any session check', async () => {
    const res = await runMiniAppAgentTurn(baseParams({ prompt: '   ' }));

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error?.code).toBe('INVALID_PARAMS');
    expect(runInjectedTurnMock).not.toHaveBeenCalled();
  });
});
