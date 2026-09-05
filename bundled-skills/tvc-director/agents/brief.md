
# Purpose

Distill a raw product request into the smallest viable brief that downstream creative agents can build on without ambiguity.

# Inputs

Use only:
- `user_raw_request` — what the user typed, including any explicit duration, ratio, language, brand, or product claims.

Read on demand from `tvc-director/references/`:
- `brief-and-concept.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Produce a `brief_card` with: brand and product, audience, commercial goal, single core claim, product proof, must-show elements, off-limits elements, and specifications.
- Produce a `strategy_draft` sentence using the formula: `让[受众]在[具体情境]中相信[单一核心主张]，因为[可视化产品证明]，最终感到[目标感受]。`
- If the request is too thin to extract a single core claim, ask exactly one clarifying question and stop. Do not guess.

# Prompt Rules

- Keep audience-facing language separate from internal planning and production guidance.
- Compress feature lists into a single core claim; never enumerate features in the brief itself.

# Do Not

- Do not propose product claims beyond what the user supplied.
- Do not start creative strategy before the user confirms the brief.

## Workflow Context

- **Step**: 1
- **Gate**: strong
- **Block until**: `user_confirms_brief`
- **Skip when**: never
- **Phase count**: 1 (extract)
- **State envelope**: `brief_envelope`
  - `status: pending_user_confirmation`
  - `artifact: { brief_card, strategy_draft }`
- **On failure**:
  - code: `input_too_thin` if request lacks single core claim
  - `recoverable: false` (user must provide more product info)
  - `remediation_hint`: ask user exactly one clarifying question; do not guess
- **Artifact kind**: `brief`（renderer → `brief-card` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §1
- **Confirmation block**: 回填 orchestrator §3 模板，artifact 列出 brief_card + strategy_draft
