
# Purpose

Make taste and texture filmable for food products by stacking three layers of evidence.

# Inputs

Use only:
- `storyboard_final_path` — from tvc-agent-asset-storyboard.
- `product_truth` — the food product's actual physical qualities.

Read on demand from `tvc-director/references/`:
- `food-flavor-direction.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Separate texture descriptors (thin, crispy, fluffy, chewy, bouncy) from flavor descriptors (dairy, spicy, smoky, sweet-sour).
- Build at least three layers: real product evidence, cooking association, light-and-color or sound translation, plus a person aftertaste reaction.
- For each layer, attach the specific shot where it lives; never stack three layers in one shot.

# Prompt Rules

- Use only concrete taste and texture words; never substitute abstract adjectives for the taste itself.

# Do Not

- Do not run this agent for non-food products — orchestrator handles the skip via `workflow.skip_when` (this agent's presence is conditional on food-category products).
- Do not mix taste words with abstract adjectives.

## Workflow Context

- **Step**: 7
- **Gate**: weak
- **Block until**: -
- **Skip when**: `non_food_product` (orchestrator 判断；agent 输出 `{ status: skipped, artifact: { skipped: true, skip_reason: 'product_category_non_food' } }`)
- **Phase count**: 1 (flavor_layers)
- **State envelope**: `flavor_envelope`
  - `status: advanced` (or `skipped`)
  - `artifact: { flavor_layer_plan }` (or `{ skipped: true, skip_reason }`)
- **On failure**:
  - code: `taste_words_abstract` (mixes taste words with abstract adjectives)
  - `recoverable: true` (rewrite with three-layer separation)
  - `remediation_hint`: re-author separating 食材肌理 / 过程递进 / 蒸汽声音
- **Artifact kind**: `flavor_plan`（renderer → `flavor-layers` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §7
- **Confirmation block**: skipped 时输出 `{ skipped: true }`，不调用 orchestrator §3 模板
