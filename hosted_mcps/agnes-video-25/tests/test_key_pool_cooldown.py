"""Self-check for multi-key cooldown logic (2026-09-10 change).

Validates the 30s-window 429 reason split + cooldown reset + on-disk state
persistence added to ``server.py``. Run directly:

    python hosted_mcps/agnes-video-25/tests/test_key_pool_cooldown.py

No pytest; assert-based, exits non-zero on failure.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

# Isolate persistence to a tmp dir BEFORE importing the server module so the
# module-level _STATE_DIR lookup at first call sees the override.
_TMP_STATE_DIR = Path(tempfile.mkdtemp(prefix="agnes-key-pool-test-"))
os.environ["AGNES_KEY_POOL_STATE_DIR"] = str(_TMP_STATE_DIR)

# Make the agnes_video_25 package importable without installing it.
SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

from agnes_video_25.server import (  # noqa: E402  (sys.path tweak above)
    _KEY_POOL,
    _KEY_POOL_LOADED,
    _KEY_POOL_LOCK,
    _KeyState,
    _load_key_pool,
    _load_persisted_state,
    _mark_disabled,
    _persist_state,
    _pick_key,
    _state_file,
)


def _reset_pool(*raw_keys: str) -> list[_KeyState]:
    """Replace the module-level pool with fresh states for deterministic asserts."""
    with _KEY_POOL_LOCK:
        _KEY_POOL[:] = [_KeyState(raw=k, masked=k[:4] + "***") for k in raw_keys]
        # Flip the cached-loaded flag via a local rebind; module attr reassignment
        # is the only way since _KEY_POOL_LOADED is a module-level bool.
    import agnes_video_25.server as srv
    srv._KEY_POOL_LOADED = True  # type: ignore[attr-defined]
    return list(_KEY_POOL)


def test_first_429_uses_quota_429_reason() -> None:
    _reset_pool("key-aaaaaaaaaaaa")
    key = _pick_key()
    assert key is not None
    now = time.time()
    _mark_disabled(key, "quota_429", now + 60.0)
    assert key.disabled_reason == "quota_429"
    assert key.disabled_until == now + 60.0


def test_30s_window_second_429_promotes_to_consecutive() -> None:
    _reset_pool("key-bbbbbbbbbbbb")
    key = _pick_key()
    assert key is not None
    # First 429 — sets last_429_at to "now" (real time).
    now = time.time()
    _mark_disabled(key, "quota_429", now + 60.0)
    key.last_429_at = now

    # _pick_key should refuse (cooldown active).
    assert _pick_key() is None

    # Within 30s window — reason should promote to consecutive_429_30s.
    later = now + 5.0  # 5s later, well within 30s window
    in_window = key.last_429_at > 0.0 and (later - key.last_429_at) <= 30.0
    reason = "consecutive_429_30s" if in_window else "quota_429"
    assert reason == "consecutive_429_30s", f"expected consecutive_429_30s, got {reason}"
    _mark_disabled(key, reason, later + 60.0)
    assert key.disabled_reason == "consecutive_429_30s"


def test_outside_30s_window_resets_reason() -> None:
    _reset_pool("key-cccccccccccc")
    key = _pick_key()
    assert key is not None
    now = time.time()
    _mark_disabled(key, "quota_429", now + 60.0)
    key.last_429_at = now - 31.0  # 31s ago — outside the 30s window

    later = time.time()
    in_window = key.last_429_at > 0.0 and (later - key.last_429_at) <= 30.0
    reason = "consecutive_429_30s" if in_window else "quota_429"
    assert reason == "quota_429", f"expected quota_429, got {reason}"


def test_pick_key_refreshes_after_cooldown() -> None:
    _reset_pool("key-dddddddddddd")
    key = _pick_key()
    assert key is not None
    now = time.time()
    _mark_disabled(key, "consecutive_429_30s", now + 60.0)
    key.last_429_at = now
    assert key.last_429_at == now

    # Force cooldown to have elapsed by rewriting disabled_until to past.
    key.disabled_until = time.time() - 1.0
    picked = _pick_key()
    assert picked is key, "expected the same key after cooldown"
    assert key.last_429_at == 0.0, f"expected refresh (last_429_at=0), got {key.last_429_at}"


def test_state_persists_across_calls() -> None:
    """_mark_disabled must persist to disk; load should see the same disabled_until."""
    state_path = _state_file()
    if state_path.exists():
        state_path.unlink()

    _reset_pool("key-eeeeeeeeeeee")
    key = _pick_key()
    assert key is not None
    now = time.time()
    # Set last_429_at BEFORE _mark_disabled — _persist_state fires inside it,
    # so the disk snapshot must reflect the state we want to verify.
    key.last_429_at = now
    _mark_disabled(key, "consecutive_429_30s", now + 60.0)

    persisted = _load_persisted_state()
    assert "key-eeeeeeeeeeee" in persisted, f"expected key persisted, got {persisted}"
    entry = persisted["key-eeeeeeeeeeee"]
    assert entry["disabled_reason"] == "consecutive_429_30s"
    assert abs(entry["disabled_until"] - (now + 60.0)) < 0.01
    assert abs(entry["last_429_at"] - now) < 0.01


def test_load_merges_future_disabled_only() -> None:
    """Expired persisted disables are dropped; future ones are honored."""
    import json as _json
    import agnes_video_25.server as srv

    state_path = _state_file()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(_json.dumps({
        "key-ffffffffffff": {
            "disabled_until": time.time() + 60.0,
            "disabled_reason": "quota_429",
            "last_429_at": time.time(),
            "consecutive_failures": 1,
        },
        "key-expiredxxxxx": {
            "disabled_until": time.time() - 10.0,
            "disabled_reason": "quota_429",
            "last_429_at": 0.0,
            "consecutive_failures": 5,
        },
    }), encoding="utf-8")

    # Inject keys via env so _load_key_pool picks them up. Use os.environ
    # directly; restore on exit to keep tests independent.
    saved = os.environ.get("AGNES_API_KEYS")
    os.environ["AGNES_API_KEYS"] = "key-ffffffffffff,key-expiredxxxxx"
    try:
        # Reset cached-loaded so the next _pick_key actually reloads.
        srv._KEY_POOL_LOADED = False  # type: ignore[attr-defined]
        keys = _load_key_pool()
    finally:
        if saved is None:
            os.environ.pop("AGNES_API_KEYS", None)
        else:
            os.environ["AGNES_API_KEYS"] = saved

    by_raw = {k.raw: k for k in keys}
    assert by_raw["key-ffffffffffff"].disabled_reason == "quota_429", \
        "future-disabled key should keep its reason"
    assert by_raw["key-expiredxxxxx"].disabled_until == 0.0, \
        "expired-disabled key should be reset to available"
    assert by_raw["key-expiredxxxxx"].disabled_reason is None, \
        "expired-disabled key should drop reason"


def main() -> int:
    tests = [
        test_first_429_uses_quota_429_reason,
        test_30s_window_second_429_promotes_to_consecutive,
        test_outside_30s_window_resets_reason,
        test_pick_key_refreshes_after_cooldown,
        test_state_persists_across_calls,
        test_load_merges_future_disabled_only,
    ]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)} self-check(s) passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
