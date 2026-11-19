/**
 * 内置浏览器脚本的行为护栏：定位、点击事件序列、点击前后的效果判定。
 *
 * **为什么不在这里照抄一份 JS。** 这些脚本的真值不在字符串长什么样，而在
 * 装进一个真实 DOM 之后会不会选中对的元素、点下去有没有发出完整事件序列、
 * 前后两次快照能不能分辨「页面变了」。2026-11 那次 `click --text 发布` 点中
 * 工具栏就是这种事故：Rust 侧的 `contains(...)` 断言全绿，行为全错。
 *
 * **也不照抄。** 副本会漂移——脚本改了、测试还在测旧副本，比没有测试更坏。
 * 所以直接从 `src-tauri/src/browser_agent.rs` 抽源码：那里是唯一事实源，
 * `INSTALL_HELPERS` 是 raw string（原样可用），三个脚本在 `format!` 里
 * （展开 `{{` / `}}` 和 `{INSTALL_HELPERS}` 占位符即可）。
 *
 * 分工：Rust 侧 `scripts_are_self_contained_expressions` 管形态（单表达式、
 * 无 await，因为 WebView2 只取表达式的返回值）；这里管语义。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const RUST_SRC = readFileSync(
  join(process.cwd(), 'src-tauri/src/browser_agent.rs'),
  'utf8',
);

/** `const NAME: &str = r#"…"#;` — a raw string, so its body is already JS. */
function rawString(name: string): string {
  const start = RUST_SRC.indexOf(`const ${name}: &str = r#"`);
  if (start === -1) throw new Error(`raw string ${name} not found in browser_agent.rs`);
  const bodyStart = RUST_SRC.indexOf('r#"', start) + 3;
  const end = RUST_SRC.indexOf('"#;', bodyStart);
  if (end === -1) throw new Error(`raw string ${name} is unterminated`);
  return RUST_SRC.slice(bodyStart, end);
}

/**
 * The `format!("…")` body of `pub fn <name>()`.
 *
 * Rust's `format!` escaping is mechanical here: `{{` / `}}` are literal braces
 * and the only substitutions are `{INSTALL_HELPERS}` (the raw helper source)
 * and the `{sel}` / `{txt}` query arguments. Expanding exactly that, and
 * nothing else, means a script that grows a new placeholder fails loudly here
 * instead of silently running with the placeholder still in it.
 */
function formatBody(fnName: string): string {
  const fnStart = RUST_SRC.indexOf(`pub fn ${fnName}(`);
  if (fnStart === -1) throw new Error(`fn ${fnName} not found in browser_agent.rs`);
  const fmt = RUST_SRC.indexOf('format!(', fnStart);
  const open = RUST_SRC.indexOf('"', fmt) + 1;
  const close = RUST_SRC.indexOf('"\n    )', open);
  if (close === -1) throw new Error(`fn ${fnName} format! body is not in the expected shape`);
  return RUST_SRC.slice(open, close);
}

/** U+E000 private-use chars — never present in the scripts, safe as sentinels. */
const OPEN = '\uE000';
const CLOSE = '\uE001';

/** Expand a `format!` body into the JS string the webview actually receives. */
function expand(
  body: string,
  helpers: string,
  args: { sel?: string; txt?: string } = {},
): string {
  // Sentinel the escaped braces first, so the placeholder pass cannot eat
  // them — and so a `}}` inside the helper source cannot be mistaken for an
  // escaped brace on the way back.
  const guarded = body.split('{{').join(OPEN).split('}}').join(CLOSE);
  // Unescape the Rust string literal BEFORE substituting: the substituted
  // values are already JS literals (`JSON.stringify` output), and running the
  // backslash pass over them would halve their own escapes.
  const unescaped = guarded.replace(/\\\\/g, '\\');
  const out = unescaped
    .split('{INSTALL_HELPERS}').join(helpers)
    .split('{sel}').join(JSON.stringify(args.sel ?? ''))
    .split('{txt}').join(JSON.stringify(args.txt ?? ''))
    .split(OPEN).join('{').split(CLOSE).join('}');
  const leftover = out.match(/\{\w+\}/);
  if (leftover) throw new Error(`unexpanded format placeholder ${leftover[0]} in script`);
  return out;
}

const HELPERS = rawString('INSTALL_HELPERS');

function script(fnName: string, args: { sel?: string; txt?: string } = {}): string {
  return expand(formatBody(fnName), HELPERS, args);
}

