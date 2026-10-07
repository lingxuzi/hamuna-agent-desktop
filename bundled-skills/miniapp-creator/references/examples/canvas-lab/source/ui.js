/* ============================================================================
 * Canvas Lab — 行为层
 *
 * 这份 ui.js 的职责不是"实现一个出图应用"，而是演示画布类 MiniApp 最容易
 * 写错的五件事。仓库里已有的样例（任务列表 / 数据表 / 展示卡）没有一个碰到
 * <canvas>，而画布的坑和 DOM 的坑是两套：
 *
 *   1. **devicePixelRatio**。canvas 有两个尺寸：CSS 盒子（布局用）和
 *      canvas.width/height（背板，像素用）。只设其中一个，在 200% 缩放的
 *      屏上画出来就是一张糊掉 4 倍的图。见 resizeCanvas()。
 *
 *   2. **主题色读不到 var()**。ctx.fillStyle 不解析 var(--hamuna-accent) ——
 *      它只吃字面颜色串。所有画布颜色都必须在**绘制时**用 getComputedStyle
 *      现取，否则宿主切深色时画布还是浅色的。见 readTheme()。
 *
 *   3. **rAF 循环必须会停**。三道闸：prefers-reduced-motion 下根本不排帧；
 *      app.onDeactivate 时取消；app.onActivate 时恢复。见 startLoop()。
 *
 *   4. **确定性 PRNG**。"同一个种子画出同一张图"是这类应用的全部价值。
 *      Math.random() 一秒钟就能毁掉它 —— 它让"重新生成"变得不可复现，
 *      让"分享这张图"变得不可能。见 mulberry32()。
 *
 *   5. **导出的是背板**。toBlob 拿的是 canvas.width 那个分辨率，
 *      所以 dpr 是多少，导出的 PNG 就是多少像素。这不是 bug，是特性。
 * ========================================================================= */

/* --- i18n -----------------------------------------------------------------
 * app.t(table, fallback) 是运行时本地化的正确入口。meta.json 里的
 * i18n.locales 是**宿主侧**用来本地化应用名/描述的，ui.js 读不到它，
 * 所以应用内的文案表要自己维护一份。
 * -------------------------------------------------------------------- */
const I18N = {
  'app.title': { 'zh-CN': '画布实验室', 'en-US': 'Canvas Lab' },
  'app.subtitle': {
    'zh-CN': '确定性图案 · 同一颗种子必然画出同一张图',
    'en-US': 'Deterministic patterns · one seed always paints one picture',
  },
  'control.seed': { 'zh-CN': '种子', 'en-US': 'Seed' },
  'control.complexity': { 'zh-CN': '复杂度', 'en-US': 'Complexity' },
  'control.cell': { 'zh-CN': '单元格', 'en-US': 'Cell size' },
  'control.palette': { 'zh-CN': '色板', 'en-US': 'Palette' },
  'palette.harmony': { 'zh-CN': '谐色', 'en-US': 'Harmony' },
  'palette.graphite': { 'zh-CN': '石墨', 'en-US': 'Graphite' },
  'palette.duotone': { 'zh-CN': '双色', 'en-US': 'Duotone' },
  'action.random': { 'zh-CN': '随机种子', 'en-US': 'New seed' },
  'action.regenerate': { 'zh-CN': '按种子重绘', 'en-US': 'Redraw from seed' },
  'action.export': { 'zh-CN': '导出 PNG', 'en-US': 'Export PNG' },
  'canvas.alt': {
    'zh-CN': '按当前参数确定性生成的几何图案',
    'en-US': 'Deterministic geometric pattern drawn from the current parameters',
  },
  'status.ready': { 'zh-CN': '改动任一参数即刻重画', 'en-US': 'Change any parameter to redraw' },
  'status.regenerated': { 'zh-CN': '同一颗种子 → 同一张图', 'en-US': 'Same seed → same picture' },
  'status.randomized': { 'zh-CN': '换了一颗种子：{0}', 'en-US': 'New seed: {0}' },
  'status.exported': { 'zh-CN': '已导出 canvas-lab-{0}.png', 'en-US': 'Exported canvas-lab-{0}.png' },
  'status.exportFailed': {
    'zh-CN': '导出失败：浏览器没能把画布编码成 PNG',
    'en-US': 'Export failed: the browser could not encode the canvas as PNG',
  },
};

