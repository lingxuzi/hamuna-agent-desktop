/**
 * `app.*` 的传输层契约：宿主怎么认出"这条调用是我那个 iframe 发的"，
 * 以及怎么保证**一定**回信。
 *
 * `verifyAppCall` 是第三方代码进不了别的 MiniApp 语境的唯一屏障。四条信任规则
 * 缺一不可，所以这里逐条钉，而不是只验"正常调用能通"——后者在规则被放宽时
 * 照样绿，那正是最需要报警的时刻。
 *
 * `postAppResult` 防的是另一头：作者那侧的 `dispatch` 是 `new Promise` 包着的，
 * 收不到回信就永远不 settle。表现是"点了没反应、控制台也干净"，和网络卡住
 * 无法区分，所以它必须被主动喂一个不可克隆的结果才测得到。
 *
 * 为什么在这里测而不在组件里测：信任判定与回信都是纯逻辑，值得直接单测；而
 * 组件层的 `event.source instanceof Window` 在 jsdom 下恒为 false（iframe 的
 * contentWindow 与测试环境的 `Window` 不同 realm），那里根本构造不出一次
 * 真实的通过路径，写出来的断言只会是自欺。真实浏览器里 srcDoc + allow-same-origin
 * 的 iframe 是同 realm，那条判定成立。
 */

import { describe, expect, it } from 'vitest';

import {
  APP_ERROR_CODES,
  buildAppResult,
  postAppResult,
  verifyAppCall,
  type AppResultTarget,
} from './app-protocol';

const NONCE = 'nonce-abc';
const APP_ID = 'my-app';

/** 只提供 postMessage 的替身：真实 iframe.contentWindow 在单测里用不上。 */
function fakeWindow(): AppResultTarget & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    postMessage(message: unknown) {
      sent.push(message);
    },
  };
}

/** 真做结构化克隆的替身：不可克隆的值会抛，与浏览器一致。 */
function cloningWindow(): AppResultTarget & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    postMessage(message: unknown) {
      structuredClone(message);
      sent.push(message);
    },
  };
}

const validCall = {
  kind: 'app.call',
  nonce: NONCE,
  id: 'call-1',
  payload: { method: 'os.info', params: null, appId: APP_ID },
};

describe('verifyAppCall: the four trust rules, each load-bearing', () => {
  const iframeWindow = fakeWindow() as unknown as Window;

  it('accepts a call from this iframe with the right nonce, appId and method', () => {
    const call = verifyAppCall(
      { source: iframeWindow, origin: '', data: validCall },
      iframeWindow,
      NONCE,
      APP_ID,
    );
    expect(call).not.toBeNull();
    expect(call?.payload.method).toBe('os.info');
    expect(call?.id).toBe('call-1');
  });

  it('rejects a message from any window other than this iframe', () => {
    // 别的 MiniApp、宿主页面、或父窗口伪造同形消息 —— source 对不上就一律不认。
    const otherWindow = fakeWindow() as unknown as Window;
    expect(
      verifyAppCall({ source: otherWindow, origin: '', data: validCall }, iframeWindow, NONCE, APP_ID),
    ).toBeNull();
  });

  it('rejects a call whose nonce the iframe could not have minted', () => {
    expect(
      verifyAppCall(
        { source: iframeWindow, origin: '', data: { ...validCall, nonce: 'guessed' } },
        iframeWindow,
        NONCE,
        APP_ID,
      ),
    ).toBeNull();
  });

  it('rejects a call claiming somebody else appId', () => {
    expect(
      verifyAppCall(
        {
          source: iframeWindow,
          origin: '',
          data: { ...validCall, payload: { ...validCall.payload, appId: 'other-app' } },
        },
        iframeWindow,
        NONCE,
        APP_ID,
      ),
    ).toBeNull();
  });

  it('rejects a call naming a method the host does not implement', () => {
    expect(
      verifyAppCall(
        {
          source: iframeWindow,
          origin: '',
          data: { ...validCall, payload: { ...validCall.payload, method: 'shell.execRoot' } },
        },
        iframeWindow,
        NONCE,
        APP_ID,
      ),
    ).toBeNull();
  });

  it('rejects everything when the iframe contentWindow is not mounted yet', () => {
    // 挂载前 contentWindow 是 null，此时不能因为"source 也恰好是 null"而放行。
    expect(
      verifyAppCall({ source: null, origin: '', data: validCall }, null, NONCE, APP_ID),
    ).toBeNull();
  });

  it.each([
    ['a non-object payload', null],
    ['a string', 'app.call'],
    ['the wrong kind', { ...validCall, kind: 'app.event' }],
    ['a missing nonce', { ...validCall, nonce: undefined }],
    ['a non-string id', { ...validCall, id: 7 }],
    ['a missing payload', { ...validCall, payload: undefined }],
    ['a payload with a non-string method', { ...validCall, payload: { method: 1, appId: APP_ID } }],
    ['a payload with no appId', { ...validCall, payload: { method: 'os.info' } }],
  ])('rejects %s instead of throwing', (_label, data) => {
    expect(() =>
      verifyAppCall({ source: iframeWindow, origin: '', data }, iframeWindow, NONCE, APP_ID),
    ).not.toThrow();
    expect(
      verifyAppCall({ source: iframeWindow, origin: '', data }, iframeWindow, NONCE, APP_ID),
    ).toBeNull();
  });
});

