---
name: creative-video-suite
version: "4"
description: 综合剧情视频创作套件（drama + commercial），由 short-drama 与企业宣传两条路径组成，专攻有完整故事线的剧情内容（短剧/微电影/动画/动态漫/预告片）。视频生成走 multimedia-creator MCP（agnes-image-2.5-flash + agnes-video-2.5-flash）。用户在 planner / assets 阶段可选 6 个视觉风格预设（写实电影 / 3D 国漫 / 日漫赛璐璐 / 赛博朋克 / 古风 / 广告质感），全局风格锚点一字不变贯穿 5 阶段；commercial 分支 style_ref 是强门控，未提供则追问。适用于 5 阶段剧情流水线、UGC口播、企业宣传片。
---

# Creative Video Suite · 综合剧情视频创作套件

## 路由边界

| 关键词命中 | 路由到 |
|---|---|
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |

## 工具调用契约

**所有图像 / 视频生成必须通过 `multimedia-creator` MCP**（`.mcp.json` 已注册，server.py 走 agnes 国内版 `https://api.agnes-ai.cn/v1`）。

| MCP 工具 | 用途 | 关键参数 |
|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图（T2I） | `model="agnes-image-2.5-flash"`, `size="1K"\|"2K"\|"3K"\|"4K"`, `ratio`, `prompt` |
| `mcp__multimedia-creator__agnes25_image_edit` | 图生图 / 多图合成（I2I） | `model="agnes-image-2.5-flash"`, `image_paths=["path1",...]`, `prompt`, 可选 `mask_path` |
| `mcp__multimedia-creator__agnes25_video_generate` | 视频生成 | `model="agnes-video-2.5-flash"`, `mode="text"\|"keyframe"\|"reference"`, `size="720P"`, `seconds="4"-"12"`, `aspect_ratio`, `timeout_seconds=600`, `poll_interval_seconds=5`, 按 `mode` 决定 `first_frame` / `last_frame` / `images=["path1",...]` (≤5) / `audios=[]` / `videos=[]` |
| `mcp__multimedia-creator__agnes25_upload_image` | 本地文件 → HTTPS URL（图床上传） | `path`（绝对本地文件路径）。**drama 流水线不主动调**（用 `image_generate` 返回的 `data[0].url` 就够），仅当必须把已有本地图变 URL 又缺 `image_generate` 历史时调用；并发撞图床 QPS 限流（429 等 15s），单批 ≤ 5 张 + 间隔 2-3s |

**完整 MCP 调用正确性规范**（mode 决策树 / 跨工具链 URL 传递契约 / 失败处理与降级禁止 / 命名空间对照 / per-stage tool map / 调用前 10 项自检）见 `references/mcp-usage-guide.md`。

**多图引用语法（image / video 通用）**：`images[]` / `image_paths[]` 按传入顺序从 1 开始编号，prompt 中用 `<Picture 1>` / `<Picture 2>` / ... 引用对应图片。

- `images[]` ≤ 5：reference 模式
- `image_paths[]` ≤ 8：image_edit 模式
- `audios[]` ≤ 3（video）
- `videos[]` 0（video 2.5-flash 不接受 video ref）

**🔒 MCP 调用前 5 步硬门控（每次调 MCP 工具前必过，全过才允许调）**：

0. **产品图门控**：用户 brief 含产品关键词（品牌名 / 商品词 / 广告剧情信号）→ 用户已上传产品图 + 落 `<workspace>/.../04_assets/product-refs/<产品名>.{jpg,png}`，**或**用户**显式 ack 降级**（无产品图直接生成）→ 落 `project.json.notes.product_image_gate: "bypassed-by-user"`。**drama 和 commercial 同级强门控**——drama 涉及品牌植入 / 产品道具也必传。详见 `references/mcp-usage-guide.md` §1
1. **输入源按工具拆分**（2026-09-08 拆分）：
   - **`image_edit` 字段**（`image_paths` / `mask_path`）：**允许 3 种**（HTTPS URL / `data:image/...;base64,...` data URI / 本地路径）。hosted_mcps wrapper 对本地路径 client-side 编码为 data URL 后传入 agnes（**不**走 `img.remit.ee`）；data URI / HTTPS URL pass through。推荐优先 HTTPS URL（与上下游 URL 流一致），data URI 受 256KB Sidecar SSE 红线约束。
   - **`video_generate` 字段**（`images[]` / `first_frame` / `last_frame` / `audios[]`）：**只允许 HTTPS URL**。hosted_mcps 对本地路径 / data URI 都做"上传 `img.remit.ee` 拿 URL"处理（因为 agnes 视频 API 只接受公开可访问 HTTPS URL），并发撞图床 QPS 限流 5xx。完整规范见 `references/agnes-ai-api.md`「输入源支持 · 按工具拆分」章节
