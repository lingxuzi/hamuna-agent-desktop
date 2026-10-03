// MiniAppRunner / `window.app.*` 组件级往返 —— 真 iframe、真 postMessage、真回信。
//
// **为什么单独一个文件**：
//
// 这条通道的三段此前各测各的，没有任何东西保证三段**形状**对得上：
//   1. `appRuntimeScript.ts` —— iframe 侧脚本发出什么形状
//   2. `MiniAppRunner.tsx`    —— 宿主 listener 认什么形状
//   3. `appHostDispatch.ts`   —— 派发层转出什么形状
// 形状错位时三段单测会**全绿**（每段只看自己那半），作者侧的症状是 Promise 永久
// pending。`appDataWorkspace` 当初就是这样被 `appRuntimeScript.ts` 一个硬写的 `null`
// 参数吞掉的。本文件是唯一一处三段同时在场的测试。
//
// ── jsdom 的限制与本文件的绕法（全部实测，别当成产品缺陷去"修"）─────────
//
// 1. `postMessage` 把 `event.source` 置为 `null`（实测 `sourceIsParent:false,
//    sourceIsNull:true`）。而协议两端都依赖它：iframe 侧
//    `appRuntimeScript.ts` 要 `event.source === window.parent`，宿主侧
//    `verifyAppCall` 要 `envelope.source === iframe.contentWindow` 严格相等。
// 2. **realm 隔离**：`iframe.contentWindow` 与 iframe 脚本里的 `window` 不是同一个
//    JS 对象，`instanceof window.Window` 恒为 false，顶窗上挂的函数在 frame realm 里
//    看不见（`window.parent.__fn is not a function`）。
// 3. jsdom 不解析 `srcdoc` 属性；`document.write` 之后也不触发 iframe 的 `load`
//    事件 —— 而宿主正是在 `load` 里发 `host.ready`（`handleFrameLoad`）。
//
// 绕法：**两个方向都在 iframe 自己的 realm 里派发 `MessageEvent`**。这样收信方拿到的
// `source` 身份与浏览器一致（实测两侧 `===` 均成立）。被替换的只是 jsdom 写错的那个
// 字段和它不实现的 `srcdoc`/`load`；被测的三段生产代码一行没动，也没有任何一处断言是
// 照着实现反推的。
//
// `runScripts` 只在这个文件开（docblock）：jsdom 池默认不执行脚本，而这里必须让作者
// 脚本真的跑起来。**不可全局开** —— dom 池会渲染作者可控的 srcDoc。
//
// @vitest-environment jsdom
// @vitest-environment-options { "runScripts": "dangerously" }

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MiniAppRunner from './MiniAppRunner';

const apiPostJson = vi.fn();
const apiGetJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

const APP_ID = 'wire-probe';

/**
 * 作者视角的探针。刻意在 `host.ready` 之前就调用 —— runtime 会入队再冲刷。
 * `call` 是要在 iframe 里求值的表达式（`window.app.xxx`），所以一条夹具能测多个能力。
 */
function authorSrcDoc(call: string): string {
  return `<!doctype html><html><body><p>hi</p><script>
  (function () {
    var settled = false;
    function report(payload) {
      if (settled) return;
      settled = true;
      window.parent.postMessage({ __wire: true, payload: payload }, '*');
    }
    (async function () {
      try {
        report({ ok: true, value: await (${call}) });
      } catch (err) {
        report({ ok: false, code: err && err.code, message: String((err && err.message) || err) });
      }
    })();
  })();
</script></body></html>`;
}

/**
 * 装上双向投递。**必须在 `document.write` 之后、load 事件之前**调用：作者脚本在
 * write 期间执行并把调用入队，真正发出要等 `host.ready` 冲刷，那时投递已经就位。
 *
 * `outbound` 旁路记录 iframe -> host 的**真实**信封。伪造测试要靠它拿到真 nonce：
 * 用一个瞎编的 nonce 去伪造，会先被 nonce 那一关挡掉，于是"来源校验没了"这件事
 * 根本测不出来（第一版就是这么写的，变异验证时才发现）。
 */
