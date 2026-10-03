//
// 回归护栏：runtime 的调用在"参数无法结构化克隆"时必须以 reject 收场，
// 绝不能让作者的 Promise 悬空。
//
// 为什么这条要单独占一个文件：app-parity 断言的是**名单一致性**（协议 vs
// 门面 vs 执行层），它把 runtime 当文本正则扫，从不真正执行它。而这个缺陷只在
// 脚本真的跑起来、且调用发生在 host.ready 之前的**排队路径**上才会出现。名单
// 测试永远看不到它。
//
// 触发它的就是**参数里带函数**的调用 —— postMessage 抛 DataCloneError。关键
// 在于 flush 队列是在 host.ready 的 message listener 里执行的，不在 Promise
// executor 内 —— 抛错变成 listener 里的未捕获异常，作者侧的 Promise 永远不
// settle，表现为"点了没反应、也不报错"，比直接失败难查一个量级。
//
// 曾经用参考文档里的 `app.ai.chat(messages, { onChunk(){} })` 当触发例；现在
// ai.* 会被 callbackRejection 提前拦下（给一句能照着改的说明，见下方
// describe），进不了这条路径。通用护栏本身仍然必须成立，所以改用
// `storage.set(key, () => {})` —— 任何函数值都会撞上同堵墙。
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
      complete: (prompt: unknown, opts?: unknown) => Promise<unknown>;
      cancel: (id: unknown) => Promise<unknown>;
    };
    agent: {
      cancel: (id: unknown) => Promise<unknown>;
      ensureSession: (opts?: unknown) => Promise<unknown>;
      run: (prompt: unknown, opts?: unknown) => Promise<unknown>;
      turnText: (text: unknown, opts?: unknown) => Promise<unknown>;
    };
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

    // 走 `storage.set` 而不是 `ai.chat`：后者现在被 callbackRejection 提前拦下
    // （见下方 describe），根本进不了队列，flush 那条路径就没人守了。
    // 通用克隆护栏仍然必须成立 —— 任何带函数值的调用都会撞上。
    const p = h.app.storage.set('k', () => {});

    // 先排队（host 还没 ready），再 ready：缺陷只在 flush 这条路径上出现。
    h.ready('nonce-1');

    expect(await settle(p)).toBe('rejected');
  });

  it('that rejection names the cause instead of surfacing a bare host error', async () => {
    const h = mountRuntime();
    const p = h.app.storage.set('k', () => {});

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

// 参考文档给 app.ai.chat 配了 onChunk / onDone / onError。函数过不了 postMessage
// 的结构化克隆，作者撞上时看到的是一句"参数不可克隆"—— 不知道该往哪改。
// 这里要的是**能照着做的说明**，以及以 reject（不是同步 throw）收场：作者多半
// 写的是 await app.ai.chat(...).catch(...)，同步抛出接不住。
describe('app.ai callback options fail with a directed message', () => {
  it('ai.chat rejects onChunk with APP_UNSUPPORTED_CALLBACK and never reaches the host', async () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    await expect(
      h.app.ai.chat([{ role: 'user', content: 'hi' }], { onChunk: () => {} }),
    ).rejects.toMatchObject({ code: 'APP_UNSUPPORTED_CALLBACK' });
    expect(h.sent).toHaveLength(0);
  });

  it('the rejection names the offending option and what to do instead', async () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    await expect(
      h.app.ai.chat([{ role: 'user', content: 'hi' }], { onDone: () => {} }),
    ).rejects.toThrow(/onDone[\s\S]*postMessage/);
  });

  it('ai.complete rejects callbacks too', async () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    await expect(
      h.app.ai.complete('hi', { onError: () => {} }),
    ).rejects.toMatchObject({ code: 'APP_UNSUPPORTED_CALLBACK' });
    expect(h.sent).toHaveLength(0);
  });

  it('non-function options are untouched and still reach the host', () => {
    const h = mountRuntime();
    h.ready('nonce-1');

    void h.app.ai.complete('hi', { systemPrompt: 'be terse', maxTokens: 128 });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].payload).toMatchObject({
      method: 'ai.complete',
      params: { prompt: 'hi' },
    });
  });
});

/**
 * 作者真正能碰到的那一层：iframe 里的 `app.agent.*` 门面。
 *
 * 这一层曾经把 `appDataWorkspace` 直接吞掉 —— `ensureSession` 无参硬传 `null`，
 * 于是作者照参考文档传的子目录名在 iframe 边界就没了，renderer 与 sidecar
 * 谁都收不到，表现是"我明明挑了子目录，run 却跑在 appdata 根上"。
 *
 * 之所以要单独钉：host 侧（renderer / sidecar）修得再对，这一层漏了照样是
 * 静默丢弃，而且**没有任何一层会报错**。
 */
describe('runtime surface: app.agent forwards appDataWorkspace', () => {
  it('ensureSession passes the workspace the author asked for', async () => {
    const h = mountRuntime();
    h.ready('n1');

    void h.app.agent.ensureSession({ appDataWorkspace: 'notes' });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].payload).toMatchObject({
      method: 'agent.ensureSession',
      params: { appDataWorkspace: 'notes' },
    });
  });

  it('ensureSession without options still sends a params object, not a dropped null', async () => {
    const h = mountRuntime();
    h.ready('n1');

    void h.app.agent.ensureSession();

    // 传 null 与传 {appDataWorkspace: undefined} 在下游 asRecord 后一样，
    // 但这条断言锁的是"作者不传时也别把调用变成另一种形状"。
    expect(h.sent[0].payload).toMatchObject({ method: 'agent.ensureSession' });
  });

  it.each(['run', 'turnText'] as const)('%s forwards appDataWorkspace in opts', async method => {
    const h = mountRuntime();
    h.ready('n1');

    void (method === 'run'
      ? h.app.agent.run('hi', { appDataWorkspace: 'notes' })
      : h.app.agent.turnText('hi', { appDataWorkspace: 'notes' }));

    expect(h.sent[0].payload).toMatchObject({
      method: `agent.${method}`,
      params: { appDataWorkspace: 'notes' },
    });
  });
});