2. **中文 prompt 铁律**：所有 `prompt` 参数中文（语法例外：`<Picture N>` / `mode="text"` 等 enum / 参数键名 / 数值字面量保持英文）。详见 `references/agnes-ai-api.md` 范例（已全部中文）
3. **mode ↔ params 互斥自检**：text 模式无图 / keyframe 必有 first_frame / reference 必传 images[]；`mask_path` 只对 image_edit 有效；`audios[]` / `videos[]` 仅 video 接受。详见 `references/mcp-usage-guide.md` §2.3
4. **参数 schema 边界**：`size=720P` 锁死 / `seconds="4"-"12"` 字符串 / `aspect_ratio` 与 first_frame 比例一致（不一致先 image_edit 转比例）。**时长边界完整约束见 `references/agnes-ai-api.md §视频时长边界（单一权威）`**（包括 4 秒下限、12 秒上限、9 个合法字符串值集合、各分支锁定策略、边界外异常处理）。详见 `references/agnes-ai-api.md` 参数表
5. **image_generate 必须显式 `ratio:`**（2026-09-09 加，**单一权威**见下方「🔒 image_generate ratio 分支默认表」）——`mcp__multimedia-creator__agnes25_image_generate` 漏传 `ratio` 时 MCP 兜底默认 `1:1`（详见 `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` `DEFAULT_IMAGE_RATIO`），是图锁 1:1 的直接来源；skill 模板**必须**显式传 `ratio: "<分支默认>"`（占位符 `{{default_ratio_for_branch}}`），**不得**依赖 MCP 默认。

6 步全过才允许调 MCP 工具，**任何一项不过 = 该阶段未完成**。

**🔒 image_generate ratio 分支默认表（单一权威 · 2026-09-09 加）**：

| 分支 | 默认 ratio | 例外 |
|---|---|---|
| drama（短剧 / 剧情 / 微电影） | `9:16` | 横屏需求（电影预告片 / 宽屏剧情片）→ `16:9` |
| Commercial · Marketing（产品广告） | `9:16` | 平台级例外：抖音 / 小红书 / 快手 / 视频号 / 竖屏信息流走 `9:16`；电视 / TVC / Web / 官网 / YouTube / 横版展播走 `16:9`；电商详情页 / 方形卡片走 `1:1`；平台未定 → `9:16`。详见 `references/commercial/product-marketing-ad-video-no-storyboard-ref.md`「平台→比例」段 |
| Commercial · UGC（口播 / 种草） | `9:16` | 抖音 / 小红书 / 快手默认 `9:16`；B站横屏 `16:9` |
| Commercial · Corporate（企业宣传 / 商务） | `16:9` | 路演 / 招商 / 客户案例 → `16:9`；短视频版（1 分钟内）→ `9:16` |

