# TVC Director · Agent Capabilities (Human-Readable)

This file mirrors `agent-capabilities.json` in a form for humans. The JSON file
is the contract of record; if anything here disagrees with the JSON, the JSON
wins and this file should be regenerated.

## Workflow (11 steps)

| Step | Agent | Gate | Block until | Skip when |
|------|-------|------|-------------|-----------|
| 0 | `tvc-agent-script` | **strong** | `user_confirms_script` | never |
| 1 | `tvc-agent-brief` | **strong** | `user_confirms_brief` | - |
| 2 | `tvc-agent-strategy` | **strong** | `user_selects_route` | - |
| 3 | `tvc-agent-shot-planning` | weak | - | - |
| 4 | `tvc-agent-asset-storyboard` | **strong** | `storyboard_final_confirmed` | - |
| 5 | `tvc-agent-voiceover` | **strong** | `vo_text_confirmed` | - |
| 6 | `tvc-agent-product-action` | weak | - | - |
| 7 | `tvc-agent-food-flavor` | weak | - | non-food products |
| 8 | `tvc-agent-packshot` | weak | - | - |
| 9 | `tvc-agent-video-prompt` | **strong** | `video_prompts_confirmed` | - |
| 10 | `tvc-agent-qc` | self-check | - | - |

## Agent Quick Reference

### Step 0 · `tvc-agent-script`
- **Inputs**: `user_raw_request`, `selected_duration`
- **Outputs**: `script`, `selected_duration`
- **References on demand**: (none)
- **Do Not**:
  - Skip this step even if the user supplied a complete script — the strong gate requires explicit confirmation
  - Accept durations outside the 6 fixed options (15s / 30s / 45s / 60s / 90s / 120s)
  - Generate scene durations whose sum differs from `selected_duration`
  - Write shots, camera moves, or voiceover lines — those belong to shot-planning (Step 3) and voiceover (Step 5)

### Step 1 · `tvc-agent-brief`
- **Inputs**: `user_raw_request`
- **Outputs**: `brief_card`, `strategy_draft`
- **References on demand**: `references/brief-and-concept.md`
- **Do Not**:
  - Propose product claims beyond what the user supplied
  - Start creative strategy before the user confirms the brief

### Step 2 · `tvc-agent-strategy`
- **Inputs**: `brief_card`, `product_truth`, `selected_style`
- **Outputs**: `three_routes`, `selected_route`, `hook_design`
- **References on demand**: `references/brief-and-concept.md`, `references/ad-hook.md`, `references/tvc-structure.md`
- **Do Not**:
  - Begin scene planning until the user confirms a route
  - Blend more than one route into a single output

### Step 3 · `tvc-agent-shot-planning`
- **Inputs**: `selected_route`, `hook_design`, `selected_style`, `duration`, `pacing_tier`
- **Outputs**: `scene_anchors`, `shot_handoff_table`
- **References on demand**: `references/scene-progression.md`, `references/pacing-and-shot-density.md`, `references/shot-handoffs-and-sound-bridges.md`, `references/spatial-hard-rules.md`, `references/ensemble-continuity.md`
- **Do Not**:
  - Submit media tasks or include provider payloads
  - Write shot-list prompts; that belongs to `tvc-agent-video-prompt`

### Step 4 · `tvc-agent-asset-storyboard`
- **Inputs**: `shot_handoff_table`, `product_reference_image`, `selected_style`
- **Outputs**: `asset_urls`, `storyboard_final_path`
- **References on demand**: `references/pre-production/asset-standards.md`, `references/pre-production/storyboard-style.md`, `references/pre-production/product-image-anchor.md`, `references/pre-production/img-upload-utility.md`, `references/agnes-integration.md`, `references/agnes-prompting.md`
- **Do Not**:
  - Skip `storyboard-final.png` before any video generation
  - Borrow references or Drafts from another shot

### Step 5 · `tvc-agent-voiceover`
- **Inputs**: `storyboard_final_path`, `duration`
- **Outputs**: `voiceover_list`
- **References on demand**: `references/voiceover.md`, `references/shot-handoffs-and-sound-bridges.md`
- **Do Not**:
  - Call `edge-tts` before the user confirms the VO text
  - Narrate action; only add information not in the picture

### Step 6 · `tvc-agent-product-action`
- **Inputs**: `storyboard_final_path`, `product_truth`, `selected_style`
- **Outputs**: `action_force_chain`, `casting_decision`
- **References on demand**: `references/product-actions.md`, `references/casting-and-beauty-direction.md`, `references/ensemble-continuity.md`
- **Do Not**:
  - Invent product features unsupported by the brief
  - Propose casting that conflicts with the selected style

