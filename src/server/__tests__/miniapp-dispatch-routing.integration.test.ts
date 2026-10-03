/**
 * 「名单里的每个方法都真的接到了执行层」——无副作用版（integration 池）。
 *
 * ## 为什么已经有 `miniapp-app-dispatch.integration.test.ts` 还要这一份
 *
 * 那份文件里有一条 `never answers UNKNOWN_METHOD for a declared method` 护栏，
 * 看起来正是这件事，但覆盖不到它要防的故障，原因有两个，都不是"测试写得不够
 * 仔细"，而是断言方式本身够不着：
 *
 * 1. **它用空参数 `{}` 调用。** `checkFs` 先查路径再查方法名，缺参数时先以
 *    `INVALID_PARAMS` 失败 —— `dispatchFs` 的 switch **根本没被进入**。所以
 *    删掉 `case 'readFile'`，这条护栏照样绿。注释里"都走完「组分派 + 组内路由」
 *    而不产生副作用"是反的：恰恰是没走完。
 * 2. **它显式跳过 `ai.getModels` 与 `agent.ensureSession`**，理由写的是"它们确实
 *    接线了由本文件上方的 ai/agent 闸门与 ai.cancel 两条 describe 证明"。全仓库
 *    grep 过：没有任何测试 dispatch 过这两个方法。那两条 describe 测的是
 *    **权限闸门**（`checkAppPermission`），不是**路由可达性**。一条会误导后来人
 *    以为已经覆盖的注释，比没有注释更糟。
 *
 * 本项目被"声明了但没接线"咬过三次（`onActivate` / `onDeactivate` 无推送、
 * `ai.cancel` 无中止点、`agent.onEvent` 无事件源），所以这个洞必须堵死而不是
 * 写明。
 *
 * ## 本文件怎么做到既全覆盖又不真跑
 *
 * 关键是**给每个方法喂它真正需要的参数**，让权限闸门放行、switch 真的被进入。
 * 会产生真实副作用或外联的三个叶子就地打桩：
 *   - `miniapp-ai` / `miniapp-agent`：会 spawn 真实 SDK / Sidecar 进程；
 *   - `utils/cancellation` 的 `cancellableFetch`：`checkNet` 强制 https 且拒绝私网
 *     地址，所以 `net.fetch` **不可能**在 no-egress 池里被真跑到 —— 只能打桩。
 * `shell.exec` 保留真跑 `git --version`：它是本地 spawn 不是外联，几十毫秒，而
 * 打桩 `node:child_process` 反而会把这层一起假装掉。git 不在 PATH 时它返回
 * 非零退出码，断言（非 UNKNOWN_METHOD）依然成立。
 *
 * `dialog.*` / `clipboard.*` / `call.call` 归 renderer（见
 * `appHostDispatch.ts`），sidecar 侧本来就该显式失败。这里断言的是**那三段失败
 * 各自的原话**，因为它们和"漏接线"在错误码上可能撞车 —— 光断言"不是
 * UNKNOWN_METHOD"分不清"设计如此"和"忘了接"。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listAppMethods } from '../../shared/miniapp/app-protocol';

const APP_ID = 'routing-probe';

let sandboxHome = '';

// 这两个叶子会起真实进程。桩只回形状，路由是否可达才是这里要断言的东西。
const aiProducers = {
  runMiniAppAiComplete: vi.fn(async (_params: Record<string, unknown>) => ({ ok: true, result: { text: '', usage: null } })),
  listMiniAppAiModels: vi.fn(async () => ({ ok: true, result: [] })),
  cancelMiniAppAiCall: vi.fn(() => ({ cancelled: false, inflightCount: 0 })),
};
const agentProducers = {
  runMiniAppAgentTurn: vi.fn(async (_params: Record<string, unknown>) => ({ ok: true, result: { run_id: 'r1' } as Record<string, unknown> })),
  stopMiniAppAgentTurn: vi.fn(async () => ({ ok: true, result: { stopped: true } })),
  describeMiniAppAgentStream: vi.fn(async () => ({ ok: true, result: { session_id: 'stub' } })),
};

vi.mock('../utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

vi.mock('../miniapp-ai', () => aiProducers);
vi.mock('../miniapp-agent', () => agentProducers);

// 只换掉真正会开 socket 的那一个。同步工厂：同目录那份 e2e 测试用的就是这个
// 写法，异步 importOriginal 工厂会把模块求值推成异步，与本文件已有的顶层
// `await import` 叠加后，import 绑定在 vi.mock 提升点尚未就绪。
vi.mock('../utils/cancellation', () => ({
  cancellableFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  withAbortSignal: vi.fn(),
}));

const { dispatchMiniAppApp } = await import('../miniapp-app-dispatch');

function appDir(): string {
  return join(sandboxHome, 'miniapps', APP_ID);
}

function writeMeta(): void {
  mkdirSync(appDir(), { recursive: true });
  writeFileSync(
    join(appDir(), 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Routing Probe',
      description: 'routing fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions: {
        fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] },
        shell: { allow: ['git'] },
        net: { allow: ['api.example.com'] },
        node: { enabled: true },
        ai: { enabled: true },
        agent: { enabled: true },
        // 剪贴板是 opt-in 的（见 app-permissions.ts::checkClipboard）。这里必须
        // 显式授予，否则下面那条用例测到的是权限闸而不是路由，两回事。
        clipboard: { enabled: true },
        storage: {},
      },
    }),
    'utf8',
  );
}

/**
 * 每个方法**真正需要**的参数。空参数会让 `checkFs` / `checkShell` / `checkNet`
 * 在到达执行层之前就失败 —— 那正是旧护栏形同虚设的原因。
 */