**比例合法值集合**：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9`（**禁**其它比值，含 `2:1` / `9:18` / `1.85:1` 等变体；agnes 端会回 `invalid_ratio`）。

**为什么是单一权威**：ratio 是 creative-video-suite 各分支的视觉语言核心——drama 9:16 适配手机竖屏用户，Corporate 16:9 适配企业大屏，UGC 9:16 适配信息流；漏传 → MCP 默认 1:1 → 与目标平台视觉规范脱节 → 投放效果受损。**所有 image_generate 调用模板**（`references/mcp-call-templates.md` T02 / T06 / T07 / T08 / T11 / T13）已硬编码 `ratio: "{{default_ratio_for_branch}}"` 占位符，**不**依赖 MCP 默认。

**🔒 MCP 调用模板硬编码铁律（2026-09-08 用户锁定，所有需要参考图的生成必过）**：

**核心约束**：AI **不得**在涉及参考图的生成中自由组合 `mode` / `images[]` / `first_frame` / `prompt` 结构——必须字面照抄 `references/mcp-call-templates.md` 对应 T 编号模板（按场景编号 T01-T13；T13 为 2026-09-09 新增的产品多视角宫格图 image_generate 模板）。

```text
调 image_edit 之前 → 读 T01-T03（转比例 / 多图合成 / 局部编辑）
调 video_generate 之前 → 读 T04-T12，按 (分支 × ref 类型) 决策表选唯一合法模板
调 image_generate 多视角产品图之前（opt-in 触发时） → 读 T13 image_generate_multiview_grid
```

**🔗 创意方向横切（2026-09-09 加）**：planner 阶段创意方向未定时 → 读 `references/commercial/creative-templates-from-9-references.md` 选模板（9 抖音参考视频拉片提炼 + 决策树：按产品类型 / 品牌调性 / 投放目标三维度匹配）；3 路 commercial ref（`ugc-talking-video-ref.md` / `product-marketing-ad-video-no-storyboard-ref.md` / `corporate-business-video-ref.md`）各自维护创意方向的纵切指引，本文件提供横切总览。

**为什么是铁律**：
- AI 自由发挥会让产品 / 角色 / 场景跨段漂移（v0.2.15 实战：换 Runtime 后图片不渲染 / 角色发色 / 服装 / 脸型漂移）
- mode 自由切换 = 把 reference 降级成 text = 丢失参考图锚点（CLAUDE.md 红线「不得 fallback」已封堵）
- prompt 结构自由改写 = 拆掉 negative block / 改 `<Picture N>` 引用顺序 = 模型端解读错位

**强制 5 条**：
1. **必选对应模板**：参考 `mcp-call-templates.md` §3 决策表 + `mcp-usage-guide.md` §3 决策树（参考 `text` / `keyframe` / `reference` 选唯一合法模板）
2. **`images[]` 顺序必按角色**：`product → person → scene → logo → ip`（mcp-call-templates.md §0.4），跳过位不留空，**数组紧凑**
3. **公共 block 必嵌入**：`{{style_anchor}}`（§0.1）+ 产品漂移负向（§0.2，涉及产品时）+ 五维物理负向（§0.3，drama video）
4. **占位符替换必填满**：所有 `{{...}}` 替换为具体值，**禁**留字面占位符进 prompt
5. **不偏离模板**：模板 prompt 结构 / negative block 不得自由改写；重试 0 微调，按 attempt 1 原样

**失败重试铁律**（2026-09-08 锁定，retry 期间 0 微调）：
- 单次工具调用：最多重试 **2 次**（共 3 次 attempt：1 initial + 2 retries）
- retry #1 / retry #2 按 attempt 1 原样重试（**0 微调**：prompt 字句 / aspect_ratio / size / seconds 全部冻结）
- **任何 attempt 不得 fallback**（不降级 mode、不删 images[] 元素、不改 product_ref 到 text、不简化 prompt、不切 mode 跳过 ref、不擅自换工具）
- 2 次重试后仍失败 → 停下，**交由用户处理**；把三次 attempt 的 prompt + 错误码 + URL 映射写到 `project.json.notes.last_failure`；widget emit 失败卡；**不**输出"已生成"等措辞

**完整规范**（13 个 T 模板 + 公共 block + 决策表 + 14 项 gate + 失败流程）见 `references/mcp-call-templates.md`。

**🔒 Prompt 语言铁律（必读）**：所有 `prompt` 参数（`agnes25_image_generate` / `agnes25_image_edit` / `agnes25_video_generate`，包括负向约束与全局风格锚点）必须使用**中文**。理由：项目文档与 6 个视觉风格锚点（写实电影 / 3D 国漫 / 日漫赛璐璐 / 赛博朋克 / 古风 / 广告质感）全程中文，且 agnes 国内版 API 完整支持中文 prompt。**语法例外**（保持英文 / 固定字面量）：`<Picture N>` / `@图片N` 多图引用标记、`mode="text"` 等 enum 取值、`size` / `ratio` / `aspect_ratio` / `seconds` 等参数键名、`audios` / `videos` 数组结构、`16:9` / `720P` 等数值字面量。完整调用范例（已全部中文）见 `references/agnes-ai-api.md`。

## 核心通用规则

### 视频生成门禁

**当用户要求生成视频时，不要立即开始生成，也不要立即调用视频生成工具。**

必须先澄清并确认以下基础参数：

- **时长**：视频长度 `seconds="4"` 至 `seconds="12"`（agnes-video-2.5-flash 上限 12）。
- **比例**：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9`（keyframe 模式：若用户提供 `first_frame` 图不是目标比例，必须先用 `mcp__multimedia-creator__agnes25_image_edit` 转比例，再传给 video.generate.first_frame）。
- **模式**：根据场景选 `text` / `keyframe` / `reference`。
  - `text`：纯文生视频，无参考图。
  - `keyframe`：用户/分镜给的首帧或首末帧，video 严格按帧起止。
  - `reference`：1-5 张参考图作为视觉锚点（构图/色彩/角色外观），不锁首帧。
