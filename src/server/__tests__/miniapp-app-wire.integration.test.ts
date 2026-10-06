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
 * 这两族另有两个文件用 loopback mock 替身在零成本下覆盖：
 * `miniapp-ai-wire.integration.test.ts` 与 `miniapp-agent-wire.integration.test.ts`。
 *
 * 全部 34 个方法里，只有一条扫全部方法、且只断言"**必须给出决定，绝不能 500**"。
 * 其余用例逐个断言**做对了事** —— 因为"有决定"证明不了语义：少传一个字段、
 * 把 from/to 弄反、把 append 接到 writeFile 上，三种都能拿到 ok:true 而扫过。
 * 三个方法（`fs.appendFile` / `fs.readdir` / `fs.rename`）原本只被那条扫覆盖，
 * 现已各补真实磁盘往返。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * 第二个 fixture，专门用来验 `appDataWorkspace`。
 *
 * 单独开一个 app 而不是给上面那个加 `agent.enabled`：那个 app 刻意不声明 agent，
 * 「未声明即拒绝」是它存在的意义，加上去就把这条观察点毁了。
 */
const AGENT_APP_ID = 'wire-agent-probe';

const AGENT_APP_PERMISSIONS = {
  agent: { enabled: true },
  // 声明 ai 只是为了能打到 `normalizeAiPrompt` 那一层。下面的用例全部用
  // **不可能触发真实请求**的入参（空 prompt / 空 messages），所以这条声明
  // 不会让本文件产生任何 token 开销。
  ai: { enabled: true },
  fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] },
};

