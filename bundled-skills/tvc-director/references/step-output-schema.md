# tvc-director Step Output Schema

> **唯一权威**：本文件是 tvc-director 10 步输出的 JSON Schema **唯一来源**。orchestrator 与所有 agent 必须严格遵守。
> **版本**：1.0｜**适用范围**：tvc-director v0.3+｜**互链**：被 SKILL.md §16、`references/asset-prompting-cheatsheet.md`、10 个 agent `## Workflow Context` 引用。

## 何时使用本文件

- desktop chat UI renderer 解析 agent 输出时 → 按 `artifact_kind` 路由到对应 widget
- agent 写输出时 → 按本文件对应 `artifact_kind` 的 JSON Schema 输出
- orchestrator 编排时 → 校验 envelope 符合 §0 统一 envelope schema
- verify-tvc-bundle.sh §12 schema 一致性检查时 → 校验每 agent 的 `artifact_kind` 在白名单内

## 设计原则

1. **JSON 唯一权威**：所有 envelope 都是 JSON。YAML 展示只是 prettify（renderer 自动格式化）。
2. **artifact_kind 驱动 widget**：renderer 看到 `artifact_kind: "storyboard_grid"` 就路由到 storyboard-canvas widget，**不需要**额外 widget hint。
3. **Strict schema**：每个 `artifact` 子对象必填字段都需填写；可选项标 `optional`，缺省值用 `null`。
4. **不做双格式**：旧 §12 的 YAML envelope 已废弃；agent 输出 JSON，renderer 负责展示。

---

## §0. 统一 Envelope Schema（所有 11 步共用）

每一步完成时输出**一个** envelope（JSON object）。schema：

```json
{
  "schema_version": "1",
  "envelope_type": "<envelope_type>",        // 详见 §0.1
  "step": 1..10,
  "agent": "<skill_id>",                      // 例如 tvc-agent-brief
  "phase": "<phase_name | null>",             // 多 phase agent 用 phase 名
  "status": "pending_user_confirmation | advanced | skipped | failed",
  "gate": "strong | weak | self_check",
  "produced_at": "<ISO-8601>",
  "artifact_kind": "<artifact_kind>",         // 详见 §1-§10
  "artifact": { /* artifact_kind 决定 schema，详见对应章节 */ },
  "references": [                             // 可选：参考图/音频/数据
    {
      "name": "product-hero.png",
      "type": "image | audio | video | document",
      "source": "local_path | img_remit_ee_url | base64_data_uri",
      "size_bytes": 248000                    // optional
    }
  ],
  "prompts": [                                // 可选：MCP prompt 列表（用于 Pre-Gen Confirmation 复用）
    {
      "label": "storyboard_block_01",
      "text": "故事板图，3行3列...",
      "target_mcp": "agnes_image_generate",
      "call_unit": "block_01"
    }
  ],
  "next_action": {                            // renderer 用此展示底部按钮
    "type": "user_confirm | user_select | user_revise | auto_advance | none",
    "label": "确认生成 / 选择路线 / 修改 / 自动推进 / 无",
    "options": ["retry_same", "revise_prompt", ...]   // optional：失败时的 4 选项
  },
  "blocker": "<string | null>",               // 仅 status=failed 且阻塞编排时填写
  "failure": {                                // 仅 status=failed 时填写
    "code": "<error_code>",
    "message": "<human-readable>",
    "recoverable": true,
    "remediation_hint": "<string>",
    "completed_artifacts": []                 // 此前已成功的 envelope 列表
  },
  "skip_reason": "<string | null>"            // 仅 status=skipped 时填写
}
```

### §0.1 envelope_type 清单

| envelope_type | step | artifact_kind |
|--------------|------|---------------|
| `brief_envelope` | 1 | `brief` |
| `routes_envelope` | 2 | `routes` |
| `shot_plan_envelope` | 3 | `shot_plan` |
| `storyboard_envelope` | 4 | `storyboard_grid` |
| `voiceover_envelope` | 5 | `voiceover_list` |
| `product_action_envelope` | 6 | `product_action_chain` |
| `flavor_envelope` | 7 | `flavor_plan` |
| `packshot_envelope` | 8 | `packshot_module` |
| `video_prompt_envelope` | 9 | `video_prompts` |
| `qc_envelope` | 10 | `qc_report` |

### §0.2 status 取值语义

