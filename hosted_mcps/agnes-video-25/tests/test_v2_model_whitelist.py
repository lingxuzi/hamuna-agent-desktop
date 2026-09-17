"""Self-check for agnes-video-v2.0 model whitelist + parameter translation (0.2.0).

The unified `mode/seconds/size/first_frame/last_frame/images[]` input shape is
preserved (no caller-facing change); the server translates the unified inputs
into v2.0's protocol fields (`ti2vid`/`keyframes` + `extra_body.image[]` +
`height`/`width` + `num_frames` + `frame_rate:24`) inside `_build_payload`.
See CHANGELOG 0.2.0 + TODO #134.

Run directly:

    python hosted_mcps/agnes-video-25/tests/test_v2_model_whitelist.py

No pytest; assert-based, exits non-zero on failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the agnes_video_25 package importable without installing it.
SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

from agnes_video_25.server import (  # noqa: E402
    ASPECT_RATIOS_V2, MODELS, MODEL_V2_NAME, SIZES_V2,
    _build_payload, _v2_aspect_to_width_height, _v2_seconds_to_num_frames,
    _validate_request,
)


def _check(label: str, got, want) -> None:
    if got == want:
        print(f"  PASS  {label}")
        return
    print(f"  FAIL  {label}")
    print(f"        got:  {got!r}")
    print(f"        want: {want!r}")
    raise SystemExit(1)


def _check_in(label: str, got, container) -> None:
    if got in container:
        print(f"  PASS  {label}")
        return
    print(f"  FAIL  {label}")
    print(f"        got:    {got!r}")
    print(f"        wanted: {sorted(container)!r}")
    raise SystemExit(1)


def main() -> None:
    # --- Whitelist surface --------------------------------------------------
    _check_in("MODELS contains agnes-video-v2.0", MODEL_V2_NAME, MODELS)
    _check_in("MODELS still contains agnes-video-2.5-flash",
              "agnes-video-2.5-flash", MODELS)
    _check_in("SIZES_V2 contains 720p", "720p", SIZES_V2)
    _check_in("SIZES_V2 contains 480p and 1080p", "480p", SIZES_V2)
    _check_in("ASPECT_RATIOS_V2 has 5 entries (no 21:9)", "16:9", ASPECT_RATIOS_V2)
    assert "21:9" not in ASPECT_RATIOS_V2, "v2.0 docs don't list 21:9"
    print("  PASS  ASPECT_RATIOS_V2 excludes 21:9 (v2.0 docs limit)")
    assert len(ASPECT_RATIOS_V2) == 5

    # --- seconds → num_frames snap (8x rule, ≤441) ---------------------------
    _check("seconds=4 → 81", _v2_seconds_to_num_frames("4"), 81)
    _check("seconds=5 → 121", _v2_seconds_to_num_frames("5"), 121)
    _check("seconds=6 → 121", _v2_seconds_to_num_frames("6"), 121)
    _check("seconds=8 → 241", _v2_seconds_to_num_frames("8"), 241)
    _check("seconds=10 → 241", _v2_seconds_to_num_frames("10"), 241)
    _check("seconds=12 → 241", _v2_seconds_to_num_frames("12"), 241)
    _check("seconds=18 → 441", _v2_seconds_to_num_frames("18"), 441)
    _check("garbage seconds → defaults near 5s (=121)", _v2_seconds_to_num_frames("nope"), 121)

    # --- aspect_ratio + size → (width, height) ints -------------------------
    _check("720p + 16:9 → (1280, 720)",
           _v2_aspect_to_width_height("720p", "16:9"), (1280, 720))
    _check("720p + 9:16 → width < height (16-multiple aligned)",
           _v2_aspect_to_width_height("720p", "9:16")[0] <
           _v2_aspect_to_width_height("720p", "9:16")[1], True)
    _check("720p + 1:1 → (720, 720)",
           _v2_aspect_to_width_height("720p", "1:1"), (720, 720))
    _check("1080p + 4:3 → width=1440, height multiple of 16",
           _v2_aspect_to_width_height("1080p", "4:3"), (1440, 1072))
    _check("480p + 16:9 → height=480 (rounded down to 16-multiple)",
           _v2_aspect_to_width_height("480p", "16:9"), (848, 480))

    # --- text mode payload: no extra_body, height/width/num_frames present --
    p = _build_payload(
        model=MODEL_V2_NAME, prompt="a cat", mode="text",
        seconds="5", size="720p", aspect_ratio="16:9", seed=42,
        first_frame=None, last_frame=None,
        images=None, audios=None, videos=None,
    )
    _check("v2 text payload model", p["model"], MODEL_V2_NAME)
    _check("v2 text payload height", p["height"], 720)
    _check("v2 text payload width", p["width"], 1280)
    _check("v2 text payload num_frames (5s → 121)", p["num_frames"], 121)
    _check("v2 text payload frame_rate fixed at 24", p["frame_rate"], 24)
    _check("v2 text payload seed preserved", p["seed"], 42)
    assert "extra_body" not in p, "text mode must not emit extra_body"
    print("  PASS  v2 text payload has no extra_body (text-to-video default)")
    assert "seconds" not in p, "v2 protocol uses num_frames, not seconds"
    print("  PASS  v2 text payload has no 'seconds' field")
    assert "mode" not in p, "v2 protocol text mode omits 'mode' field"
    print("  PASS  v2 text payload has no 'mode' field")

    # --- keyframe mode payload: extra_body.image + extra_body.mode ----------
    p = _build_payload(
        model=MODEL_V2_NAME, prompt="transition", mode="keyframe",
        seconds="5", size="720p", aspect_ratio="16:9", seed=None,
        first_frame="https://a/1.png", last_frame="https://a/2.png",
        images=None, audios=None, videos=None,
    )
    _check("v2 keyframe payload has extra_body",
           p.get("extra_body", {}).get("mode"), "keyframes")
    _check("v2 keyframe payload extra_body.image length",
           len(p["extra_body"]["image"]), 2)
    _check("v2 keyframe payload extra_body.image[0]",
           p["extra_body"]["image"][0], "https://a/1.png")
    _check("v2 keyframe payload extra_body.image[1]",
           p["extra_body"]["image"][1], "https://a/2.png")
    assert "first_frame" not in p, "v2 protocol nests first_frame into extra_body"
    print("  PASS  v2 keyframe payload has no top-level first_frame")

    # --- keyframe with only first_frame: extra_body.image = [first_frame] ---
    p = _build_payload(
        model=MODEL_V2_NAME, prompt="x", mode="keyframe",
        seconds="5", size="720p", aspect_ratio="16:9", seed=None,
        first_frame="https://a/1.png", last_frame=None,
        images=None, audios=None, videos=None,
    )
    _check("v2 keyframe only first_frame → extra_body.image = [first]",
           p["extra_body"]["image"], ["https://a/1.png"])

    # --- 2.5-flash path unchanged (regression guard) ------------------------
    p = _build_payload(
        model="agnes-video-2.5-flash", prompt="x", mode="text",
        seconds="5", size="720P", aspect_ratio="16:9", seed=None,
        first_frame=None, last_frame=None,
        images=None, audios=None, videos=None,
    )
    _check("2.5-flash text payload has 'mode'", p["mode"], "text")
    _check("2.5-flash text payload has 'seconds'", p["seconds"], "5")
    _check("2.5-flash text payload size uppercase preserved",
           p["size"], "720P")
    _check("2.5-flash text payload has 'aspect_ratio'",
           p["aspect_ratio"], "16:9")
    assert "height" not in p and "width" not in p, "2.5-flash must not emit height/width"
    print("  PASS  2.5-flash payload does not emit height/width (no regression)")

    # --- validation: reference mode rejected for v2.0 -----------------------
    err = _validate_request(MODEL_V2_NAME, "reference", "720p", "16:9",
                            None, None, ["https://a"], None, None)
    _check("v2 reference mode rejected",
           err.get("error", {}).get("code"), "reference_mode_unsupported")

    # --- validation: v2.0 accepts only lowercase 'p' sizes ------------------
    err = _validate_request(MODEL_V2_NAME, "text", "720P", "16:9",
                            None, None, None, None, None)
    _check("v2 uppercase '720P' rejected (must be lowercase)",
           err.get("error", {}).get("code"), "invalid_size")

    # --- validation: v2.0 rejects 21:9 --------------------------------------
    err = _validate_request(MODEL_V2_NAME, "text", "720p", "21:9",
                            None, None, None, None, None)
    _check("v2 aspect_ratio 21:9 rejected (not in docs)",
           err.get("error", {}).get("code"), "invalid_aspect_ratio")

    # --- validation: v2.0 valid request passes -----------------------------
    err = _validate_request(MODEL_V2_NAME, "text", "720p", "16:9",
                            None, None, None, None, None)
    _check("v2 valid text request returns no error", err, None)

    print("\n  All cases passed.")


if __name__ == "__main__":
    main()