function paramsFor(method: string): unknown {
  const [group, name] = method.split('.');
  const target = join(appDir(), 'probe.txt');
  switch (group) {
    case 'fs':
      return name === 'readFile' || name === 'writeFile' || name === 'appendFile'
        ? { path: target, from: target, to: target, data: 'probe' }
        : { path: target, from: target, to: target };
    case 'shell':
      return { command: 'git --version' };
    case 'net':
      return { url: 'https://api.example.com/probe' };
    case 'storage':
      return { key: 'probe', value: 1 };
    case 'ai':
      return { prompt: 'probe', run_id: 'r1' };
    case 'agent':
      return { prompt: 'probe', run_id: 'r1' };
    default:
      return {};
  }
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'miniapp-routing-'));
  writeMeta();
  vi.clearAllMocks();
});

afterEach(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // Windows 上文件句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('every declared method reaches a real producer', () => {
  it('no declared method falls through to the unknown-method branch', async () => {
    const unreachable: string[] = [];
    for (const method of listAppMethods()) {
      const res = await dispatchMiniAppApp(method, APP_ID, paramsFor(method));
      if (!res.ok && res.error?.code === 'UNKNOWN_METHOD') unreachable.push(method);
    }
    expect(unreachable).toEqual([]);
  });

  it('the fs cases are genuinely entered, not short-circuited by the permission layer', async () => {
    // 反向对照：同一个合法路径下，一个**没接线**的 fs 方法必须被识别出来。
    // 这条让上面那个循环不至于在 checkFs 就全数退化成 INVALID_PARAMS —— 那正是
    // 旧护栏的空心之处。
    const target = join(appDir(), 'probe.txt');
    const bogus = await dispatchMiniAppApp('fs.definitelyNotAMethod', APP_ID, { path: target });
    expect(bogus.ok).toBe(false);
    expect(bogus.error?.code).toBe('UNKNOWN_METHOD');
  });

  it('ai.getModels reaches listMiniAppAiModels', async () => {
    const res = await dispatchMiniAppApp('ai.getModels', APP_ID, null);
    expect(res.ok).toBe(true);
    expect(aiProducers.listMiniAppAiModels).toHaveBeenCalledTimes(1);
  });

  it('agent.ensureSession and agent.onEvent reach the stream descriptor', async () => {
    await dispatchMiniAppApp('agent.ensureSession', APP_ID, null);
    expect(agentProducers.describeMiniAppAgentStream).toHaveBeenCalledTimes(1);

    await dispatchMiniAppApp('agent.onEvent', APP_ID, null);
    expect(agentProducers.describeMiniAppAgentStream).toHaveBeenCalledTimes(2);
  });

  it('the renderer-owned groups fail with their own reasons, not with a routing error', async () => {
    // 这三组归 renderer 在离开宿主时就地消化，sidecar 永远够不到。断的是
    // "派发链断了"这一种故障，和"漏接线"必须能被区分开。
    for (const method of ['dialog.open', 'dialog.save', 'dialog.message']) {
      const res = await dispatchMiniAppApp(method, APP_ID, {});
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('HOST_ERROR');
      expect(res.error?.message).toContain('renderer host');
    }
    for (const method of ['clipboard.readText', 'clipboard.writeText']) {
      const res = await dispatchMiniAppApp(method, APP_ID, {});
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('HOST_ERROR');
      expect(res.error?.message).toContain('renderer host');
    }

    const call = await dispatchMiniAppApp('call.call', APP_ID, { method: 'anything' });
    expect(call.ok).toBe(false);
    expect(call.error?.code).toBe('PERMISSION_DENIED');
    expect(call.error?.message).toContain('worker bridge');
  });
});