- **生成详细内容**：画面主体、动作、场景、风格、镜头运动、情绪氛围、声音（`audios=[]` / prompt 文字描述）、负向约束。
- **生成数量**：一次最多生成 2 个视频，超出必须澄清。

**🔒 段间串行 + project.json 状态机（2026-09-09 加）**：单批 ≤ 2 是数量上限，**不**是并发起跑 2 个 MCP 调用——video 阶段 MUST 严格按 4 步硬门控执行（pre-flight → pre-call → serial-call → post-call），status 四态 `pending / in-progress / completed / failed` 同步到 `project.json.notes.video_segments`，段间冷却 2-5s（建议，不强制）。完整规范 + 字段 schema + 错误码枚举见 `references/mcp-usage-guide.md §3.4`。

**🔒 视频生成前确认资产（2026-09-09 加）**：每个 segment video_generate 调用前 MUST 走 4 步硬门控 §3.4 pre-flight 第 4 项 —— `notes.video_segments[<id>].required_assets[]` 全部 `asset_status === "ready"`（任意 missing/pending/generating → 停下问用户补生成）+ 每个 entry 必须带 recipe 三件套 `generation_prompt` + `mcp_tool_name` + `tool_params`（任意字段缺失 → 停下问用户补 recipe，不自动补）。**video_segments[].required_assets[] 是消费侧派生缓存，源是 `notes.storyboard.scenes[].shots[]`（生产侧权威）**——派生一致性 = `video_segments[].required_assets[].asset_id ⊆ union(storyboard.shots[].required_assets[].asset_id)`，§3.4 pre-flight 第 4 项+派生一致性校验联动。字段 schema + asset_status 四态 + 6 类 asset_type 枚举 + 4 路 asset 来源决策表见 `references/output-conventions.md §2.2 + §2.3 + §5.1`。

### 确认机制

**只有在用户明确确认参数后，才可以继续生成。** 无论用户是否已经一次性提供完整参数，都必须先输出一次参数摘要并等待确认。

明确确认可以是：`确认` / `可以生成` / `开始生成` / `没问题` / `yes` / `looks good` / `ok`。

`好` / `OK` / `嗯` 这类短回复只有紧跟确认摘要时才算确认；如果它们出现在新需求之后，只能视为新需求内容或继续沟通。

### 即时输出原则

每生成完一张图或一个视频，必须立即展示并返回给用户。绝对禁止等待所有图片 / 所有视频全部生成完毕后再统一打包返回。

### 图片质量审查原则

- **人设图审查**：左侧面部特写是否正脸；三视图与特写是否一致；多视角是否是同一人物。
- **关键帧审查**：画面是否与对应剧情对得上；人物 / 场景 / 道具与资产设定图特征一致性。

### 交付规范

**每阶段产物完成后，AI 必须 emit `<generative-ui-widget>` 块**（渲染目标 / 数据来源 / HTML 骨架 / 占位符替换见 `references/widget-templates.md`）让用户在 chatui **直观看**生成内容；同时保留 `![image](<URL>)` / `![video](<URL>)` Markdown 作为 fallback（widget 解析失败时仍可见）。

**6 个阶段 × widget 模板对应**：

| 阶段 | widget 模板 | 数据来源 |
|---|---|---|
| planner | planner-meta-card | `project.json` + `01_planner.md` 头部 |
| scriptwriter | scriptwriter-summary-card | `02_script.md` |
| storyboard | storyboard-shot-table | `03_storyboard.md` + 关键帧 URL |
| assets | assets-image-gallery | `04_assets/<type>/<name>/*.png` |
| frame | frame-keyframe-grid | `05_keyframes/episode-XX/segment-YY/*.png` |
| video | video-segment-list | `06_videos/segment-XX.{mp4,md}` + `project.json.notes.video_segments` |

