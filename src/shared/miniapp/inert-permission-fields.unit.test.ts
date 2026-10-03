import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APP_METHODS } from './app-protocol';

/**
 * 「声明了但不生效」的权限字段，必须被显式登记。
 *
 * ## 这条守的是哪一类错
 *
 * `permissions.agent.workspace_scope` 曾经在类型里写着"该 MiniApp 允许 agent
 * 触达的工作区路径前缀；空 = 不允许任何工作区工具"，schema 校验它、作者文档说它
 * "声明保留但当前不放开" —— 而**全仓没有任何一行判定代码读它**。更糟的是那句
 * 类型说明本身是错的：没有声明它的 app 照样拿得到一个带工具的 agent，只是 cwd 被
 * 钉在自己的 appdata 里。
 *
 * 这类字段比"没实现的功能"危险，因为它是一句**关于安全边界的假承诺**：下一个照着
 * 类型定义判断"这字段是不是已经被强制"的人会得出相反的结论。SKILL.md 那时反而
 * 是对的，错的只有类型定义 —— 而类型定义正是最容易把人带沟里的那份文档。
 *
 * ## 为什么用扫源码而不是调函数
 *
 * "这个字段有没有被强制"没法在运行时问出来：判定散在 `checkAppPermission`、
 * `resolveNodeLimits`、`rateLimited` 等几处，各自读不同的字段。这里反过来做 ——
 * 从 `MiniAppPermissions` 抽出全部字段名，扫全仓看谁真的读了它。
 *
 * 扫源码有已知的误报面（注释和 schema 也会提到字段名），所以判定时**剔除注释**，
 * 并且把"只在 schema / types 里出现"当作待确认信号而不是直接判死：一个字段必须
 * 要么被真正读，要么出现在下面的登记表里。
 */
const TYPES_SOURCE = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');

/**
 * 登记在册的"声明保留、当前不生效"字段。往里加东西等于承认它还没实现。
 *
 * 每一条都要写清**为什么现在不生效**，以及**将来由谁、在什么条件下**接手 ——
 * 没有接手条件的登记会变成永久谎言，那不如把字段删掉。
 */
const ACKNOWLEDGED_INERT: Record<string, string> = {
  'agent.workspace_scope':
    'agent 的 workspace 由 resolveAgentWorkspace 硬钉在 appdata 内收窄，与本字段无关。' +
    '留给将来的"用户显式授权某个目录"，前提是先有可信的授权记录来源。',
};

/** 从 `MiniAppPermissions` 的类型文本里抽出点分字段名。 */
function declaredPermissionFields(): string[] {
  const start = TYPES_SOURCE.indexOf('export interface MiniAppPermissions {');
  expect(start, 'MiniAppPermissions not found in types.ts').toBeGreaterThan(-1);
  // 找配对的收尾大括号。
  let depth = 0;
  let end = start;
  for (let i = start; i < TYPES_SOURCE.length; i++) {
    if (TYPES_SOURCE[i] === '{') depth++;
    else if (TYPES_SOURCE[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = TYPES_SOURCE.slice(start, end);
  const fields = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  // 顶层组之下再收一层，得到 `agent.enabled` 这种点分名。
  const groups = [...body.matchAll(/^\s{2}(\w+)\?: \{([\s\S]*?)^\s{2}\};?/gm)];
  for (const g of groups) {
    for (const inner of [...g[2].matchAll(/^\s{4}(\w+)\??:/gm)]) {
      fields.push(`${g[1]}.${inner[1]}`);
    }
  }
  return [...new Set(fields)].sort();
}

/**
 * 「搬运层」—— 只做声明、解析、校验、传递，**不做任何判定**。
 *
 * 字段出现在这里不算被强制：`meta-schema.ts` 会把 `workspace_scope` 从 meta.json
 * 抄进解析结果，`types.ts` 声明它的形状，两处都是让值能到达 `MiniAppPermissions`
 * 而已，值到了之后有没有人用它们才是问题。把它们算成"读者"会让每个字段看起来都
 * 被实现了，本测试就永远绿 —— 那正是它要消灭的假绿。
 *
 * 已知局限：如果某个字段真的**只**在这一层被使用，本测试会漏判。当前没有任何
 * 字段落在这个位置，而登记表现成地把每个惰性字段都列了出来，所以这个局限需要
 * 有人主动新增一个"只搬运不判定"的字段才会踩到。
 */
const TRANSPORT_ONLY = new Set(['shared/miniapp/meta-schema.ts', 'shared/miniapp/types.ts']);

/**
 * 持有 permissions 的变量名。链首命中其中之一，才算"有人在读这个权限字段"。
 *
 * 必须是白名单而不是"任意 `.field`"：仓库里 `timeout_ms` 同时是**权限**（worker
 * 池的资源上限，从 `declared?.timeout_ms` 读）和**作者可传参数**
 * （`params.timeout_ms` / `opts.timeout_ms`，走的是完全不同的路径）。用宽松匹配
 * 会让后者把前者衬成已实现 —— 那正是本测试要防的假绿。
 */
const PERMISSION_HOLDERS = 'perms|permissions|policy|declared|meta|ctx|resolved';

/** 扫全仓源码，看有没有哪个文件真的读了这个字段（注释与搬运层都不算）。 */
function readersOf(field: string): string[] {
  const leaf = field.split('.').pop() as string;
  // 允许中间隔着组名一段：`perms.fs?.read` / `permissions?.net?.allow`。
  const pattern = new RegExp(
    `\\b(?:${PERMISSION_HOLDERS})(?:\\??\\.\\w+)*\\??\\.${leaf}\\b`,
  );
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const rel = relative(SRC_ROOT, full).split(sep).join('/');
      if (TRANSPORT_ONLY.has(rel)) continue;
      // 去掉注释，避免"文档里提到"被当成"代码在读"。
      const code = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (pattern.test(code)) hits.push(rel);
    }
  };
  walk(SRC_ROOT);
  return [...new Set(hits)].sort();
}

describe('every declared MiniApp permission is either enforced or acknowledged as inert', () => {
  const fields = declaredPermissionFields();

  it('finds the whole permission surface, so the checks below are not vacuous', () => {
    // 抽取器一旦失修，后面每条断言都会在空数组上假绿。
    expect(fields).toContain('fs.read');
    expect(fields).toContain('agent.enabled');
    expect(fields).toContain('net.allow');
    expect(fields).toContain('agent.workspace_scope');
    expect(fields.length).toBeGreaterThanOrEqual(12);
  });

  it.each(fields.filter((f) => !ACKNOWLEDGED_INERT[f]))(
    '%s is read by real enforcement code',
    (field) => {
      expect(readersOf(field), `${field} is declared but nothing reads it`).not.toEqual([]);
    },
  );

  it('the inert registry holds no field that has since become enforced', () => {
    // 反向也守：登记过的字段一旦真的开始生效，就该从登记里删掉，否则它会变成一条
    // "其实已经实现了"的假注释，比原来的假承诺更难发现。
    for (const [field, why] of Object.entries(ACKNOWLEDGED_INERT)) {
      const readers = readersOf(field);
      if (readers.length > 0) {
        throw new Error(
          `${field} now has enforcement code (${readers.join(', ')}) — remove it from the ` +
            `inert registry. It was registered as: ${why}`,
        );
      }
    }
  });

  it('the inert registry names real method groups', () => {
    // 登记表按点分名书写，组名写错会让 `agent.workspace_scope` 这种登记无声失效。
    for (const field of Object.keys(ACKNOWLEDGED_INERT)) {
      expect(Object.keys(APP_METHODS)).toContain(field.split('.')[0]);
    }
  });
});
