---
skill_id: tvc-director
name: tvc-director
description: "TVC 编排入口 - 按 agent-capabilities.json 调度 10 个 tvc-agent-* 协作 agent + 6 个 tvc-style-* 风格库完成产品广告片。触发条件："帮我做一条广告" "TVC 创意" "产品短片" "广告脚本" "品牌广告片" "分镜脚本"。实际执行由各协作 agent 负责；本 skill 不直接产出创意/分镜/提示词。"
---

# TVC Director · 编排入口

## 0. 角色定位

本 skill 是 tvc-director 编排入口，**不直接执行创作任务**，而是按 `agent-capabilities.json::workflow` 调度 10 个 `tvc-agent-*` 协作 agent，配合 6 个 `tvc-style-*` 风格库完成产品广告片。

- **契约权威**：`agent-capabilities.json`（机器读）+ `agent-capabilities.md`（人读速查）
- **执行单元**：10 个协作 agent，每个产出独立交付物
- **美学单元**：6 个 tvc-style-* 风格库，作为 strategy / asset-storyboard / video-prompt 的可选 Inputs
- **知识库**：`references/` 目录 23 个文件，按需由各 agent 通过 Inputs 引用
- **规范权威**：本文 §3 workflow table + §12 状态信封 + §13 失败停机，是所有 agent SKILL.md 中 `## Workflow Context` 段必须对齐的契约

## 1. 触发与不触发

**触发**：
- 用户提供完整产品 brief，需要多方向创意提案
- "帮我做一条 TVC / 广告 / 品牌片"
- "生成广告脚本 + 分镜"
- 任何需要深度导演协作的 TVC 项目

**不触发**：
- 只有一个创意、快速出片的轻量场景（建议直接用 `multimedia-creator` MCP 的 image → video 一次性生成，不必走 10 agent 编排）
- 非广告用途的图片生成
- 空泛请求（先追问 product brief）

## 2. 前置依赖

| MCP | 工具前缀 | 状态 | 配置入口 |
|------|---------|------|---------|
| `multimedia-creator`（Agnes） | `mcp__multimedia-creator__*` | **非内置**，由用户配置 | 用户在 MCP 设置中按官方注册流程加入 |
| `edge-tts` | `mcp__edge-tts__*` | 内置 | 应用启动自动加载，无需配置 |

**未配置 `multimedia-creator` 的降级路径**：
- 可完成 Step 1-5（brief / strategy / shot-planning / asset-storyboard 设计）的所有创意/分镜方案，但 Step 4 之后的 `agnes_image_*` / `agnes_video_*` 调用会失败
- 旁白仍可用 `edge-tts` 生成（独立内置 MCP）
- 视频资产需用户自行在外部平台生成后，导入 `outputs/<项目标识>/videos/` 对应文件位

**副作用提醒**：
- `agnes_video_generate` 触发云端 GPU（**付费调用**，按秒计费）
- 视频生成时若需参考图，会先上传到 `img.remit.ee`（公网图床）
- 商业 Logo / 包装小字 / 价格 / CTA 不由视频模型生成，转交后期

## 3. 调度顺序（10 个协作 agent）

完整 workflow 在 [`agent-capabilities.json`](agent-capabilities.json) 中声明。下表是默认顺序，每一列都是 agent `## Workflow Context` section 必须声明的字段：

| Step | Agent | Gate | Block until | Skip when | Phase count | State envelope |
|------|-------|------|-------------|-----------|-------------|----------------|
| 1 | `tvc-agent-brief` | **strong** | user_confirms_brief | never | 1 | `brief_envelope` |
| 2 | `tvc-agent-strategy` | **strong** | user_selects_route | never | 2 (propose / revise) | `routes_envelope` |
| 3 | `tvc-agent-shot-planning` | weak | - | never | 1 | `shot_plan_envelope` |
| 4 | `tvc-agent-asset-storyboard` | **strong** | storyboard_final_confirmed | never | 3 (asset / compile / materialize) | `storyboard_envelope` |
| 5 | `tvc-agent-voiceover` | **strong** | vo_text_confirmed | never | 1 | `voiceover_envelope` |
| 6 | `tvc-agent-product-action` | weak | - | never | 1 | `product_action_envelope` |
| 7 | `tvc-agent-food-flavor` | weak | - | non_food_product | 1 | `flavor_envelope` |
| 8 | `tvc-agent-packshot` | weak | - | never | 1 | `packshot_envelope` |
| 9 | `tvc-agent-video-prompt` | **strong** | `video_prompts_confirmed` | never | 1 | `video_prompt_envelope` |
| 10 | `tvc-agent-qc` | self_check | - | never | 1 | `qc_envelope` |

