/**
 * `app.agent.*` 全链路（integration 池，**零成本**）。
 *
 * 与姊妹文件 `miniapp-ai-wire.integration.test.ts` 同源：把宿主 provider 指向
 * 一个 loopback mock，于是 SDK 子进程真的被 spawn、真的跑一个 turn，全链路
 * 都不需要真实凭据。
 *
 * 这一层补的是 `app.agent` 独有的东西，而它恰恰是 `app.ai` 证明不了的部分：
 *
 *   1. **workspace 真的交到 Agent 手里**。`app.ai` 固定 `tools: []`，工作区对
 *      它没有意义；`app.agent` 给的是有工具的模型，workspace 是它能不能读写
 *      文件的唯一依据。这段交接此前**没有任何实跑证据**。
 *   2. `runInjectedTurn` 这条 facade 链路本身（CLAUDE.md 规定新端点 MUST 走
 *      `session-engine/` facade，就是怕手写 runtime 分支导致静默空转 + 假成功）。
 *   3. turnOwner —— `agent.cancel` 靠它瞄准这一个 turn。`run` 和 `cancel` 必须
 *      读**同一个** `run_id`，否则取消会打不中。
 *
 * 注意 sidecar 的 role 必须是 `session`：MiniApp 的 Agent 会话是 1:1 的专用
 * sidecar（见 `miniapp-agent.ts` 头部），`getSessionEngine()` 是进程级单例、
 * 绑定本进程宿主的那一个 Session。用 `global` 起会跑到错的那个宿主上。
 *
 * 与 ai-wire 共享的两个坑（详见那个文件的头部）：mock 必须建在 `node:http`
 * 上；provider/set 之后要等 session 重启落定，否则第一次 turn 会和 SDK 子进程
 * 的重建抢跑。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const AGENT_APP = 'agent-wire-probe';
const DENIED_APP = 'agent-wire-denied';
const COMPLETION = 'AGENT_WIRE_COMPLETION';
const PROMPT = 'PROBE_PROMPT_MARKER do the thing';

let baseUrl = '';
let scratch = '';
let appdata = '';
let child: ChildProcess | undefined;
/** agent-dir 落在 appdata 子目录上的第二个 sidecar（`appDataWorkspace` 生效后的形态）。 */
let segmentChild: ChildProcess | undefined;
let segmentBaseUrl = '';
let sidecarOutput = '';
let mock: Server | undefined;
/** mock 收到的每个 `/v1/messages` 请求体，用来证明 prompt / workspace 真的到位了。 */
const mockBodies: string[] = [];

/**
 * 掐住 `/v1/messages` 的响应，让一次 Agent turn 真的停在"在途"状态。
 *
 * `app.agent.cancel` 只能打中一个已经注册成 turn owner 的在途 turn，而 mock
 * 默认秒回 —— `agent.run` 早已收尾，中止表里没有这条 owner，cancel 命中不了，
 * 于是"取消 Agent"这条能力在整份测试里从来没有被真正执行过一次。
 */
let holdResponses: Promise<void> | null = null;
let releaseHold: (() => void) | null = null;

/**
 * 工具回合脚本：非 null 时，mock 的**第一次** `/v1/messages` 回一个真的
 * `tool_use`，SDK 侧会真的去执行那个工具；带 `tool_result` 回来的第二次请求
 * 才收尾成文本。
 *
 * 之前这份 fixture 只会回纯文本，于是 `app.agent` 最有价值的那一半 —— 模型
 * 真的动手改文件 —— 在整条链路上**一次都没有跑过**。只断言"回合成功 + 文本对"
 * 的话，工具集被清空、cwd 传错、tool_result 没回灌，这些都会照样绿灯。
 */
let toolScript: { id: string; name: string; input: Record<string, unknown> } | null = null;

function armHold(): void {
  holdResponses = new Promise<void>(res => { releaseHold = res; });
}

