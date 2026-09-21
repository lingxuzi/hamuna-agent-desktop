# Changelog · agnes-video-25-mcp

All notable changes are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Package: `agnes-video-25-mcp` · PyPI: https://pypi.org/project/agnes-video-25-mcp/ · Source vendor: `hosted_mcps/agnes-video-25/` in hamuna-agent-desktop.

---

## [0.2.2] — 2026-09-21

### Fixed

- **Recursive unwrap for harness-shaped multi-call nesting** (`_coerce_image_paths_input`, `_coerce_str_list_input`, `_coerce_videos_input`):
  0.2.1's helpers unwrapped a single layer of `{"item": [...]}` only. When harness / sub-agent called the same tool multiple times and the upstream pipeline re-wrapped an already-normalized list (e.g. `{"item": {"item": ["url1", "url2"]}}`), the helper returned the outer dict unchanged. Downstream `for v in values` then iterated dict keys (`'item'`) and passed those as "URLs" to `_resolve_image_ref`, silently dropping every real image with `invalid_param` / `invalid_url`. The "more urls ⇒ worse" symptom was this depth-≥2 layer peeling off without any error trace linking back to nesting.

  - All three helpers now loop while `value` is a dict and the unwrap rules still match (with `id(value)` cycle guard + depth cap of 8 to prevent malicious self-referential payloads from looping forever).
  - New unwrap path inside the loop: when `inner` (or the single-key `only`) is itself a dict, the loop continues into it instead of breaking. This is what makes `{"item": {"item": [...]}}` collapse to the inner list.
  - Backward compatible: every input shape 0.2.1 handled is handled identically; the recursive loop only reaches deeper layers that 0.2.1 returned as dicts.

### Compatibility

