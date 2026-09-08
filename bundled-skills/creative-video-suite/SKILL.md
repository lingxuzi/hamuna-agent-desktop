---
name: creative-video-suite
description: 综合剧情视频创作套件（drama + commercial），由 short-drama 与企业宣传两条路径组成，专攻有完整故事线的剧情内容（短剧/微电影/动画/动态漫/预告片）。视频生成走 multimedia-creator MCP（agnes-image-2.5-flash + agnes-video-2.5-flash）。适用于 5 阶段剧情流水线、UGC口播、企业宣传片。商业广告大片请走 tvc-director。
---

# Creative Video Suite · 综合剧情视频创作套件

## 路由边界

| 关键词命中 | 路由到 |
|---|---|
| TVC / 商业广告大片 / 品牌广告 / 4A 广告 | **tvc-director** |
| 短剧 / 剧情 / 微电影 / 动画 / 动态漫 / 预告片 / UGC / 企业宣传 / 商务视频 | **creative-video-suite** |

## 工具调用契约

**所有图像 / 视频生成必须通过 `multimedia-creator` MCP**（`.mcp.json` 已注册，server.py 走 agnes 国内版 `https://api.agnes-ai.cn/v1`）。

| MCP 工具 | 用途 | 关键参数 |
|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图（T2I） | `model="agnes-image-2.5-flash"`, `size="1K"\|"2K"\|"3K"\|"4K"`, `ratio`, `prompt` |
| `mcp__multimedia-creator__agnes25_image_edit` | 图生图 / 多图合成（I2I） | `model="agnes-image-2.5-flash"`, `image_paths=["path1",...]`, `prompt`, 可选 `mask_path` |
| `mcp__multimedia-creator__agnes25_video_generate` | 视频生成 | `model="agnes-video-2.5-flash"`, `mode="text"\|"keyframe"\|"reference"`, `size="720P"`, `seconds="4"-"12"`, `aspect_ratio`, `timeout_seconds=600`, `poll_interval_seconds=5`, 按 `mode` 决定 `first_frame` / `last_frame` / `images=["path1",...]` (≤5) / `audios=[]` / `videos=[]` |

**多图引用语法（image / video 通用）**：`images[]` / `image_paths[]` 按传入顺序从 1 开始编号，prompt 中用 `<Picture 1>` / `<Picture 2>` / ... 引用对应图片。

- `images[]` ≤ 5：reference 模式
- `image_paths[]` ≤ 8：image_edit 模式
- `audios[]` ≤ 3（video）
- `videos[]` 0（video 2.5-flash 不接受 video ref）

**本地路径自动转 base64 / 上传图床**：本地路径传给 `image_paths` 时 server 自动 base64；传给 video `images` 时 server 自动上传 `img.remit.ee` 拿 HTTPS URL。

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

视频工具返回 `video_url` / `output_url` / 本地视频路径后，必须在聊天输出中以 `![segment](<URL>)` Markdown 形式直接展示视频本体（多媒体路径会被渲染为可播放视频）。不得只传总结文案或裸链接文本。

工具返回后必须先确认上屏播放，再输出成功格式。

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
| planner | 目标 / 产物形式 / 受众 / 全流程范围 / 已有素材 / 希望从哪个阶段开始 |
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
4. 命中产品广告 / UGC / marketing / corporate 时先执行「产品 / 企业资料门控」。
5. 如果基础参数 / 产品信息 / 口播信息缺失，先追问；用户已给全参数也必须输出确认摘要。
6. 包含口播 / 旁白 / 解说时，明确最终台词来源：用户提供 / ref 提取 / AI 起草；最终台词必须出现在确认摘要中。
7. 用户明确确认后才调用视频生成工具。
8. 进入 UGC / marketing / corporate ref 策略前，先执行「分镜图片 / 关键帧门控」；没有明确图片需求时只输出分镜表，不生成分镜图或关键帧图。

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