**视频交付**：工具返回 `video_url` / `output_url` / 本地视频路径后，emit `video-segment-list` widget（每段含 `<video>` 标签 + 元数据 + 失败占位），**同时**保留 `![segment](<URL>)` Markdown 作为 fallback。不得只传总结文案或裸链接文本。

**工具返回后必须先确认 widget 渲染 + 上屏播放，再输出成功格式。**

## ⚠️ 诊断澄清：HTTPS URL 是契约，output 不可视才是问题

用户常见误解："creative-video-suite 把 web URL 直接传给 MCP 服务，导致 chatui 看不到"——这是把 **input** 和 **output** 混为一谈。

| 流向 | 当前状态 | 是否问题 |
|---|---|---|
| **AI → MCP 输入**（`video_generate.images[]` / `first_frame` / `last_frame`）：传 HTTPS URL | 正确（hosted_mcps 对 video_generate 字段本地 / data URI 都做"上传 `img.remit.ee` 拿 URL"，并发撞图床 QPS 限流；5 步硬门控第 1 条 video_generate 分支强制） | ❌ 不是问题，**不能改成本地路径 / data URI** |
| **AI → MCP 输入**（`image_edit.image_paths` / `mask_path`）：HTTPS URL / data URI / 本地路径 都可 | 正确（hosted_mcps 对本地路径 client-side 编码为 data URL，**不**走 `img.remit.ee`；agnes 官方 API 支持 HTTPS URL + Data URI） | ❌ 不是问题；**优先 HTTPS URL**（与上下游 URL 流一致） |
| **MCP → chatui 输出**：`image_generate` / `video_generate` 返回的 HTTPS URL 在 chatui 里是否可视化 | `src/server/utils/tool-result-attachments.ts::classifyToolAttachmentPresentation` 当前未把 `mcp__multimedia-creator__agnes25_*` 纳入 attachment 包装 → URL 仅以纯文本落到 chat，没被 `ToolImageAttachment` 渲染成 inline 卡 | ✅ 是问题根因 |
| **AI → MCP 输入**（`agnes25_upload_image`：本地路径 → HTTPS URL） | 正确（走 hosted_mcps `_upload_to_remit_ee` helper，与 `video_generate` 字段隐式归一化**同一条路径**；显式工具 vs 隐式上传只是 caller 选择） | ❌ 不是问题；**drama 流水线不主动调**（用 `image_generate` 返回的 `data[0].url` 就够，重复上传 = QPS 翻倍）；仅在必须把已有本地图变 URL 又缺 `image_generate` 历史时调用；批量自加 sleep 防 429 |

**本次 skill 侧补偿**：AI 主动 emit `<generative-ui-widget>` 块（per-stage 摘要）让用户看到。Sidecar 包装属于另一 PR follow-up——在 Sidecar 包装落地前，inline 图卡不可用，widget 是唯一 chatui 可视化路径。

## 视觉风格选择

**所有视觉产出必须锁定一个全局风格锚点**——一旦确定，整个项目所有 prompt 的开头必须一字不差带这个限定词（详见 `references/drama/assets.md`「强制：全资产风格统一锚点」）。风格锚点在 5 阶段（assets → frame → prompt → 视频）中不可漂移。

**6 个预设**（可在 planner 或 assets 阶段锁定，planner 阶段未指定则按题材默认推断）：

| 预设 | 适配场景 |
|---|---|
| 写实电影 | 现代都市 / 剧情片 / 真人短剧 |
| 3D 国漫 | 古装仙侠 / 国风玄幻 / 动画 |
| 日漫赛璐璐 | 二次元 / 校园 / 异世界 |
| 赛博朋克 | 科幻 / 未来都市 / 反乌托邦 |
| 古风 | 古代宫廷 / 武侠 / 仙侠 |
| 广告质感 | 产品广告 / 商业宣传 / 品牌片 |

**commercial 分支**：`style_ref` 是**强门控**——必须明确来源（用户提供 / ref 提取 / AI 起草），未提供则追问而非默认推断。

未指定风格时由 planner 按题材默认推断，但 assets 阶段必须用户确认后才能继续生成。

## 输出约定

**每阶段完成 + 用户确认后，AI 必须把该阶段产物落盘到 user workspace**——不是可选、不是建议；chat 即时输出只是临时展示，产物必须落盘才能跨 session 续跑 + 二次创作。

