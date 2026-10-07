/**
 * tweaks.js — 可复用的「外观微调」运行时。
 *
 * 一个 MiniApp 通常被用户打开几十次。用户在第二次打开时才会形成偏好：字太小、
 * 信息太密、动效晃眼 —— 这些都不会出现在第一次的需求描述里。没有一个地方承接
 * 这些偏好，模型就只能照抄用户的第一句话，于是产出「正确但平庸」的东西。
 *
 * 这个模块给的正是那个地方：几个**外观**档位，持久化在 `app.storage`，运行时通过
 * `<html>` 上的 `data-tweak-*` 属性生效，右下角齿轮面板暴露。
 *
 * ## 为什么是 data 属性，不是内联样式
 *
 * 内联样式只能带值：`el.style.setProperty('--x', v)`。于是「档位 A 用 12px、
 * 档位 B 用 14px」这种选择必须由 JS 在每次切换时重写一遍每个用到它的元素 ——
 * 而漏掉一个元素的后果是"一半界面变了、一半没变"，且这种不一致永远不会报错。
 *
 * 写成属性（`data-density="compact"`）之后，CSS 自己负责解释：
 *
 * ```css
 * :root[data-density='compact'] { --row-h: 32px; }
 * ```
 *
 * 一处声明覆盖所有使用点，档位增加不用改 JS，也不会出现漏改。
 *
 * ## 为什么只管「长什么样」
 *
 * 业务偏好（默认视图、排序方式、是否自动刷新）属于主界面，不是外观开关。把两者
 * 混在一个齿轮面板里，用户找不到真正想找的那个设置，作者也会把业务状态藏进
 * 一个语义不明的属性里。**appearance-only 是一条硬边界。**
 *
 * ## 用法
 *
 * ```js
 * mountTweaks({
 *   items: [
 *     { id: 'density', label: { 'zh-CN': '密度', 'en-US': 'Density' },
 *       options: [['comfortable', '宽松'], ['compact', '紧凑']],
 *       default: 'comfortable' },
 *     { id: 'motion', label: { 'zh-CN': '动效', 'en-US': 'Motion' },
 *       options: [['full', '完整'], ['reduced', '减少']],
 *       default: 'full' },
 *   ],
 * });
 * ```
 *
 * 作者的 CSS 只需要写 `[data-density='compact']` 这样的规则，不必调用任何 API。
 */

const STORAGE_KEY = 'tweaks';

/** 面板自身的样式变量在 tweaks.css 里，这里只负责结构与行为。 */
const MAX_ITEMS = 6;

function t(label, locale) {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[locale] || label['zh-CN'] || label['en-US'] || '';
}

/**
 * 把当前档位写到 `<html>` 的 data 属性上。
 *
 * 属性值是**选项 id 的原样字符串**，不是索引：选项增删时索引会错位，而 id 是
 * 作者写死的稳定标识。这也意味着非法值只可能来自被改过的 storage.json，而 CSS
 * 匹配不到非法值 —— 于是它退化成默认档，而不是把界面搞坏。
 */
