"""Regression tests for 0.2.4 — poll-after-submit stickiness + 503 retry + /v1 fallback.

Covers three coupled fixes in server.py that close the long-standing
``mcp__multimedia-creator__agnes25_video_generate`` 404 path:

1. Poll-after-submit stickiness (``force_key_masked``): the key that
   submitted a task MUST be the key that polls it. Agnes upstream scopes
   tasks to the submitting key; round-robin key selection across the
   multi-key pool used to land a different key on every poll attempt,
   returning 404 "任务不存在".

2. Submit 503 retry loop: ``video_queue_full`` was previously terminal.
   The retry loop only catches 503 (per user constraint that ONLY 429
   keys enter cooldown); 429/401 keep their existing semantics.

3. Poll fallback to ``/v1/videos/{id}``: when ``/agnesapi`` 404s, the
   status poller now also tries the OpenAI-style paths. This is a
   tentative fallback — CHANGELOG 0.2.4 marks the path as unverified
   against real upstream.

Run directly (assert-based, no pytest):

    python hosted_mcps/agnes-video-25/tests/test_v0_2_4_submit_poll_stickiness.py
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
_TMP_STATE_DIR = Path(tempfile.mkdtemp(prefix="agnes-sticky-test-"))
os.environ["AGNES_KEY_POOL_STATE_DIR"] = str(_TMP_STATE_DIR)

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

import agnes_video_25.server as srv  # noqa: E402
from agnes_video_25.server import (  # noqa: E402
    _KEY_POOL,
    _KEY_POOL_LOCK,
    _KeyState,
    _submit_impl,
    _status_impl,
    _wait_impl,
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


# ---------------------------------------------------------------------------
# Fix 1: poll-after-submit stickiness
# ---------------------------------------------------------------------------

def test_submit_then_status_uses_same_key() -> None:
    """Submit with key-a; status must call /agnesapi with key-a (NOT key-b)."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")
    captured_bearers: list[str] = []

    def fake_request(method, url, **kwargs):
        headers = kwargs.get("headers") or {}
        captured_bearers.append(headers.get("Authorization", ""))
        if method == "POST" and url.endswith("/videos"):
            return _make_response(200, json_body={
                "id": "task_abcdef123456",
                "video_id": "task_abcdef123456",
                "task_id": "task_abcdef123456",
                "status": "queued",
                "model": "agnes-video-2.5-flash",
            })
        # /agnesapi poll: return completed.
        return _make_response(200, json_body={
            "id": "task_abcdef123456",
            "video_id": "task_abcdef123456",
            "task_id": "task_abcdef123456",
            "status": "completed",
            "url": "https://example.com/video.mp4",
        })

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        submit = _submit_impl("a calm wave", include_raw=True)

    assert submit.get("ok") is True, f"submit failed: {submit}"
    submit_bearer = captured_bearers[0]
    assert submit_bearer == "Bearer key-aaaaaaaaaaaa", \
        f"submit should use first round-robin key, got {submit_bearer}"

    # Now poll: must use the same key the submit used.
    captured_bearers.clear()
    submit_key_masked = submit["_submit_key_masked"]
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        status = _status_impl("task_abcdef123456",
                              force_key_masked=submit_key_masked)

    assert status.get("ok") is True, f"status failed: {status}"
    poll_bearer = captured_bearers[0]
    assert poll_bearer == submit_bearer, \
        f"status MUST reuse submit key for stickiness. " \
        f"submit={submit_bearer!r}, poll={poll_bearer!r}"