/** 兜底取 zh-CN：即使宿主给了一个没覆盖的 locale，也不要显示空字符串。 */
const t = (key) => app.t(I18N[key] || {}, (I18N[key] || {})['zh-CN'] || key);

/** 状态行里带插值的那几条：`{0}` 换成实际值。 */
const tf = (key, arg) => t(key).replace('{0}', String(arg));

/* --- state ---------------------------------------------------------------- */

const DEFAULTS = { seed: 20260407, complexity: 3, cell: 28, palette: 'theme' };

/**
 * 每套色板是一组 token 名，不是颜色值 —— 颜色在 readTheme() 里现取。
 * 这就是为什么切主题不用改这里一行。
 */
const PALETTES = {
  theme: ['--hamuna-accent', '--hamuna-accent-secondary'],
  ink: ['--hamuna-text-primary', '--hamuna-text-secondary'],
  duo: ['--hamuna-accent-secondary', '--hamuna-text-primary'],
};

let state = { ...DEFAULTS };

const el = {
  canvas: document.getElementById('stage'),
  seed: document.getElementById('seed'),
  seedMeter: document.getElementById('seed-meter'),
  complexity: document.getElementById('complexity'),
  complexityOut: document.getElementById('complexity-out'),
  cell: document.getElementById('cell'),
  cellOut: document.getElementById('cell-out'),
  random: document.getElementById('random'),
  regen: document.getElementById('regen'),
  export: document.getElementById('export'),
  status: document.getElementById('status'),
  badge: document.getElementById('mode-badge'),
};

const ctx = el.canvas.getContext('2d');

/* --- 确定性 PRNG ----------------------------------------------------------
 *
 * mulberry32：32 位状态、周期 2^32、加法混合。选它的理由不是"随机质量最好"
 * （那要 PCG/xoshiro），而是**够好且六行就能写对**。一个参考样例里放一个
 * 读者可能复制走的随机数发生器，它的价值在于可读，不在于统计学。
 *
 * 为什么必须自带而不是用 Math.random()：
 *   - "按种子重绘"要复现同一张图 —— Math.random() 做不到；
 *   - 用户分享 seed 时对方要画出**同一张**图 —— 这需要纯函数式的状态推进；
 *   - 逐帧绘制时，同一帧重画十次结果必须一致 —— 否则图形会在刷新时抖动。
 *
 * 注意 `a = (a + 0x6d2b79f5) | 0`：`| 0` 把结果截回 32 位有符号整数。
 * 少了它，a 会一路涨成浮点数并最终超过 2^53 之后精度丢失、周期归零。
 * -------------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- devicePixelRatio ------------------------------------------------------
 *
 * 两个尺寸各管各的，缺一不可：
 *
 *   CSS 盒子        style.css 的 width:100% / aspect-ratio:1 —— 布局用
 *   canvas.width    = 盒子宽 × dpr            —— 背板，真实像素
 *
 * 漏掉第二行，在 dpr=2 的屏上：背板 300×300 被 CSS 拉到 600×600 显示，
 * 每一个逻辑像素用 4 个物理像素去糊 —— 线条发虚、圆变椭圆、1px 线消失。
 * 反过来只设 canvas.width 不设 CSS 尺寸，则布局按背板走，窗口一变就溢出。
 *
 /* `image-rendering` 不需要动：我们要的是**平滑**放大后的矢量边缘，
 * 不是像素画那种最近邻硬边。
 * -------------------------------------------------------------------- */

/**
 * 背板相对 CSS 盒子的倍率。模块级变量而不是每次从 ctx.getTransform() 反推：
 * ctx.save()/restore() 会把它改来改去，反推出来的值要看你在哪一行问。
 * 画布代码要用逻辑像素时全部除以它，就不必关心背板到底是多少。
 */
