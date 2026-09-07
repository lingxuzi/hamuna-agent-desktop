"""Agnes Video 2.5 MCP service.

Wraps Agnes Video 2.5 / 2.5 Flash with three generation modes:
  - text:      pure text-to-video
  - keyframe:  first_frame / last_frame control
  - reference: images / audios / videos as visual/audio/motion reference

Public schema mirrors https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25
and agnes-video-25-flash. HTTPS-only media URLs (per public docs).
"""

from __future__ import annotations

import asyncio
import base64
import math
import mimetypes
import os
import time
import uuid
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP


load_dotenv()

mcp = FastMCP("Agnes Video 2.5 MCP")

DEFAULT_BASE_URL = "https://api.agnes-ai.cn/v1"
DEFAULT_MODEL = "agnes-video-2.5"
DEFAULT_FLASH_MODEL = "agnes-video-2.5-flash"
DEFAULT_SIZE = "720P"
DEFAULT_ASPECT = "16:9"
DEFAULT_SECONDS = "5"

# Image models. Per wiki docs, agnes-image-2.5-flash supersedes 2.1 and shares
# the same /v1/images/generations schema (size 1K/2K/3K/4K + ratio).
DEFAULT_IMAGE_MODEL = "agnes-image-2.5-flash"
DEFAULT_IMAGE_MODEL_V2 = "agnes-image-2.5-flash"
DEFAULT_IMAGE_SIZE = "1K"
DEFAULT_IMAGE_RATIO = "1:1"
IMAGE_RATIOS = {"1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"}
IMAGE_SIZES = {"1K", "2K", "3K", "4K"}

