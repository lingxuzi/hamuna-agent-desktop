# Design taxonomy

This file is the **single source of truth for the frame state machine**. Every `.pen` frame in the project obeys it; `/design-explore`, `/design-agent`, `/code-agent`, and `/visual-qa` all read and enforce it.

## Three axes — keep them separate

A frame carries three independent pieces of state. Only the first lives in the bracket prefix; folding the others into the bracket is the mistake this taxonomy exists to prevent.

| Axis | Where it lives | Values |
|---|---|---|
| **Lifecycle** | bracket prefix on the frame name | `[draft]` · `[concept]` · `[variant]` · `[anchor]` · `[final]` · `[deprecated]` |
| **Origin** | the enclosing **group's** name | `[explore]` · `[proposal]` · `[mirror]` |
| **Sync state** | the **artifact-index row** (never the frame name) | Synced · Out of sync · Not started · — |

## Lifecycle states

| State | Meaning | Carries sync state? |
|-------|---------|---------------------|
| `[draft]` | Solo work-in-progress — not committed, not competing. A loose sketch, a manual doodle, or vN+1 of an approved frame. | no |
| `[concept]` | A candidate competing in a **direction** decision. Exists only inside an `[explore]` group. | no |
| `[variant]` | A candidate competing in a **composition** decision. Exists only inside a `[proposal]` group. | no |
| `[anchor]` | Terminal, read-only **grounding** — a fixed point you design *against*, never implemented. The winner of a direction decision, or a mirror capture of shipped UI. | no |
| `[final]` | Terminal, **implementable** spec — approved for code. | yes |
| `[deprecated]` | Terminal — superseded or rejected. Kept as history (append-only). | no |

Two pairings make the machine small:

- `[concept]` and `[variant]` are the **same kind of state** — "candidate in a decision set" — differing only in *which* decision the set resolves (direction vs composition).
- `[anchor]` and `[final]` are both **terminal** and both play the **reference role** (below). They differ in one way: only `[final]` is implementable, so only `[final]` carries a sync state.

## The "reference" role — a role, not a state

"Reference" is **not** a lifecycle label. It is a *role*: **a frame read as grounding for new design work.** Two states play it, in three sub-roles:

| Sub-role | Played by | Grounds | Scope |
|---|---|---|---|
| **Direction anchor** | `[anchor]` (from `[explore]`) | how it should *feel* (aesthetic) | broad — one anchor informs many features |
| **Pattern source** | `[final]` (a similar page-type) | how we *compose* this family of page | same page-family, future features |
| **Mirror baseline** | `[anchor]` (from `[mirror]`) | what the *current shipped* UI looks like | 1:1, the same feature being redesigned |

Reference frames inform **proportion, hierarchy, and feel — never content or inventory.** Content always comes from the docs. "Reference → variant" is *grounding*, never *copy-and-rearrange*.

## State diagram

```
ORIGIN (group)   [explore] Intent — date       [proposal] Feature — date     [mirror] Feature — date
                 ┌─────────┐                    ┌─────────┐
SOLO WIP         │ [draft] │                    │ [draft] │
                 └────┬────┘                    └────┬────┘
            formalize │  │ N=1 decide   formalize    │  │ N=1 decide
                      ▼  │                           ▼  │
CANDIDATE        [concept] A/B/C…             [variant] A/B/C…
                      │ direction pick             │ composition pick
                 ┌────┴─────┐                  ┌───┴──────┐
                 ▼          ▼                  ▼          ▼
TERMINAL     [anchor]  [deprecated]        [final]  [deprecated]      [anchor]  (born terminal:
             (winner)   (losers)           (winner)  (losers)          one per shipped state)
                 │                              │
        writes DESIGN-HEURISTICS         sync state attaches
        + "Direction chosen"                  │
                 │                            ▼
                 └──── play the ───────▶ iterate: [final] X → [draft] X v2 → (pick) → [final] X v2
                       REFERENCE role                       (old [final] X → [deprecated], one atomic op)
                       for future [proposal]s

Pivot (/design-explore Mode 5): enumerated [anchor]/[final] frames → [deprecated]  (only re-open path, audit-trailed)
```

