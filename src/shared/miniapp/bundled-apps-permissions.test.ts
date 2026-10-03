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
 * 去掉 JS 注释再扫。**逐个文件**调用，不要对拼起来的大字符串调用。
 *
 * 两个坑都是实测踩出来的，不是假想的：
 *
 * 1. 拼起来再剥会吃跨文件的注释。`worker-blacklist.ts` 里有一个模板字符串写着
 *    `` `/**` pattern ``，其中的 `/**` 被当成块注释开头，一路吞掉 7187 个字符
 *    才在另一个文件里撞到结束标记。后果是那条线后面的真代码全部隐形：同一次
 *    改动下"拼起来剥"数出 1 处写侧闸门，"逐文件剥"数出 3 处 —— 少了两个，
 *    护栏从红变绿。
 *
 * 2. 光靠一条 block-comment 正则不够，必须先跳过字符串 / 模板串 / 正则字面量，
 *    否则字符串里的 `/*`、`//` 同样会开出假注释（见上面那个 `/**`）。
 *
 * 局限说清楚：这是文本层近似，不做完整语法分析。正则字面量用"上一个有效字符"
 * 启发式区分于除法（`(`, `,`, `=`, `:`, `return` 之后才是正则），对当前这批内建
 * app 够用；失败方向是偶尔少扫到，而不是多扫到 —— 少扫到会转成红，不会误绿。
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let prev = ''; // 上一个「有效」字符，用来区分正则字面量与除法
  const startsRegex = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

  while (i < src.length) {
    const c = src[i]!;
    const c2 = src.slice(i, i + 2);

    if (c2 === '//') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c2 === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === c) {
          i++;
          break;
        }
        i++;
      }
      // 原样保留内容（只跳过、不清空）。清空是错的：`assertWithinFsScope(p, s,
      // 'write', ctx)` 里的 `'write'` 正是要找的东西，一清空就数出 0 处。
      out += src.slice(start, i);
      prev = c;
      continue;
    }
    if (c === '/' && (prev === '' || startsRegex.has(prev))) {
      // 正则字面量：连字符表一起跳掉，否则里面的 `/` 会被再次当成除法。
      const start = i;
      i++;
      let inClass = false;
      while (i < src.length) {
        const r = src[i]!;
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) {
          i++;
          break;
        } else if (r === '\n') break;
        i++;
      }
      out += src.slice(start, i);
      prev = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/**
 * 从**单个**文件里抠出作者真正写的 `app.*` 能力引用。
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
function extractCalls(rawSrc: string): string[] {
  const source = stripComments(rawSrc);
  const found = new Set<string>();
  for (const m of source.matchAll(/\bapp\.([A-Za-z][A-Za-z0-9]*)/g)) {
    const head = m[1]!;
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
  /** 未剥注释的源码原文 —— 查 `app.call('git.checkout')` 这类字符串实参要用。 */
  source: string;
  /** meta.json 的 `worker_kind`（仅 worker 类 app 有）。 */
  workerKind?: string;
}

function readSourceFiles(dir: string, out: string[] = [], exts: RegExp = /\.(js|html)$/): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      readSourceFiles(full, out, exts);
    } else if (exts.test(entry)) {
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
      worker_kind?: string;
    };
    const sources = readSourceFiles(join(dir, 'source'));
    apps.push({
      id: meta.id,
      perms: meta.permissions ?? {},
      // 逐文件抽，不拼起来抽：见 stripComments 的坑 1。
      calls: sources.flatMap((s) => extractCalls(s)).sort(),
      // 拼起来只是为了查 `app.call('git.checkout')` 这类字符串实参。
      source: sources.join('\n'),
      workerKind: meta.worker_kind,
    });
  }
  return apps;
}

const APPS = loadApps();

/**
 * 已知的、内置 app 的 meta 与自己的 source 对不上的地方。**现在是空的。**
 *
 * 为什么这个坑值得留一份记录：这些 app 曾经**装得上、iframe 正常渲染、点什么都
 * 毫无反应** —— 拒绝是正确的行为，所以没有任何一层会报错，也没有任何一条日志会
 * 指向根因。是本文件第一次把它们挖出来：3 个里 2 个（git-graph / file-explorer）
 * 整个功能全死，因为 `app.call` 要 `"node": { "enabled": true }` 而两个 meta 都
 * 没声明；git-graph 还带一个 `git.checkout` 按钮，改工作树，所以还需要
 * `"fs.write": ["{workspace}/**"]`。
 *
 * 第三个（icon-generator）其实是**误报**，已从这份名单里移除：它的
 * `source/ui.js` 只是在注释里解释"这里没有 `app.ai`"，而当时的扫描器把注释当成
 * 调用。照着误报去补权限，等于把作者明确声明不用的能力授权出去。
 *
 * 之所以写死在这里而不是让测试自己推导期望值：推导出来的"期望失败"等于没有
 * 期望 —— app 修好了它也跟着一起变绿，永远不会提醒任何人。所以修完一项就删一项，
 * `it.fails` 会自己转红提示把条目从 `it.fails` 改回 `it`。
 */
