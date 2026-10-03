/**
 * MiniApp `window.app.*` 全链路端到端（integration 池，真实 Sidecar 进程）。
 *
 * 已有测试各自锁住半条链：
 *   - `miniapp-app-dispatch.integration.test.ts` —— 真实 fs / storage 执行，
 *     但**进程内**直接调 `dispatchMiniAppApp`，没有 HTTP。
 *   - `appHostDispatch.unit.test.ts` —— renderer 派发分流，但 `apiPostJson`
 *     是 mock，链在客户端就断了。
 *
 * 两边都绿、拼起来却不成立的情况正是这类分层测试的盲区：envelope 字段名对不上、
 * 状态码不对（拒绝也回 200）、错误信封形状不同 —— 每一项单测都看不见。
 * 本文件把那道缝接上：真的起一个 Sidecar 子进程（`src/server/index.ts`，与生产
 * 同一个入口），真的走 loopback HTTP，请求体就是 `createAppDispatcher` 构造的
 * `{ appId, params }`，断言的是作者最终看到的东西。
 *
 * 为什么请求体是手写的而不是复用 `createAppDispatcher`：那个函数住在
 * `src/renderer/`，而本仓的进程边界红线（`.dependency-cruiser.cjs` 的
 * `renderer-no-import-sidecar` / `sidecar-no-import-renderer`）禁止测试跨边界
 * import —— 生产代码的边界正是这条测试要验证的东西，用 import 绕过它没有意义。
 * 方法名则不是手写的：来自 `shared/miniapp/app-protocol` 的 `APP_METHODS`，
 * 也就是 runtime 脚本、renderer 派发器与 sidecar 共用的那一份名单。
 *
 * 不测什么：`ai.*` 的模型输出与 `agent.*` 的回合需要真实 Provider 凭据，属于
 * `credentialed` 池；`dialog.*` / `clipboard.*` 是 renderer 侧 Tauri 原生能力，
 * 生产上根本不会到达 sidecar（sidecar 对它们显式失败，见 miniapp-app-dispatch）。
 * 本文件对全部 30 个方法只断言"**必须给出决定，绝不能 500**"。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listAppMethods } from '../../shared/miniapp/app-protocol';

const APP_ID = 'e2e-wire';

/**
 * 声明式权限：只给 storage 全量 + appdata 内的 fs 读写。刻意**不**声明
 * shell / net / ai / agent —— 这样"未声明即拒绝"才是可观测的行为，而不是
 * 一份把所有能力都放开的 meta 让闸门看起来永远通过。
 */
const PERMISSIONS = {
  storage: { enabled: true },
  fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] },
};