Six states: `draft → {concept | variant} → {anchor | final} | deprecated`. Every legal edge is drawn — anything not drawn is illegal. `[final]` is the one **hinge**: the output of one decision that, later, becomes a reference input to the next feature's proposal.

## Invariants (readers enforce, and block on violation)

- **I1** — at most one `[final]` per Artifact Name in the file.
- **I2** — at most one `[anchor]` per Artifact Name in the file.
- **I3** — `[concept]` and `[variant]` exist *only* inside a dated origin group (`[explore]` / `[proposal]`).
- **I4** — terminal states (`[anchor]`, `[final]`, `[deprecated]`) never transition back — **except** `/design-explore` Mode 5 Pivot, which relabels enumerated terminals to `[deprecated]` as an audit-trailed event.

`/design-agent` (Phase 0c), `/code-agent` (when reading the comp), and `/visual-qa` (Phase 0d) each check I1–I3 when they touch the file and **block on violation**. A hand-rename in the editor that breaks an invariant is caught at the next skill invocation, not silently shipped.

## Atomic promotion

Promoting a winner is **one indivisible operation** — never "rename the winner now, clean up the rest later":

1. rename the winner's bracket (`[concept]`→`[anchor]`, or `[variant]`/`[draft]`→`[final]`),
2. rename the losing siblings → `[deprecated]`,
3. rename any prior same-Artifact-Name terminal of the same kind → `[deprecated]` (this is what enforces I1/I2),
4. update every affected artifact-index row.

A decision with a single candidate (N=1) is still a promotion: a solo `[draft]` can be decided directly to `[final]` or `[anchor]`.

## Origin groups

Origin lives in the **group name**; lifecycle lives on the **frame**. Groups are always date-stamped.

| Group | Created by | Holds | Candidate label | Winner label |
|---|---|---|---|---|
| `[explore] Intent — date` | `/design-explore` | concepts for a **direction** decision | `[concept]` | `[anchor]` |
| `[proposal] Feature — date` | `/design-agent` | variants for a **composition** decision | `[variant]` | `[final]` |
| `[mirror] Feature — date` | `/design-agent` mirror mode | faithful captures of shipped UI | — (born terminal) | `[anchor]` |

A `[mirror]` group carries a *captured-on* date — **staleness, not sync, is its failure mode**; a stale mirror → `[deprecated]`.

## Sync states

The sync axis applies **only to `[final]` frames** (the moment a frame becomes implementable spec). All other states show `—` in the index.

| State | Meaning |
|-------|---------|
| Synced | Design and code match |
| Out of sync | One changed without the other |
| Not started | `[final]` exists, code doesn't yet |
| — | Not applicable (`[draft]`/`[concept]`/`[variant]`/`[anchor]`/`[deprecated]`) |

## Frame naming convention

### Format

```
[label] Artifact Name — Letter: Short Description
```

- **`[label]`** — one of the six lifecycle states above.
- **Artifact Name** — stable concept identity (never changes across the lifecycle).
- **Letter** — `A`, `B`, `C`… (only when comparing candidates in a set).
- **Short Description** — the spatial/layout concept (never generic like "option 1").

### Sub-component nesting

Append `> Region > Element`:

```
[final] Hero Section — A: Side-by-side > Headline
[variant] Pricing Page — B: Master-detail > Sidebar > Tab Bar
```

### Rules

1. **Label always leads** — scannable in layer panels, instant lifecycle context.
2. **Label changes, name doesn't** — on promotion/deprecation, rename only the bracket prefix.
3. **Every `[concept]`, `[variant]`, `[anchor]`, or `[final]` frame gets a row in the artifact index** below. `[draft]` is too transient to index; `[deprecated]` keeps its existing row (relabeled in place).
4. **No unnamed frames** — delete the default/empty frame a newly-created `.pen` ships with.
5. **Origin groups are date-stamped** — so you know when the exploration/proposal/capture happened.
6. **Candidates live only inside a dated group** (I3) — a bare `[concept]`/`[variant]` at the canvas root is invalid.

