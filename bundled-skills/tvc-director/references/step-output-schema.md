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

## §0. 统一 Envelope Schema（所有 10 步共用）

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
      "grid": "3x3",
      "grid_path": "workspace/tvc-pet-airpurifier-0905/storyboard/block-01-grid.png",
      "panels": [
        {
          "panel_id": "01",
          "time_range": "0.0-1.2s",
          "framing": "ECU",
          "camera": "slow dolly in",
          "core_action": "product spinning micro-rotation",
          "color_light": "studio white 5600K + rim amber",
          "mood_keyword": "premium",
          "preview_svg_inline": "<svg>...</svg>"    // optional：renderer 直接渲染
        }
      ]
    }
  ],
  "composite_path": "workspace/.../storyboard-composite.png",
  "manifest_path": "outputs/.../storyboard-manifest.json",
  "lock_path": "outputs/.../images/.lock"
}
```

**必填字段**：`blocks[]`、`blocks[].grid` ∈ {`3x3`, `2x2`, `2up`}、`composite_path`
**renderer 提示**：每个 block 自适应渲染对应 grid；current block 高亮 caution amber 边框

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
**renderer 提示**：segment-queue 列表，每个 segment 卡显示 prompt 折叠预览 + first_frame + 4 选项

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
    "product_drives_cause": true
  }
}
```

**必填字段**：`dimensions[8]`（允许 `score: null` 表示跳过）、`verdict` ∈ {`pass`, `pass-with-remarks`, `block`}、`global_redlines_status`
**renderer 提示**：8 个 dimension 横向 8 列 + verdict 大字 + global_redlines 5 项 ✓/✗ chip

---

## §11. Widget Routing Table（renderer 用）

| artifact_kind | widget 变体 | 数据形状入口 | renderer 路径 |
|---------------|------------|------------|-------------|
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

## §12. 与既有 §12 State Envelope 的关系

- §12 YAML envelope 已**废弃**，由本文件 JSON envelope 取代
- 兼容层：renderer 在解析失败时可 fallback 到 YAML（warn 但不阻断）
- **transition 计划**：v0.3 同时支持 JSON + YAML，v0.4 仅 JSON
- agent-capabilities.json 新增 `artifact_kind` 字段，与 envelope_type 一一对应

## §13. Pre-Gen Confirmation 复用

每个 envelope 的 `prompts[]` 数组是 §14 Pre-Gen Confirmation Gate 的数据源：
- `prompts[].text` = 要展示给用户的完整 prompt
- `prompts[].target_mcp` = 调用目标（`agnes_image_generate` / `agnes_video_generate` / `edge-tts.text_to_speech`）
- `prompts[].call_unit` = cheatsheet §5.2 的 4 选项触发单元
- `prompts[].reference_images` = 参考图列表（与 envelope 顶层 `references[]` 共享 schema）

## §14. 必读互链

- 资产提示词规范：[asset-prompting-cheatsheet.md](asset-prompting-cheatsheet.md)
- 编排规则总览：[../SKILL.md §16](../SKILL.md)
- 失败停机规范：[../SKILL.md §13](../SKILL.md)
- Pre-Gen Confirmation：[../SKILL.md §14](../SKILL.md)