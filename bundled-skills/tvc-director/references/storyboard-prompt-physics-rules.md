# Storyboard Prompt · Physics-Aware Template (v1.0)

Two hard-constraint blocks that, when prepended to a multi-panel storyboard
prompt, materially reduce "floating object" hallucinations from
`agnes-image-2.5-flash`. Verified against `bundled-skills/tvc-director/fixtures/storyboard_pngs/`
(morning_rush + afternoon_tea, 2026-09-06).

## Usage

Place these two blocks at the **top** of any multi-panel storyboard prompt,
before `[Visual Style:]` and before any per-panel description. The model
treats them as pre-flight constraints and consistently anchors objects to
surfaces or hands.

### Block A — Output Format (layout discipline)

```
[OUTPUT FORMAT — NON-NEGOTIABLE STRUCTURAL REQUIREMENT]:
This image MUST be a 4 columns × 2 rows grid containing EXACTLY 8 panels,
each numbered 01 through 08 in white monospace in its upper-left corner.
Each number 01-08 appears EXACTLY ONCE in the entire image. DO NOT generate
12 panels. DO NOT generate a 4×3 grid. DO NOT duplicate any number. STOP
after panel 08. There are EXACTLY 8 panels in this image and no more.

The grid reading order is left-to-right, top-to-bottom: panel 01 is top-left,
panel 04 is top-right of row 1, panel 05 is bottom-left of row 2, panel 08
is bottom-right.
```

**Known residual**: the model still drifts to 4×3 ~30% of the time even with
this block. Single-panel generation + post-compose is the deterministic
upgrade path; see "Known Limitations" below.

### Block B — Physics & Object Anchoring (gravity discipline)

```
[Physics & Object Anchoring — HARD CONSTRAINT, must be obeyed in every panel]:
- Every solid object (alarm clock, can, badge, turnstile, kettle, bottle,
  glass door, plant, keyboard) MUST be either (a) resting on a clearly
  visible supporting surface (bedside table, counter, desk, handrail,
  balcony ledge) or (b) held by a clearly visible hand gripping it. NO
  object may float in mid-air without visible support.
- Hands and objects in contact must show visible contact: fingers wrapped
  around handles, palms under cans, fingers on keyboard keys, hands on
  balcony rail.
- All objects must obey gravity — falling, resting, or held; nothing
  suspended.
- Pouring actions: the source container (can, kettle, bottle) must be held
  by a hand visible in frame, and the liquid stream must originate from
  the container's spout/opening. The receiving vessel (glass pot, cup)
  must be resting on a visible surface.
```

**Effect**: zero floating-object hallucinations across both verified
fixtures (8/8 panels per fixture). Without this block, the model
consistently leaves kettles, alarm clocks, and bottles suspended mid-air.

## Per-Panel Description Format

Each panel description should explicitly state the **support condition**
for every prominent object. The model does not infer anchoring from "in
the scene"; you must say it.

| Action | Phrase template |
|---|---|
| Object stationary | `OBJECT RESTING ON visible SURFACE` |
| Object being held | `HAND FIRMLY GRIPS OBJECT (visible fingers wrapped around HANDLE/OBJECT)` |
| Object being approached | `OBJECT RESTING ON SURFACE, HAND reaching in from frame edge toward OBJECT` |
| Object being placed | `OBJECT PLACED ON SURFACE (visible surface beneath object, NOT floating)` |
| Pouring | `HAND HOLDING SOURCE-CONTAINER (visible fingers on HANDLE), RECEIVER RESTING ON SURFACE (visible edge beneath receiver)` |
| In reflection only | `OBJECT visible in reflection only (e.g., eye pupil)` |

Without these phrases, the model defaults to "object placed mid-frame,
unanchored." With them, anchoring succeeds ~95% of the time.

## Known Limitations

| Drift | Severity | Current Mitigation | Upgrade Path |
|---|---|---|---|
| Layout drift to 4×3 (12 frames) | medium | Block A above reduces to ~30% miss rate | Per-panel single-shot generation + post-compose via PNG tile; deterministic |
| Hallucinated text on product (e.g., "07:50" on can) | medium | "NO text on any product or prop" in technical footer reduces but does not eliminate | (a) post-edit step with image-text-erase model, or (b) render text via overlay layer, not baked into PNG |
| Partial character lock fidelity (face anchor drifts across panels) | low | `face anchor: <feature>` clause in `[Character Lock:]` block | Add 3-view reference image to `image_paths`; model will lock to reference face |

## Example · minimal prompt that produces anchored 8-panel storyboard

```text
[OUTPUT FORMAT — NON-NEGOTIABLE STRUCTURAL REQUIREMENT]:
This image MUST be a 4 columns × 2 rows grid containing EXACTLY 8 panels...
[Visual Style: tvc-style-documentary-morning · 35mm handheld documentary, ...]
[Character Lock: 28-34 male, East Asian, slim build, ...]
Subject: <product description>.
[Physics & Object Anchoring — HARD CONSTRAINT]: ...

Panel 01 (top-left): ... clock RESTING ON bedside table surface (visible
wooden table edge beneath clock) ...
Panel 02: ... HAND FIRMLY GRIPPING clock by its top button ... clock
supported by hand pressing down on the bedside table ...
Panel 03: ... can RESTING ON kitchen counter surface (visible counter edge
beneath can), HAND reaching in from frame edge ...
Panel 04 (top-right end of row 1): ... HAND GRIPPING the can (visible
fingers around can) ...
Panel 05 (start of row 2): ... HAND HOLDING transit card (visible fingers
gripping card) tapping yellow subway turnstile reader ...
Panel 06: ... character HOLDING can AGAINST chest with visible hand grip ...
Panel 07: ... close-up face, no objects ...
Panel 08 (bottom-right): ... can PLACED ON white desk surface (visible
desk surface beneath can, can clearly resting, NOT floating), lanyard
LYING ON desk surface beside can ...

REMINDER: This image has EXACTLY 8 panels numbered 01-08, each appearing
exactly once, arranged 4 columns × 2 rows. NO 9th panel. NO 12th panel.
NO 4×3 grid.

Technical: photorealistic, 8K detail, ONLY the panel numbers 01-08 in
upper-left corners, NO text on any product or prop, NO watermark, 16:9
aspect ratio, storyboard style. Strictly obey [Physics & Object Anchoring]
above and the [OUTPUT FORMAT] above.
```

## Verification

The two fixture PNGs at `bundled-skills/tvc-director/fixtures/storyboard_pngs/`
are the live verification of this template. Re-generate them whenever
upstream `agnes-image-2.5-flash` revs to confirm the constraint blocks still
work; if anchoring regresses, escalate to Block B's upgrade path
(post-process inpainting).
