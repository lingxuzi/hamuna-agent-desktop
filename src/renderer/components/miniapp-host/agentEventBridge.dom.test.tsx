/**
 * `app.agent.onEvent` 的端到端链路：SSE 事件 → host → iframe postMessage。
 *
 * ## 为什么这个链路值得单独测
 *
 * `app.agent.onEvent` 曾经是"暴露给作者却没有生产者"的空壳 API —— 注册成功、
 * 永远收不到事件。这类缺陷单测抓不到（每个零件都"正常"），只有把
 * **SSE 原始事件 → postMessage 负载**整条链接起来才能发现。
 *
 * 特别断言了 `type` 字段：实现里 `{kind, nonce, ...payload}` 的展开顺序一旦
 * 写反（`type` 放在 `...payload` 之后），payload 自带的 type 会被覆盖成
 * undefined，iframe 侧再也分不出 delta / complete —— 而 TS 不会报错。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEventPayload } from './agentEventBridge';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

/** 捕获 SseConnection 注册的事件处理器，测试直接往里灌事件。 */
let sseHandler: ((eventName: string, data: unknown, meta: unknown) => void) | null = null;
const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn(async () => {});
const isConnectedMock = vi.fn(() => true);

vi.mock('@/api/SseConnection', () => ({
  createSseConnection: () => ({
    setEventHandler: (fn: typeof sseHandler) => {
      sseHandler = fn;
    },
    setStatusHandler: () => {},
    connect: connectMock,
    disconnect: disconnectMock,
    isConnected: isConnectedMock,
  }),
}));

const { createAgentBridge } = await import('./agentEventBridge');

beforeEach(() => {
  sseHandler = null;
  invokeMock.mockReset();
  connectMock.mockClear();
  disconnectMock.mockClear();
  isConnectedMock.mockReturnValue(true);
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'cmd_miniapp_ensure_session') {
      return { session_id: 'miniapp_probe_main', port: 51999, owner_id: 'miniapp-agent:probe:main' };
    }
    if (cmd === 'cmd_miniapp_release_session') return true;
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 建一个已注入 post 的 bridge。
 *
 * `post` 走 `setPost` 而非构造参数：它的实现要读 `iframeRef.current`，而 bridge
 * 在 render 期构造，react-hooks/refs 不接受把 ref 交给渲染期调用的工厂。测试
 * 必须走与生产同一条注入路径，否则测的是一个不存在的 API 形态。
 */
function makeBridge(appId = 'probe', post: (payload: AgentEventPayload) => void = vi.fn()) {
  const bridge = createAgentBridge({ appId });
  bridge.setPost(post);
  return bridge;
}

describe('agentBridge: session lifecycle', () => {
  it('ensures exactly one sidecar even under concurrent callers', async () => {
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    // 并发去重：iframe 里连着调两次 ensureSession 不该起两个 Node 进程
    await Promise.all([bridge.ensureSession('main'), bridge.ensureSession('main')]);
    const ensureCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'cmd_miniapp_ensure_session',
    );
    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0][1]).toEqual({ appId: 'probe', runId: 'main' });
  });

  it('reuses the same session on a second ensure (no re-invoke)', async () => {
    const bridge = makeBridge('probe');
    const first = await bridge.ensureSession('main');
    const second = await bridge.ensureSession('main');
    // 落点是每次现造的对象，所以比的是它指向的会话与端口 —— 身份才是这条要守的。
    expect(second).toEqual(first);
    expect(first.sessionId).toBe('miniapp_probe_main');
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'cmd_miniapp_ensure_session')).toHaveLength(1);
  });

  it('releases the sidecar and the SSE connection on release()', async () => {
    const bridge = makeBridge('probe');
    await bridge.subscribe('main', vi.fn());
    await bridge.release();
    expect(disconnectMock).toHaveBeenCalled();
    expect(invokeMock.mock.calls.some((c) => c[0] === 'cmd_miniapp_release_session')).toBe(true);
  });

  it('does not start a sidecar until something actually asks for one', async () => {
    // 懒建立：Agent session = 一个真实 Node 进程，为从不使用 Agent 的 MiniApp
    // 常驻一个进程是纯浪费
    makeBridge('probe');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('agentBridge: SSE → iframe event forwarding', () => {
  it('forwards chat:message-chunk as agent.delta with the text intact', async () => {
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());
    expect(sseHandler).not.toBeNull();

    sseHandler?.('chat:message-chunk', '你好', {});

    // bridge 只负责产出事件负载；`kind: 'app.event'` 与 nonce 由 MiniAppRunner
    // 的 post 回调补上（那是"怎么进 iframe"的职责，不属于 bridge）。
    // 在这里断言 kind 会把两层职责焊死在一起。
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent.delta', text: '你好' }),
    );
  });

  it('keeps `type` intact instead of letting a later spread overwrite it', async () => {
    // 回归护栏：host 侧的 postMessage 载荷是 `{kind, nonce, ...payload}`。
    // 若把 `type` 写在展开之后，payload 自带的 type 会被覆盖成 undefined，
    // iframe 侧再也分不出事件种类 —— 而两种写法都能通过类型检查。
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());

    sseHandler?.('chat:message-chunk', 'x', {});
    sseHandler?.('chat:message-complete', {}, {});

    const types = post.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toEqual(['agent.delta', 'agent.complete']);
    expect(types.every((t) => typeof t === 'string')).toBe(true);
  });

  it('maps the terminal chat events onto distinct agent types', async () => {
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());

    sseHandler?.('chat:message-complete', {}, {});
    sseHandler?.('chat:message-stopped', null, {});
    sseHandler?.('chat:message-error', 'boom', {});

    const types = post.mock.calls.map((c) => (c[0] as { type?: string }).type);
    expect(types).toEqual(['agent.complete', 'agent.stopped', 'agent.error']);
    const errPayload = post.mock.calls[2][0] as { text?: string };
    expect(errPayload.text).toBe('boom');
  });

  it('does not forward unrelated chat events into the author-facing channel', async () => {
    // thinking / plan / context-usage 与 MiniApp 作者无关；转过去只会污染他
    // 注册的那个高频通道
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());

    sseHandler?.('chat:thinking-chunk', { thinking: 'hmm' }, {});
    sseHandler?.('chat:context-usage', { used: 1 }, {});
    sseHandler?.('chat:agent-plan-update', {}, {});

    expect(post).not.toHaveBeenCalled();
  });

  it('delivers to local subscribers as well as the iframe', async () => {
    // 本地先派发再推 iframe：iframe 尚未 ready 时本地监听器仍应收到
    const post = vi.fn();
    const received: string[] = [];
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', (p) => received.push(p.type));

    sseHandler?.('chat:message-chunk', 'a', {});
    expect(received).toEqual(['agent.delta']);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', async () => {
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    const off = await bridge.subscribe('main', vi.fn());
    sseHandler?.('chat:message-chunk', 'a', {});
    off();
    sseHandler?.('chat:message-chunk', 'b', {});
    // 退订后不得再推 —— 订阅已经不存在，iframe 却还在收事件是最难排查的一类：
    // 作者明明 off() 了，UI 还在动，看起来像"宿主没实现退订"。
    expect(post).toHaveBeenCalledTimes(1);
    // 且最后一个监听者离开就断 SSE，留着会一直占着 sidecar 的 client 槽位。
    expect(disconnectMock).toHaveBeenCalled();
  });

  it('survives a subscriber that throws without killing the channel', async () => {
    // 一个作者回调里的异常不该让整个事件通道静默死掉
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    const seen: string[] = [];
    await bridge.subscribe('main', () => {
      throw new Error('author bug');
    });
    await bridge.subscribe('main', (p) => seen.push(p.text ?? ''));

    expect(() => sseHandler?.('chat:message-chunk', 'ok', {})).not.toThrow();
    expect(seen).toEqual(['ok']);
    expect(post).toHaveBeenCalled();
  });

  it('ignores an empty chunk rather than emitting a no-op delta', async () => {
    const post = vi.fn();
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());
    sseHandler?.('chat:message-chunk', '', {});
    expect(post).not.toHaveBeenCalled();
  });
});

