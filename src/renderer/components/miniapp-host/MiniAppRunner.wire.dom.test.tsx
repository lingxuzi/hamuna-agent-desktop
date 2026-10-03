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
import { clearWorkerId, registerWorkerId } from './appHostDispatch';
import { __resetWorkerKindsForTest } from './workerCallBridge';

const apiPostJson = vi.fn();
const apiGetJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

// 原生 owner（dialog / clipboard）在离开 renderer 之前就地消化，不走 sidecar。
// 它们的信封形状同样要验 —— 前面那些用例只覆盖了 apiPostJson 那一个 owner。
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
const dialogOpen = vi.fn();
const dialogSave = vi.fn();
const dialogAsk = vi.fn();
const dialogMessage = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => dialogOpen(...args),
  save: (...args: unknown[]) => dialogSave(...args),
  ask: (...args: unknown[]) => dialogAsk(...args),
  message: (...args: unknown[]) => dialogMessage(...args),
}));

// Agent owner。bridge 由 MiniAppRunner 在 render 期间自己建（不能把 ref 以任何形式
// 交给渲染期调用的工厂），所以只能替掉工厂本身，而不是注一个 prop。
const bridgeEnsureSession = vi.fn();
const bridgeSubscribe = vi.fn();
const bridgeSetPost = vi.fn();
const bridgeRelease = vi.fn();

// Agent **回合**走的是第四条路：proxyFetch 直连 MiniApp 专用 sidecar 的端口，
// 不是 apiPostJson 的全局 sidecar。回合跑在哪个进程，决定了 SSE 事件与 abort
// 能不能命中同一个 turn —— 走错进程就是"看起来成功、实际空转"。
const proxyFetch = vi.fn();
vi.mock('@/api/tauriClient', () => ({
  proxyFetch: (...args: unknown[]) => proxyFetch(...args),
}));

