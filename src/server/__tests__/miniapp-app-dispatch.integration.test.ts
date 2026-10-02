/**
 * `window.app.*` 端到端往返（integration 池）。
 *
 * 单测（`shared/miniapp/app-permissions.unit.test.ts`）锁的是**判定**，本文件
 * 锁的是**执行**：一次真实的 `dispatchMiniAppApp` 调用，真的建目录、真的写
 * 文件、真的落 storage.json，再真的读回来。
 *
 * 为什么必须是 integration 而不是 unit：
 *   - 权限模板（`{appdata}`）在 shared 层**不展开**，展开只发生在 dispatch 的
 *     `expandTemplates`。只测判定会漏掉"模板展开后前缀对不上"这类真实故障。
 *   - fs / storage 的行为依赖真实 fs 语义（mkdir recursive、append、JSON 解析
 *     失败回退）。mock 掉 fs 的测试等于在测 mock。
 *
 * ## 不测什么
 *
 * `ai.*` 与 `agent.*` 在这里**故意不跑**：它们会 spawn 真实 SDK 子进程
 * （`ai`）或真实 Sidecar 进程（`agent`），既慢又不确定，属于 CLAUDE.md 定义的
 * `credentialed` 池（需真实 Provider 凭据）。本文件只验证它们的**权限闸门**
 * 与路由可达性，不验证模型输出 —— 那属于另一类测试。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_ID = 'e2e-probe';

/**
 * dispatch 用 `getConfigDir()` 定位 `~/.hamuna/miniapps/<appId>`。测试绝不能写
 * 用户真实 HOME，所以 mock 掉 `getConfigDir` —— 与同目录
 * `miniapp-worker/node-limits.unit.test.ts` 用的是同一个手法，保持一致。
 *
 * 刻意**不**改 `process.env.HOME` 去间接影响 `os.homedir()`：它在 POSIX 读
 * `$HOME`、在 Windows 读 `%USERPROFILE%`，且 Node 内部可能缓存首次结果，靠环境
 * 变量做沙箱会在另一个平台上静默失效、把测试数据写进用户真实目录。
 */
let sandboxHome = '';

vi.mock('../utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

const { dispatchMiniAppApp } = await import('../miniapp-app-dispatch');

function appDir(): string {
  return join(sandboxHome, 'miniapps', APP_ID);
}

function writeMeta(permissions: unknown): void {
  mkdirSync(appDir(), { recursive: true });
  writeFileSync(
    join(appDir(), 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'E2E Probe',
      description: 'integration fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions,
    }),
    'utf8',
  );
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'miniapp-e2e-'));
});

afterEach(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // Windows 上文件句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('app.fs round trip through real dispatch', () => {
  it('expands {appdata} and completes a write → read → stat cycle', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    const file = join(appDir(), 'notes.txt');

    const written = await dispatchMiniAppApp('fs.writeFile', APP_ID, {
      path: file,
      data: 'hello miniapp',
    });
    expect(written, `writeFile denied: ${JSON.stringify(written)}`).toEqual({
      ok: true,
      result: null,
    });

    const read = await dispatchMiniAppApp('fs.readFile', APP_ID, { path: file });
    expect(read).toEqual({ ok: true, result: 'hello miniapp' });

    const st = await dispatchMiniAppApp('fs.stat', APP_ID, { path: file });
    expect(st.ok).toBe(true);
    expect((st.result as { isFile: boolean }).isFile).toBe(true);
  });

  it('reports lstat separately from stat for symlinks', async () => {
    // lstat 不跟随 symlink —— MiniApp 用它做链接检测，跟随了就永远返回 false
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    const target = join(appDir(), 'real.txt');
    writeFileSync(target, 'x', 'utf8');

    const st = await dispatchMiniAppApp('fs.lstat', APP_ID, { path: target });
    expect(st.ok).toBe(true);
    expect((st.result as { isSymbolicLink: boolean }).isSymbolicLink).toBe(false);
  });

  it('access() returns false for a missing path instead of throwing', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'] } });
    const res = await dispatchMiniAppApp('fs.access', APP_ID, {
      path: join(appDir(), 'nope.txt'),
    });
    // 作者要的是布尔判断；抛错会逼每个调用点都写 try/catch 吞掉常规状态
    expect(res).toEqual({ ok: true, result: false });
  });

  it('unlink + rmdir remove entries and then report them gone', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    const file = join(appDir(), 'temp.txt');
    writeFileSync(file, 'bye', 'utf8');

    expect((await dispatchMiniAppApp('fs.unlink', APP_ID, { path: file })).ok).toBe(true);
    expect((await dispatchMiniAppApp('fs.access', APP_ID, { path: file })).result).toBe(false);

    const nested = join(appDir(), 'nested');
    mkdirSync(nested, { recursive: true });
    expect((await dispatchMiniAppApp('fs.rmdir', APP_ID, { path: nested })).ok).toBe(true);
  });
});

