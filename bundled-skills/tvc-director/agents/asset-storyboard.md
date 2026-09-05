
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

For each storyboard block (default 15s), **pick one of 6 layout types** based on the scene content, then output via `agnes_image_generate` multi-panel. Write the **video vein** (one paragraph of overall motion + continuity logic) **before** any panel description.

### Per-Block Reference Decision (v0.7 新增)

**问题**：v0.5 之前 envelope 顶层 `references[]` 是"全集共享"，未做 block 级精挑。结果：所有 panel 都喂全部 ref，跨场景 block 的无关 ref 污染 agnes 生成结果。

**规则**（每 block 必走，先于 layout / prompt 拼装）：

| block 场景内容 | `blocks[].references[]` 应当包含 | 不应包含 |
|----------------|-------------------------------|----------|
| 含产品（产品演示 / 特写 / 包转） | `product-hero`（v0.7 命名约定的产品图）| 该 block 无关的其他场景图 |
| 含人物（角色入镜） | `character-<role_name>`（角色三视图按角色名）| 无关角色（避免多角色同框污染） |
| 场景切换 / 转场 block | 该 block 起始场景对应的 `scene-<location>` | 其它 location 场景图 |
| 多场景混合 block（少见） | 按 panel 顺序列出全部相关 scene + product + character（envelope 顶层全集）| 无关 ref |
| 纯文字 / 纯 typography / logo endboard | `[]`（空数组，不消费任何 ref） | 任何图 |

**envelope 顶层 `references[]` vs block 级 `references[]`**：

- **envelope 顶层 `references[]`**（必填，Phase 1 收集）：**全集**。`name` 字段是字符串 ID（`product-hero` / `character-<role>` / `scene-<location>`）+ `source` 字段是 base64 data URI（实际图片内容）。一张图只在 envelope 顶层存一次。
- **block 级 `references[]`**（必填，v0.7 新增）：**精挑子集**。每项是 envelope 顶层 `references[].name` 的字符串引用。**不**重复 base64（避免 envelope 膨胀）。

**lint 入口**：
- `step-output-schema.md` §4 必填字段含 `blocks[].references[]`
- `verify-tvc-bundle.sh` §12.6 检查 block schema 含 `references`
- `verify-tvc-bundle.sh` §12.8 检查 video-prompt.md 消费 `blocks[].references[]`（Step 9 拿 block 级 ref 拼 segment 的 `reference_images[]`，不再用 envelope 顶层全集）

**反模式**（自动 reject）：
- ❌ block 含人物入镜但 `references[]` 没 `character-*` → agnes 凭空生成人脸，跨 block 漂移
- ❌ block 跨场景切换但 `references[]` 没对应 scene 图 → 转场前后视觉断裂
- ❌ block `references[]` 是 envelope 顶层全集的复制粘贴 → 浪费 token + 引入无关 ref 污染
- ❌ block `references[]` 出现 envelope 顶层不存在的 `name` → 解析期找不到 base64（hang）

### Panel-Level Reference Tags（v0.8 新增）

**问题**：v0.7 block 级 references[] 是"全 block 共享"，但同一 block 内不同 panel 可能聚焦不同元素（panel 01 = 产品特写 vs panel 05 = 人物反应）。共享 ref 会让 panel 01 收到 character-* 污染，panel 05 收到 product-hero 冗余。

**规则**（每 panel 必填 `reference_tags[]`，先于 prompt 拼装）：

| panel 内容 | `reference_tags[]` 推荐 |
|------------|----------------------|
| 产品特写 / 包转 / 旋转 | `["product-hero"]`（不含 character/scene，避免冗余） |
| 人物反应 / 入镜 / 表情 | `["character-<role_name>"]`（不含 product/scene） |
| 场景切换 / 转场帧 | `["scene-<location>"]` |
| 多元素同框（如人物 + 产品互动）| `["product-hero", "character-<role>", "scene-<location>"]`（按重要性顺序） |
| 纯文字 / typography / logo | `[]`（空数组，不消费） |
| 继承 block 默认 | `[]` 且该 panel 是 block 默认消费（如固定机位 long shot） |

**block 级 vs panel 级关系**：

- block 级 `references[]` 是**全集候选**（agent 默认候选）
- panel 级 `reference_tags[]` 是**精挑子集**（从 block 全集里挑，可能比 block 少或为 `[]`）
- **缺省行为**：panel 级 `reference_tags[]` 缺省 = 继承 block 级 `references[]`（向后兼容，老 envelope 不破）

**反模式**（自动 reject，cheatsheet §4.6 v0.8 新增）：
- ❌ panel 元素只占 1 个但 `reference_tags[]` 含 ≥3 个无关 ref → 污染 agnes
- ❌ panel `reference_tags[]` 出现 envelope 顶层不存在的 `name` → 解析期 hang
- ❌ panel `reference_tags[]` 含 block 级 `references[]` 之外的 ref → 越权（envelope 顶层全集越界）

### Layout Type Decision (6 类 — v0.5)

不再使用 v0.4 的"3×3 clay-white-maquette 默认"。每 block 必须先判断使用哪种 layout，再组装 prompt：

