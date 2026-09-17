# Sidebar / TabBar: ideas and decisions

## Route chrome
- **Route:** 全局组件（所有页面共享）
- **Layout:** 顶部 Tab Bar（Chrome 风格）+ 可选左侧会话边栏
- **Header variant:** Custom title bar（窗口控制 + 更新通知 + 反馈按钮）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Tab Bar 是否集成窗口标题栏 | 是，Custom Title Bar + Tab 一体化 | locked | direction |
| 2 | 会话边栏（左）默认展开还是折叠 | 默认折叠，仅 Chat 视图可用 | locked | direction |
| 3 | Tab 最大数量 | 12 | locked | — |
| 4 | 未读消息指示方式 | Tab 项上的 dot badge | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | single-tab | 只有一个 Tab | Title bar + Tab（占满宽度） | — | 新建 Tab | shipped |
| 2 | multi-tab | 多个 Tab | Title bar + Tab bar + 可拖拽排序 | — | 关闭 Tab | shipped |
| 3 | tab-dragging | 拖拽 Tab 重排 | 拖拽预览 + drop 指示器 | — | 释放 | shipped |
| 4 | update-available | 有更新 | Title bar 更新按钮高亮 | — | 点击/忽略 | shipped |

## Design variations

### Variation A — "Chrome 风格"
顶部 Tab 栏与标题栏融合，紧凑高度（38px），Tab 紧凑排列，窗口控件在右侧。标准、可预期。

### Variation B — "侧边导航"
Tab 栏移到左侧纵向排列（类似 VS Code Activity Bar），图标 + 文字，右侧内容区获得更多垂直空间。

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Chat — WUM12` / `[final] Launcher — qjQtx`（本设计是全部已晋升页面的共享 chrome，需与其 38px 标题栏延续对齐）。

### Variants generated
- **A: 顶部融合（Chrome 风格）** — 38px 单条：品牌 mark + Tab 药丸 + 未读 dot + 新建 Tab + 更新按钮 + 窗口控件。落地 decision #1（标题栏与 Tab 一体化）。垂直空间最省。
- **B: 侧边导航（Activity Bar）** — 顶部条 + 56px 左侧图标条（⌂ 工作台 / ✓ 任务 / ◇ 空间 / ⚙ 设置）+ 底部头像。全局导航驻留，但垂直开销 94px，且与 VS Code 高度相似。

### 对照结论与选定
- A 最贴合桌面原生心智 + 与已晋升 Chat/Launcher 的 38px 标题栏延续一致；B 为全局导航提供了天然驻留入口。
- **选定：A（顶部融合）**，frame `u9fa6` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：顶部条左侧加 4 个图标入口（⌂ ✓ ◇ ⚙），复用 Activity Bar 概念但不另占一条垂直 bar。
- 落地时需正式 icon set（当前字符 glyph 是占位）、确认未读 dot 与窗口控件的交互语义。

## Review — 2026-08-05

逐页 review 轮次修复，全部写入 `u9fa6`：

1. **全局导航图标（决策 #1 补完）** — 落地时从 B 带过的 4 个图标入口（⌂ 工作台 / ✓ 任务 / ◇ 空间 / ⚙ 设置）已加入：`LeftCluster` 内新增 `NavCluster`，26×26 四按钮，位于 Logo 与 TabsGroup 之间（gap 10），活动项「工作台」用 `$accent` 填充、其余 `$ink-muted`。
2. **窗口控件命中区域** — 12×12 glyph 升级为 30×28 命中区（Min 30×28 / Max 30×28 / Close 30×28），glyph 居中，RightCluster 右缘贴齐 1438。
3. **未读 dot 收近** — 距「数据分析」label 右缘 6px → 4px（`GguHR` @ x:71 y:10.5）。

**遗留（留给实现时）**：① Tab 溢出行为未定义（锁定的最大数量 = 12，超限时折叠 / 滚动方案待定）；② 正式 icon set（当前是字符 glyph 占位）。

## Next steps
1. ~~决定标题栏与 Tab 栏是否融合~~（decision #1 已落地：融合）
2. ~~决定会话边栏的默认状态和交互模式~~（A 选定后：会话边栏折叠，仅 Chat 视图可用）
3. 落地实现 `[final] Sidebar/TabBar — A`，随后 /visual-qa