const KNOWN_GAPS: Record<string, string[]> = {};

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
    // three-segment-only matcher cannot come back. Deliberately does NOT assert
    // `shell.exec` here: the only in-tree occurrence of that string is inside a
    // comment in icon-generator explaining the app deliberately does not use it,
    // so requiring it would force the extractor to read comments.
    const total = APPS.reduce((n, a) => n + a.calls.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(APPS.some((a) => a.calls.includes('call.call'))).toBe(true);
  });

  it('does not count capabilities that only appear in comments', () => {
    // icon-generator 的注释通篇解释"这里没有 app.ai / app.shell.exec"，
    // 真实代码只用 app.storage。不剥注释就会把注释当成调用，据此补权限等于
    // 把作者明确声明不用的能力授权出去。
    const iconGen = APPS.find((a) => a.id === 'icon-generator');
    expect(iconGen).toBeDefined();
    expect(iconGen!.calls).not.toContain('ai.getModels');
    expect(iconGen!.calls).not.toContain('shell.exec');
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

  it("worker methods that write must be covered by the app's fs.write", () => {
    // 上一条护栏只看得到源码里直接写的 `app.*`，看不到 `app.call('git.checkout')`
    // 字符串里的 worker 方法，所以 fs.write 声明是它**够不着**的一块。实测：把
    // git-graph 的 fs.write 改回 []，上面 8 条全绿，而 `git.checkout` 会开始正确
    // 地报权限错 —— 一个装得上、点按钮却没反应、没有任何日志的 app。
    //
    // 名单写死是故意的：worker 那侧"哪个方法要写权限"是一个契约（每个方法各自
    // 调 `assertWithinFsScope(..., 'write')`），不是可以从 meta 反推出来的东西。
    // 下面的交叉校验负责让它不烂掉。
    const WRITE_SIDE_WORKER_METHODS = ['git.checkout'];

    for (const method of WRITE_SIDE_WORKER_METHODS) {
      // 该方法必须真的存在于某个 worker kind 里，否则这条测试就是在给一个
      // 已经删掉的方法做背书。
      const declared = APPS.some((a) => a.workerKind !== undefined);
      expect(declared, `worker kind 字段不见了`).toBe(true);

      const users = APPS.filter((a) => a.source.includes(`'${method}'`) || a.source.includes(`"${method}"`));
      for (const app of users) {
        expect(
          (app.perms.fs?.write ?? []).length,
          `'${app.id}' 调用了写侧 worker 方法 ${method}，但没声明任何 fs.write`,
        ).toBeGreaterThan(0);
      }
    }

    // 交叉校验：worker 源码里每多一处写侧 scope 断言，名单就必须跟着长。
    // 同样逐文件剥（坑 1）：拼起来剥会把 worker-blacklist.ts 里模板串中的 `/**`
    // 当成块注释开头，吞掉后面上万字符，于是这一条恒为 1、永不报警。
    const workerFiles = readSourceFiles(join(process.cwd(), 'src', 'server', 'miniapp-worker', 'kinds'), [], /\.ts$/);
    // `.*` 而不是 `[^)]*`：实参里常带嵌套调用（`path.resolve(params.cwd)`），
    // 用 `[^)]*` 会在第一个右括号处就停住，匹配数恒为 0，交叉校验变成永真。
    const writeChecks = workerFiles.flatMap((f) =>
      (stripComments(f).match(/assertWithinFsScope\(.*'write'/g) ?? []),
    );
    expect(
      writeChecks.length,
      `worker 里出现了 ${writeChecks.length} 处写侧 scope 断言，但 WRITE_SIDE_WORKER_METHODS 只列了 ${WRITE_SIDE_WORKER_METHODS.length} 个 —— 新增写侧方法时忘了在 meta 里声明 fs.write`,
    ).toBe(WRITE_SIDE_WORKER_METHODS.length);
  });
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
