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
| --- | --- | --- | --- | --- |
| Employees Panel — A: 等宽 2 列基线 (variant) | grid `pNMYQ` (Employees 2-Col Grid, vertical, gap 12) containing rows `ZSzS9` (Row 1) / `d93aNZ` (Row 2) / `z0xZAS` (Row 3), each row holding 2 employee cards (C3GJU / BUEZJ / ohVZe / c2hIk / p3gh9 / oDt6d) | `[variant]` | — | 6 employee cards in 3 rows × 2 cols (2-col grid baseline). Card width 432 height 168. Cards: 数据分析师 / Code Reviewer / 客服助理 / 市场研究员 / 内容审核 / Bug Triage. Sits inside `aFwrx` (Page Main) which lives inside `SuXMF` (1152×812). |
| Conflict Banner — C: amber + RESOLVE badge (variant) | `Ka4yC` | `[variant]` | — | 576×117 conflict banner, top-level frame. Children: RESOLVE badge, shield icon, title meta (Claude Code fields conflict with project config), 3 fields differ subtitle, three action buttons (Use Claude Code / Use Project / Manual Merge). Reusable as drawer-top banner overlay. |
| Wizard Step Indicator — C: inline 段标题 (variant) | `h6z2EP` | `[variant]` | — | 720×600 wizard modal, top-level frame. Header: step caption (STEP 2/6 — 技能) + H1 title (新建员工) + close. Form area: 姓名 / 岗位 / 描述 / 图标 fields with inputs + textareas. Footer: 上一步 (paper-inset) + 下一步 → (accent-warm) right-aligned per V1 §7.5. |
| Space Page Chrome (mirror baseline, served as proposal reference) | `M2bo3` group containing `FELre` (Space Sidebar w-256) + `aFwrx` (Page Main, fill_container) | `[anchor]` (mirror role only — born from shipped `src/renderer/pages/space/SpaceChrome.tsx`) | — | Lives in dedicated `[mirror] Space Chrome — 2026-08-10` top-level frame (1152×1100). V1 chrome fidelity: left sidebar (logo + 加入空间 / 创建空间 buttons + active space row) + right main (page header + grid). Now correctly housed in `[mirror]` group per taxonomy invariant I3. |
| Employees Panel — A1: Empty state | `ER4t5` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with centered hero (Bot iconBox 72px + 还没有数字员工 h2 + helper subtitle) + 3 onboarding cards (克隆内置模板 / 从 Claude Code 导入 / 全新创建) in horizontal row. V1 §7.6 empty-state + 7.1 card. |
| Employees Panel — A2: Loading skeleton | `Y4eEA` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with title row skeleton + 2×3 grid of paper-inset rect cards (opacity 0.6) representing shimmer placeholders. No text. Matches V1 card geometry. |
| Employees Panel — A3: Success grid | `SuXMF` (updated) | `[variant]` | — | 1152×1100 top-level frame. Background gradient + paper grid. Sidebar (mirror) + Main with title row (Bot icon + 智能体员工 h2 + count chip 6 + search + filter chips [全部][Sub][WS][Cloud] + grid/list toggle + refresh + 新建员工 CTA) + 2×3 grid of 6 employee cards (height 264, 4 AgentCardField rows each: 本机 / 工作区 / 指令 / 订阅). Card width 432. BUEZJ has conflict dot (AHHZE ellipse). |
| Employees Panel — A4: Success list view | `EnkV8` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with title row (List toggle active + 新建员工 CTA) + table header (员工 / 岗位 / 来源 / Provider Model / 最后活跃 / 状态) + 3 rows (数据分析师, Code Reviewer, 客服助理) with avatar+name, role text, source pill (Sub/WS), provider mono, time muted, status dot. |
| Employees Panel — A5: Search no-result | `MWKLk` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with title row (search input showing "dataX") + empty-state card centered (search-x iconBox 56px + 没有匹配「dataX」的员工 h2 + helper + 3 action buttons: 清空筛选 / 克隆内置模板 / + 创建新员工 accent-warm). V1 §7.6 empty-state. |
| Employees Panel — A11: Offline state | `iEfZk` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with warning banner top (alert-triangle icon + 网络异常,显示缓存数据 · 只读模式 + 重试 button, warning border) + ghost grid below (opacity 0.6, paper-inset cards with avatar + name rect placeholders, no text). V1 §5 disabled-card treatment. |
| Employees Panel — A12: Role-cloud section | `qIe2h` | `[variant]` | — | 1152×812 top-level frame. Sidebar + Main with title row + 云端员工 collapse header (chevron-down + count chip 2 + 已订阅 pill accent-sky) + 2 cloud employee cards (GPT Researcher, DevOps Pilot with cloud iconBox accent-sky + description) + divider line + 本机员工 header + 2×2 local grid of paper-elevated cards. |
| Employee Detail Drawer (B0–B6: 7 stacked sections) | `su2WC` | `[variant]` | — | 580×1300 top-level frame. Sticky header (avatar 56 + 数据分析师 name + role meta + 在线 pill + ×). 7 vertical sections separated by line-subtle borders (NOT tabs per EMPLOYEE-IDEAS.md:22): B0 基础 (姓名/岗位/工作范围/Provider Model), B1 技能 (Skills + MCP), B2 工作流 (Goal + cron), B3 知识库 (Tantivy + 索引 stat), B4 记忆 (auto + 长程演化 + scope), B5 可观测 (status + 日志 tail), B6 频道 (IM list with banner "频道为 IM 集成,非 StaffDeck 渠道分发"). |

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
