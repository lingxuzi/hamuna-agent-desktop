# MiniApp 设计与生成 Playbook

这份文档管**长什么样**。契约（4 文件、meta.json schema、权限）见 `../SKILL.md`。

核心目标：避免典型的"AI 味"产出——千篇一律的蓝紫渐变 + 圆角卡片 + emoji 图标 + 等权重色块。

---

## 一、生成前必答

动笔前先确认，任何一项含糊就用 AskUserQuestion 问清楚，不要替用户决定：

- **目的与受众**：解决什么具体问题？谁会反复用？
- **形态**：工具型（信息密集、冷静）还是展示型（视觉激进）？
- **运行模式**：纯前端 iframe，还是需要 `kind: "worker"` 走宿主能力？
- **权限边界**：读哪些路径？执行哪些命令？访问哪些域名？（默认全空，按需开）
- **设计锚点**：有没有截图 / 品牌色 / 现成代码？没有就说，会建议参考最贴近的现有应用。
- **持久化**：哪些状态要跨会话保留（写 `storage.json`）。
- **主题适配**：深色 / 浅色下都要能用吗？

---

## 二、找设计上下文（不要从零 mock）

按优先级取：

1. 用户提供的截图 / 品牌资料 / 现成代码
2. **`references/examples/design-reference/`** —— 本 skill 自带的视觉与动效质量基线，**默认先读它**。它的 `style.css` 顶部有设计系统声明，末尾有 `prefers-reduced-motion` 降级，全文只有三个时长和两条缓动曲线。生成任何新 MiniApp 的视觉部分时，把它当模板而不是当参考
3. `bundled-miniapps/` 里形态最接近的现有应用——看它的 `meta.json` / `ui.js` 学**契约**，但**不要学它的 `style.css`**：那 4 个应用加起来没有一个够格的视觉参照（最大的 `file-explorer/style.css` 只有 3.65KB，零动效），照着抄必然产出"AI 味"。它们是功能样例，不是设计样例
4. 宿主注入的 CSS Token（见 §四）

**从零生成是最后选择**——它直接导致千篇一律的"AI 味"。

现有可用参考：

| 参考 | 适合看什么 |
|---|---|
| `references/examples/design-reference/` | **视觉 + 动效 + 质感**（`style.css` 19KB，默认起手读这个） |
| `references/examples/design-reference/source/ui.js` | 行为层：环境订阅、动效编排、退场动画、错误暴露 |
| `bundled-miniapps/hello-miniapp/` | 最小可运行结构 |
| `bundled-miniapps/icon-generator/` | 带 AI 能力的形态、`allowed_models` 写法 |
| `bundled-miniapps/git-graph/` | 需要宿主能力时的 `kind`/`worker_kind` 声明 |
| `bundled-miniapps/file-explorer/` | `fs.read` 路径声明 + 分栏布局 |

---

## 三、先声明设计系统

写第一行实际样式之前，先在 `style.css` 顶部用注释钉死这套"宪法"，并在整份 CSS 里贯彻：

```css
/* === Design System ===
 * Theme: <一句话视觉调性，如 "克制的工具感，深色优先">
 * Palette:
 *   - dominant: var(--hamuna-bg-primary) / var(--hamuna-text-primary)
 *   - supporting: var(--hamuna-bg-elevated), var(--hamuna-border)
 *   - accent: var(--hamuna-accent)   // 只用于关键 CTA / 选中态
 * Typography:
 *   - heading: 600, 18-22px
 *   - body:    400, 13-14px
 *   - caption: 400, 11-12px, var(--hamuna-text-muted)
 * Radius: var(--hamuna-radius-md) (cards) / var(--hamuna-radius-sm) (inputs)
 * Motif: <一种重复的视觉元素，如 "图标统一放在 24×24 圆角容器里">
 * ===================== */
```

> **一个 motif 比十个零散装饰更有价值**——选定后全应用复用，不要每个区块发明新的视觉元素。

