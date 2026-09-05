
# Purpose

Turn the approved route and hook into a structured shot plan with scene anchors, pacing tier, and continuous handoff between shots.

# Inputs

Use only:
- `selected_route` — from tvc-agent-strategy.
- `hook_design` — from tvc-agent-strategy.
- `selected_style` — creative grammar (optional).
- `duration` — 15s / 30s / custom seconds.
- `pacing_tier` — fast (14-18), standard (11-14), restrained (8-10), or custom.

Read on demand from `tvc-director/references/`:
- `scene-progression.md`
- `pacing-and-shot-density.md`
- `shot-handoffs-and-sound-bridges.md`
- `spatial-hard-rules.md`
- `ensemble-continuity.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

- Choose scene count (1, 2, or 3) by narrative need; write an anchor card per scene: location and time, key light, background depth, color state, action goal, ambient bed, and cross-scene guards.
- Distribute the pacing tier's shot count across scenes; never collapse multiple narrative modules into one shot.
- For each shot, write eleven fields: time range, framing and camera, opening state, single main action, observation, material feedback (concrete parameters, no soft words), sound, product or brand task, negative constraints, ending state (six sub-fields), and repositioning self-check.
- When shot density is 12 or higher or the film crosses scenes, write handoff fields and sound bridges; keep ambient bed continuous across cuts; let target sound enter 0.3-0.6s before its source shot ends.
- Map every shot's repositioning through the four spatial recomputations in `spatial-hard-rules.md`.

# Prompt Rules

- Bind each shot to one narrative module; do not stack two unrelated actions in the same shot.

# Do Not

- Do not submit media tasks or include provider payloads.
- Do not write shot-list prompts; that belongs to tvc-agent-video-prompt.

## Workflow Context

- **Step**: 3
- **Gate**: weak
- **Block until**: -
- **Skip when**: never
- **Phase count**: 1 (scene + shot + handoff)
- **State envelope**: `shot_plan_envelope`
  - `status: advanced` (auto-advance)
  - `artifact: { scene_anchors, shot_handoff_table }`
- **On failure**:
  - code: `shot_density_mismatch` if shot count outside pacing_tier range
  - `recoverable: true` (re-plan with explicit count target)
  - `remediation_hint`: re-author with shot_count_target = pacing_tier midpoint
- **Artifact kind**: `shot_plan`（renderer → `shot-table` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §3
- **Confirmation block**: 回填 orchestrator §3 模板，status: advanced