**Gate 语义**：
- **strong** —— 必须收到用户明确"继续/确认"才能进下一步；agent 输出 `status: pending_user_confirmation`
- **weak** —— agent 完成即可自动推进，orchestrator 把产物入栈；用户可在任何时候回看
- **self_check** —— agent 内部自检即可，QC 通过 → 输出 `verdict: pass` 收尾；不通过 → 输出 `verdict: block` 并附 `failure_report`

**调度原则**：
- 每个 step 完成后输出固定确认块（参考下方"确认块模板"）
- 强门节点不可跳过；用户输入"继续"才能进下一阶段
- 弱门可记录跳过理由后继续
- Step 7 `tvc-agent-food-flavor` 仅在产品为食品类时启用；其他产品类型登记 `skipped: true`
- 任意 Step 报错时停止编排，按 §13 输出失败报告

**确认块模板**：
```
─── Step X 完成 · <agent-name> ───
状态：<pending_user_confirmation | advanced | skipped>
产出：<artifact keys from state envelope>
下一步：Step Y · <next-agent>
请确认继续，或提出修改意见。
```

## 4. 风格库（6 个 tvc-style-*）

按需挂载到 Step 2 / Step 4 / Step 9 作为 Inputs：

| Style | Category | 适用场景 |
|-------|----------|---------|
| `tvc-style-brand-manifesto` | cinematic-narrative | 信念驱动叙事、情感升级、品牌收束 |
| `tvc-style-industrial-product` | commercial-craft | 工程形态、材质精度、功能演示、受控光 |
| `tvc-style-cinematic-food` | lifestyle-documentary | 食材肌理、过程递进、蒸汽与声音细节 |
| `tvc-style-product-promo` | commercial-craft | 卖点层级、使用情境、利益点揭示、Packshot |
| `tvc-style-one-take` | commercial-craft | 连续空间编排、动机转场、揭示时机 |
| `tvc-style-beat-synced` | commercial-craft | 节奏化运镜、运动-剪辑协调、视觉冲击节拍 |

完整描述见 `agent-capabilities.json::styles`。

## 5. 全局铁律（跨阶段约束）

1. **产品出镜率**：全片产品可见格 ≥ 70%，禁止连续 3 格以上无产品
2. **storyboard-final.png 硬门槛**：必须先生成并经用户确认，才能调用任何 `agnes_video_generate`
3. **产品参与因果**：产品必须是事件原因，不是被摆在中央后用特效制造异常
4. **违禁词强制转译**：禁止使用 cinematic / 电影感 / 高级感 / 氛围感 / 很有张力 等模糊词，必须转译为具体摄影参数；详见 `references/anti-laziness-contract.md` 第一节
5. **每镜单动作单任务**：避免在同一镜头叠加复杂双手操作 + 精确包装 + 人物表情 + 强特效
6. **品牌世界格中产品也必须可见**（占画面 10%-25%，自然融入场景）
7. **跨段提示词独立自包含**：每段 `agnes_video_generate` 提示词不引用前段；段间衔接是后期剪辑层面决策

## 6. Agnes 工具决策树

```
需要生图？
├── 产品多视图（有参考图）→ agnes_image_edit（本地路径 image_paths）
├── 角色设定/场景概念（无参考图）→ agnes_image_generate（DataURI base64）
├── 风格迁移/首帧锚定编辑 → agnes_image_edit
├── 故事板多面板 → agnes_image_edit（有参考图）/ agnes_image_generate（无参考图）

需要生成视频？
├── 5-10s 单片段 → agnes_video_generate（duration: 5/10）
├── 多片段拼接 → 多次 agnes_video_generate + 拼接说明
├── 需要参考图作为起点 → 先上传图片到 img.remit.ee，再用 image 参数传入

需要配音？
└── 旁白/VO → mcp__edge-tts__text_to_speech（voice: zh-CN-XiaoxiaoNeural / zh-CN-YunxiNeural）
```