**完整规范**（项目目录结构 / `project.json` schema / 落盘时机 / 跨阶段 file 引用规则 / 商业 3 路差异点 / 失败重跑处理 / 集成清单自检）见 `references/output-conventions.md`。

**核心约束**（落盘前必须自检，违反 = 该阶段未完成）：

1. 走 Tauri invoke（`cmd_write_workspace_file` / `cmd_workspace_copy_paths`），**禁止** Sidecar HTTP / `node:fs` / 裸 `path.join` 拼绝对路径——CLAUDE.md pit-of-success 红线「工作区文件 IO 必须走 Rust invoke」
2. 路径 workspace-relative，以 `<workspace>/creative-video-suite/<project-name>/` 开头；`<workspace>` 由用户在 HamunaAgent 工作区选择时确定，AI **不**硬编码 `~/Documents/...` 等具体路径
3. 每阶段末 update `project.json.current_stage`——AI 跨 session 续跑的**唯一权威**；新 session 进项目第一件事 `cat project.json` 看断点
4. 跨阶段 file 引用走 workspace-relative path（给 model 的 URL 与给 AI 的 file path 分清，前者给 `image_generate` / `video_generate`，后者给 AI 自己定位文件）
5. 失败 / 重跑旧产物加 `_v1` / `_v2` 后缀，**不**直接覆盖；用户清理手动 `rm`
6. 商业 3 路（ugc / marketing / corporate）共用顶层 `<workspace>/creative-video-suite/<project>/`，**靠 `project.json.type` 区分**（不分子目录），但产物形态有差异（见 output-conventions.md §5）

**项目名**：`kebab-case` 自动从用户 brief 提炼（`<subject>-<type>-<yyyymmdd>`，如 `afternoon-tea-tvc-20260908`），planner 阶段提议 + 用户确认或改。

## 需求分类判断

### 短剧 / 剧情视频（走 Drama 分支）

**触发关键词**：短剧 / 剧本 / 分镜 / 人设 / 角色设定 / 剧情 / 故事 / 微电影 / 动画 / 动漫 / 动态漫 / 影视化 / 电影 / 预告片 / 连续剧 / 分集 / 剧集 / 人物设定 / 场景设定 / 资产设定 / 关键帧

**特征**：
- 有完整故事线和角色发展
- 需要剧本创作或分镜设计
- 涉及多个人物和场景
- 需要保持角色形象一致性

### 商业视频（走 Commercial 分支）

**触发关键词**：广告 / 产品视频 / 带货 / UGC / 口播 / 测评 / 开箱 / 教程 / 企业宣传 / 品牌形象 / 产品介绍 / 营销视频 / 信息流 / 种草 / 达人视频 / 商务视频 / 招商片 / 路演片

**特征**：
- 以产品 / 品牌 / 企业为核心
- 通常有明确的营销目标
- 可能包含口播 / 旁白 / 解说
- 单条视频，时长较短

### 模糊需求处理

如果用户需求不明确，先询问 1-2 个关键问题来确定方向：
- "请问您是想做有剧情故事的短剧 / 动画，还是产品广告 / 宣传类视频？"
- "这个视频主要是用于故事叙事，还是产品推广 / 企业宣传？"

## 短剧 / 剧情视频分支

### 生产流程

```text
planner → scriptwriter → storyboard → assets → frame → prompt → 视频生成
```

`planner` 就是当前主 `SKILL.md`。其它阶段按需读取 refs：

| 阶段 | 读取文件 |
|---|---|
| 剧本创作 | `references/drama/scriptwriter.md` |
| 分镜切分 | `references/drama/storyboard.md` |
| 资产设定 | `references/drama/assets.md` |
| 关键帧生成 | `references/drama/frame.md` |
| 视频提示词 | `references/drama/prompt.md` |

**不得跳阶段**。

### 阶段判断

按顺序检查，并停在第一个缺失依赖：

1. 只有 idea / 标题 / 简短梗概时，开始剧本创作。
2. 有完整故事但没有按集 / 片段 / 镜头切分时，开始分镜切分。
3. 有分镜但没有可用角色 / 场景 / 道具资产引用或详细视觉基准时，开始资产设定。
4. 有资产和分镜但没有片段关键帧图时，开始关键帧生成。
5. 有关键帧但没有最终视频提示词执行包时，开始视频提示词生成并生成对应视频。

### 阶段澄清