function apply(state) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(state)) {
    root.dataset[`tweak${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
  }
}

async function readStored() {
  try {
    const raw = await app.storage.get(STORAGE_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    // 存储读失败不是致命错误：外观偏好丢了，用户重新选一次就是。
    return {};
  }
}

async function writeStored(state) {
  try {
    await app.storage.set(STORAGE_KEY, state);
  } catch {
    /* 存不进去也不该打断界面 —— 这一次会话内仍然生效 */
  }
}

/**
 * 造面板，并把需要随语言更新的文案节点收集起来。
 *
 * 语言切换时**只改文案节点**，不重建 DOM：重建会丢掉 `aria-checked` 状态和已经
 * 挂上的事件监听，而这两样都要重新推导出正确值 —— 一份「重建」和一份「更新」
 * 的代码，两条会各自漂移的路。
 */
function buildPanel(items, state, locale, onChange) {
  const panel = document.createElement('div');
  panel.className = 'tw-panel';
  panel.setAttribute('role', 'group');

  const APPEARANCE = { 'zh-CN': '外观', 'en-US': 'Appearance' };
  panel.setAttribute('aria-label', t(APPEARANCE, locale));

  /**
   * locale 变化时逐个刷新的节点。每项自带 `apply`，因为**可见文案和无障碍标签
   * 是两种更新方式**：span 要改 textContent，group 要改 aria-label。按标签名猜
   * （`<button>` 改文本、其余改 aria-label）会在 span 上悄悄只改 aria-label ——
   * 界面上文字不变，无障碍树里变了，两边从此不一致。
   */
  const texts = [{ node: panel, label: APPEARANCE, apply: (n, s) => n.setAttribute('aria-label', s) }];

  for (const item of items) {
    const field = document.createElement('div');
    field.className = 'tw-field';

    const label = document.createElement('span');
    label.className = 'tw-label';
    label.textContent = t(item.label, locale);
    field.appendChild(label);
    texts.push({ node: label, label: item.label, apply: (n, s) => { n.textContent = s; } });

    const group = document.createElement('div');
    group.className = 'tw-options';
    group.setAttribute('role', 'radiogroup');
    texts.push({ node: group, label: item.label, apply: (n, s) => n.setAttribute('aria-label', s) });

    for (const [value, optionLabel] of item.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tw-option';
      btn.setAttribute('role', 'radio');
      btn.dataset.value = value;
      btn.textContent = t(optionLabel, locale);
      btn.addEventListener('click', () => onChange(item.id, value));
      texts.push({ node: btn, label: optionLabel, apply: (n, s) => { n.textContent = s; } });
      group.appendChild(btn);
    }

    field.appendChild(group);
    panel.appendChild(field);
  }

  // 初始的 aria-checked 在这里补一次：建节点时还没设，选中态要由状态推出来。
  for (const item of items) {
    for (const btn of panel.querySelectorAll('.tw-option')) {
      if (btn.dataset.value === state[item.id]) btn.setAttribute('aria-checked', 'true');
    }
  }

  return { panel, texts };
}

function buildToggle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tw-toggle';
  btn.setAttribute('aria-expanded', 'false');
  // 用文字而不是齿轮 emoji：emoji 当主图标是 playbook 明令禁用的反模式，而且
  // 这里要跨平台都能读懂。
  btn.textContent = '⋯';
  btn.title = 'Appearance';
  return btn;
}

/**
 * 挂载面板。返回 `{ set, close }`，作者想程序化改档位时用得上。
 */
export function mountTweaks(config) {
  const items = (config.items ?? []).slice(0, MAX_ITEMS);
  if (items.length === 0) return { set: async () => {}, close() {} };

  const host = config.container ?? document.body;
  let locale = app.locale ?? 'zh-CN';
  // 先用默认值上色：读取 storage 是异步的，而界面不能等它。
  let state = {};
  for (const item of items) state[item.id] = item.default;

const toggle = buildToggle();
  const { panel, texts } = buildPanel(items, state, locale, onPick);
  panel.hidden = true;
  host.appendChild(toggle);
  host.appendChild(panel);

  apply(state);

  async function onPick(id, value) {
    state = { ...state, [id]: value };
    apply(state);
    // 同步整个面板里的 aria-checked：只有一个 radio 处于选中，其余必须让位。
    for (const btn of panel.querySelectorAll('.tw-option')) {
      btn.setAttribute('aria-checked', String(btn.dataset.value === value));
    }
    await writeStored(state);
  }

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  // 点面板外面收起。键盘用户用 Esc，不靠点击。
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || toggle.contains(e.target)) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  app.onLocaleChange((next) => {
    locale = next;
    // 文案变了，档位没变 —— 不碰 data 属性，只刷文字。
    for (const { node, label, apply } of texts) apply(node, t(label, locale));
  });

  // 读回持久化档位。首屏已经用默认值画好了，所以这一步只是「对齐」，不会闪。
  readStored().then((stored) => {
    for (const item of items) {
      const saved = stored[item.id];
      if (item.options.some(([v]) => v === saved)) onPick(item.id, saved);
    }
  });

  return {
    set: (id, value) => onPick(id, value),
    close() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    },
  };
}