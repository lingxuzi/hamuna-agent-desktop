"""Self-check for ``_coerce_image_paths_input`` (2026-09-11, 0.1.7 trade-off fix).

The helper exists to tolerate MCP clients that emit ``image_paths`` as a
dict (``{"item": [...]}`` or single-key ``{key: [list]}``) instead of a
plain list. See CHANGELOG 0.1.7 for the full rationale + acknowledged
trade-offs.

Run directly:

    python hosted_mcps/agnes-video-25/tests/test_image_paths_dict_tolerance.py

No pytest; assert-based, exits non-zero on failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the agnes_video_25 package importable without installing it.
SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

from agnes_video_25.server import _coerce_image_paths_input  # noqa: E402


def _check(label: str, got, want) -> None:
    if got == want:
        print(f"  PASS  {label}")
        return
    print(f"  FAIL  {label}")
    print(f"        got:  {got!r}")
    print(f"        want: {want!r}")
    raise SystemExit(1)


def main() -> None:
    # --- list inputs: pass through untouched -----------------------------
    _check(
        "list input returns same list",
        _coerce_image_paths_input(["/a.png", "/b.png"]),
        ["/a.png", "/b.png"],
    )

    # --- None input: pass through ----------------------------------------
    _check(
        "None input returns None",
        _coerce_image_paths_input(None),
        None,
    )

    # --- the reported bug shape: {"item": [list]} ------------------------
    _check(
        'dict with "item" key → unwrap inner list',
        _coerce_image_paths_input({"item": ["/a.png", "/b.png"]}),
        ["/a.png", "/b.png"],
    )

    _check(
        # 0.2.1: harness serializes single-element ["<url>"] as
        # {"item": "<url>"} (a dict-of-string, NOT dict-of-list). The
        # helper now unwraps the single string into a 1-element list.
        'dict with "item" key + single-string value → wrap to 1-element list',
        _coerce_image_paths_input({"item": "/not-a-list"}),
        ["/not-a-list"],
    )

    # --- single-key dict whose value IS a list: unwrap --------------------
    _check(
        "single-key dict whose value is a list → unwrap",
        _coerce_image_paths_input({"foo": ["/a.png"]}),
        ["/a.png"],
    )

    # --- single-key dict whose value is NOT a list: pass through ---------
    _check(
        "single-key dict whose value is not a list → return dict unchanged",
        _coerce_image_paths_input({"foo": "/a.png"}),
        {"foo": "/a.png"},
    )

    _check(
        "single-key dict whose value is None → return dict unchanged",
        _coerce_image_paths_input({"foo": None}),
        {"foo": None},
    )

    # --- multi-key dicts: pass through (don't grab arbitrary value) ------
    _check(
        "multi-key dict → return dict unchanged",
        _coerce_image_paths_input({"a": ["/x"], "b": ["/y"]}),
        {"a": ["/x"], "b": ["/y"]},
    )

    _check(
        "multi-key dict with mixed value types → return dict unchanged",
        _coerce_image_paths_input({"a": ["/x"], "b": "literal"}),
        {"a": ["/x"], "b": "literal"},
    )

    # --- empty dict: pass through ----------------------------------------
    _check(
        "empty dict → return empty dict (len != 1, no 'item' key)",
        _coerce_image_paths_input({}),
        {},
    )

    print("\n  All 10 cases passed.")


if __name__ == "__main__":
    main()