| `layout_type` | 何时用 | Panel 数 | Aspect |
|---------------|--------|---------|--------|
| `grid` | 默认段落分镜；产品演示、场景切换、节奏推进 | 4×3 / 3×3 / 2×2（按 block 时长） | 16:9 / 4:3 |
| `fixed-camera` | 长镜头 / 固定机位对话场景 / 戏剧化停顿 | 1-3（单镜多帧水平排）| 16:9 |
| `scene-planning` | 场景走位调度；人物移动路径；空间布局 | 1（整图俯视 + 走位标注）| 16:9 宽幅 |
| `top-down-staging` | 多人站位、群戏调度、镜头走位预演 | 1（整图俯视 + 角色位置）| 1:1 或 4:3 |
| `action-keyframes` | 动作分解、关键转折、动态捕捉 | 3（水平三连）| 16:9 三联 |
| `narrative-comic` | 情节推进、叙事弧线、悬念揭示 | 4（水平四联 / 2×2）| 16:9 |

**决策原则**（用户覆盖前默认按此）：
- block 内 segment 数 ≥ 3 且需要并列展示不同角度 → `grid`
- block 主导单镜头长拍 → `fixed-camera`
- block 是转场或空间建立（"先看空间，再发生事件"）→ `scene-planning`
- block 涉及多人位置调度 → `top-down-staging`
- block 核心是单动作分解（开盖 / 倾倒 / 冲刺 / 跳跃）→ `action-keyframes`
- block 是叙事弧线推进（4 段起承转合）→ `narrative-comic`

### Visual Style Anchor（视觉跟 selected_style）

- **不再使用黏土白模**作为默认视觉基线
- 视觉风格 = `selected_style` 的视觉语言（摄影 / 色彩 / 光线 / 质感）
- selected_style 的 `category`（cinematic-narrative / commercial-craft / lifestyle-documentary）直接映射 prompt 中的摄影 + 色彩 + 光线描述
- 例：`selected_style = tvc-style-cinematic-food` → 35mm 镜头、暖色温 3200K、大光比、浅景深、食物肌理特写
- 例：`selected_style = tvc-style-brand-manifesto` → 长焦压缩、戏剧化光位、低饱和、电影质感
- prompt 开头必含 `[Visual Style: <selected_style> · <摄影/色彩/光线要点>]`

### 固定人设前置 (Character Setup Pinning)

每段 prompt 开头必粘贴主角人设描述（在 Visual Style 之后、layout 描述之前），用作"防漂移锚点"：

```
[Character Lock: <年龄区间> <性别>, <种族>, <体型>, <发型发色>, <关键服饰>;
 face anchor: <1-2 个不可漂移的面部特征，如左颊痣 / 眉形 / 镜框>]
```

- 例：`[Character Lock: 28-34 female, East Asian, slim build, shoulder-length black hair, white shirt + dark jeans; face anchor: small mole on left cheek]`
- 例：`[Character Lock: 35-40 male, Caucasian, athletic build, short brown hair, navy blazer; face anchor: square jaw + thin-rim glasses]`
- 若 block 无主角（如纯产品 / 纯场景）→ 此项填 `none`，不省略

### Per-Panel 3 项硬强制

每 panel prompt 必带 3 项标注，**缺一即 reject**（QC 在 §4.6 反模式拦截）：

1. **镜头类型 `shot_type`** — 从固定枚举取：`extreme-wide / wide / medium / medium-close-up / close-up / extreme-close-up / over-the-shoulder / top-down / dutch-angle`
2. **角色表演情绪 `character_emotion`** — 从固定枚举取：`calm / tense / joyful / melancholy / determined / surprised / focused / anxious / exhausted / hopeful`（product-only panel 此项可空字符串 `""`，但 key 必出现）
3. **音效标注 `sound_effect`** — 写**具体声音类型**，不是 abstract 词：`dialogue / ambient / music-beat / sfx-impact / silence / vo-over / whoosh / crunch / sizzle / heartbeat / breath / city-noise`

Output shape:
```yaml
storyboard_blocks:
  - block_id: block_01
    range: 0-15s
    layout_type: grid
    visual_style_anchor: tvc-style-cinematic-food
    character_setup: "[Character Lock: 28-34 female, East Asian, slim build, ...]"
    grid_path: workspace/<project>/storyboard/block-01-grid.png
    vein: |
      Opens with ..., continues with ..., closes with ...
    panels:
      - panel_id: 01
        time_range: 0.0-1.2s
        shot_type: ECU
        character_emotion: focused
        sound_effect: ambient
        framing: 产品微旋转...
        camera_move: slow dolly in
        core_action: product spinning micro-rotation
        color_light: studio white 5600K + rim amber
        mood_keyword: premium
      - panel_id: 02
        ...
  - block_id: block_02
    range: 15-30s
    layout_type: action-keyframes
    visual_style_anchor: tvc-style-cinematic-food
    character_setup: none
    grid_path: workspace/<project>/storyboard/block-02-grid.png
    panels: 3
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
- Phase 2: 每个 storyboard block（每 15s 段）生成前 1 次（不分 6 类 layout）
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
  - phase=storyboard_compilation → `status: advanced`, `artifact: { storyboard_blocks[].{layout_type, visual_style_anchor, character_setup, references[], panels[].{shot_type, character_emotion, sound_effect, reference_tags[]}}, storyboard_composite_path }`（v0.5：每 block 含 layout_type 6 选 1 + visual_style_anchor + character_setup + 每 panel 含 shot_type / character_emotion / sound_effect 三键；**v0.7**：每 block 含 `references[]` 精挑子集，引用 envelope 顶层 `references[].name`；**v0.8**：每 panel 加 `reference_tags[]` 精挑子集，缺省继承 block 级 references）
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
- **Artifact kind**: `storyboard_grid`（renderer → `storyboard-canvas` widget）
- **Schema reference**: [references/step-output-schema.md](../references/step-output-schema.md) §4
- **Confirmation block**: 回填 orchestrator §3 模板；phase=materialization 时 gate=strong，必填 user_confirms_storyboard
