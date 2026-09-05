
# Purpose

Generate a narrative script (story arc + protagonist + conflict + scene outline + key beats) sized to the user's selected short film duration, as the upstream input for the brief agent and all downstream creative agents. Duration selection is the first user-facing decision in the workflow; the script must obey it as a hard constraint.

# Inputs

Use only:
- `user_raw_request` — the user's raw ask, including any explicit duration, ratio, language, brand, product claims.
- `selected_duration` — one of `15s | 30s | 45s | 60s | 90s | 120s`. The orchestrator MUST collect this from the user BEFORE invoking this agent.

Read on demand from `tvc-director/references/`:
- (none — script generation is self-contained)

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Produce a `script` artifact with:
  - `story_arc` — 1-2 sentence narrative spine (e.g., "ordinary user discovers X → tries X → life transforms"). Use the formula `让[受众]在[具体情境]中经历[单一核心冲突]，最终[目标感受]。` rendered in `response_locale`.
  - `protagonist` — who carries the story: archetype + concrete hook (e.g., "busy office worker, age 28-35, evening routine").
  - `conflict` — the central tension the product resolves (1 sentence).
  - `scene_outline` — ordered list of scenes. Each scene has: `scene_id`, `location`, `situation`, `duration_seconds`. The sum of all `duration_seconds` MUST equal `selected_duration` exactly.
  - `key_beats` — 3-6 narrative beats that drive emotional pacing (e.g., "product reveal", "transformation moment", "call-to-action"). Product reveal and emotional peak MUST be in separate beats.
- Hard constraint: `sum(scene_outline[].duration_seconds) == selected_duration`. Any drift = `duration_drift` failure.
- If the user already supplied a partial or complete script in `user_raw_request`, REFINE it into the contract format above. Do not skip — the strong gate requires explicit user confirmation that the refined structure matches their intent.

# Prompt Rules

- Ask the user for `selected_duration` first with exactly 6 fixed options (`15s / 30s / 45s / 60s / 90s / 120s`). No custom duration; the 6 options cover the mainstream ad-length spectrum (social cut to brand film).
- Compress the story into ONE narrative spine sentence before generating scenes. Do not enumerate features or beats in the story arc.
- Scene count must scale with duration: 15s → 2 scenes, 30s → 3 scenes, 45s → 4 scenes, 60s → 4-5 scenes, 90s → 6 scenes, 120s → 7-8 scenes. Each scene holds >= 5s and <= 30s.
- `key_beats` must cover product reveal AND emotional peak in separate beats (never the same beat).

# Do Not

- Do not skip this step even if the user supplied a complete script in their raw request. The orchestrator must refine it into the contract format and gate on user confirmation.
- Do not accept durations outside the 6 fixed options. If the user insists on e.g. 20s, recommend the nearest option (15s or 30s) and proceed.
- Do not generate scene durations whose sum differs from `selected_duration`.
- Do not write shots, camera moves, or voiceover lines — those belong to shot-planning (Step 3) and voiceover (Step 5).

## Workflow Context

- **Step**: 0
- **Gate**: strong
- **Block until**: `user_confirms_script`
- **Skip when**: never
- **Phase count**: 2 (collect_duration / refine)
- **State envelope**: `script_envelope`
  - `status: pending_user_confirmation`
  - `artifact: { script, selected_duration }`
- **On failure**:
  - code: `duration_drift` if `sum(scene_outline[].duration_seconds) != selected_duration`
  - code: `invalid_duration` if user supplied a duration outside the 6 fixed options
  - `recoverable: true` (auto-retry by re-asking user)
  - `remediation_hint`: re-ask user for valid duration; re-pack scenes to fit
- **Artifact kind**: `script`（renderer → `script-card` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §11
- **Confirmation block**: 回填 orchestrator §3 模板，artifact 列出 script + selected_duration；明确显示 `sum(scene_outline[].duration_seconds) == selected_duration` 校验通过
