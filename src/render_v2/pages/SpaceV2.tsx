/**
 * SpaceV2 — v2 renderer Space page ([final] IlVr6, 项目管理 Linear 流式 Issue 台).
 *
 * No re-write: the shipped `src/renderer/pages/Space.tsx` orchestration already
 * implements the exact IlVr6 layout — 256px SpaceSidebar, warm-accent toolbar
 * (search / status segmented / goal select / related-to-me / new / refresh),
 * Linear-style issue rows with three-color status pills. Its theme tokens
 * (`--accent-warm`, `--accent-warm-subtle`, `--paper-elevated`) already match
 * the Pencil `$accent-warm`-family variables (verified against the frame dump).
 *
 * Re-exporting keeps a single source of truth for the Space state machine
 * (auth polling, event sync, six dialogs) — v1 and v2 render the same page,
 * so there is nothing to drift.
 */
export { default } from '@/pages/Space';
