/**
 * 作者传入的**目标路径**里的模板展开（integration 池）。
 *
 * ## 这个文件锁的是哪个洞
 *
 * `permissions.fs.*` 的**声明前缀**一直是展开的（`expandTemplates`），但作者在
 * `app.fs.readFile('{appdata}/notes.md')` 里传的**目标路径**从来没人展开 —— 它
 * 原样进 `isPathAllowed` 与 `node:fs`。后果是 `bundled-skills/miniapp-creator/
 * SKILL.md:61-63` 教的**标准写法必然被拒**：
 *
 *     fs.readFile path not covered by permissions.fs.read
 *
 * 模板串不可能匹配展开后的绝对前缀，所以这不是"某些情况失效"，是**这一族调用
 * 100% 失效**。同时它也不可能"漏放行"——判定仍然照跑，只是判的是一个作者
 * 没写的路径。
 *
 * ## 为什么必须是 integration
 *
 * 展开依赖真实 appdata 根（`getConfigDir()`）与真实 fs 语义。只测 `expandAuthorPath`
 * 这个纯函数会漏掉真正的故障形态：**闸门与执行看到的是不是同一个字符串**。
 * 那正是本文件每条用例都在两端各验一次的原因（判定结果 + 磁盘真实结果）。
 *
 * ## 不测什么
 *
 * 不测 `{user-selected}` 的正向路径 —— 它依赖 dialog 记录的用户选择，Phase 2 才
 * 接；这里只锁它**当前不可用且失败方向是拒**（见「不可解析的模板」一节）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_ID = 'tmpl-probe';

let sandboxHome = '';

// 与 miniapp-app-dispatch.integration.test.ts 同一手法：mock `getConfigDir` 而
// 不是改 `process.env.HOME`（后者在 Windows 读 %USERPROFILE%，且可能被 Node 缓存，
// 靠环境变量做沙箱会在另一个平台静默失效并写进用户真实目录）。
vi.mock('../utils/admin-config', () => ({ getConfigDir: () => sandboxHome }));

const { dispatchMiniAppApp } = await import('../miniapp-app-dispatch');
type DispatchOutcome = import('../miniapp-app-dispatch').DispatchOutcome;

function appDir(): string {
  return join(sandboxHome, 'miniapps', APP_ID);
}

function writeMeta(permissions: unknown): void {
  mkdirSync(appDir(), { recursive: true });
  writeFileSync(
    join(appDir(), 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Template Probe',
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

/** 跑一次调用，返回 `{ok, result|error}`（dispatcher 从不 throw）。 */
async function call(method: string, params: unknown, workspaceDir: string | null = null) {
  return dispatchMiniAppApp(method, APP_ID, params, { workspaceDir });
}

/**
 * 断言"被拒"，并把拒绝理由交出来。
 *
 * 不用 `expect(!out.ok && out.error.code)`：TS 不会因为 `!out.ok` 把 `out.error`
 * 收窄成必有（`DispatchOutcome` 的 error 字段在类型上可选），于是每个断言都得
 * 再写一次 `!out.ok &&`，读起来像在防一件不可能发生的事。集中在这里一次解决。
 */
function expectDenied(out: DispatchOutcome): { code?: string; message: string } {
  expect(out.ok).toBe(false);
  if (out.ok) throw new Error('unreachable: just asserted !ok');
  return { code: out.error?.code, message: String(out.error?.message ?? '') };
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'miniapp-tmpl-'));
});

