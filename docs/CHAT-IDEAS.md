# Chat: ideas and decisions

## Route chrome
- **Route:** /tab/:id (chat view)
- **Layout:** Custom — 三区布局（可选左侧文件树 + 主消息流 + 可选右侧 Agent 状态面板）
- **Header variant:** Chat header（session controls, runtime selector, context usage ring, split-view toggle）
- **Footer variant:** None — ChatInput 在消息流底部 sticky
- **Target layout strategy:** inherit (desktop-only)

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | 主布局模式：消息流是否全宽，还是默认带侧边栏？ | 消息流全宽，侧边栏按需展开 | open | direction |
| 2 | ChatInput 位置：底部 sticky 还是浮动？ | 底部 sticky | open | direction |
| 3 | 工具调用展示：内联展开还是折叠摘要？ | 默认折叠，点击展开 | open | direction |
| 4 | 拆分视图（浏览器/终端）的布局策略 | 右侧 50/50 分屏 | open | variant |

## Page states

| # | State | Trigger | Renders | Dispatches | Exit | Status |
|---|-------|---------|---------|------------|------|--------|
| 1 | empty-chat | 新 Tab，无消息 | IntroductionOverlay + SimpleChatInput | — | 发送首条消息 | shipped |
| 2 | streaming | AI 回复中 | MessageList + StreamingIndicator + 实时工具调用 | — | 流完成 | shipped |
| 3 | idle | 对话暂停 | MessageList + SimpleChatInput | — | 发送新消息 | shipped |
| 4 | tool-calling | 工具执行中 | ToolUse (展开) + PermissionPrompt | canUseTool | 完成/拒绝 | shipped |
| 5 | split-browser | 用户打开浏览器面板 | MessageList + BrowserPanel | — | 关闭面板 | shipped |
| 6 | split-terminal | 用户打开终端面板 | MessageList + TerminalPanel | — | 关闭面板 | shipped |
| 7 | error | Sidecar 崩溃/超时 | ErrorBanner + retry CTA | restart | 重连成功 | shipped |

## Design variations

### Variation A — "沉浸式全宽"
消息流占据全部水平空间，ChatInput 贴底。无默认侧边栏，所有辅助功能（文件树、Agent 状态、搜索）通过右上角按钮触发 overlay 或抽屉。最大化内容阅读面积，适合长对话。

### Variation B — "三栏工作台"
左侧固定文件树面板（可折叠），中间消息流，右侧 Agent 状态面板（可折叠）。类似 IDE 布局，多面板同时可见。适合重度使用场景（文件操作频繁、多 Agent 协作）。

## Grid / layout system (if applicable)
桌面端，无列系统。三栏布局使用 flex + 固定/弹性宽度。

## API response shape

<!-- SDK 消息流结构（非 REST API） -->
消息通过 SSE 推送，类型包括：`assistant`、`tool_use`、`tool_result`、`user`、`system`。每条消息带 `session_id`、`timestamp`、`content` 数组。工具调用结果可含 `attachments: ToolAttachment[]`。

## Parser implementation

<!-- 无需 parser，直接消费 SDKMessage 类型 -->

## Direction chosen — 2026-08-05

**方向**: Glass Workshop × Paper Terminal（详见 `docs/DESIGN-HEURISTICS.md`）
**传统**: Scandinavian Design + Editorial Magazine + Japanese Ma + Dieter Rams
**签名张力**: Terminal 数据密度 × 纸张阅读舒适度

**Chat 页面方向指引**:
- 消息流像"纸张上的终端输出"——AI 回复用等宽字体，暖墨色，微妙行间线
- 工具调用卡片像"折页"——折叠时是紧凑摘要，展开时露出完整输出
- 面板（文件树、Agent 状态）用毛玻璃 + 暖色半透明
- 权限提示像"需要签阅的文件"——温暖但需要明确决策
- 空状态像"一张空白的工作台等你开始"

## Design rationale — 2026-08-05

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: clear (4-6), COLOR_ECONOMY: restrained (3-4), GRID_DENSITY: sparse (1-3), PERSONALITY: warm

### Reference frame
- 无既有 `[final]` 参考帧（本页首轮设计）。镜像基线 = 当前 shipped `src/renderer/pages/Chat.tsx` 的功能面。

### 功能 1:1 基线（从 Chat.tsx 盘点）

v2 设计 MUST 覆盖当前页面全部功能，不丢不增：

| 区域 | 当前功能清单 |
|------|-------------|
| 顶部 Header | 返回键、项目名+图标、Session 标题（点击重命名）、Surface tags（channel/cron/floating-ball pill）、Session ⋯ 菜单（重命名/收藏/导出/统计/绑定 Bot/删除）、新建会话、历史下拉、Workspace 展开、Dev-only Logs |
| 消息流 | MessageList（虚拟滚动、流式、权限 prompt、AskUserQuestion、ExitPlanMode、Rewind/Fork/Retry、systemNotice、Introduction overlay、CronTaskCard 内联卡） |
| 输入区 | SimpleChatInput 浮动输入：附件、图片、@提及、/命令、SDK slash、provider/模型选择、reasoning effort、权限模式、工具开关（official tools / MCP / plugins）、上下文用量 ring、cron/goal 定时任务、外部 runtime 切换、队列消息、AgentStatusPanel slot |
| 错误/状态 | agentError banner（重试/诊断/rewind）、TerminalReasonBanner、RuntimeDiagnosticsBanner、ChatBootOverlay、UnifiedLogsPanel、QueryNavigator、ChatSearchPanel（Cmd+F）、SelectionCommentMenu（选中引用/追问） |
| 工作区面板 | DirectoryPanel：文件树、provider 切换、agent/skills/commands、右键、文件预览、终端、浏览器 |
| Split View | 可拖拽分隔条、文件/终端/浏览器三 tab 切换、各自 × 关闭 |

