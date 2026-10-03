// verify-miniapp-workers.mjs — 对**打包产物**跑一次真 worker 线程冒烟。
//
// ## 为什么必须是"打包后"，而不是 vitest
//
// MiniApp 的 worker 链（pool → `new Worker` → entry → handler）此前**一次都
// 没被真跑过**，而链上有四个缺陷叠在一起，全都是"vitest 绿、只有打包后才现形"
// 的那一类：vitest 直接加载源码，打包后才走 esbuild + 真 `Worker` 线程。
//
//   1. entry 从未被构建（没���地方 import 它，esbuild 无从跟随）
//   2. entryPath 指到 bundle 的**上一级**目录
//   3. `new Worker(<不存在的路径>)` 不抛异常，异步发 error，于是 spawn 报成功
//   4. require shim 扫到 worker 自己的 bundle / dynamic import 绑错模块
//
// 后果是 git-graph 与 file-explorer 在生产里**全死**，而仓库里没有一个测试会
// 变红。写 vitest 用例钉不住这一类 —— 它根本复现不出来，因为复现它需要先跑
// esbuild。所以这个冒烟直接消费 `npm run build:server` 的产物。
//
// ## 它守住什么
//
// 对每个 kind：产物存在 → 真 spawn → 调一个只读方法 → 断言结果形状 → 断言
// 越界被拒。`branches` 那条尤其重要：它是 app 下拉框 gate 的字段，缺了它
// checkout 不可达且**完全无声**（见 git-status-branches.unit.test.ts）。
//
// 退出码非 0 = 产物不可用。这个脚本没有测试套件可挂 —— 它测的是"构建 + 运行"
// 这件事本身，只有作为构建后的门禁才有意义。
//
// 它现在是 `build:server` 的最后一步（与 `build:web` → `verify:theme-css` 同款），
// 所以 CI、发布脚本和本地构建都会跑到。曾经它只以"手动跑一下"的形式存在：
// `build:server` 产出 entry，CI 也跑 `build:server`，但没有任何地方接着跑这个
// 冒烟 —— 也就是说上面那四个缺陷复发的路径依然是全绿的。保留 `verify:miniapp-workers`
// 这个独立入口，是为了想单独重跑时不用先重新打包。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const RESOURCES = path.resolve('src-tauri/resources');

const failures = [];

function fail(what) {
  failures.push(what);
  console.error(`  ✗ ${what}`);
}
function ok(what) {
  console.log(`  ✓ ${what}`);
}

const git = (repo, ...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function makeRepo(prefix = 'git-') {
  const repo = mkdtempSync(path.join(tmpdir(), `verify-mg-${prefix}`));
  // 显式分支名：不同 git 版本 init 默认名不同（master / main），让断言飘。
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'verify@example.invalid');
  git(repo, 'config', 'user.name', 'verify');
  writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-qm', 'first');
  git(repo, 'checkout', '-qb', 'feature-x');
  writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git(repo, 'add', 'b.txt');
  git(repo, 'commit', '-qm', 'second');
  git(repo, 'checkout', '-q', 'main');
  return repo;
}

function makeTree() {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-mg-tree-'));
  mkdirSync(path.join(dir, 'sub'), { recursive: true });
  writeFileSync(path.join(dir, 'a.txt'), 'hello world\n');
  writeFileSync(path.join(dir, 'sub', 'b.txt'), 'nested content\n');
  return dir;
}

function spawnWorker(entryName, kind, fsScope) {
  const entry = path.join(RESOURCES, entryName);
  const worker = new Worker(entry, {
    workerData: { appId: 'verify-mg', kind, init: {}, fsScope },
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, error: { message: `timeout 20s calling ${method}` } }),
        20000,
      );
      const onMessage = (m) => {
        if (m?.id !== method) return;
        clearTimeout(timer);
        worker.off('message', onMessage);
        resolve(m);
      };
      worker.on('message', onMessage);
      worker.on('error', (e) => {
        clearTimeout(timer);
        // 缺陷 3 的形态：spawn 不抛，error 异步到。必须在这里变成一次失败，
        // 否则冒烟会安静地"通过"一个起不来的 worker。
        resolve({ ok: false, error: { message: String(e).split('\n')[0] } });
      });
      worker.postMessage({ type: 'call', id: method, method, params });
    });
  return { worker, call };
}