afterEach(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // Windows 上句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('app.fs.* 的目标路径模板', () => {
  it('readFile({appdata}/x) 读到真实内容 —— SKILL.md 教的写法', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    writeFileSync(join(appDir(), 'notes.md'), 'secret notes\n', 'utf8');

    const out = await call('fs.readFile', { path: '{appdata}/notes.md' });

    // 判定侧：不再是 PERMISSION_DENIED
    expect(out.ok).toBe(true);
    // 执行侧：真的读到了盘上的字节（不是信封对象、不是 undefined）
    expect(out.ok && out.result).toBe('secret notes\n');
  });

  it('writeFile({appdata}/x) 真的落盘，且后续 readFile 读得到', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });

    const w = await call('fs.writeFile', { path: '{appdata}/out.txt', data: 'written\n' });
    expect(w.ok).toBe(true);

    // 执行侧独立验盘：不信任返回值，只信文件系统
    expect(readFileSync(join(appDir(), 'out.txt'), 'utf8')).toBe('written\n');

    const r = await call('fs.readFile', { path: '{appdata}/out.txt' });
    expect(r.ok && r.result).toBe('written\n');
  });

  it('copyFile / rename 的 from 与 to 都展开（两个路径字段，不只 path）', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    writeFileSync(join(appDir(), 'a.txt'), 'A\n', 'utf8');
    writeFileSync(join(appDir(), 'b.txt'), 'B\n', 'utf8');

    // copyFile: from 走读侧、to 走写侧
    const c = await call('fs.copyFile', { from: '{appdata}/a.txt', to: '{appdata}/c.txt' });
    expect(c.ok).toBe(true);
    expect(readFileSync(join(appDir(), 'c.txt'), 'utf8')).toBe('A\n');

    // rename: 目标不存在时也应成功（证明 to 展开到了真实路径而非模板串）
    const n = await call('fs.rename', { from: '{appdata}/b.txt', to: '{appdata}/d.txt' });
    expect(n.ok).toBe(true);
    expect(existsSync(join(appDir(), 'b.txt'))).toBe(false);
    expect(readFileSync(join(appDir(), 'd.txt'), 'utf8')).toBe('B\n');
  });

  it('readdir({appdata}) 列出真实条目', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    writeFileSync(join(appDir(), 'one.txt'), '1', 'utf8');
    writeFileSync(join(appDir(), 'two.txt'), '2', 'utf8');

    const out = await call('fs.readdir', { path: '{appdata}' });
    expect(out.ok).toBe(true);
    expect(out.ok && out.result).toEqual(
      expect.arrayContaining(['meta.json', 'one.txt', 'two.txt']),
    );
  });

  it('绝对路径仍然原样工作（展开不能把既有行为改坏）', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    writeFileSync(join(appDir(), 'plain.txt'), 'plain\n', 'utf8');

    const out = await call('fs.readFile', { path: join(appDir(), 'plain.txt') });
    expect(out.ok && out.result).toBe('plain\n');
  });
});

