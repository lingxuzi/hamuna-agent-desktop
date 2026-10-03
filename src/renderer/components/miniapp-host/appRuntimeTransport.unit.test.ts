//
// 回归护栏：runtime 的调用在"参数无法结构化克隆"时必须以 reject 收场，
// 绝不能让作者的 Promise 悬空。
//
// 为什么这条要单独占一个文件：app-parity 断言的是**名单一致性**（协议 vs
// 门面 vs 执行层），它把 runtime 当文本正则扫，从不真正执行它。而这个缺陷只在
// 脚本真的跑起来、且调用发生在 host.ready 之前的**排队路径**上才会出现。名单
// 测试永远看不到它。
//
// 触发它的就是参考文档里的标准写法：
//   const handle = await app.ai.chat([{role,content}], { onChunk(){} })
// 函数不可结构化克隆，postMessage 抛 DataCloneError。关键在于 flush 队列是在
// host.ready 的 message listener 里执行的，不在 Promise executor 内 —— 抛错
// 变成 listener 里的未捕获异常，作者侧的 Promise 永远不 settle，表现为"点了
// 没反应、也不报错"，比直接失败难查一个量级。
//
// 这条断言与"ai.chat 该长什么样"的设计选择无关：无论最终对齐到参考的流式
// handle，还是保留本项目的一次性形态，不可克隆的参数都必须显式失败。

import { describe, expect, it } from 'vitest';

import { buildAppRuntimeScript } from './appRuntimeScript';

interface Harness {
  sent: Array<Record<string, unknown>>;
  app: {
    ai: {
      chat: (messages: unknown, opts?: unknown) => Promise<unknown>;
      cancel: (id: unknown) => Promise<unknown>;
    };
    agent: { cancel: (id: unknown) => Promise<unknown> };
    storage: { set: (key: string, value: unknown) => Promise<unknown> };
  };
  ready: (nonce: string) => void;
}

function mountRuntime(appId = 'serialization-probe'): Harness {
  const listeners: Array<(e: { source?: unknown; data: unknown }) => void> = [];
  const sent: Array<Record<string, unknown>> = [];

  // postMessage 真做结构化克隆，行为与浏览器一致 —— 这正是缺陷的成因。
  // 换成"随手 push 一下"的假实现会把 bug 一起假装掉。
  const parent = {
    postMessage(msg: Record<string, unknown>) {
      structuredClone(msg);
      sent.push(msg);
    },
  };

  const fakeWindow = {
    parent,
    addEventListener(type: string, fn: (e: never) => void) {
      if (type === 'message') listeners.push(fn as never);
    },
  };

  // runtime 是个模板字符串 IIFE，唯一自由变量就是 window —— 注入一个受控的
  // window 就能在 Node 里原样执行它，不需要 jsdom。
  new Function('window', buildAppRuntimeScript(appId))(fakeWindow);

  return {
    sent,
    app: (fakeWindow as unknown as { app: Harness['app'] }).app,
    ready: (nonce: string) =>
      listeners.forEach((fn) => {
        try {
          fn({ source: parent, data: { kind: 'host.ready', nonce } });
        } catch {
          // 真实浏览器里这只是 message listener 里的一个未捕获异常：作者侧的
          // Promise 照样悬着。吞掉它，好让断言去看真正要观察的现象。
        }
      }),
  };
}

const settle = (p: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> =>
  Promise.race([
    p.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>((r) => setTimeout(() => r('pending'), 50)),
  ]);

describe('runtime call transport', () => {
  it('a queued call whose arguments cannot be structured-cloned rejects instead of hanging', async () => {
    const h = mountRuntime();

    // 先排队（host 还没 ready），再 ready：缺陷只在 flush 这条路径上出现。
    const p = h.app.ai.chat([{ role: 'user', content: 'hi' }], { onChunk: () => {} });

    h.ready('nonce-1');

    expect(await settle(p)).toBe('rejected');
  });

  it('that rejection names the cause instead of surfacing a bare host error', async () => {
    const h = mountRuntime();
    const p = h.app.ai.chat([{ role: 'user', content: 'hi' }], { onChunk: () => {} });

    h.ready('nonce-1');

    await expect(p).rejects.toMatchObject({ code: 'APP_CALL_NOT_SERIALIZABLE' });
  });

  it('a cloneable call still reaches the host with its payload intact', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.storage.set('k', { a: 1 });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].payload).toMatchObject({
      method: 'storage.set',
      params: { key: 'k', value: { a: 1 } },
    });
  });
});

// 取消类 API 的入参形态。参考文档给的是**位置参数**
// （app.ai.cancel(handle.streamId)），只认 { run_id } 的话，照文档写的作者会
// 发出 run_id: undefined —— sidecar 侧退回 'default'，取消静默打空且不报错。
// 这是纯入参归一，与 ai.chat 该不该流式无关。
describe('runtime cancel argument shape', () => {
  it('ai.cancel takes the positional stream id from the reference', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.ai.cancel('stream-42');

    expect(h.sent[0].payload).toMatchObject({
      method: 'ai.cancel',
      params: { run_id: 'stream-42' },
    });
  });

  it('ai.cancel still accepts the object form (backward compatible)', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.ai.cancel({ run_id: 'stream-42' });

    expect(h.sent[0].payload).toMatchObject({
      method: 'ai.cancel',
      params: { run_id: 'stream-42' },
    });
  });

  it('agent.cancel takes a bare run id', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.agent.cancel('run-7');

    expect(h.sent[0].payload).toMatchObject({
      method: 'agent.cancel',
      params: { run_id: 'run-7' },
    });
  });

  it('a non-string, non-object argument is dropped rather than stringified', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.ai.cancel(undefined);

    // 不做 String(o) 之类的"尽力归一"：把 0 / null 变成 '0' / 'null' 会瞄准
    // 一个根本不存在的 runId，比明确丢弃更难查。
    expect((h.sent[0].payload as { params: { run_id?: unknown } }).params.run_id).toBeUndefined();
  });
});
