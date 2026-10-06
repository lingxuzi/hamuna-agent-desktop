/**
 * `resolveMiniAppFsScope`（`miniapp-app-dispatch.ts`）—— worker 通道的 fs 授权前缀解析。
 *
 * ## 为什么这份测试单独存在
 *
 * `app.fs.*` 走 `runAppCall`，其中 `expandTemplates` 的行为已经被
 * `miniapp-app-dispatch.integration.test.ts` 间接覆盖。但 `kind: 'worker'` 的
 * MiniApp 有一条**独立通道**：`app.call('file.read' | 'git.checkout', …)` 直接进
 * worker 线程，不经过 `runAppCall`（见 `resolveMiniAppFsScope` 的文档注释）。
 *
 * 那条路上唯一说得上权限判定的就是这里产出的 `WorkerFsScope`：
 * `miniapp-worker/worker-rpc.ts` 拿它做 `isPathAllowed`，`file-explorer` 用
 * `assertReadableRoot`、`git-graph` 用 `assertReadableCwd`。也就是说**这里返回什么，
 * worker 就能碰什么**。而它此前零覆盖 —— 一旦有人把 `expandTemplates` 换成直传
 * 原始模板（`{appdata}/../../..`），`app.fs` 侧的全套测试依然全绿，worker 却已经
 * 能读 `~/.ssh/id_rsa`。
 *
 * ## 用 unit 池而不是 integration
 *
 * 函数只读一个 `meta.json`，不 spawn、不起 SDK。参照同目录
 * `miniapp-worker/node-limits.unit.test.ts`：在 unit 池里用真实临时目录做真实 fs
 * 读取，不 mock `node:fs` —— mock 掉 fs 的测试等于在测 mock。
 *
 * `getConfigDir` 必须 mock（与 integration 文件同一手法）：绝不能写用户真实 HOME。
 * 刻意不改 `process.env.HOME` —— 它在 POSIX 读 `$HOME`、在 Windows 读
 * `%USERPROFILE%`，且 `os.homedir()` 可能缓存首次结果，靠环境变量做沙箱会在另一个
 * 平台上静默失效、把测试数据写进用户真实目录。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sandboxHome = '';

vi.mock('./utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

const { resolveMiniAppFsScope, miniappAppRoot } = await import('./miniapp-app-dispatch');

const APP_ID = 'scope-probe';

function appDir(): string {
  return join(sandboxHome, 'miniapps', APP_ID);
}

/** 写一份最小可用的 meta.json；`permissions.fs` 由调用方给定。 */
function writeMeta(fsPerms: unknown, id = APP_ID): void {
  mkdirSync(appDir(), { recursive: true });
  writeFileSync(
    join(appDir(), 'meta.json'),
    JSON.stringify({
      id,
      name: 'Scope Probe',
      description: 'unit fixture',
      kind: 'worker',
      worker_kind: 'file-explorer',
      entry: 'worker.js',
      permissions: fsPerms === undefined ? {} : { fs: fsPerms },
    }),
  );
}

/** 不写 meta.json —— 模拟"没装 / 装坏"。 */
function noMeta(): void {
  mkdirSync(appDir(), { recursive: true });
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'hamuna-fs-scope-'));
});

afterEach(() => {
  rmSync(sandboxHome, { recursive: true, force: true });
});