/**
 * `storage.set` 的读-改-写必须整体持锁。
 *
 * 失败形态特别隐蔽：20 个并发 set 各自 `await readFile` 拿到同一份空快照，
 * 各自 resolve，最后一个写 wins —— **所有 Promise 都成功**，作者那边看不出任何
 * 异常，只有回读时才发现 19 个 key 没了。路由类断言永远看不到这一层：它们只
 * 检查方法有没有接上，不检查并发下的正确性。
 */
describe('storage mutations are serialized', () => {
  it('every concurrent set survives instead of last-writer-wins', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);

    const results = await Promise.all(
      keys.map((key, i) => dispatchMiniAppApp('storage.set', APP_ID, { key, value: i })),
    );
    // 全部 resolve —— 丢写不是错误，是静默的数据消失。
    expect(results.every((r) => r.ok)).toBe(true);

    const readBack = await Promise.all(
      keys.map((key) => dispatchMiniAppApp('storage.get', APP_ID, { key })),
    );
    // 逐个比对：只抽查一个 key 看不出"只剩最后一个"的失败形态。
    expect(readBack.map((r) => r.result)).toEqual(keys.map((_, i) => i));
  });

  it('a concurrent set is not lost behind a remove', async () => {
    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'keep', value: 'v' });
    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'drop', value: 'v' });

    const [, , read] = await Promise.all([
      dispatchMiniAppApp('storage.remove', APP_ID, { key: 'drop' }),
      dispatchMiniAppApp('storage.set', APP_ID, { key: 'fresh', value: 1 }),
      dispatchMiniAppApp('storage.get', APP_ID, { key: 'keep' }),
    ]);

    expect(read.result).toBe('v');
    const fresh = await dispatchMiniAppApp('storage.get', APP_ID, { key: 'fresh' });
    expect(fresh.result).toBe(1);
    const dropped = await dispatchMiniAppApp('storage.get', APP_ID, { key: 'drop' });
    expect(dropped.result).toBeUndefined();
  });
});

/**
 * `app.ai` 的入参归一。
 *
 * 参考文档给的是两种形态：`complete(prompt, opts)` 用字符串，`chat(messages,
 * opts)` 用 `Array<{role, content}>`。旧实现两条路都用 `requireString`，于是
 * 照文档写 `chat` 的作者拿到 `INVALID_PARAMS` —— 文档里的标准写法跑不通。
 *
 * 这些断言只看**归一后的入参**，不碰模型：`runMiniAppAiComplete` 在本文件里
 * 是桩，真实模型调用属于 `credentialed` 池。
 */