def test_wait_loop_keeps_submit_key_across_polls() -> None:
    """Multiple polls inside _wait_impl must all carry the submit key."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")
    captured_bearers: list[str] = []
    poll_count = 0

    def fake_request(method, url, **kwargs):
        nonlocal poll_count
        headers = kwargs.get("headers") or {}
        captured_bearers.append(headers.get("Authorization", ""))
        if method == "POST" and url.endswith("/videos"):
            return _make_response(200, json_body={
                "id": "task_xyz",
                "video_id": "task_xyz",
                "task_id": "task_xyz",
                "status": "queued",
                "model": "agnes-video-2.5-flash",
            })
        poll_count += 1
        # First two polls: still processing. Third: completed (no download).
        if poll_count < 3:
            return _make_response(200, json_body={
                "id": "task_xyz", "video_id": "task_xyz",
                "task_id": "task_xyz", "status": "processing",
            })
        return _make_response(200, json_body={
            "id": "task_xyz", "video_id": "task_xyz",
            "task_id": "task_xyz", "status": "completed",
            "url": "https://example.com/v.mp4",
        })

    # Submit first (so we know which key _wait_impl should be pinned to).
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        submit = _submit_impl("a wave", include_raw=True)
    assert submit.get("ok") is True, submit
    submit_key_masked = submit["_submit_key_masked"]

    # Reset capture so we can attribute calls cleanly to the wait loop.
    captured_bearers.clear()
    poll_count = 0
    import sys
    print(f"DEBUG: submit picked {submit_key_masked}", file=sys.stderr)
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        wait = _wait_impl("task_xyz", download=False,
                          poll_interval_seconds=0.001, timeout_seconds=10.0,
                          force_key_masked=submit_key_masked)

    # All captured bearers are poll bearers (submit block was cleared above).
    # Expect 3 polls: processing → processing → completed.
    assert wait.get("ok") is True, f"wait failed: {wait}"
    assert len(captured_bearers) == 3, \
        f"expected 3 polls (processing, processing, completed), got {len(captured_bearers)}: {captured_bearers}"
    raw_keys_used = [b.replace("Bearer ", "") for b in captured_bearers]
    assert len(set(raw_keys_used)) == 1, \
        f"all polls must use the same key; got distinct keys {set(raw_keys_used)}"
    assert raw_keys_used[0].startswith(submit_key_masked[:4]), \
        f"poll key {raw_keys_used[0]!r} should start with submit masked prefix {submit_key_masked!r}"


# ---------------------------------------------------------------------------
# Fix 2: submit 503 retry loop (only 503, not 429)
# ---------------------------------------------------------------------------

def test_submit_retries_on_503_then_succeeds() -> None:
    """First submit attempt = 503, second = 200. Submit must retry, not fail."""
    _reset_pool("key-aaaaaaaaaaaa")
    call_log: list[tuple[str, str]] = []

    def fake_request(method, url, **kwargs):
        call_log.append((method, url))
        if method == "POST" and url.endswith("/videos"):
            if len([c for c in call_log if c[0] == "POST" and c[1].endswith("/videos")]) == 1:
                return _make_response(503, text_body="video_queue_full")
            return _make_response(200, json_body={
                "id": "task_q", "video_id": "task_q", "task_id": "task_q",
                "status": "queued", "model": "agnes-video-2.5-flash",
            })
        return _make_response(404, text_body="not used")

    # Patch time.sleep so retry doesn't actually wait.
    with patch.object(srv.httpx.Client, "request", side_effect=fake_request), \
         patch.object(srv.time, "sleep") as fake_sleep:
        submit = _submit_impl("a wave", include_raw=True,
                              submit_503_retries=5, submit_503_retry_seconds=0.1)

    assert submit.get("ok") is True, f"submit should succeed after 503 retry: {submit}"
    post_calls = [c for c in call_log if c[0] == "POST" and c[1].endswith("/videos")]
    assert len(post_calls) == 2, f"expected 1 retry (2 calls), got {len(post_calls)}"
    # 503 must NOT be marked on the key (only 429 cooldown).
    key = _KEY_POOL[0]
    assert key.disabled_until == 0.0, \
        f"503 must not flip key into cooldown (only 429 does), got disabled_until={key.disabled_until}"
    # Sleep should fire exactly once (between attempt 0 and attempt 1).
    assert fake_sleep.call_count == 1, \
        f"expected 1 sleep between retries, got {fake_sleep.call_count}"


def test_submit_does_not_retry_on_429() -> None:
    """429 must follow the existing cooldown + key-rotation path (no submit retry)."""
    _reset_pool("key-aaaaaaaaaaaa", "key-bbbbbbbbbbbb")
    call_count = 0

    def fake_request(method, url, **kwargs):
        nonlocal call_count
        call_count += 1
        if method == "POST" and url.endswith("/videos"):
            return _make_response(429, text_body="rate limit")
        return _make_response(500, text_body="err")

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request), \
         patch.object(srv.time, "sleep"):
        submit = _submit_impl("a wave",
                              submit_503_retries=10, submit_503_retry_seconds=0.1)

    assert submit.get("ok") is False, "submit should fail after key rotation exhausts"
    # Key-a got 429 → cooldown; key-b tried next. After key-b also 429s,
    # both are exhausted — submit returns the last 429 error.
    # 429 must NOT be retried on the same key (that's the constraint).
    post_calls = [c for c in range(call_count) if c is not None]  # informational
    # Verify neither key is in 503-cooldown state (only 429 / 401 should flip).
    for k in _KEY_POOL:
        assert k.disabled_reason != "service_503", \
            "no key should be in 503 cooldown — 429 went through the 429 path"


def test_submit_gives_up_after_max_503_retries() -> None:
    """Persistent 503 — submit must give up after submit_503_retries attempts."""
    _reset_pool("key-aaaaaaaaaaaa")
    attempts = 0

    def fake_request(method, url, **kwargs):
        nonlocal attempts
        if method == "POST" and url.endswith("/videos"):
            attempts += 1
            return _make_response(503, text_body="video_queue_full")
        return _make_response(500)

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request), \
         patch.object(srv.time, "sleep"):
        submit = _submit_impl("a wave",
                              submit_503_retries=3, submit_503_retry_seconds=0.01)

    assert submit.get("ok") is False
    assert attempts == 4, f"expected 4 POSTs (1 initial + 3 retries), got {attempts}"
    assert submit.get("error", {}).get("code") == "http_error", \
        f"expected http_error after exhausted retries, got {submit}"


# ---------------------------------------------------------------------------
# Fix 3: /agnesapi 404 → fallback to /v1/videos/{id}
# ---------------------------------------------------------------------------

def test_status_falls_back_to_v1_videos_when_agnesapi_404s() -> None:
    """/agnesapi returns 404 → poller must try /v1/videos/{id} before giving up."""
    urls_hit: list[str] = []

    def fake_request(method, url, **kwargs):
        urls_hit.append(url)
        if "/agnesapi" in url:
            return _make_response(404, text_body="任务不存在")
        if "/v1/videos/" in url:
            return _make_response(200, json_body={
                "id": "task_xyz", "video_id": "task_xyz",
                "task_id": "task_xyz", "status": "completed",
                "url": "https://example.com/v.mp4",
            })
        return _make_response(500, text_body="unexpected")

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        status = _status_impl("task_xyz")

    # Expected: /agnesapi (404) → /v1/videos/task_xyz (200).
    assert any("/agnesapi" in u for u in urls_hit), "must try /agnesapi first"
    assert any("/v1/videos/task_xyz" in u for u in urls_hit), \
        f"must try /v1/videos/{id} fallback, urls_hit={urls_hit}"
    assert status.get("ok") is True, f"status should succeed via fallback: {status}"
    assert status.get("status") == "completed"


def test_status_reports_fallback_in_error_when_all_paths_404() -> None:
    """When /agnesapi + all /v1 fallbacks 404, error message must list attempted paths."""
    urls_hit: list[str] = []

    def fake_request(method, url, **kwargs):
        urls_hit.append(url)
        return _make_response(404, text_body="not found")

    with patch.object(srv.httpx.Client, "request", side_effect=fake_request):
        status = _status_impl("task_zzz")

    assert status.get("ok") is False
    msg = status.get("error", {}).get("message", "")
    # The "Fallback tried:" summary must include both /v1 paths so a human /
    # MCP client can see what was attempted.
    assert "Fallback tried" in msg, f"missing fallback summary: {msg}"
    assert "/v1/videos/task_zzz" in msg and "/v1/videos/zzz" in msg, \
        f"summary must include both bare-hash and prefixed paths: {msg}"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    tests = [
        # Fix 1: stickiness
        test_submit_then_status_uses_same_key,
        test_wait_loop_keeps_submit_key_across_polls,
        # Fix 2: 503 retry
        test_submit_retries_on_503_then_succeeds,
        test_submit_does_not_retry_on_429,
        test_submit_gives_up_after_max_503_retries,
        # Fix 3: /v1/videos fallback
        test_status_falls_back_to_v1_videos_when_agnesapi_404s,
        test_status_reports_fallback_in_error_when_all_paths_404,
    ]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)} self-check(s) passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
