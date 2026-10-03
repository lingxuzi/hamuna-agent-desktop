// bundled-apps-permissions.test.ts — 内置 MiniApp 的「自证可运行」护栏。
//
// ## 为什么需要这个文件
//
// MiniApp 的权限模型是**白名单**：没声明 = 全禁。这对作者是对的，但产生了一个
// 没人看守的失效模式 —— 作者（这里就是我们自己）在 `source/ui.js` 里调
// `app.call(...)`，在 `meta.json` 里忘了声明对应的 `node.enabled`，于是
// **每一次调用都在 renderer 闸被拒**，app 装得上、打得开、点什么都毫无反应，
// 而且没有任何一层会报错：拒绝本身就是正确的行为。
//
// 这个形状不会自己暴露。`meta.json` 合法、schema 通过、MiniApp 出现在市场列表里、
// iframe 正常渲染 —— 唯一"坏"的地方是它在运行时什么都不做。
//
// ## 为什么是「扫源码里的 app.* 调用」而不是逐个手写
//
// 手写的期望列表会和实现一起漂移，改了一个方法名没人会发现。这里的做法是
// 从 `source/` 里把作者真正写的 `app.<组>.<方法>` 抠出来，逐个喂给
// `checkAppPermission` —— 也就是**运行时真正会跑的那个判定函数**。所以这不是
// 重复实现一遍权限表，而是拿真实源码去问真实判定："这些调用，你放行吗？"
//
// 判定函数对路径类的 `fs.*` 需要展开后的前缀，对内建 app 来说 appdata /
// workspace 的具体路径与"是否声明了"无关，所以这里用占位模板判定，与
// renderer 预判用的是同一份 shared 逻辑。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listAppMethods } from './app-protocol';
import { checkAppPermission } from './app-permissions';
import type { MiniAppPermissions } from './types';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');
const APPDATA = 'C:/probe/miniapps/probe';
const METHODS = new Set(listAppMethods());

/**
 * 从源码里抠出作者真正写的 `app.*` 能力引用。
 *
 * 两种形态都要认，因为内建 app 两种都写：
 *   - `app.shell.exec(...)` / `app.ai.chat(...)` —— 直接调方法
 *   - `return app.call(method, params);` —— 把 `app.call` 当函数传走
 *     （git-graph / file-explorer 都是这个形态，所以**只**匹配三段式会一个都
 *     匹配不到，整份护栏静默全绿 —— 那正是它要防的失效）
 *
 * 做法是穷举 `listAppMethods()` 的 34 个名字做子串匹配，而不是写正则：方法名是
 * 既有的唯一权威，写正则等于在护栏里再抄一份方法表，改名就会漂移。
 */
function extractCalls(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/\bapp\.([A-Za-z][A-Za-z0-9]*)/g)) {
    const head = m[1];
    // 逐个尝试把 `app.<head>` 延长成完整方法名，取最长匹配。
    let best: string | null = null;
    for (const full of METHODS) {
      if (full === head || full.startsWith(`${head}.`)) {
        if (!best || full.length > best.length) best = full;
      }
    }
    if (best) found.add(best);
  }
  return [...found].sort();
}

/** 这些组是「宿主 UI / 自身状态」能力，不需要 meta 声明（见 checkAppPermission）。 */
const UNDECLARABLE = new Set(['storage', 'os', 'dialog']);

interface AppUnderTest {
  id: string;
  perms: MiniAppPermissions;
  calls: string[];
}

function readSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      readSourceFiles(full, out);
    } else if (/\.(js|html)$/.test(entry)) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}

function loadApps(): AppUnderTest[] {
  const apps: AppUnderTest[] = [];
  for (const entry of readdirSync(BUNDLED_ROOT)) {
    if (entry.startsWith('_')) continue; // `_e2e-fixtures` are test inputs, not shipped
    const dir = join(BUNDLED_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      id: string;
      permissions?: MiniAppPermissions;
    };
    const source = readSourceFiles(join(dir, 'source')).join('\n');
    apps.push({ id: meta.id, perms: meta.permissions ?? {}, calls: extractCalls(source) });
  }
  return apps;
}

const APPS = loadApps();

/**
 * 已知的、内置 app 的 meta 与自己的 source 对不上的地方。
 *
 * 这些 app 目前**装得上、iframe 正常渲染、点什么都毫无反应** —— 拒绝是正确的
 * 行为，所以没有任何一层会报错，也没有任何一条日志会指向根因。这不是假想的：
 * 下面每一条都是对着仓库里那些 meta.json 实跑出来的。
 *
 * 之所以写死在这里而不是让测试自己推导期望值：推导出来的"期望失败"等于没有
 * 期望 —— app 修好了它也跟着一起变绿，永远不会提醒任何人。
 *
 * 修法都是往 meta 里补声明：
 *   - `git-graph` / `file-explorer`：`"node": { "enabled": true }`
 *     （`app.call` 要它；`ui.js` 全程只靠 `app.call(method, params)`）
 *   - `icon-generator`：`"ai": { "enabled": true }` + `shell.allow` 里放行它
 *     真正跑的那条命令
 *
 * ⚠️ 这些 meta 正在被另一个会话并行编辑，所以本轮**没有**去改它们。改这里的
 * 唯一风险是把对方的 hunk 一起 stage 掉。
 *
 * `it.fails` 在 app 修好之后会自己转红（"expected to fail but passed"），
 * 那正是提示把这一项从 `it.fails` 改回 `it` 的时机。
 */