/** The script as the page would see it: `INSTALL_HELPERS && (…)()`. */
function run(code: string): Record<string, unknown> {
  // Parenthesized on the same line as `return`: the scripts start with a
  // newline, and `return\n(…)` is an automatic-semicolon trap that yields
  // undefined. This is also exactly how the webview evaluates the payload.
  return new Function(`return (${code}\n)`)() as Record<string, unknown>;
}

/**
 * jsdom has no layout: every element reports 0×0, which makes `__hamunaVisible`
 * reject everything. Stub a rectangle so visibility means something, and let a
 * test decide what `elementFromPoint` answers (the dead-overlay case).
 */
function withLayout<T>(opts: { coveredBy?: string }, body: () => T): T {
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalHit = document.elementFromPoint;
  // jsdom implements neither of these; the click script uses both.
  const originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Element.prototype.getBoundingClientRect = function rect() {
    return { left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40, x: 10, y: 10, toJSON() { return this; } } as DOMRect;
  };
  if (opts.coveredBy) {
    const covered = opts.coveredBy;
    document.elementFromPoint = (() => document.querySelector(covered)) as typeof document.elementFromPoint;
  }
  return (() => {
    try {
      return body();
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Element.prototype.scrollIntoView = originalScroll;
      document.elementFromPoint = originalHit;
    }
  })();
}

function mount(html: string, shadow?: (doc: Document) => void): void {
  document.body.innerHTML = html;
  shadow?.(document);
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Each page instance starts with a clean helper cache, like a fresh document.
  delete (window as unknown as Record<string, unknown>).__hamunaAgentHelpers;
  // jsdom's `window` is not an instance of jsdom's `Window`, so
  // `new MouseEvent(…, {view: window})` throws "member view is not of type
  // Window" — every browser accepts it. Drop the member so the click script's
  // own fallback is not what is being measured here.
  const RealMouse = window.MouseEvent;
  window.MouseEvent = class extends RealMouse {
    constructor(type: string, init: MouseEventInit = {}) {
      const { view: _unusedView, ...rest } = init as MouseEventInit & { view?: unknown };
      super(type, rest);
    }
  } as typeof MouseEvent;
});

describe('文本定位：同文本命中取谁', () => {
  it('叶子按钮胜过包含它的工具栏容器', () => {
    // 线上症状：`click --text 发布` 点中整条工具栏，label 是一整段
    // "发布图文 支持常用……"，按钮一次都没被点到，于是反复重试。
    mount('<div role="button" class="toolbar">发布图文 支持常用 <button class="publish">发布</button></div>');
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '发布' }));
      expect(out.label).toBe('发布');
      expect(String(out.selector)).toMatch(/button$/);
    });
  });

  it('同级角色时，标签更短的那个胜出（叶子加权）', () => {
    // 这条专门盯叶子加权：两个候选同样只「包含」关键字、同样拿到 role 分，
    // 剩下唯一的差别就是容器把整段编辑器文案也吞进了自己的 label。去掉加权
    // 后两者同分、按 DOM 顺序取第一个 —— 那正好是线上点中工具栏的形状。
    mount('<div role="button" class="panel">发布区 <div role="tab">去发布</div></div>');
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '发布' }));
      expect(out.label).toBe('去发布');
      expect(String(out.selector)).not.toContain('panel');
    });
  });

  it('其余命中作为候选报出来，让 agent 看见这次定位有多含糊', () => {
    mount('<div role="button" class="toolbar">发布图文 支持常用 <button>发布</button></div>');
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '发布' }));
      const matches = out.matches as Array<Record<string, unknown>>;
      expect(matches.length).toBeGreaterThan(1);
      // 排第一的就是被点的那个（列表按分数降序）。
      expect(matches[0].label).toBe('发布');
      expect(matches.some((m) => String(m.label).startsWith('发布图文'))).toBe(true);
    });
  });

  it('被遮罩盖住的按钮降权', () => {
    // 遮罩盖住时 rect 仍然非零，只靠可见性会把它当成可点。
    mount('<div><button class="dead">发布</button><div class="mask"></div></div>');
    withLayout({ coveredBy: '.mask' }, () => {
      const out = run(script('click_script', { txt: '发布' }));
      const matches = out.matches as Array<Record<string, unknown>>;
      expect(Number(matches[0].score)).toBeLessThan(1000);
    });
  });

  it('cover 判定不会把「点在子元素上」误判成被遮住', () => {
    // top 是按钮自己的子元素 → 是真命中，不该吃 -400 的遮挡罚分。
    // 断言「没被罚」而不是「分数够高」，因为罚分后的分数照样比阈值高，
    // 把方向写反（`top.contains(node)`）时这条就形同虚设。
    mount('<button class="go"><span class="txt">发布</span></button>');
    withLayout({ coveredBy: '.txt' }, () => {
      const out = run(script('click_script', { txt: '发布' }));
      const matches = out.matches as Array<Record<string, unknown>>;
      expect(Number(matches[0].score)).toBeGreaterThanOrEqual(1000);
    });
  });
});