| 阶段 | 需要澄清 |
|---|---|
| planner | 目标 / 产物形式 / 受众 / 全流程范围 / 已有素材 / **项目名（kebab-case 自动提议，用户确认或改）** / **当前 workspace 路径（确定产物落盘根目录）** / 视觉风格（可选，未指定则按题材推断）/ 希望从哪个阶段开始 |
| scriptwriter | 故事主题 / 题材 / 目标时长或集数 / 主角 / 核心冲突 / 结局方向 / 情绪基调 / 禁用内容 |
| storyboard | 要处理的集数 / 单集时长 / 片段结构 / 镜头密度 / 台词 / 字幕 / 声音要求 |
| assets | 角色 / 场景 / 道具 / 视觉风格 / 参考图用途 / 一致性锚点 |
| frame | 哪一集 / 哪些片段 / 首尾关键帧要求 / 场景引用 / 角色引用 / 构图 / 光影 |
| prompt | 工具模式 / 时长 / 比例 / 首帧 / 参考资产 / 时间戳动作规划 / 负向约束 / 批次数量 |

### 路由规则

- 当前阶段是剧本创作时，读取 `references/drama/scriptwriter.md`。
- 当前阶段是分镜切分时，读取 `references/drama/storyboard.md`。
- 当前阶段是资产设定时，读取 `references/drama/assets.md`。
- 当前阶段是关键帧生成时，读取 `references/drama/frame.md`。
- 当前阶段是最终视频生成时，读取 `references/drama/prompt.md`。

**每阶段完成后都必须用户确认**：在剧本 / 分镜 / 资产 / 关键帧任何一个阶段完成输出后，必须停下来，明确询问用户是否满意、是否需要修改。绝对禁止在没有获得明确的"确认 / 没问题 / 继续 / yes / ok"等许可下，擅自读取下一个 Reference 文件并自动推进到下一阶段。

### 角色形象变化资产更新原则

随着剧情进展，如果人物形象发生较大变化（换装 / 发型变化 / 受伤 / 年龄阶段 / 身份伪装 / 关键造型变化），必须先重新生成对应阶段的角色资产设定图，并经用户确认后，才能继续生成后续关键帧或视频。禁止沿用旧资产图硬套新造型。

## 商业视频分支

当判断为商业视频时，按以下流程推进。

### 工作流程

1. 识别用户是否有视频生成意图。
2. 判断请求属于产品广告视频 / 口播 / 旁白视频 / UGC / marketing / corporate / 企业宣传商务视频。
3. 提取用户已给的时长 / 比例 / 内容 / 产品信息 / 口播 / 旁白 / ref。
4. **提取并明确 `style_ref` 来源（强门控）**：用户未提供风格参考视频 / 风格图 / 竞品内容 / moodboard 时必须追问；最终 style_ref 必须出现在确认摘要中（参见 `## 视觉风格选择`）。
5. 命中产品广告 / UGC / marketing / corporate 时先执行「产品 / 企业资料门控」。
6. 如果基础参数 / 产品信息 / 口播信息缺失，先追问；用户已给全参数也必须输出确认摘要。
7. 包含口播 / 旁白 / 解说时，明确最终台词来源：用户提供 / ref 提取 / AI 起草；最终台词必须出现在确认摘要中。
8. 用户明确确认后才调用视频生成工具。
9. 进入 UGC / marketing / corporate ref 策略前，先执行「分镜图片 / 关键帧门控」；没有明确图片需求时只输出分镜表，不生成分镜图或关键帧图。

### 产品 / 企业资料门控

命中产品广告 / UGC / marketing / corporate 时，默认必须先有产品上传 / 企业资料 / 品牌资产 / 可用 ref。

如果用户没有提供：

1. 澄清：上传产品 / 企业 / 品牌参考，或明确选择"无参考直接生成 / 直接生成 / 按概念 brief 生成"。
2. 用户选择上传资料时，等待资料后再汇总确认。
3. 用户明确选择直接生成时允许继续，但确认摘要必须写明：`参考资料：无，按概念 / 文字 brief 生成，产品外观、企业视觉和品牌资产不保证真实一致`。

### 分镜图片 / 关键帧门控

默认交付是**分镜表**，不是分镜图片。主 MD 和所有 ref 策略都必须遵守：