### 先定调性：默认工具型，展示型要用户明说

MiniApp 的绝大多数是**工具型**（正则调试 / git 视图 / 计算器 / 番茄钟 / 看板）。
它们的默认调性就三句：

- **信息密度高，操作路径短** —— 一屏之内能做完主流程，不需要滚动才能看到下一步
- **配色冷静** —— 走 `--hamuna-*` 主题，不自建色板
- **反对"营销页式"** —— 大字标题 + 大图 + 渐变 + 居中标题，这类排版放进一个工具里
  会让它看起来像落地页，而不是一个每天要用的东西

**只有用户明确说"对外展示 / 作品集 / 灵感型 / 要发朋友圈"时**，才进展示型调性：
可以放飞视觉，但仍要遵守本文件的其它全部约束（token、动效纪律、hit target、
`prefers-reduced-motion`、一个 motif 贯穿）。放飞的是**视觉表达**，不是工程纪律。

这条要写进 §三 那段 Design System 注释的第一行。判断错调性的代价是隐形的：AI 会
做出一份"正确但平庸"的工具，用户不会说不好看，只是不再用。

### 配色：默认跟主题，要专属色板时从这十套里选

**默认走 `--hamuna-*` 主题色**，那正是它存在的理由。只有用户明确要"专属配色 /
品牌色"时才动这一节，且从下表选一套，不要临时编 —— 临时编出来的色板十套里有
九套会踩到对比度问题。

| 主题感觉 | 主色 | 辅助 | 强调 | 适合 |
|---|---|---|---|---|
| Midnight Executive | `#1E2761` | `#CADCFC` | `#FFFFFF` | 商务 / 报表 |
| Forest & Moss | `#2C5F2D` | `#97BC62` | `#F5F5F5` | 自然 / 笔记 |
| Coral Energy | `#F96167` | `#F9E795` | `#2F3C7E` | 营销 / 活动 |
| Warm Terracotta | `#B85042` | `#E7E8D1` | `#A7BEAE` | 文化 / 阅读 |
| Ocean Gradient | `#065A82` | `#1C7293` | `#21295C` | 监控 / 数据 |
| Charcoal Minimal | `#36454F` | `#F2F2F2` | `#212121` | 工具 / 极简 |
| Teal Trust | `#028090` | `#00A896` | `#02C39A` | 健康 / 教育 |
| Berry & Cream | `#6D2E46` | `#A26769` | `#ECE2D0` | 美食 / 生活 |
| Sage Calm | `#84B59F` | `#69A297` | `#50808E` | 冥想 / 写作 |
| Cherry Bold | `#990011` | `#FCF6F5` | `#2F3C7E` | 警示 / 任务 |

**用法**：主色铺底 / 大面积，辅助色做次级面，强调色**只**给关键 CTA 和选中态 ——
这就是 §五 dominance 规则的落地。强调色用多了就不再是强调。

选完仍然要用 §四 的 `color-mix` 派生淡底和描边，不要拿这四个值直接当背景色刷屏。
浅色外观下这套色板要整体提亮（主色变背景、强调色加深），别把深色值直接搬过去。

---

## 四、CSS Token（唯一正确的名字）

MiniApp iframe 由宿主注入 **36 个 `--hamuna-*` 变量**（清单见 `src/renderer/components/miniapp-host/theme-tokens.ts::TOKEN_VAR_NAMES`，下表即其全集）。**只准用这些**，每个都可以带 fallback：

