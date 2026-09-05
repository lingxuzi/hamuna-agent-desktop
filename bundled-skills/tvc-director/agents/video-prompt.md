
# Purpose

Translate the storyboard plus all upstream decisions into a stack of self-contained video generation prompts that the Agnes pipeline can execute.

# Inputs

Use only:
- `storyboard_envelope` — tvc-agent-asset-storyboard 的 JSON envelope（**不只** final_path 路径字符串）。
  必须读 `artifact.blocks[].{visual_style_anchor, character_setup, vein, grid_path}` 和
  `artifact.blocks[].panels[].{panel_id, time_range, shot_type, character_emotion, sound_effect, framing, camera_move, color_light, mood_keyword}`。
  `layout_type` 仅用于故事板自适应渲染，video 不消费（见 SKILL §15.6 handoff contract）。
  跨 block 同主角的 `character_setup` 字面值必须完全一致（cheatsheet §4.6 反漂移守门）。
- `selected_style` — creative grammar（与 `visual_style_anchor` 互为佐证；翻译风格时以 `visual_style_anchor` 为准）。
- `all_upstream_decisions` — VO list, product action chains, casting, flavor plan, packshot module.

Read on demand from `tvc-director/references/`:
- `agnes-integration.md`
- `agnes-prompting.md`
- `anti-laziness-contract.md`
- `model-and-segmentation-routing.md`
- `generation-modes.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- One prompt per `agnes_video_generate` call; each prompt is fully self-contained and unknown to the model about other segments.
- Each segment restarts numbering at 1 and time at 0s; never inherit numbering or timeline from a previous segment.
- Each segment opens by repeating the global style declaration (color palette, tonal structure, light system, texture) and the standard product description.

## v0.5 字段翻译表（Step 4 → Step 9 唯一权威映射）

| v0.5 storyboard 字段 | segment prompt 中的位置 | 来源权威 |
|---------------------|------------------------|---------|
| `blocks[].visual_style_anchor` | segment prompt 的"全局风格声明"**第一行**（禁止从 `selected_style` 二次推算） | 视觉锚点 |
| `blocks[].character_setup` | segment prompt 的"人设描述"（直接 copy `[Character Lock: ...]`，禁止重拼） | 人设锚点 |
| `panels[].shot_type` | segment 的 `framing` / 镜头距离（已是 Agnes shot type 枚举） | 镜头锚点 |
| `panels[].character_emotion` | segment 的表演 / 表情方向；product-only panel 的空字符串映射为"无角色表演" | 表演锚点 |
| `panels[].sound_effect` | segment 的音效指令 | 音效锚点 |
| `panels[].framing` / `camera_move` / `color_light` / `mood_keyword` | segment 的具体描写 | 场景锚点 |

**禁止**重新从 `selected_style` 推算摄影要点 / 重新拼凑人设 — v0.5 已编码。
**禁止**在 `character_setup` 上自行增删特征 — `[Character Lock: ...]` 字面值跨 block 必须完全一致（cheatsheet §4.6 反漂移守门）。

## storyboard_to_clip_mapping 派生规则（必填字段）

写到 envelope 的 `storyboard_to_clip_mapping[]`，每条记录结构：

```json
{ "panel_ids": ["01", "02", "03"], "segment_id": "seg_01", "time_range": "0-10s" }
```

派生来源：

| 字段 | 来源 |
|------|------|
| `panel_ids[]` | `artifact.blocks[某 block].panels[].panel_id` 的连续区间（按本 segment 覆盖的 panel 范围） |
| `segment_id` | `model-and-segmentation-routing.md` 拆段结果 |
| `time_range` | `artifact.blocks[某 block].panels[].time_range` 的合并（min start → max end） |

派生逻辑必须与 `references/step-output-schema.md` §9 同名字段说明**双向一致**。

## First-Frame 上传源

每个 segment 的 first_frame 上传优先级：

1. **首选**：`artifact.blocks[某 block].grid_path`（v0.5 故事板图，与评审稿同源）
2. 退化：`artifact.composite_path`（全片汇总故事板图）
3. 最后退化：让 Agnes 从 0 拍首帧（已知风险：与故事板评审稿可能视觉漂移）

上传走 `agnes-integration.md` 的 `upload_image(local_path)` → 拿到 img.remit.ee URL → 喂 `agnes_video_generate` 的 `image` 参数。

## Reference Images 来源（v0.8 升级 panel 级精挑）

`segments[].reference_images[]` 按本 segment 覆盖的 panel 范围**精挑合并**（不再是 block 级全集共享）：

1. **panel 级精挑**（v0.8 新增必填）：按本 segment 覆盖 panel 范围，合并所有 `artifact.blocks[].panels[].reference_tags[]`
   - panel `reference_tags[]` 缺省 = 继承 `artifact.blocks[].references[]`（向后兼容；v0.7 block 级精挑子集）
2. **上游资源**：上游 `all_upstream_decisions` 的资源（如 VO ID、packshot 资产等）
3. **同一维度只保留一个最高优先级来源；没有实际附件时禁止虚构编号**

**举例**（30s 咖啡机 TVC，seg_01 覆盖 block_01 panels 01-09）：

```text
artifact.blocks[].references = ["product-hero", "character-barista", "scene-kitchen"]
panel_01.reference_tags = ["product-hero"]                    # 产品特写
panel_02.reference_tags = ["character-barista"]               # 人物入镜
panel_03.reference_tags = ["scene-kitchen", "product-hero"]   # 场景切换 + 产品
...
→ seg_01.reference_images = 合并 [product-hero, character-barista, scene-kitchen]
```

**反模式**：
- ❌ 把 block 级 `references[]` 全集复制进 segment（v0.7 之前的旧行为）→ 引入无关 ref 污染
- ❌ 忽略 panel 级 `reference_tags[]` 精挑 → agent 自己重挑，跨 segment 可能漂移

## Other

- Write the storyboard-to-clip mapping table before any prompt.
- Apply the banned-word translation table from `anti-laziness-contract.md` to every prompt（含从 v0.5 字段 copy 进来的字面值也必须经 ban-word 转译）。

# Pre-Generation Confirmation Gate

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](../references/asset-prompting-cheatsheet.md) §4 + §5.

每个 video segment prompt 写完后**必须**先向用户展示 prompt + reference images + 上传到 img.remit.ee 的首帧 URL，等用户确认后才提交 `agnes_video_generate`。本 agent **不直接调用** MCP，但产出的 prompt 由 orchestrator 触发 MCP 前必走 Pre-Gen Confirmation。

## When triggered

- 每个 segment prompt 写完后（按 segment 顺序聚合；一次性展示全部 segments 的 prompts + 每 segment 1 张 first_frame preview）
- **禁止**按 MCP 调用逐次问用户 → 按 segment 聚合（Q24 推荐）

## What to show user（per segment）

```yaml
pre_generation_confirmation:
  step: 9
  call_unit: <segment_id>
  prompt: |
    {完整 segment prompt（自包含、零段间引用，含 v0.5 翻译表 6 个锚点）}
  first_frame:
    - name: <first_frame_N.png>
      source: img_remit_ee_url
      base64_preview: <data:image/png;base64,...>
      storyboard_source: <blocks[某 block].grid_path 或 composite_path>
  reference_images:
    - name: <产品图 / 角色三视图 / 场景图>
      source: <local_path 或 img_remit_ee_url>
      block_id: <所属 v0.5 block>
      panel_id: <所属 panel，若适用>
  storyboard_to_clip_mapping:
    - panel_ids: ["01", "02", "03"]
      segment_id: seg_01
      time_range: "0-10s"
  expected_outputs:
    - duration_sec: <5 | 6 | 8 | 10>
      aspect: <16:9 | 21:9>
  abort_options:
    - retry_same
    - revise_prompt
    - retry_revised
    - abort_step
