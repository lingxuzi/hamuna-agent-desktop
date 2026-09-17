# Component specs

## Shared atoms

| Atom | Purpose | Spec | Rationale |
|------|---------|------|-----------|
| TabItem | Chrome 风格标签页 | text-sm, surface-secondary bg, 36px height | 多会话入口，视觉层级低于当前内容 |
| ActionButton | 工具栏操作按钮 | 28px, rounded-md, icon + optional label | 紧凑工具栏，不抢视觉焦点 |
| StatusBadge | 状态指示器 | 8-12px dot/badge, intent colors | 一眼可辨状态 |
| PermissionCard | 内联权限请求卡片 | surface-secondary bg, 3 action buttons | 工具调用时的即时决策 |
| ToolHeader | 工具调用头部 | collapsible, icon + name + status | 工具过程透明可追溯 |

## Component tree: Chat Page

<!-- Chat 页面是项目最复杂的组件，包含以下主要区域 -->
```
Chat
├── ChatHeader (session controls, runtime selector, context usage)
├── SplitView
│   ├── MessageList
│   │   ├── Message (repeated)
│   │   │   ├── RoleBadge (user/assistant/system)
│   │   │   ├── Markdown content
│   │   │   ├── ToolUse (collapsible)
│   │   │   │   └── ToolRenderer (Bash/Read/Write/Edit/Grep/...)
│   │   │   ├── ToolAttachmentGallery
│   │   │   ├── PermissionPrompt
│   │   │   └── AskUserQuestionPrompt
│   │   └── StreamingIndicator
│   ├── DirectoryPanel (optional, left sidebar)
│   └── AgentStatusPanel (optional, right sidebar)
├── ChatInput
│   ├── AttachmentPreviewList
│   ├── MentionTabButton
│   ├── SlashCommandMenu (popover)
│   └── ThoughtPickerRow
└── StatusBar (goal, cron task, runtime diagnostics)
```

## Component tree: Launcher Page

```
Launcher
├── BrandSection (hero area)
│   ├── Logo + tagline
│   └── SimpleChatInput (with context row)
└── LauncherRightRail
    ├── WorkspaceCard (repeated)
    ├── AddWorkspaceMenu
    └── TemplateLibraryDialog
```

## Component tree: Settings Page

```
Settings
├── SettingsSidebar (11 sections)
│   ├── General
│   ├── Shortcuts
│   ├── Providers
│   ├── MCP
│   ├── Skills
│   ├── Sub-agents
│   ├── Plugins
│   ├── Agent
│   ├── Usage Stats
│   ├── Desktop Pet
│   └── About
└── SettingsContent (section-specific panels)
```

## Component tree: Task Center Page

```
TaskCenter
├── ThoughtPanel (left)
│   ├── ThoughtInput
│   ├── ThoughtCard (repeated)
│   └── ThoughtBulkBar
└── TaskListPanel (right)
    ├── SearchPill + filters
    ├── TaskCardItem / TaskListRow (repeated)
    └── TaskEditPanel / TaskDetailOverlay
```

## Component tree: Space Page

```
Space
├── SpaceLogin (auth gate)
├── SpaceSidebar
│   ├── Issues
│   ├── Goals
│   ├── Skills
│   └── Settings
└── SpaceContent
    ├── IssuesWorkspace / GoalsWorkspace / SkillsWorkspace / SpaceSettingsWorkspace
    └── CreateIssueDialog / IssueDetailDrawer
```

## Component tree: Floating Ball System

```
FloatingBall (3 separate Tauri windows)
├── BallWindow (fb-ball)
│   └── PetSprite (animated, 92x92)
├── CompanionWindow (fb-companion)
│   ├── MessageList
│   ├── Markdown
│   └── ChatComposer
└── ShieldWindow (fb-shield, invisible click-through)
```
