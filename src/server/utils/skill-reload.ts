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