| 用途 | Token |
|---|---|
| 背景 | `--hamuna-bg-primary` / `--hamuna-bg-elevated` / `--hamuna-bg-inset` / `--hamuna-bg-surface` |
| 文字 | `--hamuna-text-primary` / `--hamuna-text-secondary` / `--hamuna-text-muted` / `--hamuna-text-on-primary` |
| 强调 | `--hamuna-accent` / `--hamuna-accent-text` |
| 边框 | `--hamuna-border` / `--hamuna-border-subtle` / `--hamuna-border-primary` |
| 状态 | `--hamuna-error` / `--hamuna-success` / `--hamuna-warning` / `--hamuna-info` |
| 交互 | `--hamuna-bg-button` / `--hamuna-bg-button-hover` / `--hamuna-bg-input` / `--hamuna-focus-border` |
| 圆角 | `--hamuna-radius-sm` / `--hamuna-radius-md` / `--hamuna-radius-lg` |
| 字体 | `--hamuna-font-sans` / `--hamuna-font-mono` |
| **阴影** | `--hamuna-shadow-xs` / `-sm` / `-md` / `-lg` / `-xl` / `-overlay` |
| **滚动条** | `--hamuna-scrollbar-thumb` |
| **动效时长** | `--hamuna-duration-fast` / `-normal` / `-slow` |

> **后三行是质感的地基，不是可选装饰。** 没有阴影 token 时，加层次的唯一
> 写法就是硬编码 rgba —— 而那正是本文件 §五 要禁的。换主题时它不跟着变，
> 于是每个 MiniApp 的阴影都是从零猜的，观感必然廉价。动效时长同理：各写各的
> `200ms`/`300ms`，一个产品里就没有统一节奏。
>
> 宿主还会注入 `color-scheme`、`background: transparent` 和一整套滚动条样式，
> **不需要你再写**，写了反而会和宿主的打架。

```css
/* 对 */
background: var(--hamuna-bg-primary, #fff);
background: var(--bg-primary); /* disabled-example: 错 —— 这些名字宿主不存在，会静默失效回落浏览器默认值，不要抄 */
```

> **为什么这条这么重要**：`src/renderer/components/miniapp-host/theme-tokens.ts` 曾经猜错过一轮 token 名（用了 `--bg-primary` / `--bg-elevated` / `--border-color`），宿主里一个都不存在，于是每个 `var()` 都静默返回空串，整个 iframe 掉回 fallback 配色。**写错 token 不会有任何报错，只会看起来"没生效"。**

宿主 token 缺失时会回落到 `FALLBACK_TOKENS`（浅色系）。所以 `var()` 一律带 fallback，导出成独立应用也还能看。

### 从 token 派生层次（`color-mix`）

36 个 token 全是**平值**：一个颜色，没有淡底、没有半透明描边、没有彩色阴影。想给
hover 染色、想给选中态加 10% 底色、想让阴影带一点强调色 —— 宿主没提供，而**自己
硬编码 `rgba()` 正是 §五 要禁的**。不给出路，这条规则等于把唯一可用的手段堵死，
结果是每个 MiniApp 都只能做成同一张平卡片网格：合规，但平。

出路是 `color-mix()`：从已有 token 现场派生。纯 CSS，宿主不需要加任何变量。

```css
/* 淡底：强调色的 6% 水洗 */
--wash:     color-mix(in srgb, var(--dr-accent) 6%,  transparent);
/* 描边：40% 强度，够看清又不抢 */
--line:     color-mix(in srgb, var(--dr-accent) 40%, transparent);
/* 彩色辉光：比纯黑阴影有生气 */
--glow:     0 0 0 3px color-mix(in srgb, var(--dr-accent) 22%, transparent);
/* 悬停底：从文字色派生极淡一层，比另找一个灰更贴合当前主题 */
--hover:    color-mix(in srgb, var(--dr-text) 6%, transparent);
/* 发丝分隔线：深色下自动可用，浅色下就浅到看不见 */
--hairline: color-mix(in srgb, var(--dr-text) 10%, transparent);
```

**比例是刻意的**：淡底 ≤ 10%、描边 30–45%、辉光 15–25%、悬停 ≤ 8%。超过就是在往
界面上泼颜色 —— "廉价感"多数出在这里，而不是出在颜色本身选得不好。

