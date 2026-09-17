# multimedia-creator MCP 工具能力 + 调用模板

> **目的**：marketing-ad-skill 唯一允许的素材生成工具来源。所有 `image_generate` / `image_edit` / `video_generate` / `upload_image` 调用必须按本文档规范。

---

## 一、可用工具清单

| 工具名 | 用途 | 必传参数 | 常用可选参数 |
|---|---|---|---|
| `mcp__multimedia-creator__agnes25_image_generate` | 文生图/图生图 | `prompt` | `size`, `ratio`, `image_paths`（参考图）, `n`, `output_filename` |
| `mcp__multimedia-creator__agnes25_image_edit` | 图像编辑（含 mask） | `prompt`, `image_paths` | `mask_path`, `size`, `ratio`, `output_filename` |
| `mcp__multimedia-creator__agnes25_video_generate` | 文生视频/关键帧/参考图 | `prompt` | `mode`（text/keyframe/reference）, `seconds`（4-12）, `size`, `aspect_ratio`, `first_frame`, `last_frame`, `images[]`, `audios[]`, `videos[]`, `output_filename` |
| `mcp__multimedia-creator__agnes25_upload_image` | 上传本地图片到 img.remit.ee 公开 URL | `path` | - |

**模型**：默认 `agnes-image-2.5-flash` / `agnes-video-2.5-flash`

**第三方图片 host**：`img.remit.ee`（20MB 单文件上限，约 429 速率限制，调用间隔 15s）

---

## 二、4 类广告路由 → MCP 工具组合

| 广告类型 | 必须工具 | 典型调用流程 |
|---|---|---|
| 商品展示 | image_generate（hero）+ video_generate（参考图 mode） | hero 图 → 关键帧视频 → drawtext |
| 电商种草 | image_generate（角色/场景）+ video_generate（reference mode） | 角色立绘 → 多段视频 → drawtext |
| 游戏买量 | image_generate（CG 风格图）+ video_generate（text/keyframe mode） | 风格图 → 短段（4-8s）冲击 → drawtext + logo |
| 品牌宣传 | image_generate（氛围图）+ video_generate（keyframe mode） | 氛围图 → 慢镜视频 → 品牌 jingle |

---

## 三、video_generate 4 种 mode 用法

### 3.1 text mode（纯文本）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "text",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16"
}
```

**适用**：纯文字描述、无需参考图的短视频片段（品牌宣传氛围段）。

### 3.2 keyframe mode（首帧图驱动）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "keyframe",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16",
  "first_frame": "https://img.remit.ee/xxx.png"
}
```

**适用**：
- **商品展示 hero shot**（关键！避免失败模式 #4）
- 视频复刻（`first_frame` = 参考视频的关键帧）

### 3.3 reference mode（参考图锚定）

```json
{
  "prompt": "12s 视频规格...",
  "mode": "reference",
  "seconds": "12",
  "size": "720P",
  "aspect_ratio": "9:16",
  "images": [
    "https://img.remit.ee/char1.png",
    "https://img.remit.ee/scene1.png"
  ]
}
```

**适用**：
- **多角色/多场景锚脸**（电商种草、品牌宣传）
- **场景/角色不漂移**（避免失败模式 #5/#8/#13）

**约束**：≤5 张参考图。

### 3.4 关键决策树

| 场景 | mode |
|---|---|
| 商品展示 hero shot | **keyframe** |
| 电商种草 1-2 使用场景 | **reference**（角色立绘 + 场景图） |
| 电商种草 涂抹类（美妆） | **reference**（涂抹 ≥4s + 场景锁定） |
| 游戏买量 hook 大场面 | text 或 reference |
| 游戏买量 抽卡金光爆发 | **reference**（角色立绘） |
| 品牌宣传 氛围 | **keyframe**（氛围图作 first_frame） |
| 品牌宣传 人物 | **reference**（角色立绘） |

---

## 四、image_generate 关键参数

### 4.1 size 与 ratio 对应（默认 1K）

| ratio | 适用平台 | 备注 |
|---|---|---|
| 9:16 | 抖音/视频号/竖屏 | 默认推荐 |
| 16:9 | B站/横屏 TVC | 横屏广告 |
| 1:1 | 小红书/Instagram | 商品展示图 |

### 4.2 关键 prompt 模式（直接复用）

**商品 hero shot 模式**：
```text
studio product photography, [产品名], dramatic side light,
matte black background, hyperrealistic, premium commercial photography,
faint film grain
```

**角色立绘模式**（参考 video-skills/short-drama-ad-skill §角色资产优先规范）：
```text
character identity master, full body portrait, front view,
[角色详细描述], [服装], [表情], consistent lighting setup
```

**氛围图模式**：
```text
[调性关键词] atmosphere, [场景], [光线], [色调], cinematic composition,
no character, no text
```

