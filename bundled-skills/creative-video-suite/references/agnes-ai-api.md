# multimedia-creator MCP 工具参考

**重要**：本 skill 不再使用旧的 `AGNES_API_KEY` + curl 直调模式。所有图像 / 视频生成一律走 bundled `multimedia-creator` MCP（`.mcp.json` 已注册）。

## 服务概述

`multimedia-creator` MCP server 暴露 7 个工具（4 video + 3 image），由 `hosted_mcps/agnes-video-25/` 提供，调用后端 agnes 国内版 API（`https://api.agnes-ai.cn/v1`）。

| 工具名 | 类型 | 模型 | 用途 |
|---|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | image | agnes-image-2.5-flash | 文生图（T2I） |
| `mcp__multimedia-creator__agnes25_image_edit` | image | agnes-image-2.5-flash | 图生图（I2I / 多图合成 / 局部编辑） |
| `mcp__multimedia-creator__agnes25_video_generate` | video | agnes-video-2.5-flash | 视频生成（text / keyframe / reference 三模式） |

**模型强约束（2.5-flash）**：
- 视频 size 锁死 `720P`（旧版可选 720P / 1080P / 1K / 2K 已废除）
- 视频 seconds 仅支持 `"4"` 至 `"12"` 字符串（旧 num_frames / frame_rate / duration 已废除）— **完整约束见下文 `## 视频时长边界（单一权威）`**
- 视频 images ≤ 5 / audios ≤ 3 / videos = 0（flash 不接受 video ref）

## 视频时长边界（单一权威 · 2026-09-09 加）

`mcp__multimedia-creator__agnes25_video_generate.seconds` 参数是**字符串**（非 int），**双重约束**：

| 约束 | 取值 | 含义 |
|---|---|---|
| **下限 4 秒** | `seconds` 字符串值 **必须 ≥ `"4"`** | 小于 4 秒（MCP schema 校验失败）→ 必须用 image_generate 出图 + frame 拼接，或放弃短视频需求 |
| **上限 12 秒** | `seconds` 字符串值 **必须 ≤ `"12"`** | 超过 12 秒（MCP schema 校验失败）→ 多段拼接 `long_video_stitch_mode`（见 `references/commercial/corporate-business-video-ref.md`） |
| **合法值集合** | `"4"` / `"5"` / `"6"` / `"7"` / `"8"` / `"9"` / `"10"` / `"11"` / `"12"`（共 9 个，**只接受整数秒**） | 半秒 / 小数 / 浮点字符串均被拒（如 `"3.5"` / `"4.5"` 都不合法） |

### 各分支默认 vs 锁定策略（4-12s 边界内的具体取值）

| 分支 | 默认值 | 下探到 4 秒 | 锁定上限 | 备注 |
|---|---|---|---|---|
| **drama** | `{{seconds}}` 占位符（runtime 替换） | ✅ 灵活档 4-12s 三段式 | 12 秒 | 详见 `references/drama/storyboard.md`「时长模型：默认 12s 节奏档 + 灵活档（并存）」；默认档 12s 节奏速查表 / 灵活档按 MCP 上限 12s 比例压缩（参考材料 30s 哲学按 4-12s 三段式 0-25% / 25-75% / 75-100%） |
| **UGC** | 12 秒 | ⚠ 用户 ack 后可缩短到 6-8 秒（短口播） | 12 秒 | 12 秒 60-72 字 / 高密度 72-84 字（`speech_pace` 字数同步重算）；缩短到 4 秒只允许纯 logo splash / transition 类 |
| **Marketing** | 12 秒 | ❌ 不下探 | 12 秒 | 5 段式结构（0-2 / 2-4 / 4-8 / 8-10 / 10-12）硬绑定 12s，缩短会破坏 hook → packshot 弧线 |
| **Corporate** | 12 秒 | ❌ 不下探 | 12 秒 | 8-10 分镜结构 + `long_video_stitch_mode` 拼接（多段都是 12s） |

### 跨 ref cross-link 锚点（本节是单一权威）

所有提到"秒数" / "时长" / "MCP 边界"的 ref 都 MUST 指向本节：

