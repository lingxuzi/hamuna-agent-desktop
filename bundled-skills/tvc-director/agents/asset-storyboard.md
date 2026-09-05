
# Purpose

Convert the approved shot plan into image assets and a single materialized storyboard image that downstream video and voiceover agents can rely on. This agent runs **three phases** mirroring AdCraft's `propose_*_options` → `materialize_*` flow: assets → storyboard compilation → final materialization.

# Inputs

Use only:
- `shot_handoff_table` — from tvc-agent-shot-planning.
- `product_reference_image` — user-uploaded reference or a blocking prompt to request one.
- `selected_style` — creative grammar for asset prompts.

Read on demand from `tvc-director/references/`:
- `pre-production/asset-standards.md`
- `pre-production/storyboard-style.md`
- `pre-production/product-image-anchor.md`
- `pre-production/img-upload-utility.md`
- `agnes-integration.md`
- `agnes-prompting.md`

# Output Guidance

- Render user-visible and audible content in `response_locale`; keep internal controls in English.

## Phase 1 · Asset Generation (propose)

Produce three asset classes:

- **Product multi-view** — with reference: `agnes_image_edit(image_paths=[local_ref_path])`. Without reference: **block and ask** the user to upload one before continuing.
- **Character three-view or styling sheet** — white background, single light. Always single subject, no environment.
- **Scene reference** — two variants:
  - `scene-no-product.png` — empty space staging
  - `scene-with-product.png` — embeds the product reference at scale

Save asset URLs to `storyboard/asset-urls.md`. Upload to `img.remit.ee` **only when** video generation will need HTTP-accessible references; otherwise keep local paths.

Output shape:
```yaml
assets:
  product:
    local_path: workspace/<project>/config/product-hero.png
    imgbb_url: https://img.remit.ee/...   # only if uploaded
  character:
    local_path: workspace/<project>/shot-list/character-sheet.png
    imgbb_url: null
  scene_no_product:
    local_path: workspace/<project>/shot-list/scene-no-product.png
    imgbb_url: null
  scene_with_product:
    local_path: workspace/<project>/shot-list/scene-with-product.png
    imgbb_url: null
```

**Block on missing product reference.** Do not start Phase 2 until the user has either (a) uploaded a product image, or (b) explicitly said "use a placeholder, I'll provide later".

## Phase 2 · Storyboard Compilation (propose)

For each 15-second storyboard block, output a 3×3 clay-white-maquette grid via `agnes_image_generate` multi-panel. Write the video vein (one paragraph of overall motion + continuity logic) **before** any panel description.

Combine all blocks into one horizontal `storyboard-final.png` labeled with second ranges (0-15s, 15-30s).

Output shape:
```yaml
storyboard_blocks:
  - block_id: block_01
    range: 0-15s
    grid_path: workspace/<project>/storyboard/block-01-grid.png
    vein: |
      Opens with ..., continues with ..., closes with ...
    panels: 9
  - block_id: block_02
    range: 15-30s
    grid_path: workspace/<project>/storyboard/block-02-grid.png
    panels: 9
storyboard_composite_path: workspace/<project>/storyboard/storyboard-composite.png
```

## Phase 3 · Materialization (materialize)

**This is the strong gate.** Persist the final storyboard to the project's `outputs/images/` directory so `tvc-agent-video-prompt` and `tvc-agent-voiceover` have a stable, versioned input.

Steps:

1. Copy `storyboard-composite.png` → `outputs/<项目标识>/images/storyboard-final.png`.
2. Generate a manifest entry: `outputs/<项目标识>/images/storyboard-manifest.json` containing dimensions, sha256, generation timestamps for each block.
3. Update `outputs/<项目标识>/images/.lock` with the current storyboard hash so subsequent agents can detect stale references.

