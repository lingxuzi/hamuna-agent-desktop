# Space: ideas and decisions

## Route chrome
- **Route:** /tab/:id (space view)
- **Layout:** Sidebar + Content（左侧 Space 导航 + 右侧工作区）
- **Header variant:** SpaceChrome（Space 名称 + 成员头像 + 快速操作）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 4 个子视图（Issues/Goals/Skills/Settings）是否用统一布局框架 | 是，SpaceChrome 统一包裹 | locked | — |
| 2 | Issue 列表布局 | 卡片列表 + 状态筛选 | open | direction |
| 3 | 是否需要 Space 级别的搜索 | 待定 | open | variant |
| 4 | Agent 注册的交互入口 | Skills 视图内的注册按钮 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | login | 未登录/无 Space | SpaceLogin | auth | 登录成功 | shipped |
| 2 | issues | 默认视图 | IssuesWorkspace + IssueDetailDrawer | — | 切换视图 | shipped |
| 3 | goals | 切换到 Goals | GoalsWorkspace | — | 切换视图 | shipped |
| 4 | skills | 切换到 Skills | SkillsWorkspace + skill file tree | — | 切换视图 | shipped |
| 5 | settings | 切换到 Settings | SpaceSettingsWorkspace | — | 切换视图 | shipped |

## Design variations

### Variation A — "项目管理风格"
类似 Linear/Notion 的 Issue 管理界面，左侧导航 + 看板/列表切换，紧凑信息密度。

### Variation B — "Dashboard 风格"
首页展示 Space 概览（Issue 统计、Goal 进度、活跃 Skill），然后深入各子视图。

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Sidebar/TabBar — A (u9fa6)` — 38px 融合 ChromeBar 沿用为顶部 chrome；`[final] Launcher — qjQtx` 的暖调托盘语言延续。
- shipped Space 基线（SpaceSidebar 256px + Issues toolbar + Issue 流 + Goals/Skills/Settings 子视图 + AccountBar）。

### Variants generated
- **A: 项目管理（Linear 流式 Issue 台）** — 256px Space Sidebar（空间头「Hamuna 社区」+ 四导航 + 账号栏）+ Toolbar（搜索 / 状态分节 / 目标选择 / 与我相关 / 新建 / 刷新）+ 6 行 Issue 流（状态 pill 三色语义：todo 沙色 / doing 赤陶 / done 苔藓绿）。落地 decision #1（SpaceChrome 统一包裹）+ decision #2（卡片列表 + 状态筛选）+ decision #3（Space 级搜索）。
- **B: 概览仪表盘（Dashboard）** — PageHead 问候「早上好，林墨」+ IssueOverview 统计（进行中问题 6 / 进度条 / 4 行摘要）+ 右列三卡（Goals 进度 / Skills 最近发布 / Members 在线）。为 open「Space 首页是否有概览 Dashboard」提供选项。

### 对照结论与选定
- decision #2 明确「卡片列表 + 状态筛选」：A 直接落地为 Issues 主视图；B 的 Dashboard 会把日常驱动面（Issue 流）埋深一层，作为主构成不合适。
- **选定：A（项目管理）**，frame `IlVr6` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：① Dashboard 构成（问候头 + 统计 + 右列卡）作为 Space「概览」home 状态参考——Issues 为默认视图，概览由显式入口进入，两态共享同一 SpaceChrome；② 目标 / 技能进度条样式。
- 落地时需：① 正式 icon set（当前字符 glyph 是占位）；② Issue 详情右侧 Drawer（shipped 基线已有，本轮未画）。

## Next steps
1. ~~决定 Space 首页是否有概览 Dashboard~~（A 选定：Issues 为默认视图，Dashboard 作为可选的概览状态参考，落地时从 B 带过）
2. ~~Issue 卡片的信息层级~~（A 已画：pill + 标题 + meta / 目标 / 负责人）
3. 落地实现 `[final] Space — A`，随后 /visual-qa
