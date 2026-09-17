---
name: agnes-video-25-generation
description: Use when the user explicitly asks to generate videos or images via Agnes Video 2.5 / 2.5 Flash (keyframe control or image / audio / video reference), Agnes Video v2.0 (whitelist, since 0.2.0), or Agnes Image 2.5 Flash. Do not trigger for generic video / image generation or non-Agnes vendors.
---

# Agnes Video 2.5 Generation

Use the `agnes_video_25` MCP server. If its tools are unavailable, ask the user to check the MCP configuration. Never activate without both the Video 2.5 (or v2.0) keyword and a video-generation intent.

## Workflow

1. Resolve the prompt language.
2. Pick the model and mode that match the request.
3. For video references on 2.5 / 2.5 Flash, the server auto-resolves local paths / data URIs to HTTPS URLs via `img.remit.ee` (see Reference media resolution). No manual upload needed.
4. Build the prompt with `<Picture N>` / `<Audio N>` / `<Video N>` placeholders when using `mode="reference"` (2.5 / 2.5 Flash only).
5. Submit, then poll or wait; present `local_path` and `video_url` on success.

## Tool selection

| Task | Tool | Key options |
|---|---|---|
| Pure text-to-video | `agnes25_video_generate` | `mode="text"` |
| Start/end frame control | `agnes25_video_generate` | `mode="keyframe"`, `first_frame`, `last_frame` |
| Image / audio / video reference (2.5 / 2.5 Flash only) | `agnes25_video_generate` | `mode="reference"`, `images`, `audios`, `videos` |
| Text-to-image (default) | `agnes25_image_generate` | `prompt`, `size`, `ratio` |
| Image-to-image / inpaint | `agnes25_image_edit` | `image_paths` (required), `mask_path?` |
| Upload local file → HTTPS URL | `agnes25_upload_image` | `path` (absolute local file path) |

## Model matrix

| Model | `mode` | Multi-image cap | size | aspect_ratio |
|---|---|---|---|---|
| `agnes-video-2.5` | `text` / `keyframe` / `reference` | images ≤ 8, audios ≤ 8, videos ≤ 1 | 720P / 1080P / 1K / 2K | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
| `agnes-video-2.5-flash` | `text` / `keyframe` / `reference` | images ≤ 5, audios ≤ 3, **no videos** | 720P only | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
| `agnes-video-v2.0` (0.2.0+) | `text` / `keyframe` only (**no `reference`**) | — | `480p` / `720p` / `1080p` (lowercase `p`) | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 (**no 21:9**) |

`seconds` ∈ `"4"`–`"12"` (default `"5"`) is the unified input on all models; the server translates to v2.0's `num_frames` (snapped to `{81, 121, 241, 441}`) + fixed `frame_rate: 24` when `model="agnes-video-v2.0"`.

## Reference mode contract

- `images` / `audios` / `videos` must contain at least one non-empty entry.
- All media URLs must be **HTTPS public**; Agnes downloads them at submit time. Local paths and `data:` URIs are **auto-resolved server-side** (see Reference media resolution below).
- `images[i]` is referenced in `prompt` as `<Picture i+1>` (1-indexed); same rule for `<Audio N>` and `<Video N>`.
- There is no separate "character" / "style" role tag — convey role through prompt wording.
- Maximum reference files per request: 12 total.

## Reference media resolution

Video media fields (`images` / `audios` / `first_frame` / `last_frame`) accept three input forms and the server normalizes all of them to an HTTPS URL before submitting to Agnes:

| Input form | Example | Server action |
|---|---|---|
| HTTPS URL | `https://cdn.example.com/ref.png` | Pass through as-is |
| Data URI base64 | `data:image/png;base64,iVBORw0KG...` | Decode bytes → temp file → upload to `img.remit.ee` → URL |
| Local file path | `/abs/path/to/ref.png` (or `file:///abs/path`) | Upload to `img.remit.ee` → URL |

The upload endpoint is `POST https://img.remit.ee/api/upload` (multipart/form-data, field `file`). Required headers: `Referer: https://img.remit.ee/free-image-hosting` and `Origin: https://img.remit.ee` (else 403). Limits: ≤ 20 MB per file; free rate limit (~429) — wait 15s before retrying concurrent uploads. The free host makes no availability guarantees — keep local copies of important assets.

The `videos` field is `list[dict[str, Any]]` (structured objects); URL fields inside the dict are not auto-resolved — pass full HTTPS URLs.

## Constraints and recovery

- `keyframe` mode requires `first_frame` OR `last_frame`.
- `text` mode rejects any media fields.
- On 429 / 503, `video_generate` retries automatically inside `wait`; on terminal timeout, surface the `video_id` so the caller can re-invoke with a fresh timeout.
- On 400, inspect `error.details.body` (Flash) or `error.details.detail` (legacy) — common causes: mode/media mismatch, size limit, image cap exceeded.

## Output

- For video, provide `local_path` (downloaded) and `video_url` when available.
- For async, surface the `video_id` so the user can resume polling later.
- For image, return the `data[]` entries with `local_path` populated per entry; do not echo b64 payloads by default.
- Do not expose credentials or invent a successful result on error.

## Image tool contract

- Single endpoint `POST /v1/images/generations` shared with agnes-image-2.5-flash.
- `size` ∈ {`1K`, `2K`, `3K`, `4K`}; `ratio` ∈ {`1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, `21:9`}.
- img2img input goes through `extra_body.image` (NOT top-level `image`); the tool accepts **HTTPS URLs, data URI base64 (`data:image/...;base64,...`), and local file paths** in `image_paths` / `mask_path`. Only local paths are auto-encoded to data URLs; HTTPS URLs and data URIs pass through as-is.
- `response_format` goes through `extra_body.response_format` (NOT top-level) — pass `"url"` or `"b64_json"`.
- Local image paths are auto-converted to data URLs; pre-existing HTTPS / data URLs pass through.
