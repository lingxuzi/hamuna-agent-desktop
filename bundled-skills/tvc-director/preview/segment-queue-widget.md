# Segment Queue Widget — 设计记录

> TVC Director 在对话区域的渲染 Widget（Step 9 tvc-agent-video-prompt）。
> 单文件 HTML + CSS，~23KB（含 3 状态完整 HTML + chip 套件 + 4-option grilling），零 JS。

## 视觉隐喻

**TAKE SHEET / 拍摄日报**（call sheet）—— 拍摄现场原生语境，不是 SaaS 模板。

- 顶部对角线条带 = 与 slateboard 同源（slate 拍板 + call sheet 同属制作间语汇，跨 widget 视觉连续）
- 5 个 take 卡片 = scene 内的 take 队列（每个 segment = 一次 take）
- "TAKE SHEET · ROLL 04 · STEP 09" = 拍摄日报的台头格式
- "SEG 03 / PENDING / 20-30s / block_03 · 9 panels" = take card 的台账字段

## 调色板（与 slateboard 完全共享）

| Token | Hex | 用途 |
|-------|-----|------|
| `--ink` | #15171A | 主文字、timecode、按钮 |
| `--bone` | #F4F4F1 | 卡片表面 |
| `--slate` | #0C0D0F | 顶部条带 |
| `--caution` | #F5A524 | **pending 状态 = 警示胶带琥珀** |
| `--direct` | #3B5BDB | **confirmed = 导演 clap 蓝 / v0.5 anchor accent** |
| `--rec` | #D24545 | **failed = 红点** |
| `--mute` | #6B6B68 | queued / skipped / dim 文字 |
| `--direct-2` | #D9E0F8 | confirmed 卡片底色（直接蓝浅版）|

**不 cream + terracotta**（避免 Anthropic tell）
**不 dark + neon**
**不 SaaS card kit**（无 border-radius、无 shadow、无 gradient wash）
**不 broadsheet**
**不 template chrome**（无 all-caps eyebrows over 每个标题、无 → 箭头）

## 字体

- **Inter Tight** — Display + UI（与 slateboard 一致）
- **JetBrains Mono** — timecode / take 编号 / chip 字符 / segment ID / 文件路径

## 布局

```
┌─────────────────────────────────────────────────┐
│ ▰▰▰▰▰▰▰▰▰▰ TAKE SHEET · ROLL 04 · STEP 09  REC   │  ← 拍摄日报台头（与 slateboard 同款条纹）
├─────────────────────────────────────────────────┤
│ [SEG01✓][SEG02✓][SEG03◉当前][SEG04…][SEG05…]   │  ← 5 take cards（segments 队列）
├─────────────────────────────────────────────────┤
│ SEG 03 / tvc-agent-video-prompt / Step 9         │
│                                                 │
│ Segment prompt for block_03 · panels 19-27      │
│ 30s 咖啡机 TVC · seg_03 覆盖 block_03 panels    │
│                                                 │
│ [block_id: block_03] [panel_ids: 19...27]       │  ← v0.6 chips
│ [grid_path: outputs/.../block-03-grid.png]      │
│                                                 │
│ ┌─ Visual Style Anchor ─────────────────────┐   │  ← v0.5 翻译表第 1 行
│ │ [Visual Style: tvc-style-cinematic-food] │   │     直接蓝左 border
│ └──────────────────────────────────────────┘   │
│ ┌─ Character Lock ──────────────────────────┐   │  ← v0.5 翻译表第 2 行
│ │ [Character Lock: 28-34 female, East ...] │   │     琥珀左 border
│ └──────────────────────────────────────────┘   │
│                                                 │
│ ┌──── prompt preview (mono, 深底) ────────┐    │
│ │ [Visual Style: ...]                     │    │
│ │ [Character Lock: ...]                   │    │
│ │ 20-30s · seg_03 · 9 panels ...         │    │
│ │ ░░░░░ fade ░░░░░                        │    │
│ └─────────────────────────────────────────┘    │
│                                                 │
│ REFERENCE IMAGES · panel 级精挑 v0.8           │
│ ▪product-hero[p21] ▪character-barista[p19...]  │  ← v0.8 panel 级精挑 chips
│ ▪scene-kitchen[p19 p23 p27]                    │
├─────────────────────────────────────────────────┤
│ [Confirm all 5 segments] [Cancel]  · 50s total │
└─────────────────────────────────────────────────┘
```

## v0.6 + v0.8 字段消费展示

