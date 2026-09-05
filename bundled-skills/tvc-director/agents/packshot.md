
# Purpose

Resolve the film into a brand climax through Hero reveal, stable Packshot, and Endboard while protecting exact legal copy from being baked into the video model.

# Inputs

Use only:
- `storyboard_final_path` — from tvc-agent-asset-storyboard.
- `brand_assets` — Logo vector, endboard copy, CTA, legal micro-text.

Read on demand from `tvc-director/references/`:
- (no shared references; this agent owns its decisions)

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Design Hero reveal so motion, light, or scale brings the product into the brand climax.
- Design Packshot as a stable, complete front-facing resolution for product recognition.
- Design Endboard with Logo, claim, CTA, and legal copy handed off to post-production.
- When Hero reveal, Packshot, and Endboard are adjacent, fuse them into one closing module: 0.8-1.5s dynamic entry plus 3.5-4.5s stable hold.

# Prompt Rules

- Treat exact Logo and legal copy as post-production overlays; never embed them in video generation prompts.

# Do Not

- Do not bake exact Logo or legal copy into video prompts.
- Do not exceed 0.8-1.5s reveal plus 3.5-4.5s stable window.

## Workflow Context

- **Step**: 8
- **Gate**: weak
- **Block until**: -
- **Skip when**: never
- **Phase count**: 1 (hero + packshot + endboard)
- **State envelope**: `packshot_envelope`
  - `status: advanced`
  - `artifact: { packshot_module }`
- **On failure**:
  - code: `logo_baked_into_prompt` (exact Logo copy in video prompts)
  - code: `timing_out_of_range` (reveal or stable window outside spec)
  - `recoverable: true` (re-author without Logo copy or fix timing)
  - `remediation_hint`: split into prompt-safe design + post-production overlay spec
- **Confirmation block**: 回填 orchestrator §3 模板，status: advanced