派生变量同样只在 `:root` 声明一次、全应用引用别名，与 §七 的动效 token 同一个道理：
**收敛到几个值之后，视觉统一是机械保证，不靠审美。**

### 磨砂深度（`backdrop-filter`）

"这层浮在内容之上"最便宜的信号：

```css
.header {
  background: color-mix(in srgb, var(--dr-bg) 72%, transparent);
  backdrop-filter: blur(12px) saturate(1.4);
  border-bottom: 1px solid var(--dr-line);
}
```

两个必须同时有：只有 `blur` 没有半透明底，前景文字会和后面的内容叠在一起；只有
半透明底没有 `blur`，就是一块灰玻璃。`saturate()` 让透过来的颜色更饱和，磨砂感更实。

> **降级**：`backdrop-filter` 在 WebView2 / Chromium 可用。不满足的运行环境里保留
> 半透明底色即可读性正常 —— 不要因为它把整块背景写死成不透明。

---

## 五、反 AI 味清单（强约束）

下列模式**默认禁用**，除非用户明确要求或上下文严格需要：

| 反模式 | 替代方案 |
|---|---|
| 默认蓝紫渐变 / Aurora 风背景 | `--hamuna-bg-primary` 单色 + 一处微妙强调 |
| Emoji 当主图标 | 1-2 字母的圆形单色容器，或 inline SVG 描边图标 |
| 左侧色条 + 圆角卡片组合 | 整张卡片同色边框；或仅靠留白与字重区分 |
| 标题下加 1px/2px accent 横线 | 用字重 + 字号 + 留白做层级；横线只在 section 分隔时用且全局一致 |
| 硬画复杂插画 SVG | 占位框 + 显式标注 "Image: 256×160, 待提供素材" |
| 字体直接写 `Inter, sans-serif` | `var(--hamuna-font-sans, -apple-system, 'Segoe UI', sans-serif)`，fallback 写完整 |
| 所有色块/字号给同等视觉权重 | dominance：一个颜色占 60-70%，1-2 个 supporting，1 个 accent |
| 正文 < 12px / 点击目标 < 32px | 可点击元素 ≥ 32px；正文 ≥ 13px；caption ≥ 11px |
| 每个 section 一种新卡片样式 | 一个 motif 贯穿；不同区块用相同卡片，靠内容区分 |
| 用大量 stats / 装饰图标填空白 | 留白本身就是设计；空白说明结构该简化，不是被填满 |
| 圆角 4/8/12/16 随心混用 | 钉 1-2 档（`--hamuna-radius-md` / `--hamuna-radius-sm`），全应用统一 |
| 一上来就写 1500 行 ui.js | 早提交早预览；成型后再按功能分模块 |

---

## 六、排版与间距

| 元素 | 字号 | 字重 |
|---|---|---|
| 应用主标题 / 模态标题 | 18-22px | 600 |
| Section 标题 | 14-15px | 600 |
| 正文 | 13-14px | 400 |
| Caption / 辅助 | 11-12px | 400 |
| 等宽（代码 / 数字） | 12-13px | 400, `var(--hamuna-font-mono)` |

- **间距档位**：`4 / 8 / 12 / 16 / 24 / 32`，挑 4 个用，不要全用
- **圆角档位**：`--hamuna-radius-md`（卡片）+ `--hamuna-radius-lg`（浮层）
- **卡片内边距**：紧凑 12px / 标准 16px / 宽松 20px——全应用统一

### CJK 特别注意

中文正文比拉丁字母占宽得多，同样字号下视觉重量更高。正文建议 **14px 起步**（不要照搬 13px 的拉丁排版经验），标题给到 20-24px。中文标点自带左右间距，不要手动加 `letter-spacing`。

---

## 七、动效与质感

> 视觉的"高级感"大半来自动效的**克制与一致**，不是来自效果多。判断标准：把所有动效关掉，界面应该依然成立；打开动效，只是更顺手，不应该更"好看"才值得存在。

### 1. 先声明动效 token，再写动画