let viewScale = 1;

function resizeCanvas() {
  // getBoundingClientRect 给的是 CSS 像素（含缩放、含 transform 后的值）。
  const rect = el.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const dpr = window.devicePixelRatio || 1;
  // 上限 3：4K 屏 dpr 可能是 2，笔记本 + 150% 缩放叠在一起能到 2.5-3。
  // 背板是 width*height*dpr² 的内存，再往上没有肉眼收益，只有 OOM 风险。
  const scale = Math.min(dpr, 3);
  const w = Math.round(rect.width * scale);
  const h = Math.round(rect.height * scale);
  if (el.canvas.width === w && el.canvas.height === h) return false;

  el.canvas.width = w;
  el.canvas.height = h;
  viewScale = scale;
  // 设 width/height 会**清空整个绘图上下文状态**（变换、fillStyle、路径全归零），
  // 所以 setTransform 必须在赋值之后，不能提到前面。
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return true;
}

/* --- 主题色 ----------------------------------------------------------------
 *
 * ctx.fillStyle = 'var(--hamuna-accent)' 不会报错，也不会生效 ——
 * canvas 解析的是 CSS <color> 语法，不解析 var()。结果是 fillStyle 保持
 * 上一个值（初始是 '#000000'），整张图画成纯黑，而且没有任何提示。
 *
 * 正确做法是**在绘制时**现取。注意两个细节：
 *
 *   1. 读的是 `document.documentElement`（:root），不是 body ——
 *      宿主把 --hamuna-* 注入在 :root 上。
 *   2. 必须在每次绘制时重读，不能在启动时缓存成模块级常量：
 *      宿主切外观时会**重写 :root 上的变量值**，而我们手里那张缓存的
 *      字符串不会跟着变，画布会永远停在旧主题的颜色上。
 *      app.onAppearanceChange 里显式重画一次是最省心的兜底。
 *
 * trim() 不能省：getPropertyValue 的返回值常带首尾空格，
 * ' #7b8f6b' 在个别实现里会被 fillStyle 静默忽略。
 * -------------------------------------------------------------------- */
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name) => cs.getPropertyValue(name).trim();
  const names = PALETTES[state.palette] || PALETTES.theme;
  return {
    bg: pick('--hamuna-bg-inset'),
    ink: pick(names[0]),
    ink2: pick(names[1]),
    rule: pick('--hamuna-border-subtle'),
  };
}

/* --- 绘制 ----------------------------------------------------------------
 *
 * 图元是 immediate-mode：每一帧都从零重画整个场景，没有"场景图"也没有
 * "脏矩形"。这是画布和 DOM 最大的结构差异 —— 状态变了就整张重画，
 * 所以 draw() 必须是**纯函数式的**（只读 state，不写 state），
 * 否则第二次调用会画出和第一次不同的东西。
 *
 * 一条 canvas 特有的坑，下面 kind===0 分支踩的就是它：
 * **ctx.restore() 会把当前路径一起丢掉**。所以想"旋转后再描边"，
 * 不能 save/translate/rotate/rect/restore/stroke —— stroke 时路径已经空了，
 * 结果是静默地什么都不画。这里改用 setTransform 直接算变换矩阵。
 * -------------------------------------------------------------------- */