function writeApp(dir: string, id: string, name: string, permissions: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      id,
      name,
      description: 'end-to-end fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions,
    }),
    'utf8',
  );
}

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
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(scratch, 'tmp'), { recursive: true });

  writeApp(appDir, APP_ID, 'Wire Probe', PERMISSIONS);
  writeApp(
    join(home, '.hamuna', 'miniapps', AGENT_APP_ID),
    AGENT_APP_ID,
    'Wire Agent Probe',
    AGENT_APP_PERMISSIONS,
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


  // 下面三个方法此前只被"全部方法都必须有决定、绝不能 500"那条扫到：跑到了，
  // 但没有任何断言检查它**做对了事**。那种扫法对"路由存在"是证据，对"语义正确"
  // 不是 —— 少传一个字段、把 from/to 弄反、把 append 接到 writeFile 上，三种都
  // 能拿到 ok:true 而扫过。这里各补一条真正读写磁盘的往返。
  it('appends rather than truncating, and keeps both halves in order', async () => {
    const file = join(appDir, 'append.txt');

    expect(await call('fs.writeFile', { path: file, data: 'first' })).toEqual({ ok: true, result: null });
    expect(await call('fs.appendFile', { path: file, data: '-second' })).toEqual({ ok: true, result: null });

    // 关键断言是内容而不是 ok：接到 writeFile 上时上面那行同样是 ok:true。
    expect(readFileSync(file, 'utf8')).toBe('first-second');
    expect(await call('fs.readFile', { path: file })).toEqual({ ok: true, result: 'first-second' });
  });

  it('lists every entry in the directory, not just the first or none', async () => {
    const dir = join(appDir, 'listing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'a', 'utf8');
    writeFileSync(join(dir, 'b.txt'), 'bb', 'utf8');

    const res = await call('fs.readdir', { path: dir });

    expect(res).toEqual({ ok: true, result: ['a.txt', 'b.txt'] });
  });

  it('moves the file, so the old path is gone and the new path holds the bytes', async () => {
    const from = join(appDir, 'rename-from.txt');
    const to = join(appDir, 'rename-to.txt');
    writeFileSync(from, 'movable', 'utf8');

    const res = await call('fs.rename', { from, to });

    expect(res).toEqual({ ok: true, result: null });
    // 两面都断言：只看新路径存在的话，"复制了一份但没删旧的"也会通过。
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, 'utf8')).toBe('movable');
  });

  it('refuses a rename whose source is outside the declared {appdata} scope', async () => {
    // 越界检查对 copy 类方法同样成立：from 在界内而 to 在界外时必须整条拒绝，
    // 否则就是个把文件搬出沙箱的洞。
    const inside = join(appDir, 'inside.txt');
    const outside = join(scratch, 'moved-out.txt');
    writeFileSync(inside, 'stay put', 'utf8');

    const res = await call('fs.rename', { from: inside, to: outside });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.code).toBe('PERMISSION_DENIED');
    // 拒绝必须没有副作用：源还在，目标没被造出来。
    expect(readFileSync(inside, 'utf8')).toBe('stay put');
    expect(existsSync(outside)).toBe(false);
  });

  // 下面三个方法此前只有"能被路由到、能拿到答复"那条扫到，从没有被断言检查过
  // 它们**做对了事**。`dispatchFs` 是一串 case，把 `copyFile` 接到 `rename` 上、
  // 把 `rm` 接到 `unlink` 上、把 `mkdir` 写成 no-op，三种都照样返回 ok:true。
  // 所以每条都断言磁盘上的**结果**，而不只是信封。
  it('creates the directory, and honours recursive instead of always recursing', async () => {
    const deep = join(appDir, 'a', 'b', 'c');

    // 不带 recursive 时中间层不存在就该失败 —— 断言它失败才能证明 recursive
    // 这个参数真的被读到了；只断言成功的话，"永远 recursive" 与 "no-op" 都过。
    const shallow = await call('fs.mkdir', { path: deep });
    expect(shallow.ok).toBe(false);
    if (shallow.ok) throw new Error('expected a failure envelope');
    expect(existsSync(join(appDir, 'a'))).toBe(false);

    const deep2 = await call('fs.mkdir', { path: deep, opts: { recursive: true } });
    expect(deep2).toEqual({ ok: true, result: null });
    expect(existsSync(deep)).toBe(true);

    // 对已存在的目录再 recursive 一次必须仍然成功（Node 的 recursive 语义）。
    expect(await call('fs.mkdir', { path: deep, opts: { recursive: true } })).toEqual({
      ok: true,
      result: null,
    });
  });

  it('copies the bytes and leaves the source in place, instead of moving them', async () => {
    const from = join(appDir, 'copy-from.txt');
    const to = join(appDir, 'copy-to.txt');
    writeFileSync(from, 'duplicate me', 'utf8');

    expect(await call('fs.copyFile', { from, to })).toEqual({ ok: true, result: null });

    // 源必须还在：接到 rename 上时这一条会失败。
    expect(readFileSync(from, 'utf8')).toBe('duplicate me');
    expect(readFileSync(to, 'utf8')).toBe('duplicate me');
  });

  it('removes a non-empty directory tree, and only tolerates a missing path with force', async () => {
    // `fs.rm` 对齐 Node 的 `fs.promises.rm`：目录**必须**带 recursive，空目录也不行
    // （那是 `rmdir` 的语义）。所以"删掉一棵非空的树"这条同时锁住了它确实是 rm
    // ——`unlink` 永远做不到，而 `rmdir` 在非空树上会 ENOTEMPTY。
    const file = join(appDir, 'rm-me.txt');
    writeFileSync(file, 'bye', 'utf8');
    expect(await call('fs.rm', { path: file })).toEqual({ ok: true, result: null });
    expect(existsSync(file)).toBe(false);

    const tree = join(appDir, 'to-remove');
    mkdirSync(join(tree, 'nested'), { recursive: true });
    writeFileSync(join(tree, 'nested', 'leaf.txt'), 'leaf', 'utf8');

    // 不带 recursive 删目录必须失败，且失败里要能看出是 EISDIR —— 只断言 ok:false
    // 的话，"因为参数错了"也会同样通过。
    const noRecursive = await call('fs.rm', { path: tree });
    expect(noRecursive.ok).toBe(false);
    if (noRecursive.ok) throw new Error('expected a failure envelope');
    expect(noRecursive.error?.message).toContain('EISDIR');
    expect(existsSync(tree)).toBe(true);

    expect(await call('fs.rm', { path: tree, opts: { recursive: true } })).toEqual({
      ok: true,
      result: null,
    });
    expect(existsSync(tree)).toBe(false);

    // force 读到了：不存在 + force 才不报错；不存在且没 force 必须报错。
    expect(await call('fs.rm', { path: tree, opts: { force: true } })).toEqual({
      ok: true,
      result: null,
    });
    const strict = await call('fs.rm', { path: tree });
    expect(strict.ok).toBe(false);
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

  it('answers a denied dispatch with HTTP 200 so the renderer can read the envelope', async () => {
    // 上面两条已经证明**信封里**的 code 是对的（PERMISSION_DENIED）。这条证明
    // 它真的能穿过 HTTP 层到达消费端 —— 状态码曾经编码了"失败"（400），而
    // renderer 的 `apiPostJson` 在 `!response.ok` 时是 throw（`apiFetch.ts:59`），
    // 于是作者拿到的只剩 NETWORK_ERROR 加一个字面量 "[object Object]"：
    // 真因和 code 一起消失。同一条路由的 agent 回合因为直读信封而一直是对的。
    //
    // 刻意不写 "expect(res.ok).toBe(true)" —— 那正是本文件此前只看信封、
    // 因此漏掉这个 bug 的原因。
    const res = await fetch(`${baseUrl}/api/miniapp/app/shell.exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, params: { command: 'echo', args: ['nope'] } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('PERMISSION_DENIED');
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

/**
 * `appDataWorkspace` —— 参考文档里 `agent.ensureSession` / `agent.run` 的可选
 * 参数，让 MiniApp 在自己 appdata 底下挑一个子目录当 Agent workspace。
 *
 * 只覆盖 `ensureSession`：它是**零成本**的那一半（校验 + 归一 + 回显 + 建目录，
 * 不起模型回合），所以能在 integration 池里实跑。`run` 真正把 workspace 交给
 * Agent 那一段要花真实 token，属 credentialed 池，本文件不碰。
 *
 * **注意这条路径在生产里不是作者实际会走的那条**：`appHostDispatch.ts` 在
 * renderer 里就把 `agent.ensureSession` 截走了，请求根本到不了 sidecar。本文件
 * 验的是 sidecar 自己那份处理（防御性一致，且直接打 sidecar 的工具链会用到）。
 * 生产路径由 `appHostDispatch.unit.test.ts` 覆盖 —— 两边都要有，因为任一边
 * 单独修好都不代表作者拿到的行为一致。
 */
/**
 * `app.ai` 的**零成本**那一半：入参归一。
 *
 * `ai.complete` / `ai.chat` 在 `normalizeAiPrompt` 处就会拒掉空 prompt，压根
 * 走不到 `query()`，所以下面这些用例**不会产生任何 token 开销**，可以安全地
 * 留在 integration 池里（不是 credentialed）。真正发起补全的那一段要花用户
 * 的 Provider 额度，仍未实跑 —— 见 tech_docs 的「验证状态」。
 *
 * 值得覆盖是因为参考文档的标准写法是 `ai.chat([{role, content}])`，而早期实现
 * 两条路都走 `requireString`，照文档写的作者拿到的是 `INVALID_PARAMS`。
 */
describe('MiniApp app.ai prompt normalization over real HTTP', () => {
  it('rejects a missing prompt before anything can reach the provider', async () => {
    for (const params of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: null }]) {
      const res = await call('ai.complete', params, AGENT_APP_ID);
      expect(res.ok, JSON.stringify(params)).toBe(false);
      if (res.ok) continue;
      expect(res.error?.code).toBe('INVALID_PARAMS');
    }
  });

  it('rejects an empty or unusable messages array, which the reference shape allows', async () => {
    // 数组形态是参考文档给 `ai.chat` 的标准入参；空数组与全无有效轮的数组都
    // 必须被明确拒绝，而不是被拍平成空字符串后照发。
    for (const prompt of [[], [{ role: 'user' }], [{ role: '', content: 'x' }], [null, 'x']]) {
      const res = await call('ai.chat', { prompt }, AGENT_APP_ID);
      expect(res.ok, JSON.stringify(prompt)).toBe(false);
      if (res.ok) continue;
      expect(res.error?.code).toBe('INVALID_PARAMS');
    }
  });

  it('still denies ai on the app that never declared it', async () => {
    const res = await call('ai.complete', { prompt: 'hi' }, APP_ID);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.message).toMatch(/ai\.enabled/);
  });
});

describe('MiniApp appDataWorkspace over real HTTP', () => {
  const agentAppDir = () => join(home, '.hamuna', 'miniapps', AGENT_APP_ID);

  it('echoes back a normalized name and creates the directory inside appdata', async () => {
    const res = await call(
      'agent.ensureSession',
      { appDataWorkspace: '  notes  ' },
      AGENT_APP_ID,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`expected success, got ${JSON.stringify(res.error)}`);
    // 回显的是归一后的值：作者能确认宿主到底认了什么，而不是把原串再吐一遍。
    expect((res.result as Record<string, unknown>).app_data_workspace).toBe('notes');
    // 真的建出来了 —— Agent 的 cwd 必须存在，作者不该被要求先手工建目录。
    expect(existsSync(join(agentAppDir(), 'notes'))).toBe(true);
  });

  it('falls back to the appdata root when the author does not ask for a subdirectory', async () => {
    const res = await call('agent.ensureSession', {}, AGENT_APP_ID);

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected success');
    expect((res.result as Record<string, unknown>).app_data_workspace).toBeNull();
  });

  it('refuses a name that would escape appdata, and creates nothing', async () => {
    // 断言锁的是「被拒 + 无副作用」这个不变量，不断言由哪一层拦的 —— 两层都返回
    // 同一个 code 与形状，分层断言只会把实现细节写死。
    //
    // 归一层（`normalizeAppDataWorkspace`）有 18 条单测逐条钉住每种拒绝理由，
    // 并且关掉 `FORBIDDEN_CHARS` 时那两条会红，所以它是真正的 chokepoint。
    // 派发层那道 `dirname(目标) === appdata` 在当前判定表下够不到，属于兜底：
    // 它防的是"将来给判定表放宽了某个字符"这类回归。本文件**无法**用它区分
    // 哪一层拦的（结果相同），也不试图去区分 —— 想验兜底本身请直接单测
    // `resolveAgentWorkspace`，别在这里演一层假的分层断言。
    for (const bad of ['../escape', 'a/b', 'C:/Users', '..', '.', 'a\\b']) {
      const res = await call('agent.ensureSession', { appDataWorkspace: bad }, AGENT_APP_ID);
      expect(res.ok, `${bad} must be rejected`).toBe(false);
      if (res.ok) continue;
      expect(res.error?.code).toBe('INVALID_PARAMS');
    }
    // 拒绝必须是**没有副作用**的拒绝：不能先建了目录再报错。
    expect(existsSync(join(agentAppDir(), 'escape'))).toBe(false);
    expect(existsSync(join(agentAppDir(), 'a'))).toBe(false);
  });

  it('refuses a Windows-reserved device name, which Win32 would turn into a handle', async () => {
    const res = await call('agent.ensureSession', { appDataWorkspace: 'CON' }, AGENT_APP_ID);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.message).toMatch(/reserved/i);
  });

  it('refuses a trailing dot, which Win32 strips into an alias for another directory', async () => {
    // `work.` 与 `work` 在 NTFS 上是同一个目录；放行等于给作者一个会静默指向
    // 别处的名字，跨平台只在 Windows 上暴露。
    const res = await call('agent.ensureSession', { appDataWorkspace: 'work.' }, AGENT_APP_ID);

    expect(res.ok).toBe(false);
  });

  it('still denies agent on the app that never declared it', async () => {    // 回归护栏：加了 AGENT_APP_ID 之后，"未声明即拒绝"这条观察点不能被稀释。
    const res = await call('agent.ensureSession', { appDataWorkspace: 'notes' }, APP_ID);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a failure envelope');
    expect(res.error?.message).toMatch(/agent\.enabled/);
  });
});