不要在每个规则里直接写 `180ms` 和 `cubic-bezier(...)`。先在 `:root` 钉死全套：

```css
:root {
  --dr-dur-fast: 120ms;  /* 悬停、按压、勾选 —— 反馈必须感觉即时 */
  --dr-dur: 180ms;       /* 状态切换、展开收起 */
  --dr-dur-slow: 280ms;  /* 入场、骨架消失 —— 大位移才配长时长 */
  --dr-ease: cubic-bezier(0.2, 0.8, 0.2, 1);      /* 快起慢收，交互响应感强 */
  --dr-ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* 入场：更长的减速尾巴 */
}
```

前缀用你自己的应用缩写（`--gm-` / `--rx-`），避免和别的小应用撞名。

**为什么这是机械保证而不是建议**：全应用只有三个时长和两条曲线之后，动效看起来统一就不是靠审美，是靠所有引用都收敛到这几个值。作者改一个值就等于改全局节奏，不需要逐处调整。

时长分配的判据是**位移距离**：颜色淡入用 fast，位移用 slow。位移越大、时长越短，越显得仓促。

### 2. 四条房规

| 禁止 | 后果 | 正确做法 |
|---|---|---|
| `transition: all` | 会把 `width`/`height`/`top` 一起带上，引发本不该有的重排；大元素上肉眼可见的卡顿 | 永远显式列出属性：`transition: background-color var(--dr-dur-fast) var(--dr-ease)` |
| `scale(0)` | 元素瞬间塌成 0 尺寸，边框消失，动画起点不可见 | 缩放起点用 `.96` / `.94` 这种"几乎没变"的值 |
| 全局 `@keyframes` 裸名 | 同一宿主页里两个小应用重名互相覆盖 | 带应用前缀：`@keyframes dr-enter` |
| 没有降级的 infinite 动画 | 前庭功能障碍用户会实际眩晕；这是无障碍缺陷不是偏好 | 见下条 |

### 3. 动效降级是必选项

前庭功能障碍用户对大面积位移和循环动画会**实际产生眩晕**。集中关一次，不要在每个动画旁边写一遍（新增动画时一定会漏）：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

保留 `color` / `background` / `opacity` 的过渡（不产生位移），还是把 `transition-duration` 也删掉，取决于你对"完全不动的界面"的判断。**加了这段就不算交付**：任何 infinite 动画在降级后都必须停。

### 4. 动效词汇表：什么场景用什么

只有四类，不要发明第五类：

| 类别 | 时长 | 用在哪 | 形态 |
|---|---|---|---|
| **入场** | `--dr-dur-slow` + `--dr-ease-out` | 列表首次渲染、面板展开 | 淡入 + 上移 6px。列表逐条 stagger 24ms，**上限 8 条**——再多后面的还没等完用户已经划走 |
| **反馈** | `--dr-dur-fast` + `--dr-ease` | 勾选、按压、按钮按下 | 缩放脉冲（`.96`）+ 透明度下降。**不要用位移**——位移容易被误读成导航 |
| **加载** | `--dr-dur-slow` | 异步取数 | 骨架屏优于 spinner：它占住最终布局的位置，切换时不跳版，还能暗示内容形状。**骨架至少显示 600ms**，闪一下比不显示更糟，看起来像故障 |
| **氛围** | — | 默认**不做** | 只有当页面过于空旷时才加极淡的径向光晕（透明度 < 10%）。循环漂浮、闪烁、呼吸灯一律不做 |

确认性反馈用 toast/浮层，**完整生命周期是"进入 → 停留 → 退场 → 摘节点"**。只做进入不做退场是最常见的半成品动效。

### 5. 退场：先播完再摘节点

直接 `innerHTML` 重写或 `replaceChildren()` 会把节点连同正在播的动画一起销毁，视觉上就是"闪一下就没了"。正确顺序是打标记 → 等 `animationend` → 再改数据：

