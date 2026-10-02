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

import { buildAppResult, listAppMethods } from '../../shared/miniapp/app-protocol';
import { runAppCall } from '../../shared/miniapp/app-permissions';
import { workspacePathsEqual } from '../../shared/workspacePath';

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

const { dispatchMiniAppApp, miniappAppRoot } = await import('../miniapp-app-dispatch');

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

describe('renderer gate + sidecar gate, wired together', () => {
  /**
   * 复现生产的真实接线：`runAppCall`（renderer 预判 + 信封透传）→
   * `dispatchMiniAppApp`（sidecar 权威闸门）。dispatch 适配器按
   * `createAppDispatcher` 的契约返回 `DispatchResult` 信封且**从不 throw**。
   */
  function viaRenderer() {
    return async (method: string, params: unknown) => {
      const out = await dispatchMiniAppApp(method, APP_ID, params ?? null, {});
      return out.ok
        ? { ok: true as const, result: out.result }
        : { ok: false as const, error: out.error };
    };
  }

  async function call(permissions: unknown, method: string, params: unknown) {
    return runAppCall(method as never, params, permissions as never, viaRenderer() as never);
  }

  it('completes a real write → read round trip that the renderer no longer false-denies', async () => {
    // 这条在修复前会红：renderer 拿未展开的 `{appdata}/**` 去做前缀比较，
    // 恒不匹配，于是第一次写就被自己的预判拒掉，压根到不了 sidecar。
    const perms = { fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } };
    writeMeta(perms);
    const file = join(appDir(), 'e2e.txt');

    const written = await call(perms, 'fs.writeFile', { path: file, data: 'through both gates' });
    expect(written, `writeFile: ${JSON.stringify(written)}`).toEqual({ ok: true, result: null });
    expect(readFileSync(file, 'utf8')).toBe('through both gates');

    const read = await call(perms, 'fs.readFile', { path: file });
    expect(read).toEqual({ ok: true, result: 'through both gates' });
  });

  it('rejects — never resolves — when the sidecar denies', async () => {
    // 第二个已发货缺陷的信封版本：sidecar 的拒绝曾被 runAppCall 包成
    // `{ok:true, result:{ok:false,...}}`，作者拿到的是 resolve 出来的信封对象，
    // try/catch 永不触发。这里锁住作者真正看到的是 reject。
    const perms = { fs: { read: ['{appdata}/**'] } };
    writeMeta(perms);

    const denied = await call(perms, 'fs.readFile', { path: join(appDir(), 'nope.txt') });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error('expected a failure envelope');
    // 具体 errno（ENOENT）被 dispatch 的兜底 catch 收成 HOST_ERROR，message 里
    // 仍带原始信息。这里锁的是"作者拿到 reject"，不断言 errno 分类 ——
    // 那属于错误码分级的另一件事。
    expect(denied.error.code).toBe('HOST_ERROR');
    expect(denied.error.message).toMatch(/ENOENT|no such file/i);

    // buildAppResult 必须把它翻成 ok:false，runtime 才会走 reject 分支。
    const wire = buildAppResult('n', 'c', denied);
    expect(wire.ok).toBe(false);
  });

  it('still refuses a path outside the declared scope at the sidecar gate', async () => {
    // renderer 不预判 fs 不等于放行：越界判定由 sidecar 独立复算。
    const perms = { fs: { read: ['{appdata}/**'] } };
    writeMeta(perms);

    const escaped = await call(perms, 'fs.readFile', { path: '/etc/passwd' });
    expect(escaped.ok).toBe(false);
    if (escaped.ok) throw new Error('expected a failure envelope');
    expect(escaped.error.code).toBe('PERMISSION_DENIED');
  });

  it('grants exactly the directory the author is told about via app.appDataDir', async () => {
    // 闭环：`/api/miniapp/source` 下发给 renderer 的 `appdata_dir` 用的就是
    // `miniappAppRoot`，而 `{appdata}` 权限前缀展开用的也是它。作者照
    // `app.appDataDir + '/x'` 拼路径必须真的读得到 —— 否则症状是"声明了
    // fs.read 却读不到自己的文件"，而 meta.json 写得完全正确。
    //
    // 之前这两者不是同一个来源：权限展开走 `appRoot`，下发给作者的值压根
    // 不存在（getter 恒为 ''）。这条断言把"同一个 owner"钉死。
    //
    // 用 `workspacePathsEqual` 而不是 `===`：`miniappAppRoot` 按 POSIX 形态拼
    // 字符串，`join()` 在 Windows 上给反斜杠，同一个目录两种字面量。裸 `===`
    // 判路径正是 CLAUDE.md 点名的反模式（Win 下静默永不相等）。
    expect(workspacePathsEqual(miniappAppRoot(APP_ID), appDir())).toBe(true);

    const perms = { fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } };
    writeMeta(perms);
    // 作者视角：用宿主告诉他的那个目录拼路径
    const authorPath = join(miniappAppRoot(APP_ID), 'author-visible.txt');

    const written = await call(perms, 'fs.writeFile', { path: authorPath, data: 'via app.appDataDir' });
    expect(written, `writeFile: ${JSON.stringify(written)}`).toEqual({ ok: true, result: null });
    expect(readFileSync(authorPath, 'utf8')).toBe('via app.appDataDir');

    const read = await call(perms, 'fs.readFile', { path: authorPath });
    expect(read).toEqual({ ok: true, result: 'via app.appDataDir' });
  });

  it('grants a {workspace} read against the very path the sidecar resolves it to', async () => {
    // `{workspace}` 的基准是 sidecar 进程的 `currentAgentDir`，也就是
    // `/api/miniapp/source` 作为 `workspace_dir` 下发给 renderer 的那个值。
    // 同一个字符串喂给 dispatch，作者按 `app.workspaceDir` 拼的路径才可用。
    const workspaceDir = join(sandboxHome, 'projects', 'demo');
    mkdirSync(workspaceDir, { recursive: true });
    const perms = { fs: { read: ['{workspace}/**'] } };
    writeMeta(perms);

    const authorPath = join(workspaceDir, 'notes.md');
    writeFileSync(authorPath, 'workspace scoped', 'utf8');

    const read = await dispatchMiniAppApp('fs.readFile', APP_ID, { path: authorPath }, { workspaceDir });
    expect(read).toEqual({ ok: true, result: 'workspace scoped' });

    // 没有 workspaceDir 时 `{workspace}` 展开为空串 = 恒不匹配（fail-closed），
    // 而不是回退到 appdata 悄悄放行。
    const noCtx = await dispatchMiniAppApp('fs.readFile', APP_ID, { path: authorPath }, {});
    expect(noCtx.ok).toBe(false);
  });
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

