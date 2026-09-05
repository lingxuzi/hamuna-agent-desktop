# img.remit.ee 图片上传工具

> 将本地图片路径上传到免费图床，返回公网 URL。**仅视频生成（`agnes_video_generate`）需要上传后传入；图片生成（`agnes_image_edit` / `agnes_image_generate`）可直接用本地路径或 data URI base64。**

---

## 何时需要上传

| 操作 | 是否需要上传 | 原因 |
|------|------------|------|
| `agnes_image_edit`（图生图） | ❌ 不需要 | 支持本地路径、远程 URL、data URI base64 |
| `agnes_image_generate`（文生图 + 参考图） | ❌ 不需要 | 同上 |
| `agnes_video_generate`（文生视频 + 参考图） | ✅ **必须** | `image` 参数只接受 HTTP(S) URL，不接受本地路径或 data URI |
| `agnes_video_submit`（同上） | ✅ **必须** | 同上 |

---

## 为什么需要这个工具

Agnes 的视频生成接口 `image` 参数要求 **HTTP(S) URL**，不接受本地文件路径或 data URI。
storyboard 图、产品多视角图、产品原图在本地磁盘，传给视频生成前必须上传到 img.remit.ee 获取公网 URL。

---

## API 接口

| 项目 | 值 |
|------|-----|
| 端点 | `POST https://img.remit.ee/api/upload` |
| Content-Type | `multipart/form-data` |
| 表单字段 | `file`（本地文件） |
| 必填 Header | `Referer: https://img.remit.ee/free-image-hosting`、`Origin: https://img.remit.ee` |
| 文件大小限制 | ≤ 20MB |
| 认证 | 无（免登录） |

**不带 Referer 会返回 403：** `"不允许直接调用API，请使用网页界面上上传"`

---

## 上传执行方式

**在 Bash 工具中执行以下 Python 代码**（每次传不同文件路径即可）：

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

# 使用示例
url = upload_image("/path/to/local/image.png")
print(url)
```

**单次可批量上传多个文件：**

```python
images = {
    "storyboard": "/home/user/project/storyboard.png",
    "turnaround": "/home/user/project/turnaround.png",
    "product":    "/home/user/project/product_ref.png",
}
for name, path in images.items():
    print(f"{name}: {upload_image(path)}")
```

---

## 响应结构

成功时返回 JSON：

```json
{
  "success": true,
  "url": "/api/file/<id>.png",       // Markdown 内嵌用（相对路径）
  "directUrl": "/api/file/<id>.png", // 直链（同 url，拼域名即可）
  "previewUrl": "/view/<shortcode>", // 预览页
  "shortUrl": "/i/<shortcode>"       // 短链
}
```

**最终可直接用于 Agnes 的 URL：** `https://img.remit.ee{directUrl}`

---

## 支持格式

JPG、PNG、GIF、WebP、BMP、TIFF、PDF、MP4、WebM、MOV

---

## 典型使用场景

### 1. 视频生成时传入参考图

```python
# 上传故事板图
storyboard_url = upload_image("/home/user/project/storyboard.png")
# 上传产品多视角图
turnaround_url = upload_image("/home/user/project/turnaround.png")
```

然后传入视频生成：
```
mcp__multimedia-creator__agnes_video_generate
  image: <storyboard_url>   ← 必须是 URL，不是本地路径
  prompt: "..."
```

### 2. 视频生成前上传图片（Step 3 → 视频生成流程）

生成 storyboard / 多视角 Turnaround 图后，在调用 `agnes_video_generate` 之前，先上传到 img.remit.ee 获取公网 URL：

```python
storyboard_url = upload_image("/path/to/storyboard.png")
turnaround_url = upload_image("/path/to/turnaround.png")
```

然后传入视频生成（**只能用 URL**）：
```
mcp__multimedia-creator__agnes_video_generate
  image: <storyboard_url>   ← 必须是 HTTP URL，不能是本地路径或 data URI
  prompt: "..."
```

> **注意**：`agnes_image_edit` / `agnes_image_generate` 传参考图时**不需要上传**——直接用本地路径或 data URI base64 即可。

---

## 注意事项

- 免费图床，无 API Key，但**有频率限制**（free rate limit），并发上传会触发 429
- 连续生成多个视频片段时，间隔 15 秒以上再上传，避免限速
- 图片 URL 长期有效，但**不保证永久存储**——重要资产请保留本地副本
- 不支持文件重名覆盖，每次上传生成新 ID
