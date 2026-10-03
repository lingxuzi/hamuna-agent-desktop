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
  writeApp(AGENT_APP, { agent: { enabled: true } });
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
}, 120_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise<void>(r => {
      const timer = setTimeout(r, 3_000);
      child?.once('exit', () => { clearTimeout(timer); r(); });
    });
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
): Promise<Envelope> {
  const res = await fetch(`${baseUrl}/api/miniapp/app/${method}`, {
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
 */
function agentCwd(body: string): string {
  const m = /Primary working directory:\s*([^\s"]+)/.exec(body);
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
    'accepts appDataWorkspace without letting the cwd escape appdata',
    async () => {
      // 刻意**不断言** notes 子目录成了 cwd。理由见下面，先把已知事实说清楚：
      //
      //   `appDataWorkspace` 算出的 `workspacePath` 是 per-turn 参数，而 builtin
      //   adapter 的 `runInjectedTurn` 根本不读 `request.workspacePath`（它只用
      //   进程级 agentDir）。external adapter 读了。
      //
      //   也就是说这个字段在**默认的 builtin runtime 上是静默 no-op**：目录照样
      //   建了、ensureSession 照样回显 `app_data_workspace`，但 Agent 的 cwd
      //   仍在 appdata 根。它不是越权（appdata 本身已是沙箱边界），但作者会
      //   以为自己收窄了范围而实际没有。
      //
      // 要让 builtin 也生效，得把 per-turn cwd 一路穿到 SDK 的 query({cwd})，
      // 而那条路径和桌面 Tab、共存 turn、session 持久化、
      // `enabledOfficialToolIds` 的 workspace 归属共用 —— 属于架构变更，按
      // CLAUDE.md 要先讨论，不能顺手改。所以这里锁的是**不会越界**这一半，
      // 并且把这个待决状态钉在测试里，免得日后无声漂移。
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

      // 不管收窄有没有生效，cwd 都必须还在 appdata 内
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
