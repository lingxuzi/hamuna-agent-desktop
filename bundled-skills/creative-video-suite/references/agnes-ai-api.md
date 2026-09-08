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
- 视频 seconds 仅支持 `"4"` 至 `"12"` 字符串（旧 num_frames / frame_rate / duration 已废除）
- 视频 images ≤ 5 / audios ≤ 3 / videos = 0（flash 不接受 video ref）

## 多图引用语法

**image / video 通用**：传入的图片数组按顺序 1-indexed 编号，prompt 中用 `<Picture N>` 引用。

- `mcp__multimedia-creator__agnes25_image_edit` 传 `image_paths=["<p1>", "<p2>", ...]`，对应 prompt 中的 `<Picture 1>` / `<Picture 2>`。
- `mcp__multimedia-creator__agnes25_video_generate` reference 模式传 `images=["<p1>", "<p2>", ...]（≤ 5`，对应 prompt 中的 `<Picture 1>` / `<Picture 2>`。

> **🔗 硬编码调用模板**（2026-09-08 锁定）：所有需要参考图的生成禁止 AI 自由组合 mode / images[] / first_frame——必须字面照抄 `references/mcp-call-templates.md` 对应 T 编号模板（image_edit → T01-T03，video_generate → T04-T12，按 (分支 × ref 类型) 决策表选唯一合法模板）。

## 输入源支持 · 🔒 必须用 HTTPS URL（端到端实测 + 图床限流避让）

**铁律**：所有 `image_paths` / `images` / `first_frame` / `last_frame` / `mask_path` 一律传 **HTTPS URL**（来自 `image_generate` / `image_edit` 返回的 `data[].url` 或 `video_url`），**禁止**用本地路径或 base64 data URL。

**为什么 MUST 用 URL（不是"建议"）**：

1. **图床限流**（核心动机）：本地路径会触发 server 端**上传到图床**（`img.remit.ee`）拿 HTTPS URL 再喂给下游。同一进程短时间内大量本地路径上传会撞**第三方图床 QPS 限流**（5xx 失败），但 HTTPS URL 直传走 agnes 内部 CDN 通道零额外上传，**省一次跨域上传 + 避图床限流**
2. **`local_path` 是诱饵**：server 返回的 `local_path` 指向 `server cwd/outputs/{images,videos}/` —— **不在调用方项目目录**，跨进程不可见
3. **`output_filename` 绝对路径无效**：传绝对路径 server 把字符串当 filename 处理，丢 dir 前缀，落 `server cwd + outputs/`（与你想的不一样）

**输入源支持**（按合规顺序）：

| 输入类型 | 例子 | 何时用 | 合规性 |
|---|---|---|---|
| **HTTPS URL**（强制） | `"https://cos-platform-outputs.agnes-ai.cn/images/t2i/task_xxx/output_yyy.png"` | `image_generate` / `image_edit` 返回的 `data[0].url` 直接喂下游 | ✅ 唯一合规 |
| 本地路径 | `"/path/to/frame.png"` | ❌ **禁止**——触发图床上传 + QPS 限流 | ❌ |
| `data:` URL（base64） | `"data:image/png;base64,iVBORw0..."` | ❌ **禁止**——视频 base64 太大 + 256KB SSE 红线 | ❌ |

**实测确认（2026-09-08 UGC 5 段测试）**：
- `image_generate` → `url` 字段直接喂给 `video_generate.first_frame` / `last_frame` ✅ 5/5 通过
- `image_edit` / `video_generate` reference 模式的 `images[]` 接 HTTPS URL ✅ 文档原理一致，应同样支持
- 全流程 0 次本地路径，0 次图床上传，0 次限流

**frame 链工作流铁律（必读）**：
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

## agnes25_image_edit（图生图 / 多图合成）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 编辑指令 |
| `model` | string | 否 | 固定 `agnes-image-2.5-flash` |
| `image_paths` | string[] | 是 | 输入图本地路径列表（≤ 8），按顺序对应 `<Picture N>` |
| `mask_path` | string | 否 | 局部编辑蒙版路径 |
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
| `image_paths[]` | ≤ 8 HTTPS URL | 按顺序对应 `<Picture 1>` / `<Picture 2>` |
| `images[]` | ≤ 5 HTTPS URL | 同上 |
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
[ ] (1)  输入源是 HTTPS URL（不是本地路径 / base64 / file://）
[ ] (2)  prompt 是中文（枚举值 / 参数键 / 数值字面量保留英文）
[ ] (3)  mode ↔ params 互斥：text 无图 / keyframe 有 first_frame / reference 有 images[]
[ ] (4)  size / seconds / aspect_ratio 取值在合法范围
[ ] (5)  first_frame 比例与 aspect_ratio 一致（不一致先 image_edit 转比例）
[ ] (6)  image_paths[] / images[] 全是 HTTPS URL
[ ] (7)  style_anchor 与 project.json.style_anchor 一字不差
[ ] (8)  上一步 URL 已记到 project.json.notes <file_path> → <https_url> 映射
[ ] (9)  失败重试不超过 1 次（不撞二次 quota）
[ ] (10) 不降级 mode（CLAUDE.md 红线）
```

任何一项不过 = 该阶段未完成，必须停下补做。完整 mode 决策树 / 跨工具链 URL 传递契约 / partial success 处理见 `references/mcp-usage-guide.md`。

## 历史参考

旧版本（v2.0）模型 `agnes-video-v2.0` / `agnes-image-2.0-flash` / `agnes-image-2.1-flash` / `agnes-2.0-flash`（文本）已全部下线，**禁止再使用**。bundled-skill 只走 2.5-flash 系列 + multimedia-creator MCP。

如需独立 Python 客户端调用（不通过 MCP），可参考旧版 `https://api.agnes-ai.cn/v1` REST API，但不在本 skill 范围内。
