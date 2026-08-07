# Task Center: ideas and decisions

## Route chrome
- **Route:** /tab/:id (taskcenter view)
- **Layout:** 双面板 — 左侧思想流 + 右侧任务列表
- **Header variant:** Simplified（搜索 + 筛选 + 视图切换）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 思想流和任务列表的面积比例 | 40/60 | open | direction |
| 2 | 任务视图切换（列表/看板/日历） | 列表 + 看板 | open | variant |
| 3 | 任务详情是 overlay 还是右侧展开 | 右侧 overlay | open | direction |
| 4 | 批量操作的交互模式 | 顶栏批量操作条 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | default | 打开 Task Center | ThoughtPanel + TaskListPanel | — | — | shipped |
| 2 | empty | 无任务/无思想 | 空状态引导 | — | 创建 | shipped |
| 3 | task-detail | 点击任务 | TaskDetailOverlay | — | 关闭 | shipped |
| 4 | editing | 编辑任务 | TaskEditPanel | save/cancel | 保存/取消 | shipped |

## Design variations

### Variation A — "思想驱动"
左侧思想流占据视觉重心，思想卡片可直接拖拽到右侧转化为任务。强调"思考 → 行动"的工作流。

### Variation B — "任务驱动"
任务列表占据主视觉，思想流收窄为侧边栏。强调任务管理和执行，思想流只是辅助输入。

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- `[final] Sidebar/TabBar — A (u9fa6)` — TabBar ref（qbbQI）作为本页顶部 chrome。
- shipped `src/renderer/pages/TaskCenter.tsx` 基线（ThoughtPanel 480px + TaskListPanel 双面板）。

### Variants generated
- **A: 思想驱动（40/60）** — 左 ThoughtPanel 480px 思想卡流（标题+标签+「→ 派发为任务」行动），右 TaskListPanel 959px 三 bucket 分组（待办/进行中/已完成）+ SearchPill + ModeSegment（列表/看板）。落地 decision #1（40/60）+ #4（顶栏批量操作/搜索/视图切换）。与 shipped 双面板基线直接延续。
- **B: 任务驱动（看板）** — 思想流收窄为 300px 侧栏，主区看板三列（待办/进行中/已完成）均分 358px，卡片含状态 dot + 标题 + meta。落地 decision #2（看板视图）。

### 对照结论与选定
- decision #2 明确「列表 + 看板双视图」：A 为主体布局（列表视图），B 为看板视图模式参考。
- **选定：A（思想驱动 40/60）**，frame `F6p4ws` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- **落地时从 B 带过**：看板三列结构（decision #2 的看板视图落地时参考）。
- 落地时需：① 思想卡拖拽→派发交互；② 任务详情右侧 overlay（decision #3）。

## Next steps
1. ~~决定双面板比例和哪个面板为主~~（选定 40/60，思想驱动）
2. ~~任务卡片的信息密度~~（A 已画：dot+标题+meta+状态 badge）
3. 落地实现 `[final] Task Center — A`，随后 /visual-qa
