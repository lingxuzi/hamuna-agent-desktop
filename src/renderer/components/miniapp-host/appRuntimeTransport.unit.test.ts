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
      onEvent: (fn: (e: unknown) => void) => () => void;
      run: (prompt: unknown, opts?: unknown) => Promise<unknown>;
      turnText: (text: unknown, opts?: unknown) => Promise<unknown>;
    };
    storage: { set: (key: string, value: unknown) => Promise<unknown> };
    on: (fn: (e: unknown) => void) => () => void;
    onAppearanceChange: (fn: (e: unknown) => void) => () => void;
    onLocaleChange: (fn: (locale: unknown) => void) => () => void;
    t: (table: unknown, fallback?: unknown) => unknown;
    readonly locale: string;
    readonly appearanceMode: string;
  };
  ready: (nonce: string) => void;
  /** 模拟宿主回信：把 runtime 真正收到的那条 app.result 投进它的 listener。 */
  reply: (msg: Record<string, unknown>) => void;
  /** 派发一条宿主事件（app.event），走主题/语言/agent 三条通道。 */
  emit: (msg: Record<string, unknown>) => void;
  /**
   * 投递期间 listener 抛出的异常。
   *
   * 真实浏览器里这就是 message listener 里的未捕获异常：控制台一行红，作者侧的
   * Promise 照样悬着。**正因为它不影响作者可见的行为，单看 settle 结果分辨不出来**
   * —— 守卫在，pending 取不到就 return；守卫没了，取到 undefined 会在
   * `frame.resolve` 上抛 TypeError，然后被浏览器吞掉。作者那边两种情况都是
   * "永远 pending"，一模一样。所以必须把抛没抛单独记下来，守卫才钉得住。
   */
  listenerErrors: unknown[];
}

const NONCE = 'nonce-1';

