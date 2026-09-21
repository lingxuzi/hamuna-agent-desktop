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
import json
import math
import mimetypes
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP


load_dotenv()

mcp = FastMCP("Agnes Video 2.5 MCP")

DEFAULT_BASE_URL = "https://api.agnes-ai.cn/v1"
DEFAULT_MODEL = "agnes-video-2.5-flash"
DEFAULT_FLASH_MODEL = "agnes-video-2.5-flash"
# 2026-09-11: v0.2.0 adds agnes-video-v2.0 whitelist. v2.0 has a different
# protocol (ti2vid/keyframes + extra_body.image + height/width + num_frames +
# frame_rate) — we translate the unified `mode/seconds/size/first_frame/...`
# inputs into v2.0's field set in _build_payload. See CHANGELOG 0.2.0 + TODO #134.
MODEL_V2_NAME = "agnes-video-v2.0"
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

MODELS = {DEFAULT_MODEL, DEFAULT_FLASH_MODEL, MODEL_V2_NAME}
MODES = {"text", "keyframe", "reference"}
ASPECT_RATIOS = {"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
# v2.0 docs (wiki.agnes-ai.com/.../agnes-video-v20) list only 5 ratios (no 21:9).
ASPECT_RATIOS_V2 = {"16:9", "9:16", "1:1", "4:3", "3:4"}
SIZES_2_5 = {"720P", "1080P", "1K", "2K"}
SIZES_FLASH = {"720P"}
# v2.0 docs use lowercase 'p' and three presets (480p/720p/1080p).
SIZES_V2 = {"480p", "720p", "1080p"}
IMAGE_LIMITS = {DEFAULT_MODEL: 8, DEFAULT_FLASH_MODEL: 5, MODEL_V2_NAME: 0}
AUDIO_LIMITS = {DEFAULT_MODEL: 8, DEFAULT_FLASH_MODEL: 3, MODEL_V2_NAME: 0}
# v2.0 docs: num_frames <= 441, must follow 8x rule. Legal examples: 81/121/241/441.
# frame_rate is fixed at 24 (v2.0 docs default; we don't expose it).
_V2_LEGAL_NUM_FRAMES = (81, 121, 241, 441)
_V2_FRAME_RATE = 24
# Map size preset → height in pixels (v2.0 takes height/width ints, not size str).
_V2_SIZE_TO_HEIGHT = {"480p": 480, "720p": 720, "1080p": 1080}
# v2.0 docs list 5 aspect ratios (no 21:9).
_V2_ASPECT_RATIO_PARTS = {
    "16:9": (16, 9),
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:3": (4, 3),
    "3:4": (3, 4),
}

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


# ----- Multi-API-key fallback pool (0.1.4+) -----
# Single key (AGNES_API_KEY) is backward-compatible; multi-key (AGNES_API_KEYS,
# comma-separated) tries the next key on 429/503/401. State is in-memory + a
# module-level lock; MCP server is stdio + single-process, so concurrent writes
# are not a concern in practice. State resets on process restart.
@dataclass
class _KeyState:
    raw: str
    masked: str
    disabled_until: float = 0.0  # epoch seconds; 0 = available
    disabled_reason: str | None = None
    consecutive_failures: int = 0
    last_429_at: float = 0.0  # epoch seconds; 0 = no prior 429 in this process


_KEY_POOL: list[_KeyState] = []
_KEY_POOL_LOCK = threading.Lock()
_KEY_POOL_LOADED = False


def _mask_key(raw: str) -> str:
    if len(raw) <= 8:
        return "***"
    return raw[:4] + "***" + raw[-4:]


# ----- Persisted key pool state (2026-09-10+) -----
# State survives process restart so 401-permanent keys aren't reused and the
# 30s-window 429 cooldown counter (last_429_at) doesn't get reset mid-window.
# Single-writer (stdio MCP, single process); atomic write via tmp + replace;
# no flock required. AGNES_KEY_POOL_STATE_DIR overrides the path for tests.
_STATE_DIR = Path.home() / ".hamuna" / "state"
_STATE_FILE_NAME = "agnes-key-pool.json"


def _state_file() -> Path:
    override = os.environ.get("AGNES_KEY_POOL_STATE_DIR")
    base = Path(override) if override else _STATE_DIR
    return base / _STATE_FILE_NAME


def _load_persisted_state() -> dict[str, Any]:
    """Read persisted state. Returns {} on missing/corrupt/unreadable file."""
    path = _state_file()
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _persist_state() -> None:
    """Atomically write key pool state. Acquires _KEY_POOL_LOCK internally."""
    with _KEY_POOL_LOCK:
        path = _state_file()
        payload: dict[str, dict[str, Any]] = {}
        for k in _KEY_POOL:
            payload[k.raw] = {
                "disabled_until": k.disabled_until,
                "disabled_reason": k.disabled_reason,
                "last_429_at": k.last_429_at,
                "consecutive_failures": k.consecutive_failures,
            }
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            tmp.replace(path)
        except OSError as exc:
            print(f"[agnes-video-25-mcp] WARN: failed to persist key pool state to {path}: {exc}", flush=True)


def _load_key_pool() -> list[_KeyState]:
    """Read AGNES_API_KEYS (comma-separated, preferred) or AGNES_API_KEY (single).

    Merges persisted cooldown state from disk: keys with future ``disabled_until``
    keep their disable + reason + last_429_at; expired disables are dropped so
    the key starts healthy.
    """
    multi = _env("AGNES_API_KEYS")
    single = _env("AGNES_API_KEY")
    raw_list: list[str] = []
    if multi:
        raw_list = [s.strip() for s in multi.split(",") if s.strip()]
    elif single:
        raw_list = [single.strip()]
    keys = [_KeyState(raw=k, masked=_mask_key(k)) for k in raw_list]
    if not keys:
        return keys
    persisted = _load_persisted_state()
    now = time.time()
    for k in keys:
        ps = persisted.get(k.raw)
        if not isinstance(ps, dict):
            continue
        try:
            disabled_until = float(ps.get("disabled_until", 0.0))
        except (TypeError, ValueError):
            continue
        if disabled_until <= now:
            continue  # expired → drop; key is healthy again
        k.disabled_until = disabled_until
        k.disabled_reason = ps.get("disabled_reason")
        try:
            k.last_429_at = float(ps.get("last_429_at", 0.0))
        except (TypeError, ValueError):
            pass
        try:
            k.consecutive_failures = int(ps.get("consecutive_failures", 0))
        except (TypeError, ValueError):
            pass
    return keys


def _pick_key() -> _KeyState | None:
    global _KEY_POOL_LOADED
    picked: _KeyState | None = None
    needs_persist = False
    with _KEY_POOL_LOCK:
        if not _KEY_POOL_LOADED:
            _KEY_POOL[:] = _load_key_pool()
            _KEY_POOL_LOADED = True
        now = time.time()
        for k in _KEY_POOL:
            if k.disabled_until <= now:
                # Cooldown complete → refresh 429 allowance (key gets 2 fresh 429 chances).
                if k.last_429_at > 0.0:
                    k.last_429_at = 0.0
                    needs_persist = True
                picked = k
                break
    if needs_persist:
        _persist_state()
    return picked


def _mark_disabled(key: _KeyState, reason: str, until: float) -> None:
    key.disabled_until = until
    key.disabled_reason = reason
    key.consecutive_failures += 1
    if reason == "auth_401":
        # Permanent until process restart; user must rotate key.
        print(f"[agnes-video-25-mcp] KEY DISABLED (auth_401, permanent): {key.masked}. Rotate key in AGNES_API_KEYS.", flush=True)
    elif reason == "quota_429":
        # 2026-09-10: fixed 60s cooldown (was quota-reset parse). See call_with_fallback.
        from datetime import datetime, timezone
        when = datetime.fromtimestamp(until, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"[agnes-video-25-mcp] KEY COOLDOWN (quota_429, 60s): {key.masked}, retry after {when}.", flush=True)
    elif reason == "consecutive_429_30s":
        # 2 consecutive 429 within 30s window on the same key → enter cooldown state.
        # Cooldown still 60s; reason is preserved for downstream visibility.
        from datetime import datetime, timezone
        when = datetime.fromtimestamp(until, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"[agnes-video-25-mcp] KEY COOLDOWN (consecutive_429_30s, 60s): {key.masked}, 2 consecutive 429 within 30s window, retry after {when}. Consider rotating key or checking upstream quota.", flush=True)
    elif reason == "service_503":
        print(f"[agnes-video-25-mcp] KEY COOLDOWN (service_503, 60s): {key.masked}.", flush=True)
    _persist_state()


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
    """Call Agnes API with multi-key fallback on 401/429/503.

    Iterates the key pool: 2xx → success; 401 → mark permanent + switch; 429 →
    parse reset time + mark temp + switch; 503 → 60s cooldown + switch; other
    status / network errors → return immediately (not key-related). All keys
    exhausted → return last error with all_keys_exhausted context.
    """
    url = f"{base_url or _base_url()}{path}"
    tried: list[tuple[str, int, str]] = []  # (masked_key, status_code, reason)
    last_error: dict[str, Any] | None = None
    pool_size = 0
    global _KEY_POOL_LOADED  # noqa: PLW0603 — assigning to module-level flag.
    with _KEY_POOL_LOCK:
        if not _KEY_POOL_LOADED:
            _KEY_POOL[:] = _load_key_pool()
            _KEY_POOL_LOADED = True
        pool_size = len(_KEY_POOL)
    if pool_size == 0:
        return False, _error("missing_api_key", "Set AGNES_API_KEY (or AGNES_API_KEYS) before calling Agnes.")
    for _ in range(pool_size):
        key = _pick_key()
        if key is None:
            break  # all disabled
        headers = {"Authorization": f"Bearer {key.raw}", "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=timeout) as client:
                r = client.request(method, url, headers=headers, json=json_body)
                r.raise_for_status()
                return True, r.json() if r.content else {}
        except httpx.HTTPStatusError as exc:
            sc = exc.response.status_code
            body = exc.response.text
            err = _error("http_error", "Agnes returned non-success.",
                         details={"status_code": sc, "body": body})
            if sc == 401:
                _mark_disabled(key, "auth_401", float("inf"))
                tried.append((key.masked, sc, "auth_401"))
                last_error = err
                continue
            if sc == 429:
                # 2026-09-10: fixed 60s cooldown, drop _parse_quota_reset.
                # 30s window: 1st 429 → "quota_429"; 2nd 429 within 30s →
                # "consecutive_429_30s" (enters cooldown state). _pick_key
                # resets last_429_at on cooldown completion to refresh the
                # 2-429 allowance.
                now = time.time()
                in_window = key.last_429_at > 0.0 and (now - key.last_429_at) <= 30.0
                key.last_429_at = now
                reason = "consecutive_429_30s" if in_window else "quota_429"
                _mark_disabled(key, reason, now + 60.0)
                tried.append((key.masked, sc, reason))
                last_error = err
                continue
            if sc == 503:
                _mark_disabled(key, "service_503", time.time() + 60.0)
                tried.append((key.masked, sc, "service_503"))
                last_error = err
                continue
            return False, err  # 4xx/5xx other → not key-related, surface immediately
        except httpx.TimeoutException as exc:
            return _error("timeout", "Agnes request timed out.", details=str(exc))
        except httpx.RequestError as exc:
            return _error("request_error", "Agnes request failed.", details=str(exc))
        except ValueError as exc:
            return _error("invalid_response", "Non-JSON response from Agnes.", details=str(exc))
    # All keys exhausted
    if last_error is not None:
        last_error.setdefault("error", {}).setdefault("code", "http_error")
        last_error["error"]["message"] = f"All {pool_size} key(s) exhausted (tried: {tried})."
        last_error["error"]["details"] = {**last_error["error"].get("details", {}), "tried": tried, "pool_size": pool_size}
        return False, last_error
    return False, _error("all_keys_exhausted", f"All {pool_size} key(s) disabled.",
                         details={"tried": tried, "pool_size": pool_size})


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
    # Per-model allowed sets (size + aspect_ratio) — v2.0 has its own presets.
    if model == MODEL_V2_NAME:
        valid_sizes = SIZES_V2
        valid_aspects = ASPECT_RATIOS_V2
    elif model == DEFAULT_FLASH_MODEL:
        valid_sizes = SIZES_FLASH
        valid_aspects = ASPECT_RATIOS
    else:
        valid_sizes = SIZES_2_5
        valid_aspects = ASPECT_RATIOS
    if size not in valid_sizes:
        return _error("invalid_size", f"size must be one of {sorted(valid_sizes)} for {model}.",
                      details={"got": size, "allowed": sorted(valid_sizes)})
    if aspect_ratio not in valid_aspects:
        return _error("invalid_aspect_ratio",
                      f"aspect_ratio must be one of {sorted(valid_aspects)} for {model}.",
                      details={"got": aspect_ratio, "allowed": sorted(valid_aspects)})

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
        # v2.0 docs only support mode="ti2vid" / "keyframes"; the unified
        # `reference` mode (images[]/audios[]/videos[]) has no v2.0 mapping.
        if model == MODEL_V2_NAME:
            return _error("reference_mode_unsupported",
                          "agnes-video-v2.0 uses mode='ti2vid' / 'keyframes' with "
                          "extra_body.image[]. Use mode='text' or mode='keyframe' "
                          "with first_frame/last_frame instead.")
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


def _v2_seconds_to_num_frames(seconds: str) -> int:
    """Snap seconds string → nearest v2.0-legal num_frames (8x rule, ≤441)."""
    try:
        s = float(seconds)
    except (TypeError, ValueError):
        s = 5.0
    target = s * _V2_FRAME_RATE
    return min(_V2_LEGAL_NUM_FRAMES, key=lambda n: abs(n - target))


def _v2_aspect_to_width_height(size: str, aspect_ratio: str) -> tuple[int, int]:
    """Compute v2.0 (width, height) ints from size preset + aspect_ratio.

    Width is computed from height (480/720/1080) and the ratio parts, then
    rounded down to the nearest multiple of 16 for codec alignment. Height is
    already a multiple of 16 from the presets.
    """
    height = _V2_SIZE_TO_HEIGHT[size]
    w_part, h_part = _V2_ASPECT_RATIO_PARTS[aspect_ratio]
    width = round(height * w_part / h_part)
    width = max(16, (width // 16) * 16)
    height = (height // 16) * 16
    return width, height


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
    if model == MODEL_V2_NAME:
        # v2.0 protocol: ti2vid/keyframes + extra_body.image + height/width +
        # num_frames + frame_rate. Caller's unified inputs are translated here.
        width, height = _v2_aspect_to_width_height(size, aspect_ratio)
        payload: dict[str, Any] = {
            "model": MODEL_V2_NAME,
            "prompt": prompt,
            "height": height,
            "width": width,
            "num_frames": _v2_seconds_to_num_frames(seconds),
            "frame_rate": _V2_FRAME_RATE,
        }
        if seed is not None:
            payload["seed"] = seed
        if mode == "keyframe":
            keyframes = [u for u in (first_frame, last_frame) if u]
            if keyframes:
                payload["extra_body"] = {
                    "image": keyframes,
                    "mode": "keyframes",
                }
        # mode="text" → no extra_body; v2.0 defaults to text-to-video.
        # mode="reference" → rejected by _validate_request (defensive no-op).
        return payload

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
    # 0.2.1: harness (Claude Code MCP client) sometimes serializes single-element
    # array args as {"item": "<value>"} dicts. Schema already accepts dict, here
    # we unwrap so the inner payload is the canonical list shape. CHANGELOG
    # 0.2.1 documents the trade-off; long-term fix is caller-side discipline.
    images = _coerce_str_list_input(images) if images is not None else None
    audios = _coerce_str_list_input(audios) if audios is not None else None
    videos = _coerce_videos_input(videos) if videos is not None else None
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


def _coerce_image_paths_input(
    value: list[str] | dict[str, Any] | None,
) -> list[str] | None:
    """Tolerate dict-shaped ``image_paths`` emitted by some MCP clients.

    0.1.7 user-拍板 trade-off — see CHANGELOG for full context.

    Unwrap rules:
      - ``{"item": [list]}`` → return the inner list (the symptom in the bug report).
      - ``{"item": "<single string>"}`` → return ``["<single string>"]`` (new in 0.2.1:
        harness sometimes serializes a single-element ``["<url>"]`` as
        ``{"item": "<url>"}`` instead of ``{"item": ["<url>"]}``).
      - Single-key dict whose only value is a list → return that list.
      - Everything else (None, real list, dict that doesn't match) → return unchanged.

    Caveats:
      - FastMCP / Pydantic v2 may validate the function signature *before* this
        runs; under strict schema mode a dict input would be rejected upstream
        and this helper would never be reached. 0.1.7 accepts that risk.
      - The single-key unwrap is type-unsafe: a caller passing ``{"foo": ["bar"]}``
        will silently be "fixed" into ``["bar"]``. Caller-side discipline is the
        long-term fix; this is the cheapest server-side mitigation.
    """
    # 0.2.2: 递归 unwrap。harness / sub-agent 多次调用会逐层套 {"item": ...}，
    # 单次 unwrap 在嵌套深度 ≥2 时返回 dict，后续 for v in values 静默把 dict
    # keys 当 URL 喂下去，掩盖真实错误（"传入多于一个 url 愈发严重"的根因）。
    # 深度上限 8 足够挡实际 harness 链路的累计嵌套，同时防恶意/异常输入死循环。
    seen: set[int] = set()
    while isinstance(value, dict) and id(value) not in seen:
        seen.add(id(value))
        if len(seen) > 8:
            break
        if "item" in value:
            inner = value["item"]
            if isinstance(inner, list):
                value = inner
                continue
            if isinstance(inner, str):
                return [inner]
            if isinstance(inner, dict):
                value = inner
                continue
        if len(value) == 1:
            only = next(iter(value.values()))
            if isinstance(only, list):
                value = only
                continue
            if isinstance(only, dict):
                value = only
                continue
        break
    return value


def _coerce_str_list_input(
    value: list[str] | dict[str, Any] | None,
) -> list[str] | None:
    """Same as :func:`_coerce_image_paths_input` — kept as a separate name for
    video-tool call sites (``images`` / ``audios``) to make intent obvious at
    the read site and to let the two helpers diverge later without rippling
    type hints.

    0.2.1: added to fix harness single-element dict-of-string bug for video
    reference mode (images + audios fields), which image side already worked
    around via _coerce_image_paths_input but the video type hint was still
    ``list[str] | None`` so Pydantic rejected the dict upstream.
    """
    return _coerce_image_paths_input(value)


def _coerce_videos_input(
    value: list[dict[str, Any]] | dict[str, Any] | None,
) -> list[dict[str, Any]] | None:
    """Tolerate dict-shaped ``videos`` from MCP clients.

    0.2.1: mirror of _coerce_image_paths_input for the video-list payload.
    Videos have shape ``[{"url": "..."}]`` not ``[str]`` so the unwrap must
    preserve list-of-dict semantics.

    0.2.2: recursive unwrap — same rationale as _coerce_image_paths_input.
    """
    seen: set[int] = set()
    while isinstance(value, dict) and id(value) not in seen:
        seen.add(id(value))
        if len(seen) > 8:
            break
        if "item" in value:
            inner = value["item"]
            if isinstance(inner, list):
                value = inner
                continue
            if isinstance(inner, dict):
                value = inner
                continue
        if len(value) == 1:
            only = next(iter(value.values()))
            if isinstance(only, list):
                value = only
                continue
            if isinstance(only, dict):
                value = only
                continue
        break
    return value


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
    # 0.1.8: 同步 MCP 入口的 dict 兼容，让跨函数调用类型一致
    image_paths: list[str] | dict[str, Any] | None = None,
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

    # 2026-09-11: 兼容 Claude Code MCP 客户端把 image_paths 数组包装成
    # {"item": [...]} dict 的 bug。list 输入路径完全不受影响。
    # 详细 trade-off 见 CHANGELOG 0.1.7 + helper 注释。
    image_paths = _coerce_image_paths_input(image_paths)

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
    # 0.2.1: accept list | dict | None so Pydantic doesn't reject harness inputs
    # that wrap single-element arrays as {"item": "<url>"} dicts. Image side
    # already worked around this in 0.1.8 — apply the same trade-off here for
    # video reference mode (images / audios / videos). Runtime normalization
    # lives in _coerce_str_list_input / _coerce_videos_input.
    images: list[str] | dict[str, Any] | None = None,
    audios: list[str] | dict[str, Any] | None = None,
    videos: list[dict[str, Any]] | dict[str, Any] | None = None,
    timeout_seconds: float = 600.0, poll_interval_seconds: float = 5.0,
    download: bool = True, output_filename: str | None = None,
) -> dict[str, Any]:
    """Submit + wait combined. `mode` ∈ {text, keyframe, reference}; reference mode uses images[]/audios[]/videos[] with <Picture N> / <Audio N> / <Video N> placeholders. `images` / `audios` / `videos` accept list (preferred) or dict (fallback for harness clients that wrap arrays as ``{"item": [...]}``); see CHANGELOG 0.2.1."""
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
    # 0.1.8: 接受 list | dict | None，让 Pydantic 不在 schema 层拒绝 Claude Code MCP
    # 客户端把数组包装成 {"item": [...]} dict 的输入。运行时 _coerce_image_paths_input
    # 会把 dict 拆回 list。CHANGELOG 0.1.8 记录 trade-off。
    image_paths: list[str] | dict[str, Any] | None = None,
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

    Note: ``image_paths`` accepts ``list[str]`` (preferred) or ``dict`` (fallback
    for clients that wrap arrays as ``{"item": [...]}``). The dict form is
    normalized to a list before use. See CHANGELOG 0.1.8.
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


@mcp.tool()
async def agnes25_upload_image(path: str) -> dict[str, Any]:
    """Upload a local image file to img.remit.ee; return public HTTPS URL.

    Args:
        path: Absolute path to a local file readable by this server.

    Returns:
        ``{"ok": True, "url": "https://img.remit.ee/..."}`` on success,
        or ``{"ok": False, "error": {"code": ..., "message": ...}}`` on failure.

    Notes:
        img.remit.ee is a free image host with rate limits (~429, wait 15s)
        and a 20MB per-file cap. Prefer reusing the ``url`` returned by
        ``agnes25_image_generate`` over manually uploading assets; for
        batches, call serially with a small sleep between calls.
    """
    p = Path(path)
    if not p.is_file():
        return _error(
            "invalid_param",
            "path is not an existing local file.",
            details={"path": path},
        )
    try:
        url = await asyncio.to_thread(_upload_to_remit_ee, p)
    except Exception as exc:
        return _error(
            "remit_ee_upload_failed",
            f"img.remit.ee upload failed: {exc}",
            details={"path": path, "exception": str(exc)},
        )
    return {"ok": True, "url": url}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