MODELS = {DEFAULT_MODEL, DEFAULT_FLASH_MODEL}
MODES = {"text", "keyframe", "reference"}
ASPECT_RATIOS = {"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
SIZES_2_5 = {"720P", "1080P", "1K", "2K"}
SIZES_FLASH = {"720P"}
IMAGE_LIMITS = {DEFAULT_MODEL: 8, DEFAULT_FLASH_MODEL: 5}
AUDIO_LIMITS = {DEFAULT_MODEL: 8, DEFAULT_FLASH_MODEL: 3}

_WINDOWS_RESERVED_STEMS = {
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
    *(f"COM{n}" for n in range(1, 10)),
    *(f"LPT{n}" for n in range(1, 10)),
}


def _env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v


def _base_url() -> str:
    return str(_env("AGNES_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")


def _domain_root() -> str:
    parsed = urlparse(_base_url())
    return f"{parsed.scheme}://{parsed.netloc}"


def _error(code: str, message: str, *, details: Any | None = None, **extra: Any) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    result: dict[str, Any] = {"ok": False, "error": err}
    result.update(extra)
    return result


def _ensure_output_dir() -> Path:
    root = Path(str(_env("AGNES_OUTPUT_DIR", "./outputs"))).expanduser()
    directory = root / "videos"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _sanitize_filename(name: str | None) -> str | None:
    if not name:
        return None
    p = PureWindowsPath(name)
    if p.drive or name.startswith(("/", "\\")):
        return None
    stem = p.name
    if not stem or stem in {".", ".."} or stem.endswith((" ", ".")) or \
       stem.split(".", 1)[0].upper() in _WINDOWS_RESERVED_STEMS:
        return None
    return stem


def _is_https_url(value: str) -> bool:
    return urlparse(value).scheme == "https"


def _is_data_uri(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("data:")


def _upload_to_remit_ee(path: Path) -> str:
    """Upload a local file to img.remit.ee free image host; return full HTTPS URL.

    Endpoint: POST https://img.remit.ee/api/upload (multipart/form-data, field 'file').
    Required headers: Referer + Origin (else 403 '不允许直接调用API').
    """
    headers = {
        "Referer": "https://img.remit.ee/free-image-hosting",
        "Origin": "https://img.remit.ee",
    }
    try:
        with path.open("rb") as f:
            r = httpx.post(
                "https://img.remit.ee/api/upload",
                headers=headers,
                files={"file": (path.name, f, "application/octet-stream")},
                timeout=60.0,
            )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"img.remit.ee upload network error: {exc}") from exc
    if r.status_code == 403:
        raise RuntimeError("img.remit.ee 403: missing Referer/Origin header.")
    if r.status_code == 429:
        raise RuntimeError("img.remit.ee 429 rate limited; retry after 15s.")
    if r.status_code >= 400:
        raise RuntimeError(f"img.remit.ee upload failed ({r.status_code}): {r.text[:200]}")
    try:
        data = r.json()
    except ValueError as exc:
        raise RuntimeError(f"img.remit.ee response not JSON: {r.text[:200]}") from exc
    if not data.get("success"):
        raise RuntimeError(f"img.remit.ee upload not successful: {data}")
    direct = data.get("directUrl") or data.get("url")
    if not direct:
        raise RuntimeError(f"img.remit.ee response missing directUrl: {data}")
    return "https://img.remit.ee" + direct


def _resolve_image_ref(value: str, *, field: str) -> tuple[bool, str | dict[str, Any]]:
    """Resolve a video media reference to an HTTPS URL (or error dict).

    Branches: https URL 直传; data URI → decode bytes → 上传 img.remit.ee 拿 URL;
    local path → 上传 img.remit.ee 拿 URL.
    """
    if _is_https_url(value):
        return True, value
    if _is_data_uri(value):
        try:
            header, payload = value.split(",", 1)
            mime = (header[len("data:"):].split(";", 1)[0].strip() or "image/png")
            ext = mimetypes.guess_extension(mime.split(";")[0].strip()) or ".png"
            data = base64.b64decode(payload, validate=True)
        except Exception as exc:
            return False, _error(
                "invalid_data_uri",
                f"{field} is not a valid data URI base64: {exc}",
                details={"field": field, "value_prefix": value[:64]},
            )
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        try:
            return True, _upload_to_remit_ee(tmp_path)
        except Exception as exc:
            return False, _error(
                "remit_ee_upload_failed",
                f"{field} data URI upload failed: {exc}",
                details={"field": field, "exception": str(exc)},
            )
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass
    p = Path(value)
    if not p.is_file():
        return False, _error(
            "invalid_param",
            f"{field} is neither HTTPS URL, data URI, nor existing local file.",
            details={"field": field, "value": value},
        )
    try:
        return True, _upload_to_remit_ee(p)
    except Exception as exc:
        return False, _error(
            "remit_ee_upload_failed",
            f"{field} local path upload failed: {exc}",
            details={"field": field, "path": value, "exception": str(exc)},
        )


def _resolve_image_refs(values: list[str], *, field: str) -> tuple[bool, list[str] | dict[str, Any]]:
    resolved: list[str] = []
    for v in values:
        ok, res = _resolve_image_ref(v, field=field)
        if not ok:
            return False, res  # type: ignore[return-value]
        resolved.append(res)  # type: ignore[arg-type]
    return True, resolved


def _validate_urls(values: list[str] | None, *, field: str, max_count: int) -> tuple[bool, str | dict[str, Any]]:
    if not values:
        return True, ""
    if len(values) > max_count:
        return False, _error(
            "invalid_param",
            f"{field} exceeds max count {max_count} for the chosen model.",
            details={"field": field, "count": len(values), "max": max_count},
        )
    for url in values:
        if not _is_https_url(url):
            return False, _error(
                "invalid_url",
                f"{field} entries must be HTTPS URLs (per Agnes Video 2.5 docs).",
                details={"field": field, "url": url},
            )
    return True, ""


def _request_json(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    timeout: float = 120.0,
    base_url: str | None = None,
) -> tuple[bool, dict[str, Any]]:
    key = _env("AGNES_API_KEY")
    if not key:
        return False, _error("missing_api_key", "Set AGNES_API_KEY before calling Agnes.")
    url = f"{base_url or _base_url()}{path}"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.request(method, url, headers=headers, json=json_body)
            r.raise_for_status()
            return True, r.json() if r.content else {}
    except httpx.HTTPStatusError as exc:
        return False, _error("http_error", "Agnes returned non-success.",
                             details={"status_code": exc.response.status_code,
                                      "body": exc.response.text})
    except httpx.TimeoutException as exc:
        return False, _error("timeout", "Agnes request timed out.", details=str(exc))
    except httpx.RequestError as exc:
        return False, _error("request_error", "Agnes request failed.", details=str(exc))
    except ValueError as exc:
        return False, _error("invalid_response", "Non-JSON response from Agnes.", details=str(exc))


def _extract(response: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = response.get(k)
        if v is not None:
            return v
    data = response.get("data")
    if isinstance(data, dict):
        return _extract(data, *keys)
    return None


def _looks_like_url(value: Any) -> bool:
    return isinstance(value, str) and urlparse(value).scheme in {"http", "https"}


def _extract_video_url(response: dict[str, Any]) -> str | None:
    """Extract the final video URL.

    Docs (agnes-video-25 / agnes-video-25-flash) describe metadata.url, but the
    real polling response puts the URL at the top level for completed tasks.
    Try metadata first, then fall back to top-level url.
    """
    metadata = response.get("metadata")
    if isinstance(metadata, dict) and _looks_like_url(metadata.get("url")):
        return str(metadata["url"])
    top = response.get("url")
    if _looks_like_url(top):
        return str(top)
    data = response.get("data")
    if isinstance(data, dict):
        return _extract_video_url(data)
    return None


def _build_payload(
    *,
    model: str,
    prompt: str,
    mode: str,
    seconds: str,
    size: str,
    aspect_ratio: str,
    seed: int | None,
    first_frame: str | None,
    last_frame: str | None,
    images: list[str] | None,
    audios: list[str] | None,
    videos: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "mode": mode,
        "seconds": seconds,
        "size": size,
        "aspect_ratio": aspect_ratio,
    }
    if seed is not None:
        payload["seed"] = seed
    if mode == "keyframe":
        if first_frame:
            payload["first_frame"] = first_frame
        if last_frame:
            payload["last_frame"] = last_frame
    elif mode == "reference":
        if images:
            payload["images"] = images
        if audios:
            payload["audios"] = audios
        if videos:
            payload["videos"] = videos
    return payload


def _validate_request(
    model: str, mode: str, size: str, aspect_ratio: str,
    first_frame: str | None, last_frame: str | None,
    images: list[str] | None, audios: list[str] | None,
    videos: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    if model not in MODELS:
        return _error("invalid_model", f"model must be one of {sorted(MODELS)}.",
                      details={"got": model})
    if mode not in MODES:
        return _error("invalid_mode", f"mode must be one of {sorted(MODES)}.",
                      details={"got": mode})
    valid_sizes = SIZES_FLASH if model == DEFAULT_FLASH_MODEL else SIZES_2_5
    if size not in valid_sizes:
        return _error("invalid_size", f"size must be one of {sorted(valid_sizes)} for {model}.",
                      details={"got": size, "allowed": sorted(valid_sizes)})
    if aspect_ratio not in ASPECT_RATIOS:
        return _error("invalid_aspect_ratio", f"aspect_ratio must be one of {sorted(ASPECT_RATIOS)}.",
                      details={"got": aspect_ratio})

    if mode == "keyframe":
        if not first_frame and not last_frame:
            return _error("missing_keyframe",
                          "keyframe mode requires at least one of first_frame / last_frame.")
        for field, value in (("first_frame", first_frame), ("last_frame", last_frame)):
            if value and not _is_https_url(value):
                return _error("invalid_url", f"{field} must be HTTPS URL.",
                              details={"field": field, "url": value})
    elif mode == "reference":
        if not (images or audios or videos):
            return _error("missing_reference",
                          "reference mode requires at least one of images / audios / videos.")
        if videos and model == DEFAULT_FLASH_MODEL:
            return _error("videos_unsupported",
                          "videos reference is not supported on agnes-video-2.5-flash.")
        img_limit = IMAGE_LIMITS[model]
        aud_limit = AUDIO_LIMITS[model]
        for field, values, limit in (("images", images, img_limit),
                                     ("audios", audios, aud_limit)):
            if values:
                ok, err = _validate_urls(values, field=field, max_count=limit)
                if not ok:
                    return err  # type: ignore[return-value]
    elif mode == "text":
        if first_frame or last_frame or images or audios or videos:
            return _error("media_in_text_mode",
                          "text mode does not accept first_frame/last_frame/images/audios/videos.")
    return None


def _safe_name(prefix: str, suffix: str) -> str:
    return f"{prefix}-{int(time.time())}-{uuid.uuid4().hex[:8]}{suffix}"


def _suffix_from_url(url: str, content_type: str | None) -> str:
    s = Path(urlparse(url).path).suffix
    if s:
        return s
    if content_type:
        g = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if g:
            return g
    return ".mp4"


def _download_video(url: str, filename: str | None) -> tuple[bool, str | dict[str, Any]]:
    try:
        with httpx.Client(timeout=600.0, follow_redirects=True) as client:
            r = client.get(url)
            r.raise_for_status()
            suffix = _suffix_from_url(url, r.headers.get("content-type"))
            directory = _ensure_output_dir()
            path = directory / (filename or _safe_name("agnes25-video", suffix))
            path.write_bytes(r.content)
            return True, str(path)
    except httpx.HTTPError as exc:
        return False, _error("download_error", "Could not download generated video.",
                             details={"url": url, "exception": str(exc)})
    except OSError as exc:
        return False, _error("file_write_error", "Could not write video to disk.",
                             details={"exception": str(exc)})


def _submit_impl(
    prompt: str, *,
    model: str = DEFAULT_MODEL, mode: str = "text",
    seconds: str = DEFAULT_SECONDS, size: str = DEFAULT_SIZE,
    aspect_ratio: str = DEFAULT_ASPECT, seed: int | None = None,
    first_frame: str | None = None, last_frame: str | None = None,
    images: list[str] | None = None, audios: list[str] | None = None,
    videos: list[dict[str, Any]] | None = None,
    include_raw: bool = False,
) -> dict[str, Any]:
    """Internal submit helper used by _generate_impl. Not exposed as MCP tool."""
    if not prompt.strip():
        return _error("invalid_prompt", "prompt must not be empty.")
    if mode == "keyframe":
        if first_frame:
            ok, first_frame = _resolve_image_ref(first_frame, field="first_frame")
            if not ok:
                return first_frame  # type: ignore[return-value]
        if last_frame:
            ok, last_frame = _resolve_image_ref(last_frame, field="last_frame")
            if not ok:
                return last_frame  # type: ignore[return-value]
    elif mode == "reference":
        if images:
            ok, images = _resolve_image_refs(images, field="images")
            if not ok:
                return images  # type: ignore[return-value]
        if audios:
            ok, audios = _resolve_image_refs(audios, field="audios")
            if not ok:
                return audios  # type: ignore[return-value]

    err = _validate_request(model, mode, size, aspect_ratio,
                            first_frame, last_frame, images, audios, videos)
    if err:
        return err

    payload = _build_payload(
        model=model, prompt=prompt, mode=mode, seconds=seconds, size=size,
        aspect_ratio=aspect_ratio, seed=seed, first_frame=first_frame,
        last_frame=last_frame, images=images, audios=audios, videos=videos,
    )
    ok, response = _request_json("POST", "/videos", json_body=payload)
    if not ok:
        return response
    result = {
        "ok": True,
        "task_id": _extract(response, "task_id", "id"),
        "video_id": _extract(response, "video_id"),
        "status": _extract(response, "status"),
        "model": _extract(response, "model") or model,
    }
    for field in ("progress", "seconds", "size", "created_at"):
        v = _extract(response, field)
        if v is not None:
            result[field] = v
    if include_raw:
        result["raw"] = response
    return result


def _status_impl(video_id: str, *, model: str = DEFAULT_MODEL,
                 include_raw: bool = False) -> dict[str, Any]:
    if not video_id.strip():
        return _error("invalid_video_id", "video_id must not be empty.")
    if model not in MODELS:
        return _error("invalid_model", f"model must be one of {sorted(MODELS)}.",
                      details={"got": model})
    path = f"/agnesapi?video_id={quote(video_id, safe='')}&model_name={quote(model, safe='')}"
    ok, response = _request_json("GET", path, base_url=_domain_root())
    if not ok:
        response["video_id"] = video_id
        return response
    result = {
        "ok": True,
        "task_id": _extract(response, "task_id", "id"),
        "video_id": _extract(response, "video_id") or video_id,
        "status": _extract(response, "status"),
        "video_url": _extract_video_url(response),
    }
    for field in ("model", "progress", "seconds", "size", "created_at", "completed_at"):
        v = _extract(response, field)
        if v is not None:
            result[field] = v
    if response.get("error"):
        result["task_error"] = response["error"]
    if include_raw:
        result["raw"] = response
    return result


def _wait_impl(
    video_id: str, *,
    model: str = DEFAULT_MODEL,
    timeout_seconds: float = 600.0, poll_interval_seconds: float = 5.0,
    download: bool = True, output_filename: str | None = None,
) -> dict[str, Any]:
    if timeout_seconds <= 0:
        return _error("invalid_timeout", "timeout_seconds must be > 0.")
    if poll_interval_seconds <= 0:
        return _error("invalid_poll_interval", "poll_interval_seconds must be > 0.")
    filename = _sanitize_filename(output_filename)
    attempts = max(1, math.ceil(timeout_seconds / poll_interval_seconds) + 1)
    last: dict[str, Any] | None = None
    for attempt in range(attempts):
        last = _status_impl(video_id, model=model, include_raw=True)
        if not last.get("ok"):
            err = last.get("error") or {}
            det = err.get("details") if isinstance(err, dict) else None
            sc = det.get("status_code") if isinstance(det, dict) else None
            if sc in {429, 503} and attempt < attempts - 1:
                time.sleep(poll_interval_seconds)
                continue
            return last
        status = str(last.get("status") or "").lower()
        if status == "completed":
            url = last.get("video_url")
            local_path = None
            download_err = None
            if download and isinstance(url, str):
                ok, res = _download_video(url, filename)
                if ok:
                    local_path = res  # type: ignore[assignment]
                else:
                    download_err = res["error"]  # type: ignore[index]
            result = {k: v for k, v in last.items() if k != "raw"}
            result["local_path"] = local_path
            if download_err:
                result["download_error"] = download_err
            return result
        if status == "failed":
            return _error("task_failed", "Agnes task failed.",
                          video_id=video_id, last_response=last)
        if attempt < attempts - 1:
            time.sleep(poll_interval_seconds)
    return _error("timeout", "Timed out waiting for Agnes task.",
                  video_id=video_id, last_response=last)


def _generate_impl(
    prompt: str, *, model: str = DEFAULT_MODEL, mode: str = "text",
    seconds: str = DEFAULT_SECONDS, size: str = DEFAULT_SIZE,
    aspect_ratio: str = DEFAULT_ASPECT, seed: int | None = None,
    first_frame: str | None = None, last_frame: str | None = None,
    images: list[str] | None = None, audios: list[str] | None = None,
    videos: list[dict[str, Any]] | None = None,
    timeout_seconds: float = 600.0, poll_interval_seconds: float = 5.0,
    download: bool = True, output_filename: str | None = None,
) -> dict[str, Any]:
    submit = _submit_impl(
        prompt, model=model, mode=mode, seconds=seconds, size=size,
        aspect_ratio=aspect_ratio, seed=seed, first_frame=first_frame,
        last_frame=last_frame, images=images, audios=audios, videos=videos,
        include_raw=True,
    )
    if not submit.get("ok"):
        return submit
    vid = submit.get("video_id")
    if not isinstance(vid, str) or not vid:
        return _error("missing_video_id", "Submit succeeded but no video_id.",
                      details={"submit_result": submit})
    wait = _wait_impl(vid, model=model, timeout_seconds=timeout_seconds,
                      poll_interval_seconds=poll_interval_seconds,
                      download=download, output_filename=output_filename)
    if not wait.get("ok"):
        wait["submit_result"] = submit
    return wait


# ---------------------------------------------------------------------------
# Image helpers + impl (agnes-image-2.5-flash, /v1/images/generations)
# ---------------------------------------------------------------------------
# Public docs: https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash
# API matches agnes-image-2.1-flash (only quality differs):
#   POST /v1/images/generations  body = {model, prompt, size, ratio, n?, return_base64?}
#   extra_body.image             → img2img input (NOT top-level "image")
#   extra_body.response_format   → "url" | "b64_json"   (NOT top-level)
# Response: { created, data: [{ url?, b64_json?, revised_prompt }] }

def _img_output_dir() -> Path:
    root = Path(str(_env("AGNES_OUTPUT_DIR", "./outputs"))).expanduser()
    directory = root / "images"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _img_is_remote_or_data_url(value: str) -> bool:
    return value.startswith(("http://", "https://", "data:"))


def _img_path_to_data_url(path_str: str) -> str:
    p = Path(path_str)
    if not p.is_file():
        raise ValueError(f"image path not found: {path_str}")
    mime, _ = mimetypes.guess_type(str(p))
    if not mime:
        mime = "image/png"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _img_save_data_url(data_url: str, filename: str | None) -> tuple[bool, str | dict[str, Any]]:
    if not data_url.startswith("data:"):
        return False, _error("invalid_data_url", "expected data: URL.")
    try:
        header, payload = data_url.split(",", 1)
        mime = header[len("data:"):].split(";", 1)[0]
        ext = mimetypes.guess_extension(mime) or ".png"
        directory = _img_output_dir()
        path = directory / (filename or _safe_name("agnes25-image", ext))
        path.write_bytes(base64.b64decode(payload))
        return True, str(path)
    except (ValueError, OSError) as exc:
        return False, _error("file_write_error", "Could not save image.",
                             details={"exception": str(exc)})


def _img_download_url(url: str, filename: str | None) -> tuple[bool, str | dict[str, Any]]:
    try:
        with httpx.Client(timeout=300.0, follow_redirects=True) as client:
            r = client.get(url)
            r.raise_for_status()
            suffix = _suffix_from_url(url, r.headers.get("content-type"))
            if suffix in {"", ".bin"}:
                suffix = ".png"
            directory = _img_output_dir()
            path = directory / (filename or _safe_name("agnes25-image", suffix))
            path.write_bytes(r.content)
            return True, str(path)
    except httpx.HTTPError as exc:
        return False, _error("download_error", "Could not download image.",
                             details={"url": url, "exception": str(exc)})
    except OSError as exc:
        return False, _error("file_write_error", "Could not write image to disk.",
                             details={"exception": str(exc)})


def _img_normalize_inputs(
    image_paths: list[str] | None, mask_path: str | None,
) -> tuple[list[str] | None, str | None]:
    """Convert local file paths to data URLs so they can be sent over the wire."""
    if not image_paths and not mask_path:
        return None, None
    out_images: list[str] | None = None
    if image_paths:
        out_images = []
        for p in image_paths:
            out_images.append(p if _img_is_remote_or_data_url(p) else _img_path_to_data_url(p))
    out_mask: str | None = None
    if mask_path:
        out_mask = mask_path if _img_is_remote_or_data_url(mask_path) else _img_path_to_data_url(mask_path)
    return out_images, out_mask


def _img_validate_size_ratio(size: str, ratio: str) -> dict[str, Any] | None:
    if size not in IMAGE_SIZES:
        return _error("invalid_size", f"size must be one of {sorted(IMAGE_SIZES)}.",
                      details={"got": size, "allowed": sorted(IMAGE_SIZES)})
    if ratio not in IMAGE_RATIOS:
        return _error("invalid_ratio", f"ratio must be one of {sorted(IMAGE_RATIOS)}.",
                      details={"got": ratio, "allowed": sorted(IMAGE_RATIOS)})
    return None


def _img_persist_entry(entry: dict[str, Any], filename_base: str | None, idx: int) -> dict[str, Any]:
    """Persist one data[] entry; add local_path / save_error on the dict."""
    item = dict(entry)
    stem = (filename_base or _safe_name("agnes25-image", ".png"))
    stem = stem.rsplit(".", 1)[0] if "." in stem else stem
    target = f"{stem}-{idx + 1}.png"
    url = item.get("url")
    b64 = item.get("b64_json")
    if isinstance(url, str) and url:
        ok, res = _img_download_url(url, target)
        if ok:
            item["local_path"] = res  # type: ignore[assignment]
        else:
            item["save_error"] = res["error"]  # type: ignore[index]
    elif isinstance(b64, str) and b64:
        ok, res = _img_save_data_url(f"data:image/png;base64,{b64}", target)
        if ok:
            item["local_path"] = res  # type: ignore[assignment]
        else:
            item["save_error"] = res["error"]  # type: ignore[index]
    return item


def _img_parse_response(payload: dict[str, Any], filename_base: str | None) -> dict[str, Any]:
    data = payload.get("data")
    if not isinstance(data, list):
        return _error("invalid_response", "Expected data array in image response.",
                      details={"payload": payload})
    persisted = [
        _img_persist_entry(d, filename_base, i) for i, d in enumerate(data) if isinstance(d, dict)
    ]
    return {
        "ok": True,
        "created": payload.get("created"),
        "model": payload.get("model"),
        "data": persisted,
    }


def _img_sanitize_filename(filename: str | None) -> str | None:
    name = _sanitize_filename(filename)
    if not name:
        return name
    stem = Path(name).stem
    return f"{stem}.png"


def _image_generate_impl(
    prompt: str, *,
    model: str = DEFAULT_IMAGE_MODEL,
    size: str = DEFAULT_IMAGE_SIZE, ratio: str = DEFAULT_IMAGE_RATIO,
    image_paths: list[str] | None = None,
    mask_path: str | None = None,
    n: int | None = None,
    return_base64: bool = False,
    response_format: str | None = None,
    output_filename: str | None = None,
    extra_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Core image-generation request to /v1/images/generations."""
    if not prompt.strip():
        return _error("invalid_prompt", "prompt must not be empty.")
    if model not in {DEFAULT_IMAGE_MODEL}:
        return _error("invalid_model", f"model must be {DEFAULT_IMAGE_MODEL}.",
                      details={"got": model, "allowed": [DEFAULT_IMAGE_MODEL]})
    err = _img_validate_size_ratio(size, ratio)
    if err:
        return err

    images, mask = _img_normalize_inputs(image_paths, mask_path)
    extra: dict[str, Any] = {}
    if images:
        extra["image"] = images  # docs: extra_body.image (not top-level)
    if mask:
        extra["mask"] = mask
    if response_format:
        extra["response_format"] = response_format  # docs: extra_body.response_format
    if extra_body:
        for k, v in extra_body.items():
            if v is not None:
                extra[k] = v

    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "ratio": ratio,
    }
    if n is not None:
        payload["n"] = n
    if return_base64:
        payload["return_base64"] = True
    if extra:
        payload["extra_body"] = extra

    ok, response = _request_json("POST", "/images/generations", json_body=payload)
    if not ok:
        return response
    return _img_parse_response(response, _img_sanitize_filename(output_filename))


def _image_edit_impl(
    prompt: str, image_paths: list[str], *,
    model: str = DEFAULT_IMAGE_MODEL,
    size: str = DEFAULT_IMAGE_SIZE, ratio: str = DEFAULT_IMAGE_RATIO,
    mask_path: str | None = None,
    return_base64: bool = False,
    response_format: str | None = None,
    output_filename: str | None = None,
    extra_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not image_paths:
        return _error("missing_images", "image_edit requires at least one input image.")
    return _image_generate_impl(
        prompt, model=model, size=size, ratio=ratio,
        image_paths=image_paths, mask_path=mask_path,
        return_base64=return_base64, response_format=response_format,
        output_filename=output_filename, extra_body=extra_body,
    )


@mcp.tool()
async def agnes25_video_generate(
    prompt: str, *,
    model: str = DEFAULT_MODEL, mode: str = "text",
    seconds: str = DEFAULT_SECONDS, size: str = DEFAULT_SIZE,
    aspect_ratio: str = DEFAULT_ASPECT, seed: int | None = None,
    first_frame: str | None = None, last_frame: str | None = None,
    images: list[str] | None = None, audios: list[str] | None = None,
    videos: list[dict[str, Any]] | None = None,
    timeout_seconds: float = 600.0, poll_interval_seconds: float = 5.0,
    download: bool = True, output_filename: str | None = None,
) -> dict[str, Any]:
    """Submit + wait combined. `mode` ∈ {text, keyframe, reference}; reference mode uses images[]/audios[]/videos[] with <Picture N> / <Audio N> / <Video N> placeholders."""
    return await asyncio.to_thread(
        _generate_impl, prompt,
        model=model, mode=mode, seconds=seconds, size=size, aspect_ratio=aspect_ratio,
        seed=seed, first_frame=first_frame, last_frame=last_frame,
        images=images, audios=audios, videos=videos,
        timeout_seconds=timeout_seconds, poll_interval_seconds=poll_interval_seconds,
        download=download, output_filename=output_filename,
    )


@mcp.tool()
async def agnes25_image_generate(
    prompt: str, *,
    model: str = DEFAULT_IMAGE_MODEL,
    size: str = DEFAULT_IMAGE_SIZE, ratio: str = DEFAULT_IMAGE_RATIO,
    image_paths: list[str] | None = None,
    mask_path: str | None = None,
    n: int | None = None,
    return_base64: bool = False,
    response_format: str | None = None,
    output_filename: str | None = None,
    extra_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate images via /v1/images/generations (agnes-image-2.5-flash).

    Text-to-image by default. Pass ``image_paths`` (local paths or URLs) to do
    image-to-image; pass ``mask_path`` for inpainting. ``extra_body`` is merged
    into the request's ``extra_body`` envelope — use it for advanced flags.
    """
    return await asyncio.to_thread(
        _image_generate_impl, prompt,
        model=model, size=size, ratio=ratio,
        image_paths=image_paths, mask_path=mask_path,
        n=n, return_base64=return_base64, response_format=response_format,
        output_filename=output_filename, extra_body=extra_body,
    )


@mcp.tool()
async def agnes25_image_edit(
    prompt: str, image_paths: list[str], *,
    size: str = DEFAULT_IMAGE_SIZE, ratio: str = DEFAULT_IMAGE_RATIO,
    mask_path: str | None = None,
    return_base64: bool = False,
    response_format: str | None = None,
    output_filename: str | None = None,
) -> dict[str, Any]:
    """Edit images via /v1/images/generations with image_paths as references.

    ``image_paths`` accepts local paths (auto-encoded as data URLs) or
    pre-existing HTTPS / data URLs. ``mask_path`` enables selective edits.
    """
    return await asyncio.to_thread(
        _image_edit_impl, prompt, image_paths,
        size=size, ratio=ratio, mask_path=mask_path,
        return_base64=return_base64, response_format=response_format,
        output_filename=output_filename,
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
