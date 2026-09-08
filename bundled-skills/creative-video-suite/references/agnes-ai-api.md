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
- `mcp__multimedia-creator__agnes25_video_generate` reference 模式传 `images=["<p1>", "<p2>", ...]`（≤ 5），对应 prompt 中的 `<Picture 1>` / `<Picture 2>`。

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

| 错误 | 原因 | 处理 |
|---|---|---|
| 401 Unauthorized | API Key 无效 | 检查 mcp.json env.AGNES_API_KEY |
| 400 Bad Request | 参数错误 | 检查参数 schema（size / seconds / aspect_ratio 取值） |
| 429 Too Many Requests | 频率限制 | 工具内部退避重试；持续失败则降低并发 |
| 500 Internal Error | 服务端错误 | 重试 |

## 历史参考

旧版本（v2.0）模型 `agnes-video-v2.0` / `agnes-image-2.0-flash` / `agnes-image-2.1-flash` / `agnes-2.0-flash`（文本）已全部下线，**禁止再使用**。bundled-skill 只走 2.5-flash 系列 + multimedia-creator MCP。

如需独立 Python 客户端调用（不通过 MCP），可参考旧版 `https://api.agnes-ai.cn/v1` REST API，但不在本 skill 范围内。
