# Changelog · agnes-video-25-mcp

All notable changes are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Package: `agnes-video-25-mcp` · PyPI: https://pypi.org/project/agnes-video-25-mcp/ · Source vendor: `hosted_mcps/agnes-video-25/` in hamuna-agent-desktop.

---

## [0.2.5] — 2026-09-27

### Changed

- **`agnes25_video_generate` is now submit-only** (was submit + wait + download):
  - The tool no longer takes `timeout_seconds` / `poll_interval_seconds` /
    `download` / `output_filename`. All input parameters are the submit
    stage only (`prompt` / `model` / `mode` / `seconds` / `size` /
    `aspect_ratio` / `seed` / `first_frame` / `last_frame` / `images` /
    `audios` / `videos`).
  - Response shape on success: `{ok, video_id, model_id, submit_key_masked,
    task_id, status, progress?, seconds?, size?, created_at?}`. On failure:
    unchanged `{ok: false, error: {code, message, details}}`.
  - Implementation reuses the existing `_submit_impl` (which has always
    been submit-only internally); the MCP tool no longer wraps it in
    `_generate_impl`. Internal `_submit_impl` / `_wait_impl` /
    `_generate_impl` are unchanged and remain available for in-process use.
  - **Breaking change** for callers that relied on `video_generate` to
    return `local_path` / `video_url`. Migrate to the two-step
    submit + query pattern with `agnes25_video_query`. For an "eager"
    single-call experience, call `agnes25_video_generate` then poll
    `agnes25_video_query` in a loop until `status == "completed"`, then
    call `agnes25_video_query(video_id, download=True, ...)` to fetch
    the file.

- **New `agnes25_video_query` tool** (poll / status / optional download):
  - Inputs: `video_id` (required), `model` (default `DEFAULT_MODEL`),
    `force_key_masked` (optional), `download` (default `False`),
    `output_filename` (optional), `include_raw` (default `False`).
  - Reuses existing `_status_impl` (which already accepts
    `force_key_masked` since 0.2.4 for poll-after-submit stickiness).
  - When `download=True` and `status == "completed"`, the video is saved
    to `AGNES_OUTPUT_DIR/videos/` (or `output_filename` if provided) and
    the result includes `local_path`. `download` is opt-in (default
    `False`) so most callers poll until `status == "completed"` and only
    then call again with `download = True`, or fetch `video_url` directly.

### Why masked key on submit, not raw

- `submit_key_masked` is the masked form of the key that submitted the
  task (`agne...cdef` shape, from `_mask_key()`). 0.1.5+ ships this
  exact helper; raw keys have never crossed the MCP boundary.
- Callers MUST forward the masked value back to
  `agnes25_video_query(force_key_masked=...)` — the upstream scopes
  tasks to the submitting key, and round-robin on poll would 404. The
  masked value round-trips through `_status_impl` → `_request_json`
  forced-mode resolution, which looks up the masked key in the local
  pool and binds the request to that raw key.
- Callers who do not pass `force_key_masked` get round-robin
  selection — fine when the pool has only one key, but
  `forced_key_unavailable` is the contract for "you passed a masked
  value that isn't in the local pool anymore" (key rotated out via
  `AGNES_API_KEYS` change since the submit).

### Compatibility

- Backward compatible with 0.2.4 at the **server** level:
  - `_submit_impl` / `_wait_impl` / `_status_impl` /
    `_generate_impl` are unchanged.
  - The MCP tool surface gains one new tool (`agnes25_video_query`)
    and loses four parameters from `agnes25_video_generate`
    (`timeout_seconds`, `poll_interval_seconds`, `download`,
    `output_filename`). MCP clients that strictly typed those four
    parameters will see schema-validation errors on the next call —
    migrate them.
  - Key pool state file format is unchanged.

### Tests

- `tests/test_v0_2_5_submit_query_split.py` — 8 self-checks covering:
  - `generate_returns_video_id_model_id_masked_key` — submit-only contract.
  - `generate_no_wait_no_download` — confirms `local_path` is not in the
    submit result and no `time.sleep` fires during the submit call.
  - `query_uses_force_key_masked_for_stickiness` — submit with key-A,
    query with key-A's masked form, asserts Authorization header matches.
  - `query_without_force_key_masked_uses_round_robin` — query without
    `force_key_masked` lets `_pick_key()` select from the pool (this
    is the path that 0.2.4 was designed to fix, but here we document
    it as the explicit "user opted out of stickiness" path).
  - `query_with_wrong_masked_key_returns_forced_key_unavailable` — masking
    mismatch surfaces the existing error code from 0.2.4.
  - `query_download_saves_to_disk` — `download=True` + completed status
    populates `local_path`.
  - `query_download_skipped_when_status_not_completed` — `download=True`
    on a still-processing task does NOT save and surfaces a clear
    `download_error` (`task_not_completed`).
  - `generate_then_query_round_trip` — submit + query in sequence with
    the masked key round-trips through the existing 0.2.4 forced-key
    path.