describe('ai.cancel has a real abort point', () => {
  // `ai.cancel` 曾经是"暴露给作者却没有生产者"的空壳：调用只会拿到一句
  // "not available"。而一个可能跑满 60s 的补全恰恰是最需要能被中止的那类。
  it('reports "nothing to cancel" instead of erroring', async () => {
    // 作者在请求完成后再 cancel 是网络往返的必然结果，不是异常
    const { resetMiniAppAiInflight } = await import('../miniapp-ai');
    resetMiniAppAiInflight();
    writeMeta({ ai: { enabled: true } });
    const res = await dispatchMiniAppApp('ai.cancel', APP_ID, { run_id: 'ghost' });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ cancelled: false, inflightCount: 0 });
  });

  it('is still gated on ai.enabled like every other ai method', async () => {
    writeMeta({});
    const res = await dispatchMiniAppApp('ai.cancel', APP_ID, { run_id: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('enforces allowed_models on cancel too, so it cannot probe the model space', async () => {
    // cancel 走的是同一个 ai.* 判定分支；漏掉会让未授权的 model 名成为一条
    // 无副作用的探测信道
    writeMeta({ ai: { enabled: true, allowed_models: ['model-a'] } });
    const res = await dispatchMiniAppApp('ai.cancel', APP_ID, { run_id: 'x', model: 'model-b' });
    expect(res.ok).toBe(false);
  });

  describe('every declared method has a real route in the execution layer', () => {
    // `dispatchMiniAppApp` 按 **group** 分派，组内 method 名再走各自的路由。
    // 名单里加一个 `fs.foo` 而忘了在 dispatchFs 里接住，类型系统完全沉默，
    // 作者只在运行时拿到一句 `Unknown method`。这里把那条静默路径变成红灯。
    //
    // 判定用 `UNKNOWN_METHOD` 而不是 `ok`：后者的含义随方法而变（fs.mkdir 真的
    // 建目录，dialog 在 sidecar 侧本来就该被拒），只有 UNKNOWN_METHOD 能唯一
    // 指向「没接线」这一种故障。
    it('never answers UNKNOWN_METHOD for a declared method with grants granted', async () => {
      // 给一份宽到足以让每个方法都通过权限闸门的 meta。这里只关心路由可达性，
      // 不关心调用语义。
      writeMeta({
        fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] },
        shell: { allow: ['git'] },
        net: { allow: ['api.example.com'] },
        node: { enabled: true },
        ai: { enabled: true },
        agent: { enabled: true },
        storage: {},
      });

      // ⚠️ 这条护栏的覆盖范围比它看起来的小，别把它当成「每个方法都验过了」。
      //
      // 它用**空参数**调用。`checkFs` 先查路径再查方法名，缺参数时先以
      // `INVALID_PARAMS` 失败 —— `dispatchFs` 的组内 switch **根本没被进入**。
      // 实测：删掉 `dispatchFs` 里的 `case 'access'`，本用例依然绿。
      // shell.exec / net.fetch 同理，在必填参数处就停住了。
      //
      // `ai.getModels` / `agent.ensureSession` 两条路由也确实没覆盖：它们会动态
      // import 真 SDK / 起真实 Sidecar。此前这里写的是「由本文件上方的 ai/agent
      // 闸门证明」—— 那是假的，那两条 describe 测的是**权限闸门**，全仓库没有
      // 任何测试 dispatch 过这两个方法。
      //
      // 真正的全覆盖护栏在 `miniapp-dispatch-routing.integration.test.ts`：给每个
      // 方法喂它真正需要的参数让权限闸门放行，再把会起进程 / 开 socket 的叶子
      // 就地打桩，于是全部方法都能零副作用地验到 switch。
      const SKIP_EXECUTION = new Set(['ai.getModels', 'agent.ensureSession']);
      const unreachable: string[] = [];
      for (const method of listAppMethods()) {
        if (method === 'call.call') continue; // 走 worker bridge，另有归属
        if (SKIP_EXECUTION.has(method)) continue;
        const res = await dispatchMiniAppApp(method, APP_ID, {});
        if (!res.ok && res.error?.code === 'UNKNOWN_METHOD') unreachable.push(method);
      }
      expect(unreachable).toEqual([]);
    });

    it('still rejects a method that is genuinely not declared', async () => {
      // 反向：护栏本身不能把闸门焊死。
      //
      // 参数必须给一个**合法路径**：`checkFs` 先查路径再查方法名，缺参数时会
      // 先以 INVALID_PARAMS 失败，压根走不到 UNKNOWN_METHOD 那条分支 ——
      // 那样这条断言测的就不是「未声明方法被拒」，而是「缺参数被拒」。
      writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
      const res = await dispatchMiniAppApp('fs.definitelyNotAMethod', APP_ID, {
        path: join(appDir(), 'x.txt'),
      });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('UNKNOWN_METHOD');
    });
  });
});
