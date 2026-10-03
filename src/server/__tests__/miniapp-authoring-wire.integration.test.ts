/**
 * MiniApp「作者回路」端到端：create → list → source（integration 池，真实 Sidecar 进程）。
 *
 * ## 为什么这个文件存在
 *
 * 仓库里 51 个 miniapp 测试文件没有**任何一个**引用过 `/api/miniapp/list`，
 * `/api/miniapp/create` 也只出现在注释里。现有的分层各自成立，恰好漏掉这一段：
 *   - `miniapp-app-wire.integration.test.ts` 覆盖 `app.*` 分发，**不碰**管理面路由；
 *   - `miniapp-route-coverage.unit.test.ts` 只做静态断言 —— 确认这些路径在 sidecar
 *     里声明过、renderer 调得到。它验证的是"线接上了"，不是"通了能用"。
 *
 * 而这一段正是作者回路：agent 写 5 个文件 → POST create → 用户在列表里看到它 →
 * 点开时 source 能取回来。中间任一环 400，用户看到的就是"AI 说装好了，列表里没有"。
 *
 * 这不是假想。`/api/miniapp/install` 上就长过这么一个 bug：Node 侧多校验了一个
 * renderer 从不发送的 `source` 字段，于是**每一次**安装都 400，注释至今还留在
 * index.ts 里说明它被修掉了。create 的校验闸门与它形状相同，只是还没被这样打过。
 *
 * ## 测的是什么，不测什么
 *
 * Node 侧对这三个端点只是**薄转发 + schema 预校验**，写盘权威在 Rust
 * （`cmd_miniapp_*`）。所以本文件用一台假 management API 顶替 Rust，把接缝钉在
 * **Node 与 Rust 之间**：
 *   - 正向：合法请求必须真的转发出去，且转发体的字段名正确（`app_id` 不是 `appId`，
 *     拼错的话 Rust 侧静默收不到，而 Node 侧一路 ok:true）；
 *   - 反向：**校验失败必须不转发**。这是本文件最值钱的断言 —— 转发出去就意味着
 *     Rust 会替一个本该被拒的 payload 落盘。
 *
 * 不测 Rust 侧行为：`version` 覆盖（SKILL.md 说宿主写盘时用「覆盖前 +1」）、
 * 落盘路径、bundled/ installed 解析顺序都归 `cmd_miniapp_*`，需要真 Tauri 宿主，
 * 不在本池。假 management API 返回什么，这里就断言什么。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_ID = 'e2e-authoring';

/** 假 Rust 对这个 appId 恒定回 ok:false，用来确定性地走到"Rust 拒绝"那条分支。 */
const RUST_REJECTS = 'rust-rejects-this';

/** 与 `index.ts` 的 REQUIRED_FILES 一一对应，少一个都该 400。 */
const REQUIRED_FILES = [
  'meta.json',
  'source/index.html',
  'source/ui.js',
  'source/style.css',
  'storage.json',
] as const;