function installMessageDriver(
  iframe: HTMLIFrameElement,
  reports: unknown[],
  outbound: Record<string, unknown>[],
): void {
  const hostWindow = window;
  const frameWindow = iframe.contentWindow as unknown as Window & {
    Function: (...args: string[]) => () => boolean;
  };
  if (!frameWindow) throw new Error('the iframe has no contentWindow');

  // 宿主这一侧的消息监听器（跑在**测试 realm**，所以读得到全部字段）。真调用与
  // 作者回话都从这里旁路记录，伪造测试要靠 `outbound` 里的**真 nonce**。
  hostWindow.addEventListener('message', (event) => {
    const data = event.data as
      | { __wire?: boolean; payload?: unknown; kind?: string }
      | null;
    if (!data) return;
    if (data.__wire === true) reports.push(data.payload);
    if (data.kind === 'app.call') outbound.push(data as Record<string, unknown>);
  });

  // 宿主 -> iframe：在 iframe realm 里派发，source 取它自己的 window.parent。
  const dispatchInFrame = frameWindow.Function(
    'return function (data) { window.dispatchEvent(new MessageEvent("message", { data: data, source: window.parent })); };',
  )() as unknown as (data: unknown) => void;
  (frameWindow as unknown as { postMessage: (m: unknown, o: string) => void }).postMessage = (
    data: unknown,
  ) => {
    dispatchInFrame(data);
  };

  // iframe -> host：运行时侧是 `window.parent.postMessage(...)`。同样在 iframe realm
  // 里替换（顶窗上打补丁它看不见），source 取它自己的 window —— 宿主侧收到时
  // `e.source === iframe.contentWindow` 成立，与浏览器一致。
  frameWindow.Function(
    'window.parent.postMessage = function (data) { window.parent.dispatchEvent(new MessageEvent("message", { data: data, source: window })); }; return true;',
  )();
}

interface Mounted {
  iframe: HTMLIFrameElement;
  reports: unknown[];
  /** iframe -> host 方向**真实**发出来的信封（driver 旁路记录）。 */
  outbound: Record<string, unknown>[];
}

/** 渲染 → 灌真 srcdoc → 装 driver → 补 load（触发 host.ready）。 */
async function mountAndBoot(
  call: string,
  permissions: Record<string, unknown>,
): Promise<Mounted> {
  const { container } = render(
    <MiniAppRunner
      appId={APP_ID}
      srcDoc={authorSrcDoc(call)}
      height={200}
      permissions={permissions as never}
    />,
  );
  const iframe = container.querySelector('iframe') as HTMLIFrameElement;
  expect(iframe, 'the runner did not render an iframe').toBeTruthy();

  const reports: unknown[] = [];
  const outbound: Record<string, unknown>[] = [];
  const srcDoc = iframe.getAttribute('srcdoc');
  expect(srcDoc, 'the runner did not set a srcdoc attribute').toBeTruthy();
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(srcDoc!);
  doc.close();

  installMessageDriver(iframe, reports, outbound);
  // jsdom 不触发 load；宿主在 load 里发 host.ready，冲刷作者排队的调用。
  iframe.dispatchEvent(new Event('load'));
  return { iframe, reports, outbound };
}

