# TVC 导演 (tvc-director)

导演级的产品广告片编排入口。基于 **multimedia-creator MCP（Agnes）** + **edge-tts**，调度 10 个协作 agent + 6 个风格库完成 TVC 创作，每个强门节点必须等用户明确确认才能继续。

> 与"快速生成单段视频"的差别：tvc-director 是**完整的多轮导演协作**（brief → 创意路线 → 分镜 → 故事板 → 多段视频 → 旁白 → QC），适合 15-30s 的品牌广告 / 产品短片 / 品牌故事片。轻量场景请直接用 `multimedia-creator` MCP 的 image → video 一次性生成，不必走 10 agent 编排。

> **v0.3 schema breaking change**: 16 个独立 `tvc-agent-*` / `tvc-style-*` skill 目录已**合并**进 `tvc-director/agents/` 与 `tvc-director/styles/` 下的扁平 `.md` 文件（无 frontmatter）。AI 不再能独立触发子 skill；只能通过 `tvc-director` 编排入口进入。详见 `agent-capabilities.json::internal_path` 字段。

## 典型场景

- 用户提供完整产品 brief，需要多方向创意提案
- "帮我做一条广告 / TVC / 品牌片"
- "生成广告脚本 + 分镜"
- 任何需要深度导演工作的 TVC 项目（15s / 30s / 自定义时长）

## 架构（v0.3 合并版）

```
tvc-director/                       ← 编排入口（本 skill）
├── agent-capabilities.json         ← 契约权威（机器读；含 internal_path）
├── agent-capabilities.md           ← 人读速查表
├── SKILL.md                        ← 编排规则 + 全局铁律（§14 Pre-Gen Confirmation Gate / §15 Adaptive Storyboard Grid）
├── scripts/verify-tvc-bundle.sh    ← bundle 一致性校验（90 项，含 §11 cheatsheet 36 项）
├── references/                     ← 24 个知识库文件（含 asset-prompting-cheatsheet.md）
│   └── asset-prompting-cheatsheet.md  ← 资产生成提示词权威（4 H2 × 6 H3 + Failure Recovery）
├── agents/                         ← 10 个协作 agent（扁平 .md，无 frontmatter）
│   ├── brief.md
│   ├── strategy.md
│   ├── shot-planning.md
│   ├── asset-storyboard.md
│   ├── voiceover.md
│   ├── product-action.md
│   ├── food-flavor.md
│   ├── packshot.md
│   ├── video-prompt.md
│   └── qc.md
└── styles/                         ← 6 个风格库（扁平 .md，无 frontmatter）
    ├── brand-manifesto.md
    ├── industrial-product.md
    ├── cinematic-food.md
    ├── product-promo.md
    ├── one-take.md
    └── beat-synced.md
```

## 六轴配置（用户第一轮确认）

| 轴 | 选项 |
|----|------|
| 时长 | 15 秒 / 30 秒 / 自定义 X 秒 |
| 旁白 | 有旁白 / 无旁白 / 两套完整版本 |
| 生成模式 | 直出（自然运镜）/ 九宫格（先审稿） |
| 视频模型 | 使用推荐 / 指定模型 |
| 分段数 | 单段 / 多段拼接 / 按 Agnes 能力自动选择 |
| 节奏与镜头密度 | 快节奏商业版 (14-18 镜) / 标准 (11-14 镜) / 克制电影节奏 (8-10 镜) / 自定义 |

## 时长能力

- **15s**：最少 2 段（5s+10s 或 8s+7s）
- **30s**：3-6 段（每段 5-10s）
- **>15s**：自动拆为多个 15s 故事板块（多块需额外范围规划）
- **≤15s**：直接进 Step 4，跳过 storyboard 范围规划

## 10 步调度（强/弱门对照）