interface Forwarded {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

let baseUrl = '';
let scratch = '';
let home = '';
let workspace = '';
let child: ChildProcess | undefined;
let sidecarOutput = '';

/** 假 Rust：记录收到的转发，并按路径回 canned 响应。数组只 push，不重绑。 */
const forwards: Forwarded[] = [];
let mgmt: Server | undefined;

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

/** 合法的 5 文件 source。`metaId` 单独参数化，好写"id 对不上"那条反面用例。 */
function validSource(metaId: string = APP_ID): Record<string, string> {
  return {
    'meta.json': JSON.stringify({
      id: metaId,
      name: 'Authoring Probe',
      description: 'end-to-end authoring fixture',
      icon: 'wave',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions: {},
    }),
    'source/index.html': '<!doctype html><html><body><script src="ui.js"></script></body></html>',
    'source/ui.js': 'document.body.dataset.ready = "1";',
    'source/style.css': 'body { margin: 0 }',
    'storage.json': '{}',
  };
}

async function postCreate(payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/miniapp/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function getList(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/miniapp/list`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function postSource(appId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/miniapp/source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Marketplace 两个端点。请求体**只有** `{ appId }` —— 这不是简化，是照抄
 * `marketplaceClient.ts` 里 `installMarketplace` / `uninstallMarketplace` 真正发出去的
 * 东西。少一个字段曾经就让每一次安装 400（见 index.ts 里那段注释），所以这里
 * 刻意不补任何 renderer 不会发的字段。
 */
async function postLifecycle(route: string, appId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/miniapp/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** 只看某个 path 上被转发过的请求 —— 断言"没有转发"时用它，别用全量长度。 */
function forwardedTo(path: string): Forwarded[] {
  return forwards.filter(f => f.path === path);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'hamuna-miniapp-authoring-'));
  home = join(scratch, 'home');
  workspace = join(scratch, 'workspace');
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(scratch, 'tmp'), { recursive: true });

  // ---- 假 Rust management API ----
  const mgmtPort = await reservePort();
  const mgmtHttp = await import('node:http');
  const mgmtServer = mgmtHttp.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      let body: Record<string, unknown> = {};
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
      }
      forwards.push({ path, method: req.method ?? 'GET', body });
      const canned =
        path === '/api/miniapp/create'
          ? { ok: true, version: 2 }
          : path === '/api/miniapp/list'
            ? { ok: true, apps: [{ id: APP_ID, name: 'Authoring Probe' }] }
            : path === '/api/miniapp/source'
              ? { ok: true, files: validSource() }
              : path === '/api/miniapp/install'
                ? { ok: true, installed: true }
                : path === '/api/miniapp/uninstall'
                  // 哨兵：让"Rust 拒绝"这条路径可以被确定性地走到，而不是靠
                  // 猜一个未 mock 的 path（uninstall 本身是 mock 了的）。
                  ? (body.app_id === RUST_REJECTS
                      ? { ok: false, error: 'MiniApp is bundled and cannot be uninstalled' }
                      : { ok: true, uninstalled: true })
                  : { ok: false, error: `unmocked path ${path}` };
      res.writeHead(canned.ok === true ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(canned));
    });
  });
  await new Promise<void>((res, rej) => {
    mgmtServer.once('error', rej);
    mgmtServer.listen(mgmtPort, '127.0.0.1', () => res());
  });
  mgmt = mgmtServer as unknown as Server;

  // ---- 真 Sidecar ----
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
      // 关键：managementApi 在模块加载时就读这个 env，所以必须在 spawn 前给。
      HAMUNA_MANAGEMENT_PORT: String(mgmtPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { sidecarOutput += chunk.toString(); });
  child.stderr?.on('data', chunk => { sidecarOutput += chunk.toString(); });

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`Sidecar exited early (code=${child.exitCode}):\n${sidecarOutput}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health/ready`);
      if (res.ok) break;
    } catch {
      // 端口还没绑上。
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for sidecar:\n${sidecarOutput}`);
    await delay(100);
  }
}, 120_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise<void>(r => {
      const timer = setTimeout(r, 3_000);
      child?.once('exit', () => { clearTimeout(timer); r(); });
    });
  }
  mgmt?.close();
  if (scratch) {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* 清理失败不该盖掉真实失败 */ }
  }
});

describe('MiniApp 作者回路：create → list → source', () => {
  it('rejects a create that is missing any required file, and never forwards it', async () => {
    for (const missing of REQUIRED_FILES) {
      const before = forwardedTo('/api/miniapp/create').length;
      const source = validSource();
      delete source[missing];
      const { status, body } = await postCreate({ appId: APP_ID, source });
      const diag = `missing=${missing} status=${status} body=${JSON.stringify(body)}`;
      expect(status, diag).toBe(400);
      expect(String(body.error ?? ''), diag).toContain(missing);
      // 转发出去就等于让 Rust 替一个本该被拒的 payload 落盘。
      expect(forwardedTo('/api/miniapp/create').length, diag).toBe(before);
    }
  });

  it('rejects a create whose meta.json.id disagrees with appId, and never forwards it', async () => {
    const before = forwardedTo('/api/miniapp/create').length;
    const { status, body } = await postCreate({
      appId: APP_ID,
      source: validSource('some-other-app'),
    });
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(400);
    expect(String(body.error ?? ''), diag).toContain('must equal appId');
    expect(forwardedTo('/api/miniapp/create').length, diag).toBe(before);
  });

  it('rejects a non-kebab appId before touching meta.json, and never forwards it', async () => {
    const before = forwardedTo('/api/miniapp/create').length;
    const { status } = await postCreate({ appId: 'Not Kebab', source: validSource('Not Kebab') });
    expect(status).toBe(400);
    expect(forwardedTo('/api/miniapp/create').length).toBe(before);
  });

  it('forwards a valid create to Rust under app_id, not appId', async () => {
    const before = forwardedTo('/api/miniapp/create').length;
    const source = validSource();
    const { status, body } = await postCreate({ appId: APP_ID, source });
    const diag = `status=${status} body=${JSON.stringify(body)}\nSIDECAR:\n${sidecarOutput.slice(-2000)}`;
    expect(status, diag).toBe(200);
    expect(body.ok, diag).toBe(true);

    const sent = forwardedTo('/api/miniapp/create');
    expect(sent.length, diag).toBe(before + 1);
    const fwd = sent[sent.length - 1];
    expect(fwd.method, diag).toBe('POST');
    // 字段名拼错的话 Rust 侧收不到 appId，而 Node 这边一路 ok:true ——
    // 正是分层测试全都绿、拼起来不成立的那一类。
    expect(fwd.body.app_id, diag).toBe(APP_ID);
    expect(fwd.body.appId, diag).toBeUndefined();
    expect(Object.keys(fwd.body.source as object).sort(), diag).toEqual([...REQUIRED_FILES].sort());
  });

  it('serves list and passes the catalog through unchanged', async () => {
    const before = forwardedTo('/api/miniapp/list').length;
    const { status, body } = await getList();
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(200);
    expect(body.ok, diag).toBe(true);
    expect(body.apps, diag).toEqual([{ id: APP_ID, name: 'Authoring Probe' }]);
    expect(forwardedTo('/api/miniapp/list').length, diag).toBe(before + 1);
  });

  it('serves source with the file map plus the two path roots the author needs', async () => {
    const { status, body } = await postSource(APP_ID);
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(200);
    expect(body.ok, diag).toBe(true);
    // Rust 回的 5 个文件要原样透传 —— 少一个 MiniApp 就开不起来。
    expect(Object.keys(body.files as object).sort(), diag).toEqual([...REQUIRED_FILES].sort());

    // appdata_dir / workspace_dir 由 sidecar 补，不来自 Rust。`{workspace}` 模板就是
    // 按 workspace_dir 展开的，两边算出不同路径，作者按 app.workspaceDir 拼的
    // 路径就会被判越权（见 index.ts 里这段注释）。
    expect(typeof body.appdata_dir, diag).toBe('string');
    expect(String(body.appdata_dir), diag).toContain(APP_ID);
    // workspace_dir 来自 --agent-dir，值必须与真正传进去的一致。
    expect(body.workspace_dir, diag).toBe(workspace);
  });

  it('rejects a source request for an appId that is not kebab-case', async () => {
    const before = forwardedTo('/api/miniapp/source').length;
    const { status } = await postSource('../escape');
    expect(status).toBe(400);
    expect(forwardedTo('/api/miniapp/source').length).toBe(before);
  });
});