// ── 产物存在性（缺陷 1 + 2）────────────────────────────────────────────────

console.log('worker entry artifacts');
for (const name of ['worker-entry-git-graph.js', 'worker-entry-file-explorer.js']) {
  const p = path.join(RESOURCES, name);
  if (existsSync(p)) ok(`${name} exists`);
  else fail(`${name} is missing — run \`npm run build:server\` first (the entry is loaded by path, so nothing else would notice)`);
}

// ── entryPath 与产物对得上（缺陷 2）────────────────────────────────────────
//
// 这一条**不能**靠下面的 spawn 顺带发现：spawn 用的是我们自己拼的
// `path.join(RESOURCES, entryName)`，而生产里 pool 用的是 kind def 里的
// `entryPath`。两者在缺陷 2 存在时会**同时**指向 bundle 的上一级 —— 上面的
// spawn 因为路径写死成 RESOURCES 所以照样通过，缺陷完全隐身。
// （实测：把 entryPath 改回 `'..'` 形态，重建后本脚本仍 exit=0。）
//
// 所以这里必须**从产物里读出 kind def 真正会算出来的路径**，再问它存不存在。
// 读 server-dist.js 而不是源码：只有产物里的那份才是生产真正执行的。
console.log('entryPath resolves to a file that exists');
const SERVER_DIST = path.join(RESOURCES, 'server-dist.js');
if (!existsSync(SERVER_DIST)) {
  fail('server-dist.js is missing — run `npm run build:server` first');
} else {
  const dist = readFileSync(SERVER_DIST, 'utf8');
  for (const kind of ['git-graph', 'file-explorer']) {
    // Match `entryPath: path4.join(here, ...args)` however many args esbuild
    // emitted. Pinning the arg *count* would be the wrong constraint: the
    // `'..'` regression adds a second arg, and a strict regex then misses the
    // line entirely and reports "build changed shape" — pointing the reader at
    // the build script instead of at the actual defect.
    const m = dist.match(
      new RegExp(`entryPath:\\s*\\w+\\.join\\(([^)]*worker-entry-${kind}\\.js[^)]*)\\)`),
    );
    if (!m) {
      fail(`could not find ${kind}'s entryPath in server-dist.js — did the build change shape?`);
      continue;
    }
    const args = m[1];
    // Resolve EVERY string argument, not just the filename. The `'..'`
    // regression arrives as an extra leading argument, so reading only the
    // last one silently drops it and the check passes on a broken path.
    const literals = (args.match(/"[^"]*"/g) ?? []).map((s) => JSON.parse(s));
    if (literals.length === 0) {
      fail(`could not read ${kind}'s entryPath filename out of: ${args.trim()}`);
      continue;
    }
    const segs = literals.join(' -> ');
    // here = RESOURCES（server-dist.js 所在目录）；带 '..' 时 path.join 会解析出
    // bundle 的上一级，那正是缺陷 2 的形态。
    const resolved = path.resolve(RESOURCES, ...literals);
    if (existsSync(resolved)) {
      ok(`${kind} entryPath -> ${segs}`);
    } else {
      fail(
        `${kind} entryPath -> ${segs} resolves to ${resolved}, which does not exist. ` +
          `new Worker(<missing path>) does NOT throw — it emits 'error' asynchronously, ` +
          `so pool.spawn() reports success and the MiniApp gets a worker that can never answer.`,
      );
    }
  }
}

// ── git-graph ─────────────────────────────────────────────────────────────

const repo = makeRepo();
// Declared before the try so the finally can always clean it up — a `const`
// created inside the try is in TDZ if makeRepo throws.
const outsideRepo = makeRepo('outside-');
try {
  console.log('git-graph worker (read-only scope, as the shipped meta declares)');
  const { worker, call } = spawnWorker('worker-entry-git-graph.js', 'git-graph', {
    read: [`${repo}/**`],
    write: [],
  });
  try {
    const st = await call('git.status', { cwd: repo });
    if (!st.ok) {
      fail(`git.status failed: ${st.error?.message}`);
    } else {
      // 精确比内容而不是"含有 branches"：下拉框要列出**所有**分支。
      const expected = git(repo, 'branch', '--format=%(refname:short)').trim().split(/\r?\n/).filter(Boolean);
      const got = [...(st.result.branches ?? [])].sort();
      if (JSON.stringify(got) === JSON.stringify(expected.sort())) {
        ok(`git.status returned branches ${JSON.stringify(got)} (app's dropdown gate)`);
      } else {
        fail(`git.status branches = ${JSON.stringify(got)}, expected ${JSON.stringify(expected.sort())}`);
      }
      if (st.result.current === 'main') ok('git.status current = main');
      else fail(`git.status current = ${st.result.current}, expected main`);
    }

    const log = await call('git.log', { cwd: repo, max: 50 });
    if (log.ok && Array.isArray(log.result.all) && log.result.all.length > 0) {
      ok(`git.log returned ${log.result.all.length} commit(s)`);
    } else {
      fail(`git.log failed: ${log.error?.message ?? 'no commits'}`);
    }

    // 写侧：只读 scope 下必须被拒，且**工作树不变**。
    const co = await call('git.checkout', { cwd: repo, branch: 'feature-x' });
    if (!co.ok) ok('git.checkout refused under read-only scope');
    else fail('git.checkout SUCCEEDED with an empty fs.write — the fs gate is not load-bearing');

    const after = await call('git.status', { cwd: repo });
    if (after.ok && after.result.current === 'main') ok('working tree unchanged after the refused checkout');
    else fail(`after a refused checkout current = ${after.result?.current ?? after.error?.message}`);

// 越界读必须被 **fs scope** 拒，而不是被「这里不是 git repo」顺带拒掉。
// 早先这里指向 'C:/Windows'：它当然不是 repo，于是 assertReadableCwd 里的
// stat/git 检查先抛错，把 fs 闸门整段盖掉 —— 删掉 read 闸门后冒烟照样全绿
// （实测 D7 存活）。所以这里必须造一个**真的在 scope 外的 git 仓库**：
// 只有 fs 闸门能拒它。
const outside = await call('git.status', { cwd: outsideRepo });
if (!outside.ok) {
  const msg = String(outside.error?.message ?? '');
  if (msg.includes('fs.read') || msg.includes('permissions')) {
    ok('out-of-scope git repo refused by the fs.read gate');
  } else {
    fail(
      'out-of-scope repo was refused, but not by the fs gate: ' + msg +
        ' — this check only means something if the fs scope is what rejected it',
    );
  }
} else {
  fail('out-of-scope git repo was ALLOWED: ' + JSON.stringify(outside.result).slice(0, 120));
}
  } finally {
    await worker.terminate();
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outsideRepo, { recursive: true, force: true });
}

// ── file-explorer ─────────────────────────────────────────────────────────

const tree = makeTree();
try {
  console.log('file-explorer worker');
  const { worker, call } = spawnWorker('worker-entry-file-explorer.js', 'file-explorer', {
    read: [`${tree}/**`],
    write: [],
  });
  try {
    const t = await call('file.tree', { root: tree, maxDepth: 4, maxEntries: 800 });
    if (t.ok && Array.isArray(t.result.entries) && t.result.entries.length > 0) {
      ok(`file.tree returned ${t.result.entries.length} entries`);
    } else {
      fail(`file.tree failed: ${t.error?.message ?? 'no entries'}`);
    }

    const r = await call('file.read', { path: path.join(tree, 'a.txt') });
    if (r.ok && r.result.content === 'hello world\n') ok('file.read returned the exact content');
    else fail(`file.read content = ${JSON.stringify(r.result?.content ?? r.error?.message)}`);

    const s = await call('file.search', { root: tree, query: 'nested', maxHits: 100, caseInsensitive: true });
    if (s.ok && Array.isArray(s.result.hits) && s.result.hits.length > 0) {
      ok(`file.search returned ${s.result.hits.length} hit(s)`);
    } else {
      fail(`file.search failed: ${s.error?.message ?? 'no hits'}`);
    }

    const outside = await call('file.read', { path: 'C:/Windows/win.ini' });
    if (!outside.ok) ok('out-of-scope read refused');
    else fail('out-of-scope read was ALLOWED');
  } finally {
    await worker.terminate();
  }
} finally {
  rmSync(tree, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.error(`verify:miniapp-workers FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('verify:miniapp-workers ok — both worker kinds ran from the built artifacts.');