describe('app.ai accepts the argument shapes the reference documents', () => {
  it('ai.chat accepts a messages array and flattens it into the prompt', async () => {
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, {
      prompt: [
        { role: 'user', content: '设计一个首页图标' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '圆角风格' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(aiProducers.runMiniAppAiComplete).toHaveBeenCalledTimes(1);
    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].prompt).toBe(
      'user: 设计一个首页图标\n\nassistant: 好的\n\nuser: 圆角风格',
    );
  });

  it('ai.complete still accepts the plain string form', async () => {
    await dispatchMiniAppApp('ai.complete', APP_ID, { prompt:  '  hello  ' });

    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].prompt).toBe('hello');
  });

  it('malformed message entries are dropped rather than stringified into the prompt', async () => {
    const res = await dispatchMiniAppApp('ai.chat', APP_ID, {
      prompt: [
        { role: 'user' },
        { content: '没有 role' },
        null,
        '字符串条目',
        { role: 'user', content: '   ' },
        { role: 'user', content: '唯一有效的一条' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].prompt).toBe('user: 唯一有效的一条');
  });

  it('an entirely unusable prompt is still INVALID_PARAMS', async () => {
    for (const prompt of [null, '', '   ', [], [{ role: 'user' }], 42, {}]) {
      const res = await dispatchMiniAppApp('ai.chat', APP_ID, { prompt });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('INVALID_PARAMS');
    }
    expect(aiProducers.runMiniAppAiComplete).not.toHaveBeenCalled();
  });

  it('opts.systemPrompt reaches the producer instead of being dropped', async () => {
    await dispatchMiniAppApp('ai.complete', APP_ID, {
      prompt: 'hi',
      opts: { systemPrompt: '你是一个图标设计专家' },
    });

    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].systemPrompt).toBe(
      '你是一个图标设计专家',
    );
  });

  it('absent systemPrompt stays undefined so the default still applies downstream', async () => {
    await dispatchMiniAppApp('ai.complete', APP_ID, { prompt: 'hi' });

    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].systemPrompt).toBeUndefined();
  });

  it('maxTokens is honoured in both the reference camelCase and our snake_case', async () => {
    await dispatchMiniAppApp('ai.complete', APP_ID, {
      prompt: 'hi',
      opts: { maxTokens: 4096 },
    });
    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].maxTokens).toBe(4096);

    vi.clearAllMocks();
    await dispatchMiniAppApp('ai.complete', APP_ID, {
      prompt: 'hi',
      opts: { max_tokens: 2048 },
    });
    expect(aiProducers.runMiniAppAiComplete.mock.calls[0][0].maxTokens).toBe(2048);
  });
});

/**
 * `app.agent.run` 的 `sessionId` 契约。
 *
 * 参考文档让作者把 `ensureSession()` 的返回值回传给 `run`。本项目每个 MiniApp
 * 只有一个 Agent 会话，所以不按 id 选会话 —— 但**静默忽略**同样不行：作者传
 * 别的 MiniApp 的 sessionId 时，拿到的是一段他自己无法解释来源的输出。
 * 传了就必须对得上。
 */
describe('app.agent.run validates the sessionId it is handed', () => {
  it('forwards a non-empty sessionId to the producer', async () => {
    await dispatchMiniAppApp('agent.run', APP_ID, {
      prompt: 'hi',
      sessionId: 'miniapp_routing-probe_main',
    });

    expect(agentProducers.runMiniAppAgentTurn.mock.calls[0][0].sessionId).toBe(
      'miniapp_routing-probe_main',
    );
  });

  it('an empty or absent sessionId means "not provided", not a mismatch', async () => {
    // 参考示例写的是 session.sessionId；在返回 camelCase 别名之前那就是
    // undefined，作者照抄会传一个空值进来 —— 不能因此报 INVALID_PARAMS。
    for (const params of [
      { prompt: 'hi' },
      { prompt: 'hi', sessionId: '' },
      { prompt: 'hi', sessionId: undefined },
    ]) {
      vi.clearAllMocks();
      const res = await dispatchMiniAppApp('agent.run', APP_ID, params);
      expect(res.ok).toBe(true);
      expect(agentProducers.runMiniAppAgentTurn.mock.calls[0][0].sessionId).toBeUndefined();
    }
  });
});

// 「传了但对不上」这条判定住在 miniapp-agent.ts（只有它知道本进程绑的是哪个
// 会话），本文件把 `../miniapp-agent` 整个 mock 掉了，所以那条判定由
// `miniapp-agent-session-guard.unit.test.ts` 直接测真正的实现。