| status | gate | 含义 | renderer 行为 |
|--------|------|------|-------------|
| `pending_user_confirmation` | strong | 需用户点击才能推进 | 渲染按钮组，禁用 next_action |
| `advanced` | weak / self_check | 自动推进到 next step | 无按钮，自动进入下一步 |
| `skipped` | any | 该步不执行 | 显示 skip_reason，淡化 widget |
| `failed` | any | 编排阻塞 | 渲染 4 选项 grilling (next_action.options) |

---

## §1. `brief` artifact (Step 1 · tvc-agent-brief)

**Widget 变体**: `brief-card`

```json
{
  "product_summary": {
    "name": "Pet Air Purifier",
    "category": "3C",
    "key_features": ["HEPA filter", "whisper-quiet", "auto mode"]
  },
  "audience": {
    "primary": "urban pet owners 25-40",
    "pain_point": "pet hair + odor in small apartments"
  },
  "claims": [
    "removes 99.97% of pet dander",
    "whisper-quiet 22dB sleep mode"
  ],
  "strategy_draft": "30s TVC · belief-led narrative + product demo · focus on relief moment",
  "tvc_axes": {
    "duration_sec": 30,
    "voiceover": true,
    "generation_mode": "九宫格",
    "video_model": "agnes_default",
    "segment_count": 3,
    "pacing": "standard"
  }
}
```

**必填字段**：`product_summary.name`、`product_summary.category`、`audience.primary`、`claims`、`tvc_axes.duration_sec`
**renderer 提示**：brief-card 顶部展示 product_summary + audience；中部 claims 用 chip list；底部 tvc_axes 显示六轴配置确认

---

## §2. `routes` artifact (Step 2 · tvc-agent-strategy)

**Widget 变体**: `routes-comparison`

```json
{
  "routes": [
    {
      "id": "A",
      "name": "Product-led demo",
      "hook": "Hair on the couch, purifier in the corner, close-up on the filter",
      "route_summary": "Commercial craft · functional demonstration · controlled light",
      "duration_sec": 30
    },
    {
      "id": "B",
      "name": "Belief-led manifesto",
      "hook": "Child sleeping, pet curled up, whisper-quiet whoosh",
      "route_summary": "Cinematic narrative · belief-led · emotional escalation",
      "duration_sec": 30,
      "selected": true
    },
    {
      "id": "C",
      "name": "Beat-synced launch",
      "hook": "Beat drop with product slam, motion-to-cut",
      "route_summary": "Commercial craft · rhythmic accents · visual impact beats",
      "duration_sec": 30
    }
  ],
  "recommendation": "B",
  "selection_rationale": "Brief specifies emotional angle; route B aligns with belief-led narration"
}
```

**必填字段**：`routes[3]`、`recommendation`（=某 route.id）
**renderer 提示**：3 个 route 卡横向并列，被选中的有 `selected: true` 标识 + caution amber 边框

---

## §3. `shot_plan` artifact (Step 3 · tvc-agent-shot-planning)

**Widget 变体**: `shot-table`

```json
{
  "scene_anchors": [
    {
      "scene_id": "scene_01",
      "location": "urban apartment living room",
      "time_of_day": "evening",
      "lighting": "warm interior 3200K + practical lamps",
      "mood": "calm, lived-in"
    },
    {
      "scene_id": "scene_02",
      "location": "child bedroom (close-up)",
      "time_of_day": "night",
      "lighting": "moonlight + dim nightlight 4500K",
      "mood": "peaceful, protective"
    }
  ],
  "shot_handoff_table": [
    {
      "shot_id": "s01_01",
      "scene_id": "scene_01",
      "duration_sec": 3.0,
      "framing": "wide",
      "camera": "static establishing",
      "core_action": "child enters, hair visible on couch",
      "color_light": "warm 3200K, soft shadows",
      "mood_keyword": "lived-in",
      "reference_tags": ["product-hero", "scene-with-product"]
    }
  ]
}
```

**必填字段**：`scene_anchors[]`、`shot_handoff_table[]`
**renderer 提示**：左列 scene_anchors，右列 shot_handoff_table 滚动列表；每行高亮 mood_keyword 颜色变化

---

## §4. `storyboard_grid` artifact (Step 4 · tvc-agent-asset-storyboard)

**Widget 变体**: `storyboard-canvas`