| 上游 ref | 引用入口 | 改动模式 |
|---|---|---|
| `SKILL.md` 5 步硬门控第 4 步 | 第 4 条 `参数 schema 边界` | 追加 1 行 `(时长边界见 references/agnes-ai-api.md §视频时长边界)` |
| `references/mcp-usage-guide.md` §6 | 调门前自检清单 | 新增 item (12) `seconds ∈ {4-12 字符串}？` 指向本节 |
| `references/mcp-call-templates.md` §6 | 调门前自检清单 | 新增 `{{seconds}}` 占位符 ∈ {4-12 字符串}？指向本节 |
| `references/drama/storyboard.md` | 「时长模型」段 | 末尾追加 1 行 `(MCP 边界 4-12s 见 references/agnes-ai-api.md §视频时长边界)` |
| `references/drama/prompt.md` | 「每个视频时长：4-12 秒」段 | 末尾追加 1 行 cross-link 到本节 |
| `references/commercial/ugc-talking-video-ref.md` | 所有"MCP `seconds` 上限 12"出现处 | 改写为"MCP `seconds` 边界 `4`-`12`" + 末尾 cross-link |
| `references/commercial/product-marketing-ad-video-no-storyboard-ref.md` | 同上 | 同上 |
| `references/commercial/corporate-business-video-ref.md` | 同上 | 同上 |

### 异常处理（边界外请求）

| 用户请求 | AI 行动 |
|---|---|
| `< 4 秒`（如 splash / transition / logo 闪白） | ❌ 拒绝调 video_generate；建议改用 `image_generate` 出图 + frame 拼接 / 或放弃；**不**允许 fallback 到非 MCP 工具 |
| `> 12 秒`（如 15s / 30s / 60s 长视频） | ❌ 拒绝单次 video_generate；进入 `long_video_stitch_mode`（详见 corporate-business-video-ref.md）；按 12 秒切段拼接 |
| 半秒 / 小数（`4.5` / `5.5`） | ❌ 拒绝；MCP 9 合法值都是整数秒字符串 |
| 占位符 `{{seconds}}` 未替换 | ❌ 拒绝调 MCP；详见 `mcp-call-templates.md` §6 gate item |

## 多图引用语法

**image / video 通用**：传入的图片数组按顺序 1-indexed 编号，prompt 中用 `<Picture N>` 引用。

- `mcp__multimedia-creator__agnes25_image_edit` 传 `image_paths=["<p1>", "<p2>", ...]`，对应 prompt 中的 `<Picture 1>` / `<Picture 2>`。
- `mcp__multimedia-creator__agnes25_video_generate` reference 模式传 `images=["<p1>", "<p2>", ...]（≤ 5`，对应 prompt 中的 `<Picture 1>` / `<Picture 2>`。

> **🔗 硬编码调用模板**（2026-09-08 锁定，2026-09-09 加 T13）：所有需要参考图的生成禁止 AI 自由组合 mode / images[] / first_frame——必须字面照抄 `references/mcp-call-templates.md` 对应 T 编号模板（image_edit → T01-T03，video_generate → T04-T12，image_generate 多视角产品图 → T13，按 (分支 × ref 类型) 决策表选唯一合法模板）。

## 输入源支持 · 按工具拆分（2026-09-08 拆分）

输入源支持按工具走两条路——根因是 hosted_mcps wrapper 对 `image_edit` 字段与 `video_generate` 字段的 client-side 归一化行为**完全不同**：

### 路径 A · `image_edit` 字段（`image_paths` / `mask_path`）— 3 种输入都接

**官方 agnes API 支持**：`extra_body.image` 接受 HTTPS URL + Data URI Base64（"如果 URL 无法公开访问，请使用 Data URI Base64"——见 wiki.agnes-ai.cn/docs/agnes-image-25-flash）。**官方未列本地路径**——hosted_mcps wrapper 对本地路径做 client-side 编码为 data URL 后传入 agnes（**不**走 `img.remit.ee`）。