const KNOWN_GAPS: Record<string, string[]> = {
  'git-graph': ['call.call'],
  'file-explorer': ['call.call'],
  'icon-generator': ['ai.getModels', 'shell.exec'],
};

function deniedCalls(app: AppUnderTest): string[] {
  const perms: MiniAppPermissions = { ...app.perms, fs: expandedFs(app.perms) };
  const out: string[] = [];
  for (const call of app.calls) {
    if (UNDECLARABLE.has(call.split('.')[0])) continue;
    if (!checkAppPermission(call, probeFor(call, app.perms), perms).allowed) out.push(call);
  }
  return out;
}

/**
 * 每个方法的「能通过判定」所需最小参数形状。
 *
 * `fs.*` 的 probe 路径**由该 app 自己的声明推出来**，不是写死的。这一点很要紧：
 * icon-generator 声明 `fs.write: ["{appdata}/**"]` 然后调 `app.fs.appendFile`
 * 写自己的 appdata，那是**正确用法**；写死一个工作区外的路径会把它误判成缺陷。
 * 所以这里把 `{appdata}` 展开成占位 appdata，取该 app 自己声明的那一侧前缀作为
 * probe —— 声明为空则用空数组（`isPathAllowed` 恒不匹配，于是正确地判成"没授权"）。
 */
const FS_READ = new Set(['readFile', 'readdir', 'stat', 'lstat', 'access']);
/** 其余 fs 方法（writeFile/appendFile/mkdir/rm/rmdir/unlink/copyFile/rename）都是写侧。
 *  这里故意只列读侧、不列写侧：判据与 `checkFs` 一致 —— 不在读侧集合里的一律
 *  当写侧查，那是更严的一侧，新加一个写方法也不会被漏判成"读侧所以不需要声明"。 */

function probeFor(method: string, perms: MiniAppPermissions): Record<string, unknown> {
  const [group, name] = method.split('.');
  if (group === 'fs') {
    const side = FS_READ.has(name) ? 'read' : 'write';
    const declared = expandedFs(perms)[side] ?? [];
    return { path: `${declared[0]?.replace(/\/?\*\*$/, '') ?? `${APPDATA}/never-granted`}/probe.txt` };
  }
  if (group === 'net') return { url: 'https://api.example.com/x' };
  if (group === 'shell') return { command: 'probe' };
  if (group === 'ai') return { prompt: 'probe' };
  return {};
}

/**
 * `checkAppPermission` 收的是**展开后**的前缀 —— sidecar 侧一直是先
 * `expandTemplates` 再喂进来的（见 `resolvePolicyForSidecar`）。直接把 meta.json
 * 里未展开的 `{appdata}/**` 塞进去，会让每个 fs 调用都判成"没授权"，于是这个
 * 护栏会把一切 fs 用法全报成缺陷。这里补上展开那一步。
 */
function expandedFs(perms: MiniAppPermissions): { read: string[]; write: string[] } {
  const expand = (list: string[] | undefined) =>
    (list ?? []).map((p) => p.replace(/\{appdata\}/g, APPDATA));
  return { read: expand(perms.fs?.read), write: expand(perms.fs?.write) };
}

describe('bundled MiniApps: every app.* call in source is covered by its own meta', () => {
  it('finds the bundled apps at all (guards against a silently empty fixture)', () => {
    expect(APPS.length).toBeGreaterThan(0);
    expect(APPS.map((a) => a.id)).toContain('hello-miniapp');
  });

  it('scans real app.* call sites out of bundled sources', () => {
    // If this ever drops to zero the extractor broke and every test below would
    // pass vacuously — the exact failure this file exists to prevent. Assert the
    // shape that actually occurs in-tree, `app.call(method, params)`, so a
    // three-segment-only matcher cannot come back.
    const total = APPS.reduce((n, a) => n + a.calls.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(APPS.some((a) => a.calls.includes('call.call'))).toBe(true);
    expect(APPS.some((a) => a.calls.includes('shell.exec'))).toBe(true);
  });

  for (const app of APPS) {
    const known = KNOWN_GAPS[app.id];
    const name = known
      ? `'${app.id}' — KNOWN GAP, calls without declaring: ${known.join(', ')}`
      : `'${app.id}' declares everything its source calls`;

    // 断言始终是「一个都不该欠」——`it.fails` 的作用是让这条**如实**红着。
    // 如果改成「红到正好等于 KNOWN_GAPS」，它就会变绿，护栏立刻失去意义。
    const check = () => expect(deniedCalls(app), `'${app.id}'`).toEqual([]);

    if (known) it.fails(name, check);
    else it(name, check);
  }

  it('the known-gap list is still accurate — remove entries as metas get fixed', () => {
    // 防止 KNOWN_GAPS 变成一份"历史记录"：app 修好了就把它从这里删掉，
    // 于是下一条 `it.fails` 转红、这一条转绿，两边都指向同一个动作。
    for (const [id, gap] of Object.entries(KNOWN_GAPS)) {
      const app = APPS.find((a) => a.id === id);
      expect(app, `KNOWN_GAPS 里的 '${id}' 不存在了`).toBeDefined();
      expect(deniedCalls(app!), `${id} 已经不欠 ${gap.join(',')} 了，从 KNOWN_GAPS 里删掉`).toEqual(gap);
    }
  });
});