```json
{
  "blocks": [
    {
      "block_id": "block_01",
      "range": "0-10s",
      "layout_type": "grid",
      "visual_style_anchor": "tvc-style-cinematic-food",
      "character_setup": "[Character Lock: 28-34 female, East Asian, slim build, shoulder-length black hair, white shirt + dark jeans; face anchor: small mole on left cheek]",
      "vein": "Opens with product micro-rotation, continues with character interaction, closes with emotional peak.",
      "grid_path": "workspace/tvc-pet-airpurifier-0905/storyboard/block-01-grid.png",
      "references": ["product-hero", "scene-kitchen"],  // v0.7：每 block 精挑的 ref 子集，引用 envelope 顶层 references[].name（不重复 base64）
      "panels": [
        {
          "panel_id": "01",
          "time_range": "0.0-1.2s",
          "framing": "ECU",
          "camera": "slow dolly in",
          "core_action": "product spinning micro-rotation",
          "color_light": "studio white 5600K + rim amber",
          "mood_keyword": "premium",
          "shot_type": "extreme-close-up",
          "character_emotion": "focused",
          "sound_effect": "ambient",
          "preview_svg_inline": "<svg>...</svg>"    // optional：renderer 直接渲染
        }
      ]
    },
    {
      "block_id": "block_02",
      "range": "10-20s",
      "layout_type": "action-keyframes",
      "visual_style_anchor": "tvc-style-cinematic-food",
      "character_setup": "[Character Lock: 28-34 female, ...]",
      "vein": "Action climax sequence.",
      "grid_path": "workspace/tvc-pet-airpurifier-0905/storyboard/block-02-grid.png",
      "panels": [
        {
          "panel_id": "01",
          "time_range": "10.0-11.5s",
          "shot_type": "medium",
          "character_emotion": "determined",
          "sound_effect": "whoosh",
          "framing": "character mid-action",
          "camera": "tracking follow",
          "core_action": "character lifts lid",
          "color_light": "warm 3200K",
          "mood_keyword": "climax"
        }
      ]
    }
  ],
  "composite_path": "workspace/.../storyboard-composite.png",
  "manifest_path": "outputs/.../storyboard-manifest.json",
  "lock_path": "outputs/.../images/.lock"
}
```

**必填字段**：
- `blocks[]` — 1+ 个 block
- `blocks[].block_id` — `block_01` / `block_02` / ...（与 cheatsheet §4.4 段数对齐）
- `blocks[].layout_type` ∈ {`grid`, `fixed-camera`, `scene-planning`, `top-down-staging`, `action-keyframes`, `narrative-comic`}（v0.5 新增；6 类枚举）
- `blocks[].visual_style_anchor` — string，引用 `selected_style`（如 `tvc-style-cinematic-food`）
- `blocks[].character_setup` — string；以 `[Character Lock: ...]` 开头或 `none`（无主角场景）
- `blocks[].vein` — string，video vein 一段话，先于 panel 描述
- `blocks[].references[]` — v0.7 新增必填；按 panel 顺序排列的精挑子集，每项是 envelope 顶层 `references[]` 的 `name` 字符串引用（**不**重复 base64）；空数组 `[]` 表示该 block 不消费参考图（纯文字描述）；详见 SKILL §15.7 per-block reference decision
- `blocks[].panels[]` — 每个 panel 必含 4 项 v0.8 键：
  - `shot_type` ∈ {`extreme-wide`, `wide`, `medium`, `medium-close-up`, `close-up`, `extreme-close-up`, `over-the-shoulder`, `top-down`, `dutch-angle`}
  - `character_emotion` ∈ {`calm`, `tense`, `joyful`, `melancholy`, `determined`, `surprised`, `focused`, `anxious`, `exhausted`, `hopeful`, `""`}（product-only 可空字符串）
  - `sound_effect` ∈ {`dialogue`, `ambient`, `music-beat`, `sfx-impact`, `silence`, `vo-over`, `whoosh`, `crunch`, `sizzle`, `heartbeat`, `breath`, `city-noise`}
  - `reference_tags[]` — v0.8 新增必填；panel 级精挑子集，每项是 envelope 顶层 `references[].name` 字符串引用；空数组 `[]` 表示该 panel 不消费参考图；缺省 = 继承 block 级 `references[]`（向后兼容，老 envelope 不破）；详见 SKILL §15.7 panel 级精挑
- `composite_path`