| 输入类型 | 例子 | hosted_mcps client-side action | agnes 端接受 | 合规性 |
|---|---|---|---|---|
| **HTTPS URL** | `"https://cos-platform-outputs.agnes-ai.cn/.../output.png"` | pass through | ✅ 官方推荐 | ✅ 优先 |
| **Data URI base64** | `"data:image/png;base64,iVBORw..."` | pass through | ✅ 官方 fallback | ✅ 可用（受 256KB Sidecar SSE 红线约束） |
| **本地路径** | `"/path/to/portrait.png"` 或 `"file:///path/to/portrait.png"` | 编码为 data URL 后传入 agnes | ✅ 经 client-side 转换 | ✅ 可用（避免大图，< 256KB 编码后） |

**优先级**：**优先 HTTPS URL**（与上下游 URL 流一致 + 零转换 + 不受 256KB 约束）；用户上传的小图 / `data:` URL / 本地路径**可用**（hosted_mcps 不会触发 img.remit.ee，所以不撞 QPS）。

### 路径 B · `video_generate` 字段（`images[]` / `first_frame` / `last_frame` / `audios[]`）— 🔒 只接 HTTPS URL

**官方 agnes API 支持**：仅 HTTPS URL（schema `string`，demo 全 HTTPS URL，docs 写"所有媒体 URL 都应当可由 Agnes AI 服务公开访问"）。**本地路径 / data URI 都未列入**——hosted_mcps wrapper 对这两种输入都做"上传 `img.remit.ee` 拿 URL"处理（因为 agnes 视频 API 自身不接受）。

| 输入类型 | 例子 | hosted_mcps client-side action | 合规性 |
|---|---|---|---|
| **HTTPS URL** | `"https://cos-platform-outputs.agnes-ai.cn/.../keyframe.png"` | pass through | ✅ **唯一合规** |
| Data URI base64 | `"data:image/png;base64,iVBORw..."` | decode 字节 → temp 文件 → **上传 `img.remit.ee` → URL** | ❌ **禁止**——并发撞 `img.remit.ee` QPS 限流（5xx） |
| 本地路径 | `"/path/to/first_frame.png"` | **上传 `img.remit.ee` → URL** | ❌ **禁止**——同上 |

**为什么 MUST 用 URL**：
1. **图床限流**（核心动机）：hosted_mcps 对 video_generate 字段的本地/data URI 都走 `img.remit.ee` 上传；并发撞**第三方图床 QPS 限流**（5xx 失败）；HTTPS URL 直传走 agnes 内部 CDN 通道零额外上传
2. **`local_path` 是诱饵**：server 返回的 `local_path` 指向 `server cwd/outputs/{images,videos}/` —— **不在调用方项目目录**，跨进程不可见
3. **`output_filename` 绝对路径无效**：传绝对路径 server 把字符串当 filename 处理，丢 dir 前缀，落 `server cwd + outputs/`（与你想的不一样）

**实测确认（2026-09-08 UGC 5 段测试）**：
- `image_generate` → `url` 字段直接喂给 `video_generate.first_frame` / `last_frame` ✅ 5/5 通过
- `video_generate` reference 模式的 `images[]` 接 HTTPS URL ✅ 文档原理一致，应同样支持
- 全流程 0 次本地路径，0 次图床上传，0 次限流

### frame 链工作流铁律（必读）

1. Step N 用 `image_generate` 生成首帧图，**必须捕获**返回的 `data[0].url`（**不是 `local_path`**）
2. Step N+1 直接用上一步 `url` 作 `first_frame`（keyframe 模式）或 `images[0]`（reference 模式）
3. 全流程在 URL 字符串层流转，**禁止** wget / curl 下载到本地再喂给下游
4. 本机持久化需要 → 用返回的 `url` 单独 `curl -o <local>`（与 pipeline 无关）

