// bundled-worker-calls.unit.test.ts — 内置 app 真正调用的 worker 方法名必须在
// 注册表里存在。
//
// ## 覆盖的是哪一类失效
//
// `app.call(method, params)` 把方法名当**字符串**传（git-graph / file-explorer
// 都是这个形态），所以方法名不经过 TypeScript 校验：一个拼错的方法名
// （`git.lgo`）编译得过、meta 声明得过、权限护栏也全绿 —— 因为
// `bundled-apps-permissions.test.ts` 的抽取器是拿 `listAppMethods()` 做子串
// 匹配**延长** `app.<head>`，只认已经存在的方法名；一个不存在的方法名匹配不到
// 任何东西，于是从集合里静默消失，那条护栏压根看不到它。
//
// 症状与那个护栏当初挖出来的完全一致：app 装得上、列表里出现、点按钮毫无反应，
// 而且**拒绝与拼错在这里都是无声的**。所以这条护栏问的是另一个问题：作者写在
// 字符串里的方法名，worker 侧到底认不认。
//
// ## 为什么必须用真注册表而不是手写名单
//
// 手写名单会和实现一起漂移 —— 改了 worker 方法名、名单没改，于是这条护栏永远
// 绿着，恰好是它存在的目的。`listKinds()` 是权威，且它同时给出 `kind`，因此
// 顺带钉住「app 调的��法属于自己 meta 声明的那个 kind」：跨 kind 调用（比如
// file-explorer 去调 `git.log`）pool 会 `getKindDef(app 的 kind)` 之后找不到那个
// 方法，同样是无声失败。
//
// ## 抽取为什么用限定前缀
//
// 扫 `app\.[a-z]+\.[a-z]+` 会把作者自己代码里的普通对象属性也算进来。加限定
// （只认 `git.` / `file.`，即 `meta.worker_kind` 声明的两个命名空间）把误报压到
// 接近零，同时仍然覆盖两个 app 的**全部**真实调用形态（见下方
// "抽取到了真实调用" 那条 —— 数量掉了这条就红）。
//
// 局限说清楚：文本层抽取，不做完整语法分析。失败方向是**少扫到**，不会多扫到。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listKinds } from '../worker-rpc';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');

/** 注册表是模块级单例，必须让 kind 的注册副作用跑过才有内容。 */
await import('../index');

interface AppUnderTest {
  id: string;
  workerKind?: string;
  /** 从 source 里抠出的 `git.*` / `file.*` 方法名（去重排序）。 */
  called: string[];
}

function readSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) readSourceFiles(full, out);
    else if (/\.(js|html)$/.test(entry)) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

function loadWorkerApps(): AppUnderTest[] {
  const apps: AppUnderTest[] = [];
  for (const entry of readdirSync(BUNDLED_ROOT)) {
    if (entry.startsWith('_')) continue; // `_e2e-fixtures` are test inputs, not shipped
    const dir = join(BUNDLED_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      id: string;
      worker_kind?: string;
    };
    if (!meta.worker_kind) continue; // 非 worker 类 app 不调 worker 方法
    const src = readSourceFiles(join(dir, 'source')).join('\n');
    const called = new Set<string>();
    for (const m of src.matchAll(/\b(git|file)\.[a-z][a-zA-Z]*\b/g)) called.add(m[0]);
    apps.push({ id: meta.id, workerKind: meta.worker_kind, called: [...called].sort() });
  }
  return apps;
}

const APPS = loadWorkerApps();
const REGISTRY = listKinds();

/** `kind` -> 该 kind 注册的方法名集合（真注册表，非手写）。 */
function methodsOf(kind: string): Set<string> {
  const def = REGISTRY.find((k) => k.kind === kind);
  return new Set(def ? def.methods.map((m) => m.name) : []);
}

describe('bundled MiniApps: every worker method an app names really exists', () => {
  it('finds the worker apps and their registry kinds', () => {
    // 两个前提各自会静默让下面所有用例真空通过，所以单独钉。
    expect(APPS.map((a) => a.id).sort()).toEqual(['file-explorer', 'git-graph']);    expect(REGISTRY.length).toBeGreaterThan(0);
    for (const app of APPS) {
      expect(REGISTRY.some((k) => k.kind === app.workerKind), `${app.id} 的 kind 没注册`).toBe(true);
    }
  });

  it('extracts real worker calls out of the app sources', () => {
    // 抽取器坏了的话每条 app 断言都会空集合通过 —— 那正是这条护栏要防的失效。
    // 钉「每个 worker app 都扫到了东西」而不是钉总数：总数会被合法的**新增**调用
    // 打成红，而报错信息（"expected 7 to be 6"）指向的是一个根本不存在的问题。
    // 底下两条 toContain 负责钉住写侧那条最要紧的路径。
    for (const app of APPS) {
      expect(app.called.length, `'${app.id}' 一个 worker 调用都没扫到，抽取器坏了`).toBeGreaterThan(0);
    }
    const git = APPS.find((a) => a.id === 'git-graph')!;
    expect(git.called).toContain('git.checkout');
    expect(git.called).toContain('git.log');
  });

  for (const app of APPS) {
    it(`'${app.id}' only names methods its own worker kind provides`, () => {
      const known = methodsOf(app.workerKind!);
      expect(known.size, `kind '${app.workerKind}' 没有注册任何方法`).toBeGreaterThan(0);
      // 逐个点名报错，否则一个 app 缺三个方法时只会看到一个空数组。
      const missing = app.called.filter((m) => !known.has(m));
      expect(missing, `'${app.id}' 调用了 ${app.workerKind} 没有的 worker 方法: ${missing.join(', ')}`).toEqual([]);
    });

    it(`'${app.id}' does not reach into another kind's methods`, () => {
      // pool 是 `getKindDef(app 的 kind)` 之后在该 kind 的方法表里找，所以
      // 跨 kind 调用（file-explorer 调 git.log）同样是无声失败。
      const own = methodsOf(app.workerKind!);
      const foreign = new Set(
        REGISTRY.filter((k) => k.kind !== app.workerKind).flatMap((k) => k.methods.map((m) => m.name)),
      );
      const crossed = app.called.filter((m) => !own.has(m) && foreign.has(m));
      expect(crossed, `'${app.id}' 调了别的 kind 的方法: ${crossed.join(', ')}`).toEqual([]);
    });
  }
});
