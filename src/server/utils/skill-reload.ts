/**
 * Skill-reload result evaluation — pure, so unit-testable without importing
 * the heavyweight agent-session module graph.
 *
 * The builtin SDK only scans `.claude/skills/` at process startup (or on an
 * explicit `reloadSkills()` control request). After a mid-session skill
 * install, callers want to know whether the live session will recognize the
 * new slash command immediately or whether the user must restart.
 */

export type SkillReloadResult = {
  /** Whether a live SDK session was reloaded (false = no session yet, or not this workspace). */
  reloaded: boolean;
  /** Names of skill commands present after reload (SDK response). */
  loaded: string[];
  /** True when the expected skill did NOT show up — the caller should surface a needs-restart hint. */
  needsRestart: boolean;
};

/** Pure evaluation of a reloadSkills response vs the expected skill name. */
export function evaluateSkillReload(
  expectedSkill: string | undefined,
  reloaded: boolean,
  loaded: string[],
): { needsRestart: boolean } {
  if (!expectedSkill) return { needsRestart: false };
  if (!reloaded) return { needsRestart: true };
  return { needsRestart: !loaded.some(name => name === expectedSkill) };
}

/**
 * Phase 2 (PRD v0.4 §B.3) — MiniApp-specific skill reload helper.
 *
 * Distinct from `evaluateSkillReload` because MiniApp skill reload operates
 * over a **subset** of skills declared in `meta.json.skills`, not a single
 * expected skill. The MiniApp Sidecar's session context keeps the global
 * skill list (loaded for the originating Chat workspace) untouched; only
 * the MiniApp-specific subset is reloaded.
 *
 * Returns a `needsRestart` hint when at least one declared skill failed to
 * load — the renderer surfaces a "restart MiniApp" affordance rather than
 * silently offering a broken slash command.
 */
export function evaluateSkillReloadForMiniApp(
  declaredSkills: readonly string[],
  reloaded: boolean,
  loaded: readonly string[],
): { needsRestart: boolean; missing: string[] } {
  if (declaredSkills.length === 0) return { needsRestart: false, missing: [] };
  if (!reloaded) return { needsRestart: true, missing: [...declaredSkills] };
  const loadedSet = new Set(loaded);
  const missing = declaredSkills.filter((name) => !loadedSet.has(name));
  return { needsRestart: missing.length > 0, missing };
}

/** Phase 2 — cap MiniApp skill declarations so a malicious `meta.json` can't
 *  bloat the Sidecar's prompt context (CLAUDE.md §Pit-of-Success YAGNI).
 */
export const MINIAPP_MAX_SKILLS = 5;
