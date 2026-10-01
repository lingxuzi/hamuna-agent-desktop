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
2. **`bundled-miniapps/` 里最贴近形态的现有应用**——直接读它的 `meta.json`、`index.html`、`style.css`、`ui.js`，识别它的视觉语言（间距、圆角、卡片密度、配色）。这是本项目最权威的范例来源
3. 宿主注入的 CSS Token（见 §四）

**从零生成是最后选择**——它直接导致千篇一律的"AI 味"。

现有可用参考：

| 应用 | 形态 | 适合参考什么 |
|---|---|---|
| `bundled-miniapps/hello-miniapp/` | iframe，最小骨架 | 最小可运行结构 |
| `bundled-miniapps/icon-generator/` | iframe + `skills` + `ai` 权限 | 带 AI 能力的形态、`allowed_models` 写法 |
| `bundled-miniapps/git-graph/` | worker，`git-graph` kind | 需要宿主能力时的 `kind`/`worker_kind` 声明 |
| `bundled-miniapps/file-explorer/` | worker，`file-explorer` kind | `fs.read` 路径声明 + 分栏布局 |

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

---

## 四、CSS Token（唯一正确的名字）

MiniApp iframe 由宿主注入 **24 个 `--hamuna-*` 变量**。**只准用这些**，每个都可以带 fallback：

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

```css
/* 对 */
background: var(--hamuna-bg-primary, #fff);
background: var(--bg-primary); /* disabled-example: 错 —— 这些名字宿主不存在，会静默失效回落浏览器默认值，不要抄 */
```

> **为什么这条这么重要**：`src/renderer/components/miniapp-host/theme-tokens.ts` 曾经猜错过一轮 token 名（用了 `--bg-primary` / `--bg-elevated` / `--border-color`），宿主里一个都不存在，于是每个 `var()` 都静默返回空串，整个 iframe 掉回 fallback 配色。**写错 token 不会有任何报错，只会看起来"没生效"。**

宿主 token 缺失时会回落到 `FALLBACK_TOKENS`（浅色系）。所以 `var()` 一律带 fallback，导出成独立应用也还能看。

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

## 七、占位先行 → 早预览

第一次产出**不需要真实数据**：

- 字段用占位文本（"标题占位 / Section A / 12 项"）
- 图片用 `<div class="placeholder">` + 标注期望尺寸
- 图标用 1-2 字母圆形单色占位（不要硬画 SVG 插画）
- 数据写死在 `ui.js` 顶部一个 `const MOCK = {...}`，方便后续换真数据

完成后立即让用户跑一次，收反馈再迭代——拿"给 manager 看第一稿"的姿态，别写完 1500 行才给人看。

---

## 八、视觉 QA Checklist

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
