/* ============================================================================
 * Design Reference — 行为层
 *
 * 这份 ui.js 的职责不是"实现一个清单应用"，而是演示四条容易被写错的规矩：
 *
 *   1. 环境同步要在订阅里做，不只在启动时做一次。外观和语言都是会变的。
 *   2. 动效的**编排**在 JS 里，**参数**在 CSS 里。JS 只负责给元素加
 *      data-enter / --dr-stagger-i 这类标记，不去算时长和曲线。
 *   3. 删除元素前先播退场动画，播完再摘节点。直接 innerHTML 重写会把退场
 *      动画连同节点一起销毁，视觉上就是"闪一下就没了"。
 *   4. 任何 await 宿主 API 的地方都要处理失败。静默吞掉是 MiniApp
 *      "看起来坏了"的头号原因。
 * ========================================================================= */

/* --- i18n -----------------------------------------------------------------
 * app.t(table, fallback) 是运行时本地化的正确入口。meta.json 里的
 * i18n.locales 是**宿主侧**用来本地化应用名/描述的，ui.js 读不到它，
 * 所以应用内的文案表要自己维护一份。
 * -------------------------------------------------------------------- */
const I18N = {
  'app.title': { 'zh-CN': '设计参考', 'en-US': 'Design Reference' },
  'app.subtitle': { 'zh-CN': '视觉与动效质量基线', 'en-US': 'Visual and motion baseline' },
  'list.placeholder': { 'zh-CN': '添加一条任务…', 'en-US': 'Add a task…' },
  'list.add': { 'zh-CN': '添加', 'en-US': 'Add' },
  'list.empty.title': { 'zh-CN': '还没有任务', 'en-US': 'No tasks yet' },
  'list.empty.hint': { 'zh-CN': '上面输入一条，先看静态状态', 'en-US': 'Add one above to see the resting state' },
  'list.pending': { 'zh-CN': '待办', 'en-US': 'To do' },
  'list.done': { 'zh-CN': '完成', 'en-US': 'Done' },
  'action.simulate': { 'zh-CN': '演示异步状态', 'en-US': 'Simulate async' },
  'action.toast': { 'zh-CN': '演示反馈动效', 'en-US': 'Show feedback' },
  'action.reset': { 'zh-CN': '重置演示数据', 'en-US': 'Reset demo data' },
  'action.remove': { 'zh-CN': '删除这条任务', 'en-US': 'Remove this task' },
  'toast.added': { 'zh-CN': '已添加', 'en-US': 'Added' },
  'toast.done': { 'zh-CN': '已完成', 'en-US': 'Done' },
  'toast.undone': { 'zh-CN': '已恢复', 'en-US': 'Restored' },
  'toast.storageFailed': { 'zh-CN': '本地存储不可用，本次改动不会保留', 'en-US': 'Storage unavailable; changes will not persist' },
  'toast.loaded': { 'zh-CN': '加载完成', 'en-US': 'Loaded' },
};

/** 兜底取 zh-CN：即使宿主给了一个没覆盖的 locale，也不要显示空字符串。 */
const t = (key) => app.t(I18N[key] || {}, (I18N[key] || {})['zh-CN'] || key);

/* --- state ---------------------------------------------------------------- */

const STORAGE_KEY = 'design-reference:tasks';

/** 首次启动的 fixture。真接数据源时替换这里，其余代码不用动。 */
const SEED = [
  { id: 'a', label: '读一遍 style.css 顶部的设计系统声明', done: false },
  { id: 'b', label: '检查每个 var() 是否都带 fallback', done: false },
  { id: 'c', label: '确认没有任何 transition: all', done: true },
];

let tasks = [];
let selectedId = null;

const el = {
  badge: document.getElementById('mode-badge'),
  input: document.getElementById('new-task'),
  add: document.getElementById('add-task'),
  list: document.getElementById('list'),
  skeleton: document.getElementById('skeleton'),
  empty: document.getElementById('empty'),
  simulate: document.getElementById('simulate'),
  toast: document.getElementById('toast'),
  reset: document.getElementById('reset'),
  toastHost: document.getElementById('toast-host'),
};

