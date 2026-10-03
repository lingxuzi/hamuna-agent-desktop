import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { APP_METHODS } from '../shared/miniapp/app-protocol';

/**
 * 第三处声明点：`dispatchMiniAppApp`。
 *
 * `app-parity.unit.test.ts` 已经把协议名单和 runtime 门面对齐了，但那份文件把
 * dispatcher 称为「尤其危险」的一处，理由写得很清楚：它按 **group** 分派，组内
 * method 名走各自的 switch，所以名单里加一个 `fs.foo` 而忘了在 `dispatchFs` 里
 * 加 case，类型系统完全沉默，作者只在运行时拿到一句 "Unknown fs method"。
 *
 * 那份文件并没有真的断言这一点 —— 它只 import 了 shared 的名单和 renderer 的
 * runtime 脚本，两处都在自己进程内。这条测试补上第三处。
 *
 * ## 为什么扫源码而不是问运行时
 *
 * 没有 introspection API 能问出"你支持哪些 method"，而真去调一遍等于要构造
 * 权限、造文件、mock transport —— 那是 integration 的成本，换来的却只是一个
 * 名单。dispatcher 里的 method 名是带引号的字面量（`case 'readFile':` /
 * `name === 'get'`），抽字面量是这仓已有的做法（`app-parity` 抽 runtime 的
 * `dispatch(...)` 字面量），代价是重命名会误报，而那属于**应该**被注意到的改动。
 *
 * ## 为什么要按组分区扫，不能全文件扫
 *
 * 全文件扫 method 名会假阴性：`get` / `set` / `run` / `cancel` 这些名字在文件
 * 别处也会以字面量出现，删掉 storage 的 case 反而扫得到、删不掉。所以每个组只
 * 在**它自己那个 dispatch 函数**的区间里找。
 */
const DISPATCH_SOURCE = readFileSync(new URL('./miniapp-app-dispatch.ts', import.meta.url), 'utf8');
const DISPATCH_LINES = DISPATCH_SOURCE.split(/\r?\n/);

/** 组内逐个 method 分派：`dispatch<Group>` 里能读到这个 method 名的字面量。 */
const PER_METHOD = ['fs', 'storage', 'ai', 'agent'] as const;
/** 整组一个处理函数，method 名不进 sidecar：`dispatch<Group>` 存在即可。 */
const GROUP_ROUTED = ['os', 'shell', 'net'] as const;
/**
 * 由 renderer 在**派发前**截走，sidecar 永远只该显式拒。保留 `case` 是为了钉住
 * "这里是 fail-closed 而不是静默 no-op" —— 派发链哪天断了，作者要立刻看到
 * HOST_ERROR，而不是拿到一个假装成功的 undefined。
 */
const INLINE_FAIL_CLOSED = ['dialog', 'clipboard', 'call'] as const;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 从 `async function dispatch<Group>` 起到下一个顶层函数声明为止的源码区间。 */
function dispatchFunctionRegion(group: string): string {
  const header = new RegExp(`^(export )?(async )?function dispatch${cap(group)}\\b`);
  const start = DISPATCH_LINES.findIndex((l) => header.test(l));
  if (start === -1) return '';
  for (let i = start + 1; i < DISPATCH_LINES.length; i++) {
    // 顶层声明都在第 0 列；函数体内的缩进声明不会误伤。
    if (/^(export )?(async )?function \w/.test(DISPATCH_LINES[i])) {
      return DISPATCH_LINES.slice(start, i).join('\n');
    }
  }
  return DISPATCH_LINES.slice(start).join('\n');
}

describe('every declared app method reaches a real producer in the dispatcher', () => {
  it('classifies every protocol group, so a new group cannot skip this decision', () => {
    // 分区表必须与协议名单同增同减。加一个组却忘了声明它走哪条分派路线，
    // 下面的逐组断言会因为它不在任何一张表里而静默失效 —— 这条就是防这个。
    const classified = [...PER_METHOD, ...GROUP_ROUTED, ...INLINE_FAIL_CLOSED].sort();
    expect(classified).toEqual(Object.keys(APP_METHODS).sort());
  });

  it.each(PER_METHOD)('%s: every declared method has a case in its dispatch function', (group) => {
    const region = dispatchFunctionRegion(group);
    // 空区间说明函数没找到 —— 必须让断言失败，而不是让 toContain 在空串上假绿。
    expect(region, `dispatch${cap(group)} not found`).not.toBe('');
    const orphans = APP_METHODS[group].filter((m) => !region.includes(`'${m}'`));
    expect(orphans, `declared in APP_METHODS.${group} but no producer in dispatch${cap(group)}`).toEqual([]);
  });

  it.each([...GROUP_ROUTED, ...INLINE_FAIL_CLOSED])('%s: the top-level switch still routes this group', (group) => {
    // 组名不与任何 method 名重名，所以全文件找这个 case 是安全的。
    expect(DISPATCH_SOURCE).toContain(`case '${group}':`);
  });

  it.each(GROUP_ROUTED)('%s: its whole-group handler exists', (group) => {
    expect(dispatchFunctionRegion(group), `dispatch${cap(group)} not found`).not.toBe('');
  });

  it('no app method can create a symlink, which is the only thing making the missing realpath check survivable', () => {
    // fs 路径判定是**纯词法**的：`normalizePath` 折叠 `..`、`isPathAllowed` 比分隔符
    // 边界，执行层没有 realpath 复核（`resolveAgentWorkspace` 里的 `path.resolve` 同样
    // 只做词法归一）。这本来是个洞，它成立的前提只有一个：MiniApp 无法自己在 appdata
    // 里种一个指向沙箱外的链接。
    //
    // 所以这条不是风格约束，是那个前提的可执行形态。将来若加了 fs.symlink / fs.link，
    // `appDataWorkspace` 就能被指到沙箱外，而 agent 的 cwd 就在那儿 —— 那时必须先补
    // realpath 复核（解析最近的存在祖先，Windows 还要处理 `\\?\` 前缀）再合并。
    const creating = Object.entries(APP_METHODS)
      .flatMap(([group, methods]) => methods.map(m => `${group}.${m}`))
      .filter(m => /symlink|hardlink|(^|\.)link$/.test(m));
    expect(creating, 'a symlink-creating method appeared; add realpath re-verification first').toEqual(
      [],
    );

    // 派发层也不能绕过协议表直接调 symlink。必须先剥注释：dispatchFs 里本就有一句
    // "lstat 不跟随 symlink" 的说明性注释，按原文匹配会永远红。
    const code = DISPATCH_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'the dispatcher calls a symlink API outside APP_METHODS').not.toMatch(/symlink/i);
  });
});