describe('展开不能变成绕过权限的后门', () => {
  it('目标里的 .. 折叠后越出 appdata 仍被拒', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    // sandboxHome 是 appdata 的祖先；折叠后指向 miniapps/ 这一层，不在 appdata 内
    const escape = '{appdata}/../other-app/secret.txt';
    mkdirSync(join(sandboxHome, 'miniapps', 'other-app'), { recursive: true });
    writeFileSync(join(sandboxHome, 'miniapps', 'other-app', 'secret.txt'), 'LEAKED', 'utf8');

    const out = await call('fs.readFile', { path: escape });

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
  });

  it('目标里的 .. 折叠后仍越不出（连 .. 多层也拒）', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });
    writeFileSync(join(sandboxHome, 'top-secret.txt'), 'LEAKED', 'utf8');

    const out = await call('fs.readFile', { path: '{appdata}/../../top-secret.txt' });

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
  });

  it('中段模板不是合法写法，判拒而不是当字面量', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });

    const out = await call('fs.readFile', { path: '/etc/{appdata}/passwd' });

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
  });

  it('不可解析的模板（{user-selected}）fail-closed —— 绝不能变成进程 cwd', async () => {
    // 这一条是本文件里最容易写错的一条：声明前缀展开失败可以退化成空串
    // （空串恒不匹配，安全）；**目标**路径退化成空串则会被 node:fs 解析成
    // 进程 cwd，等于凭空多出一个"读当前目录"的能力。所以必须显式拒。
    //
    // 诚实记录：把 `expandAuthorPath` 的 `return null` 改成 `return ''` 本文件
    // **测不出来**（实测存活），因为 `isPathAllowed` 第 94 行 `if (!target)
    // return false` 已经先拒掉空串，shell 那侧也有 startsWith 兜底 —— 两条路
    // 都判否，所以那条变异与本实现**语义等价**。保留显式 `null` 是因为它给出
    // 可读的错误、且不依赖另一个模块的远端不变量；不为等价变异硬造红断言。
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/**'] } });

    const out = await call('fs.readFile', { path: '{user-selected}/notes.md' });

    const denied = expectDenied(out);
    expect(denied.code).toBe('PERMISSION_DENIED');
    // 关键：不是"读到了某个 cwd 下的文件"，而是根本没执行
    expect(denied.message).not.toMatch(/ENOENT|no such file/i);
  });

  it('未声明的模板根判拒（{workspace} 在无工作区时不可解析）', async () => {
    writeMeta({ fs: { read: ['{workspace}/**'], write: ['{workspace}/**'] } });

    // workspaceDir = null → {workspace} 无法解析
    const out = await call('fs.readFile', { path: '{workspace}/README.md' }, null);

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
  });
});

describe('app.shell.exec 的 cwd 模板', () => {
  it('cwd={workspace} 真的落在工作区里执行', async () => {
    writeMeta({ shell: { allow: ['git'] } });
    const ws = join(sandboxHome, 'ws');
    mkdirSync(ws, { recursive: true });

    const out = await call('shell.exec', { command: 'git --version', opts: { cwd: '{workspace}' } }, ws);

    // 只断言"真的跑起来了"：stdout 非空且不是 "not a git repository" 之类
    expect(out.ok).toBe(true);
    expect(out.ok && (out.result as { stdout: string }).stdout).toMatch(/git version/);
  });
});

describe('声明前缀里的 .. 仍然被拒（既有的执行侧闸门）', () => {
  /**
   * 这一族与目标路径的 `..` 方向**相反**，是本文件唯一覆盖 `escapesTemplateRoot`
   * 的地方，所以单独成节。
   *
   * `..` 出现在**目标**里由 `normalizePath` 折叠，方向是变窄（安全）；出现在
   * **声明前缀**里时 `normalizePath` 同样作用在 prefix 上，于是
   * `{appdata}/../../..` 被折成 home 目录本身，方向是**变宽**：
   * 声明 `fs.read: ["{appdata}/../../.."]` 就能读 `~/.ssh/id_rsa` 与
   * `~/.hamuna/config.json`（provider 凭据）。
   *
   * 这是执行侧的闸而不是 schema 侧的：`loadMeta` 是裸 `JSON.parse`，不走
   * `meta-schema.ts`，手工改过的 `meta.json` 根本不经过 `validatePathTemplatePrefix`。
   * 真正说了算的就是 `expandTemplates` 里那一步。
   */
  it('fs.read 声明 {appdata}/../../.. 读不到 home 下的文件', async () => {
    writeMeta({ fs: { read: ['{appdata}/../../..'], write: [] } });
    // sandboxHome 扮演 home；把"凭据"放在 appdata 之外、但在 sandboxHome 之内，
    // 这样只要前缀被折叠变宽就一定读得到。
    writeFileSync(join(sandboxHome, 'id_rsa'), 'PRIVATE KEY', 'utf8');

    const out = await call('fs.readFile', { path: join(sandboxHome, 'id_rsa') });

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
  });

  it('fs.write 声明 {appdata}/../.. 写不进 appdata 之外', async () => {
    writeMeta({ fs: { read: ['{appdata}/**'], write: ['{appdata}/../..'] } });
    const victim = join(sandboxHome, 'victim.txt');

    const out = await call('fs.writeFile', { path: victim, data: 'CLOBBERED' });

    expect(expectDenied(out).code).toBe('PERMISSION_DENIED');
    // 独立验盘：不能只信返回值
    expect(existsSync(victim)).toBe(false);
  });
});