```javascript
function removeRow(row, done) {
  row.dataset.exit = 'true';
  row.addEventListener('animationend', () => { row.remove(); done(); }, { once: true });
  // 降级模式下没有 animationend，用定时兜底
  setTimeout(() => { row.remove(); done(); }, 240);
}
```

JS 只负责**编排**（打标记、给索引），时长和曲线仍然在 CSS 里。不要在 JS 里写毫秒数常量。

### 6. 交互质感

- 命中目标 ≥ **32×32**，主操作按钮 ≥ 36px 高——窄侧栏里 24px 的按钮实际很难点中
- 焦点环用 `:focus-visible` 而不是 `:focus`，并且**去掉 outline 后必须自己画回来**。只写 `outline: none` 是键盘用户的事故
- 悬停才出现的控件用 `opacity` + `visibility`，**不要用 `display: none`**——后者会让行宽在 hover 时跳动，列表横向抖一下
- `prefers-reduced-motion` 之外，还要保证信息不只靠颜色传达（完成态除了颜色还有删除线和文字标签）

---

## 八、占位先行 → 早预览

第一次产出**不需要真实数据**：

- 字段用占位文本（"标题占位 / Section A / 12 项"）
- 图片用 `<div class="placeholder">` + 标注期望尺寸
- 图标用 1-2 字母圆形单色占位（不要硬画 SVG 插画）
- 数据写死在 `ui.js` 顶部一个 `const MOCK = {...}`，方便后续换真数据

完成后立即让用户跑一次，收反馈再迭代——拿"给 manager 看第一稿"的姿态，别写完 1500 行才给人看。

---

## 九、视觉 QA Checklist

每次大改后逐条过：

**技术层**

- [ ] 所有颜色/圆角/字体都走 `--hamuna-*` token，没有硬编码
- [ ] 每个 `var()` 都带 fallback
- [ ] 深色 / 浅色两种外观下都读过一遍
- [ ] 文本无溢出、无重叠、无截断（长文本、空列表、超长单词各试一次）
- [ ] 可点击元素 ≥ 32×32
- [ ] 4 个文件契约完整（`meta.json` + `storage.json` + `source/{index.html,ui.js,style.css}`）
- [ ] `meta.json` 通过 `src/shared/miniapp/meta-schema.test.ts` 的守卫
- [ ] 写盘返回的 `version` 是你预期的（见 SKILL.md §已知问题）

**设计层**

- [ ] 有一眼能说清的视觉调性，不是"默认样式"
- [ ] 每页有明确焦点，不是均匀分布的色块
- [ ] 空白有叙事目的（制造焦点/节奏/层级），不是没规划
- [ ] 视觉权重有层级：1 个焦点 > 2-3 个次要 > 背景
- [ ] 同一 motif 贯穿全应用，不是每块一个新花样
- [ ] 换一个人来看，能说出这应用是干什么的
- [ ] 字体统一用 `--hamuna-font-sans`，等宽处统一用 `--hamuna-font-mono`
- [ ] 切换应用、打开第二个 Tab，视觉上仍是一个系统的产品

**动效层**

- [ ] 动效 token 在 `:root` 声明，全应用只有 2-3 个时长和 2 条曲线，没有散落的裸 `180ms`
- [ ] 没有 `transition: all`——每条 `transition` 都显式列了属性
- [ ] 没有 `scale(0)`——缩放起点都在 .9 以上
- [ ] `@keyframes` 全部带应用前缀，无重名
- [ ] 有 `prefers-reduced-motion: reduce` 块，且系统开启"减少动态效果"后动画确实停了
- [ ] 打开系统"减少动态效果"跑一遍：入场不位移、骨架不闪、toast 不飘
- [ ] 骨架屏不会一闪而过（最短 600ms）
- [ ] 删除元素是先播退场再摘节点，不是直接消失
- [ ] 键盘 Tab 走一遍：焦点环在每一站都看得见，没有只写了 `outline: none` 的地方