describe('MiniAppRunner / window.app.* survives the real iframe round trip', () => {
  beforeEach(() => {
    apiPostJson.mockReset();
    apiGetJson.mockReset();
    apiGetJson.mockResolvedValue({ ok: true, kinds: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries a granted call from inside the iframe to the host and back to the author', async () => {
    // 值是故意挑的：不是 undefined / null / 空串，包装错了就看得出来。
    const hostAnswer = { platform: 'darwin', arch: 'arm64', appDataDir: '/tmp/appdata' };
    apiPostJson.mockResolvedValue({ ok: true, result: hostAnswer });

    // os 组是**无条件放行**的（app-permissions.ts 与 storage / dialog 同档：没有
    // 跨 app 的数据），所以这条只验往返形状，不验授权。
    const { reports } = await mountAndBoot('window.app.os.info()', {});

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 1) iframe 发出的信封被宿主认下，并转成了正确的方法名 + appId。
    //    `params: null` 是 `os.info()` 无入参的真实形状（派发层 `params ?? null`），
    //    写成 `{}` 会让这条断言变成"照着想象写"。
    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/app/os.info', {
      appId: APP_ID,
      params: null,
    });

    // 2) 宿主的结果**原样**回到作者手里 —— 值没被包装、没被改名、没变成 undefined。
    //    这条断言同时钉住了「host.ready 之前入队、ready 到达后冲刷」这段时序。
    expect(reports[0]).toEqual({ ok: true, value: hostAnswer });
  }, 15000);

  it('rejects with a branchable code when the author did not declare the capability', async () => {
    // 选 net.fetch 而不是 fs.readFile：`rendererCanDecide` 明确把 `fs.*` 排除在
    // renderer 判定之外（只有 sidecar 判，因为它才知道真正的 appdata / workspace
    // 路径）。拿 fs 测这条会误判成"闸门漏了"，其实那是设计。net / shell / clipboard /
    // ai / agent / call 才是 renderer 这一侧就该拒的。
    const { reports } = await mountAndBoot(
      "window.app.net.fetch({ url: 'https://example.com/' })",
      {},
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 绝不能打到 sidecar：未声明的能力在 renderer 就该被拒。
    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; code?: string };
    expect(reported.ok).toBe(false);
    // 作者要能 branch，所以必须带一个真实失败才会产生的 code。断的是「settle」，
    // 不是「失败」—— 永久 pending 正是这里最该防的症状。
    expect(typeof reported.code).toBe('string');
    expect(reported.code).not.toBe('');
  }, 15000);

  it('never dispatches a call that did not come from the sandboxed iframe', async () => {
    apiPostJson.mockResolvedValue({ ok: true, result: { platform: 'win32' } });
    const { outbound } = await mountAndBoot('window.app.os.info()', {});
    await waitFor(() => expect(apiPostJson).toHaveBeenCalled(), { timeout: 3000 });
    apiPostJson.mockClear();

    // 取**真**信封里的 nonce。第一版这里瞎编了一个 'forged'，结果伪造信封先被
    // nonce 那一关挡掉 —— 于是"把来源校验整条删掉"这个变异测试依然是绿的，
    // 等于这条断言什么都没钉。必须让伪造信封只剩"来源"这一处不对。
    const real = outbound.find((m) => m && m.kind === 'app.call') as
      | { nonce: string; payload: { method: string; appId: string } }
      | undefined;
    expect(real, 'the author never sent a real app.call').toBeTruthy();

    // 顶窗伪造：形状对、nonce 对、方法名对、appId 对，**只有来源不对**。
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          kind: 'app.call',
          nonce: real!.nonce,
          id: 'forged-1',
          payload: { method: real!.payload.method, params: {}, appId: real!.payload.appId },
        },
        source: window, // 顶窗自己，不是 iframe
      }),
    );

    // 宿主必须整条丢掉，绝不派发。
    expect(apiPostJson).not.toHaveBeenCalled();
  }, 15000);

  it('rejects a forged appId even when the source and nonce are genuine', async () => {
    apiPostJson.mockResolvedValue({ ok: true, result: { platform: 'win32' } });
    const { iframe, outbound } = await mountAndBoot('window.app.os.info()', {});
    await waitFor(() => expect(apiPostJson).toHaveBeenCalled(), { timeout: 3000 });
    apiPostJson.mockClear();

    const real = outbound.find((m) => m && m.kind === 'app.call') as
      | { nonce: string; payload: { method: string; appId: string } }
      | undefined;
    expect(real, 'the author never sent a real app.call').toBeTruthy();

    // 同一个 iframe、同一个 nonce、方法名也在名单里，只是 appId 报的是**别的
    // MiniApp**。这条挡住的是"拿 A 的能力去冒充 B"。
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          kind: 'app.call',
          nonce: real!.nonce,
          id: 'forged-2',
          payload: { method: real!.payload.method, params: {}, appId: 'some-other-app' },
        },
        source: iframe.contentWindow, // 真来源：只有 appId 是假的
      }),
    );

    expect(apiPostJson).not.toHaveBeenCalled();
  }, 15000);

  it('rejects a call whose nonce is not this session, even from the real iframe', async () => {
    apiPostJson.mockResolvedValue({ ok: true, result: { platform: 'win32' } });
    const { iframe } = await mountAndBoot('window.app.os.info()', {});
    await waitFor(() => expect(apiPostJson).toHaveBeenCalled(), { timeout: 3000 });
    apiPostJson.mockClear();

    // 来源对、appId 对、方法名对，只有 nonce 是瞎编的。nonce 由宿主铸造、iframe
    // 无从自造，所以这一关是"别的 MiniApp 的 iframe 冒充过来"的最后一道拦截。
    // （变异验证时才发现这条是缺的：把 nonce 校验整条删掉，四条用例依然全绿。）
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          kind: 'app.call',
          nonce: 'not-this-session',
          id: 'forged-3',
          payload: { method: 'os.info', params: null, appId: APP_ID },
        },
        source: iframe.contentWindow,
      }),
    );

    expect(apiPostJson).not.toHaveBeenCalled();
  }, 15000);
});