## agnes25_image_generate（文生图）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 图像描述 |
| `model` | string | 否 | 固定 `agnes-image-2.5-flash` |
| `size` | string | 否 | `1K`（默认） / `2K` / `3K` / `4K` |
| `ratio` | string | 否 | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` |
| `num_images` | int | 否 | 1-4，默认 1 |

### 调用示例

```text
mcp__multimedia-creator__agnes25_image_generate({
  prompt: "电影感的年轻男士肖像，身穿黑色西装，站在现代化办公室，戏剧化打光，16:9",
  model: "agnes-image-2.5-flash",
  size: "1K",
  ratio: "16:9"
})
```

> **🔒 image_generate 必须显式传 `ratio:`**（2026-09-09 加，承接 SKILL.md「🔒 image_generate ratio 分支默认表」）：漏传 `ratio` 时 MCP 兜底默认 `1:1`（详见 `hosted_mcps/agnes-video-25/src/agnes_video_25/server.py` `DEFAULT_IMAGE_RATIO = "1:1"`），是图锁 1:1 的直接来源。skill 模板**必须**按分支默认表显式传 `ratio:`：
>
> | 分支 | 默认 `ratio` | 例外 |
> |---|---|---|
> | drama（短剧 / 剧情 / 微电影） | `9:16` | 横屏需求（电影预告片 / 宽屏剧情片）→ `16:9` |
> | Commercial · Marketing（产品广告） | `9:16` | 抖音 / 小红书 / 快手 / 视频号 / 竖屏信息流 `9:16`；电视 / TVC / Web / YouTube / 横版展播 `16:9`；电商详情页 / 方形卡片 `1:1`；平台未定 → `9:16`（详见 `references/commercial/product-marketing-ad-video-no-storyboard-ref.md`「平台→比例」） |
> | Commercial · UGC（口播 / 种草） | `9:16` | 抖音 / 小红书 / 快手默认 `9:16`；B站横屏 `16:9` |
> | Commercial · Corporate（企业宣传 / 商务） | `16:9` | 路演 / 招商 / 客户案例 `16:9`；短视频版（1 分钟内）`9:16` |
>
> 合法值：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9`（**禁**其它比值，含 `2:1` / `9:18` / `1.85:1` 等变体；agnes 端会回 `invalid_ratio`）。**单一权威**：`SKILL.md`「🔒 image_generate ratio 分支默认表（单一权威 · 2026-09-09 加）」。

## agnes25_image_edit（图生图 / 多图合成）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 编辑指令 |
| `model` | string | 否 | 固定 `agnes-image-2.5-flash` |
| `image_paths` | string[] | 是 | 输入图列表（≤ 8）——HTTPS URL / Data URI base64 / 本地路径 3 种都接（hosted_mcps client-side 归一化）；按顺序对应 `<Picture N>` |
| `mask_path` | string | 否 | 局部编辑蒙版（HTTPS URL / Data URI / 本地路径，与 `image_paths` 同） |
| `size` | string | 否 | `1K` 默认 / `2K` / `3K` / `4K` |
| `ratio` | string | 否 | 输出比例 |

### 调用示例

**图生图（单图）**：

```text
mcp__multimedia-creator__agnes25_image_edit({
  prompt: "把背景换成夜晚赛博朋克城市街景，保持人脸和服装不变，16:9",
  image_paths: ["/path/to/portrait.png"]
})
```

**多图合成**：

```text
mcp__multimedia-creator__agnes25_image_edit({
  prompt: "把<Picture 1>中的战士和<Picture 2>中的巨龙合成一场激烈的战斗场景，戏剧化打光，电影感构图，16:9",
  image_paths: ["/path/to/warrior.png", "/path/to/dragon.png"]
})
```

