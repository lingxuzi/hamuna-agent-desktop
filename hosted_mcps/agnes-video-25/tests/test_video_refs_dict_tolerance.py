"""Self-check for video-side dict-shape tolerance helpers (2026-09-19, 0.2.1).

Video reference-mode ``images`` / ``audios`` / ``videos`` accept dicts in the
schema and normalize them at runtime. Image side already did this in 0.1.7 /
0.1.8 for ``image_paths``; 0.2.1 mirrors the fix to video.

Two helpers, two distinct inner types:

  * ``_coerce_str_list_input`` (alias of ``_coerce_image_paths_input``) — for
    ``images`` / ``audios`` (list[str] payloads).
  * ``_coerce_videos_input`` — for ``videos`` (list[dict[str, Any]] payloads
    shaped like ``{"url": "..."}``).

Run directly:

    python hosted_mcps/agnes-video-25/tests/test_video_refs_dict_tolerance.py

No pytest; assert-based, exits non-zero on failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the agnes_video_25 package importable without installing it.
SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

from agnes_video_25.server import (  # noqa: E402
    _coerce_str_list_input,
    _coerce_videos_input,
)


def _check(label: str, got, want) -> None:
    if got == want:
        print(f"  PASS  {label}")
        return
    print(f"  FAIL  {label}")
    print(f"        got:  {got!r}")
    print(f"        want: {want!r}")
    raise SystemExit(1)


def main() -> None:
    print("=== _coerce_str_list_input (images / audios) ===")

    # --- list inputs: pass through untouched -----------------------------
    _check(
        "list input returns same list",
        _coerce_str_list_input(["https://x/a.png", "https://x/b.png"]),
        ["https://x/a.png", "https://x/b.png"],
    )

    # --- None input: pass through ----------------------------------------
    _check(
        "None input returns None",
        _coerce_str_list_input(None),
        None,
    )

    # --- the reported bug shape for video reference mode: {"item": "<single url>"}
    # (harness serializes single-element ["<url>"] as a dict-of-string).
    _check(
        'dict with "item" key + single-string value → wrap to 1-element list',
        _coerce_str_list_input({"item": "https://x/a.png"}),
        ["https://x/a.png"],
    )

    _check(
        'dict with "item" key + list value → unwrap inner list',
        _coerce_str_list_input({"item": ["https://x/a.png", "https://x/b.png"]}),
        ["https://x/a.png", "https://x/b.png"],
    )

    # --- single-key dict whose value IS a list: unwrap -------------------
    _check(
        "single-key dict whose value is a list → unwrap",
        _coerce_str_list_input({"foo": ["https://x/a.png"]}),
        ["https://x/a.png"],
    )

    # --- multi-key dicts: pass through (don't grab arbitrary value) ------
    _check(
        "multi-key dict → return dict unchanged",
        _coerce_str_list_input({"a": ["x"], "b": ["y"]}),
        {"a": ["x"], "b": ["y"]},
    )

    # --- empty dict: pass through ----------------------------------------
    _check(
        "empty dict → return empty dict",
        _coerce_str_list_input({}),
        {},
    )

    # --- 0.2.2 regression: harness / sub-agent multi-call nesting ------
    _check(
        "nested depth-2 dict with item → recursive unwrap",
        _coerce_str_list_input({"item": {"item": ["https://x/a.png", "https://x/b.png"]}}),
        ["https://x/a.png", "https://x/b.png"],
    )
    _check(
        "nested depth-3 dict with item → recursive unwrap",
        _coerce_str_list_input({"item": {"item": {"item": ["https://x/a.png"]}}}),
        ["https://x/a.png"],
    )

    print("\n=== _coerce_videos_input ===")

    # --- list-of-dict inputs: pass through -------------------------------
    _check(
        "list input returns same list",
        _coerce_videos_input([{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}]),
        [{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}],
    )

    # --- None input: pass through ----------------------------------------
    _check(
        "None input returns None",
        _coerce_videos_input(None),
        None,
    )

    # --- the reported bug shape: {"item": {"url": "..."}} ----------------
    # 0.2.2: now recursive — single-dict at leaf unwraps to the inner dict.
    _check(
        'dict with "item" key + single-dict value → unwrap inner dict',
        _coerce_videos_input({"item": {"url": "https://x/v.mp4"}}),
        {"url": "https://x/v.mp4"},
    )

    _check(
        'dict with "item" key + list-of-dicts value → unwrap inner list',
        _coerce_videos_input({"item": [{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}]}),
        [{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}],
    )

    # --- single-key dict whose value IS a list-of-dicts: unwrap ---------
    _check(
        "single-key dict whose value is a list → unwrap",
        _coerce_videos_input({"foo": [{"url": "https://x/v.mp4"}]}),
        [{"url": "https://x/v.mp4"}],
    )

    # --- single-key dict whose value IS a single-dict: recursive unwrap ---
    _check(
        "single-key dict whose value is a single dict → unwrap inner dict",
        _coerce_videos_input({"foo": {"url": "https://x/v.mp4"}}),
        {"url": "https://x/v.mp4"},
    )

    # --- multi-key dicts: pass through -----------------------------------
    _check(
        "multi-key dict → return dict unchanged",
        _coerce_videos_input({"a": [{"url": "x"}], "b": [{"url": "y"}]}),
        {"a": [{"url": "x"}], "b": [{"url": "y"}]},
    )

    # --- empty dict: pass through ----------------------------------------
    _check(
        "empty dict → return empty dict",
        _coerce_videos_input({}),
        {},
    )

    # --- 0.2.2 regression: harness / sub-agent multi-call nesting ------
    _check(
        "nested depth-2 dict with item → recursive unwrap",
        _coerce_videos_input({"item": {"item": [{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}]}}),
        [{"url": "https://x/v.mp4"}, {"url": "https://x/w.mp4"}],
    )
    _check(
        "nested depth-3 dict with item → recursive unwrap",
        _coerce_videos_input({"item": {"item": {"item": [{"url": "https://x/v.mp4"}]}}}),
        [{"url": "https://x/v.mp4"}],
    )

    print("\n  All cases passed.")


if __name__ == "__main__":
    main()