vi.mock('./agentEventBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agentEventBridge')>();
  return {
    ...actual,
    createAgentBridge: () => ({
      setPost: bridgeSetPost,
      ensureSession: bridgeEnsureSession,
      subscribe: bridgeSubscribe,
      release: bridgeRelease,
    }),
  };
});

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
  runnerProps: Record<string, unknown> = {},
): Promise<Mounted> {
  const { container } = render(
    <MiniAppRunner
      appId={APP_ID}
      srcDoc={authorSrcDoc(call)}
      height={200}
      permissions={permissions as never}
      {...runnerProps}
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
    invoke.mockReset();
    dialogOpen.mockReset();
    dialogSave.mockReset();
    dialogAsk.mockReset();
    dialogMessage.mockReset();
    bridgeEnsureSession.mockReset();
    bridgeSubscribe.mockReset();
    bridgeSetPost.mockReset();
    bridgeRelease.mockReset();
    proxyFetch.mockReset();
    // worker kinds 是模块级单例缓存：前面那些用例已经用 kinds: [] 把它填成空了，
    // 不重置的话本用例设的 kinds 永远不生效，spawn effect 会静默 early-return。
    __resetWorkerKindsForTest();
    apiGetJson.mockResolvedValue({ ok: true, kinds: [] });
  });

  afterEach(() => {
    // 注册表是模块级的：不清掉，下一条用例会拿到一个"已经就绪的 worker"。
    clearWorkerId(APP_ID);
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

  it('routes clipboard to the Tauri owner rather than the sidecar, and hands the text back', async () => {
    // 剪贴板里是**宿主的**用户状态（典型场景：刚复制的密码），所以要显式 opt-in。
    invoke.mockResolvedValue('copied-secret');
    const { reports } = await mountAndBoot('window.app.clipboard.readText()', {
      clipboard: { enabled: true },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(invoke).toHaveBeenCalledWith('cmd_clipboard_read_text');
    // 原生能力在离开 renderer 前就被消化，绝不能再发一份到 sidecar。
    expect(apiPostJson).not.toHaveBeenCalled();
    expect(reports[0]).toEqual({ ok: true, value: 'copied-secret' });
  }, 15000);

  it('refuses clipboard.readText without explicit opt-in, and never reaches Tauri', async () => {
    const { reports } = await mountAndBoot('window.app.clipboard.readText()', {});

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 两头都不能碰：不能 invoke（那是宿主的真剪贴板），也不能发到 sidecar。
    expect(invoke).not.toHaveBeenCalled();
    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; code?: string };
    expect(reported.ok).toBe(false);
    expect(typeof reported.code).toBe('string');
  }, 15000);

  it("carries the user's answer to a confirm dialog back to the author", async () => {
    dialogAsk.mockResolvedValue(true);
    const { reports } = await mountAndBoot(
      "window.app.dialog.message({ message: 'Sure?', kind: 'confirm' })",
      {},
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // confirm 走 ask()（Yes/No），其余 kind 走 message()（单 Ok）—— Tauri 的
    // MessageDialogKind 里并没有 confirm 这一档，所以必须分开调。
    expect(dialogAsk).toHaveBeenCalledWith('Sure?', { title: undefined, kind: 'warning' });
    expect(dialogMessage).not.toHaveBeenCalled();
    expect(apiPostJson).not.toHaveBeenCalled();
    // 作者拿到的是 `{confirmed: true}`，不是一个裸布尔 —— 形状错了作者就会写错分支。
    expect(reports[0]).toEqual({ ok: true, value: { confirmed: true } });
  }, 15000);

  it('accepts the documented 2-arg dialog.message(text, opts) and keeps the kind', async () => {
  // `bundled-skills/miniapp-creator/SKILL.md:132-133` 教的就是这个写法：
  //   app.dialog.message('导出完成', { kind: 'info' })
  // 而 facade 此前只取第一个参数，于是文本与 kind **一起**被丢掉，宿主收到裸
  // 字符串 → asRecord 变 {} → INVALID_PARAMS。上一条用例只覆盖对象形态，所以
  // 文档教的写法一次都没被执行过。
  dialogMessage.mockResolvedValue(undefined);
  const { reports } = await mountAndBoot(
    "window.app.dialog.message('Exported.', { kind: 'warning' })",
    {},
  );

  await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

  // kind 必须真的活到原生调用上——只传通文本、丢掉 kind 仍然是坏的。
  expect(dialogMessage).toHaveBeenCalledWith('Exported.', { title: undefined, kind: 'warning' });
  expect(dialogAsk).not.toHaveBeenCalled();
  expect(reports[0]).toEqual({ ok: true, value: { confirmed: null } });
}, 15000);

it('routes a 2-arg confirm to ask() and still returns the boolean', async () => {
  dialogAsk.mockResolvedValue(false);
  const { reports } = await mountAndBoot(
    "window.app.dialog.message('Delete it?', { kind: 'confirm' })",
    {},
  );

  await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

  expect(dialogAsk).toHaveBeenCalledWith('Delete it?', { title: undefined, kind: 'warning' });
  expect(dialogMessage).not.toHaveBeenCalled();
  // 作者写的是 `const yes = await app.dialog.message(...)`，拿到 false 时应当
  // 写得出 `if (!yes)`——所以是 {confirmed:false} 而不是 false 或 null。
  expect(reports[0]).toEqual({ ok: true, value: { confirmed: false } });
}, 15000);

it('object-form dialog.message still works (the 2-arg form must not break it)', async () => {
  dialogMessage.mockResolvedValue(undefined);
  const { reports } = await mountAndBoot(
    "window.app.dialog.message({ message: 'Object form.' })",
    {},
  );

  await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

  expect(dialogMessage).toHaveBeenCalledWith('Object form.', { title: undefined, kind: 'info' });
  expect(reports[0]).toEqual({ ok: true, value: { confirmed: null } });
}, 15000);

it('carries appDataWorkspace from the author all the way to the Agent session', async () => {
    // 这条正是当初被 `appRuntimeScript.ts` 一个硬写的 null 吞掉的参数：作者挑了
    // 子目录、界面回显了，实际 Agent 还跑在 appdata 根上。Agent cwd 是进程级
    // `--agent-dir`，SDK 子进程 spawn 时读一次，run 时补不上 —— 所以必须跟着
    // ensure 一起走。
    bridgeEnsureSession.mockResolvedValue({ sessionId: 'miniapp_wire-probe_main', port: 4321 });
    const { reports } = await mountAndBoot(
      "window.app.agent.ensureSession({ appDataWorkspace: 'notes' })",
      { agent: { enabled: true } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 这个分支在 renderer 就地截走，请求根本不该到 sidecar。
    expect(apiPostJson).not.toHaveBeenCalled();
    // 作者挑的子目录真的跟着 ensure 走了（runId 固定 'main'：一个 iframe = 一个会话）。
    expect(bridgeEnsureSession).toHaveBeenCalledWith('main', 'notes');
    // 两个键都返回：照参考文档读 sessionId 的作者才拿得到值。
    expect(reports[0]).toEqual({
      ok: true,
      value: {
        session_id: 'miniapp_wire-probe_main',
        sessionId: 'miniapp_wire-probe_main',
        app_data_workspace: 'notes',
      },
    });
  }, 15000);

  it('refuses an appDataWorkspace that would escape appdata, before the session exists', async () => {
    const { reports } = await mountAndBoot(
      "window.app.agent.ensureSession({ appDataWorkspace: '../evil' })",
      { agent: { enabled: true } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 校验在**建 session 之前**：非法名不该留下一个后台 Node 进程。
    expect(bridgeEnsureSession).not.toHaveBeenCalled();
    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; code?: string };
    expect(reported.ok).toBe(false);
    expect(reported.code).toBe('INVALID_PARAMS');
  }, 15000);

  it('refuses app.agent entirely when the app never declared it', async () => {
    const { reports } = await mountAndBoot(
      'window.app.agent.ensureSession({})',
      {},
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(bridgeEnsureSession).not.toHaveBeenCalled();
    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean };
    expect(reported.ok).toBe(false);
  }, 15000);

  it('runs an agent turn on the MiniApp sidecar port, never the global sidecar', async () => {
    // 回合必须发到**专用** sidecar：跑在全局 sidecar 上时 SSE 事件与 abort 命中不了
    // 同一个 turn，作者看到的是"调用成功、回合从没发生"。
    //
    // 调用形态必须是 SKILL.md:110 教作者的**位置参数**形态。facade 是
    // run(prompt, o)；第一版这里写的是 run({prompt:'hi'}) —— 对象进了 prompt 槽，
    // 真 sidecar 的 requireString 会当场拒掉。这个用例一直是绿的，只因为
    // proxyFetch 被 mock、sidecar 根本没参与，于是"作者根本写不出这种调用"
    // 没有任何一层会报。改正形态的同时补上 prompt 转发断言 —— 否则"prompt 压根没送出去"
    // 和"prompt 是个对象"测起来没区别。
    bridgeEnsureSession.mockResolvedValue({ sessionId: 'miniapp_wire-probe_main', port: 51999 });
    proxyFetch.mockResolvedValue({ json: async () => ({ ok: true, result: { text: 'done' } }) });
    const { reports } = await mountAndBoot(
      "window.app.agent.run('hi')",
      { agent: { enabled: true } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // 端口来自 bridge，路径带方法名 —— 两者错了就是打错进程。
    expect(proxyFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51999/api/miniapp/app/agent.run',
      expect.objectContaining({ method: 'POST' }),
    );
    // prompt 必须真的进了请求体。"调用成功"和"模型收到了这句话"是两件事。
    const runBody = JSON.parse((proxyFetch.mock.calls[0][1] as { body: string }).body);
    expect(runBody.params).toEqual(expect.objectContaining({ prompt: 'hi' }));
    // 绝不能同时走 apiPostJson（那是全局 sidecar）。
    expect(apiPostJson).not.toHaveBeenCalled();
    expect(reports[0]).toEqual({ ok: true, value: { text: 'done' } });
  }, 15000);

  it('reaches the host as agent.turnText, keeping the alias name the author called', async () => {
    // turnText 与 run 在 sidecar 是同一个 case，**但是两个入口**：作者调用的方法名
    // 必须原样出现在 URL 里。把它偷偷改成 agent.run 在功能上等价（同一个 case 收），
    // 于是没有任何一侧会红 —— 除非有人在这里钉住名字。这正是本条存在的理由。
    //
    // 形态取自 SKILL.md:112 的位置参数写法。
    bridgeEnsureSession.mockResolvedValue({ sessionId: 'miniapp_wire-probe_main', port: 51999 });
    proxyFetch.mockResolvedValue({ json: async () => ({ ok: true, result: { text: 'more' } }) });
    const { reports } = await mountAndBoot(
      "window.app.agent.turnText('hi again')",
      { agent: { enabled: true } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(proxyFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51999/api/miniapp/app/agent.turnText',
      expect.objectContaining({ method: 'POST' }),
    );
    // 别名有自己独立的参数拼装（prompt 取自 text 而非 prompt）。字段名拼错时
    // sidecar 报的是 requires a prompt，症状同样伪装成"能调用"。
    const body = JSON.parse((proxyFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.params).toEqual(expect.objectContaining({ prompt: 'hi again' }));
    expect(reports[0]).toEqual({ ok: true, value: { text: 'more' } });
  }, 15000);

  it('never lets a workspace travel with agent.cancel, so cancel keeps working', async () => {
    // cancel 只瞄准一个已有 turn，既不建 session 也不该关心 workspace。给 cancel 带上
    // workspace 校验，会让"挑过子目录"之后**所有** cancel 都失败 —— 纯属自伤。
    //
    // 防线在 runtime：`agent.cancel(id)` 只转发 `{run_id}`，workspace 根本到不了宿主。
    // 所以这里钉的是那个**真实**的保证（cancel 仍然成功，且出站信封里没有
    // workspace 键），而不是去测派发层那个 public API 根本走不到的分支。
    bridgeEnsureSession.mockResolvedValue({ sessionId: 'miniapp_wire-probe_main', port: 51999 });
    proxyFetch.mockResolvedValue({ json: async () => ({ ok: true, result: { cancelled: true } }) });
    const { reports, outbound } = await mountAndBoot('window.app.agent.cancel()', {
      agent: { enabled: true },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    const call = outbound.find((m) => m.kind === 'app.call') as
      | { payload: { method: string; params: Record<string, unknown> } }
      | undefined;
    expect(call, 'cancel never reached the host').toBeTruthy();
    // 注意断的是 `payload.params`，不是 `payload`：信封本身是
    // {method, params, appId}，在它上面找 appDataWorkspace 永远找不到 ——
    // 这条断言第一版就写错了地方，变异 U1（让 runtime 真的把 workspace 带上）
    // 跑出来是绿的才发现。
    expect(call!.payload.method).toBe('agent.cancel');
    expect(Object.keys(call!.payload.params)).toEqual(['run_id']);
    expect(reports[0]).toEqual({ ok: true, value: { cancelled: true } });
    expect(proxyFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51999/api/miniapp/app/agent.cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  }, 15000);

  it('passes fs.readFile straight through to the sidecar instead of deciding in the renderer', async () => {
    // `fs.*` 是唯一 renderer 判不了的一族（rendererCanDecide）：路径模板要靠 sidecar 的
    // currentAgentDir 展开成绝对前缀，renderer 拿未展开的模板去比前缀恒不匹配，于是
    // 曾经把三个 bundled MiniApp 的 fs 能力全部变成"等于不存在"。
    // 这里钉的是**它确实透传**了：renderer 不预判，但也不能吞掉。
    apiPostJson.mockResolvedValue({ ok: true, result: 'file bytes' });
    const { reports } = await mountAndBoot(
      "window.app.fs.readFile('notes.txt')",
      { fs: { read: ['{appdata}/**'] } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/app/fs.readFile', {
      appId: APP_ID,
      // `opts: null` 是 runtime 的真实形状（第二个参数缺省时归一成 null）。
      params: { path: 'notes.txt', opts: null },
    });
    expect(reports[0]).toEqual({ ok: true, value: 'file bytes' });
  }, 15000);

  it('sends ai.chat to the host AI and returns the completion to the author', async () => {
    // 复用宿主 Provider，MiniApp 不自带 Key；allowed_models 之外的模型要被拒。
    const hostAnswer = { text: 'hello from the model' };
    apiPostJson.mockResolvedValue({ ok: true, result: hostAnswer });
    const { reports } = await mountAndBoot("window.app.ai.chat('hi')", {
      ai: { enabled: true },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/app/ai.chat', {
      appId: APP_ID,
      params: expect.objectContaining({ prompt: 'hi' }),
    });
    expect(reports[0]).toEqual({ ok: true, value: hostAnswer });
  }, 15000);

  it('refuses ai.chat when the app never enabled ai', async () => {
    const { reports } = await mountAndBoot("window.app.ai.chat('hi')", {});

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; code?: string };
    expect(reported.ok).toBe(false);
    expect(typeof reported.code).toBe('string');
  }, 15000);

  it('refuses app.call when the app has no running worker, naming the fix', async () => {
    // 没有 worker 时必须**拒**并说清怎么修，而不是静默 —— 作者看到的是一个带指引的
    // 错误，而不是一个永远 pending 的 Promise。
    const { reports } = await mountAndBoot("window.app.call('anything', {})", {
      node: { enabled: true },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; message?: string };
    expect(reported.ok).toBe(false);
    // 错误文案要指向真正的修法（meta.kind = "worker" + worker_kind），不是原始异常。
    expect(reported.message).toContain('worker');
  }, 15000);

  it('refuses app.call unless the app declared the node capability', async () => {
    // node 是 worker MiniApp 的命脉：没声明就不许起自定义方法。
    const { reports } = await mountAndBoot("window.app.call('anything', {})", {});

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; message?: string };
    expect(reported.ok).toBe(false);
    expect(reported.message).toContain('node');
  }, 15000);

  it('answers a worker call that arrives before the worker is ready, instead of hanging', async () => {
    // 作者脚本是在文档解析时就跑的，worker spawn 是异步的 —— 这个竞态是真实的。
    // bundled 的 worker MiniApp（git-graph / file-explorer）都自己把调用排到
    // `worker.ready` 之后；但作者忘了排队的后果必须是**一句能照着改的话**，
    // 不是永久 pending（这正是"app.call 没生效"最难查的那一类症状）。
    apiGetJson.mockResolvedValue({ ok: true, kinds: [{ kind: 'git-graph', methods: ['git.log'] }] });
    apiPostJson.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/miniapp/worker/spawn'
          ? { ok: true, workerId: 'w-42', methods: ['git.log'] }
          : { ok: true, result: null },
      ),
    );

    const { reports } = await mountAndBoot(
      "window.app.call('git.log', { limit: 1 })",
      { node: { enabled: true } },
      { kind: 'worker', workerKind: 'git-graph' },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 5000 });

    const reported = reports[0] as { ok: boolean; message?: string };
    expect(reported.ok).toBe(false);
    expect(reported.message).toContain('worker_kind');
    // 没有 worker 可打时绝不能去调 RPC —— 那样只会得到一个更难懂的错。
    expect(apiPostJson).not.toHaveBeenCalledWith('/api/miniapp/worker/call', expect.anything());
  }, 20000);

  it('routes an established worker call to that app’s own worker, by method name', async () => {
    // 第五条派发路：app.call → worker 池 RPC。这里直接注册 workerId，绕开 spawn
    // effect（那一半由 MiniAppRunner.workerCall.test.tsx 负责），只测**派发**这一半 ——
    // 之前 `callWorkerMethod` 的方法名提取在整个仓里一处断言都没有。
    //
    // workerId 从注册表按 appId 取：同一个 iframe 的所有 app.call 必须命中**同一个**
    // worker 实例，每次调用都 spawn 一个孤儿进程就是从这儿错的。
    registerWorkerId(APP_ID, 'w-42');
    const hostAnswer = { entries: ['c0ffee'] };
    apiPostJson.mockResolvedValue({ ok: true, result: hostAnswer });

    const { reports } = await mountAndBoot("window.app.call('git.log', { limit: 1 })", {
      node: { enabled: true },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/worker/call', {
      workerId: 'w-42',
      method: 'git.log',
      params: { limit: 1 },
    });
    expect(reports[0]).toEqual({ ok: true, value: hostAnswer });
  }, 15000);

  it('pushes an agent event into the iframe and delivers it to the author’s listener', async () => {
    // 通道的**推送**方向：`app.event` 没有回信，作者的 onEvent 回调是被宿主推进来的。
    // 之前所有用例都只验了请求-应答那一半，这一半整个没被测过。
    // 风险点是展开顺序：payload 自带 type，放在 `type:` 之后会被覆盖成 undefined，
    // iframe 侧就再也分不出 delta / complete（作者收到一串 type 缺失的事件）。
    bridgeEnsureSession.mockResolvedValue({ sessionId: 'miniapp_wire-probe_main', port: 51999 });
    bridgeSubscribe.mockResolvedValue(() => undefined);
    const { reports, iframe } = await mountAndBoot(
      `(function () {
         window.__wireEvents = [];
         window.app.agent.onEvent(function (e) { window.__wireEvents.push(e); });
         return 1;
       })()`,
      { agent: { enabled: true } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });
    // 注册事件时 session 与 SSE 都得就绪，否则订阅是个"能注册却永远收不到事件"的空壳。
    expect(bridgeEnsureSession).toHaveBeenCalled();
    expect(bridgeSubscribe).toHaveBeenCalled();

    // 模拟一条 SSE 事件：宿主用 setPost 注入的转发器把它推进 iframe。
    const post = bridgeSetPost.mock.calls.at(-1)?.[0] as
      | ((payload: unknown) => void)
      | undefined;
    expect(post, 'the bridge never received a post function').toBeTruthy();
    post!({ type: 'agent.delta', text: 'hi', runId: 'main' });

    const frameEvents = () =>
      (iframe.contentWindow as unknown as { __wireEvents?: Record<string, unknown>[] })
        .__wireEvents ?? [];
    await waitFor(() => expect(frameEvents()).toHaveLength(1), { timeout: 3000 });
    // payload 自带的 type 必须活下来。
    expect(frameEvents()[0]).toMatchObject({ type: 'agent.delta', text: 'hi' });
  }, 15000);

  it('round-trips a storage value, which has no path and no permission gate', async () => {
    // storage 是唯一"无路径、无授权"的一族：它存的是这个 MiniApp 自己的东西。
    // 形状也不同（key/value，不是 {path, opts}），所以要单独钉。
    apiPostJson.mockResolvedValue({ ok: true, result: 'stored-value' });
    const { reports } = await mountAndBoot("window.app.storage.get('k')", {});

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/app/storage.get', {
      appId: APP_ID,
      params: { key: 'k' },
    });
    expect(reports[0]).toEqual({ ok: true, value: 'stored-value' });
  }, 15000);

  it('refuses an allow-listed command that smuggles a second command in', async () => {
    // allow-list 只看**第一个词**，于是 'echo && rm -rf /' 的第一个词是 echo、在名单上。
    // 挡住它的是 metacharacter 那道闸 —— 少了它，这条就是一个能删盘的许可。
    const { reports } = await mountAndBoot("window.app.shell.exec('echo hi && del /')", {
      shell: { allow: ['echo'] },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean };
    expect(reported.ok).toBe(false);
  }, 15000);

  it('refuses shell.exec when the command is not on the allow list', async () => {
    // shell 是最危险的一档：无 Node 的 iframe 也能起进程。
    // 注意作者侧签名是 `exec(cmd, opts)` —— 第一个参数是**字符串**，不是对象
    // （runtime 内部才拼成 `{command, opts}`）。传对象会被 checkShell 以
    // INVALID_PARAMS 拒掉，于是这条用例会"因为错的原因绿"，什么都测不到。
    const { reports } = await mountAndBoot(
      "window.app.shell.exec('curl https://evil.example')",
      { shell: { allow: ['echo'] } },
    );

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    expect(apiPostJson).not.toHaveBeenCalled();
    const reported = reports[0] as { ok: boolean; code?: string };
    expect(reported.ok).toBe(false);
    expect(typeof reported.code).toBe('string');
  }, 15000);

  it('runs an allow-listed shell command and hands the output back to the author', async () => {
    // 形状必须是 sidecar **真的**发出来的那一份（miniapp-app-dispatch.ts 的
    // {stdout, stderr, exit_code}，SKILL.md:68 也是这么写的）。此前这里 stub 的是
    // {stdout, exitCode} —— 一个宿主永远不会发出的形状：断言照样绿，因为这一层
    // 是纯透传，但它对『作者拿到的字段名对不对』零保护。真作者读 r.exitCode 拿到
    // 的是 undefined，而没有任何一条用例会红。
    const hostAnswer = { stdout: 'hello\n', stderr: '', exit_code: 0 };
    apiPostJson.mockResolvedValue({ ok: true, result: hostAnswer });
    const { reports } = await mountAndBoot("window.app.shell.exec('echo hello')", {
      shell: { allow: ['echo'] },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    // opts: null 是 runtime 的真实形状（第二个参数缺省时归一成 null）。
    expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/app/shell.exec', {
      appId: APP_ID,
      params: { command: 'echo hello', opts: null },
    });
    // 逐字段断言而不是整体 toEqual：纯透传下整体相等恒成立，等于什么都没验。
    const value = (reports[0] as { ok: boolean; value: Record<string, unknown> }).value;
    expect(value.stdout).toBe('hello\n');
    expect(value.stderr).toBe('');
    expect(value.exit_code).toBe(0);
  }, 15000);

  it('carries a non-zero exit_code and stderr back instead of flattening failure', async () => {
    // 非零退出在 sidecar 是 ok:true + exit_code（命令跑了，只是失败了）。这一层若
    // 把它压成异常、或丢掉 exit_code，作者就没法区分『命令失败』与『宿主出错』。
    const hostAnswer = { stdout: '', stderr: 'fatal: not a git repository', exit_code: 128 };
    apiPostJson.mockResolvedValue({ ok: true, result: hostAnswer });
    const { reports } = await mountAndBoot("window.app.shell.exec('git log')", {
      shell: { allow: ['git'] },
    });

    await waitFor(() => expect(reports).toHaveLength(1), { timeout: 3000 });

    const reported = reports[0] as { ok: boolean; value: Record<string, unknown> };
    expect(reported.ok).toBe(true);
    expect(reported.value.exit_code).toBe(128);
    expect(reported.value.stderr).toBe('fatal: not a git repository');
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