完整 workflow table 含 Phase count / State envelope 列，定义在 [`SKILL.md` §3](SKILL.md#3-调度顺序10-个协作-agent) 与 [`agent-capabilities.md`](agent-capabilities.md)。下面是概览：

| Step | Agent | Gate | Block until | Skip when | Phases | State envelope |
|------|-------|------|-------------|-----------|--------|----------------|
| 1 | `tvc-agent-brief` | **strong** | `user_confirms_brief` | never | 1 | `brief_envelope` |
| 2 | `tvc-agent-strategy` | **strong** | `user_selects_route` | never | 2 (propose/revise) | `routes_envelope` |
| 3 | `tvc-agent-shot-planning` | weak | - | never | 1 | `shot_plan_envelope` |
| 4 | `tvc-agent-asset-storyboard` | **strong** | `storyboard_final_confirmed` | never | 3 (asset/compile/materialize) | `storyboard_envelope` |
| 5 | `tvc-agent-voiceover` | **strong** | `vo_text_confirmed` | never | 1 | `voiceover_envelope` |
| 6 | `tvc-agent-product-action` | weak | - | never | 1 | `product_action_envelope` |
| 7 | `tvc-agent-food-flavor` | weak | - | `non_food_product` | 1 | `flavor_envelope` |
| 8 | `tvc-agent-packshot` | weak | - | never | 1 | `packshot_envelope` |
| 9 | `tvc-agent-video-prompt` | **strong** ⚡ | `video_prompts_confirmed` | never | 1 | `video_prompt_envelope` |
| 10 | `tvc-agent-qc` | self_check | - | never | 1 | `qc_envelope` |

⚡ = v0.3 由 weak 升级为 strong；Step 9 视频 prompt 必须经用户确认后才提交 `agnes_video_generate`。

**统一状态交接信封** + **失败停机规范** 见 [`SKILL.md` §12-§13](SKILL.md)。每个 agent 的 `## Workflow Context` section 是与 orchestrator 对齐的可执行契约，由 `verify-tvc-bundle.sh` 自动校验。

## Pre-Generation Confirmation Gate（v0.3 新增）

每次 MCP 生成调用（Step 4 / 5 / 6 / 9）执行前，**必须**先向用户展示 prompt + reference images + 预期输出，等用户确认后才执行。详见 [`SKILL.md` §14](SKILL.md) 与 [`asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md) §5。

**触发范围 + 聚合粒度**：

| Agent | Step | 触发时机 | 聚合粒度 |
|-------|------|---------|---------|
| `tvc-agent-asset-storyboard` | 4 | Phase 1 每个 asset class；Phase 2 每个 storyboard block | per asset_class / per storyboard_block_id |
| `tvc-agent-voiceover` | 5 | 每条 VO line | per vo_id |
| `tvc-agent-product-action` | 6 | 每个 action chain illustration / cast reference sheet | per call_unit |
| `tvc-agent-video-prompt` | 9 | 全部 segments 一次性聚合展示 | per segment（一次性展示全部）|

**失败必停**：任意 MCP 生成失败 → 必走 4 选项 grilling（`retry_same` / `revise_prompt` / `retry_revised` / `abort_step`）。**禁止降级 / 禁止跳过 / 禁止用旧资产**。

## Adaptive Storyboard Grid（v0.3 新增）

故事板（Step 4 Phase 2 唯一硬交付物）按 segment 时长自适应选择网格，避免"30s 强塞 3×3"或"12s 浪费 3×3"。详见 [`SKILL.md` §15](SKILL.md) 与 cheatsheet §4.4。

| 段落分镜时长 | 网格 |
|------------|------|
| ≥10s | 3×3（9 格）|
| 5s ~ <10s | 2×2（4 格）|
| <5s | 首尾帧（2 联）|

## 依赖 MCP

| MCP | 状态 | 说明 |
|------|------|------|
| `multimedia-creator` (Agnes) | **非内置，用户配置** | 图像/视频生成；用户在 MCP 设置中加入 |
| `edge-tts` | **应用内置** | 旁白/配音；启动自动加载 |

未配置 `multimedia-creator` 时，仍可完成 Step 1-5 创意/分镜方案和 edge-tts 配音，视频资产需用户在外部平台生成后导入。

## 副作用提醒

- `agnes_video_generate` 触发云端 GPU，**按秒计费**
- 视频参考图会先上传到 `img.remit.ee`（公网图床）
- 商业 Logo / 包装小字 / 价格 / CTA 不由视频模型生成，转交后期

## 全局铁律（跨阶段约束）

1. 产品出镜率 ≥ 70%，禁止连续 3 格无产品
2. `storyboard-final.png` 硬门槛：先有故事板才能 `agnes_video_generate`
3. 产品参与因果（不是被动道具）
4. 违禁词强制转译（cinematic / 电影感 / 高级感 等）
5. 每镜单动作单任务
6. 品牌世界格中产品也必须可见（10%-25%）
7. 跨段提示词独立自包含（不引用前段）

## 详细参考

- [`SKILL.md`](SKILL.md) — 编排规则、Agnes 工具决策树、目录规范、§14 Pre-Gen Confirmation Gate、§15 Adaptive Storyboard Grid
- [`agent-capabilities.json`](agent-capabilities.json) — 契约权威（机器读；含 `internal_path` 字段）
- [`agent-capabilities.md`](agent-capabilities.md) — 人读速查表
- [`references/asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md) — **资产生成提示词权威**（v0.3 新增）
- [`references/`](references/) — 24 个知识库文件（含 cheatsheet）
- `agents/*.md` — 10 个协作 agent（扁平 .md，无 frontmatter）
- `styles/*.md` — 6 个风格库（扁平 .md，无 frontmatter）

## 校验

```bash
bash scripts/verify-tvc-bundle.sh
```

校验 90 项一致性检查：JSON 合法性、10 agent / 6 style 文件存在（用 `internal_path`）、各 agent `## Workflow Context` 完整、`references_on_demand` 全部可达、workflow 与 agents 一致、cheatsheet 完整性（§11 含 4 H2 章节 + 24 H3 子段 + 4 cross-link + 4 agent pre-gen section = 36 项）。

## v0.3 升级摘要

- 16 个独立 skill 目录合并进 `tvc-director/agents/` 与 `styles/`（扁平 .md，无 frontmatter）
- `agent-capabilities.json` 增加 `internal_path` 字段；`skill_id` 保留供 cross-reference
- Step 9 (`tvc-agent-video-prompt`) gate 由 weak 升级为 strong
- 新增 [`SKILL.md` §14](SKILL.md) Pre-Generation Confirmation Gate
- 新增 [`SKILL.md` §15](SKILL.md) Adaptive Storyboard Grid（段落分镜自适应）
- 新增 [`references/asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md)（4 H2 × 6 H3 + Failure Recovery）
- `references/` 从 23 增至 24 个文件
- `verify-tvc-bundle.sh` §11 新增 cheatsheet 36 项完整性校验
- `food-flavor` 的 do_not 修正（与 workflow.skip_when 不再矛盾）
- 修 `food-flavor` 之前「Do not skip」的反向表述 → 改为「Do not run for non-food」