**v0.4 → v0.5 字段迁移**：
- `blocks[].grid` ∈ {`3x3`, `2x2`, `2up`} **已废弃** → 由 `blocks[].layout_type` 取代（`grid` 类型再按 block 时长自适应选 4×3 / 3×3 / 2×2）
- `blocks[].grid_path` 保留（仍指向生成的故事板图）
- 旧字段 `camera` 重命名为 `camera_move`（语义更清晰，与 cheatsheet §4.2 模板对齐）—— v0.5 兼容期同时接受 `camera` / `camera_move`，renderer 优先读 `camera_move`

**renderer 提示**：
- 每个 block 按 `layout_type` 自适应渲染（CSS class 区分）：`layout-grid` / `layout-fixed-camera` / `layout-scene-planning` / `layout-top-down-staging` / `layout-action-keyframes` / `layout-narrative-comic`
- block 顶部 chip：`character_setup` 折叠面板（无主角 block 显示 `none`）
- block 顶部 chip：`visual_style_anchor` + 摄影要点 token（caution amber）
- block 顶部 chip：`references[]` 引用名（如 `product-hero · scene-kitchen`，hover 显示 envelope 顶层 references[] 中对应条目的 base64 preview）；空数组显示 `none`
- 每 panel 显示 3 项标注（`shot_type` / `character_emotion` / `sound_effect`）作为 panel footer
- 每 panel 显示 `reference_tags[]` chip（hover 显示对应 envelope 顶层 references[] 条目 base64 preview）；空数组显示 `inherit: block` 表示继承 block 级 references
- current block 高亮 caution amber 边框

### §4.x Canonical Fixture · 《早高峰冲》 archetype（v0.9 起）

**唯一参考实现**：`bundled-skills/tvc-director/fixtures/storyboard_grid_morning_rush.json`

该 fixture 是 Storyboard step 的 **canonical future-spec**——任何 future agent emit 必须能 diff 过该 fixture 才算合规。覆盖 8 panel 单 block 的 `narrative-comic` layout（30s 单 arc 全叙），所有 v0.8 必填字段填齐，并承载 morning-rush archetype 的两类外延字段：

| morning-rush source 字段 | 映射到 §4 schema | widget 是否渲染 |
|----------------------|---------------|--------------|
| `timecode_or_moment`（07:50 / 08:00 等） | `panels[].time_range` | ✅ time_range chip |
| `shot_size`（特写/近镜/中景/全景） | `panels[].shot_type` | ✅ shot chip |
| `scene_description` | `panels[].core_action` | ⚠️ 仅 schema 落字段；widget 当前**未渲染** |
| `camera_move` | `panels[].camera_move` | ⚠️ 仅 schema 落字段；widget 当前**未渲染** |
| `lighting` | `panels[].color_light` | ⚠️ 仅 schema 落字段；widget 当前**未渲染** |
| `capture_notes`（表演提示） | `panels[].mood_keyword` | ⚠️ 仅 schema 落字段；widget 当前**未渲染** |
| `sound_effect`（per-panel） | `panels[].sound_effect` | ✅ sfx chip |
| `character_emotion` | `panels[].character_emotion` | ✅ emo chip |
| `audio_atmosphere`（global） | `blocks[].audio_atmosphere`（v0.9 提议字段）+ 每 panel `sound_effect` 复读 | ⚠️ block-level 仅 schema；widget 当前**未渲染** audio_atmosphere 字符串 |
| `key_props[]`（global） | `blocks[].key_props[]`（v0.9 提议字段）+ `blocks[].references[]`（v0.7 既有，ref name 以 `prop-` 前缀） | ✅ block-level ref chips |

**v0.9 widget 扩展计划**：storyboardCanvas 增加 panel body 行渲染 `core_action / camera_move / color_light / mood_keyword / framing` 详情（折叠态默认 1 行可展开）；新增 block-level `audio_atmosphere` 顶部 chip。详见 `bundled-skills/tvc-director/fixtures/storyboard_grid_morning_rush.json::_mapping._widget_NOT_yet_rendered_but_in_schema`。

**lint 入口**：
- `scripts/verify-tvc-bundle.sh` §14 — fixture JSON / rendered HTML / smoke test 三件套必须在场，且 rendered HTML 不得比 fixture JSON 老（widget 改了没重渲 → 报错）
- `src/renderer/components/tools/tvcWidgets/storyboard_grid_morning_rush.fixture.test.ts` — 9 断言：valid JSON / valid envelope / 8 panels / 4 v0.8 chip keys / transformer routes correctly / 8 panel ids appear in rendered HTML / block chip + layout label / no hex literal
- `src/renderer/components/tools/tvcWidgets/storyboard_grid_morning_rush.render.test.ts` — 每次跑把 fixture 渲染成 `fixtures/storyboard_grid_morning_rush.rendered.html`（无需起 desktop app 也能 inspect widget 实际输出）

