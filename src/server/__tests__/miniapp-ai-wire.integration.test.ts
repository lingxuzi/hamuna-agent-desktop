/**
 * `app.ai` 全链路（integration 池，**零成本**）。
 *
 * 这一层的意义是：`app.ai` 之前完全没有真实执行过的证据，因为验证它意味着调用
 * 用户真实的 Provider 凭据、产生付费请求，而那属于 credentialed 池、不该由 CI
 * 触发。
 *
 * 做法是给 Sidecar 推一个**指向 loopback mock 的 provider**：
 *
 *   POST /api/provider/set { providerEnv: { baseUrl: 'http://127.0.0.1:<mock>' } }
 *
 * 之后 `buildClaudeSessionEnv` 会把 `ANTHROPIC_BASE_URL` 设成 mock，SDK 子进程
 * 真的被 spawn、真的发出 `POST /v1/messages?beta=true`、真的解析 SSE 回来 ——
 * 唯一没覆盖的是"真实 Anthropic 端点是否接受这个请求形状"，那是上游的契约，
 * 不是我们的。
 *
 * 踩过的坑（都写在这里以免重犯）：
 *   1. mock 必须用 `node:http` 的 createServer。用 `node:net` 的话回调拿到的是
 *      裸 socket，`req` 是 undefined，请求永远不会被记录，而表面现象是
 *      "MOCK HITS: []" —— 很容易误判成"根本没打过来"。
 *   2. 只设进程环境变量里的 `ANTHROPIC_BASE_URL` **无效**：`app.ai` 传
 *      `providerEnv: undefined` + `providerId: SUBSCRIPTION_PROVIDER_ID`，而
 *      `buildClaudeSessionEnv` 在订阅分支会主动清掉继承来的
 *      `ANTHROPIC_BASE_URL`（日志：`ANTHROPIC_BASE_URL cleared`）。必须走
 *      `/api/provider/set` 把宿主配置推进去。
 *   3. 推完 provider 会触发一次 session 重启，落 `ANTHROPIC_BASE_URL set to: …`
 *      那行日志才说明真的生效了。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_ID = 'ai-wire-probe';
const COMPLETION = 'PROBE_COMPLETION_TEXT';

interface Envelope {
  ok: boolean;
  result?: { text?: string };
  error?: { code: string; message: string };
}

let baseUrl = '';
let scratch = '';
let child: ChildProcess | undefined;
let sidecarOutput = '';
let mock: Server | undefined;
/** mock 收到的路径，用来证明请求真的走过网络而不是被短路。 */
const mockPaths: string[] = [];

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(res => server.listen(0, '127.0.0.1', () => res()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((res, rej) => server.close(e => (e ? rej(e) : res())));
  return port;
}

/** 极简 Anthropic Messages 流式端点，外加 SDK 的连通性探针。 */
function startMockProvider(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    mockPaths.push(`${req.method} ${req.url ?? ''}`);
    req.on('error', () => {});
    res.on('error', () => {});
    req.resume();

    const isMessages = String(req.url ?? '').includes('/v1/messages');
    if (!isMessages) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }

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

beforeAll(async () => {
  const started = await startMockProvider();
  mock = started.server;

  scratch = mkdtempSync(join(tmpdir(), 'hamuna-miniapp-ai-wire-'));
  const home = join(scratch, 'home');
  const workspace = join(scratch, 'workspace');
  const appDir = join(home, '.hamuna', 'miniapps', APP_ID);
  mkdirSync(appDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(scratch, 'tmp'), { recursive: true });
  writeFileSync(
    join(appDir, 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'AI Wire Probe',
      description: 'end-to-end ai fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions: { ai: { enabled: true } },
    }),
    'utf8',
  );

  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(
    process.execPath,
    [
      '--import',
      'tsx/esm',
      resolve('src/server/index.ts'),
      '--agent-dir',
      workspace,
      '--port',
      String(port),
      '--no-pre-warm',
      '--sidecar-role',
      'global',
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

  // 把宿主 provider 指向 mock。这一步是整份测试成立的前提：只设进程环境变量
  // 会被 buildClaudeSessionEnv 在订阅分支清掉。
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
  // 推完会触发一次 session 重启；等它落定，避免和首次补全抢同一个 SDK 子进程。
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

async function call(method: string, params: unknown): Promise<Envelope> {
  const res = await fetch(`${baseUrl}/api/miniapp/app/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: APP_ID, params }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!body || typeof body.ok !== 'boolean') {
    throw new Error(`${method} returned a non-envelope body (HTTP ${res.status})`);
  }
  return body;
}

describe('app.ai over real HTTP against a real Sidecar and a loopback provider', () => {
  it(
    'returns a real completion, so the whole chain up to the HTTP boundary works',
    async () => {
      const res = await call('ai.complete', { prompt: 'say the completion marker' });

      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      // 关键断言：拿到的是 mock 回的那段文本，不是错误文案、也不是空串。
      expect(res.result?.text).toBe(COMPLETION);
      // 并且它真的走过网络 —— 只断言返回值的话，短路返回也能骗过测试。
      expect(mockPaths.some(p => p.includes('/v1/messages'))).toBe(true);
    },
    90_000,
  );

  it(
    'accepts the reference messages-array form of chat, not just a bare string',
    async () => {
      // 参考文档给 `ai.chat` 的标准入参就是 messages 数组。早期实现两条路都走
      // requireString，照文档写的作者拿到 INVALID_PARAMS —— 这里确认它真的能跑通。
      const res = await call('ai.chat', {
        prompt: [{ role: 'user', content: 'say the completion marker' }],
      });

      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result?.text).toBe(COMPLETION);
    },
    90_000,
  );

  it(
    'routes getModels without a second completion request',
    async () => {
      const before = mockPaths.length;
      const res = await call('ai.getModels', {});

      // getModels 走 provider-verify 的模型目录，不该产生一次 messages 调用。
      // 这里只锁"没有多打一次补全"，不断言模型列表内容（那是宿主配置的快照）。
      expect(res.ok).toBe(true);
      const added = mockPaths.slice(before).filter(p => p.includes('/v1/messages'));
      expect(added).toHaveLength(0);
    },
    60_000,
  );
});