### 4.3 输出文件命名约定

```text
[广告类型]_[产品]_[版本]_[段号]_[元素].png
示例：show_charlotteruby_v1_seg3_heroshot.png
示例：brand_tea_v2_seg1_atmosphere.png
```

---

## 五、拼接 SOP（30s+ 必走）

### 5.1 30s 拼接（concat demuxer + -c copy）

```bash
# segments.txt
file 'seg1.mp4'
file 'seg2.mp4'
file 'seg3.mp4'

# 拼接
ffmpeg -f concat -safe 0 -i segments.txt -c copy final_30s.mp4
```

### 5.2 49s+ 拼接（v9b 修复 · concat filter，避免 silent 截断）

```bash
# 段 1/3 配 silent audio（避免 demuxer -c copy 在 24.5s 截断）
ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 12 seg1_silent.mp4 \
  -i seg1.mp4 -c:v copy -c:a aac -map 1:v -map 0:a -shortest seg1_final.mp4

# concat filter（不是 demuxer）
ffmpeg -f concat -safe 0 -i segments.txt -filter_complex \
  "[0:v][1:v][2:v][3:v]concat=n=4:v=1[outv]" \
  -map "[outv]" final_49s.mp4
```

### 5.3 字幕永远后处理（第三十轮 v9 决策 · 铁律）

**绝对禁止**：prompt 中写"Subtitle at bottom / MANDATORY BOTTOM SUBTITLE / AI 内嵌字幕"等让 AI 生成字幕的关键词。

**正确做法**：`ffmpeg drawtext` 后压每句字幕：

```bash
ffmpeg -i seg.mp4 -vf \
  "drawtext=text='产品名':fontfile=/path/font.ttf:fontsize=52:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10:x=(w-tw)/2:y=h-th-50:enable='between(t,27,28.5)'" \
  -c:a copy seg_with_subtitle.mp4
```

**理由**：
- AI 字幕重复渲染（v8 实证 4 次 → 2 次仍不彻底）
- AI 字幕段尾不渲染（最后 0.5s 渲染窗口不足）
- AI 配音串冲突（v8 沙僧声变猪八戒声）
- drawtext 时间码精确（fps=1 抽帧校准）/ 0 重复 / 0 配音冲突 / 字幕表可审计

**视觉标题例外**：草书标题/hero shot 等"画面元素"字幕仍可用 `MANDATORY CENTER FRAME` 关键词（AI 渲染中央大字）。

### 5.4 配音冲突修复（第三十轮 v11 决策）

```text
Use consistent [ambient/dedicated] audio throughout this entire
N-second segment. Do NOT switch audio between characters.
```

**触发场景**：游戏买量多角色对话、品牌宣传多人物同框。

---

## 六、调用时机与并发

| 阶段 | 调用 |
|---|---|
| §2.2 产品信息 | 不调用（仅收集信息） |
| §2.3 创意方向 | 不调用（仅产出文字方向） |
| §2.4 时间轴 | 不调用（仅产出节拍） |
| §2.5 最终提示词 | **调用**（按 4 类广告路由） |

**并发建议**：
- 多个 `image_generate` 可并行（如 hero shot + 角色立绘 + 场景图）
- `video_generate` 默认串行（避免速率限制 + 输出文件管理）
- drawtext 后处理在视频生成完成后串行

**速率限制**：
- image_generate：约 5-10 秒/次
- video_generate：约 3-8 分钟/段
- img.remit.ee 上传：约 15 秒/次（429 限速）

---

## 七、image_edit 用法（可选）

适用场景：
- hero shot 局部修改（如替换产品包装颜色）
- 角色立绘服装换色
- 场景图细节调整

```json
{
  "prompt": "将产品包装从红色改为黑色",
  "image_paths": ["https://img.remit.ee/original.png"],
  "mask_path": "/path/to/mask.png",  // 可选：仅修改 mask 区域
  "output_filename": "product_v2_black.png"
}
```

**mask 生成方法**：用 image_edit 工具的提示词或外部工具生成 mask PNG（白色区域 = 待修改）。

---

## 八、错误处理速查

| 错误 | 原因 | 修复 |
|---|---|---|
| `APIConnectionError` | 网络/服务商问题 | 重试 1-2 次；检查 API Key |
| `content_policy_violation` | prompt 含违规关键词 | 删除敏感词（wrinkles/smile/chubby/middle-aged） |
| 视频生成超时 | 队列等待过长 | 增加 `timeout_seconds`（默认 600s） |
| 字幕重复渲染 | prompt 含 AI 内嵌字幕关键词 | 删除（v9 决策） |
| 角色配音漂移 | 多角色段未声明 narrator | 加 `Use consistent narrator voice` |
| reference mode 场景漂移 | 多场景未锁定 | 段首加场景锁定指令 |