function mountRuntime(appId = 'serialization-probe'): Harness {
  const listeners: Array<(e: { source?: unknown; data: unknown }) => void> = [];
  const sent: Array<Record<string, unknown>> = [];
  const listenerErrors: unknown[] = [];

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

  const deliver = (data: unknown): void => {
    for (const fn of listeners) {
      try {
        fn({ source: parent, data });
      } catch (e) {
        listenerErrors.push(e);
      }
    }
  };

  return {
    sent,
    listenerErrors,
    app: (fakeWindow as unknown as { app: Harness['app'] }).app,
    ready: (nonce: string) => deliver({ kind: 'host.ready', nonce }),
    reply: (msg: Record<string, unknown>) => deliver(msg),
    emit: (msg: Record<string, unknown>) => deliver(msg),
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

/**
 * 回信方向：宿主 → runtime。
 *
 * 上面所有用例都停在"runtime 把 app.call 投出去了"。这一组把剩下半程补上，
 * 而这半程**完全没有被覆盖过**，偏偏它是作者唯一能观察到成败的地方 ——
 * `await app.storage.set(...)` 到底 resolve 还是 reject，全看宿主那条
 * `app.result` 有没有把 pending 里那一帧对上。
 *
 * 为什么要单独盯：这条路径的失败形态是**静默挂起**，不是报错。作者点了按钮、
 * 什么都不发生、控制台干净，和「网络卡住」无法区分。本文件顶部那个
 * DataCloneError 缺陷就是同一类——Promise 永不 settle——那次是靠"专门造一个
 * 排队中的不可克隆参数"才碰到的，不是被任何现有断言逮住的。
 *
 * 反过来说，下面几条"必须**不** settle"的断言同样是功能要求：一条 nonce 或 id
 * 对不上的回信如果被当成命中，作者会拿到**别人的**结果。宁可挂着也不能串台。
 */
describe('host reply settles the author promise', () => {
  it('a matching reply resolves with exactly the host result', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const p = h.app.storage.set('k', { a: 1 });
    const call = h.sent[0] as { id: string };

    h.reply({ kind: 'app.result', nonce: NONCE, id: call.id, ok: true, result: { bytes: 12 } });

    await expect(p).resolves.toEqual({ bytes: 12 });
  });

  it('an ok:false reply rejects carrying the host error code and message', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const p = h.app.storage.set('k', 1);
    const call = h.sent[0] as { id: string };

    h.reply({
      kind: 'app.result',
      nonce: NONCE,
      id: call.id,
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'storage.write is not granted' },
    });

    await expect(p).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'storage.write is not granted',
    });
  });

  it('an error reply with no code still rejects with something actionable', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const p = h.app.storage.set('k', 1);
    const call = h.sent[0] as { id: string };

    // 宿主漏填 code 时不能变成 `code: undefined` —— 作者 catch 到的是一个
    // 没法分支、没法上报的异常。兜底成 HOST_ERROR。
    h.reply({ kind: 'app.result', nonce: NONCE, id: call.id, ok: false, error: {} });

    await expect(p).rejects.toMatchObject({ code: 'HOST_ERROR' });
  });

  it('a reply carrying the wrong nonce never settles — it must not be mistaken for a hit', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const p = h.app.storage.set('k', 1);
    const call = h.sent[0] as { id: string };

    h.reply({ kind: 'app.result', nonce: 'some-other-nonce', id: call.id, ok: true, result: 'WRONG' });

    // 挂着是对的：作者宁可等到超时，也好过拿到一条对错了会话的数据。
    expect(await settle(p)).toBe('pending');
  });

  it('a reply for an unknown id never settles and leaves the live call alone', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const p = h.app.storage.set('k', 1);
    const call = h.sent[0] as { id: string };

    h.reply({ kind: 'app.result', nonce: NONCE, id: 'no-such-id', ok: true, result: 'WRONG' });
    expect(await settle(p)).toBe('pending');
    // 守卫真的挡住了，而不是"照样 pending、只是顺带抛了个 TypeError"。
    // 这条单独记，是因为两种情况在作者可见的行为上完全一样。
    expect(h.listenerErrors).toHaveLength(0);

    // 真正的回信随后到达，仍能正常收尾 —— 说明那条野回信没有把 pending 弄脏
    h.reply({ kind: 'app.result', nonce: NONCE, id: call.id, ok: true, result: 'RIGHT' });
    await expect(p).resolves.toBe('RIGHT');
  });

  it('concurrent calls each settle with their own result, even replied out of order', async () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const first = h.app.storage.set('a', 1);
    const second = h.app.storage.set('b', 2);
    const [c1, c2] = h.sent as Array<{ id: string }>;

    // 倒序回信：正是 Agent 那种"后发先至"的形状
    h.reply({ kind: 'app.result', nonce: NONCE, id: c2.id, ok: true, result: 'second' });
    h.reply({ kind: 'app.result', nonce: NONCE, id: c1.id, ok: true, result: 'first' });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('a call queued before host.ready still settles when the reply arrives', async () => {
    const h = mountRuntime();

    // ready 之前发起 —— 这条调用会先在 runtime 里排队
    const p = h.app.storage.set('k', 1);
    h.ready(NONCE);

    const call = h.sent[0] as { id: string };
    h.reply({ kind: 'app.result', nonce: NONCE, id: call.id, ok: true, result: 'late' });

    await expect(p).resolves.toBe('late');
  });
});

/**
 * 宿主主动事件的三条通道。
 *
 * runtime 内部按事件类型分流到不同 channel（appearance / locale / agent），
 * 作者订阅错通道的表现是"注册成功但永远收不到"—— 注册路径不报错，所以同样只能
 * 靠实跑发现。`agent.*` 尤其要验：它的流式 delta 频率很高，混进通用 event
 * 会让只想监听主题变更的作者被迫过滤大量无关负载。
 */