- Total: 8 self-check(s) pass; 0 skipped.
- Existing `test_v0_2_4_submit_poll_stickiness.py` (7) + 6 cooldown + 4
  round-robin + 14 image paths + 19 video refs + 42 v2 model assertions
  pass unchanged.

### Migration

| Old (0.2.4) | New (0.2.5) |
|---|---|
| `video_generate(prompt, ..., timeout_seconds=300, download=True)` | `submit = video_generate(prompt, ...)` |
| | `while True:` |
| | `  s = video_query(submit["video_id"], force_key_masked=submit["submit_key_masked"])` |
| | `  if s["status"] == "completed": break` |
| | `  time.sleep(5)` |
| | `final = video_query(submit["video_id"], force_key_masked=..., download=True)` |

---

## [0.2.4] — 2026-09-24

### Fixed

- **Poll-after-submit stickiness** (`_request_json(force_key_masked=...)`):
  0.1.6+ used `_pick_key()` round-robin to pick a fresh key on every API call.
  Agnes upstream **scopes tasks to the key that created them**: submit with
  key A → poll with key B returns 404 "任务不存在". With multiple keys in
  `AGNES_API_KEYS`, the round-robin makes poll pick a different key ~90% of
  the time, breaking every video_generate call after the first submit per
  process.

  - `_submit_impl` now calls `_pick_key()` once, hands the masked key to
    `_request_json(force_key_masked=...)` for the POST, and stashes the
    masked key in the submit result under `_submit_key_masked`.
  - `_wait_impl` / `_status_impl` accept `force_key_masked` and forward it to
    `_request_json`. `_request_json` honors the override on the first attempt
    only (so 401/429/503 fallback machinery still works if the forced key is
    unhealthy), then resumes round-robin.
  - Poll path picks up `_submit_key_masked` from the submit result and uses
    the same key for every poll iteration until status completes/fails.

- **Submit 503 retry loop** (`_submit_impl(submit_503_retries=10, submit_503_retry_seconds=5.0)`):
  upstream `503 video_queue_full` was treated as terminal: the call failed
  immediately, even though 5-10 seconds later the queue might have drained.
  Now retries up to 10 times with 5s backoff on `503` only. Other status
  codes (400/401/404/429) keep their existing semantics — **429 still flows
  through cooldown + key rotation** per the 0.1.6 multi-key spec, no retry.

### Added

- **Poll fallback to `/v1/videos/{id}`** (open question for upstream):
  when `/agnesapi` returns 404, the status poller now tries two OpenAI-style
  paths before giving up: `/v1/videos/{task_id}` and `/v1/videos/{bare-hash}`
  (with `task_` prefix stripped). The fallback status codes are folded into
  the error message so MCP clients can see which alt paths were tried.
  **Status: tentative** — verified path existence with dummy key (returns
  401, not 404) but not validated end-to-end against the real upstream.

### Compatibility

- Backward compatible with 0.2.3 — no schema change, no public tool surface
  change, no environment variable change.
- `_pick_key()` algorithm is unchanged (still round-robin on healthy keys).
- `_request_json` now accepts a new keyword-only `force_key_masked` param
  defaulting to `None`; existing non-forced callers behave identically.
- `_submit_impl` / `_wait_impl` / `_status_impl` accept the new keyword-only
  `force_key_masked` (defaults `None`); existing internal callers pass it
  through automatically.
- **`_request_json` semantics change in forced mode**: when `force_key_masked`
  resolves to a healthy key, the function attempts **only** that key and
  surfaces every non-success status code to the caller. No multi-key fallback
  rotation, no cooldown marking. This is what lets `_submit_impl`'s 503
  retry loop re-attempt the same key after backoff (the old behavior marked
  the key into 60s 503 cooldown on the first attempt, leaving a single-key
  pool permanently exhausted). Non-forced calls keep the existing 401/429
  multi-key fallback behavior (401 permanent ban + 429 30s-window reason
  split + key rotation).
- New error code `forced_key_unavailable` — returned when a caller pins a
  key that's currently in cooldown or no longer in the pool.
- Existing 6 cooldown self-checks + 4 round-robin self-checks + 14 image
  paths + 19 video refs + 42 v2 model assertions pass unchanged.

### Tests

