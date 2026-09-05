
# Purpose

Plan how the product moves through the storyboard and who holds or wears it, with concrete force chains and casting decisions.

# Inputs

Use only:
- `storyboard_final_path` — from tvc-agent-asset-storyboard.
- `product_truth` — what the product does and why it matters.
- `selected_style` — creative grammar for casting and beauty choices.

Read on demand from `tvc-director/references/`:
- `product-actions.md`
- `casting-and-beauty-direction.md`
- `ensemble-continuity.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- For complex packaging interactions, route by reliability: action as core proof (full five-segment force chain), action as gateway (before-state plus sound bridge), unresolvable opening (pre-open, sound bridge, cut, or live-action plate).
- Write the five-segment chain: initial structure, anchor point, force application with direction, visible material feedback, defined end state.
- Lock casting: gender, culture, visual age, facial skin, hair, clothing, performance energy. Define brand temperament before any visual lock.
- For three or more characters, define face shape, hair, clothing outline, value, and pose differences between adjacent people; lock exact headcount and seating order.

# Pre-Generation Confirmation Gate

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](../references/asset-prompting-cheatsheet.md) §3 + §5.

Action chain illustration / casting reference sheet 生成前**必须**先向用户展示 prompt + reference images，等用户确认后才执行。

## When triggered

- 每个 action chain illustration（按 5-segment force chain 数量）一次 Pre-Gen Confirmation
- 每个 casting reference sheet（按 cast size）一次 Pre-Gen Confirmation

## What to show user（per call unit）

```yaml
pre_generation_confirmation:
  step: 6
  call_unit: <action_chain_id | cast_id>
  prompt: |
    {完整 prompt 字符串}
  reference_images:
    - name: <产品图 / 角色三视图>
      source: <local_path>
      base64_preview: <data:image/png;base64,...>
  expected_outputs:
    - {path | url}
  abort_options:
    - retry_same
    - revise_prompt
    - retry_revised
    - abort_step
```

## Block until

- 用户在 front-end 对当前调用单元点击「确认生成」或「取消」
- 取消时必走 abort_options 4 选项 grilling（cheatsheet §5.2）

# Prompt Rules

- Keep product behavior aligned with the product truth; never add capabilities the product does not have.

# Do Not

- Do not invent product features unsupported by the brief.
- Do not propose casting that conflicts with the selected style.

## Workflow Context

- **Step**: 6
- **Gate**: weak
- **Block until**: -
- **Skip when**: never
- **Phase count**: 1 (action_chain + casting)
- **State envelope**: `product_action_envelope`
  - `status: advanced`
  - `artifact: { action_force_chain, casting_decision }`
- **On failure**:
  - code: `casting_style_conflict` (casting conflicts with selected_style)
  - code: `product_feature_invented`
  - `recoverable: true` (re-cast or strip invented features)
  - `remediation_hint`: re-author with explicit style compatibility check
- **Artifact kind**: `product_action_chain`（renderer → `force-chain` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §6
- **Confirmation block**: 回填 orchestrator §3 模板，status: advanced
