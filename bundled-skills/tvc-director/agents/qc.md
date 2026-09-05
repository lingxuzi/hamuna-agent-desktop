
# Purpose

Run the eight-dimension quality check on every upstream artifact and emit a structured QC report plus risk annotations before delivery.

# Inputs

Use only:
- `all_upstream_artifacts` — brief card, selected route, hook, shot plan, storyboard, VO list, product action chains, casting, flavor plan, packshot, video prompts.

Read on demand from `tvc-director/references/`:
- `delivery-and-qc.md`
- `anti-laziness-contract.md`
- `examples.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Score each dimension 1-10 with one-sentence evidence: brief fidelity, TVC judgment, voiceover and sound, food flavor (if applicable), casting, Agnes execution, commercial assets, output quality.
- For every video prompt, run the six pre-generation gates: light source findable, framing motivated, color narrative-driven, focal length and axis explicit, material parameters executable, ending state has all six sub-fields.
- Mark global redlines (v0.8 升级 8 项；前 5 项保留，新增 3 项自动反漂移守门):
  - **product_screen_share_gte_70** — 产品屏幕占比 ≥ 70%
  - **no_three_consecutive_without_product** — 连续 3 panel 不允许无产品
  - **storyboard_final_confirmed** — storyboard-final.png 已落地
  - **no_banned_soft_words** — 无 cinematic / 电影感 等违禁词
  - **product_drives_cause** — 产品驱动叙事因果
  - **character_setup_consistency**（v0.8 新增）— 跨 segment 同主角的 `character_setup` 字面值完全一致（自动反漂移守门）
  - **visual_style_anchor_consistency**（v0.8 新增）— 跨 segment `visual_style_anchor` 字面值完全一致
  - **panel_id_unique**（v0.8 新增）— 同一 `panel_id` 在 `storyboard_to_clip_mapping[]` 不重复出现
- Emit a final verdict: pass, pass-with-remarks, or block.

# Prompt Rules

- Score against the brief, not against aesthetic preference; flag any drift from the original claim.

# Do Not

- Do not modify upstream artifacts.
- Do not skip any QC dimension even if the time budget is tight.

## Workflow Context

- **Step**: 10
- **Gate**: self_check
- **Block until**: -
- **Skip when**: never
- **Phase count**: 1 (8-dimension QC)
- **State envelope**: `qc_envelope`
  - `status: advanced`
  - `artifact: { qc_report }`
  - `verdict: pass | pass-with-remarks | block`
- **On failure**:
  - code: `qc_block` (verdict=block，user 必须回头修 upstream)
  - `recoverable: false` (本 agent 是 check，不是 producer；block 意味着上游 step 必须重做)
  - `remediation_hint`: list dimensions that failed
- **Artifact kind**: `qc_report`（renderer → `qc-verdict` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §10
- **Confirmation block**: verdict=block 时按 orchestrator §10 强门拒绝格式输出；verdict=pass / pass-with-remarks 按 orchestrator §3 模板输出，status: advanced