function disarmHold(): void {
  releaseHold?.();
  holdResponses = null;
  releaseHold = null;
}

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(res => server.listen(0, '127.0.0.1', () => res()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
  return port;
}

function startMockProvider(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      if (!String(req.url ?? '').includes('/v1/messages')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      mockBodies.push(body);
      // 先记账再挂起：调用方就是靠 mockBodies 增长来判定"turn 已经在途"。
      if (holdResponses) await holdResponses;
      // SDK 被 interrupt 后会拆掉这条连接，对已断开的 res 写会抛
      // ERR_STREAM_WRITE_AFTER_END，冒泡成 mock 的未捕获异常。
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const ev = (type: string, data: unknown): void => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      ev('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_probe',
          type: 'message',
          role: 'assistant',
          model: 'probe-model',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      // 工具回合脚本。`body.includes('tool_result')` 是"这一轮已经跑过工具了"的
      // 判据：SDK 把工具结果回灌进下一次请求，body 里就会出现这个字段。
      if (toolScript) {
        const armed = toolScript;
        // 只服务一次。**不能**用 `!body.includes('tool_result')` 判断"这轮还没跑过
        // 工具"：agent 会话是持久的，前面某一轮的 tool_result 会一直留在对话历史
        // 里，于是从第二轮起这个判据恒为 false、脚本再也不触发 —— 而回合照样
        // 正常收尾，测试全绿。踩过一次：三条工具用例因此全部空转，变异验证
        // （plan→acceptEdits / plan→fullAgency）一条都杀不掉才暴露出来。
        toolScript = null;
        ev('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: armed.id, name: armed.name, input: {} },
        });
        ev('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(armed.input) },
        });
        ev('content_block_stop', { type: 'content_block_stop', index: 0 });
        ev('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 2 },
        });
        ev('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }
      ev('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      ev('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: COMPLETION },
      });
      ev('content_block_stop', { type: 'content_block_stop', index: 0 });
      ev('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      });
      ev('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  server.on('clientError', () => {});
  return new Promise(resolvePromise => {
    server.listen(0, '127.0.0.1', () => {
      resolvePromise({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Sidecar exited early (code=${child.exitCode}):\n${sidecarOutput}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health/ready`);
      if (res.ok) return;
    } catch {
      // 端口还没绑上。
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for sidecar:\n${sidecarOutput}`);
}

function writeApp(id: string, permissions: Record<string, unknown>): void {
  const dir = join(appdata, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      id,
      name: id,
      description: 'end-to-end agent fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions,
    }),
    'utf8',
  );
}

beforeAll(async () => {
  const started = await startMockProvider();
  mock = started.server;

  scratch = mkdtempSync(join(tmpdir(), 'hamuna-miniapp-agent-wire-'));
  const home = join(scratch, 'home');
  const workspace = join(scratch, 'workspace');
  appdata = join(home, '.hamuna', 'miniapps');
  mkdirSync(appdata, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(scratch, 'tmp'), { recursive: true });
  // fs.read 是给"Agent 写的文件能用 app.fs 读回来"那条用例用的。Agent 自带的
  // 工具**不**受 meta.permissions 约束（沙箱由 --agent-dir 夹住，见下面那条
  // cwd 用例的注释），这里的 grant 只管宿主 `app.fs.*` 那一侧。
  writeApp(AGENT_APP, { agent: { enabled: true }, fs: { read: ['{appdata}/**'] } });
  writeApp(DENIED_APP, { agent: { enabled: false } });

  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  // agent-dir 必须是 appdata —— 这正是 Rust `cmd_miniapp_ensure_session` 做的
  // 那一件事（workspace_path = miniapps/<appId>）。MiniApp 的 Agent 之所以被
  // 夹在自己的 appdata 里，靠的是这个进程级 agent dir，而不是某个 per-turn
  // 参数。用别的目录起，测到的就不是线上那条约束了。
  const agentDir = join(appdata, AGENT_APP);
  mkdirSync(agentDir, { recursive: true });
  child = spawn(
    process.execPath,
    [
      '--import',
      'tsx/esm',
      resolve('src/server/index.ts'),
      '--agent-dir',
      agentDir,
      '--port',
      String(port),
      '--no-pre-warm',
      // 必须是 session：MiniApp 的 Agent 会话是 1:1 专用 sidecar。
      '--sidecar-role',
      'session',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: join(scratch, 'tmp'),
        TEMP: join(scratch, 'tmp'),
        TMP: join(scratch, 'tmp'),
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', chunk => { sidecarOutput += chunk.toString(); });
  child.stderr?.on('data', chunk => { sidecarOutput += chunk.toString(); });

  await waitForReady();

  const setRes = await fetch(`${baseUrl}/api/provider/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerEnv: {
        providerId: 'probe-loopback',
        baseUrl: `http://127.0.0.1:${started.port}`,
        apiKey: 'sk-probe-not-a-real-key',
        authType: 'api_key',
      },
    }),
  });
  expect(setRes.ok, `provider/set failed:\n${sidecarOutput}`).toBe(true);
  await delay(1_500);

  // 第二个 sidecar：agent-dir 落在 appdata 的**子目录**上，也就是
  // `appDataWorkspace: 'notes'` 生效后 Rust 会拼出来的那个路径。
  //
  // 为什么必须另起一个进程而不是复用上面那个：cwd 是 SDK 子进程 spawn 时从
  // `--agent-dir` 读一次的，同一个进程里改不了。生产上同一个 MiniApp 只会有一
  // 个 Agent session，所以"根"与"子目录"本来就分属两个 session —— 这里照搬。
  const segmentDir = join(appdata, AGENT_APP, 'notes');
  mkdirSync(segmentDir, { recursive: true });
  const segPort = await reservePort();
  segmentBaseUrl = `http://127.0.0.1:${segPort}`;
  segmentChild = spawn(
    process.execPath,
    [
      '--import',
      'tsx/esm',
      resolve('src/server/index.ts'),
      '--agent-dir',
      segmentDir,
      '--port',
      String(segPort),
      '--no-pre-warm',
      '--sidecar-role',
      'session',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: join(scratch, 'tmp'),
        TEMP: join(scratch, 'tmp'),
        TMP: join(scratch, 'tmp'),
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  segmentChild.stdout?.on('data', chunk => { sidecarOutput += chunk.toString(); });
  segmentChild.stderr?.on('data', chunk => { sidecarOutput += chunk.toString(); });
  // 复用 waitForReady：它读模块级 baseUrl，所以临时换一下再换回来。
  const primaryUrl = baseUrl;
  baseUrl = segmentBaseUrl;
  try {
    await waitForReady();
    const segSet = await fetch(`${segmentBaseUrl}/api/provider/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerEnv: {
          providerId: 'probe-loopback',
          baseUrl: `http://127.0.0.1:${started.port}`,
          apiKey: 'sk-probe-not-a-real-key',
          authType: 'api_key',
        },
      }),
    });
    expect(segSet.ok, `segment provider/set failed:\n${sidecarOutput}`).toBe(true);
    await delay(1_500);
  } finally {
    baseUrl = primaryUrl;
  }
}, 180_000);

afterAll(async () => {
  for (const c of [segmentChild, child]) {
    if (c && c.exitCode === null) {
      c.kill('SIGKILL');
      await new Promise<void>(r => {
        const timer = setTimeout(r, 3_000);
        c.once('exit', () => { clearTimeout(timer); r(); });
      });
    }
  }
  mock?.close();
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows 上句柄可能尚未释放；清理失败不影响断言结论
  }
});

