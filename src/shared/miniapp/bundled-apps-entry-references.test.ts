// bundled-apps-entry-references.test.ts — 内置 MiniApp 的「入口引用必须解析得到」护栏。
//
// ## 这个文件守的是什么
//
// `cmd_miniapp_source` 在把 HTML 交给 iframe 之前会内联同目录的兄弟文件（Rust 侧
// `inline_miniapp_siblings` → `read_inline_target`）。引用解析不到时它的策略是**软
// 失败**：把原标签原样留着，好让 renderer 看到引用而不是悄悄丢掉。
//
// 对远程 URL 这是对的。对**本地相对路径**它意味着 `<script src="ui.js">` 被留成
// 一个指向宿主 origin 的引用 —— iframe 是 srcdoc，base URL 就是父文档，于是这个
// 请求必然 404。MiniApp 整个不工作，而且**没有任何一层会报错**：meta.json 合法、
// schema 通过、app 出现在市场列表里、iframe 正常渲染出一片空白。
//
// skill 文档自己写出了这个症状（「如果某个引用在真实运行里加载不到，不要往 CSP 或
// sandbox 上想解决办法 —— 那是宿主在 inline_miniapp_siblings 那里没内联成」），
// 但没有任何测试守它。把 `ui.js` 改名成 `main.js` 而忘了同步 `index.html`，就是
// 这样一个静默失效：装得上、打得开、什么都没有。
//
// 所以这里问的是一个文件系统事实，不是一个渲染结果：入口 HTML 里每个**会被内联**
// 的引用，解析到的是不是这个 MiniApp 目录里真实存在的文件。
//
// ## 与既有护栏的分工
//
// `bundled-apps-permissions.test.ts` 守「作者调的方法被自己的 meta 声明了」，
// `bundled-worker-*.test.ts` 守「worker 方法名与参数在 schema 里」。这三条合起来
// 已经覆盖了 API 契约，但都不碰**文件引用**这条接缝 —— 也就是宿主与作者代码之间
// 真正会静默失败的那一处。

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const BUNDLED_ROOT = join(process.cwd(), 'bundled-miniapps');

interface BundledApp {
  id: string;
  dir: string;
  /** `meta.json` 的 `entry`（缺省 `source/index.html`）解析出的绝对路径。 */
  entryPath: string;
  html: string;
}

function loadApps(): BundledApp[] {
  const apps: BundledApp[] = [];
  for (const entry of readdirSync(BUNDLED_ROOT)) {
    if (entry.startsWith('_')) continue; // `_e2e-fixtures` are test inputs, not shipped
    const dir = join(BUNDLED_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      id: string;
      entry?: string;
    };
    const entryPath = join(dir, meta.entry ?? 'source/index.html');
    apps.push({
      id: meta.id,
      dir,
      entryPath,
      html: existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '',
    });
  }
  return apps;
}

/**
 * `read_inline_target`（Rust）判定「这是我们该内联的本地文件」的那组条件。
 *
 * 目的**不是**复刻实现，而是与它**同向**：它会内联的引用必须真实存在；它不内联的
 * 引用（远程 / 绝对 / 带 `..`）不该被这条护栏要求存在 —— 那些是作者有意为之，
 * 运行时由浏览器或 CSP 处理，不是本文件该判的事。
 */
function isInlinableLocalRef(ref: string): boolean {
  if (!ref) return false;
  if (ref.includes('://')) return false;
  if (ref.startsWith('//')) return false;
  if (ref.startsWith('data:')) return false;
  if (ref.startsWith('/')) return false;
  if (ref.startsWith('#')) return false;
  if (ref.split(/[/\\]/).some((seg) => seg === '..' || seg === '.')) return false;
  return true;
}

/**
 * 抓入口 HTML 里的 `<link href>` / `<script src>`。
 *
 * 刻意写得宽松：护栏宁可多看一眼，也不要因为解析器的边界漏掉一个真实存在的坏引用。
 * 宽松的代价是可能把非引用的 `href` 也算进来 —— 那种情况只会让断言**更严**，
 * 不会漏放。
 */
