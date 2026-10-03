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

/**
 * 作者自报 `timeout_ms` 的闸。
 *
 * 断言打在这里而不是纯函数上，是因为这个 mock 抓到的 `timeoutMs` 就是
 * `runInjectedTurn` 真正拿去算 `deadline` 的那个数，再往下就进
 * `waitForDeadline` 的 `setTimeout`。只测纯函数的话，有人把调用点改回
 * `p.timeoutMs ?? DEFAULT` 时测试照样全绿，闸静默消失。
 */
describe('runMiniAppAgentTurn timeout contract', () => {
  function timeoutSeenBy(): number {
    // mock 声明成零参，所以 calls 的元组是 `[]`；先落到 unknown 再取第一个实参。
    const call = runInjectedTurnMock.mock.calls[0] as unknown as [{ timeoutMs: number }];
    return call[0].timeoutMs;
  }

  it('clamps a 24-day request down to the 1h ceiling', async () => {
    // 2^31-1ms ≈ 24.8 天，Node 的 setTimeout 原样接受，于是 turn 永不 settle。
    await runMiniAppAgentTurn(baseParams({ timeoutMs: 2 ** 31 - 1 }));
    expect(timeoutSeenBy()).toBe(60 * 60 * 1000);
  });

  it('clamps 0 and negatives up to the floor instead of treating them as unbounded', async () => {
    // 这层 sink 的语义与 `cancellableFetch` **相反**：`timeoutMs <= 0` 在
    // `waitForDeadline` 里是"立即超时"。所以 0 在这里不是危险值，仍夹住是为了
    // 让三个兄弟入口的边界一致、且不把一个立刻失败的值送给作者。
    await runMiniAppAgentTurn(baseParams({ timeoutMs: 0 }));
    expect(timeoutSeenBy()).toBe(1_000);
  });

  it('keeps the 5min default when the author says nothing, and honours an in-range value', async () => {
    await runMiniAppAgentTurn(baseParams());
    expect(timeoutSeenBy()).toBe(300_000);

    runInjectedTurnMock.mockClear();
    await runMiniAppAgentTurn(baseParams({ timeoutMs: 900_000 }));
    // 15min 必须原样保留：agent turn 是带工具的 LLM 回合，跑满 5min 很常见，
    // 按 5min 上限夹会打断合法长回合 —— 这是它与 shell/net 唯一不同的地方。
    expect(timeoutSeenBy()).toBe(900_000);
  });
});