- New `tests/test_v0_2_4_submit_poll_stickiness.py` — 7 self-checks covering
  the three fixes:

  | # | Check | Covers |
  |---|-------|--------|
  | 1 | `submit_then_status_uses_same_key` | Fix 1: submit key reuse on first poll |
  | 2 | `wait_loop_keeps_submit_key_across_polls` | Fix 1: key stays pinned across multi-poll wait |
  | 3 | `submit_retries_on_503_then_succeeds` | Fix 2: 503 retry → eventual 200, key NOT marked |
  | 4 | `submit_does_not_retry_on_429` | Fix 2: 429 still flows through cooldown / rotation, no submit retry |
  | 5 | `submit_gives_up_after_max_503_retries` | Fix 2: hard cap after `submit_503_retries` attempts |
  | 6 | `status_falls_back_to_v1_videos_when_agnesapi_404s` | Fix 3: 404 → `/v1/videos/{id}` fallback succeeds |
  | 7 | `status_reports_fallback_in_error_when_all_paths_404` | Fix 3: all-404 surfaces `Fallback tried:` summary |

  Total: 7 self-check(s) pass; 0 skipped.

---

## [0.2.3] — 2026-09-21

### Added

- **Round-robin first-key selection** (`_pick_key`):
  0.1.6 always picked `_KEY_POOL[0]` first, then fell through to the next key
  only on 401/429/503. That meant with N equal-grade keys, the first key
  burned its 429 quota headroom alone before the fallback kicked in.
  0.2.3 rotates the first pick across all healthy (non-cooldown) keys so
  quota burn is spread evenly upfront; the fallback chain on 401/429/503
  (cooldown + 30s-window reason split) is **unchanged** — it still drives
  the post-failure side.

  - New module-level counter `_KEY_ROUND_ROBIN_COUNTER` (absolute int,
    NOT modulo-wrapped — see "Persistence" below).
  - Selection algorithm: snapshot `healthy = [k for k in _KEY_POOL if k.disabled_until <= now]`,
    pick `healthy[counter % len(healthy)]`, advance counter by 1.
  - Counter is persisted to `~/.hamuna/state/agnes-key-pool.json` under
    the top-level key `_round_robin_counter` (alongside the per-key
    cooldown / last_429_at / consecutive_failures dicts from 0.1.6).
    Old state files without the field are read as counter=0
    (backward compatible).
  - Cooldown-complete keys still get their `last_429_at` refreshed
    on the first pick after cooldown expires (unchanged from 0.1.6).
  - Cooldown (disabled) keys are skipped from the `healthy` pool —
    if all keys are in cooldown, `_pick_key` returns `None` and the
    caller surfaces `all_keys_exhausted` (unchanged from 0.1.6).

### Persistence

- **Counter is absolute, not modulo-wrapped** — a process restart reads the
  persisted counter and resumes from there. Modulo only happens at the read
  site (`counter % len(healthy)`). Trade-off: Python int grows without bound,
  but a 64-bit signed int overflows at ~9e18 picks (~285 years at 100 req/s),
  which is not a real concern.
- **Counter is persisted on the same trigger as cooldown state** — every
  `_pick_key()` call that advances the counter AND every `_mark_disabled()`
  call that writes cooldown state writes both atomically (single tmp+replace
  on the same JSON file). `_persist_state()` writes both via one shot.

### Compatibility

- Backward compatible with 0.2.2 — no schema change, no public surface change,
  no API / tool signature change. Only `_pick_key()`'s internal selection
  policy is new.
- State file format extended with one top-level field (`_round_robin_counter`).
  Old 0.1.6-0.2.2 state files are read transparently (missing field → counter=0;
  the per-key cooldown dicts are unchanged).
- Existing 6 cooldown self-checks (test_first_429_uses_quota_429_reason /
  test_30s_window_second_429_promotes_to_consecutive / test_outside_30s_window_resets_reason /
  test_pick_key_refreshes_after_cooldown / test_state_persists_across_calls /
  test_load_merges_future_disabled_only) pass unchanged — the round-robin
  layer is additive above the cooldown state machine.

### Tests

- `tests/test_key_pool_cooldown.py`: added 4 round-robin self-checks
  (cycles_through_healthy_keys / skips_cooldown_keys /
  counter_persists_across_load / mixed_health_after_one_disables). Total
  10/10 pass.

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
[0.2.3]: https://pypi.org/project/agnes-video-25-mcp/0.2.3/
[0.2.4]: https://pypi.org/project/agnes-video-25-mcp/0.2.4/
[0.2.5]: https://pypi.org/project/agnes-video-25-mcp/0.2.5/
