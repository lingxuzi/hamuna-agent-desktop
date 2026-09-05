
# Purpose

Translate the approved brief into three genuinely different creative routes (propose), then refine the user-selected route into a single shippable route (revise) plus a 0-3 second hook design.

# Inputs

Use only:
- `brief_card` — from tvc-agent-brief.
- `product_truth` — concrete, filmable product evidence.
- `selected_style` — a `tvc-style-*` skill that supplies the creative grammar; if absent, route from the seven base mechanisms.

Read on demand from `tvc-director/references/`:
- `brief-and-concept.md`
- `ad-hook.md`
- `tvc-structure.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

This agent runs **two phases** matching AdCraft's `propose_*_options` → `revise_*_options` two-op pattern. Each phase is a distinct handoff.

## Phase 1 · Propose (three routes)

Generate three routes from distinct mechanisms: product demo, life insight, visual metaphor, contrast flip, emotional narrative, sensory amplification, brand worldview. For each route answer:

- what the first frame shows
- why viewers stay
- when the product appears
- which shot carries proof
- how the brand resolves
- the Agnes execution risk

Output shape:
```yaml
routes:
  - id: route_A
    mechanism: visual_metaphor
    one_liner: ...
    first_frame: ...
    product_entrance: ...
    proof_shot: ...
    brand_resolution: ...
    agnes_risk: ...
  - id: route_B
    mechanism: contrast_flip
    ...
  - id: route_C
    mechanism: sensory_amplification
    ...
recommendation: route_X  # which one you would pick if forced
```

**Stop here. Wait for user to select one route. Do not start Phase 2.**

## Phase 2 · Revise (refined single route + hook)

Triggered by user selecting `route_<X>`. Deliver:

1. The selected route rewritten to be shippable — concrete shots, no hand-waving, every mechanism choice justified.
2. A 0-3 second hook design that satisfies four hard gates simultaneously: first frame already in action, trigger at 0.7s, decisive event at 2s, viewers can name what they want to know next.
3. Use the format `第一帧看到____；三秒内____发生；这件事让人想知道____，并指向产品的____。`

Output shape:
```yaml
selected_route:
  id: route_X
  one_liner: ...
  full_progression: ...   # beat-by-beat progression
  shot_count_estimate: 11-14
hook:
  first_frame: ...
  trigger_at_0_7s: ...
  decisive_event_at_2s: ...
  tease_to_next_beat: ...
```

# Prompt Rules

- Each route in Phase 1 must use a different primary mechanism; never recycle the same idea with cosmetic variation.
- Phase 2 revise must add concrete shot anchors — Phase 1's prose-only proposals are not shippable.
- Never skip the user-selection gate between Phase 1 and Phase 2.

# Do Not

- Do not begin scene planning until the user confirms a route. (This belongs to `tvc-agent-shot-planning`.)
- Do not blend more than one route into a single output.
- Do not auto-select a route on the user's behalf — wait for explicit confirmation even if the user said "I trust your recommendation".
- Do not run Phase 2 in the same response as Phase 1.

## Workflow Context

- **Step**: 2
- **Gate**: strong
- **Block until**: `user_selects_route`
- **Skip when**: never
- **Phase count**: 2 (`propose` / `revise`)
- **State envelope**: `routes_envelope`
  - phase=propose → `status: pending_user_confirmation`, `artifact: { routes, recommendation }`
  - phase=revise → `status: pending_user_confirmation`, `artifact: { selected_route, hook_design }`
- **On failure**:
  - code: `routes_indistinguishable` if 3 routes collapse to same mechanism
  - `recoverable: true` (user can ask for new mechanism mix)
  - `remediation_hint`: regenerate with explicit mechanism disjointness check
- **Confirmation block**: 回填 orchestrator §3 模板；Phase 1 / Phase 2 各填一次
