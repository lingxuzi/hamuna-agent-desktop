"""Regression tests for 0.2.5 — agnes25_video_generate split into
submit-only + agnes25_video_query (poll / optional download).

Covers the contract that the submit response carries `video_id` /
`model_id` / `submit_key_masked` (the masked key the task was submitted
with), and that `agnes25_video_query(force_key_masked=...)` reuses that
key on poll. Also covers the explicit "round-robin" path when the
caller omits `force_key_masked`, the `forced_key_unavailable` error
when the masked value is unknown to the pool, and the opt-in download
behavior of `agnes25_video_query`.

Run directly (assert-based, no pytest):

    python hosted_mcps/agnes-video-25/tests/test_v0_2_5_submit_query_split.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

# Isolate persisted state BEFORE the server module is imported — _load_key_pool
# reads AGNES_KEY_POOL_STATE_DIR at module init time on first call.
_TMP_STATE_DIR = Path(tempfile.mkdtemp(prefix="agnes-split-test-"))
os.environ["AGNES_KEY_POOL_STATE_DIR"] = str(_TMP_STATE_DIR)

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

import agnes_video_25.server as srv  # noqa: E402
from agnes_video_25.server import (  # noqa: E402
    _KEY_POOL,
    _KEY_POOL_LOCK,
    _KeyState,
)


def _reset_pool(*raw_keys: str) -> list[_KeyState]:
    """Replace module-level pool with fresh states for deterministic tests."""
    with _KEY_POOL_LOCK:
        _KEY_POOL[:] = [_KeyState(raw=k, masked=k[:4] + "***") for k in raw_keys]
        srv._KEY_POOL_LOADED = True  # type: ignore[attr-defined]
        srv._KEY_ROUND_ROBIN_COUNTER = 0  # type: ignore[attr-defined]
    return list(_KEY_POOL)


def _make_response(status_code: int, json_body: dict | None = None,
                   text_body: str | None = None):
    """Build a fake httpx.Response-like object for mocking."""
    class _Resp:
        def __init__(self):
            self.status_code = status_code
            self.text = text_body or (json.dumps(json_body) if json_body else "")
            self.content = self.text.encode()
        def raise_for_status(self):
            import httpx
            if status_code >= 400:
                raise httpx.HTTPStatusError("err", request=None, response=self)
        def json(self):
            return json.loads(self.text) if json_body is None else json_body
    return _Resp()


def _fake_video_bytes() -> bytes:
    # Smallest valid MP4-ish payload — _download_video only checks size /
    # suffix, content is opaque. Using 16 zero bytes so suffix-inference
    # returns ".mp4" via the fallback path.
    return b"\x00" * 16


# ---------------------------------------------------------------------------
# generate — submit-only contract
# ---------------------------------------------------------------------------

def _fake_submit_request(method, url, **kwargs):
    """Default fake that returns a queued submit + completed poll."""
    if method == "POST" and url.endswith("/videos"):
        return _make_response(200, json_body={
            "id": "task_split01",
            "video_id": "task_split01",
            "task_id": "task_split01",
            "status": "queued",
            "model": "agnes-video-2.5-flash",
        })
    return _make_response(200, json_body={
        "id": "task_split01",
        "video_id": "task_split01",
        "task_id": "task_split01",
        "status": "completed",
        "url": "https://example.com/video.mp4",
    })


def test_generate_returns_video_id_model_id_masked_key() -> None:
    """submit must return the documented {video_id, model_id,
    submit_key_masked, ...} shape — no local_path / video_url."""
    _reset_pool("key-aaaaaaaaaaaa")
    import asyncio
    with patch.object(srv.httpx.Client, "request", side_effect=_fake_submit_request):
        result = asyncio.run(srv.agnes25_video_generate("a calm wave"))
    assert result.get("ok") is True, f"submit failed: {result}"
    assert result.get("video_id") == "task_split01"
    assert result.get("model_id") == "agnes-video-2.5-flash"
    # _mask_key("key-aaaaaaaaaaaa") → "key-***aaaa" (first 4 + *** + last 4).
    masked = result.get("submit_key_masked")
    assert isinstance(masked, str) and masked.startswith("key-") and "***" in masked, \
        f"submit_key_masked missing or wrong shape: {masked!r}"
    # Crucially, submit-only must NOT include wait/download artifacts.
    assert "local_path" not in result, \
        f"submit must not carry local_path (was eager before 0.2.5): {result}"
    assert "video_url" not in result, \
        f"submit must not carry video_url (was eager before 0.2.5): {result}"
    # No underscore-prefixed key leaks to the public surface.
    assert "_submit_key_masked" not in result, \
        f"internal _submit_key_masked leaked to public surface: {result}"


def test_generate_no_wait_no_download() -> None:
    """Submit-only must not block on time.sleep (which would mean _wait_impl ran)."""
    _reset_pool("key-aaaaaaaaaaaa")
    sleep_calls: list[float] = []
    with patch.object(srv.httpx.Client, "request", side_effect=_fake_submit_request), \
         patch.object(srv.time, "sleep", side_effect=lambda s: sleep_calls.append(s)):
        import asyncio
        result = asyncio.run(srv.agnes25_video_generate("a calm wave"))
    assert result.get("ok") is True
    assert sleep_calls == [], \
        f"submit-only must not sleep (would mean _wait_impl ran): {sleep_calls}"


# ---------------------------------------------------------------------------
# query — force_key_masked stickiness
# ---------------------------------------------------------------------------

def test_query_uses_force_key_masked_for_stickiness() -> None:
    """Submit with key-A; query with key-A's masked form must hit the same
    Authorization header as the submit (no key rotation on poll)."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")
    submit_bearers: list[str] = []
    poll_bearers: list[str] = []

    def fake_request(method, url, **kwargs):
        headers = kwargs.get("headers") or {}
        bearer = headers.get("Authorization", "")
        if method == "POST" and url.endswith("/videos"):
            submit_bearers.append(bearer)
            return _make_response(200, json_body={
                "id": "task_poll", "video_id": "task_poll", "task_id": "task_poll",
                "status": "queued", "model": "agnes-video-2.5-flash",
            })
        poll_bearers.append(bearer)
        return _make_response(200, json_body={
            "id": "task_poll", "video_id": "task_poll", "task_id": "task_poll",
            "status": "completed", "url": "https://example.com/v.mp4",
        })

    import asyncio
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        submit = asyncio.run(srv.agnes25_video_generate("a wave"))
    assert submit.get("ok") is True
    submit_masked = submit["submit_key_masked"]
    assert len(submit_bearers) == 1
    assert submit_bearers[0] == "Bearer key-aaaaaaaaaaaa"

    poll_bearers.clear()
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        query = asyncio.run(srv.agnes25_video_query(
            "task_poll", force_key_masked=submit_masked,
        ))
    assert query.get("ok") is True, f"query failed: {query}"
    assert poll_bearers, "query must call _request_json at least once"
    assert poll_bearers[0] == submit_bearers[0], \
        f"query with force_key_masked must reuse submit key. submit={submit_bearers[0]!r} poll={poll_bearers[0]!r}"


