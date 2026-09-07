# Agnes Video 2.5 MCP Service

Standalone MCP server wrapping **Agnes Video 2.5** and **Agnes Video 2.5 Flash** with first-class `reference` mode support (image / audio / video reference via `images[]` / `audios[]` / `videos[]` arrays and `<Picture N>` / `<Audio N>` / `<Video N>` prompt placeholders).

This service is **independent** of `hosted_mcps/agnes-mcp-studio/` (which targets the legacy `agnes-video-v2.0` model). Run it alongside or replace — both can coexist.

## When to use this service

| Need | Use this service | Use `agnes-mcp-studio` |
|---|---|---|
| Reference-mode video (images / audios as visual + audio anchors) | ✅ | ❌ (only `extra_body.image` keyframes) |
| First / last frame control (`first_frame` / `last_frame`) | ✅ | ❌ (only `mode="ti2vid"` + `mode="keyframes"`) |
| Legacy v2.0 model (back-compat with existing pipelines) | ❌ | ✅ |
| Image generation (text-to-image, image edit, 2.5-flash) | ✅ | ✅ (parallel surface) |

## Install

```bash
cd hosted_mcps/agnes-video-25
uv sync                # installs the package + dependencies
```

## Run standalone (stdio MCP)

```bash
uv run agnes-video-25-mcp
```

## Wire into `.mcp.json`

Add alongside `multimedia-creator`:

```jsonc
{
  "mcpServers": {
    "multimedia-creator": { /* existing agnes-mcp-studio entry */ },
    "agnes-video-25": {
      "command": "uv",
      "args": [
        "--directory", "/absolute/path/to/hosted_mcps/agnes-video-25",
        "run", "agnes-video-25-mcp"
      ],
      "env": {
        "AGNES_API_KEY": "sk-your-key-here",
        "AGNES_BASE_URL": "https://api.agnes-ai.cn/v1"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Notes |
|---|:---:|---|---|
| `AGNES_API_KEY` | yes | — | Same key works for `.agnes-ai.cn` (CN) or `.agnes-ai.com` (intl) — pick the matching `AGNES_BASE_URL`. |
| `AGNES_BASE_URL` | no | `https://api.agnes-ai.cn/v1` | API root. CN / intl keys are not interchangeable. |
| `AGNES_OUTPUT_DIR` | no | `./outputs` | Where downloaded media land (videos → `<dir>/videos/`, images → `<dir>/images/`). Use an absolute path for predictable layouts. |

## Tools

| Tool | Purpose |
|---|---|
| `agnes25_video_generate` | Submit + wait + download video in one call (`mode="text" \| "keyframe" \| "reference"`) |
| `agnes25_image_generate` | Generate images (text-to-image + optional img2img via `image_paths`) |
| `agnes25_image_edit` | Edit images via `image_paths` + optional `mask_path` (inpainting) |

Full schema: see [`SKILL.md`](SKILL.md). Public docs:
- <https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25>
- <https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash>
- <https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash>
