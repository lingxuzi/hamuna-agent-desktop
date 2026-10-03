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

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

function writeMeta(permissions: unknown, storage?: unknown): void {
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
      ...(storage === undefined ? {} : { storage }),
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

  // 上一条挡的是**目标路径**里的 `..`（shared 的 normalizePath 折叠掉）。
  // 这一条挡的是**权限前缀**里的 `..`：那里 normalizePath 同样作用，但折叠的
  // 方向是**变宽** —— `{appdata}/../../..` 被折成用户 home 目录本身，于是声明
  // `fs.read: ["{appdata}/../../.."]` 就能读到 ~/.ssh 与 ~/.hamuna/config.json。
  //
  // 之所以要在这里测而不在 shared 的 isPathAllowed 测：调用方必须先展开模板，
  // 而"展开"这一步本身就是漏洞所在。`loadMeta` 是裸 JSON.parse，不走
  // meta-schema，所以 meta.json 可以声明一个安装期校验根本不会拦的形状。
  it('refuses a permission prefix that climbs out of the template root', async () => {
    const outOfRoot = `${'{appdata}'}/${'../'.repeat(3)}`;
    writeMeta({ fs: { read: [outOfRoot], write: [outOfRoot] } });

    // 目标取 home 目录下一个真实存在与否都无所谓的位置：关键是**授权**本身
    // 不该成立，所以这里连"路径存不存在"都不该成为拒绝的理由。
    const outside = join(appDir(), '..', '..', '..', '.ssh', 'id_rsa');
    for (const method of ['fs.readFile', 'fs.writeFile']) {
      const res = await dispatchMiniAppApp(method, APP_ID, {
        path: outside,
        data: 'owned',
      });
      expect(res.ok, `${method} must be denied by a climbing prefix`).toBe(false);
      expect(res.error?.code).toBe('PERMISSION_DENIED');
    }
  });

  it('still honours a plain appdata prefix after the climbing-prefix guard', async () => {
    // 反向护栏：这道闸不能退化成"带 .. 的 meta 一律整个 app 失效"。
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    const inside = join(appDir(), 'ok.txt');
    const res = await dispatchMiniAppApp('fs.writeFile', APP_ID, {
      path: inside,
      data: 'owned',
    });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
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

  it('falls back to meta.json storage.defaults when the key was never written', async () => {
    // SKILL.md:458 教的例子就是 defaults: {items: []}，作者据此写 get('items')
    // 并直接 .map()。修复前宿主读都不读这个键，返回 undefined，作者的代码在
    // 自己那边炸，而宿主全程 ok:true —— 声明过却不生效比不声明更难查。
    writeMeta({}, { defaults: { items: [], theme: 'dark' } });

    expect(await dispatchMiniAppApp('storage.get', APP_ID, { key: 'items' })).toEqual({
      ok: true,
      result: [],
    });
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'theme' })).result).toBe(
      'dark',
    );
    // 没声明过的键仍然是 undefined —— defaults 是回落，不是通配。
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'ghost' })).result)
      .toBeUndefined();
  });

  it('never lets a default paper over a real write, including a stored null', async () => {
    // 用 ?? 回落会在这里错：作者 set(key, null) 存的就是 null，那是一次真实写入，
    // 不是"没有值"。回落必须由键是否存在决定，而不是由值是否 falsy 决定。
    writeMeta({}, { defaults: { items: ['preset'], label: 'preset' } });

    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'items', value: ['mine'] });
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'items' })).result).toEqual(
      ['mine'],
    );

    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'label', value: null });
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'label' })).result).toBeNull();

    // remove 之后回落重新生效：默认值只在"键不存在"时兜底，删掉就是删掉了。
    expect((await dispatchMiniAppApp('storage.remove', APP_ID, { key: 'label' })).result).toBe(
      true,
    );
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'label' })).result).toBe(
      'preset',
    );
  });

  it('keeps defaults off the write path so they never reach storage.json', async () => {
    // defaults 是只读回落。把它们当种子写进 storage.json，会让 get 永远命中"真实"
    // 值，作者再 remove 掉也回不到初值 —— 回落就只对第一次调用有效。
    //
    // 变异注记：只往内存 data 上塞而不落盘（M3）**测不出来也不用测** —— get 分支
    // 必然就地 return，后面的 remove/set 分支根本走不到，那个赋值是死代码。
    // 真正会漏的是落盘那一步，本条正是钉它。
    writeMeta({}, { defaults: { items: [] } });
    await dispatchMiniAppApp('storage.get', APP_ID, { key: 'items' });
    expect(existsSync(join(appDir(), 'storage.json'))).toBe(false);
  });

  it('stores __proto__ as a real key instead of mutating the object prototype', async () => {
    // 赋值语义下 `data['__proto__'] = v` 走的是 Object.prototype 上的 setter，
    // 不产生自有属性：写完 JSON.stringify 仍是 `{}`，值凭空消失。
    writeMeta({});
    const store = join(appDir(), 'storage.json');

    await dispatchMiniAppApp('storage.set', APP_ID, { key: '__proto__', value: { tag: 'x' } });

    expect(Object.keys(JSON.parse(readFileSync(store, 'utf8')))).toEqual(['__proto__']);
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: '__proto__' })).result).toEqual({
      tag: 'x',
    });
  });

  it('a __proto__ key survives an unrelated later write', async () => {
    // 这才是作者真正遇到的症状：刚写完 get 出来是好的，下一次 set 之后就没了。
    // 只断言"存得进去"不够 —— 那恰好是它唯一一次看起来正常的时候。
    writeMeta({});
    await dispatchMiniAppApp('storage.set', APP_ID, { key: '__proto__', value: { tag: 'x' } });

    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'other', value: 1 });

    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: '__proto__' })).result).toEqual({
      tag: 'x',
    });
    expect((await dispatchMiniAppApp('storage.get', APP_ID, { key: 'other' })).result).toBe(1);
  });

  it('get on an inherited name returns undefined rather than a prototype member', async () => {
    // `key in data` 会走原型链，而 key 由作者任意指定：get('toString') 返回函数、
    // get('constructor') 返回 Object —— 一个从没被写过的键却"有值"，作者据此
    // 写的 if (await app.storage.get('x')) 判断会静默走错分支。
    writeMeta({});

    for (const key of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect((await dispatchMiniAppApp('storage.get', APP_ID, { key })).result).toBeUndefined();
    }
  });

  it('remove on an inherited name reports failure instead of a fake success', async () => {
    // delete 一个继承属性是 no-op，但 delete 表达式本身求值为 true。修之前
    // remove('toString') 报成功，作者据此以为清掉了，实际什么都没发生。
    writeMeta({});
    await dispatchMiniAppApp('storage.set', APP_ID, { key: 'real', value: 1 });

    expect((await dispatchMiniAppApp('storage.remove', APP_ID, { key: 'toString' })).result).toBe(
      false,
    );
    // 键本来就不存在，所以这次失败不该顺手把文件重写一遍
    expect(
      JSON.parse(readFileSync(join(appDir(), 'storage.json'), 'utf8')),
    ).toEqual({ real: 1 });
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

  it('does NOT apply allowed_models when the author names no model', async () => {
    // 上面那条钉的是"传了不在名单里的 model -> 拒"。这条钉的是**反方向**，而且方向
    // 与直觉相反，所以要单独一条：声明了 `allowed_models`、作者**不传** model 时，
    // 这一层根本不会因为模型而拒，请求照常往下走。
    //
    // 起因是写 credentialed 真上游用例时实测撞见的：带 `allowed_models` 的 meta +
    // 不带 model 的调用，没有拿到 PERMISSION_DENIED，而是打到了上游才失败。
    // 原因在 `checkAi`（`src/shared/miniapp/app-permissions.ts`）：上限那个分支整体
    // 挂在 `if (model && allowed && allowed.length > 0)` 里，`model` 取的是作者传的
    // `params.model`；不传就是 undefined，整个判定被短路，随后落到宿主自选模型。
    //
    // 所以文档里"allowed_models 声明后即成硬上限"只对**显式指定**的模型成立。这条
    // 让"不指定"这一路不再是个没人注意的缝隙 —— 行为保持现状，但从此是可见且被钉住
    // 的契约，改不改是产品决定（改的话最简用法必须显式命名模型）。
    //
    // 安全上不构成提权：MiniApp 拿不到 Key，也不能把请求指向宿主没登记的上游，最坏
    // 情况只是用宿主自己的默认模型。
    writeMeta({ ai: { enabled: true, allowed_models: ['model-a'] } });

    const res = await dispatchMiniAppApp('ai.complete', APP_ID, { prompt: 'hi' });

    // 关键断言是"没被模型这一层拒"，而不是"请求成功"：真发请求需要凭据（credentialed
    // 池），本机没有，所以这里只钉权限层的判定结果。
    expect(res.error?.message ?? '', 'must not be denied by the allowed_models gate').not.toContain(
      'allowed_models',
    );
    expect(res.error?.code).not.toBe('PERMISSION_DENIED');
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

/**
 * `app.shell.exec` 的**真实执行**。
 *
 * 本文件此前只测 shell 的**闸门**（命令名白名单、元字符拒收），执行侧一个断言
 * 都没有 —— 也就是说"命令跑了但 stdout 是空的""非零退出被当成成功""stderr 丢失"
 * 这三类故障全部测不出来。真 spawn 一条命令很便宜（`echo` / `git`），所以这里
 * 不用 mock。
 *
 * ## 断言的是**真输出**，不是"没抛"
 *
 * renderer 层那条用例是纯透传，stub 的形状宿主根本不会发（`exitCode` vs
 * `exit_code`）；而真正决定作者拿到什么字段的是这里的 dispatch 侧。
 */
describe('app.shell.exec really executes', () => {
  const perms = { shell: { allow: ['echo', 'git', 'node'] } };

  /**
   * 走**两道闸**再执行，与本文件其它用例同一条路：renderer 的 `runAppCall`
   * 预判 + sidecar 的 `dispatchMiniAppApp` 权威复算。
   *
   * 本文件原有的 `call` helper 定义在另一个 describe 的作用域里（它连同
   * `viaRenderer` 一起被圈进去了），所以这里自带一份而不是把它提到模块级 ——
   * 提上去会改动既有 28 条用例的作用域，不值得为一个 helper 扩大影响面。
   */
  async function exec(permissions: unknown, params: unknown) {
    return runAppCall(
      'shell.exec' as never,
      params,
      permissions as never,
      (async (method: string, p: unknown) => {
        const out = await dispatchMiniAppApp(method, APP_ID, p, {});
        return out.ok
          ? { ok: true as const, result: out.result }
          : { ok: false as const, error: out.error };
      }) as never,
    );
  }

  it('returns the real stdout of an allow-listed command', async () => {
    writeMeta(perms);

    const res = await exec(perms, { command: 'echo hello-from-the-sandbox' });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    const out = res.ok ? (res.result as { stdout: string; stderr: string; exit_code: number }) : null;
    // 真内容，不是"非空"这种碰巧也成立的断言
    expect(out?.stdout.trim()).toBe('hello-from-the-sandbox');
    expect(out?.exit_code).toBe(0);
  });

  it('keeps a rejected cwd from escaping the workspace, for a sibling prefix and for `..`', async () => {
    // 两类输入都能骗过裸 `startsWith(ctx.workspaceDir)`，却在解析后落到工作区之外：
    //   1. `<workspace>-backup` —— 与工作区**同前缀**的兄弟目录
    //   2. `<workspace>/..`     —— 回溯（`expandAuthorPath` 只做拼接，不折叠 `..`）
    //
    // 断言方式是**真跑一条命令**并看它究竟在哪个目录执行，而不是断言某个布尔值。
    // `whereami.js` 分别放进工作区、合法子目录与兄弟目录，三份都只打印自己的
    // cwd，于是"逃逸"和"退回工作区"成为两种可区分的输出；纯判定层的断言分不出
    // "被拒"和"被改成别的东西"。
    writeMeta(perms);
    const workspaceDir = join(sandboxHome, 'projects', 'shell-cwd');
    const innerDir = join(workspaceDir, 'inner');
    const siblingDir = `${workspaceDir}-backup`;
    const whereami = 'console.log(process.cwd())';
    for (const dir of [workspaceDir, innerDir, siblingDir]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'whereami.js'), whereami, 'utf8');
    }

    const runIn = async (cwd: string | undefined) => {
      const res = await runAppCall(
        'shell.exec' as never,
        { command: 'node whereami.js', opts: cwd === undefined ? null : { cwd } },
        perms as never,
        (async (method: string, p: unknown) => {
          const out = await dispatchMiniAppApp(method, APP_ID, p, { workspaceDir });
          return out.ok
            ? { ok: true as const, result: out.result }
            : { ok: false as const, error: out.error };
        }) as never,
      );
      return (res.ok ? (res.result as { stdout: string }) : { stdout: '' }).stdout.trim();
    };

    // 不传 cwd 的基线：dispatchShell 会退回 workspaceDir。
    const baseline = await runIn(undefined);
    expect(baseline).not.toBe('');
    // 合法子目录必须**生效**，否则下面两条"退回基线"就没有意义 ——
    // 一个把所有 cwd 都拒掉的实现也能让它们通过。
    expect(await runIn(innerDir)).not.toBe(baseline);
    // 两个越界输入都必须退回基线，而不是在兄弟目录 / 父目录里执行。
    expect(await runIn(siblingDir)).toBe(baseline);
    expect(await runIn(join(workspaceDir, '..'))).toBe(baseline);
  });

  it('reports a non-zero exit as ok:true + exit_code, not as a host error', async () => {
    // 这是最容易做错的一处：命令**跑了**但失败了，不是宿主出错。作者要靠
    // exit_code 区分"命令失败"与"权限被拒"，压成异常就丢了这条信息。
    //
    // 脚本落盘再 `node <path>`，而不是 `node -e "..."`：元字符闸门
    // (`SHELL_METACHARACTERS` 收 `; & | < > ^ \` % ! ( ) $ " '`) 连引号和括号
    // 一起拒，所以内联写法压根到不了执行层 —— 这是**设计**，不是缺陷。
    writeMeta(perms);
    const script = join(sandboxHome, 'exit3.js');
    writeFileSync(script, 'process.exit(3);', 'utf8');

    const res = await exec(perms, { command: `node ${script}` });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    const out = res.ok ? (res.result as { stdout: string; exit_code: number }) : null;
    expect(out?.exit_code).toBe(3);
  });

  it('keeps stderr instead of swallowing it into an empty string', async () => {
    writeMeta(perms);
    const script = join(sandboxHome, 'boom.js');
    writeFileSync(script, "console.error('boom'); process.exit(1);", 'utf8');

    const res = await exec(perms, { command: `node ${script}` });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    const out = res.ok ? (res.result as { stdout: string; stderr: string }) : null;
    expect(out?.stderr).toContain('boom');
  });

  it('does not hand the MiniApp the host environment', async () => {
    // env 只给 PATH。宿主进程里的变量（含 provider 凭据相关的）不能流进
    // MiniApp 起的进程 —— 这一条是执行侧唯一的凭据边界。
    writeMeta(perms);
    const marker = 'HAMUNA_MINIAPP_ENV_PROBE_9d2f';
    const script = join(sandboxHome, 'envprobe.js');
    writeFileSync(script, 'process.stdout.write(String(process.env.HAMUNA_MINIAPP_ENV_PROBE_9d2f));', 'utf8');
    const previous = process.env[marker];
    process.env[marker] = 'host-secret';
    try {
      const res = await exec(perms, { command: `node ${script}` });

      expect(res.ok, JSON.stringify(res)).toBe(true);
      const out = res.ok ? (res.result as { stdout: string }) : null;
      // 宿主里有值，子进程里读出来必须是 undefined —— 传下去就成了泄漏。
      expect(out?.stdout).toBe('undefined');
    } finally {
      if (previous === undefined) delete process.env[marker];
      else process.env[marker] = previous;
    }
  });

  it('refuses an inline -e script, because quotes and parens are metacharacters', async () => {
    // 上一两条本来都写成 `node -e "..."`，结果被元字符闸门挡在执行层之前。
    // 顺手把这条约束钉住：作者最容易先试的就是内联写法，而它**永远**不成立，
    // 症状是 PERMISSION_DENIED 而不是一句「引号不支持」。
    writeMeta(perms);

    const res = await exec(perms, { command: 'node -e "process.exit(3)"' });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a denial');
    expect(res.error.code).toBe('PERMISSION_DENIED');
  });
});