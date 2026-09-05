
# Purpose

Deliver one primary voiceover list that fits the storyboard, controls pacing valleys, and survives the 4-23 second mid-roll check.

# Inputs

Use only:
- `storyboard_final_path` — from tvc-agent-asset-storyboard.
- `duration` — total seconds.

Read on demand from `tvc-director/references/`:
- `voiceover.md`
- `shot-handoffs-and-sound-bridges.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Emit one primary VO list with fields: VO ID, text, start time, hard stop time, repeat count equals one.
- Run the 4-23s check: any window longer than 2.5s without information must declare a takeover event (product sound, music change, new visual).
- Flag any run longer than 4 seconds with no human voice and no new product proof as a pacing valley.
- Recommend voice from edge-tts: zh-CN-YunxiNeural male or zh-CN-XiaoxiaoNeural female.

# Pre-Generation Confirmation Gate

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](../references/asset-prompting-cheatsheet.md) §5 + §6.1.

每条 VO text 生成 `edge-tts.text_to_speech` 音频前**必须**先向用户展示文本 + voice_id + 预期时长，等用户确认后才执行。

## When triggered

- 每条 VO line（按 VO ID 聚合）一次 Pre-Gen Confirmation
- 同 VO ID 重生成（节奏调整后）必须重新确认

## What to show user（per VO line）

```yaml
pre_generation_confirmation:
  step: 5
  call_unit: <vo_id>
  vo_text: |
    {完整 VO 文案}
  voice_id: <zh-CN-YunxiNeural | zh-CN-XiaoxiaoNeural | 用户指定>
  expected_duration_sec: <估算时长>
  reference_images: []   # 音频生成无图
  abort_options:
    - retry_same
    - revise_vo_text
    - retry_revised
    - abort_step
```

## Block until

- 用户在 front-end 对当前 VO line 点击「确认生成」或「取消」
- 取消时必走 abort_options 4 选项 grilling（cheatsheet §5.2；`revise_prompt` → `revise_vo_text`）

# Prompt Rules

- VO text must add information not present in the picture; never narrate action.

# Do Not

- Do not call edge-tts before the user confirms the VO text.
- Do not narrate action; only add information not in the picture.

## Workflow Context

- **Step**: 5
- **Gate**: strong
- **Block until**: `vo_text_confirmed`
- **Skip when**: never
- **Phase count**: 1 (vo_list)
- **State envelope**: `voiceover_envelope`
  - `status: pending_user_confirmation`
  - `artifact: { voiceover_list }`
- **On failure**:
  - code: `vo_narrates_action` (VO text repeats visible action)
  - `recoverable: true` (rewrite VO to add unseen information)
  - `remediation_hint`: rewrite each VO line to add information not in picture
- **Artifact kind**: `voiceover_list`（renderer → `vo-timeline` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §5
- **Confirmation block**: 回填 orchestrator §3 模板