**diff 入口**：future agent 修改 §4 schema 时，先改 `step-output-schema.md` §4 → 再 sync `src/shared/tvcEnvelope.ts` → 跑 fixture smoke test → 任何字段 fail 改 widget 同步。

---

## §5. `voiceover_list` artifact (Step 5 · tvc-agent-voiceover)

**Widget 变体**: `vo-timeline`

```json
{
  "vo_lines": [
    {
      "id": "vo_01",
      "text": "When the city quiets down, what you hear should be only breath.",
      "start_sec": 0.5,
      "end_sec": 4.5,
      "voice_id": "zh-CN-XiaoxiaoNeural",
      "estimated_duration_sec": 4.0
    },
    {
      "id": "vo_02",
      "text": "Pet hair, dander, dust — gone in a whisper.",
      "start_sec": 10.0,
      "end_sec": 14.0,
      "voice_id": "zh-CN-XiaoxiaoNeural",
      "estimated_duration_sec": 4.0
    }
  ],
  "total_duration_sec": 18.0,
  "pacing_valleys_check": "pass"    // pass | warn | fail
}
```

**必填字段**：`vo_lines[]`、`total_duration_sec`、`pacing_valleys_check`
**renderer 提示**：vo-timeline 横向时间轴 + 每行 VO line 在正确位置显示文本；click 触发 edge-tts 预览

---

## §6. `product_action_chain` artifact (Step 6 · tvc-agent-product-action)

**Widget 变体**: `force-chain`

```json
{
  "force_chain": [
    {
      "segment": 1,
      "phase": "initial_structure",
      "state": "product sits on table, lid closed",
      "duration_sec": 1.5
    },
    {
      "segment": 2,
      "phase": "anchor_point",
      "state": "hand reaches for lid, grips edge",
      "duration_sec": 1.0
    },
    {
      "segment": 3,
      "phase": "force_application",
      "state": "lid lifted upward, 45° angle",
      "duration_sec": 2.0
    },
    {
      "segment": 4,
      "phase": "material_feedback",
      "state": "soft click audible, lid fully open",
      "duration_sec": 1.0
    },
    {
      "segment": 5,
      "phase": "end_state",
      "state": "lid rests at 90°, product revealed",
      "duration_sec": 1.5
    }
  ],
  "casting": {
    "lead": { "gender": "female", "age_range": "28-34", "ethnicity": "East Asian", "build": "slim" },
    "supporting": []
  }
}
```

**必填字段**：`force_chain[5]`（exactly 5 segments）、`casting.lead`
**renderer 提示**：5 段 force chain 横向 5 列；casting 用人物卡缩略图 + lock attributes 标签

---

## §7. `flavor_plan` artifact (Step 7 · tvc-agent-food-flavor)

**Widget 变体**: `flavor-layers`

```json
{
  "layers": {
    "visual": [
      "steam rising in slow motion 240fps",
      "macro shot of ingredient cross-section 30mm",
      "color shift from raw ingredient amber to cooked golden"
    ],
    "process": [
      "first-bite crunch sound at 2.3s peak",
      "heat distortion over dish surface",
      "juice/sauce micro-droplets frozen mid-air"
    ],
    "sound": [
      "subtle sizzle throughout",
      "single crisp crack at reveal moment",
      "no music until packshot"
    ]
  }
}
```

**必填字段**：`layers.visual[]`、`layers.process[]`、`layers.sound[]`
**renderer 提示**：3 列（visual / process / sound），每列用 cheatsheet 风格图标 + chip list

---

## §8. `packshot_module` artifact (Step 8 · tvc-agent-packshot)

**Widget 变体**: `packshot-spec`

```json
{
  "hero": {
    "duration_sec": 1.2,
    "framing": "product centered, slight 3/4 angle",
    "motion": "subtle rotation 5° + slow dolly in",
    "transition_to_next": "morph into packshot"
  },
  "packshot": {
    "duration_sec": 4.5,
    "framing": "product front, eye-level",
    "lighting": "controlled 3-point + rim amber",
    "background": "gradient from #1A1A1A to #2A2A2A"
  },
  "endboard": {
    "duration_sec": 2.5,
    "elements": ["logo", "tagline", "cta"],
    "layout": "logo top-center, tagline mid, cta bottom",
    "note": "Logo + tagline + CTA added in post-production, NOT generated by video model"
  }
}
```