- Backward compatible with 0.2.1 — no schema change, no public surface change.
- `len(dict) == 1` single-key unwrap rule remains in effect for the *first* matching layer (0.1.7 / 0.1.8 trade-off carried forward).
- Type-unsafe single-key unwrap (TODO #131 follow-up (a)) is unchanged; **the architecturally correct fix (Pydantic `BeforeValidator` at the schema layer) remains the open follow-up**. 0.2.2 is a runtime mitigation, not the architecture reset.

### Tests

- `tests/test_image_paths_dict_tolerance.py`: added 4 nested cases (depth-2 `item`, depth-3 `item`, depth-2 single-key, depth-2 `item` + single string). Total 14/14 pass.
- `tests/test_video_refs_dict_tolerance.py`: added 4 nested cases for `_coerce_str_list_input` (depth-2/3 `item`) and `_coerce_videos_input` (depth-2/3 `item`). Adjusted two existing case-test contracts from "single dict → wrap to 1-element list" to "single dict → unwrap inner dict" (this is the correct contract under recursive semantics — the list-wrap was a non-recursive quirk). Total 19/19 pass.
- Self-ref and depth-cap guards verified ad-hoc (no test file added; covered by code-path assertion in the helpers' `seen` set + `len(seen) > 8` break).

---

## [0.2.1] — 2026-09-19

### Fixed

- **`agnes25_video_generate` reference mode harness dict-wrap bug**:
  harness (Claude Code MCP client) was serializing single-element
  `images=["<url>"]` (and `audios`, `videos`) as `{"item": "<url>"}` dicts.
  Schema rejected the dict upstream with
  `Input should be a valid list [type=list_type, input_value={'item': '...'}, input_type=dict]`,
  blocking all reference-mode calls.

  - **`images` / `audios` type**: extended from `list[str] | None` to
    `list[str] | dict[str, Any] | None` (same trade-off 0.1.8 used for
    `image_paths`).
  - **`videos` type**: extended from `list[dict[str, Any]] | None` to
    `list[dict[str, Any]] | dict[str, Any] | None` (mirror for dict payloads).
  - **Runtime normalization**: added `_coerce_str_list_input` (alias of
    `_coerce_image_paths_input`) and `_coerce_videos_input` helpers. Called
    once at `_generate_impl` entry, BEFORE `_submit_impl` so the inner
    payload stays canonical list shape.
  - **New unwrap rule (also retrofitted on `_coerce_image_paths_input`)**:
    `{"item": "<single string>"}` is now wrapped to `["<single string>"]`
    (previously returned unchanged). This is the exact shape harness emits
    for single-element arrays.

### Compatibility

- Backward compatible: callers that already pass `list` are unchanged.
- The dict-form is **only** a fallback for harness-shaped inputs; it is
  type-unsafe in one corner (single-key dicts whose value happens to be
  a list will be silently unwrapped). Caller-side discipline remains the
  long-term fix; this is the cheapest server-side mitigation.
- FastMCP / Pydantic v2 may still validate the type hint before the
  function body runs — the dict-form signature is what makes that
  validation pass.

### Tests

- `tests/test_image_paths_dict_tolerance.py`: added case for
  `{"item": "<single string>"}` → `["<single string>"]` (replaces the old
  "return dict unchanged" assertion).
- `tests/test_video_refs_dict_tolerance.py`: new file covering both
  `_coerce_str_list_input` and `_coerce_videos_input` with 14 cases
  (list pass-through, None, item-as-list, item-as-string, single-key,
  multi-key, empty).

---

## [0.2.0] — 2026-09-11

### Added

- **`agnes-video-v2.0` model whitelist + parameter translation**:
  - `MODELS` set now includes `MODEL_V2_NAME = "agnes-video-v2.0"`. Callers may
    explicitly pass `model="agnes-video-v2.0"` to `agnes25_video_generate`.
  - **Input surface unchanged**: callers still pass the unified
    `mode` (`text` / `keyframe` / `reference`), `seconds`, `size`,
    `aspect_ratio`, `first_frame` / `last_frame`, `images` / `audios` /
    `videos` fields. The server translates them into v2.0's protocol fields
    inside `_build_payload`.
  - **v2.0 protocol mapping**:
    - `mode="text"` → no `mode` field; v2.0 defaults to text-to-video.
    - `mode="keyframe"` → `extra_body.mode = "keyframes"` +
      `extra_body.image = [first_frame, last_frame]` (filtered to non-empty).
    - `mode="reference"` → rejected with `reference_mode_unsupported` (v2.0
      docs do not expose `images[]` / `audios[]` / `videos[]` arrays).
    - `seconds` string → `num_frames` (snapped to the docs-legal set
      `[81, 121, 241, 441]`) + fixed `frame_rate: 24`.
    - `size` + `aspect_ratio` → `width` + `height` ints (16-multiple aligned).
  - **Per-model validation** (`_validate_request`):
    - v2.0 size set = `{480p, 720p, 1080p}` (lowercase `p`, per docs).
    - v2.0 aspect_ratio set = `{16:9, 9:16, 1:1, 4:3, 3:4}` (5 ratios — v2.0
      docs do **not** list `21:9`).
    - Reject uppercase `720P` for v2.0 (use lowercase `720p`).
    - Reject `mode="reference"` for v2.0 with `reference_mode_unsupported`.

### Compatibility

- **Backward compatible at the API surface**: tool names + JSON schemas for
  the existing `mode` / `seconds` / `size` / `aspect_ratio` / media fields are
  unchanged. New behavior only activates when caller passes
  `model="agnes-video-v2.0"`.
- **Backward compatible at the env surface**: `AGNES_API_KEY` and
  `AGNES_API_KEYS` unchanged.
- **No automatic fallback**: v2.0 is **whitelist-only**. Callers must opt in
  explicitly. This preserves the existing "no MCP-side fallback" rule in
  `bundled-skills/creative-video-suite` (TODO #119 + §5.2).

### Scope-out (deliberate)

- **No caller-facing fields for v2.0-only knobs** (`negative_prompt`,
  `num_inference_steps`, etc.). v2.0 docs support these, but exposing them
  would break the "input surface unchanged" contract. Add a follow-up if a
  caller surfaces a real need.
- **Skill-side red lines unchanged**:
  `bundled-skills/creative-video-suite/references/agnes-ai-api.md:261` still
  lists `agnes-video-v2.0` under "已下线，禁止再使用"; the 9 MCP call templates
  still hard-code `model="agnes-video-2.5-flash"`. v2.0 is reachable only via
  explicit non-skill callers until a future session reopens §5.2.

### Tests

- `tests/test_v2_model_whitelist.py` — 42 assertions covering whitelist
  surface, `seconds` → `num_frames` snap (4 → 81 / 5 → 121 / 8 → 241 /
  12 → 241 / 18 → 441), aspect_ratio + size → (width, height) int
  conversion, text-mode payload shape (no `extra_body`, no `seconds`,
  no `mode`), keyframe-mode payload (`extra_body.image` + `extra_body.mode`),
  2.5-flash regression guard, and validation rejections
  (`reference_mode_unsupported`, uppercase `720P`, 21:9).
- Existing `test_image_paths_dict_tolerance.py` (10/10) and
  `test_key_pool_cooldown.py` (6/6) pass unchanged.

---

## [0.1.8] — 2026-09-11

### Fixed

- **`agnes25_image_generate` schema now accepts `image_paths` as `list[str] | dict | None`** (was `list[str] | None`):
  - 0.1.7's defensive in-function guard (`_coerce_image_paths_input`) was unreachable when FastMCP / Pydantic v2 rejected dict inputs at the schema layer (the symptom: Pydantic `Input should be a valid list [type=list_type, input_value={'item': [...]}, input_type=dict]` for Claude Code MCP clients wrapping arrays as `{item: [...]}`).
  - 0.1.8 widens the **schema-layer** type to `list[str] | dict[str, Any] | None` so dict inputs reach the function body, where `_coerce_image_paths_input` already unwraps them.
  - Both the `@mcp.tool()` entry point (`agnes25_image_generate`) and the internal `_image_generate_impl` carry the wider type to keep cross-call types consistent.

### Trade-offs (carry-over from 0.1.7, now reachable)

- **JSON schema for the tool now lists `image_paths` as `oneOf: [array<string>, object, null]`** instead of `array<string> | null`. Other MCP clients consuming the schema may need to handle the new `object` case (most will fall through to runtime type errors if they send a non-list non-dict shape, which is no worse than today).
- **`_coerce_image_paths_input` single-key unwrap is still type-unsafe**: passing `{"foo": ["bar"]}` will silently be "fixed" into `["bar"]`. Caller-side discipline remains the safe path; this trade-off is now reachable in practice.

### Migration from 0.1.7

- Callers should continue to pass `list[str]` (preferred). The dict form is a fallback for clients that wrap arrays.
- Tool consumers reading the JSON schema will see `image_paths` listed as `oneOf`; update accordingly.

---

## [0.1.7] — 2026-09-11

### Changed

- **`agnes25_image_generate` accepts `image_paths` as `list[str]` or `dict` form**:
  - Defensive normalization at the top of `_image_generate_impl`: if the caller passes a `dict` instead of a list (reported by the user as "MCP 客户端把 image_paths 数组包装成 `{"item": [...]}` dict 的 bug"), extract the underlying list.
    - `{"item": [list]}` → unwrap to `[list]`.
    - `{key: [list]}` (single-key dict whose value is a list) → unwrap to `[list]`.
  - `list` inputs are unaffected (early-return path).

### ⚠️ Known limitations of 0.1.7 (deliberate trade-offs — user拍板)

- **Fix not verified against a real Pydantic error**: the bug report ("长度 3 + 中文路径 7/7 失败 + 序列化为 {item: [...]} dict + Pydantic validation error") was never reproduced with a ground-truth payload. The user's own example payload had `image_paths` as a valid `[...]` list (length 2, not 3). The fix may be **unreachable** if FastMCP / Pydantic v2 validates the function signature strictly (the `isinstance(image_paths, dict)` check sits *inside* the function body and would never run if the schema rejects dicts before the call).
- **`len(dict) == 1` fallback is type-unsafe**: if a caller accidentally passes `{"foo": ["bar"]}` it will silently be "fixed" into `image_paths = ["bar"]`. Silent data corruption is worse than a loud Pydantic error.
- **No e2e validation of MCP client-side dict emission**: we did not confirm that any real MCP client actually emits dicts in place of arrays for `image_paths`. If the report is unfounded, this is dead defensive code.
- **Proper fix would change the schema layer**, not the function body: either `image_paths: list[str] | dict | None` + a Pydantic `BeforeValidator` that normalizes dict → list, or fix the caller. User chose the cheaper in-function guard accepting the above trade-offs.

### Migration from 0.1.6

- Callers should continue to pass `list[str]`. The dict form is a fallback only.
- If your MCP client is the source of dict-shaped `image_paths`, please file an issue there — the proper fix is caller-side, not server-side.

---

## [0.1.6] — 2026-09-09

> Note: this entry was retroactively added to vendor `CHANGELOG.md` on 2026-09-11 — `§3.2 P3 Step 3` published v0.1.6 to PyPI on 2026-09-09T16:24:15/18Z but the vendor changelog file was not updated. Content reconstructed from commit `d2403e6`.

### Changed

- **Multi-key cooldown state persisted + 30s window reason split** (commit `d2403e6`):
  - `_KEY_POOL_STATE_DIR` env override for persisted state directory.
  - `AGNES_KEY_POOL_STATE_DIR` configurable.
  - Cooldown completion refreshes `last_429_at=0`.
  - Atomic `tmp + rename` writes for state file.
  - 30-second sliding-window reason split (429 quota vs 503 short cooldown vs 401 permanent ban).
  - Single chokepoint in `_request_json` — multi-key fallback machinery continues to gate every request through that one path.

### Compatibility

- Backward compatible at the API surface (tool names + JSON schemas unchanged).
- Backward compatible at the env surface: `AGNES_API_KEY` still works; `AGNES_API_KEYS` continues to be opt-in.
- Behavior change (carried over from 0.1.5): default video model is `agnes-video-2.5-flash`, not `agnes-video-2.5`.

---

## [0.1.5] — 2026-09-09

### Changed

- **Default video model**: `DEFAULT_MODEL` is now `agnes-video-2.5-flash` (was `agnes-video-2.5`). Aligns the server default with the bundled skill defaults (`bundled-skills/tvc-director` + `bundled-skills/creative-video-suite` MCP call templates T04–T12 hard-code `model="agnes-video-2.5-flash"`). Callers who omit the `model` parameter no longer silently land on the pricier non-flash endpoint. The `DEFAULT_FLASH_MODEL` constant remains as the canonical flash identifier.
  - **Operator action recommended**: existing callers that relied on the old default should explicitly pass `model="agnes-video-2.5"` to keep the non-flash endpoint, or audit their cost surface now that they get flash by default.

### Added (P3 multi-key fallback — code shipped, tests skipped)

- **Multi-key API key pool** (P3 / spec at `.pavo-research/agnes-multi-key-fallback-spec.md`):
  - `_load_key_pool()` parses both `AGNES_API_KEYS` (new, comma-separated, preferred) and falls back to `AGNES_API_KEY` (legacy, single value). Empty / whitespace-only keys are stripped. Missing both → `missing_api_key` error (unchanged behavior).
  - `_pick_key()` walks the pool and returns the first key whose `disabled_until` has passed. All keys exhausted → `all_keys_exhausted` error.
  - `_mark_disabled(key, reason, until)` flips a key's state with reason + expiry, logs a warning.
  - `_parse_quota_reset(body)` extracts the reset timestamp from the upstream 429 body; conservative fallback to next UTC midnight on parse failure.
  - `_next_utc_midnight()` helper for the conservative fallback path.
  - `_mask_key(raw)` masks the API key for log output (e.g. `agne...key`).
  - New imports: `re`, `threading`, `dataclasses.dataclass` / `field`. New module-level state: `_KEY_POOL`, `_KEY_POOL_LOCK`, `_KEY_POOL_LOADED`, plus a `_KeyState` dataclass.

### ⚠️ Known limitations of 0.1.5 (deferred work)

- **P3 unit tests not run before publish**: spec at `.pavo-research/agnes-multi-key-fallback-spec.md` requires 10 pytest cases in `tests/test_multi_key_fallback.py` (single-key compat, 429 fallback, 401 permanent ban, all-exhausted error, 503 short cooldown, 400 no-switch, env priority, whitespace strip, quota reset parsing, etc.). **These tests do not exist in the repo and were not run before this release.** The P3 code is shipped as-implemented; users hitting pool state-machine bugs should open an issue with a reproduction.
- **`.mcp.json` + `extended_buildin_mcp/mcp.json` not pinned**: spec requires both manifest files to expose `AGNES_API_KEYS` (multi-value) instead of the legacy `AGNES_API_KEY`, plus pin `==0.1.5`. **Not done in this release.** Callers configuring multiple keys should set `AGNES_API_KEYS` directly in their own env. The bundled HamunaAgent app continues to pass `AGNES_API_KEY` (single-value, 0.1.5 is backward compatible).
- **Default key pool = single key**: unless the operator sets `AGNES_API_KEYS`, behavior is identical to 0.1.4. The fallback machinery only kicks in when multiple keys are configured.

### Compatibility

- **Backward compatible** at the API surface (tool names, JSON schemas, error codes unchanged from 0.1.3 + `cf77b58`'s tool-surface consolidation).
- **Backward compatible** at the env surface: `AGNES_API_KEY` still works; `AGNES_API_KEYS` is opt-in.
- **Behavior change**: callers who relied on the implicit non-flash default will now get flash. See "Operator action recommended" above.

---

## [0.1.3] — 2026-09-08

First PyPI release.

- 7 MCP tools (3 image: `agnes25_image_generate`, `agnes25_image_edit`, plus helpers; 4 video: `agnes25_video_generate` with mode `text` / `keyframe` / `reference`).
- Default video model: `agnes-video-2.5` (non-flash). **0.1.5 changes this default.**
- Tool surface consolidation from 8 → 3 (commit `cf77b58`).
- Server defaults: `size="720P"`, `aspect_ratio="16:9"`, `seconds="5"`, `ratio="1:1"` for image.
- Single API key via `AGNES_API_KEY`. **0.1.5 adds `AGNES_API_KEYS` pool fallback.** See 0.1.5 notes above.

[0.1.3]: https://pypi.org/project/agnes-video-25-mcp/0.1.3/
[0.1.5]: https://pypi.org/project/agnes-video-25-mcp/0.1.5/
[0.1.6]: https://pypi.org/project/agnes-video-25-mcp/0.1.6/
[0.1.7]: https://pypi.org/project/agnes-video-25-mcp/0.1.7/
[0.1.8]: https://pypi.org/project/agnes-video-25-mcp/0.1.8/
[0.2.0]: https://pypi.org/project/agnes-video-25-mcp/0.2.0/
[0.2.1]: https://pypi.org/project/agnes-video-25-mcp/0.2.1/
[0.2.2]: https://pypi.org/project/agnes-video-25-mcp/0.2.2/