详细参数与边界条件见 `references/agnes-integration.md`。

## 7. 目录规范

每个 TVC 项目独立隔离，禁止文件跨项目混放。

**项目标识**：`<项目标识>` = `tvc-<产品名>-<MMDD>`，例：`tvc-pet-airpurifier-0905`

**目录结构**：

```
workspace/<项目标识>/             ← 工作区：创意文档 + 中间产物
├── config/                       ← Step 1-3 产出
│   ├── brief-judgment.md
│   ├── creative-strategy.md
│   ├── casting.md
│   ├── route-selection.md
│   ├── scene-progression.md
│   ├── storyboard-spec.md
│   └── product-reference.{jpg,png,md}
├── shot-list/                    ← Step 3-5 产出
│   ├── shot-list.md
│   └── handoff.md
├── storyboard/                   ← Step 4 产出
│   ├── asset-urls.md
│   └── prompt-compile.md
└── voiceover/
    └── voiceover-script.md

outputs/<项目标识>/               ← 产出区：按项目隔离
├── images/
│   ├── product-hero.png
│   ├── character-sheet.png
│   ├── scene.png
│   └── storyboard-final.png      ← Step 4 强门产出
└── videos/
    ├── <project>_final.mp4
    └── seg*-*.mp4
```

**规则**：
1. 所有图片/视频必须写入 `<项目标识>/` 子目录，禁止直接写入 `outputs/images/` 或 `outputs/videos/`（根目录已废弃）
2. workspace 存过程文档和图片生成时的本地路径；outputs 只存最终交付物
3. 参考图来源：用户上传的产品参考图必须复制到 `workspace/<项目标识>/config/product-reference.jpg`
4. URL 索引：`storyboard/asset-urls.md` 记录已上传至 img.remit.ee 的 URL

## 8. 进度跟踪

每进入一个 Step 就勾选对应行；强门节点必须等到用户明确"继续"才能勾选下一行。

```text
[ ] Step 1  tvc-agent-brief（强门）
[ ] Step 2  tvc-agent-strategy（强门 · 2 phases）
[ ] Step 3  tvc-agent-shot-planning
[ ] Step 4  tvc-agent-asset-storyboard（强门 · 3 phases）
[ ] Step 5  tvc-agent-voiceover（强门）
[ ] Step 6  tvc-agent-product-action
[ ] Step 7  tvc-agent-food-flavor（仅食品）
[ ] Step 8  tvc-agent-packshot
[ ] Step 9  tvc-agent-video-prompt
[ ] Step 10 tvc-agent-qc（自检）
```

## 9. 输出合同（每个 Step 的交付物）

| Step | Agent | 交付物 |
|------|-------|--------|
| 1 | tvc-agent-brief | `brief_card`, `strategy_draft` |
| 2 | tvc-agent-strategy | `three_routes`, `selected_route`, `hook_design` |
| 3 | tvc-agent-shot-planning | `scene_anchors`, `shot_handoff_table` |
| 4 | tvc-agent-asset-storyboard | `asset_urls`, `storyboard_final_path` |
| 5 | tvc-agent-voiceover | `voiceover_list` |
| 6 | tvc-agent-product-action | `action_force_chain`, `casting_decision` |
| 7 | tvc-agent-food-flavor | `flavor_layer_plan` |
| 8 | tvc-agent-packshot | `packshot_module` |
| 9 | tvc-agent-video-prompt | `video_clip_prompts` |
| 10 | tvc-agent-qc | `qc_report` |

完整定义见 `agent-capabilities.json::agents[*].outputs`。

## 10. 执行前最终确认（强）

Step 1-5 全部完成后、调用任何 `agnes_video_generate` / `text_to_speech` 之前，必须输出最终确认单：

```
── 执行前最终确认 ──
📋 选定方向：[路线X + 风格Y]
⏱ 时长：[X秒] / 分段：[Y段]
🎬 总镜数：[N镜]
🔊 旁白：[有/无]（预计 VO 时长 Xs）
🖼 产品参考图：[已上传 / 待上传]
🎞 故事板资产图：[已完成 / 待生成]

请确认以上信息无误后输入"继续生成"，或提出修改。
未收到明确确认 → 不执行任何生成操作。
```

