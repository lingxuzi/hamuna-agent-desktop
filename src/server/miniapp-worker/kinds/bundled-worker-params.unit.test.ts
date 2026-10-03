// bundled-worker-params.unit.test.ts — 内置 app 传出的参数字段名必须在 worker
// schema 里真实存在。
//
// ## 覆盖的是哪一类失效
//
// 方法名对得上不代表参数对得上。`z.object()` 默认 **strip** 未知键（不是
// `.strict()`），所以一个被改名 / 拼错的字段会被**静默丢掉**，handler 拿到
// `undefined`，`z.number().default(4)` 之类的默认值顶上来：app 照样渲染、照样
// 出结果，只是结果和作者写的不是一回事。作者看到的是"数字怎么变成 4 了"，
// 没有任何一层报错。
//
// 写侧更糟：app 写 `maxDepth: 9` 而 schema 限 `.max(8)` 会**抛** INVALID_PARAMS
// （这个至少可见）；但 `{ cwd, max: 50 }` 里的 `max` 若在 schema 上被改名成
// `limit`，`max` 被 strip，`git.log` 安静地按默认条数返回。
//
// 这是 `kinds/bundled-worker-calls.unit.test.ts` 的下半截：那一条问"方法名存不
// 存在"，这一条问"参数名存不存在"。两条都对着同一个 `listKinds()` 真注册表判。
//
// ## 为什么用 acorn 而不是正则
//
// 参数是对象字面量，跨行、带嵌套调用（`{ path: joinPath(treeRoot, rel) }`）、
// 带变量简写（`{ cwd }`）。正则去猜对象结构正是上一轮吃过亏的地方（`worker-blacklist`
// 模板串里的 `/**` 吞掉上万字符）。`ast-policy.ts` 已经在用 acorn，依赖现成，解析
// 出来的 key 是真的，不是我猜的。
//
// ## 局限说清楚
//
// 只认**静态可判定**的 key：`{ cwd }`（变量简写）与 `{ max: 50 }`（字面量）都能
// 拿到 key；`{ ...spread }` 与 `buildParams()` 这类把对象整个交给函数构造的形态拿
// 不到，只能报"无法静态判定"而不是假装通过。下面那条 `dynamic call sites` 把这个
// 边界显式钉住 —— 将来真有 app 用了动态构造，它会红，而不是静默变成真空通过。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'acorn';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { listKinds } from '../worker-rpc';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');

/** 注册表是模块级单例，必须让 kind 的注册副作用跑过才有内容。 */
await import('../index');

interface CallSite {
  /** 1-based 行号，报错时让人能直接翻到那一行。 */
  line: number;
  method: string;
  /** 静态拿到的参数 key；`null` = 静态不可判定（动态构造）。 */
  keys: string[] | null;
}

/** acorn 的节点类型只需要我们关心的几个，用最小结构自描述避免 any。 */
type Node = { type: string; start: number; end: number; [k: string]: unknown };

function walk(node: Node | null | undefined, visit: (n: Node) => void): void {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const val = node[key];
    if (Array.isArray(val)) for (const v of val) walk(v as Node, visit);
    else if (val && typeof val === 'object') walk(val as Node, visit);
  }
}

/**
 * 取对象字面量的 key 集合。遇到 `SpreadElement` / `Property` 缺 key 的形态就返回
 * `null`（静态不可判定）—— 不猜。computed key（`{[k]: v}`）同样不可判定。
 */
function keysOfObjectLiteral(obj: Node | null): string[] | null {
  const props = obj?.['properties'];
  if (!Array.isArray(props)) return null;
  const keys: string[] = [];
  for (const p of props as Node[]) {
    if (p.type === 'SpreadElement') return null;
    const key = p['key'] as Node | undefined;
    if (!key || key['computed']) return null;
    if (key.type === 'Identifier') keys.push(key['name'] as string);
    else if (key.type === 'Literal' && typeof key['value'] === 'string') keys.push(key['value'] as string);
    else return null;
  }
  return keys;
}

/** 找出 `workerCall('<method>', <params>)` 与裸 `app.call('<method>', <params>)`。 */
function findCallSites(src: string): CallSite[] {
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as Node;
  const sites: CallSite[] = [];
  walk(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    const callee = n['callee'] as Node | undefined;
    const name =
      callee?.type === 'Identifier' ? (callee['name'] as string)
      : callee?.type === 'MemberExpression' && (callee['object'] as Node)?.type === 'Identifier' &&
        (callee['object'] as Node)['name'] === 'app' && (callee['property'] as Node)?.type === 'Identifier'
        ? ((callee['property'] as Node)['name'] as string)
        : null;
    if (name !== 'workerCall' && name !== 'call') return;
    const args = n['arguments'] as Node[];
    const first = args?.[0];
    if (first?.type !== 'Literal' || typeof first['value'] !== 'string') return;
    // 第二个参数是 `undefined` 形态（只传方法名）时，params 就是空对象。
    const second = args?.[1];
    const keys = second === undefined ? [] : second.type === 'ObjectExpression' ? keysOfObjectLiteral(second) : null;
    sites.push({ line: n['start'], method: first['value'] as string, keys });
  });
  return sites;
}

function readSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) readSourceFiles(full, out);
    else if (/\.js$/.test(entry)) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

interface AppUnderTest {
  id: string;
  workerKind?: string;
  sites: CallSite[];
}

function loadWorkerApps(): AppUnderTest[] {
  const apps: AppUnderTest[] = [];
  for (const entry of readdirSync(BUNDLED_ROOT)) {
    if (entry.startsWith('_')) continue;
    const dir = join(BUNDLED_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      id: string;
      worker_kind?: string;
    };
    if (!meta.worker_kind) continue;
    const sites = readSourceFiles(join(dir, 'source')).flatMap((s) => findCallSites(s));
    apps.push({ id: meta.id, workerKind: meta.worker_kind, sites });
  }
  return apps;
}

const APPS = loadWorkerApps();
const REGISTRY = listKinds();

/** 一个 zod 字段：只需要问「它接不接受 undefined」（= 有没有默认值兜底）。 */
interface ShapeField {
  safeParse?: (v: unknown) => { success: boolean };
}

/**
 * `method` -> 该方法 schema 的 shape（真 schema 的 `.shape`，不是抄一份）。
 *
 * `WorkerMethodDef.schema` 声明成 `z.ZodType`，而 `.shape` 只存在于
 * `ZodObject` 上，所以要先过一道 `ZodObject` 的运行时判定再取属性 —— 直接
 * `as { shape: ... }` 会被 tsc 拒（`shape` 不在 `ZodType` 上），而
 * `as unknown as` 会把真正的类型错误一起吞掉。这里用 `instanceof`，判不出来
 * 就返回 null，调用方把它当成「这条判不了」而不是当成「通过」。
 */
function shapeOf(method: string): Record<string, ShapeField> | null {
  for (const kind of REGISTRY) {
    const def = kind.methods.find((m) => m.name === method);
    if (def?.schema instanceof z.ZodObject) {
      return def.schema.shape as Record<string, ShapeField>;
    }
  }
  return null;
}

describe('bundled MiniApps: every param field an app sends exists in the worker schema', () => {
  it('finds real call sites in the shipped worker apps', () => {
    // 下面是全部站点的扁平视图：解析器坏了的话这里会空，而每条 app 断言都会
    // 真空通过 —— 那正是这条护栏要防的失效，所以单独钉住。
    const all = APPS.flatMap((a) => a.sites.map((s) => `${a.id}:${s.method}`));
    expect(all.sort()).toEqual([
      'file-explorer:file.read',
      'file-explorer:file.search',
      'file-explorer:file.tree',
      'git-graph:git.checkout',
      'git-graph:git.log',
      'git-graph:git.status',
    ]);
  });

  it('has no call site whose params are only statically unknowable', () => {
    // 动态构造（`{...spread}` / `buildParams()`）会让下面那条变成真空通过。
    // 将来真有 app 那么写，这里会红提醒补上人工清单，而不是悄悄放过。
    const dynamic = APPS.flatMap((a) =>
      a.sites.filter((s) => s.keys === null).map((s) => `${a.id} -> ${s.method} (offset ${s.line})`),
    );
    expect(dynamic, '有调用点的参数无法静态判定，本护栏对它们无效').toEqual([]);
  });

  for (const app of APPS) {
    it(`'${app.id}' only sends fields the method's schema declares`, () => {
      const problems: string[] = [];
      for (const site of app.sites) {
        const shapeObj = shapeOf(site.method);
        // 方法名不存在由 bundled-worker-calls 那条负责；这里不重复报。
        if (!shapeObj) continue;
        // strip 语义下多余字段会被**静默丢弃**，不是报错，所以必须在这里拦。
        const unknown = (site.keys ?? []).filter((k) => !Object.hasOwn(shapeObj, k));
        if (unknown.length > 0) {
          problems.push(
            `${site.method} 的 schema 没有字段 [${unknown.join(', ')}]` +
              `（app 传的是 [${(site.keys ?? []).join(', ')}]；z.object 默认 strip，多余字段会被静默丢弃）`,
          );
        }
      }
      expect(problems, `'${app.id}' 传了 schema 不存在的字段`).toEqual([]);
    });

    it(`'${app.id}' sends every field the schema requires`, () => {
      // 反向：schema 必填而 app 没传的字段会**抛** INVALID_PARAMS。可见但同样是
      // 一次就能修掉的错，且必填集合会随 schema 演进变化，值得单独钉。
      const problems: string[] = [];
      for (const site of app.sites) {
        const shapeObj = shapeOf(site.method);
        if (!shapeObj || site.keys === null) continue;
        // 必填 = 没有任何默认值兜底。用"拿 undefined 过一遍"来问 schema 自己，
        // 而不是重新实现一遍"optional / default"的判定。
        const missing = Object.keys(shapeObj).filter((k) => {
          const v = shapeObj[k]!;
          return v?.safeParse ? !v.safeParse(undefined).success : false;
        });
        const absent = missing.filter((k) => !(site.keys ?? []).includes(k));
        if (absent.length > 0) problems.push(`${site.method} 必填 [${absent.join(', ')}]，但 app 没传`);
      }
      expect(problems, `'${app.id}' 漏传了必填字段`).toEqual([]);
    });
  }
});
