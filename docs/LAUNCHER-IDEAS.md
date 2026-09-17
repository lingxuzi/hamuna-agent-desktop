# Launcher: ideas and decisions

## Route chrome
- **Route:** / (default view, always first tab)
- **Layout:** Custom — 左侧品牌区（60%）+ 右侧工作区列表（40%）
- **Header variant:** Tab bar（无额外 header）
- **Footer variant:** None
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 品牌区和工作区列表的面积比例 | 60/40 | open | direction |
| 2 | 品牌区是否需要 hero 动画/插画 | 待定 | open | direction |
| 3 | 快捷输入框的功能范围 | 支持附件、定时任务、@mention | open | variant |
| 4 | 最近会话/任务入口的位置 | 右侧 rail 顶部 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | default | 打开应用 | BrandSection + LauncherRightRail | — | 点击工作区/发送消息 | shipped |
| 2 | no-workspace | 首次使用，无工作区 | 品牌区 + 空状态引导 | — | 创建工作区 | shipped |
| 3 | task-center-overlay | 点击历史会话 | TaskCenterOverlay 覆盖 | — | 关闭 overlay | shipped |

## Design variations

### Variation A — "品牌驱动"
左侧大面积品牌展示 + 居中聊天输入框，右侧紧凑工作区卡片列表。强调"开始对话"的第一行动。

### Variation B — "效率驱动"
减少品牌面积，扩大工作区和最近会话的可见性。输入框在顶部，下方是最近会话/任务的网格。

## Direction chosen — 2026-08-05

**方向**: Glass Workshop × Paper Terminal（详见 `docs/DESIGN-HEURISTICS.md`）

**Launcher 方向指引**:
- 品牌区像"杂志封面"——衬线大标题 + 呼吸感留白，邀请用户开始
- 工作区卡片像"半透明描图纸卡片叠放"——毛玻璃 + 微妙阴影
- 快捷输入框像"干净的工作台面上唯一的输入区"——温暖、清晰、不花哨

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- 无既有 `[final]` 参考帧（本页首轮设计）。镜像基线 = 当前 shipped Launcher 功能面（品牌区 + 工作区列表 + 快捷输入 + 历史会话→TaskCenterOverlay）。

### Variants generated
- **A: 品牌驱动（杂志封面）** — 60/40 非对称（decision #1 已锁定）；左侧衬线 hero + 唯一主行动快捷输入，右侧描图纸式叠放工作区卡 + 最近会话行。方向指引「杂志封面 / 描图纸卡片 / 干净台面」的完整落地。
- **B: 效率驱动（工作台）** — 顶部条（logo + 全宽输入 + ＋新建会话）+ 最近会话列表 + 任务卡网格。延续性密度最优，任务首屏直出。

### 对照结论与选定
- 活跃 taste 设置（distinctive / sparse / warm）整体倾向 A；A 的方向贴合与唯一性显著高于 B。
- B 的三卡任务网格踩「three equal cards」AI 指纹（同质任务语义可辩护，但读感偏模板）。
- **选定：A（品牌驱动）**，frame `qjQtx` 晋升 `[final]`，B `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。
- 落地时需从 B 带过的能力：① 任务/Task Center 首屏可见性（A 靠历史会话触发 overlay，可考虑加一个显式任务入口）；② no-workspace 空状态（本轮两变体均未绘制，落地时补）。

## Next steps
1. ~~运行 `/design-agent 'design Launcher'` 生成具体设计变体~~（已完成，A 晋升 `[final]`）
2. 落地实现 `[final] Launcher — A`，随后 /visual-qa