/* --- 外观同步 -------------------------------------------------------------
 * 颜色不需要手动同步：宿主切换主题时会重写 :root 上的 --hamuna-*，
 * 下游全用语义别名，自动跟随。
 *
 * 但 color-scheme 必须显式设置 —— 它决定原生滚动条、表单控件和 canvas
 * 的默认外观，宿主 token 里没有这一项。不设的话深色主题下会出现一条
 * 亮色滚动条，这正是"廉价感"最常见的来源之一。
 * -------------------------------------------------------------------- */
function syncAppearance(mode) {
  document.documentElement.style.colorScheme = mode;
  if (el.badge) el.badge.textContent = mode;
}

function syncLocale() {
  document.documentElement.lang = app.locale || 'zh-CN';
  // data-i18n / data-i18n-placeholder 是本应用自己的约定，宿主不解析。
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  render();
}

/* --- 渲染 ----------------------------------------------------------------- */

function makeRow(task, index) {
  const row = document.createElement('li');
  row.className = 'dr-row';
  row.dataset.id = task.id;
  row.dataset.done = String(task.done);
  row.dataset.selected = String(task.id === selectedId);
  row.dataset.enter = 'true';
  // stagger 的**值**在 CSS（24ms/条），JS 只给索引。上限 8 条见 style.css。
  row.style.setProperty('--dr-stagger-i', String(Math.min(index, 7)));

  const check = document.createElement('button');
  check.className = 'dr-check';
  check.type = 'button';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(task.done));
  check.addEventListener('click', () => toggle(task.id));

  const label = document.createElement('span');
  label.className = 'dr-row__label';
  label.textContent = task.label;

  const tag = document.createElement('span');
  tag.className = 'dr-tag';
  tag.textContent = task.done ? t('list.done') : t('list.pending');

  const remove = document.createElement('button');
  remove.className = 'dr-row__remove';
  remove.type = 'button';
  remove.setAttribute('aria-label', t('action.remove'));
  remove.textContent = '×';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    // 走退场动画而不是直接 splice + render()：直接重写会把节点连同动画
    // 一起销毁，视觉上就是"闪一下就没了"。
    removeRow(row, () => {
      tasks = tasks.filter((x) => x.id !== task.id);
      if (selectedId === task.id) selectedId = null;
      render();
      void persist();
    });
  });

  // 点行选中，而不是点勾选框才选中。整行可点是命中目标的正确做法。
  row.addEventListener('click', (event) => {
    if (event.target === check || event.target === remove) return;
    selectedId = selectedId === task.id ? null : task.id;
    render();
  });

  row.append(check, label, tag, remove);
  return row;
}

function render() {
  el.list.replaceChildren(...tasks.map(makeRow));
  const nothing = tasks.length === 0;
  if (el.empty) el.empty.hidden = !nothing;
}

/** 带退场动画地移除一行。动画播完再摘节点，否则动画会被一起销毁。 */
function removeRow(row, done) {
  if (row.dataset.exit === 'true') return;
  row.dataset.exit = 'true';
  const finish = () => {
    row.remove();
    done();
  };
  // 与 --dr-dur (180ms) 对齐；读 CSS 变量而不是写死，改了 CSS 这里自动跟上。
  const ms = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--dr-dur'),
  );
  const delay = Number.isFinite(ms) ? ms : 180;
  row.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, delay + 60); // 动画被 prefers-reduced-motion 关掉时没有事件兜底
}

/* --- 行为 ----------------------------------------------------------------- */

function toggle(id) {
  const task = tasks.find((x) => x.id === id);
  if (!task) return;
  task.done = !task.done;
  render();
  showToast(task.done ? t('toast.done') : t('toast.undone'));
  void persist();
}

function addTask(label) {
  const text = label.trim();
  if (!text) return;
  // 用时间戳 + 计数器做 id：不要用 label 当 key，也不要用纯 Date.now()
  // （同一毫秒内连加两条会撞）。
  tasks = [
    ...tasks,
    { id: `t${Date.now().toString(36)}${tasks.length}`, label: text, done: false },
  ];
  render();
  showToast(t('toast.added'));
  void persist();
}