describe('文本定位：穿 shadow root', () => {
  it('找到 shadow root 里的真按钮，并给出 `>>>` 选择器', () => {
    mount('<my-card></my-card>', (doc) => {
      doc.querySelector('my-card')!.attachShadow({ mode: 'open' }).innerHTML
        = '<button class="inside">发布</button>';
    });
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '发布' }));
      expect(out.label).toBe('发布');
      expect(String(out.selector)).toContain('>>>');
    });
  });

  it('返回的选择器能解析回同一个元素 —— agent 下一步要靠它精确点击', () => {
    mount('<my-card></my-card>', (doc) => {
      doc.querySelector('my-card')!.attachShadow({ mode: 'open' }).innerHTML
        = '<button class="inside">发布</button>';
    });
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '发布' }));
      const again = run(script('click_script', { sel: String(out.selector) }));
      expect(again.label).toBe('发布');
      expect(String(again.selector)).toContain('>>>');
    });
  });
});

describe('文本定位：没有文本的控件', () => {
  it('空文本框靠 placeholder 定位', () => {
    // 文本框的 "text" 是它的 value，空的就没有文本可匹配。
    mount('<textarea placeholder="作品描述"></textarea>');
    withLayout({}, () => {
      const out = run(script('click_script', { txt: '作品描述' }));
      expect(out.tag).toBe('textarea');
    });
  });
});

describe('click 的事件序列', () => {
  it('发完整指针序列，而不是只有 click', () => {
    // 只发 `el.click()` 时，靠 pointerdown 进激活态的组件库（Ant Design、
    // 字节系自研）永远不会触发 —— 命令返回成功，页面什么都没发生。
    mount('<button class="go">发布</button>');
    const fired: string[] = [];
    const btn = document.querySelector('.go')!;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      btn.addEventListener(type, () => fired.push(type));
    }
    withLayout({}, () => {
      run(script('click_script', { txt: '发布' }));
    });
    expect(fired).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });
});

describe('page snapshot：点击前后到底变没变', () => {
  it('新增一个可见控件就变', () => {
    mount('<button>发布</button>');
    withLayout({}, () => {
      const before = run(script('page_snapshot_script'));
      document.body.insertAdjacentHTML('beforeend', '<button>确定</button>');
      const after = run(script('page_snapshot_script'));
      expect(after.count).toBe(Number(before.count) + 1);
      expect(after.digest).not.toBe(before.digest);
    });
  });

  it('同一页面连拍两次结果一致 —— 否则每次点击都误报「有变化」', () => {
    mount('<button>发布</button><a href="#">帮助</a>');
    withLayout({}, () => {
      expect(run(script('page_snapshot_script'))).toEqual(run(script('page_snapshot_script')));
    });
  });

  it('控件标签换了（发布 → 发布中）也能分辨', () => {
    mount('<button class="go">发布</button>');
    withLayout({}, () => {
      const before = run(script('page_snapshot_script'));
      document.querySelector('.go')!.textContent = '发布中';
      const after = run(script('page_snapshot_script'));
      expect(after.digest).not.toBe(before.digest);
    });
  });
});

describe('fields 列出的选择器，click 必须能用', () => {
  it('shadow root 里的控件带着 `>>>` 选择器被列出，且能据此点中', () => {
    // 两边用不同的定位器时，agent 会拿着 fields 给的选择器点空。
    mount('<my-card></my-card><input placeholder="标题">', (doc) => {
      doc.querySelector('my-card')!.attachShadow({ mode: 'open' }).innerHTML
        = '<button>发布</button>';
    });
    withLayout({}, () => {
      const listed = run(script('fields_script')) as {
        fields: Array<{ tag: string; selector: string }>;
      };
      const shadowBtn = listed.fields.find((f) => f.tag === 'button');
      expect(shadowBtn?.selector).toContain('>>>');
      const out = run(script('click_script', { sel: shadowBtn!.selector }));
      expect(out.tag).toBe('button');
    });
  });
});