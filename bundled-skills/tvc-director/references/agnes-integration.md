# Agnes 图像/视频生成集成指南

## 能力概述

Agnes (multimedia-creator MCP) 提供两类核心能力：

| 工具 | 类型 | 适用场景 |
|------|------|---------|
| `agnes_image_generate` | 文生图 | 产品图、角色图、场景图、故事板 |
| `agnes_image_edit` | 图生图 | 风格迁移、首帧锚定编辑 |
| `agnes_image_generate_v2` | 文生图(高信息密度) | 需要更高细节的资产图 |
| `agnes_video_generate` | 文生视频 | 直接文本生成短视频（推荐 5s/10s） |
| `agnes_video_submit` + `_wait` | 异步视频生成 | 长视频或需要精确控制的场景 |
| `list_voices` + `text_to_speech` | 音频 | 旁白/配音 |

## 图像生成参数

```json
{
  "prompt": "中文或英文提示词，描述画面内容",
  "size": "1024x1024" | "1920x1080" | "1080x1920" | ... (默认 1024x1024),
  "ratio": "1:1" | "16:9" | "9:16" | "3:4" | "4:3" | "21:9" (可选，覆盖 size)
}
```

**关键特性：**
- 中文提示词支持良好
- 支持中英混合
- 返回：`url` (公网链接) + `local_path` (本地路径)
- `return_base64: true` 可返回 base64 数据

## 视频生成参数

### 快速模式 (agnes_video_generate)

```json
{
  "prompt": "视频描述文本",
  "duration": 5,        // 支持 3/5/10 秒
  "resolution": "720p" | "1080p",
  "aspect_ratio": "16:9" | "9:16" | "1:1",
  "frame_rate": 24
}
```

### 异步模式 (agnes_video_submit → _wait)

```json
// submit
{
  "prompt": "视频描述",
  "duration": 10,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "mode": null           // 默认文生视频
}
// wait
{
  "video_id": "xxx",    // 从 submit 返回
  "download": true
}
```

**限制：**
- 单次视频时长 ≤ 10s（受服务限制）
- 长视频需分段生成后拼接（见管线 Step 6）
- 不支持 @引用语法（Seedance 的 @图片X 作为首帧 不兼容）
- **`image` 参数要求 HTTP URL，不支持本地文件路径或 data URI**——本地图片必须先上传到 img.remit.ee（见下方"图片上传工具"）
- **图片生成（`image_edit` / `image_generate`）不受此限制**：支持本地路径、远程 URL、data URI base64，直接传入即可，无需上传

### 图片上传工具（img.remit.ee）

**仅视频生成需要上传**：视频生成时若需传入参考图（storyboard、产品多视角图等），必须先将本地路径上传获取公网 URL。图片生成直接用本地路径或 data URI base64，无需上传。

```python
import subprocess, json

def upload_image(image_path: str) -> str:
    """上传本地图片到 img.remit.ee，返回直接外链 URL。"""
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "https://img.remit.ee/api/upload",
         "-H", "Referer: https://img.remit.ee/free-image-hosting",
         "-H", "Origin: https://img.remit.ee",
         "-F", f"file=@{image_path};type=image/png"],
        capture_output=True, text=True
    )
    d = json.loads(result.stdout)
    if d.get("success"):
        return "https://img.remit.ee" + d["directUrl"]
    raise RuntimeError(f"上传失败: {result.stdout}")
```

调用示例（上传故事板图后传入视频生成）：
```
# Step A: 上传图片
storyboard_url = upload_image("/path/to/storyboard.png")

# Step B: 传入视频生成
mcp__multimedia-creator__agnes_video_generate
  image: <storyboard_url>
  prompt: "..."
  duration: 5
  resolution: "720p"
```

完整 API 文档：`references/pre-production/img-upload-utility.md`

> **图片生成不用上传**：`agnes_image_edit` 和 `agnes_image_generate` 的 `image_paths` 参数直接接受本地路径或 data URI base64，无需经过 img.remit.ee。

**注意事项：**
- 并发上传有频率限制（free rate limit），连续上传间隔 ≥ 15s
- 上传成功返回的 URL 长期有效，但服务方不保证永久存储，重要资产保留本地副本

## 与短TVC管线的衔接

### 资产图生成（替换 Nano Banana Pro）

原来：Nano Banana Pro edit 模式生成产品图/角色图
现在：`agnes_image_generate` 直接生成

**产品多视图提示词模板：**
```
{产品名称}，多角度展示，白底产品摄影，专业商业摄影，
高清细节，干净背景，产品展示图，电商主图风格
```

**角色三视图提示词模板：**
```
{角色描述}，三视图，正面/侧面/背面，干净背景，
概念设计图，角色设定图，专业插画风格
```

**场景图提示词模板：**
```
{场景描述}，电影级构图，氛围光影，环境设计图，
概念艺术，cinematic lighting，wide shot
```

### 故事板生成（替换 GPT Image 2）

原来：GPT Image 2 生成 N 面板故事板（中文文字精准）
现在：`agnes_image_generate` 生成多面板故事板图

**故事板提示词结构：**
```
分镜故事板，{N}个画格，每个画格下方有标注栏：
镜号/时长/景别/运镜/光源/音效
画格1：{镜头1描述}
画格2：{镜头2描述}
...
标注栏使用简体中文，排版整齐，网格布局
```

**注意：** Agnes 对中文文字渲染不如 GPT Image 2 精准，
如果文字要求极高，仍建议手动添加标注或后续用图片编辑器补充。

### 视频生成（替换 Seedance/即梦）

原来：Seedance `@图片X 作为首帧` 或 即梦 Multi-Phase
现在：`agnes_video_generate` 文生视频，或 `agnes_image_edit` 首帧锚定

**方案 A：纯文本生成（推荐 15s 内短视频）**
直接用 shot-list 的描述文本生成视频片段，
每段 5s，最多 3 段可拼接。

**方案 B：首帧锚定（产品图引导视频）**
1. 先生成产品图/角色图
2. 用 `agnes_image_edit` 加载产品图作为 `image_paths`
3. 用 `agnes_video_generate` 或 `agnes_video_submit`，
   在 prompt 中描述运镜和动作

**方案 C：分段生成 + 拼接**
对每个 shot 单独调用 `agnes_video_generate`，
生成多个 5s 片段，在后期用视频编辑器拼接。

## 音频生成

旁白/配音使用 `mcp__edge-tts__text_to_speech`：

```json
{
  "text": "旁白文本内容",
  "voice": "zh-CN-XiaoxiaoNeural",  // 女声，甜美
  "rate": "0%",   // 语速，-50%~+200%
  "pitch": "+0Hz" // 音调
}
```

可用声音列表：`mcp__edge-tts__list_voices`
中文推荐：`zh-CN-XiaoxiaoNeural`(女/甜美)、`zh-CN-YunxiNeural`(男/叙事)

## 约束与注意事项

1. **视频时长限制**：单次 ≤ 10s，长视频必须分段
2. **无 @引用语法**：不能用 `@产品图 作为首帧` 这类 Seedance 语法
3. **中文文字**：Agnes 故事板的文字渲染精度可能不如 GPT Image 2
4. **比例匹配**：资产图比例应与最终视频比例一致（16:9 横版或 9:16 竖版）
5. **提示词语言**：中英混合效果最好，纯中文也可但部分风格词建议用英文