async function persist() {
  try {
    await app.storage.set(STORAGE_KEY, tasks);
  } catch (err) {
    // 权限被拒或宿主存储不可用时，界面必须说出来 —— 静默失败会让人以为
    // 已经保存了，下次打开数据却没了。
    showToast(t('toast.storageFailed'));
    console.warn('[design-reference] storage failed:', err && err.message);
  }
}

async function load() {
  el.skeleton.hidden = false;
  el.empty.hidden = true;
  // 骨架屏至少显示 600ms：闪一下的骨架屏比不显示更糟，看起来像故障。
  const started = Date.now();
  let saved = null;
  try {
    saved = await app.storage.get(STORAGE_KEY);
  } catch (err) {
    console.warn('[design-reference] storage read failed:', err && err.message);
  }
  const elapsed = Date.now() - started;
  if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));

  tasks = Array.isArray(saved) && saved.length > 0 ? saved : SEED.slice();
  el.skeleton.hidden = true;
  render();
}

/* --- Toast ----------------------------------------------------------------
 * 反馈浮层的完整生命周期：进入 → 停留 → 退场 → 摘节点。
 * 只做进入不做退场是最常见的半成品动效。
 * -------------------------------------------------------------------- */
let toastTimer = 0;

function showToast(message) {
  const node = document.createElement('div');
  node.className = 'dr-toast';
  node.textContent = message;
  el.toastHost.appendChild(node);

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.dataset.leaving = 'true';
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 240);
  }, 1800);
}

/* --- 绑定 ----------------------------------------------------------------- */

el.add.addEventListener('click', () => {
  addTask(el.input.value);
  el.input.value = '';
  el.input.focus();
});

// 回车提交：单人输入框不响应回车是"网页做派"最明显的一处
el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') el.add.click();
});

el.toast.addEventListener('click', () => {
  const target = tasks.find((x) => !x.done);
  if (target) toggle(target.id);
  else showToast(t('toast.done'));
});

// 演示异步态：骨架 → 内容，让作者亲眼看到两态之间不跳版
el.simulate.addEventListener('click', async () => {
  el.skeleton.hidden = false;
  el.empty.hidden = true;
  el.list.replaceChildren();
  await new Promise((r) => setTimeout(r, 900));
  el.skeleton.hidden = true;
  render();
  showToast(t('toast.loaded'));
});

el.reset.addEventListener('click', () => {
  tasks = SEED.slice();
  selectedId = null;
  render();
  void persist();
});

/* --- 启动 ----------------------------------------------------------------- */

syncAppearance(app.appearanceMode);
syncLocale();
// 不要写成顶层 `await load()`：宿主会把 `<script src="ui.js">` 就地替换成
// 裸的 script 元素（Rust `inline_miniapp_siblings`），**没有** `type="module"`，所以整份文件按 classic script 解析。顶层 await 是
// SyntaxError，会让这里整个行为层一行都不执行 —— 而且只在 console 里留一条
// red console error，界面停在空壳上，看起来像"没数据"。
//
// 同一份文件里任何 `await` 都必须待在一个 async 函数**内部**。
load().catch((e) => {
  // 首屏加载失败同样不能静默：用户看到的是空白，不是一句报错。
  showToast(String((e && e.message) || e));
  el.empty.hidden = false;
});

// 订阅而不是只读一次：外观和语言都会在会话中途变化。
//
// 陷阱：`onAppearanceChange` 的回调收到的是**整个事件对象**
//（`{ type: 'theme.change', appearanceMode: 'light' }`），不是裸的 mode 字符串。
// 直接 `app.onAppearanceChange((mode) => set(mode))` 会把 "[object Object]"
// 写进 color-scheme，滚动条随即变成浅色。宿主在 emit 之前已经先更新了
// `app.appearanceMode`（见 appRuntimeScript 的 applyEnv → emit 顺序），
// 所以**读 getter，不要信 payload 的形状**。同理 onLocaleChange 传的是
// locale 字符串，但统一读 `app.locale` 更稳。
app.onAppearanceChange(() => syncAppearance(app.appearanceMode));
app.onLocaleChange(() => syncLocale());