### Step 7 · `tvc-agent-food-flavor`
- **Inputs**: `storyboard_final_path`, `product_truth`
- **Outputs**: `flavor_layer_plan`
- **References on demand**: `references/food-flavor-direction.md`
- **Do Not**:
  - Run this agent for non-food products — orchestrator handles the skip via `workflow.skip_when`
  - Mix taste words with abstract adjectives

### Step 8 · `tvc-agent-packshot`
- **Inputs**: `storyboard_final_path`, `brand_assets`
- **Outputs**: `packshot_module`
- **References on demand**: (none)
- **Do Not**:
  - Bake exact Logo or legal copy into video prompts
  - Exceed 0.8-1.5s reveal + 3.5-4.5s stable window

### Step 9 · `tvc-agent-video-prompt`
- **Inputs**: `storyboard_final_path`, `selected_style`, `all_upstream_decisions`
- **Outputs**: `video_clip_prompts`
- **References on demand**: `references/agnes-integration.md`, `references/agnes-prompting.md`, `references/anti-laziness-contract.md`, `references/model-and-segmentation-routing.md`, `references/generation-modes.md`
- **Do Not**:
  - Call `agnes_video_generate` directly; submit prompts only
  - Invent duration, aspect ratio, resolution, or model names
  - Reference earlier segments by name

### Step 10 · `tvc-agent-qc`
- **Inputs**: `all_upstream_artifacts`
- **Outputs**: `qc_report`
- **References on demand**: `references/delivery-and-qc.md`, `references/anti-laziness-contract.md`, `references/examples.md`
- **Do Not**:
  - Modify upstream artifacts
  - Skip any QC dimension even if the time budget is tight

## Style Library (6 styles)

| Style | Category | One-line grammar |
|-------|----------|------------------|
| `tvc-style-brand-manifesto` | cinematic-narrative | belief-led narration -> symbolic imagery -> emotional escalation -> brand resolution |
| `tvc-style-industrial-product` | commercial-craft | engineering form -> material precision -> functional demonstration -> controlled light |
| `tvc-style-cinematic-food` | lifestyle-documentary | ingredient texture -> process progression -> steam & sound -> appetite-led reveal |
| `tvc-style-product-promo` | commercial-craft | selling-point hierarchy -> use context -> benefit reveal -> clean packshot |
| `tvc-style-one-take` | commercial-craft | continuous spatial choreography -> motivated transitions -> reveal timing |
| `tvc-style-beat-synced` | commercial-craft | rhythmic camera accents -> movement-to-cut coordination -> visual impact beats |

## Global Redlines

1. Product screen share >= 70 percent across the full film
2. No three consecutive panels without product visibility
3. `storyboard-final.png` is a hard prerequisite for `agnes_video_generate`
4. No banned soft words (cinematic / 电影感 / 高级感 / 氛围感) without translation to concrete camera/lighting parameters
6. Product must drive the cause, not be a passive prop decorated with FX

## Verification

Run `bash scripts/verify-tvc-bundle.sh` to confirm the on-disk bundle agrees with this contract. The script checks:

- `agent-capabilities.json` is valid JSON and version 1
- 11 agents present in the on-disk bundle (added `tvc-agent-script` as Step 0 pre-step)
- 6 styles present in the on-disk bundle
- Every agent's `references_on_demand` paths are reachable
- Workflow step numbers and agent ids are unique (now 0..10, total 11)
- Workflow agent set matches the agents array
- 25 reference markdown files exist (including `asset-prompting-cheatsheet.md` + `step-output-schema.md`)
- 36 cheatsheet integrity checks (4 H2 × 6 H3 + 6 style Asset Prompt Adapt × 2 + 4 failure code + cheatsheet orchestrator cross-link)
- §12 step-output-schema consistency: ~50 checks (11 artifact_kind declared + 11 unique + 22 Workflow Context sub-keys + 1 schema doc + 11 §X. sections + 1 routing table)

> **v0.3 schema**: All 10 agent + 6 style files live as flat `.md` files inside `tvc-director/agents/` and `tvc-director/styles/` (no frontmatter). `skill_id` is preserved in `agent-capabilities.json` for cross-references but no longer maps to a directory on disk; use `internal_path` to locate the file.
> **Pre-Generation Confirmation Gate**: Every MCP generation call (Step 4 / 5 / 6 / 9) is gated by `tvc-director/SKILL.md` §14 — orchestrator must show prompt + reference images to user before invocation. Failure → cheatsheet §5.2 4-option grilling.