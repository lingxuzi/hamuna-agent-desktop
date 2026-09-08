# Changelog · agnes-video-25-mcp

All notable changes are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Package: `agnes-video-25-mcp` · PyPI: https://pypi.org/project/agnes-video-25-mcp/ · Source vendor: `hosted_mcps/agnes-video-25/` in hamuna-agent-desktop.

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