describe('agentBridge → MiniAppRunner postMessage envelope', () => {
  // 上一组断言的是 bridge 产出的**负载**。这一组补上 host 侧加信封的那一步：
  // `kind` 与 nonce 由 MiniAppRunner 的 post 回调写入，缺任何一项 iframe 侧的
  // message listener 都会把这条消息当成无关负载丢掉（它先判 kind，再判 nonce）。
  it('adds kind + nonce without clobbering the payload type', async () => {
    const captured: unknown[] = [];
    // 复刻 MiniAppRunner 里的 post 回调写法，确保展开顺序不会回归
    const post = (payload: AgentEventPayload) => {
      captured.push({ kind: 'app.event', nonce: 'n-1', ...payload });
    };
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());

    sseHandler?.('chat:message-chunk', 'hi', {});

    expect(captured[0]).toEqual({
      kind: 'app.event',
      nonce: 'n-1',
      type: 'agent.delta',
      text: 'hi',
      runId: 'main',
    });
  });

  it('keeps agent.* types on the dedicated agent channel, not the generic event one', async () => {
    // runtime 侧按 `type.indexOf('agent.') === 0` 分流：agent 负载必须原样带上
    // 自己的 type 前缀，否则会被当成 theme.change / activate 派发出去。
    const seen: string[] = [];
    const post = (payload: AgentEventPayload) => {
      seen.push(payload.type);
    };
    const bridge = makeBridge('probe', post);
    await bridge.subscribe('main', vi.fn());

    sseHandler?.('chat:message-chunk', 'a', {});
    sseHandler?.('chat:message-complete', {}, {});

    expect(seen.every((t) => t.startsWith('agent.'))).toBe(true);
  });
});