| 元素 | 消费字段 | 来源 |
|------|---------|------|
| chips (block_id / panel_ids / grid_path) | v0.6 Step 4→9 handoff contract 7 字段中 3 个 | `references/step-output-schema.md` §4 |
| Visual Style Anchor 块 | v0.5 `blocks[].visual_style_anchor`（原文 copy）| `asset-storyboard.md` |
| Character Lock 块 | v0.5 `blocks[].character_setup`（原文 copy）| 同上 |
| prompt preview | v0.5 三段式 + per-panel `shot_type/character_emotion/sound_effect` | `cheatsheet §4.1` |
| reference_images chips | v0.8 `panels[].reference_tags[]` 精挑合并 | `video-prompt.md` Reference Images |
| panel_ids[] in chip | v0.6 `storyboard_to_clip_mapping[].panel_ids` | `video-prompt.md` storyboard_to_clip_mapping |

**chip 的 panel_id 标注**（`p21` / `p19 p22 p25`）让用户在确认时一眼看出"这个 ref 来自哪个 panel"，便于拒绝与 v0.5 panel 漂移的图源。

## 三状态

| 状态 | 视觉变化 | 触发 |
|------|---------|------|
| **pending** | current take = caution amber + 底部 ink underline；其他 take done / queued | Pre-Gen Confirmation gate 等用户确认 |
| **failed** | current take = rec red + 底部 red underline；显示 4 选项 grilling | MCP `agnes_video_generate` 调用失败 |
| **confirmed** | 所有 take = done（ink fill）+ body 顶部蓝色 "all 5 segments confirmed" 横条 | 用户点 Confirm all 推进到 Step 10 |

## Signature element

**与 slateboard 共用的顶部对角线条带**（repeating-linear-gradient `-45deg`）—— 跨 widget 的视觉锚点，提示这是同源 Skill 的不同环节。这是整个 widget 唯一的 bold element，其余皆安静。

**新增 signature**：v0.5 anchor 块的左 border 颜色对比（Visual Style = 直接蓝 / Character Lock = 琥珀）—— 让用户 0.5 秒区分两个 v0.5 翻译表的关键行。

## 与既有 cheatsheet 的映射

| Widget 元素 | Cheatsheet / SKILL 章节 |
|------------|----------------------|
| 5-take queue | `video-prompt.md` segment prompts（每个 segment = 一次 take） |
| block_id / panel_ids / grid_path chips | `video-prompt.md` Inputs + `step-output-schema §9` |
| Visual Style Anchor 块 | `asset-storyboard.md` Visual Style Anchor + `cheatsheet §4.1` 三段式 |
| Character Lock 块 | `asset-storyboard.md` Character Setup Pinning |
| prompt preview | `video-prompt.md` v0.5 翻译表 6 锚点 |
| reference_images chips | `video-prompt.md` Reference Images 来源（v0.8 panel 级精挑） |
| 4-option grilling | `cheatsheet §5.2` |

## 精修记录

- v0.1: 第一版用 6 类 layout 缩略图占位 → 移除（与 slateboard 重复，且 video-prompt 不消费 layout_type）
- v0.1: take card cover 区只放 block_id → 改放 "block_id · 9 panels" 双字段（panel 数让用户预知 segment 体量）
- v0.1: prompt preview 用浅底 → 改深 slate 底 + JetBrains Mono（与"code editor / terminal"语汇对齐，符合 production-room 工作流）
- v0.1: reference_images 用纯文字列表 → 加彩色 ref__dot（product=direct / character=caution / scene=ink，与 cheatsheet §4.3 三色隐喻一致）

## 已知 trade-off

- 23KB 单文件（含 3 状态完整 HTML）—— 落地到 React 时拆成 4 个子组件（`<TakeQueue>` / `<TakeBody>` / `<TakeActions>` / `<TakeGrilling>`），CSS 用 CSS Modules 或 Tailwind plugin
- Mono fallback 在中文 locale 不一定最优；落地时应测 `font-feature-settings: "tnum"`
- 5 take 假设 ≤5 segments；超 5 segment 落地时 take-queue 改横向滚动 + sticky 当前 take
- 4-option grilling 的默认概率（60/25/10/5）目前 hard-coded，落地时应从 agent-capabilities.json 读取
- Widget 没有 mobile breakpoint —— 落地到 mobile conversation area 时 take-queue 改横向滚动 + body 折叠 sections
- take card 状态 = done / pending / failed / queued / confirmed；落地到 React 时建议用 enum + className 映射表（避免 5 个散落 className 字面量）