interface Envelope {
  ok: boolean;
  result?: { text?: string; had_message?: boolean; session_id?: string | null; stopped?: boolean };
  error?: { code: string; message: string };
}

async function call(
  method: string,
  params: unknown,
  appId = AGENT_APP,
  base = baseUrl,
): Promise<Envelope> {
  const res = await fetch(`${base}/api/miniapp/app/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, params }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!body || typeof body.ok !== 'boolean') {
    throw new Error(`${method} returned a non-envelope body (HTTP ${res.status})`);
  }
  return body;
}

/**
 * 从 SDK 请求体里取回 Agent 实际的 cwd。
 *
 * SDK 把它写进 system prompt 的 `Primary working directory:` 行。这个行的分隔符
 * 形态**不稳定**：agent dir 以正斜杠传进去时会出现重复分隔符（`C://Users//…`），
 * 以 Windows 原生路径传进去时则是反斜杠。两种都要归一，否则断言会在不同平台上
 * 各自假红。Windows 上还有 8.3 短名（`ADMINI~1`），所以只比对尾部段而不是全路径。
 *
 * **必须先 JSON.parse 再匹配。** 早先直接对原始 body 用 `[^\s"]+`，而请求体里的
 * 换行是 JSON 转义 `\n`（反斜杠 + n 两个字符），**不是空白** —— 正则会一路吃进
 * 下一个字符。实测把 `.../notes` 读成了 `.../notes/n`：归一那一步把转义里的反斜杠
 * 也换成了正斜杠，于是多出来一个 `/n` 段。
 *
 * 这个 bug 一直没被发现，是因为当时所有 cwd 断言都只是 `toContain('/<appId>')`
 * —— 弱断言对多出来的尾巴照单全收。收窄到子目录后必须断 `endsWith`，弱断言就
 * 兜不住了，所以解析顺序也一并修正：parse 之后换行是真的空白，正则自然停对。
 */
function agentCwd(body: string): string {
  const strings: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(JSON.parse(body) as unknown);
  const m = /Primary working directory:\s*([^\s"]+)/.exec(strings.join('\n'));
  expect(m, 'SDK request body carried no "Primary working directory" line').toBeTruthy();
  return (m as RegExpExecArray)[1]
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

describe('app.agent over real HTTP against a real Sidecar and a loopback provider', () => {
  it(
    'runs a real turn and reports the model output, not an empty success',
    async () => {
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT, run_id: 'run-main' });

      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result?.text).toBe(COMPLETION);
      // facade 的 success 不等于"真的有输出"（见 miniapp-agent.ts 的注释）。
      // 只断言 ok:true 的话，静默空转也能骗过这条测试。
      expect(res.result?.had_message).toBe(true);
      // 而且真的走了一趟网络，不是本地伪造的返回值
      expect(mockBodies.length).toBe(before + 1);
    },
    120_000,
  );

  // turnText 是 run 的语义化别名（facade 里两个方法体逐字段相同，只是派发的
  // 方法名不同）。正因为是别名，它此前**一条真实回合测试都没有** —— 现有覆盖
  // 全是 mock 掉回合生产者的路由测试。
  //
  // 风险是具体的：别名路径上任何只属于它的一处断裂（facade 少传一个字段、
  // sidecar 的 case 被改名、renderer 把 turnText 路由到别处）都不会被
  // agent.run 的真实用例看见 —— 两条断言的是同一个 case，但走的是**不同
  // 的入口**。所以这条不是重复，是补入口。
  it(
    'runs a real turn through the agent.turnText alias, not just the run entry',
    async () => {
      const before = mockBodies.length;
      const res = await call('agent.turnText', { prompt: PROMPT, run_id: 'run-alias' });

      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result?.text).toBe(COMPLETION);
      // 与 run 同款的真输出断言：facade 的 ok:true 不代表真的有输出。
      expect(res.result?.had_message).toBe(true);
      // 而且真的走了网络，别名没有绕过 provider。
      expect(mockBodies.length).toBe(before + 1);
    },
    120_000,
  );

  // 工具回合：模型请求工具 → CLI 真的执行 → 结果回灌 → 回合收尾。这一段此前在
  // 整条链路上没有任何实跑证据，cwd 用例只读了 system prompt 里
  // `Primary working directory:` 那一行，证明的是"路径传对了"，不是"内容真的
  // 被读到了"。
  // 读侧能不能真跑，决定 MiniApp 的 agent 到底有没有用。SKILL.md 给的示例是
  // `app.agent.run('总结这个目录的结构')` —— 纯读。只测写会得出"agent 被锁死"
  // 的错误结论，只测读又会漏掉写侧的真实边界，所以两条都要。
  it(
    'runs a real read tool, so the model can inspect the app own sandbox',
    async () => {
      const fileName = `read-probe-${Date.now()}.txt`;
      const bytes = 'READ_PROBE_MARKER bytes';
      // 先把文件放进 appdata：agent 的 cwd 就是这里，它读的是自己的沙箱。
      writeFileSync(join(appdata, AGENT_APP, fileName), bytes, 'utf8');

      toolScript = {
        id: `toolu_read_${Date.now()}`,
        name: 'Read',
        input: { file_path: fileName },
      };
      const before = mockBodies.length;
      let res: Envelope | undefined;
      try {
        res = await call('agent.run', {
          prompt: PROMPT,
          run_id: 'run-read',
          timeout_ms: 30_000,
        });
      } finally {
        toolScript = null;
      }
      const diag = () =>
        `bodies=${mockBodies.length - before}\n` +
        `PERM=${(sidecarOutput.match(/\[permission\].*/g) ?? []).slice(-6).join(' | ')}\n` +
        `TAIL=${sidecarOutput.split('\n').slice(-20).join('\n')}`;
      expect(res?.ok, `${JSON.stringify(res?.error)}\n${diag()}`).toBe(true);
      // 工具回合：模型要一次 Read，拿到 tool_result 才收尾。
      expect(mockBodies.length, diag()).toBe(before + 2);
      // 回灌的那次请求里带着**文件真实内容** —— 读侧真的执行了，不是被拒后
      // 把错误文案当结果。
      expect(mockBodies[mockBodies.length - 1], diag()).toContain(bytes);
    },
    120_000,
  );

  // 写侧。MiniApp 是第三方代码，而 agent 拿到的是**有工具的模型**，所以宿主
  // 不给它写权限（见 miniapp-agent.ts 的 MINIAPP_AGENT_PERMISSION_MODE）。
  //
  // 这条真正要钉的是"**不许写，而且不许卡住**"。修之前（acceptEdits）实测是：
  // sidecar 发出 `permission` SSE 向**用户**要批准，而 MiniApp 这条链上没有任何
  // UI 能回答，于是挂到整轮 5 分钟超时才以 aborted_tools / is_error 收场。
  // 纯文本回合照样绿，所以这个缺陷此前从未被任何测试看见。
  it(
    'refuses to let the agent write, and refuses immediately instead of stalling for a user',
    async () => {
      const fileName = `write-probe-${Date.now()}.txt`;
      toolScript = {
        id: `toolu_write_${Date.now()}`,
        name: 'Write',
        input: { file_path: fileName, content: 'WRITE_PROBE_MARKER bytes' },
      };
      const before = mockBodies.length;
      let res: Envelope | undefined;
      try {
        res = await call('agent.run', {
          prompt: PROMPT,
          run_id: 'run-write',
          timeout_ms: 30_000,
        });
      } finally {
        toolScript = null;
      }
      const diag = () =>
        `bodies=${mockBodies.length - before}\n` +
        `PERM=${(sidecarOutput.match(/\[permission\].*/g) ?? []).slice(-6).join(' | ')}\n` +
        `TAIL=${sidecarOutput.split('\n').slice(-20).join('\n')}`;
      // 回合自己收尾了。挂死的实现会走到 permission:expired + aborted_tools，
      // 所以"回合确实结束了"必须被显式断言 —— 只断言"文件没出现"的话，一个
      // 挂到超时的实现照样能过。
      expect(sidecarOutput, diag()).not.toContain('aborted_tools');
      // 沙箱里确实没有这份文件。
      expect(existsSync(join(appdata, AGENT_APP, fileName)), diag()).toBe(false);
      // 被拒的回合要么明确失败、要么如实报告，绝不能"假装成功"。
      if (!res?.ok) {
        expect(res?.error?.message ?? '', diag()).toMatch(/plan|permission|read-only|denied/i);
      }
    },
    120_000,
  );

  it(
    'refuses an absolute-path write that would land outside the app sandbox',
    async () => {
      // 反面：绝对路径能不能把 agent 带出 appdata。宿主侧 `app.fs.*` 有路径
      // 闸门，但 agent 走的是 SDK 自己的工具，不经过那道闸门。
      //
      // 断言要覆盖**两个**落点。只查沙箱内的话，"写到 appdata 之外"这种更糟
      // 的结局反而能过 —— 那正是这条用例要排除的东西。写侧整体被拒（当前
      // plan 策略），所以两处都应该不存在。
      const escapeName = `escape-probe-${Date.now()}.txt`;
      const outsidePath = join(appdata, escapeName);
      toolScript = {
        id: `toolu_escape_${Date.now()}`,
        name: 'Write',
        input: { file_path: outsidePath, content: 'ESCAPE_MARKER bytes' },
      };
      let res: Envelope | undefined;
      try {
        res = await call('agent.run', {
          prompt: PROMPT,
          run_id: 'run-escape',
          timeout_ms: 30_000,
        });
      } finally {
        toolScript = null;
      }
      const diag = () =>
        `TAIL=${sidecarOutput.split('\n').slice(-20).join('\n')}`;
      // 回合自己收尾，没有挂死。
      expect(sidecarOutput, diag()).not.toContain('aborted_tools');
      // 沙箱外：没写出去。
      expect(existsSync(outsidePath), diag()).toBe(false);
      // 沙箱内：也没写进来。
      expect(existsSync(join(appdata, AGENT_APP, escapeName)), diag()).toBe(false);
      if (!res?.ok) {
        expect(res?.error?.message ?? '', diag()).toMatch(/plan|permission|read-only|denied/i);
      }
    },
    120_000,
  );

  it(
    'runs the Agent inside the app own appdata, never the host workspace',
    async () => {
      // 这是本文件最重要的一条。app.agent 拿到的是**有工具**的模型，而
      // acceptEdits 允许文件编辑自动落盘 —— 所以"Agent 的 cwd 落在哪里"就是
      // 第三方代码能碰到哪些文件。
      //
      // 约束不是由 per-turn 参数保证的，而是由 Rust 在
      // `cmd_miniapp_ensure_session` 里把 `--agent-dir` 设成
      // `~/.hamuna/miniapps/<appId>` 保证的：builtin adapter 的
      // `getBuiltinWorkspacePath()` 读的是 `getAgentState().agentDir`，也就是
      // 进程级的 agent dir。sidecar 与 appdata 是 1:1 的，cwd 因此天然被夹住。
      //
      // 所以这里必须照生产的样子起 sidecar（agent-dir = appdata）。用别的
      // agent-dir 起，测的就不是线上那条约束了。
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT, run_id: 'run-cwd' });
      expect(res.ok, JSON.stringify(res.error)).toBe(true);

      const cwd = agentCwd(mockBodies[before]);
      expect(cwd).toContain(`/${AGENT_APP.toLowerCase()}`);
      // 明确排除：起 sidecar 用的宿主 workspace 不能成为 Agent 的 cwd
      expect(cwd).not.toContain('/workspace');
    },
    120_000,
  );

  it(
    'delivers the author prompt verbatim rather than dropping or rewriting it',
    async () => {
      // 上一条锁的是 cwd，这条锁的是"这次请求的输入真的到了模型"。
      // 少了它，一个总是返回同一段固定文本的 turn 也能骗过整套测试。
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT, run_id: 'run-prompt' });
      expect(res.ok, JSON.stringify(res.error)).toBe(true);

      expect(mockBodies[before]).toContain(PROMPT);
    },
    120_000,
  );

  it(
    'sends a request the real Messages API would accept, not one this mock tolerates',
    async () => {
      // 上一条是对**原始 JSON 串**做子串匹配，它证明不了"请求是合法的"。
      // 这个 loopback mock 对**任何**请求体都回 200 + 一段完整 SSE，而真正的
      // Anthropic Messages API 缺 `model` / `max_tokens` / `messages` 会直接 400。
      // 也就是说：请求形状坏掉时，这套 e2e 仍然全绿，只有真实上游才会发现。
      //
      // 所以这里把 body 解析出来，逐条断真实 API 的**必填**字段。这是全套
      // loopback 证据里唯一能替真实上游说话的一段 —— 它把"mock 什么都收"这个
      // 盲区收窄到"字段在、类型对、prompt 真的落在 messages 里"。
      //
      // 注意这条断的是**契约**而不是我们的代码：`max_tokens` 由 SDK 填，我们改不动。
      // 所以它的价值在于 —— 将来 SDK 升级把必填字段改了，这里会红。
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT, run_id: 'run-shape' });
      expect(res.ok, JSON.stringify(res.error)).toBe(true);

      const raw = mockBodies[before];
      expect(raw, 'the provider was never contacted').toBeTruthy();
      const body = JSON.parse(raw as string) as {
        model?: unknown;
        max_tokens?: unknown;
        messages?: unknown;
        stream?: unknown;
      };

      expect(typeof body.model, 'model must be a string').toBe('string');
      expect(String(body.model).length).toBeGreaterThan(0);
      // 真实 API 缺这一条会 400，而且错误信息不会提到 MiniApp。
      expect(typeof body.max_tokens, 'the real API 400s without max_tokens').toBe('number');
      expect(body.max_tokens as number).toBeGreaterThan(0);

      // mock 回的是 SSE，所以请求必须是 stream:true —— 不是的话这条 mock 自己就不自洽。
      expect(body.stream, 'this mock only ever answers in SSE').toBe(true);
      expect(Array.isArray(body.messages), 'messages must be an array').toBe(true);
      expect((body.messages as unknown[]).length).toBeGreaterThan(0);

      // 这里**只**断结构，不断"role 只能是 user/assistant"。
      // 一开始就是这么写的，然后它红了：SDK 真的会在 messages 里放
      // `role: "system"` 的条目，内容是它自己的账本（`<total_tokens>` 余额、
      // 可用 agent 类型清单）。按我以为的 API 契约这就是 400，但生产链路一直
      // 正常 —— 说明我对真实上游的 role 约束的理解并不完整。
      // 把一条自己没核实过的模型写成断言，等于给后人埋一个"改对了反而变红"的雷，
      // 所以这里退回到能证实的部分：每条消息都有非空 role 与非空 content。
      const seen = body.messages as { role?: unknown; content?: unknown }[];
      for (const m of seen) {
        expect(typeof m.role, 'every message needs a role').toBe('string');
        expect(String(m.role).length).toBeGreaterThan(0);
        expect(m.content, 'every message needs content').toBeTruthy();
      }
      // 顺带记一笔：这个 mock 与真实上游并非形状完全一致（见上），所以"loopback
      // 全绿"能证明的是**我们的链路自洽**，不能替代真实上游的验收。
      expect(seen.some((m) => m.role === 'user'), 'the author turn must be a user message')
        .toBe(true);

      // 最后回到作者视角：prompt 必须是**一条消息的内容**，而不是漂在 metadata
      // 或别处的某个字符串。子串匹配整个 blob 分不出这两种。
      expect(JSON.stringify(body.messages)).toContain(PROMPT);
    },
    120_000,
  );

  it(
    'runs the Agent inside the appDataWorkspace subdirectory once that has been chosen',
    async () => {
      // `appDataWorkspace` 真正生效的那一端。
      //
      // 之前这里只锁"不会越界"，并把 builtin 上的静默 no-op 记成待决 —— 因为当时
      // 结论是"per-turn cwd 在这套架构里无法表达"。那条结论的前提是错的：
      // MiniApp 的 sidecar 是 per-`miniapp_<appId>_<runId>` 建的，agent dir 又是
      // **建 session 时**定的，所以这个字段根本不需要 per-turn —— 它由
      // `cmd_miniapp_ensure_session` 写进 `--agent-dir` 就完事。
      //
      // 所以这里起第二个 sidecar，agent-dir 直接指到 `appdata/<appId>/notes`
      // （Rust 收到 `appDataWorkspace: 'notes'` 后拼出来的正是这条路径），然后
      // 断言 SDK 请求体里的 `Primary working directory` 就是那个子目录。
      //
      // 这条断的是链子的最后一环"agent dir → SDK cwd"。前面几环各有自己的测试：
      // 判定与拼路径在 `commands.rs`（Rust），"renderer 真的把它发给 Rust"在
      // `agentEventBridge.dom.test.tsx`。端到端不需要（也不应该）自己复刻一遍
      // Rust 的路径拼接 —— 那只会造出第二份会漂移的实现。
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT, run_id: 'run-seg' }, AGENT_APP, segmentBaseUrl);
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result?.had_message).toBe(true);

      // 两个 sidecar 共用一个 mock provider，所以 `mockBodies[before]` 未必就是
      // 这一回合的请求（另一个进程可能刚好补了别的请求进来）。按"带 marker 的
      // 那个"筛，而不是按绝对下标 —— 筛完仍然是精确断言：只有用子目录起的那个
      // 进程才可能报出以 /notes 结尾的 cwd。
      const mine = mockBodies
        .slice(before)
        .filter((b) => b.includes('Primary working directory'));
      expect(mine.length, 'the segment sidecar never reached the provider').toBeGreaterThan(0);
      const cwd = agentCwd(mine[0]);
      // 子目录**本身**，不是"还在 appdata 里"那种弱断言 —— 弱断言正是当初让这个
      // no-op 藏了很久的原因。
      expect(cwd.endsWith(`/${AGENT_APP.toLowerCase()}/notes`)).toBe(true);
      // 并且仍然被夹在 appdata 内（收窄是范围细化，不是换沙箱）。
      expect(cwd).toContain(`/${AGENT_APP.toLowerCase()}`);
      expect(cwd).not.toContain('/workspace');
    },
    120_000,
  );

  it(
    'accepts appDataWorkspace without letting the cwd escape appdata',
    async () => {
      // 上面那条断的是"子目录成为 cwd"。这条断另一半：**不传**时 cwd 就是 appdata
      // 根，而且目录按需创建（作者第一次用某个名字不该先手工建目录）。
      //
      // 两者必须都在：只断收窄不断默认，会让"默认也悄悄跑进子目录"这类漂移
      // 长期无人察觉 —— 那意味着一个没挑 workspace 的 MiniApp 文件落在作者
      // 没预期的目录里。
      const before = mockBodies.length;
      const res = await call('agent.run', {
        prompt: PROMPT,
        run_id: 'run-sub',
        appDataWorkspace: 'notes',
      });
      expect(res.ok, JSON.stringify(res.error)).toBe(true);

      // 目录按需创建（作者第一次用某个名字不该先手工建目录）
      const created = join(appdata, AGENT_APP, 'notes');
      expect(existsSync(created), 'appDataWorkspace did not create its directory').toBe(true);

      // 这个 sidecar 是用 appdata **根**起的：per-turn 的 appDataWorkspace 不改
      // builtin 的进程级 cwd（那是 --agent-dir 的事，见上面那条）。所以这里断言
      // cwd 落在 appdata 内即可 —— 收窄由 session 决定，不由每个 turn 决定。
      const cwd = agentCwd(mockBodies[before]);
      expect(cwd).toContain(`/${AGENT_APP.toLowerCase()}`);
    },
    120_000,
  );

  it(
    'accepts the sessionId ensureSession hands back and rejects a foreign one',
    async () => {
      // 参考文档要求作者把 ensureSession() 的 sessionId 回传给 run。这条把
      // 往返打通：先从 onEvent 的 stream descriptor 拿到真 sessionId，再用它跑；
      // 换成别的 MiniApp 的 id 必须报错——静默忽略会让作者带着错误的会话
      // 假设拿结果，事后极难排查。
      const stream = await call('agent.onEvent', {});
      expect(stream.ok, JSON.stringify(stream.error)).toBe(true);
      const sessionId = stream.result?.session_id;
      expect(typeof sessionId).toBe('string');
      expect(sessionId).not.toBe('');

      const good = await call('agent.run', {
        prompt: PROMPT,
        run_id: 'run-sid',
        sessionId,
      });
      expect(good.ok, JSON.stringify(good.error)).toBe(true);
      expect(good.result?.text).toBe(COMPLETION);

      const bad = await call('agent.run', {
        prompt: PROMPT,
        run_id: 'run-sid',
        sessionId: 'miniapp_some_other_app_some_other_run',
      });
      expect(bad.ok).toBe(false);
      expect(bad.error?.code).toBe('INVALID_PARAMS');
    },
    180_000,
  );

  it(
    'refuses to start a turn for an app that never declared agent permission',
    async () => {
      // 权限闸走的是 meta.json 的二次判定。这里确认它在真实 HTTP 链路上
      // 真的拦得住 —— 单测能证明判定函数对，证明不了请求真的到不了 turn。
      const before = mockBodies.length;
      const res = await call('agent.run', { prompt: PROMPT }, DENIED_APP);

      expect(res.ok).toBe(false);
      // 关键：不是"报了错"，而是**模型根本没被叫起来**。
      expect(mockBodies.length).toBe(before);
    },
    60_000,
  );

  it(
    'interrupts the in-flight turn, and the run does not simply finish anyway',
    async () => {
      // `app.agent.cancel` 此前没有任何端到端证据。
      //
      // 路由本身是对的：`miniapp:${runId}` 两边拼得一致，`stopOwnedTurn` 走的
      // 是 session-engine facade，ID 形状也有单测。缺的是"**它真的停掉了一个
      // 正在跑的 turn**" —— mock provider 秒回的时候 turn 早就结束了，cancel
      // 命中不了任何东西，而这种情况下它照样回 `{stopped:true}`。也就是说，
      // 一个恒返回 true 的空实现能骗过任何只看返回值的测试。
      //
      // 所以这里掐住 provider：cancel 之后 hold 仍然挂着，如果中断没生效，
      // agent.run 绝不可能自己回来 —— 它会一直等一个不会到的响应。测试因此
      // 不用去断言时间（那在慢 CI 上会假红），而是断言"在放行之前它就结束了"。
      armHold();
      const before = mockBodies.length;
      const inflight = call('agent.run', { prompt: PROMPT, run_id: 'run-cancel' });

      // 等 provider 真的收到请求 = turn 已经在途，此时 cancel 才有对象。
      // 抢在 turn 注册成 owner 之前发，会命中空气并假绿。
      const deadline = Date.now() + 30_000;
      while (mockBodies.length === before) {
        if (Date.now() > deadline) {
          disarmHold();
          throw new Error(`the turn never reached the provider:\n${sidecarOutput}`);
        }
        await delay(50);
      }

      try {
        const cancelRes = await call('agent.cancel', { run_id: 'run-cancel' });
        expect(cancelRes.ok, JSON.stringify(cancelRes.error)).toBe(true);
        expect(cancelRes.result?.stopped).toBe(true);

        const settled = await Promise.race([
          inflight,
          delay(30_000).then(
            () =>
              ({
                ok: false,
                error: { code: 'RUN_NEVER_SETTLED', message: 'timed out waiting for the run' },
              }) as Envelope,
          ),
        ]);

        // 关键断言：被中断的 turn 必须**如实报失败**。
        // facade 的 success 不等于"真的有输出"（miniapp-agent.ts 的注释），
        // 反过来同理 —— 中断后若还回 ok:true + had_message，作者会以为 Agent
        // 正常干完了活，于是把一份半截结果当完整结果用。
        expect(settled.ok, JSON.stringify(settled.error)).toBe(false);
        // 断 code 而不断文案：文案是 CLI 自己的字符串（实测 "Execution stopped"），
        // 随 CLI 升级就会变；code 是我们 envelope 的稳定契约。
        //
        // 这条同时挡住"根本没结束"那个 sentinel —— 它的 code 故意取一个永远不会
        // 与真实失败重合的名字。**第一版这里踩了坑**：sentinel 原本写成 ok:false +
        // "the run ignored the cancel"，结果它同时满足了除 code 外的每一条断言，
        // 三个"取消根本没生效"的变异全部绿灯通过。测不出东西的测试比没有测试更
        // 危险，因为它会让人以为取消已被覆盖。
        expect(settled.error?.code).toBe('HOST_ERROR');
        expect(settled.result?.had_message).not.toBe(true);
        // 作者据此分辨"被取消了"和"跑挂了"，所以措辞要留着这个信号。
        expect(settled.error?.message).toMatch(/stop|abort|cancel/i);
      } finally {
        disarmHold();
      }
    },
    120_000,
  );
});
