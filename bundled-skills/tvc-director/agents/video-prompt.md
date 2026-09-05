
# Purpose

Translate the storyboard plus all upstream decisions into a stack of self-contained video generation prompts that the Agnes pipeline can execute.

# Inputs

Use only:
- `storyboard_final_path` — from tvc-agent-asset-storyboard.
- `selected_style` — creative grammar.
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
- Write the storyboard-to-clip mapping table before any prompt: which panels the clip covers, with timecode, framing, camera, core action, color and light, mood keyword, and reference image tags.
- Apply the banned-word translation table from `anti-laziness-contract.md` to every prompt.

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
    {完整 segment prompt（自包含、零段间引用）}
  first_frame:
    - name: <first_frame_N.png>
      source: img_remit_ee_url
      base64_preview: <data:image/png;base64,...>
  reference_images:
    - name: <产品图 / 角色三视图 / 场景图>
      source: <local_path>
  expected_outputs:
    - duration_sec: <5 | 6 | 8 | 10>
      aspect: <16:9 | 21:9>
  abort_options:
    - retry_same
    - revise_prompt
    - retry_revised
    - abort_step
```

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