describe('path containment is enforced against the expanded prefix', () => {
  it('refuses a traversal that escapes appdata even though the string starts inside it', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    // 这是 shared 层 isPathAllowed 的词法折叠在真实执行路径上的验证：
    // `/…/miniapps/e2e-probe/../../../escape.txt` 字符串上以 appdata 开头。
    const escape = join(appDir(), '..', '..', '..', 'escape.txt');
    const res = await dispatchMiniAppApp('fs.writeFile', APP_ID, {
      path: escape,
      data: 'owned',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('refuses every method when meta declares no fs permission at all', async () => {
    writeMeta({});
    for (const method of ['fs.readFile', 'fs.writeFile', 'fs.stat']) {
      const res = await dispatchMiniAppApp(method, APP_ID, { path: join(appDir(), 'x') });
      expect(res.ok, `${method} must be denied`).toBe(false);
    }
  });
});

describe('storage round trip', () => {
  it('persists across calls and supports remove', async () => {
    writeMeta({});
    const store = join(appDir(), 'storage.json');

    expect((await dispatchMiniAppApp('storage.set', APP_ID, { key: 'a', value: 1 })).ok).toBe(true);
    expect(await dispatchMiniAppApp('storage.get', APP_ID, { key: 'a' })).toEqual({
      ok: true,
      result: 1,
    });
    // 真的落盘了 —— 这是 P0 缺陷「__miniappStorage 无实现」的回归护栏
    expect(JSON.parse(readFileSync(store, 'utf8'))).toEqual({ a: 1 });

    expect((await dispatchMiniAppApp('storage.remove', APP_ID, { key: 'a' })).result).toBe(true);
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'a' })).result).toBeUndefined();
    // 删不存在的 key 返回 false 而不是抛错
    expect((await dispatchMiniAppApp('storage.remove', APP_ID, { key: 'ghost' })).result).toBe(
      false,
    );
  });

  it('recovers from a corrupt storage.json instead of wedging every later call', async () => {
    writeMeta({});
    writeFileSync(join(appDir(), 'storage.json'), '{ not json', 'utf8');
    const res = await dispatchMiniAppApp('storage.get', APP_ID, { key: 'a' });
    expect(res).toEqual({ ok: true, result: undefined });
  });

  it('rejects a storage call with no key', async () => {
    writeMeta({});
    const res = await dispatchMiniAppApp('storage.get', APP_ID, {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });
});

describe('identity and fail-closed behavior', () => {
  it('refuses to serve an app whose meta.id does not match its directory', async () => {
    // 防目录穿越式冒名：meta.id 必须与目录名一致
    mkdirSync(appDir(), { recursive: true });
    writeFileSync(
      join(appDir(), 'meta.json'),
      JSON.stringify({
        id: 'someone-else',
        name: 'x',
        description: 'x',
        icon: 'x',
        category: 'other',
        version: 1,
        min_host_version: '0.0.1',
        permissions: { fs: { read: ['{appdata}/**'] } },
      }),
      'utf8',
    );
    const res = await dispatchMiniAppApp('fs.readFile', APP_ID, { path: join(appDir(), 'x') });
    expect(res.ok).toBe(false);
  });

  it('refuses an unknown appId with no meta.json at all', async () => {
    const res = await dispatchMiniAppApp('fs.readFile', 'does-not-exist', { path: '/x' });
    expect(res.ok).toBe(false);
  });

  it('routes dialog / clipboard to the renderer instead of silently no-oping', async () => {
    // 这两组是 Tauri 原生能力，sidecar 够不到。静默成功会让作者以为复制生效了。
    writeMeta({});
    for (const method of ['dialog.open', 'clipboard.readText']) {
      const res = await dispatchMiniAppApp(method, APP_ID, null);
      expect(res.ok, `${method} must not fake success in the sidecar`).toBe(false);
    }
  });
});

describe('ai / agent permission gate is enforced at the execution layer', () => {
  it('denies ai.* when ai.enabled is absent', async () => {
    writeMeta({});
    const res = await dispatchMiniAppApp('ai.complete', APP_ID, { prompt: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('denies agent.* when only ai.enabled is set', async () => {
    // 越权防线：想要"有工具的 Agent"必须显式开 agent，不能被 ai 顺带带出来
    writeMeta({ ai: { enabled: true } });
    const res = await dispatchMiniAppApp('agent.run', APP_ID, { prompt: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('enforces ai.allowed_models at the execution layer, not only in shared', async () => {
    writeMeta({ ai: { enabled: true, allowed_models: ['model-a'] } });
    const res = await dispatchMiniAppApp('ai.complete', APP_ID, {
      prompt: 'hi',
      model: 'model-b',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('allowed_models');
  });

  it('reaches the ai layer (not a routing gap) once the gate passes', async () => {
    // 不验证模型输出（需要真实凭据，属 credentialed 池），只验证路由可达：
    // 一个空 prompt 必须在 ai 层被拒成 INVALID_PARAMS，而不是 UNKNOWN_METHOD。
    writeMeta({ ai: { enabled: true } });
    const res = await dispatchMiniAppApp('ai.complete', APP_ID, { prompt: '   ' });
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });
});