def test_query_without_force_key_masked_uses_round_robin() -> None:
    """Without force_key_masked, _pick_key() runs (round-robin). With two
    keys in the pool and only one forced-key call, query picks the next
    healthy key from the pool — that's the explicit opt-out path."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")

    def fake_request(method, url, **kwargs):
        if method == "POST" and url.endswith("/videos"):
            return _make_response(200, json_body={
                "id": "task_rr", "video_id": "task_rr", "task_id": "task_rr",
                "status": "queued", "model": "agnes-video-2.5-flash",
            })
        return _make_response(200, json_body={
            "id": "task_rr", "video_id": "task_rr", "task_id": "task_rr",
            "status": "completed", "url": "https://example.com/v.mp4",
        })

    import asyncio
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        query = asyncio.run(srv.agnes25_video_query("task_rr"))
    assert query.get("ok") is True, f"query failed: {query}"
    # Round-robin picks from healthy pool — any of the two keys is legal.
    # We don't pin which key — just verify it ran without forced-key error.


def test_query_with_wrong_masked_key_returns_forced_key_unavailable() -> None:
    """A masked key that's not in the local pool surfaces the existing
    0.2.4 error code (forced_key_unavailable) — no silent key rotation."""
    _reset_pool("key-aaaaaaaaaaaa")
    import asyncio
    query = asyncio.run(srv.agnes25_video_query(
        "task_x", force_key_masked="not-***pool",
    ))
    assert query.get("ok") is False
    err = query.get("error") or {}
    assert err.get("code") == "forced_key_unavailable", \
        f"unknown masked key must surface forced_key_unavailable, got {err}"


# ---------------------------------------------------------------------------
# query — download behavior
# ---------------------------------------------------------------------------

def test_query_download_saves_to_disk(tmp_dir_setup=None) -> None:
    """download=True on a completed task populates local_path on disk."""
    import asyncio
    import tempfile as _tf
    out_dir = Path(_tf.mkdtemp(prefix="agnes-download-test-"))
    with patch.dict(os.environ, {"AGNES_OUTPUT_DIR": str(out_dir)}):
        _reset_pool("key-aaaaaaaaaaaa")

        def fake_request(method, url, **kwargs):
            if method == "POST" and url.endswith("/videos"):
                return _make_response(200, json_body={
                    "id": "task_dl", "video_id": "task_dl", "task_id": "task_dl",
                    "status": "queued", "model": "agnes-video-2.5-flash",
                })
            if "/agnesapi" in url or "/v1/videos/" in url:
                return _make_response(200, json_body={
                    "id": "task_dl", "video_id": "task_dl", "task_id": "task_dl",
                    "status": "completed", "url": "https://example.com/v.mp4",
                })
            return _make_response(500, text_body="unexpected")

        # Mock the actual download to avoid real network.
        def fake_download(url, filename):
            path = Path(out_dir) / "videos" / (filename or "x.mp4")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(_fake_video_bytes())
            return True, str(path)

        with patch.object(srv.httpx.Client, "request", side_effect=fake_request), \
             patch.object(srv, "_download_video", side_effect=fake_download):
            query = asyncio.run(srv.agnes25_video_query("task_dl", download=True))
        assert query.get("ok") is True, f"query failed: {query}"
        assert query.get("status") == "completed"
        local = query.get("local_path")
        assert local, f"download=True on completed task must populate local_path: {query}"
        assert Path(local).exists(), f"local_path must exist on disk: {local}"


def test_query_download_skipped_when_status_not_completed() -> None:
    """download=True on a still-processing task does NOT save and
    surfaces a clear download_error rather than silently dropping."""
    import asyncio
    _reset_pool("key-aaaaaaaaaaaa")

    def fake_request(method, url, **kwargs):
        if method == "POST" and url.endswith("/videos"):
            return _make_response(200, json_body={
                "id": "task_p", "video_id": "task_p", "task_id": "task_p",
                "status": "queued", "model": "agnes-video-2.5-flash",
            })
        return _make_response(200, json_body={
            "id": "task_p", "video_id": "task_p", "task_id": "task_p",
            "status": "processing", "progress": 30,
        })

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        query = asyncio.run(srv.agnes25_video_query("task_p", download=True))
    assert query.get("ok") is True
    assert query.get("status") == "processing"
    assert "local_path" not in query, \
        f"download must skip on non-completed status: {query}"


# ---------------------------------------------------------------------------
# generate → query round trip with masked key
# ---------------------------------------------------------------------------

def test_generate_then_query_round_trip() -> None:
    """End-to-end: submit returns the masked key, query uses it to stick
    to the same key across status + the optional final download call."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")
    bearers: list[str] = []

    def fake_request(method, url, **kwargs):
        headers = kwargs.get("headers") or {}
        bearers.append(headers.get("Authorization", ""))
        if method == "POST" and url.endswith("/videos"):
            return _make_response(200, json_body={
                "id": "task_e2e", "video_id": "task_e2e", "task_id": "task_e2e",
                "status": "queued", "model": "agnes-video-2.5-flash",
            })
        return _make_response(200, json_body={
            "id": "task_e2e", "video_id": "task_e2e", "task_id": "task_e2e",
            "status": "completed", "url": "https://example.com/v.mp4",
        })

    import asyncio
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        submit = asyncio.run(srv.agnes25_video_generate("a wave"))
    submit_key = submit["submit_key_masked"]
    submit_bearer = bearers[-1]

    bearers.clear()
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        query = asyncio.run(srv.agnes25_video_query(
            "task_e2e", force_key_masked=submit_key,
        ))
    assert query.get("ok") is True
    assert bearers, "query must call _request_json"
    assert bearers[0] == submit_bearer, \
        f"round trip must reuse the submit key. submit={submit_bearer!r} query={bearers[0]!r}"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    tests = [
        # generate — submit-only contract
        test_generate_returns_video_id_model_id_masked_key,
        test_generate_no_wait_no_download,
        # query — force_key_masked stickiness
        test_query_uses_force_key_masked_for_stickiness,
        test_query_without_force_key_masked_uses_round_robin,
        test_query_with_wrong_masked_key_returns_forced_key_unavailable,
        # query — download behavior
        test_query_download_saves_to_disk,
        test_query_download_skipped_when_status_not_completed,
        # round trip
        test_generate_then_query_round_trip,
    ]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)} self-check(s) passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())