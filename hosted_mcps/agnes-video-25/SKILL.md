---
name: agnes-video-25-generation
description: Use only when the user explicitly asks to generate videos or images via Agnes Video 2.5 / 2.5 Flash (keyframe control or image / audio / video reference) or Agnes Image 2.5 Flash. Do not trigger for the legacy agnes-video-v2.0 model, generic video / image generation, or non-Agnes vendors.
---

# Agnes Video 2.5 Generation

Use the `agnes_video_25` MCP server. If its tools are unavailable, ask the user to check the MCP configuration. Never activate without both the Video 2.5 keyword and a video-generation intent.

## Workflow

1. Resolve the prompt language.
2. Pick the model and mode that match the request.
3. Upload local reference media first (when needed) and collect public HTTPS URLs.
4. Build the prompt with `<Picture N>` / `<Audio N>` / `<Video N>` placeholders when using reference mode.
5. Submit, then poll or wait; present `local_path` and `video_url` on success.

## Tool selection

| Task | Tool | Key options |
|---|---|---|
| Pure text-to-video | `agnes25_video_generate` | `mode="text"` |
| Start/end frame control | `agnes25_video_generate` | `mode="keyframe"`, `first_frame`, `last_frame` |
| Image / audio / video reference | `agnes25_video_generate` | `mode="reference"`, `images`, `audios`, `videos` |
| Async submission, later polling | `agnes25_video_submit` → `agnes25_video_wait` / `agnes25_video_status` | preserve `video_id` |
| Text-to-image (default) | `agnes25_image_generate` | `prompt`, `size`, `ratio` |
| Image generation (explicit v2 surface) | `agnes25_image_generate_v2` | same args as `agnes25_image_generate` |
| Image-to-image / inpaint | `agnes25_image_edit` | `image_paths` (required), `mask_path?` |

## Model matrix

| Model | `mode` | Multi-image cap | size |
|---|---|---|---|
| `agnes-video-2.5` | `text` / `keyframe` / `reference` | images ≤ 8, audios ≤ 8, videos ≤ 1 | 720P / 1080P / 1K / 2K |
| `agnes-video-2.5-flash` | `text` / `keyframe` / `reference` | images ≤ 5, audios ≤ 3, **no videos** | 720P only |

`aspect_ratio` ∈ {`21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`}; `seconds` ∈ `"4"`–`"12"` (default `"5"`).

## Reference mode contract

- `images` / `audios` / `videos` must contain at least one non-empty entry.
- All media URLs must be **HTTPS public**; Agnes downloads them at submit time.
- `images[i]` is referenced in `prompt` as `<Picture i+1>` (1-indexed); same rule for `<Audio N>` and `<Video N>`.
- There is no separate "character" / "style" role tag — convey role through prompt wording.
- Maximum reference files per request: 12 total.

## Constraints and recovery

- `keyframe` mode requires `first_frame` OR `last_frame`.
- `text` mode rejects any media fields.
- On 429 / 503, `wait` retries automatically; report `video_id` so polling can continue after timeout.
- On 400, inspect `error.details.body` (Flash) or `error.details.detail` (legacy) — common causes: mode/media mismatch, size limit, image cap exceeded.

## Output

- For video, provide `local_path` (downloaded) and `video_url` when available.
- For async, surface the `video_id` so the user can resume polling later.
- For image, return the `data[]` entries with `local_path` populated per entry; do not echo b64 payloads by default.
- Do not expose credentials or invent a successful result on error.

## Image tool contract

- Single endpoint `POST /v1/images/generations` shared with agnes-image-2.5-flash.
- `size` ∈ {`1K`, `2K`, `3K`, `4K`}; `ratio` ∈ {`1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, `21:9`}.
- img2img input goes through `extra_body.image` (NOT top-level `image`); the tool accepts local paths and auto-encodes them as `data:image/...;base64,...`.
- `response_format` goes through `extra_body.response_format` (NOT top-level) — pass `"url"` or `"b64_json"`.
- Local image paths are auto-converted to data URLs; pre-existing HTTPS / data URLs pass through.
