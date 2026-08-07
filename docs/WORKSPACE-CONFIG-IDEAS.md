# Workspace Config: ideas and decisions

## Route chrome
- **Route:** Overlay（从 Chat 或 Launcher 弹出）
- **Layout:** 全屏覆盖 + 左侧标签导航 + 右侧内容
- **Header variant:** Overlay header（关闭按钮 + 工作区名称）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 5 个标签（general/system-prompts/introduction/skills/agent）的导航形式 | 左侧垂直标签 | open | direction |
| 2 | 系统提示词编辑器 | Monaco Editor | locked | — |
| 3 | 技能/Agent 列表的展示模式 | 卡片列表 + 详情面板 | open | direction |
| 4 | 是否需要实时预览系统提示词效果 | 待定 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | general | 默认标签 | WorkspaceGeneralTab | — | 切换标签 | shipped |
| 2 | system-prompts | 切换标签 | SystemPromptsPanel (Monaco) | — | 切换标签 | shipped |
| 3 | introduction | 切换标签 | IntroductionPanel (Monaco) | — | 切换标签 | shipped |
| 4 | skills | 切换标签 | SkillsCommandsList + SkillDetailPanel | — | 切换标签 | shipped |
| 5 | agent | 切换标签 | WorkspaceAgentsList + AgentDetailPanel | — | 切换标签 | shipped |

## Design variations

### Variation A — "文档编辑器风格"
类似 Notion 的编辑体验，Markdown 原生渲染，所见即所得。系统提示词和介绍页用统一的编辑器。

### Variation B — "配置面板风格"
传统表单布局，字段明确，选项用下拉/开关。技术感强，适合精确配置。

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Sidebar/TabBar — A (u9fa6)` — 融合 ChromeBar 与顶部 chrome 语言；`[final] Launcher — qjQtx` 的暖象牙托盘与苔藓绿 accent 延续。
- shipped Workspace Config 基线（5 标签导航 + Monaco 编辑器 + 技能/Agent 列表）。

### Variants generated
- **A: 文档编辑器风格（Notion 式）** — Overlay 全屏覆盖 + 左侧 220px 五项垂直标签导航（general/system-prompts/introduction/skills/agent）+ 系统提示词页构成：Monaco 编辑器卡（`system-prompt.md` + Markdown 语法高亮 + 行号列）+ 右侧实时预览面板（`{{workspace_path}}` 等变量提示 + 保存栏）。落地 decision #1（左侧垂直标签）+ #2（Monaco Editor）+ #4（实时预览）。
- **B: 配置面板风格（卡片列表 + 详情）** — 左侧标签导航（skills tab 激活）+ 技能卡片列表（每周周报 / 桌面清理 / 会议提醒）+ 右侧详情面板（名称 / 命令 / 作用范围 / 启用 Toggle / 文件树）。落地 decision #3（卡片列表 + 详情面板）。

### 对照结论与选定
- decision #2「Monaco Editor」为 locked：A 直接落地文档编辑体验，与锁定决策契合；B 的表单面板会绕过编辑器。
- decision #1「左侧垂直标签」：A 用 220px 垂直导航承载 5 标签（页面少、无需折叠）；B 同用左侧标签但主区做列表-详情分栏。
- **选定：A（文档编辑器）**，frame `HivP2` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：① 技能/Agent 卡片列表 + 详情面板构成（decision #3 落地时用）；② 技能启用/停用 Toggle；③ 技能文件树浏览。
- 落地时需：① 正式 icon set（当前字符 glyph 是占位）；② 实时预览的 Markdown 渲染管线；③ Monaco 编辑器与 token 主题桥接。

## Next steps
1. ~~决定编辑器风格（所见即所得 vs 原始 Markdown）~~（Monaco locked，A 落地为文档编辑器 + 实时预览）
2. ~~技能/Agent 卡片的信息密度~~（B 已画卡片 + 详情面板，落地时参考）
3. 落地实现 `[final] Workspace Config — A`，随后 /visual-qa