```

`reference_images[]` 的 `block_id` / `panel_id` 字段让用户在确认时一眼看出"这张参考图来自哪个 block / panel"，便于拒绝与 v0.5 漂移的图源。

## Block until

- 用户对**全部 segments** 一次性确认或选中要重写的 segments
- 取消时必走 abort_options 4 选项 grilling（cheatsheet §5.2）

# Prompt Rules

- Treat each segment as a complete prompt; never reference earlier segments by name or content.

# Do Not

- Do not call agnes_video_generate directly; submit prompts only.
- Do not invent duration, aspect ratio, resolution, or model names.
- Do not reference earlier segments by name.

## Workflow Context

- **Step**: 9
- **Gate**: weak
- **Block until**: -
- **Skip when**: never
- **Phase count**: 1 (segment prompts)
- **State envelope**: `video_prompt_envelope`
  - `status: advanced`
  - `artifact: { video_clip_prompts }`
- **On failure**:
  - code: `soft_words_present` (cinematic / 电影感 etc. without translation)
  - code: `cross_segment_reference` (segment N references segment M)
  - code: `param_invented` (duration / aspect / model not from upstream)
  - `recoverable: true` (rewrite specific segment)
  - `remediation_hint`: re-author with explicit ban-word table lookup + segment isolation check
- **Artifact kind**: `video_prompts`（renderer → `segment-queue` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §9
- **Confirmation block**: 回填 orchestrator §3 模板，status: advanced