## 11. 参考文件

- `agent-capabilities.json` — 10 agent + 6 style 接口契约（机器读）
- `agent-capabilities.md` — 人读速查表
- `references/` — 23 个知识库文件，由各 agent 通过 Inputs 按需读取
- 10 个 `tvc-agent-*/SKILL.md` — 协作 agent 主体
- 6 个 `tvc-style-*/SKILL.md` — 风格库
- `scripts/verify-tvc-bundle.sh` — bundle 完整性校验脚本（含 §11 cheatsheet 36 项）
- `references/asset-prompting-cheatsheet.md` — **资产生成提示词权威**（4 类资产 / 6 段 schema / Failure Recovery），§14 / §15 引用此表

---

## 12. 统一状态交接信封（State Envelope）

每个 agent 完成时 **必须** 输出如下信封结构（YAML），orchestrator 据此推进 workflow：

```yaml
<envelope_type>:                  # 见 §3 表 "State envelope" 列
  step: <1..10>                   # 步骤编号
  agent: <skill_id>               # 例如 tvc-agent-brief
  phase: <phase_name>             # 当前阶段（多 phase agent 用 phase 名区分）
  status: <pending_user_confirmation | advanced | skipped | failed>
  artifact:                      # 本次产出的 artifact 对象
    <key>: <value>                # 见 §9 输出合同
  next_step: <11 | next step>     # 失败时为 null
  gate: <strong | weak | self_check>
  skip_reason: <string | null>    # 仅 skipped 时填写
  failure:                       # 仅 failed 时填写
    code: <string>
    message: <string>
    partial_artifacts: <list>     # 已完成但未提交的部分
  produced_at: <ISO-8601>
```

**envelope_type 清单**（与 §3 State envelope 列一一对应）：

| Envelope | 关联 Step | 关键 artifact keys |
|----------|-----------|-------------------|
| `brief_envelope` | 1 | brief_card, strategy_draft |
| `routes_envelope` | 2 | routes, recommendation, selected_route, hook_design |
| `shot_plan_envelope` | 3 | scene_anchors, shot_handoff_table |
| `storyboard_envelope` | 4 | asset_urls, storyboard_composite_path, materialized_artifacts |
| `voiceover_envelope` | 5 | voiceover_list |
| `product_action_envelope` | 6 | action_force_chain, casting_decision |
| `flavor_envelope` | 7 | flavor_layer_plan (skipped 时输出 `skipped: true`) |
| `packshot_envelope` | 8 | packshot_module |
| `video_prompt_envelope` | 9 | video_clip_prompts |
| `qc_envelope` | 10 | qc_report（含 verdict: pass / pass-with-remarks / block） |

**status 取值语义**：
- `pending_user_confirmation` —— strong gate，orchestrator 必须等用户回复
- `advanced` —— weak gate，自动推进到 next_step
- `skipped` —— orchestrator 已登记 skip，agent 不执行；`artifact` 为空
- `failed` —— agent 报错，按 §13 输出失败报告

## 13. 失败停机规范

任意 Step 失败时，orchestrator **立即停止推进**，并按如下格式输出 `failure_report`：

```yaml
failure_report:
  failed_step: <N>
  failed_agent: <skill_id>
  failed_phase: <phase name | null>
  code: <error_code>              # 例: input_missing / mcp_unavailable / upload_failed / model_rejected
  message: <human-readable string>
  completed_artifacts:           # 此前已成功完成的 envelope 列表（仅 successful / skipped / advanced）
    - step: 1
      envelope: brief_envelope
      artifact_keys: [brief_card, strategy_draft]
      produced_at: <ISO-8601>
    - step: 2
      envelope: routes_envelope
      ...
  recoverable: <true | false>     # 是否可通过修正 input 后重试本 step
  remediation_hint: <string>      # 例如 "上传产品参考图后重试 Step 4 Phase 1"
```