**必填字段**：`hero`、`packshot`、`endboard`，`endboard.note` 必含"post-production"提示
**renderer 提示**：3 段（hero/packshot/endboard）横向时间轴，endboard 标注"后期"

---

## §9. `video_prompts` artifact (Step 9 · tvc-agent-video-prompt)

**Widget 变体**: `segment-queue`

```json
{
  "segments": [
    {
      "id": "seg_01",
      "duration_sec": 10,
      "aspect": "16:9",
      "prompt": "镜头从产品正面缓慢推近...（自包含）",
      "first_frame_path": "workspace/.../seg_01_first.png",
      "first_frame_preview": "data:image/png;base64,...",   // optional：短 preview
      "reference_images": [
        { "name": "product-hero.png", "source": "local_path" },
        { "name": "scene_01.png", "source": "local_path" }
      ],
      "expected_outputs": [
        { "duration_sec": 10, "aspect": "16:9", "model": "agnes_default" }
      ]
    }
  ],
  "storyboard_to_clip_mapping": [
    { "panel_ids": ["01", "02", "03"], "segment_id": "seg_01", "time_range": "0-10s" }
  ]
}
```

**必填字段**：`segments[]`、`segments[].prompt`（自包含，零段间引用）、`storyboard_to_clip_mapping[]`

**字段来源（与 `agents/video-prompt.md` v0.5 翻译表双向一致）**：

| 字段 | 来源 |
|------|------|
| `segments[].prompt` 内的全局风格声明 | `artifact.blocks[].visual_style_anchor`（v0.5 视觉锚点，禁止重新从 `selected_style` 推算） |
| `segments[].prompt` 内的人设描述 | `artifact.blocks[].character_setup`（v0.5 人设锚点，直接 copy `[Character Lock: ...]`） |
| `segments[].prompt` 内的 framing / 表演 / 音效 | `artifact.blocks[].panels[].{shot_type, character_emotion, sound_effect}` |
| `segments[].first_frame_path` 首选 | `artifact.blocks[某 block].grid_path`（v0.5 故事板图，与评审稿同源）；不可用退化 `artifact.composite_path` |
| `segments[].reference_images[]` | **v0.8 升级**：按本 segment 覆盖 panel 范围精挑 = 合并 panel 级 `panels[].reference_tags[]`（缺省继承 block 级 `blocks[].references[]`）+ 上游 `all_upstream_decisions` 资源 |
| `storyboard_to_clip_mapping[].panel_ids[]` | `artifact.blocks[某 block].panels[].panel_id` 连续区间 |
| `storyboard_to_clip_mapping[].segment_id` | `model-and-segmentation-routing.md` 拆段结果 |
| `storyboard_to_clip_mapping[].time_range` | `artifact.blocks[某 block].panels[].time_range` 合并（min start → max end） |

**renderer 提示**：segment-queue 列表，每个 segment 卡显示 prompt 折叠预览 + first_frame + 4 选项 + **"storyboard source" 小 chip 区**（`block_id` + 覆盖 `panel_ids[]` + `grid_path` basename + `panel_reference_tags[]` 合并列表，让用户一眼看出"segment ↔ panel ↔ ref"对应关系）

---

## §10. `qc_report` artifact (Step 10 · tvc-agent-qc)

**Widget 变体**: `qc-verdict`

```json
{
  "dimensions": [
    { "name": "brief_fidelity", "score": 9, "evidence": "All claims covered; route B selected per brief" },
    { "name": "tvc_judgment", "score": 8, "evidence": "Pacing appropriate for 30s TVC; no valley >2.5s" },
    { "name": "voiceover_sound", "score": 9, "evidence": "Pacing valley check pass; VO adds unseen info" },
    { "name": "food_flavor", "score": null, "evidence": "skipped: non_food_product" },
    { "name": "casting", "score": 8, "evidence": "Style-aligned; no conflict" },
    { "name": "agnes_execution", "score": 7, "evidence": "Seg 02 needed 1 retry due to soft_words" },
    { "name": "commercial_assets", "score": 9, "evidence": "Packshot + endboard well-defined" },
    { "name": "output_quality", "score": 8, "evidence": "All segments generated; first frames consistent" }
  ],
  "verdict": "pass",
  "remarks": ["seg_02 first frame has minor color shift vs scene anchor; non-blocking"],
  "global_redlines_status": {
    "product_screen_share_gte_70": true,
    "no_three_consecutive_without_product": true,
    "storyboard_final_confirmed": true,
    "no_banned_soft_words": false,
    "product_drives_cause": true,
    "character_setup_consistency": true,
    "visual_style_anchor_consistency": true,
    "panel_id_unique": true
  }
}
```