## Artifact index

| Artifact | ID/Frame | Label | Sync state | Notes |
|----------|----------|-------|------------|-------|
| Chat | WUM12 | `[final] Chat — B: 三栏工作台` | Synced | v2 Chat 页面（2026-08-05 晋升）。2026-08-07 从零重建 `be5020b`：re-export v1 Chat（三栏 FileTree/AgentDock + ChatColumn/SplitView + AgentStatusPanel），复用 v1 全部能力，静态布局与 WUM12 稿对齐。SplitViewPanel 用 v1 flow layout 而非稿中 absolute overlay（ratio math 依赖 parentElement width，见 CHAT-IDEAS caveat） |
| Chat | wjhlp | `[deprecated] Chat — B: 三栏工作台（早期版）` | — | 被 fixed 版 WUM12 取代 |
| Chat | Af2bL | `[deprecated] Chat — A: 沉浸式全宽` | — | 落选变体 |
| Launcher | qjQtx | `[final] Launcher — A: 品牌驱动（杂志封面）` | Synced | v2 Launcher 页面（2026-08-05 晋升）。2026-08-07 从零重建 `3f5789c`：杂志封面 hero（衬线品牌字 + 描述 + CTA）、工作区/运行时 chips + QuickInput 工具栏（Plus/权限/工具/定时/模型/发送，SendArrow=lucide Send），整体按 qjQtx 布局，token-clean |
| Launcher | gqlNJ | `[deprecated] Launcher — B: 效率驱动（工作台）` | — | 落选变体；任务直出功能落地时参考 |
| Sidebar/TabBar | u9fa6 | `[final] Sidebar/TabBar — A: 顶部融合（Chrome 风格）` | Synced | v2 全局 chrome 骨架（2026-08-05 晋升）。2026-08-07 从零重建 `78864cb`：`src/render_v2/components/chrome/` 38px 融合条（LogoMark → NavCluster → TabsGroup → WinControls），token-clean，与设计一致 |
| Sidebar/TabBar | zPYXY | `[deprecated] Sidebar/TabBar — B: 侧边导航（Activity Bar）` | — | 落选变体；Activity Bar 全局导航入口落地时参考 |
| Settings | cTjk2 | `[final] Settings — A: 经典设置（侧边导航）` | Synced | v2 Settings 页面（2026-08-05 晋升）。2026-08-07 从零重建 `1149558`：NavSidebar 4 组导航（模型/连接/数据/通用，lucide 图标，per-page `$accent` 活动项高亮）+ PanelHead 衬线页头（Playfair Display 标题 + 描述）+ BentoGrid（外观/启动/队列/工作区 4 tile，`$paper-elevated` 卡片）。静态原型：导航选中项固定在 general，内容区只渲染 general 主页，其余 9 子页真实接线延迟 |
| Settings | s1uU8t | `[deprecated] Settings — B: 标签页设置` | — | 落选变体；搜索设置项与双列卡片流布局落地时参考 |
| Settings | IFfik | `[deprecated] Settings Content — A: 分组工作台` | — | 落选变体（2026-08-05 proposal `gv2Uy`）；SectionTabs + 双列 570px SettingCell 网格，最接近现状 |
| Settings | t2DE7F | `[final] Settings Content — B: Bento 卡片` | Not started | 内容区布局方向（2026-08-05 proposal `gv2Uy` 晋升）；不等尺寸 Bento 瓦片（776/392/584/584w），打破等宽卡片单调；2026-08-05 已铺开落地到 10 处（设计侧）：cTjk2 general 主页内容区（BSMXd 替换为 BentoGrid）+ 9 个子页（shortcuts g9b6R / about uHhSE / providers JW6Ha / mcp KB8c4 / plugins jz3RU / skills ZWkb0 / usage-stats G0RkW / agent e0tbs5 / desktop-pet p4mBrt，全部衬线页头 + ContentPanel + BentoGrid + 真实控件 ref）；代码未开始。2026-08-05 修订：用户指定 providers/mcp/plugins 三页改等宽规则 grid（见 cTjk2 行注），Bento 方向仅在其余 7 页保留。2026-08-05 重建：usage-stats/agent/desktop-pet 三帧（原 dbBZu/pJ97d/w5MeKI）丢失后按代码 1:1 重建为 G0RkW/e0tbs5/p4mBrt |
| Settings | kOMZn | `[deprecated] Settings Content — C: 表格式` | — | 落选变体（2026-08-05 proposal `gv2Uy`）；分组数据表：标签列+spacer+控件列 + 1px 行分隔线，与现状差异最大 |
| Task Center | F6p4ws | `[final] Task Center — A: 思想驱动（40/60）` | Synced | v2 Task Center 页面（2026-08-05 晋升）。2026-08-07 从零重建 `7bc9928`：480w ThoughtPanel（输入 + ThoughtCard 栈 + 派发为任务） + 分隔线 + 任务面板（搜索 pill + 列表/看板 segment + 待办/进行中/已完成三桶）。状态色 todo=--accent-warm / inProgress=--accent-primary / done=--accent-sky。静态原型：数据为样例行，真实 taskStore 接线延迟 |
| Task Center | U0JmA2 | `[deprecated] Task Center — B: 任务驱动（看板）` | — | 落选变体；看板视图模式落地时参考 |
| Space | IlVr6 | `[final] Space — A: 项目管理（Linear 流式 Issue 台）` | Synced | v2 Space 页面（2026-08-05 晋升）。2026-08-07 从零重建 `9f38c31`：256px SpaceSidebar（加入/创建空间 + 空间头 + Issues/Goals/Skills/Settings 四导航 warm-accent 活动态 + 设置 badge + 账号栏）+ Toolbar（搜索/状态分节/目标/与我相关/warm accent 新建 + 刷新）+ 6 行 Issue 流。状态色 todo=--accent-warm / inProgress=--accent-primary / done=--accent-sky，pill 20% 底走 Tailwind `/20` class（inline color-mix 在现构建解析成实色）。静态原型：导航固定 Issues、数据为样例行，真实 Space 数据层延迟 |
| Space | gM5ky | `[deprecated] Space — B: 概览仪表盘（Dashboard）` | — | 落选变体；概览 Dashboard 状态落地时参考 |
| Floating Ball | zQxyc | `[final] Floating Ball — A: 可爱宠物风（桌角小物）` | Not started | v2 Floating Ball 页面（2026-08-05 晋升） |
| Floating Ball | m1tw3e | `[deprecated] Floating Ball — B: 极简助手风（几何浮标）` | — | 落选变体；几何浮标/深色玻璃形态落地时参考 |
| Workspace Config | HivP2 | `[final] Workspace Config — A: 文档编辑器风格（Notion 式）` | Synced | v2 Workspace Config 页面（2026-08-05 晋升）。2026-08-07 从零重建 `1f5cfcd`：全屏 overlay（z-50 盖 Chrome，`/#workspace-config` 直达）+ OverlayHeader（sliders 图标 + 标题 + 通用/系统提示词/简介/技能 tabs，通用 warm active + underline + 关闭钮）+ 基础设置卡（名称/路径）+ 主动 Agent 模式卡（toggle on）+ footer hint。overlay 经独立 useWorkspaceConfigOverlay hook（hash 首段）挂载，不进 tab-view 状态。静态原型：tabs/toggle 固定，Monaco 与真实配置延迟 |
| Workspace Config | tGdcK | `[deprecated] Workspace Config — B: 配置面板风格（卡片列表 + 详情）` | — | 落选变体；卡片列表+详情面板落地时参考 |

## Rules

### When you change code
1. Update the design comp if the change is material (layout, structure, content).
2. Update sync state in the artifact index above (`[final]` rows only).
3. If you skip the design update, mark as "Out of sync".

### When you change design
1. Frame name must follow the naming convention above.
2. Promotion is atomic (rename winner + losers + prior terminal + index rows in one operation).
3. Add or update the artifact index row with the frame ID.
4. Note whether code needs updating; update sync state accordingly (`[final]` only).
5. Never break an invariant (I1–I4) — readers will block on it.