describe('postAppResult: the author promise always settles', () => {
  it('delivers the result verbatim when it is cloneable', () => {
    const w = cloningWindow();
    postAppResult(w, NONCE, 'call-1', { ok: true, result: { platform: 'win32' } });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toEqual({
      kind: 'app.result',
      nonce: NONCE,
      id: 'call-1',
      ok: true,
      result: { platform: 'win32' },
    });
  });

  it('falls back to a catchable error instead of dropping a non-cloneable result', () => {
    const w = cloningWindow();
    // 不可克隆的值：函数过不了结构化克隆。真实路径可能是某个 dispatcher
    // 将来返回了带函数的对象。
    postAppResult(w, NONCE, 'call-1', { ok: true, result: () => 'nope' }, 'fs.readFile');

    // 关键：有一条回信，不是零条。没有回信 = 作者的 Promise 永久 pending。
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({
      kind: 'app.result',
      nonce: NONCE,
      id: 'call-1',
      ok: false,
      error: { code: 'HOST_ERROR' },
    });
    // 错误文案要指名是哪个方法，否则作者无从判断该怀疑谁。
    expect((w.sent[0] as { error: { message: string } }).error.message).toContain('fs.readFile');
  });

  it('keeps the ok:false contract: a failing call is delivered as-is', () => {
    const w = cloningWindow();
    postAppResult(w, NONCE, 'call-1', {
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'not granted' },
    });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('swallows the failure when the target is gone entirely', () => {
    // iframe 已卸载：作者连同它一起没了，没有任何可通知的对象。这里只能吞。
    const dead = {
      postMessage() {
        throw new Error('detached');
      },
    };
    expect(() =>
      postAppResult(dead, NONCE, 'call-1', { ok: true, result: { a: 1 } }),
    ).not.toThrow();
  });
});

describe('buildAppResult envelope shape', () => {
  it('omits result on failure and error on success', () => {
    // 两个字段同时出现会让 iframe 侧的分叉判断产生歧义。
    const ok = buildAppResult(NONCE, 'x', { ok: true, result: 1 });
    expect(ok).toHaveProperty('ok', true);
    expect(ok).not.toHaveProperty('error');

    const bad = buildAppResult(NONCE, 'x', {
      ok: false,
      error: { code: APP_ERROR_CODES.PERMISSION_DENIED, message: 'm' },
    });
    expect(bad).toHaveProperty('ok', false);
    expect(bad).not.toHaveProperty('result');
  });
});