**必填字段**：`dimensions[8]`（允许 `score: null` 表示跳过）、`verdict` ∈ {`pass`, `pass-with-remarks`, `block`}、`global_redlines_status`
**renderer 提示**：8 个 dimension 横向 8 列 + verdict 大字 + global_redlines 8 项 ✓/✗ chip

**`global_redlines_status` 8 项定义**（v0.8 新增 3 项）：

| Key | Check | 来源 |
|-----|-------|------|
| `product_screen_share_gte_70` | 产品出镜率 ≥ 70% | 老 |
| `no_three_consecutive_without_product` | 连续 3 个 panel 不无产品 | 老 |
| `storyboard_final_confirmed` | `storyboard-final.png` 用户已确认 | 老 |
| `no_banned_soft_words` | prompt 不含 cinematic / 电影感 等违禁词 | 老 |
| `product_drives_cause` | 产品是因果驱动（不是纯气氛）| 老 |
| `character_setup_consistency` | 跨 segment 同主角的 `character_setup` 字面值完全一致（v0.8 自动反漂移校验，详 SKILL §15.8）| v0.8 |
| `visual_style_anchor_consistency` | 跨 segment `visual_style_anchor` 字面值完全一致（v0.8）| v0.8 |
| `panel_id_unique` | 同一 `panel_id` 在 `storyboard_to_clip_mapping[]` 不重复出现（v0.8）| v0.8 |

---

## §11. `script` artifact (Step 0 · tvc-agent-script)

**Widget 变体**: `script-card`

```json
{
  "selected_duration": 30,
  "story_arc": "An ordinary office worker, weighed down by her evening commute, discovers a portable air purifier that transforms her tiny apartment into a clean-air sanctuary — and her posture, breath, and routine follow.",
  "protagonist": {
    "archetype": "Everyday urban professional",
    "hook": "Female, age 28-35, post-work commute, shares a small apartment with a partner"
  },
  "conflict": "City air pollution + cramped indoor space leaves her without a true rest environment at home.",
  "scene_outline": [
    { "scene_id": "s1", "location": "Subway platform, evening", "situation": "Commuter shoulders slump under fluorescent light; close-up on tired eyes.", "duration_seconds": 8 },
    { "scene_id": "s2", "location": "Apartment doorway, evening", "situation": "Hero opens door, places purifier on shelf, presses power.", "duration_seconds": 7 },
    { "scene_id": "s3", "location": "Living room, transformed", "situation": "Air visibly clears; protagonist stretches, exhales, looks out the window with hope.", "duration_seconds": 10 },
    { "scene_id": "s4", "location": "Packshot", "situation": "Product close-up + tagline overlay.", "duration_seconds": 5 }
  ],
  "key_beats": [
    { "beat_id": "kb1", "label": "commute fatigue", "scene_ref": "s1" },
    { "beat_id": "kb2", "label": "product reveal", "scene_ref": "s2" },
    { "beat_id": "kb3", "label": "transformation / emotional peak", "scene_ref": "s3" },
    { "beat_id": "kb4", "label": "call-to-action", "scene_ref": "s4" }
  ],
  "duration_invariant_check": {
    "sum_scene_duration_seconds": 30,
    "selected_duration": 30,
    "drift": 0,
    "passed": true
  }
}
```

**必填字段**：
- `selected_duration` ∈ {`15`, `30`, `45`, `60`, `90`, `120`}（整数，单位秒）
- `story_arc`：1-2 句叙事脊柱，使用 formula `让[受众]在[具体情境]中经历[单一核心冲突]，最终[目标感受]。`
- `protagonist`：必须含 `archetype`（原型）+ `hook`（具体抓手：年龄/职业/场景）
- `conflict`：1 句核心张力
- `scene_outline[]`：至少 2 个 scene，每 scene 必填 `scene_id` / `location` / `situation` / `duration_seconds`；`sum(duration_seconds) == selected_duration`
- `key_beats[]`：3-6 个 beat；product reveal 与 emotional peak 必须分属不同 beat
- `duration_invariant_check`：由 agent 在输出前自动计算，`drift == 0 && passed == true` 才能输出 `status: pending_user_confirmation`