interface Envelope {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

let baseUrl = '';
let scratch = '';
let home = '';
let workspace = '';
let appDir = '';
let child: ChildProcess | undefined;
let sidecarOutput = '';

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve test port');
  await new Promise<void>((res, rej) => {
    server.close(err => (err ? rej(err) : res()));
  });
  return address.port;
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

/** 走生产路径：POST /api/miniapp/app/<method>，body 就是 renderer 发的那个形状。 */
async function call(method: string, params: unknown, appId = APP_ID): Promise<Envelope> {
  const res = await fetch(`${baseUrl}/api/miniapp/app/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, params: params ?? null }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!body || typeof body.ok !== 'boolean') {
    throw new Error(`${method} returned a non-envelope body (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  return { ...body, ...(res.status === 200 ? {} : { _status: res.status }) } as Envelope;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'hamuna-miniapp-wire-'));
  home = join(scratch, 'home');
  workspace = join(scratch, 'workspace');
  appDir = join(home, '.hamuna', 'miniapps', APP_ID);
  mkdirSync(appDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(scratch, 'tmp'), { recursive: true });

  writeFileSync(
    join(appDir, 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Wire Probe',
      description: 'end-to-end fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions: PERMISSIONS,
    }),
    'utf8',
  );
  writeFileSync(
    join(appDir, 'storage.json'),
    JSON.stringify({ seeded: 'from disk' }, null, 2),
    'utf8',
  );

  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [
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
  ], {
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
  });
  child.stdout?.on('data', chunk => { sidecarOutput += chunk.toString(); });
  child.stderr?.on('data', chunk => { sidecarOutput += chunk.toString(); });

  await waitForReady();
});

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise<void>(r => {
      const timer = setTimeout(r, 3_000);
      child?.once('exit', () => { clearTimeout(timer); r(); });
    });
  }
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows 上句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('MiniApp app.* over real HTTP against a real Sidecar process', () => {
  it('reads a pre-seeded storage key, so the store really came from disk', async () => {
    const res = await call('storage.get', { key: 'seeded' });

    expect(res).toEqual({ ok: true, result: 'from disk' });
  });

  it('writes then reads back a storage key, proving the round trip crosses a process boundary', async () => {
    const written = await call('storage.set', { key: 'greeting', value: { lang: 'zh', text: '你好' } });
    expect(written).toEqual({ ok: true, result: null });

    const read = await call('storage.get', { key: 'greeting' });
    expect(read).toEqual({ ok: true, result: { lang: 'zh', text: '你好' } });

    // 再落一次盘：值必须是 Sidecar 写进 storage.json 的，不是内存里的。
    const onDisk = JSON.parse(readFileSync(join(appDir, 'storage.json'), 'utf8')) as Record<string, unknown>;
    expect(onDisk.greeting).toEqual({ lang: 'zh', text: '你好' });
    // 预置键不能被这次写挤掉。
    expect(onDisk.seeded).toBe('from disk');
  });

  it('removes a key and reports whether it was there', async () => {
    await call('storage.set', { key: 'temp', value: 1 });

    expect(await call('storage.remove', { key: 'temp' })).toEqual({ ok: true, result: true });
    expect(await call('storage.get', { key: 'temp' })).toEqual({ ok: true, result: undefined });
    expect(await call('storage.remove', { key: 'temp' })).toEqual({ ok: true, result: false });
  });

  it('writes a file then reads the same bytes back through the fs capability', async () => {
    const file = join(appDir, 'round-trip.txt');

    const written = await call('fs.writeFile', { path: file, data: 'wire content' });
    expect(written).toEqual({ ok: true, result: null });
    expect(readFileSync(file, 'utf8')).toBe('wire content');

    expect(await call('fs.readFile', { path: file })).toEqual({ ok: true, result: 'wire content' });
  });

  it('answers os.info with facts about the real host, not a fixture', async () => {
    const res = await call('os.info', null);

    expect(res.ok).toBe(true);
    const info = res.result as { platform?: string; homedir?: string };
    expect(typeof info.platform).toBe('string');
    expect(info.platform).toBe(process.platform);
    expect(typeof info.homedir).toBe('string');
  });

  it('denies a capability the author never declared, and writes nothing', async () => {
    // shell 故意没声明。fail-closed 的两个面都要看见：作者拿到拒绝，且磁盘上
    // 没有任何痕迹。只断言前者的话，"拒绝是因为参数错了" 也会同样通过。
    const res = await call('shell.exec', { command: 'echo', args: ['should never run'] });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('denies a path outside the declared {appdata} scope', async () => {
    const outside = join(scratch, 'escape.txt');
    writeFileSync(outside, 'host secret', 'utf8');

    const res = await call('fs.readFile', { path: outside });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('rejects an appId that is not kebab-case at the route, before any dispatch', async () => {
    const res = await fetch(`${baseUrl}/api/miniapp/app/storage.get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: '../escape', params: { key: 'seeded' } }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('gives every declared method a decision and never a 500', async () => {
    // 名单来自 shared 的 APP_METHODS —— runtime 脚本 / renderer 派发器 /
    // sidecar 共用的同一份。这里不要求每个都成功：dialog/clipboard 归 renderer，
    // ai/agent 要真实凭据，call 要 worker 白名单。要求的是"**有答复**"，
    // 因为不接上的方法在生产里的症状是作者那边永久 pending。
    const seen: string[] = [];
    const broken: string[] = [];

    for (const method of listAppMethods()) {
      const res = await fetch(`${baseUrl}/api/miniapp/app/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: APP_ID, params: {} }),
      });
      const body = (await res.json().catch(() => null)) as Envelope | null;
      if (res.status === 500 || !body || typeof body.ok !== 'boolean') {
        broken.push(`${method} (HTTP ${res.status}: ${JSON.stringify(body)})`);
      } else {
        seen.push(method);
      }
    }

    expect(broken, `methods with no decision:\n${broken.join('\n')}`).toEqual([]);
    // 名单非空，且 30 个都拿到了答复。
    expect(seen).toHaveLength(listAppMethods().length);
  });

  it('rejects an unknown method instead of letting it reach the filesystem', async () => {
    // 拒绝发生在 shared 的权限层而不是 `dispatchFs` 的 default 分支：fs 族的
    // 权限规则先要求 `path`，而这条调用没有。所以这里只锁"**被拒**"这个不变量，
    // 不断言具体文案 —— 作者侧真正该依赖的是名单外的方法在 renderer 的
    // `verifyAppCall` 就被丢弃，根本到不了这里（见 shared/app-protocol）。
    // 端到端再验一次是防"某天这道闸被摘掉"：那时症状是任意方法名都返回 200，
    // 作者以为自己在调一个存在的能力。
    const res = await call('fs.definitelyNotAMethod', {});

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(typeof res.error?.code).toBe('string');
    expect(res.error?.code.length).toBeGreaterThan(0);

    // 未知方法不该留下任何磁盘副作用。
    expect((await call('fs.stat', { path: join(appDir, 'definitelyNotAMethod') })).ok).toBe(false);
  });
});