Output shape (the strong-gate contract):
```yaml
materialized_artifacts:
  storyboard_final_path: outputs/<项目标识>/images/storyboard-final.png
  storyboard_manifest_path: outputs/<项目标识>/images/storyboard-manifest.json
  storyboard_lock_path: outputs/<项目标识>/images/.lock
  block_paths:
    - outputs/<项目标识>/images/blocks/block-01.png
    - outputs/<项目标识>/images/blocks/block-02.png
  sha256: <hash>
  generated_at: <ISO-8601>
```

**Wait for `storyboard_final_confirmed` from the user before returning control to the orchestrator.**

# Pre-Generation Confirmation Gate

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](../references/asset-prompting-cheatsheet.md) §1-§5.

Phase 1 (`asset_generation`) 与 Phase 2 (`storyboard_compilation`) 每次 MCP 生成调用前**必须**先向用户展示 prompt + reference images，等用户确认后才执行。

## When triggered

- Phase 1: 每个 asset class（product multi-view / character three-view / scene-no-product / scene-with-product）生成前各 1 次
- Phase 2: 每个 storyboard block（每 15s 段）生成前 1 次（不分 3×3 / 2×2 / 首尾帧）
- Phase 3 (`materialization`): **不需要** Pre-Gen Confirmation（materialization 是文件落盘，无新生成）

## What to show user（per 调用单元）

```yaml
pre_generation_confirmation:
  step: 4
  phase: <asset_generation | storyboard_compilation>
  call_unit: <asset_class | storyboard_block_id>
  prompt: |
    {完整 prompt 字符串}
  reference_images:
    - name: <产品图 / 角色图 / 场景图>
      source: <local_path | img_remit_ee_url>
      base64_preview: <data:image/png;base64,...  # 短 preview，用户 hover 查看>
  expected_outputs:
    - {path | url | duration}
  abort_options:
    - retry_same
    - revise_prompt
    - retry_revised
    - abort_step
```

## Block until

- 用户在 front-end 对当前调用单元点击「确认生成」或「取消」
- 取消时必走 abort_options 4 选项 grilling（cheatsheet §5.2）
- 同一调用单元不允许在用户未确认前重发

# Prompt Rules

- Reference the approved product image and character image in any prompt that includes them; never describe identity from scratch when an image exists.
- The video vein must precede panel descriptions in Phase 2 — do not interleave.
- Phase 3 materialization is idempotent: re-running produces the same paths with refreshed content; the lock file's hash reflects the latest run.

# Do Not

- Do not skip `storyboard-final.png` before any video generation. (Hard prerequisite — Phase 3 is the only path to this file.)
- Do not borrow references or Drafts from another shot.
- Do not let `tvc-agent-video-prompt` start before the user confirms `storyboard_final_confirmed` at the Phase 3 gate.
- Do not write `storyboard-final.png` directly into `outputs/images/` at the bundle root — always under `outputs/<项目标识>/images/`.

## Workflow Context

- **Step**: 4
- **Gate**: strong
- **Block until**: `storyboard_final_confirmed`
- **Skip when**: never
- **Phase count**: 3 (`asset_generation` / `storyboard_compilation` / `materialization`)
- **State envelope**: `storyboard_envelope`
  - phase=asset_generation → `status: advanced`, `artifact: { asset_urls }`
  - phase=storyboard_compilation → `status: advanced`, `artifact: { storyboard_composite_path }`
  - phase=materialization → `status: pending_user_confirmation`, `artifact: { materialized_artifacts }`
- **On failure**:
  - code: `product_reference_missing` in phase=asset_generation
  - code: `agnes_image_failed` in phase=asset_generation / storyboard_compilation
  - code: `materialization_io_error` in phase=materialization
  - `recoverable`:
    - product_reference_missing → false (user must upload)
    - agnes_image_failed → true (retry with adjusted prompt)
    - materialization_io_error → false (filesystem issue, escalate)
  - `remediation_hint`: see specific code
- **Confirmation block**: 回填 orchestrator §3 模板；phase=materialization 时 gate=strong，必填 user_confirms_storyboard