describe('host events reach the right author channel', () => {
  it('theme.change goes to onAppearanceChange and not to the generic channel', () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const generic: unknown[] = [];
    const appearance: unknown[] = [];
    h.app.on(p => generic.push(p));
    h.app.onAppearanceChange(p => appearance.push(p));

    h.emit({ kind: 'app.event', type: 'theme.change', appearanceMode: 'dark' });

    expect(appearance).toHaveLength(1);
    expect(generic).toHaveLength(0);
  });

  it('locale.change goes to onLocaleChange', () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const locale: unknown[] = [];
    h.app.onLocaleChange(p => locale.push(p));

    h.emit({ kind: 'app.event', type: 'locale.change', locale: 'zh-CN' });

    expect(locale).toEqual(['zh-CN']);
  });

  // 上面那条只断言"通知到了"，不断言"值变了" —— 正是这个缺口让一个
  // onLocaleChange 会触发、但 app.t() 永远停在首帧语言的产品 bug 绿灯通过。
  // 事件的价值在于它描述的状态已生效，所以下面每条都断言效果本身。
  it('locale.change actually moves app.locale and app.t(), not just the notification', () => {
    const h = mountRuntime();
    h.ready(NONCE);
    // harness 的 ready() 不带 env，所以这里就是 runtime 的默认值
    expect(h.app.locale).toBe('en-US');

    const table = { 'en-US': 'Hello', 'zh-CN': '你好' };
    expect(h.app.t(table, '?')).toBe('Hello');

    h.emit({ kind: 'app.event', type: 'locale.change', locale: 'zh-CN' });

    expect(h.app.locale).toBe('zh-CN');
    expect(h.app.t(table, '?')).toBe('你好');
  });

  it('the new locale is already visible from inside the onLocaleChange callback', () => {
    // applyEnv 与 emit 的顺序是这条的全部意义：先 emit 再 apply，作者在回调里
    // 调 app.t() 拿到的还是旧语言，只能绕过 app.t 自己拼字符串。
    const h = mountRuntime();
    h.ready(NONCE);

    const table = { 'en-US': 'Hello', 'zh-CN': '你好' };
    const seenInsideCallback: unknown[] = [];
    h.app.onLocaleChange(() => {
      seenInsideCallback.push(h.app.t(table, '?'));
    });

    h.emit({ kind: 'app.event', type: 'locale.change', locale: 'zh-CN' });

    expect(seenInsideCallback).toEqual(['你好']);
  });

  it('theme.change actually moves app.appearanceMode', () => {
    const h = mountRuntime();
    h.ready(NONCE);
    expect(h.app.appearanceMode).toBe('dark');

    h.emit({ kind: 'app.event', type: 'theme.change', appearanceMode: 'light' });

    expect(h.app.appearanceMode).toBe('light');
  });

  it('a change event carrying no value does not wipe env to undefined', () => {
    // applyEnv 跳过 undefined 是这条的安全网：畸形事件不能把 app.locale 洗成
    // undefined，那样 app.t() 会静默退到 fallback，看起来像"翻译表写错了"。
    const h = mountRuntime();
    h.ready(NONCE);

    h.emit({ kind: 'app.event', type: 'locale.change' });
    h.emit({ kind: 'app.event', type: 'theme.change' });

    expect(h.app.locale).toBe('en-US');
    expect(h.app.appearanceMode).toBe('dark');
  });

  it('agent.* streaming events reach agent.onEvent, not the generic channel', () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const generic: unknown[] = [];
    const agentEvents: unknown[] = [];
    h.app.on(p => generic.push(p));
    h.app.agent.onEvent(p => agentEvents.push(p));

    // onEvent 注册时会握手拉起通道，这条 app.call 是预期内的
    const callsBefore = h.sent.length;
    h.emit({ kind: 'app.event', type: 'agent.delta', text: 'hel', runId: 'r1' });

    expect(agentEvents).toHaveLength(1);
    expect(generic).toHaveLength(0);
    expect(h.sent.length).toBe(callsBefore);
  });

  it('unsubscribing stops delivery', () => {
    const h = mountRuntime();
    h.ready(NONCE);

    const seen: unknown[] = [];
    const off = h.app.onAppearanceChange(p => seen.push(p));

    h.emit({ kind: 'app.event', type: 'theme.change', appearanceMode: 'dark' });
    off();
    h.emit({ kind: 'app.event', type: 'theme.change', appearanceMode: 'light' });

    expect(seen).toHaveLength(1);
  });
});