## agnes25_video_generate（视频生成）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 视频内容描述 |
| `model` | string | 否 | 固定 `agnes-video-2.5-flash` |
| `mode` | string | 是 | `text` / `keyframe` / `reference` |
| `size` | string | 否 | 锁死 `720P` |
| `seconds` | string | 否 | `"4"` 至 `"12"` 字符串 |
| `aspect_ratio` | string | 否 | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` |
| `first_frame` | string | 否 | keyframe 模式：本地图路径 |
| `last_frame` | string | 否 | keyframe 模式：本地图路径 |
| `images` | string[] | 否 | reference 模式：≤ 5 本地图路径 |
| `audios` | string[] | 否 | ≤ 3 音频路径 |
| `videos` | string[] | 否 | 0（flash 不接受） |
| `timeout_seconds` | int | 否 | 任务超时秒数，默认 600 |
| `poll_interval_seconds` | int | 否 | 轮询间隔秒数，默认 5 |

## 参数互斥（mode ↔ params 必检）

**违反互斥 → 400 Bad Request**，浪费一轮 quota + 用户等待。调用 MCP 前**必过**本表：

| 工具 | `mode` | `first_frame` | `last_frame` | `images[]` | `image_paths[]` | `mask_path` | `audios[]` | 备注 |
|---|---|---|---|---|---|---|---|---|
| `image_generate` | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 纯文生图 |
| `image_edit` | — | ❌ | ❌ | ❌ | ✅ **必传** ≤ 8 | ⚠️ 可选 | ❌ | I2I / 多图合成 / 局部编辑 |
| `video_generate` | `text` | ❌ 禁止 | ❌ 禁止 | ❌ 禁止 | ❌ | ❌ | ⚠️ 可选 | 纯文生视频 |
| `video_generate` | `keyframe` | ✅ **必传** | ⚠️ 可选（首末帧驱动才传） | ❌ 禁止 | ❌ | ❌ | ⚠️ 可选 | 单帧 / 首末帧驱动 |
| `video_generate` | `reference` | ❌ 禁止 | ❌ 禁止 | ✅ **必传** ≤ 5 | ❌ | ❌ | ⚠️ 可选 | 1-5 张参考图作视觉锚 |

**参数 schema 边界**：

| 参数 | 取值 | 备注 |
|---|---|---|
| `size`（video） | `720P` | 锁死；旧版 `1080P` / `1K` / `2K` / `2K` 已废除 |
| `size`（image） | `1K` / `2K` / `3K` / `4K` | 默认 `1K` |
| `seconds` | `"4"` / `"5"` ... `"12"` | **字符串**（非 int） |
| `aspect_ratio` | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` | 与 first_frame 比例一致；不一致**先 `image_edit` 转比例**再喂 video |
| `ratio`（image） | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` | 同上 |
| `num_images` | 1-4 | 默认 1 |
| `image_paths[]` | ≤ 8（HTTPS URL / Data URI base64 / 本地路径） | image_edit 字段：3 种都接；按顺序对应 `<Picture 1>` / `<Picture 2>` |
| `images[]` | ≤ 5 HTTPS URL | video_generate 字段：只接 HTTPS URL；本地 / data URI 走 `img.remit.ee` 撞 QPS |
| `audios[]` | ≤ 3 URL | flash 不接受 video audio |
| `videos[]` | 0 | flash 限制 |
| `mask_path` | URL | **仅 image_edit 接受**，传 image_generate / video_generate → 400 |

### 三种 mode 详解

#### `text` 模式（纯文生视频）

```text
mcp__multimedia-creator__agnes25_video_generate({
  prompt: "宁静的海面日落，浪花轻柔，电影感，16:9",
  mode: "text",
  size: "720P",
  seconds: "12",
  aspect_ratio: "16:9"
})
```

#### `keyframe` 模式（首帧 / 首末帧驱动）

`first_frame` / `last_frame` 用本地图路径。video 严格按帧起止。

**first_frame 比例坑**：如果用户提供的 `first_frame` 不是目标 `aspect_ratio`，必须先用 `agnes25_image_edit` 转比例。

```text
mcp__multimedia-creator__agnes25_video_generate({
  prompt: "角色缓缓转头，表情微妙变化，电影感打光",
  mode: "keyframe",
  first_frame: "/path/to/first_frame.png",
  size: "720P",
  seconds: "8",
  aspect_ratio: "16:9"
})
```

#### `reference` 模式（1-5 张参考图作为视觉锚）

`images[]` ≤ 5，按顺序对应 `<Picture N>`。prompt 中必须显式引用每张图。

```text
mcp__multimedia-creator__agnes25_video_generate({
  prompt: "电影感的产品拆解演示，按<Picture 1>九宫格布局，呈现<Picture 2>产品外观，镜头平滑运动，16:9",
  mode: "reference",
  images: ["/path/to/grid.png", "/path/to/product.png"],
  size: "720P",
  seconds: "12",
  aspect_ratio: "16:9",
  timeout_seconds: 600,
  poll_interval_seconds: 5
})
```

### 轮询机制

工具内部自动轮询，返回完整结果包含 `video_url` / `output_url` / 本地路径。调用方只需等待工具返回即可（timeout 默认 600s）。

### 状态值

`queued` → `in_progress` → `completed` / `failed`

## 错误处理

**错误分层**：

| 层 | 典型错 | 来源 | 处理 |
|---|---|---|---|
| **MCP 层** | 工具 spawn 失败 / poll timeout | `multimedia-creator` server / MCP wrapper | 重试 1 次；仍失败 → 停下告诉用户（网络 / MCP 配置问题） |
| **业务层（4xx）** | 400 Bad Request | 参数 schema 错（mode 互斥 / size 越界 / 取值非法） | **不**重试——修正参数后再调 |
| **业务层（4xx）** | 401 Unauthorized | API Key 无效 / 永久禁 | **不**重试——检查 `mcp.json` env.AGNES_API_KEYS / 换 key |
| **业务层（4xx）** | 429 Too Many Requests | 频率限制 / daily quota 撞顶 | 工具内部退避；单次调用重试 1 次；持续撞顶 → 停下问用户（疑似配额问题，**不**自动降低并发撞二次 quota） |
| **业务层（5xx）** | 500 Internal Error | 服务端错误 | 重试 1 次 |
| **状态层** | 返回 `failed` 状态（非异常） | 任务执行失败（模型层） | 改 prompt 重试 1 次；**禁**降级 mode（CLAUDE.md 红线）；仍失败 → 停下 |

**重试边界**：
- 单次工具调用最多重试 1 次
- 连续 2 次失败 → 立即停下问用户，不进入第 3 次
- 不引入 backoff 调度（CLAUDE.md pit-of-success 红线 "同步 busy-wait" 禁止 `Atomics.wait` / spin / `while Date.now()`）
- MCP 工具内部自带退避（429）

**降级禁止**（CLAUDE.md 红线）：video keyframe/reference 失败 → **不**降级 text；image_edit 失败 → **不**降级 image_generate。失败停下问用户。详见 `references/mcp-usage-guide.md` §4.3。

## 调用前自检清单

每次调 MCP 工具前 11 项自检（10/10 全过才允许调）：

```text
[ ] (0)  产品图门控：用户 brief 含产品关键词 → product-refs/ 有图（否则降级模式 ack 落 project.json.notes）
[ ] (1)  输入源按工具拆分：image_edit 字段（image_paths / mask_path）可 HTTPS URL / data URI / 本地路径；video_generate 字段（images[] / first_frame / last_frame）**只** HTTPS URL（避免 `img.remit.ee` QPS）
[ ] (2)  prompt 是中文（枚举值 / 参数键 / 数值字面量保留英文）
[ ] (3)  mode ↔ params 互斥：text 无图 / keyframe 有 first_frame / reference 有 images[]
[ ] (4)  size / seconds / aspect_ratio 取值在合法范围
[ ] (5)  first_frame 比例与 aspect_ratio 一致（不一致先 image_edit 转比例）
[ ] (6)  images[]（video_generate）**是** HTTPS URL；image_paths[]（image_edit）按上条（1）允许 3 种
[ ] (7)  style_anchor 与 project.json.style_anchor 一字不差
[ ] (8)  上一步 URL 已记到 project.json.notes <file_path> → <https_url> 映射
[ ] (9)  失败重试不超过 1 次（不撞二次 quota）
[ ] (10) 不降级 mode（CLAUDE.md 红线）
```

任何一项不过 = 该阶段未完成，必须停下补做。完整 mode 决策树 / 跨工具链 URL 传递契约 / partial success 处理见 `references/mcp-usage-guide.md`。

## 历史参考

旧版本（v2.0）模型 `agnes-video-v2.0` / `agnes-image-2.0-flash` / `agnes-image-2.1-flash` / `agnes-2.0-flash`（文本）已全部下线，**禁止再使用**。bundled-skill 只走 2.5-flash 系列 + multimedia-creator MCP。

如需独立 Python 客户端调用（不通过 MCP），可参考旧版 `https://api.agnes-ai.cn/v1` REST API，但不在本 skill 范围内。