describe('MiniApp 市场生命周期：install / uninstall', () => {
  // 这两条是 renderer 真正会走的路径（marketplaceClient.ts 的 installMarketplace /
  // uninstallMarketplace），请求体只有 { appId }。曾经 Node 侧多要了一个
  // `source`，于是每一次安装都 400 —— 而当时的 renderer 侧测试是绿的。
  it('installs from an appId-only body and tags the forward as marketplace', async () => {
    const before = forwardedTo('/api/miniapp/install').length;
    const { status, body } = await postLifecycle('install', APP_ID);
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(200);
    expect(body.ok, diag).toBe(true);

    const sent = forwardedTo('/api/miniapp/install');
    expect(sent.length, diag).toBe(before + 1);
    const fwd = sent[sent.length - 1];
    expect(fwd.body.app_id, diag).toBe(APP_ID);
    // `from: 'marketplace'` 是告诉 Rust 去 bundled-miniapps/<appId> 读源文件的
    // 唯一线索。掉了它，Rust 收到一个没说来源的安装请求。
    expect(fwd.body.from, diag).toBe('marketplace');
    // renderer 不发 source，Node 也不该转发 —— Rust 自己读 bundled 资源。
    expect(fwd.body.source, diag).toBeUndefined();
  });

  it('uninstalls from an appId-only body', async () => {
    const before = forwardedTo('/api/miniapp/uninstall').length;
    const { status, body } = await postLifecycle('uninstall', APP_ID);
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(200);
    expect(body.ok, diag).toBe(true);

    const sent = forwardedTo('/api/miniapp/uninstall');
    expect(sent.length, diag).toBe(before + 1);
    expect(sent[sent.length - 1].body.app_id, diag).toBe(APP_ID);
  });

  it('rejects a non-kebab appId on both, and never forwards either', async () => {
    for (const route of ['install', 'uninstall'] as const) {
      const before = forwardedTo(`/api/miniapp/${route}`).length;
      const { status } = await postLifecycle(route, '../escape');
      const diag = `route=${route} status=${status}`;
      expect(status, diag).toBe(400);
      expect(forwardedTo(`/api/miniapp/${route}`).length, diag).toBe(before);
    }
  });

  it('surfaces a Rust-side rejection as 400 rather than an ok envelope', async () => {
    // Rust 说装不了的时候，Node 必须照实回 400。反过来（Rust 拒了、Node 回 200
    // ok:true）的话，marketplaceClient 的 `if (!result.ok) throw` 永远不会触发，
    // UI 会显示安装成功而盘上什么都没有。
    const before = forwardedTo('/api/miniapp/uninstall').length;
    const { status, body } = await postLifecycle('uninstall', RUST_REJECTS);
    const diag = `status=${status} body=${JSON.stringify(body)}`;
    expect(status, diag).toBe(400);
    expect(body.ok, diag).toBe(false);
    expect(String(body.error ?? ''), diag).toContain('cannot be uninstalled');
    // 拒绝也要真的转发过去 —— 不转发的话这条断言测的是一个根本没到 Rust 的请求。
    expect(forwardedTo('/api/miniapp/uninstall').length, diag).toBe(before + 1);
  });
});