**scene 数随时长比例**：15s → 2 场 / 30s → 3 场 / 45s → 4 场 / 60s → 4-5 场 / 90s → 6 场 / 120s → 7-8 场；每场 ≥5s 且 ≤30s。

**强约束（硬约束，下游 agent 禁止漂移）**：`selected_duration` 是总片长上限 + 下限。任何下游 agent（brief / strategy / shot-planning / video-prompt）若提议偏离，必须先 grilling 用户。

**renderer 提示**：
- Top: 时长 chip（`30s`）+ 状态 chip（pending_user_confirmation）
- Body: story_arc 大字 + protagonist/conflict 两栏
- 折叠区：scene_outline 列表（每行 scene_id + location + 时长 progress bar）+ key_beats timeline
- 底部：duration_invariant_check ✓ 行（自动校验展示）

**校验失败 → failure**：
- `duration_drift`：`sum(duration_seconds) != selected_duration` → `recoverable: true`，agent 自动重 pack scene
- `invalid_duration`：用户给了 6 档之外的时长 → `recoverable: true`，orchestrator 重提问

---

## §12. Widget Routing Table（renderer 用）

| artifact_kind | widget 变体 | 数据形状入口 | renderer 路径 |
|---------------|------------|------------|-------------|
| `script` | script-card | `artifact.{selected_duration,story_arc,scene_outline,key_beats}` | `widgets/ScriptCard.tsx` |
| `brief` | brief-card | `artifact.product_summary` | `widgets/BriefCard.tsx` |
| `routes` | routes-comparison | `artifact.routes` | `widgets/RoutesComparison.tsx` |
| `shot_plan` | shot-table | `artifact.shot_handoff_table` | `widgets/ShotTable.tsx` |
| `storyboard_grid` | storyboard-canvas | `artifact.blocks` | `widgets/StoryboardCanvas.tsx` |
| `voiceover_list` | vo-timeline | `artifact.vo_lines` | `widgets/VOTimeline.tsx` |
| `product_action_chain` | force-chain | `artifact.force_chain` | `widgets/ForceChain.tsx` |
| `flavor_plan` | flavor-layers | `artifact.layers` | `widgets/FlavorLayers.tsx` |
| `packshot_module` | packshot-spec | `artifact.{hero,packshot,endboard}` | `widgets/PackshotSpec.tsx` |
| `video_prompts` | segment-queue | `artifact.segments` | `widgets/SegmentQueue.tsx` |
| `qc_report` | qc-verdict | `artifact.{dimensions,verdict}` | `widgets/QCVerdict.tsx` |

**Shell widget**（所有 artifact_kind 共用）：`SlateboardShell.tsx`（Timeline + Slate body + Actions row），由 cheatsheet 设计语言决定。

---

## §13. 与既有 §12 State Envelope 的关系

- §12 YAML envelope 已**废弃**，由本文件 JSON envelope 取代
- 兼容层：renderer 在解析失败时可 fallback 到 YAML（warn 但不阻断）
- **transition 计划**：v0.3 同时支持 JSON + YAML，v0.4 仅 JSON
- agent-capabilities.json 新增 `artifact_kind` 字段，与 envelope_type 一一对应

## §14. Pre-Gen Confirmation 复用

每个 envelope 的 `prompts[]` 数组是 §14 Pre-Gen Confirmation Gate 的数据源：
- `prompts[].text` = 要展示给用户的完整 prompt
- `prompts[].target_mcp` = 调用目标（`agnes_image_generate` / `agnes_video_generate` / `edge-tts.text_to_speech`）
- `prompts[].call_unit` = cheatsheet §5.2 的 4 选项触发单元
- `prompts[].reference_images` = 参考图列表（与 envelope 顶层 `references[]` 共享 schema）

## §15. 必读互链

- 资产提示词规范：[asset-prompting-cheatsheet.md](asset-prompting-cheatsheet.md)
- 编排规则总览：[../SKILL.md §16](../SKILL.md)
- 失败停机规范：[../SKILL.md §13](../SKILL.md)
- Pre-Gen Confirmation：[../SKILL.md §14](../SKILL.md)