// require-shim.unit.test.ts — shim 不扫描自己，但仍扫描 MiniApp 用户代码。
//
// ## 为什么这条护栏必须两边都钉
//
// `installRequireShim()` 给 `Module._extensions['.js']` 装了一个 AST 扫描 hook，
// 意图是拦**用户代码**里的 `require('fs')` / `process.binding` 之类。但打包后
// worker entry、kind、simple-git、shim 本身全在**同一个文件**里，于是 hook 也会
// 扫到 kind 自己的 handler —— file-explorer 合法地 `require('fs')` 去读目录，
// 于是 worker 一起来就死：
//
//     module require blocked by MiniApp sandbox: module='fs'
//
// 修法是豁免「worker 自己那个文件」（`isTrustedWorkerSelf`，按 realpath 精确
// 比对，不是前缀匹配 —— 前缀会把 server bundle 目录整片放行，而那恰恰不是
// 不可信 per-app entry 所在的目录）。
//
// **豁免很容易写过头**：如果判断写松了，用户代码就能 `require('fs')`，沙箱就没
// 了。所以下面两条必须一起存在：一条钉住"自己的文件不再被拦"，一条钉住"别的
// 文件仍然被拦"。只写前一条的话，护栏会把"把 shim 整个删掉"这个变异判成绿。
//
// 注意本文件测的是**判定逻辑**，不是"打包后的产物长什么样"——后者由
// `build:server` + 真 worker 冒烟覆盖（见 miniapp_architecture.md §5.6）。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import {
  __isTrustedForTest,
  __resetRequireShimForTest,
  __trustedSelfForTest,
  installRequireShim,
} from './require-shim';
import { scanAst } from './ast-policy';

const nodeRequire = createRequire(import.meta.url);

describe('require shim: the worker bootstrap is exempt, user code is not', () => {
  let dir: string;

  afterEach(() => {
    __resetRequireShimForTest();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('still flags a bypass attempt in user source', () => {
    // 注意分工：**明写的** require('fs') 由运行时的 DENY_MODULES 拦（下面
    // 'rejects a user module...' 那条走的就是那条路），而 scanAst 抓的是
    // 运行时拦不到的绕法 —— 拼接、new Function、import() 之类。这里最初写成
    // "scanAst 必须标记 require('fs')"，实测返回 null：那是正常的，两层各管一段。
    expect(scanAst("const p = 'f' + 's'; require(p);")).not.toBeNull();
    expect(scanAst("const r = new Function('return require')()('fs');")).not.toBeNull();
  });

  it('does not flag ordinary user source', () => {
    // 反向不变式：不能因为装了 shim 就把正常代码全判成命中。
    expect(scanAst("const p = require('path'); module.exports = p;")).toBeNull();
  });

  it('installs without throwing and reports itself installed', async () => {
    // 装得上是最基本的不变式：hook 要能在真实 worker 里先跑起来，豁免逻辑才有意义。
    const { __getRequireShimState } = await import('./require-shim');
    installRequireShim();
    expect(__getRequireShimState().installCount).toBe(1);
    // 幂等：worker entry 与测试都可能重复调用。
    installRequireShim();
    expect(__getRequireShimState().installCount).toBe(1);
  });

  it('loads a legitimate user module that requires nothing at all', () => {
    // 反向：不能因为装了 shim 就把**所有** .js 都拒了 —— 那是把沙箱变成 outage。
    // 这条特意**不** require 任何东西：`path` / `os` / `fs` 都在 DENY_MODULES 里
    // （第一版这里写了 require('path')，实测直接被拒，正好说明 deny list 比想象宽）。
    dir = mkdtempSync(path.join(tmpdir(), 'shim-ok-'));
    const file = path.join(dir, 'benign.js');
    writeFileSync(file, 'module.exports = { ok: true, n: 41 + 1 };\n');
    expect(() => nodeRequire(file)).not.toThrow();
  });

  it('rejects a user module that requires a denied module at load time', () => {
    // 这是"豁免没有写过头"的直接证据：另**一个**文件（不是 worker 自己）里的
    // require('fs') 仍然被拦。把 isTrustedWorkerSelf 改成前缀匹配或恒真，这里会红。
    dir = mkdtempSync(path.join(tmpdir(), 'shim-deny-'));
    const file = path.join(dir, 'offender.js');
    writeFileSync(file, "const fs = require('fs'); module.exports = fs;\n");
    // 直接走 loader hook：installRequireShim 已在 afterEach 前装上时，
    // 加载会经过 patched _extensions['.js']。
    installRequireShim();
    expect(() => nodeRequire(file)).toThrow(/blocked by MiniApp sandbox/);
  });

  describe('the exemption predicate itself', () => {
    // 这一组才是真正咬得住的。上面那些用例**无论豁免判定怎么改都全绿**
    // （实测三个变异 exit=0：恒真、前缀匹配、整段删掉）—— 因为
    // `installRequireShim` 只挂 loader，而 vitest 里 loader 看到的是测试文件、
    // 永远不是这个 shim 自己，那条分支根本走不到。变异验证逼出了
    // `__isTrustedForTest(filename, self?)`：把身份做成可注入的参数，
    // "身份未知"那半条分支才可测。

    it('knows its own realpath', () => {
      const { self } = __trustedSelfForTest();
      expect(self, 'SELF_FILENAME should resolve in a normal test run').toBeTruthy();
      expect(path.basename(self!)).toMatch(/require-shim\.(ts|js)$/);
    });

    it('trusts exactly itself and nothing else', () => {
      const { self } = __trustedSelfForTest();
      expect(__isTrustedForTest(self!)).toBe(true);
      dir = mkdtempSync(path.join(tmpdir(), 'shim-sibling-'));
      const sibling = path.join(dir, 'other.js');
      writeFileSync(sibling, 'module.exports = 1;\n');
      expect(__isTrustedForTest(sibling)).toBe(false);
    });

    it('does not trust a file merely under the same directory tree', () => {
      const { self } = __trustedSelfForTest();
      expect(__isTrustedForTest(path.dirname(self!))).toBe(false);
      expect(__isTrustedForTest(self! + '.bak')).toBe(false);
    });

    it('fails closed on a nonexistent path', () => {
      const { self } = __trustedSelfForTest();
      expect(__isTrustedForTest('Z:/definitely/not/here.js', self)).toBe(false);
      expect(__isTrustedForTest('', self)).toBe(false);
    });

    it('trusts nothing when the identity could not be resolved', () => {
      // worker 跑在打包产物里，import.meta.url 解析失败不是假想。那时的正确
      // 行为是什么都不豁免 —— 宁可 worker 起不来，也不能变成全场放行。
      expect(__isTrustedForTest(__filename, null)).toBe(false);
      expect(__isTrustedForTest('/anything/at/all.js', null)).toBe(false);
      expect(__isTrustedForTest('Z:/definitely/not/here.js', null)).toBe(false);
      //
      // 变异记录（判定为「本来如此」，不补测试）：把 if (!self) return false
      // 改成 if (false) return false 全绿。查下来是**语义等价**而不是洞 ——
      // realpathSync 返回 string 或抛异常，永远不可能 === null，所以删掉这半条
      // 守卫，身份未知时的结果照样是 false。那行是省一次 syscall 的短路，不是
      // 承重逻辑。要给它造一条会红的断言只能去 mock realpath，那是给等价变异
      // 造假红，不做。
    });
  });
});