describe('resolveMiniAppFsScope — 模板展开', () => {
  it('把 {appdata} 展开成 app 根目录本身', async () => {
    writeMeta({ read: ['{appdata}'], write: ['{appdata}'] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual([miniappAppRoot(APP_ID)]);
    expect(scope.write).toEqual([miniappAppRoot(APP_ID)]);
  });

  it('把 {appdata}/data 展开成 app 根下的子目录', async () => {
    writeMeta({ read: ['{appdata}/data'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual([`${miniappAppRoot(APP_ID)}/data`]);
  });

  it('把 {workspace} 展开成传入的 workspace 目录', async () => {
    writeMeta({ read: ['{workspace}'], write: ['{workspace}/out'] });
    const scope = await resolveMiniAppFsScope(APP_ID, '/ws');
    expect(scope.read).toEqual(['/ws']);
    expect(scope.write).toEqual(['/ws/out']);
  });

  it('{workspace} 在没有 workspace 上下文时展开为空串（fail-closed）', async () => {
    writeMeta({ read: ['{workspace}'], write: ['{workspace}'] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    // 空串在 isPathAllowed 里恒不匹配 = "声明了但当前不可用"，而不是放行。
    expect(scope.read).toEqual(['']);
    expect(scope.write).toEqual(['']);
  });

  it('{user-selected} 展开为空串（Phase 2 未接线，方向安全）', async () => {
    writeMeta({ read: ['{user-selected}'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, '/ws');
    expect(scope.read).toEqual(['']);
  });
});

describe('resolveMiniAppFsScope — 拒绝越出模板根的声明前缀', () => {
  // 这是本文件最重要的一组。`..` 出现在**权限前缀**里时，isPathAllowed 的
  // normalizePath 会把它折成**变宽**的路径：`{appdata}/../../..` 于是折成用户 home
  // 目录本身，于是能读到 ~/.ssh/id_rsa 与 ~/.hamuna/config.json（provider 凭据）。
  // escapesTemplateRoot 必须在展开这一步就把它换成空串。
  it('拒绝 {appdata}/../../..（否则整个 home 目录变成可读）', async () => {
    writeMeta({ read: ['{appdata}/../../..'], write: ['{appdata}/../../..'] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual(['']);
    expect(scope.write).toEqual(['']);
  });

  it('拒绝 {workspace} 之外的回退段', async () => {
    writeMeta({ read: ['{workspace}/../../secrets'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, '/ws');
    expect(scope.read).toEqual(['']);
  });

  it('反斜杠分隔的 .. 段同样被拒（Windows 形态）', async () => {
    writeMeta({ read: ['{appdata}\\..\\..'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual(['']);
  });

  it('嵌在中间的 .. 段同样被拒', async () => {
    writeMeta({ read: ['{appdata}/a/../../b'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual(['']);
  });

  it('同类名的合法段不被误伤（a..b 不是 ..）', async () => {
    writeMeta({ read: ['{appdata}/a..b'], write: [] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual([`${miniappAppRoot(APP_ID)}/a..b`]);
  });

  it('有效与越权前缀混在一起时，越权那一条单独变空串', async () => {
    writeMeta({
      read: ['{appdata}/ok', '{appdata}/../../..', '{workspace}'],
      write: ['{appdata}/../../..'],
    });
    const scope = await resolveMiniAppFsScope(APP_ID, '/ws');
    expect(scope.read).toEqual([`${miniappAppRoot(APP_ID)}/ok`, '', '/ws']);
    expect(scope.write).toEqual(['']);
  });
});

describe('resolveMiniAppFsScope — 读不到 meta 时 fail-closed', () => {
  it('没有 meta.json 时 read/write 都是空数组', async () => {
    noMeta();
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope).toEqual({ read: [], write: [] });
  });

  it('meta.id 与目录名不一致（冒名）时返回空数组', async () => {
    // loadMeta 显式要求 meta.id === appId，防目录穿越式冒名：把 A 的目录改名成 B
    // 之后，A 的授权不该跟着生效。
    writeMeta({ read: ['{appdata}'], write: ['{appdata}'] }, 'someone-else');
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope).toEqual({ read: [], write: [] });
  });

  it('meta.json 语法损坏时返回空数组', async () => {
    mkdirSync(appDir(), { recursive: true });
    writeFileSync(join(appDir(), 'meta.json'), '{ this is not json');
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope).toEqual({ read: [], write: [] });
  });

  it('meta 没有 permissions.fs 时返回空数组', async () => {
    writeMeta(undefined);
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope).toEqual({ read: [], write: [] });
  });

  it('只有 write 没有 read 时，read 为空而不报错', async () => {
    writeMeta({ write: ['{appdata}/w'] });
    const scope = await resolveMiniAppFsScope(APP_ID, null);
    expect(scope.read).toEqual([]);
    expect(scope.write).toEqual([`${miniappAppRoot(APP_ID)}/w`]);
  });
});