**恢复策略**：
- `recoverable: true` —— 用户修复后用 `resume-from-step:<N>` 续跑（不重做已完成 step）
- `recoverable: false` —— 须回退到上一个 strong gate（如 Step 1 / 2 / 4 / 5）重做
- `qc_envelope` 返回 `verdict: block` 不算 failure，而是 §10 强门拒绝；用户修改后回到对应 step

> **MCP 生成失败必停**：本节所有 failure 必须走 [`references/asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md) §5 的 4 选项 grilling（`retry_same` / `revise_prompt` / `retry_revised` / `abort_step`），禁止降级 / 禁止跳过 / 禁止用旧资产顶替。

---

## 14. Pre-Generation Confirmation Gate

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md) §5 + §6.1。

每次 MCP 生成调用（`agnes_image_generate` / `agnes_image_edit` / `agnes_video_generate` / `edge-tts.text_to_speech`）执行前，**必须**先向用户展示 prompt + reference images + 预期输出，等用户确认后才执行。**禁止**默认放行、**禁止**自动批跑、**禁止**用旧产物顶替。

### 14.1 触发范围

| Agent | Step | 触发时机 | 详细规范 |
|-------|------|---------|---------|
| `tvc-agent-asset-storyboard` | 4 | Phase 1 每个 asset class；Phase 2 每个 storyboard block | agents/asset-storyboard.md "Pre-Generation Confirmation Gate" |
| `tvc-agent-voiceover` | 5 | 每条 VO line | agents/voiceover.md "Pre-Generation Confirmation Gate" |
| `tvc-agent-product-action` | 6 | 每个 action chain illustration / cast reference sheet | agents/product-action.md "Pre-Generation Confirmation Gate" |
| `tvc-agent-video-prompt` | 9 | 全部 segments 一次性聚合展示（按 segment 顺序） | agents/video-prompt.md "Pre-Generation Confirmation Gate" |

**不触发**：Step 1-3（无 MCP 调用）、Step 7-8（plan 文档，不调 MCP）、Step 10（QC 自检不调 MCP）、`tvc-agent-asset-storyboard` Phase 3 materialization（仅文件落盘，无新生成）。

### 14.2 聚合粒度

按 Q24 推荐「Phase + 调用单元聚合」，每个 TVC 项目预估 10-15 次 Pre-Gen Confirmation：

| Phase | 聚合粒度 | 单次展示内容 |
|-------|---------|------------|
| 4 Phase 1 (asset_generation) | per asset class | 1 prompt + N references |
| 4 Phase 2 (storyboard_compilation) | per storyboard block | 1 prompt + 4-9 references（按 segment） |
| 5 (voiceover) | per VO line | 1 vo_text + voice_id + 预期时长 |
| 6 (product-action) | per action chain / cast | 1 prompt + N references |
| 9 (video-prompt) | 全部 segments 一次性 | N prompts + N first_frames + N references |

**禁止**逐次 MCP 调用问用户 → 按上表单元聚合，避免 grilling 疲劳。

### 14.3 用户取消 / 修改

- 用户点击「取消」或对 prompt 提出修改意见 → 触发 4 选项 grilling（cheatsheet §5.2）：
  - `retry_same`（60%）/ `revise_prompt`（25%）/ `retry_revised`（10%）/ `abort_step`（5%）
- 用户输入"继续生成"或"确认" → 推进当前调用单元 + 等待下一个单元确认
- 连续 3 次同单元 retry 失败 → 自动升级到 `abort_step`

### 14.4 失败必停 + 必 grilling（铁律）

**禁止降级 / 禁止跳过 / 禁止用旧资产**——任意 MCP 生成失败必走 §13 failure_report + 4 选项 grilling（cheatsheet §5.2）。`partial_asset_saved` 时 partial 落盘到 `workspace/<项目>/storyboard/.partial/` 后才允许 retry（不丢失已完成 work）。

### 14.6 与现有 §10 的关系

- §10「执行前最终确认」是 **TVC 项目级**最终确认（Step 1-5 全完后、首次调用 `agnes_video_generate` 前）
- §14「Pre-Gen Confirmation Gate」是 **MCP 调用级**逐次确认（覆盖所有生成调用）
- 两者并存不冲突：§10 触发条件达成时先走 §10，再进入 §14 逐次确认

---

## 15. Adaptive Storyboard Grid（段落分镜自适应网格）

**Authoritative reference**: [`references/asset-prompting-cheatsheet.md`](references/asset-prompting-cheatsheet.md) §4.4 + §6.3。

故事板（Step 4 Phase 2 唯一硬交付物）按 segment 时长自适应选择网格，避免"30s 强塞 3×3"或"12s 浪费 3×3"。

### 15.1 段落分镜拆分算法（用户可在 Step 4 Phase 2 覆盖）

| 成片时长 T | 段数 = `ceil(T/10)` | 默认段长分配 | 默认网格 |
|-----------|---------------------|-------------|---------|
| T < 5s | 1 | T（单段）| 首尾帧（2 联） |
| 5s ≤ T < 10s | 1 | T（单段）| 2×2 |
| 10s ≤ T < 20s | 2 | 向上 5s 倍数拆分 | 全部 3×3（若 ≥10s）|
| 20s ≤ T < 30s | 3 | 向上 5s 倍数拆分 | 全部 3×3（若 ≥10s）|
| 30s ≤ T < 45s | 3-4 | 向上 5s 倍数拆分 | 视每段时长 |
| T ≥ 45s | ≥5 | 拆为多个 15s 板块 | 按板块内 segment 时长 |

**段长分配规则**：每段时长向上取整到 5s 倍数（例：25s → 3 段 → 10s/10s/5s，2 段 3×3 + 1 段 2×2）。

### 15.2 网格 → 提示词映射

| 段落分镜时长 | 网格 | 提示词模板 |
|------------|------|---------|
| ≥10s | 3×3（9 格）| cheatsheet §4.3 "3行3列" 模板 |
| 5s ~ <10s | 2×2（4 格）| cheatsheet §4.3 "2行2列" 模板 |
| <5s | 首尾帧（2 联）| cheatsheet §4.3 "单图首尾帧" 模板 |

### 15.3 用户覆盖

- Step 4 Phase 2 入口 orchestrator 必须问用户：「按默认算法拆分为 N 段（segment X-X 秒），是否调整？」
- 用户答复「按默认」→ 应用 §15.1 默认算法
- 用户答复「强制 X 段 / 每段 Y 秒」→ 覆盖算法，但 orchestrator 必须 grilling 确认 segment 总和 = T 且每段时长 ≥ 3s 且 ≤ 10s（Agnes 上限）
- 用户答复「不分段，单段」→ 仅当 T ≤ 10s 时允许；T > 10s 必须 grilling 解释"超出 Agnes 上限会被截断"

### 15.4 与 §3 / §4 / §11 的关系

- §3 workflow table Step 4 仍标 `gate: strong`（Phase 3 materialization 强门不变）
- §4 Phase 1 (asset_generation) 不分网格（每类资产单图）
- §11 verify-tvc-bundle.sh §11 36 项校验覆盖网格算法 + 提示词模板完整性

---

## 16. 统一 Step Output Schema（desktop chat UI 渲染契约）

**Authoritative reference**: [`references/step-output-schema.md`](references/step-output-schema.md)。

每一步完成时**必须**输出**一个** JSON envelope（schema v1），desktop chat UI renderer 按 `artifact_kind` 路由到对应 widget。**JSON 是唯一权威**——YAML 仅作 prettify 展示。

### 16.1 统一 envelope schema（10 步共用）

```json
{
  "schema_version": "1",
  "envelope_type": "<详见 §16.3>",
  "step": 1..10,
  "agent": "<skill_id>",
  "phase": "<phase_name | null>",
  "status": "pending_user_confirmation | advanced | skipped | failed",
  "gate": "strong | weak | self_check",
  "produced_at": "<ISO-8601>",
  "artifact_kind": "<详见 §16.4>",
  "artifact": { /* artifact_kind 决定 schema */ },
  "references": [{ "name", "type", "source", "size_bytes?" }],
  "prompts": [{ "label", "text", "target_mcp", "call_unit" }],
  "next_action": { "type", "label", "options?" },
  "blocker": "<string | null>",
  "failure": { "code", "message", "recoverable", "remediation_hint", "completed_artifacts" } | null,
  "skip_reason": "<string | null>"
}
```

### 16.2 设计原则

1. **JSON 唯一权威**：renderer 解析 JSON；YAML 是 prettify（自动生成）
2. **`artifact_kind` 驱动 widget**：renderer 不需要额外 widget hint，看 `artifact_kind` 路由
3. **Strict schema**：必填字段缺失 → render fail；可选项标 `optional`，缺省 `null`
4. **不做双格式**：旧 §12 YAML envelope 已废弃，由本节取代；v0.3 同时支持 JSON + YAML（兼容层），v0.4 仅 JSON

### 16.3 envelope_type ↔ artifact_kind 映射

| Step | envelope_type | artifact_kind | widget 变体 |
|------|--------------|---------------|------------|
| 1 | `brief_envelope` | `brief` | brief-card |
| 2 | `routes_envelope` | `routes` | routes-comparison |
| 3 | `shot_plan_envelope` | `shot_plan` | shot-table |
| 4 | `storyboard_envelope` | `storyboard_grid` | storyboard-canvas |
| 5 | `voiceover_envelope` | `voiceover_list` | vo-timeline |
| 6 | `product_action_envelope` | `product_action_chain` | force-chain |
| 7 | `flavor_envelope` | `flavor_plan` | flavor-layers |
| 8 | `packshot_envelope` | `packshot_module` | packshot-spec |
| 9 | `video_prompt_envelope` | `video_prompts` | segment-queue |
| 10 | `qc_envelope` | `qc_report` | qc-verdict |

### 16.4 status ↔ renderer 行为

| status | gate | renderer 行为 |
|--------|------|-------------|
| `pending_user_confirmation` | strong | 渲染按钮组，禁用 next_action |
| `advanced` | weak / self_check | 无按钮，自动进入下一步 |
| `skipped` | any | 显示 skip_reason，淡化 widget |
| `failed` | any | 渲染 4 选项 grilling（next_action.options） |

### 16.5 完整 10 种 artifact schema

详见 [`references/step-output-schema.md`](references/step-output-schema.md) §1-§10。每种含：

- JSON Schema（必填字段 + 可选字段）
- 必填字段清单
- renderer 提示

### 16.6 与 §14 Pre-Gen Confirmation 的复用

每个 envelope 的 `prompts[]` 数组是 §14 的数据源：

```json
{
  "prompts": [
    {
      "label": "storyboard_block_01",
      "text": "故事板图，3行3列...",
      "target_mcp": "agnes_image_generate",
      "call_unit": "block_01"
    }
  ]
}
```

- `prompts[].text` = 展示给用户的完整 prompt
- `prompts[].target_mcp` = 调用目标（`agnes_image_generate` / `agnes_video_generate` / `edge-tts.text_to_speech`）
- `prompts[].call_unit` = cheatsheet §5.2 的 4 选项触发单元
- `prompts[].reference_images` = 与顶层 `references[]` 共享 schema

### 16.7 Widget Routing 速查

完整 routing table 见 [`references/step-output-schema.md` §11](references/step-output-schema.md)。Renderer 实现：

```
envelope.artifact_kind → widget 变体 → 渲染对应 artifact 子对象
                        ↓
                  SlateboardShell (timeline + slate body + actions row 来自 preview/slateboard-widget.html)
```

每个 widget 变体由独立 React 组件实现，但外壳（slateboard shell）统一：

- Timeline（10 个 step cells，含 status / current / done / skipped）
- Slate body（plug-in，按 artifact_kind 切换内部组件）
- Actions row（按 status + next_action 切换按钮组）

### 16.8 与旧 §12 的关系

- 旧 §12 YAML envelope **已废弃**，由本节 JSON envelope 取代
- 兼容层：renderer 在 JSON 解析失败时 fallback 到 YAML（warn 但不阻断），v0.3 支持，v0.4 移除
- 迁移路径：所有 agent 在 v0.3 切换到输出 JSON envelope；v0.4 完全移除 YAML

---

## 17. 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.3 | 2026-09 | 16 个独立 skill 合并；Step 9 gate 升 strong；§14 Pre-Gen Confirmation；§15 Adaptive Grid；cheatsheet 引入 |
| v0.3+ | 2026-09 | §16 统一 Step Output Schema（JSON envelope + artifact_kind 路由 widget） |