- 用户只说"分镜 / 分镜脚本 / 分镜表 / storyboard / shooting script"时，只输出表格或文字分镜，不生成图片。
- 只有用户明确说"分镜图 / 分镜图片 / 关键帧图 / 关键帧图片 / 首帧图 / 每个镜头出图 / 画面图 / storyboard images / keyframe images"等图片交付词时，才可以生成分镜图 / 关键帧图 / 首帧图。
- 用户要最终视频但没要分镜图片时，流程是：分镜表 → 视频 prompt → 视频工具；不得插入分镜图生成步骤。
- 分镜表中的台词 / 旁白 / 声音为必填字段：可以写完整原文，也可以写"无台词 / 无旁白，仅 BGM + 环境声"；不得缺失 / 留空 / 默认省略。

### ref 路由策略

- **UGC 口播路由**：口播 / 真人讲解 / 种草 / 测评 / 开箱 / 教程 / 批量达人 / UGC 参考复刻 → `references/commercial/ugc-talking-video-ref.md`。信息流 / 带货 / 达人带货 / 口播带货优先走此文件。
- **Marketing 无分镜路由**：产品营销广告 / 商品广告 / 单品种草 / 产品展示大片 / 无分镜图广告片，且目标以单品消费转化 / 产品视觉广告 / 平台投放为主 → `references/commercial/product-marketing-ad-video-no-storyboard-ref.md`。
- **Corporate 商务视频路由**：产品功能介绍 / 企业宣传片 / 企业产品功能宣传 / 商务视频 / 品牌形象片 / 企业介绍视频 / 招商片 / 路演片 / 会议开场片 / 客户案例片 / 雇主品牌视频 / 服务介绍片 / B2B 广告片 → `references/commercial/corporate-business-video-ref.md`。

**冲突处理**：
- 用户提到信息流 / 带货 / 达人带货 / 口播带货时，不走 Marketing ref；除非用户明确说不要真人 / 达人 / 口播。
- 产品广告 + 真人口播：以真人推荐 / 口播可信感 / 信息流带货为主走 UGC ref；以产品大片 / 广告级镜头为主走 Marketing ref。
- Marketing vs Corporate：以产品大片 / 广告级镜头为主走 Marketing ref；以企业能力 / 公司介绍 / 商务信任 / 招商路演 / 客户案例 / 雇主品牌 / 会议开场为主走 Corporate ref。

### 口播和旁白要求

当用户要求视频包含口播 / 旁白 / 解说 / 主播念词 / 真人讲解 / voiceover / host speech / talking-head delivery 时，必须在生成前明确完整台词。

- UGC 口播进入视频 prompt 时必须用 `{具体台词}` 包裹，只作为声音 / 口型内容，不得作为字幕 / caption / lower-third / 画面文字。
- Marketing 视频默认添加完整旁白台词。
- Corporate 视频必须包含完整旁白台词；只有用户明确要求无旁白或纯音乐时才遵从。

## 工具门禁（多媒体 MCP）

以宿主环境实际可用工具为准。下表是 multimedia-creator MCP 工具与旧系统工具的语义映射：

| MCP 工具 | 旧工具名语义 |
|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | `text_to_image`（T2I） |
| `mcp__multimedia-creator__agnes25_image_edit` | `image_to_image`（I2I / 多图合成） |
| `mcp__multimedia-creator__agnes25_video_generate` | `text_to_video` / `image_to_video`（按 `mode` 区分） |

**工具调用失败处理**：
当阶段规则要求使用 I2I 或视频生成时，如果实际调用失败，必须优先重新尝试调用对应工具，仍失败再停下来说明失败原因与所需补充信息。禁止为了绕过失败而擅自降级改用纯文生图或纯文生视频，这会丢失参考图约束并破坏角色、场景、道具一致性。

## 完成检查

声明完成前必须确认：

- 没有跳过上游阶段。
- 视频生成前已完成必要澄清并获得明确确认。
- 比例 / 时长 / 模式 / 数量 / 参考素材和限制已记录。
- 角色 / 场景 / 道具和关键帧连续性已保持。
- 剧情导致人物形象明显变化时，已补充并确认新的角色资产设定图。
- 应使用 I2I / I2V 的任务没有因工具调用失败而降级为 T2I / T2V。
- 单批生成视频数量不超过 2 个。
- 资产和视频的输出必须遵循"即时输出"原则。
- 所有视频生成结果交付前都已通过 Markdown 视频渲染正常展示。
