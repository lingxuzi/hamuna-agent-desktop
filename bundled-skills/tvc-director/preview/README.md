# Slateboard Widget — 设计记录

> TVC Director 在对话区域的渲染 Widget。
> 单文件 HTML + CSS，~5KB，零 JS。

## 视觉隐喻

**场记板 / 拍板**（clapperboard）—— TVC 制作间原生语境，不是 SaaS 模板。

- 顶部对角线条带 = 拍板的黑白条纹（生产现场的可识别符号）
- 10 个 step 格子 = slate cells（每个是一个独立的"镜头"）
- "SLATE 04 · TAKE 01" / "T+00:04:12" = 制作间 timecode 文案

## 调色板（避开 5 个 generic tells）

| Token | Hex | 用途 |
|-------|-----|------|
| `--ink` | #15171A | 主文字、timecode、按钮 |
| `--bone` | #F4F4F1 | 卡片表面 |
| `--slate` | #0C0D0F | 顶部条带、cell SVG、done step |
| `--caution` | #F5A524 | **pending 状态 = 警示胶带琥珀** |
| `--direct` | #3B5BDB | **confirmed = 导演 clap 蓝** |
| `--mute` | #6B6B68 | skipped / dim 文字 |
| `--rec` | #D24545 | failed / 红点 |

**不 cream + terracotta**（避免 Anthropic tell）
**不 dark + neon**
**不 SaaS card kit**（无 border-radius、无 shadow、无 gradient wash）
**不 broadsheet**
**不 template chrome**（无 all-caps eyebrows over 每个标题、无 → 箭头）

## 字体

- **Inter Tight** — Display + UI（grotesque，工作流紧凑友好）
- **JetBrains Mono** — timecode / step 编号 / 文件路径 / 字符计数
- **不**把 mono 用作 decorative eyebrow（避免 generic tell）

## 布局

```
┌─────────────────────────────────────────────────┐
│ ▰▰▰▰▰▰▰▰▰▰ SLATEBOARD · T+00:04:12 REC         │  ← 拍板条纹 header
├─────────────────────────────────────────────────┤
│ [01 brief✓][02 ✓][03 ✓][04 ◉当前][05–10 …]      │  ← 10-step slate cells
├─────────────────────────────────────────────────┤
│ STEP 04 / tvc-agent-asset-storyboard / Phase 2  │
│                                                 │
│ Storyboard grid for product launch · 30s TVC   │
│                                                 │
│ ┌───┬───┬───┐                                   │
│ │01 │02 │03 │  ← 3×3 cell（SVG 极简 composition）│
│ ├───┼───┼───┤                                   │
│ │04 │05 │06 │                                   │
│ ├───┼───┼───┤                                   │
│ │07 │08 │09 │                                   │
│ └───┴───┴───┘                                   │
│                                                 │
│ Prompt · agnes_image_generate                   │
│ ┌─────────────────────────────────────────┐    │
│ │ 故事板图，3行3列共9格...                │    │
│ │ ...                                    │    │
│ └─────────────────────────────────────────┘    │
│                                                 │
│ [P product-hero] [C character] [S scene]       │
├─────────────────────────────────────────────────┤
│ [Confirm generation] [Cancel]   3 blocks · 10s  │
└─────────────────────────────────────────────────┘
```

## 三状态

| 状态 | 视觉变化 | 触发 |
|------|---------|------|
| **pending** | current step = caution amber，prompt 左侧 amber 边框 | 用户未确认 MCP 生成调用 |
| **failed** | current step = rec red，prompt 左侧 red 边框，显示 4 选项 grilling | MCP 调用失败 |
| **confirmed** | current step = direct blue，prompt 左侧 blue 边框，主按钮变 "advancing" | 用户确认后推进 |

## Signature element

**顶部对角线条带**（repeating-linear-gradient `-45deg`，bone 12px / transparent 6px）+ 黑色底——一眼可识别来自制作间而非 SaaS 模板。这是整个 widget 唯一的 bold element，其余皆安静。

## 与既有 cheatsheet 的映射

| Widget 元素 | Cheatsheet / SKILL 章节 |
|------------|----------------------|
| 10-step timeline | SKILL.md §3 workflow table |
| Step 04 / Phase 2 crumb | SKILL.md §12 state envelope |
| 3×3 grid label | SKILL.md §15 Adaptive Storyboard Grid |
| Prompt 文本 | cheatsheet §4.3 Prompt Template |
| References 缩略图 | cheatsheet §1-§3 base64 data URI |
| 4-option grilling | cheatsheet §5.2 + SKILL.md §13 failure_report |

## 精修记录

- v1: 第一版有 REC 红点 pulse 动画 → 移除（唯一 active element 留给 step--current 底部 ink underline + step--done 的 caution 编号色，避免 animation scatter）
- v1: cell SVG 用极简 composition 而非 placeholder 灰色块 → 每格不同构图暗示 storyboard 节奏
- v1: action row 用 `--bone-2` 浅灰底与 body 区隔，不引入新颜色

## 已知 trade-off

- 957 行单文件（含 3 状态完整 HTML）—— 落地到 React 时拆成 3 个子组件（`<SlateboardTimeline>` / `<SlateboardSlate>` / `<SlateboardActions>`），CSS 用 CSS Modules 或 Tailwind plugin
- Mono fallback 在中文 locale 不一定最优；落地时应测 `font-feature-settings: "tnum"`
- Widget 没有 mobile breakpoint —— 落地到 mobile conversation area 时 timeline 改横向滚动 + sticky 当前 step
- 4-option grilling 的默认概率（60/25/10/5）目前 hard-coded，落地时应从 agent-capabilities.json 读取