function extractRefs(html: string): string[] {
  const out: string[] = [];
  const re = /<(?:link|script)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

const APPS = loadApps();

/**
 * 找出这个 app 里**会**被内联、却解析不到文件的引用。
 *
 * 抽成函数而不是把断言写在 `it` 里，是为了让「护栏本身能抓到坏引用」这件事可以
 * 被单独证明 —— 只对真实 app 断言「一个都不缺」，在提取器写坏时会永远绿。
 */
function findUnresolvableRefs(app: BundledApp): string[] {
  const bad: string[] = [];
  for (const ref of extractRefs(app.html)) {
    if (!isInlinableLocalRef(ref)) continue;
    const target = resolve(app.entryPath, '..', ref);
    const inside = relative(app.dir, target);
    if (inside.startsWith('..')) {
      bad.push(`${ref} (escapes the MiniApp dir)`);
    } else if (!existsSync(target)) {
      bad.push(`${ref} -> ${target}`);
    }
  }
  return bad;
}

describe('bundled MiniApps: every inlinable entry reference resolves to a real file', () => {
  it('finds the bundled apps at all (guards against a silently empty fixture)', () => {
    expect(APPS.length).toBeGreaterThan(0);
  });

  it('every meta.json entry points at an HTML file that exists', () => {
    for (const app of APPS) {
      expect(
        existsSync(app.entryPath),
        `${app.id}: meta.json's entry does not resolve to a file (${app.entryPath})`,
      ).toBe(true);
    }
  });

  it('no meta.json entry escapes its own MiniApp directory', () => {
    // 与 Rust 侧 `read_meta_entry` 的校验配对：那边拒盘符 / 根 / `..`，这里钉住
    // 我们自己发布的 meta 不会走到那条拒分支上。两边都做才不是单边。
    for (const app of APPS) {
      const rel = relative(app.dir, resolve(app.entryPath));
      expect(
        rel.startsWith('..') || resolve(rel) === resolve(app.dir),
        `${app.id}: entry escapes the MiniApp dir (${rel})`,
      ).toBe(false);
    }
  });

  it('every local <link href> / <script src> in an entry exists on disk', () => {
    for (const app of APPS) {
      expect(
        findUnresolvableRefs(app),
        `${app.id}: the host inlines siblings before mount, so an unresolvable ` +
          `reference means a 404 against the host origin and a silently dead ` +
          `MiniApp — nothing else in the stack reports it.`,
      ).toEqual([]);
    }
  });

  it('detects a missing reference — the guard is not vacuously green', () => {
    // 真实 app 全绿不能证明护栏会红。这里在临时目录里造一个**故意坏掉**的 app，
    // 用同一个函数去问：它必须被抓出来。护栏自己也要被护栏。
    const dir = mkdtempSync(join(tmpdir(), 'miniapp-entry-ref-'));
    try {
      mkdirSync(join(dir, 'source'), { recursive: true });
      const app = (html: string): BundledApp => ({
        id: 'synthetic',
        dir,
        entryPath: join(dir, 'source', 'index.html'),
        html,
      });

      const broken = app(
        '<link rel="stylesheet" href="style.css">' +
          '<script src="main.js"></script>' +
          '<script src="https://cdn.example/ok.js"></script>',
      );
      // style.css 与 main.js 都不存在；外链不该被算进来。
      expect(findUnresolvableRefs(broken)).toHaveLength(2);
      expect(findUnresolvableRefs(broken).join(' ')).toContain('main.js');

      // 把两个文件补上，同一个函数就该返回空 —— 证明它报的是「缺失」这件事
      // 本身，而不是「提取到了引用」就报。
      writeFileSync(join(dir, 'source', 'style.css'), 'body{}');
      writeFileSync(join(dir, 'source', 'main.js'), '// ok');
      expect(findUnresolvableRefs(broken)).toEqual([]);

      // `..` 引用在 `isInlinableLocalRef` 就被滤掉了（它由 read_inline_target 负责
      // 拒），所以逃逸分支的真正触发方式是**盘符**：那种字符串不以 `/` 开头、
      // 不含 `..`、也不是 URL，会一路活到 `resolve` 才暴露 —— 正是 Rust 侧
      // `read_inline_target` 那条洞的形状。这里能抓到它，说明护栏与那条判据同向。
      const escaping = app('<script src="C:\\Windows\\win.ini"></script>');
      expect(findUnresolvableRefs(escaping)).toHaveLength(1);
      expect(findUnresolvableRefs(escaping)[0]).toContain('escapes the MiniApp dir');
      // 而 `..` 引用不进这条护栏的视野（它在更早一层被拒），别把它算成漏放。
      expect(findUnresolvableRefs(app('<script src="../../../etc/passwd"></script>'))).toEqual(
        [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('actually inspects references (a regex that matches nothing must fail here)', () => {
    // 防的是「护栏自己空转」：上面那条如果因为正则写坏而一个引用都没抓到，
    // 就会永远绿。没有这条，坏正则 == 假覆盖。
    const withRefs = APPS.filter((a) => extractRefs(a.html).length > 0);
    expect(withRefs.length).toBe(APPS.length);
    expect(extractRefs('<link href="style.css">')).toEqual(['style.css']);
    expect(extractRefs("<script src='ui.js'></script>")).toEqual(['ui.js']);
    expect(extractRefs('<script src=ui.js></script>')).toEqual(['ui.js']);
    // 外链与 data: 不该被算成「必须存在的本地文件」。
    expect(isInlinableLocalRef('https://cdn.example/x.js')).toBe(false);
    expect(isInlinableLocalRef('//cdn.example/x.js')).toBe(false);
    expect(isInlinableLocalRef('data:text/css,x')).toBe(false);
    expect(isInlinableLocalRef('#anchor')).toBe(false);
    expect(isInlinableLocalRef('/abs/x.js')).toBe(false);
    expect(isInlinableLocalRef('../up/x.js')).toBe(false);
    expect(sep).toBeTruthy();
  });
});