### Variants generated
- **A: 沉浸式全宽** — 单列消息流全宽，无默认侧栏；辅助功能走右上角按钮触发的 overlay/抽屉。功能覆盖：Header 全件、消息流全状态、浮动输入全工具栏、错误/状态全部 banner；工作区以 overlay 形式保留。功能缺口：**Split View（文件/终端/浏览器）未体现**——作为全宽设计的抽屉/覆盖层扩展补足。
- **B: 三栏工作台** — 左侧文件树（可折叠）+ 中间消息流 + 右侧 Agent 状态面板（可折叠）。功能覆盖：A 的全部 + 常驻工作区 + 常驻 Agent 状态。功能行为变化：当前 AgentStatusPanel 是**按需懒加载**（仅 TodoWrite/Task 触发时出现，外部 Runtime 下不出现），B 将其改为**常驻面板**——功能面是超集，但行为从"按需"变"常驻"，需用户确认。

> **选定：2026-08-05 — 用户确认 B（三栏工作台）**，frame `WUM12` 晋升 `[final]`，早期 B 版与 A 变体 `[deprecated]`（详见 `DESIGN-TAXONOMY.md` artifact-index）。落地时需保留 AgentStatusPanel 按需懒加载语义：常驻紧凑摘要条 + 展开全量面板。

### 对照结论
- A 保功能 1:1 最稳妥：不改任何行为，只换视觉。
- B 功能是超集（Agent 状态从隐藏变常驻），行为有变化，但重度工作台用户收益大。
- 两变体都需在落地时补：Split View 的抽屉态、ChatSearchPanel 的 overlay 态。

## Known caveats / follow-ups

落地（`src/render_v2/`，commit `ecc4101`）时记录的已知不完整处，供后续 agent 冷启动不重复推导：

- **Split view 布局与 WUM12 设计稿不同**（v2 `ChatV2.tsx` 已用 flow layout，非 absolute overlay）。原因：`useChatControllerV2` 的 `handleSplitDividerMouseDown` 用 `e.currentTarget.parentElement.getBoundingClientRect().width` 计算 ratio，divider 的父级**必须是宽度缩放的左列**；WUM12 的 absolute overlay（`SplitViewPanel` 绝对定位 640w）会破坏 ratio math。workaround：沿用 v1 flow layout（left col width% + divider + flex-1 right panel）。unblock：若设计稿想改成 overlay，需先改 ratio 计算依赖（改成 window/container 级宽度）。
- **编排缺口（controller return 未暴露的 v1 handlers）**：`handleRetry`（ChatV2 用 `agentErrorBannerProps.onRetry()` optional 兜底）、`setBrowserUrl`/`setBrowserSourceFile`、`handlePermissionDecision`（v1 返回 boolean|void，view 传的是 `(id, decision) => boolean | void`，hook 返回类型是 `void | Promise<void>`）、`handleQuoteFile`/`handleQuoteSelection`（v2 phase boundary：quote-file 复用 `handleInsertReference`）。workaround：当前 view 已按暴露面接线；缺口项在需要时从 `useChatControllerV2` return 补齐。
- **AgentStatusPanel 右栏渲染依赖 containerRef 废弃**：`SubagentSection` 的 `containerRef` 已废弃（`void _containerRef` 前向兼容，`onJumpToTool` 内部用 Virtuoso ref）→ 右栏 260px 列渲染安全。若后续需要 scroll-to-top 语义，需重建 containerRef。
- **AgentDock 是 v2-only 设计元素**：左侧栏底部常驻紧凑摘要（AgentStatusPanel 在活动结束时会卸载，dock 提供持久"忙碌度"读数）。数据源自 `useAgentStatusState(tabState.messages, agentPlanTodos, sessionId)` + `contextUsage`。这是 Pencil WUM12 在 v1 基础上的新增，非功能缺口。
- **disposition 两阶段归置**：`useChatLaunchV2` 同步 flip（`buildChatFlipPatch`，D1 非空 sessionId）+ 异步 `ensureSessionSidecar().isNew` resolve（#300/#301：仅基于 isNew 决定 push/adopt，绝不用 pre-ensure probe 预测）。`pending-<tabId>` 占位 session 由 `TabProvider` 内部 ensure+create，通过 `onSessionIdChange` 回写真实 id → v2 tab patch。若改动这段，先读 `tech_docs/session_architecture.md`「Sidebar 配置归置」。
- **i18n 复数 key**：`v2.chat.agentDockBusy` 用 `{{count}}`——react-i18next 复数 resolution 需要 `_other` suffix 兜底（当前 5 个 key 未加）。若 `agentDockBusy` 出现复数解析异常，补 `agentDockBusy_other`。