function draw() {
  const w = el.canvas.width / viewScale;
  const h = el.canvas.height / viewScale;
  const theme = readTheme();
  const rnd = mulberry32(state.seed);

  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const cols = Math.max(1, Math.round(w / state.cell));
  const rows = Math.max(1, Math.round(h / state.cell));
  const cw = w / cols;
  const ch = h / rows;

  // 复杂度只改变**消费**随机数的次数，不改变取数顺序：图层 0..k-1 在
  // complexity=k 和 complexity=k+1 时读到的是同一串 rnd()，所以调大复杂度
  // 是"往上叠一层"，而不是"整张图重新洗牌"。
  // 注意它**不是**逐像素前缀关系 —— 后画的图层会覆盖先画的，所以提高复杂度
  // 后画面里已存在的线条只是变得更密，不是原样保留。这里只保证取数稳定。
  ctx.lineWidth = Math.max(1, Math.round(state.cell * 0.06));
  ctx.lineCap = 'round';

  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const cx = i * cw + cw / 2;
      const cy = j * ch + ch / 2;

      for (let layer = 0; layer < state.complexity; layer += 1) {
        const r = rnd() * Math.min(cw, ch) * 0.42;
        const angle = rnd() * Math.PI * 2;
        const kind = Math.floor(rnd() * 3);

        ctx.strokeStyle = layer === 0 ? theme.ink : layer === 1 ? theme.ink2 : theme.rule;
        ctx.globalAlpha = layer === 0 ? 0.85 : layer === 1 ? 0.55 : 0.4;
        ctx.beginPath();

        if (kind === 0) {
          // 绕中心旋转的矩形。用 setTransform 推矩阵：cos/sin 就是旋转，
          // 平移量要把中心点旋转抵消掉 —— 不抵消的话矩形会绕原点甩出去。
          const s = r * 1.7;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          ctx.setTransform(
            viewScale,
            0,
            0,
            viewScale,
            viewScale * (cx - cx * cos + cy * sin),
            viewScale * (cy - cx * sin - cy * cos),
          );
          ctx.rect(-s / 2, -s / 2, s, s);
          // 描边之后立刻把矩阵还原：下面两个分支还在用绝对坐标。
          ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
        } else if (kind === 1) {
          ctx.arc(cx, cy, r, angle, angle + Math.PI * (0.6 + rnd()));
        } else {
          ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
          ctx.lineTo(cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
        }
        ctx.stroke();
      }
    }
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* --- 渲染循环 --------------------------------------------------------------
 *
 * 三道闸，缺一道就是一类真实缺陷：
 *
 *   1. prefers-reduced-motion: reduce —— **根本不排帧**。这不是"放慢"，
 *      是停掉：循环动画会让前庭功能障碍用户产生实际眩晕。
 *      这里画一帧静态图就收工，图案本身仍然完整可读。
 *
 *   2. app.onDeactivate —— MiniApp 切走/标签页隐藏时停。rAF 在后台本来
 *      就被浏览器降频，但"降频"不是"停"：一帧 60fps 的 canvas 在后台
 *      依然在烧 GPU。而且降频策略各浏览器不同，不能指望它兜底。
 *
 *   3. app.onActivate —— 切回来时恢复。onActivate/onDeactivate 只在
 *      **状态迁移**时触发，首次挂载不发，所以启动走的是另一条路径。
 *
 * matchMedia 的结果**每次问**，不要缓存成模块级常量：用户在系统设置里
 * 改"减少动态效果"是运行期行为，缓存了就再也对不上。
 * -------------------------------------------------------------------- */
function prefersStill() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let rafId = 0;

function startLoop() {
  if (rafId) return;
  // 第 1 道闸：直接不排帧。调用方负责先画一帧静态的。
  if (prefersStill()) return;
  const step = () => {
    rafId = 0;
    // 下一帧的 id 先拿到手 —— 这样 draw() 抛异常时循环仍然可被取消，
    // 不会变成一条谁也停不下来的孤儿循环。
    rafId = requestAnimationFrame(step);
    draw();
  };
  rafId = requestAnimationFrame(step);
}

function stopLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/** 任何一次"参数变了"都走这里：重画一帧，必要时重启循环。 */
function render() {
  draw();
  if (prefersStill()) stopLoop();
  else startLoop();
}

/* --- 控件回写 ------------------------------------------------------------- */

function setStatus(text) {
  if (el.status) el.status.textContent = text;
}

function paintControls() {
  el.seed.value = String(state.seed);
  // 刻度条长度 = 种子在量程里的位置。motif 的左半边。
  const ratio = (state.seed - Number(el.seed.min)) / (Number(el.seed.max) - Number(el.seed.min));
  el.seedMeter.style.setProperty('--cl-fill', `${(ratio * 100).toFixed(1)}%`);

  el.complexity.value = String(state.complexity);
  el.complexityOut.textContent = String(state.complexity);

  el.cell.value = String(state.cell);
  el.cellOut.textContent = `${state.cell}px`;

  for (const btn of document.querySelectorAll('.cl-seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.palette === state.palette));
  }
}

/* --- 环境同步 -------------------------------------------------------------
 *
 * 颜色不需要手动同步：宿主切主题时会重写 :root 上的 --hamuna-*，
 * 而 readTheme() 每帧现取，所以循环跑着的时候画布自己就跟着变了。
 * 循环停着的时候（reduced-motion / 后台切回来之前）必须显式补一帧。
 *
 * 但 color-scheme 必须显式设置 —— 它决定原生滚动条、表单控件和 canvas
 * 的默认外观，宿主 token 里没有这一项。不设的话深色主题下会出现一条
 * 亮色滚动条。
 * -------------------------------------------------------------------- */
function syncAppearance(mode) {
  document.documentElement.style.colorScheme = mode;
  if (el.badge) el.badge.textContent = mode;
  // token 已经换了，但背板上的像素不会自己更新。补一帧。
  draw();
}

function syncLocale() {
  document.documentElement.lang = app.locale || 'zh-CN';
  // data-i18n / data-i18n-placeholder / data-i18n-aria 都是本应用自己的
  // 约定，宿主不解析。aria 那一条不能省：画布是可访问性树里唯一
  // 承载内容的元素，它没有替代文本就是一张纯装饰图。
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  paintControls();
}

/* --- 事件绑定 ------------------------------------------------------------- */

function commit() {
  paintControls();
  render();
}

/** 数字输入在用户清空时会给出 '' 或 NaN。钳回量程，不要让 NaN 进 state。 */
function readNumber(input, min, max, fallback) {
  const n = Number(input.value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

el.seed.addEventListener('input', () => {
  state.seed = readNumber(el.seed, Number(el.seed.min), Number(el.seed.max), state.seed);
  commit();
});

el.complexity.addEventListener('input', () => {
  state.complexity = readNumber(el.complexity, 1, 6, state.complexity);
  commit();
});

el.cell.addEventListener('input', () => {
  state.cell = readNumber(el.cell, 8, 56, state.cell);
  commit();
});

for (const btn of document.querySelectorAll('.cl-seg')) {
  btn.addEventListener('click', () => {
    state.palette = btn.dataset.palette;
    commit();
  });
}

el.random.addEventListener('click', () => {
  // 只有这一个按钮用真随机。种子一变，图案必然变；
  // 而「按种子重绘」之后必然回到刚才那张 —— 这两条合起来才是可复现性。
  state.seed = 1 + Math.floor(Math.random() * Number(el.seed.max));
  commit();
  setStatus(tf('status.randomized', state.seed));
});

el.regen.addEventListener('click', () => {
  // 画面和现在**逐像素相同**，所以必须说一句：否则用户以为按钮坏了。
  commit();
  setStatus(t('status.regenerated'));
});

el.export.addEventListener('click', () => {
  // 导出的是**背板**，不是 CSS 盒子 —— 所以 dpr=2 时导出的 PNG 是
  // 盒子的两倍像素。这不是副作用，是这类应用本来就该有的行为：
  // 屏幕上看 600px，导出拿到 1200px 的图。
  //
  // 指针事件里同步调用 toBlob：Safari 在用户手势之外调用会被拒。
  el.canvas.toBlob((blob) => {
    if (!blob) {
      setStatus(t('status.exportFailed'));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-lab-${state.seed}.png`;
    a.click();
    // 立刻 revoke 会让还没开始下载的 blob 变成空文件。给一拍的时间。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(tf('status.exported', state.seed));
  }, 'image/png');
});

/* --- 尺寸变化 --------------------------------------------------------------
 *
 * 两条路径都要接：
 *   - window.resize：窗口/侧栏宽度变了；
 *   - ResizeObserver：容器变了但窗口没变（侧栏展开、字体加载完导致重排）。
 *     只监听 window 的话，后一种情况画布会停在旧尺寸上，背板和 CSS 盒子
 *     对不上 —— 图看着没变形，但清晰度悄悄掉了 1/dpr。
 * -------------------------------------------------------------------- */
window.addEventListener('resize', () => {
  if (resizeCanvas()) draw();
});

if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => {
    if (resizeCanvas()) draw();
  });
  ro.observe(el.canvas);
}

/* --- 启动 ----------------------------------------------------------------- */

// 不要写成顶层 `await`：宿主会把 `<script src="ui.js">` 就地替换成裸的
// script 元素（Rust `inline_miniapp_siblings`），**没有** `type="module"`，
// 所以整份文件按 classic script 解析。顶层 await 是 SyntaxError，会让
// 这里整个行为层一行都不执行，而且只在 console 里留一条 red error，
// 界面停在空壳上，看起来像"没数据"。任何 `await` 都必须待在 async 函数内部。

// 入场 stagger 的**值**在 CSS（24ms/个），JS 只给索引。上限 2，见 style.css。
document.querySelector('.cl-canvas').classList.add('cl-enter');
document.querySelector('.cl-panel').classList.add('cl-enter');
document.querySelector('.cl-panel').style.setProperty('--cl-stagger-i', '1');

resizeCanvas();
syncAppearance(app.appearanceMode);
syncLocale();
render();
setStatus(t('status.ready'));

// 订阅而不是只读一次：外观和语言都会在会话中途变化。
// 陷阱同 design-reference：onAppearanceChange 收到的是整个事件对象，
// 不是裸的 mode 字符串 —— 读 getter（app.appearanceMode）而不是信 payload。
app.onAppearanceChange(() => syncAppearance(app.appearanceMode));
app.onLocaleChange(() => syncLocale());

// 上面的启动代码里 syncAppearance(app.appearanceMode) 读到的其实是 runtime 的
// **内置默认值**（'dark'），不是宿主的真实外观 —— 见 appRuntimeScript 第 231 行
// 的 `appearanceMode: 'dark'`。宿主真正的外观在 host.ready 之后才写进 env，
// 而 host.ready **不发** appearance 事件（它只 emit('event', {type:'ready'})）。
// 于是不订这一条的话，浅色宿主里徽标会一直写着 dark。
// 这是"启动时读一次 getter"这种写法在 MiniApp 里的真实代价，
// 值得抄：任何在 ready 之前读过的环境值，都要用 ready 事件补一次。
app.on(function (event) {
  if (event && event.type === 'ready') {
    syncAppearance(app.appearanceMode);
    syncLocale();
  }
});

// 第 2、3 道闸：切走停、切回恢复。
app.onDeactivate(() => stopLoop());
app.onActivate(() => {
  // 切回来时背板可能已经因为布局变化而失配，先对齐再跑。
  resizeCanvas();
  render();
});

// 用户在系统设置里改"减少动态效果"是运行期行为。这里跟着翻一次：
// 从开→关 就把循环起起来，从关→开 就把它停掉并留一帧静态图。
const stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const onStillChange = () => {
  if (stillQuery.matches) {
    stopLoop();
    draw();
  } else {
    render();
  }
};
if (stillQuery.addEventListener) stillQuery.addEventListener('change', onStillChange);
else if (stillQuery.addListener) stillQuery.addListener(onStillChange);

// ponytail: 图案的"运动"目前是重绘同��张静态图（rAF 里每帧画一遍），
// 并没有让图元真的动起来 —— 它演示的是循环的**生命周期**（何时开始、何时
// 停、reduced-motion 下如何不启动），而不是动画算法。要真动画，把 draw()
// 末尾的 phase 参数接进去即可，stopLoop/startLoop 的边界不变。