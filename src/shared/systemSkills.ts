/** Version shared with Rust's SYSTEM_SKILLS_VERSION contract. */
export const SYSTEM_SKILLS_VERSION = '55';

/**
 * Re-export the generated SYSTEM_SKILLS list. The list itself is derived
 * from `bundled-skills/<name>/SKILL.md` by
 * `scripts/generate-system-skills.mjs`, invoked via the
 * `prebuild:server` / `prebuild:web` / `pretest` / `prelint` npm hooks and
 * `src-tauri/build.rs` (bare-cargo fallback). Both
 * `src-tauri/src/system_skills.generated.rs` and the file below are
 * regenerated before every build/test/lint pass, so the Rust
 * `const SYSTEM_SKILLS: &[&str]` and this TS list cannot drift.
 *
 * To add a system skill: drop a directory with SKILL.md into
 * `bundled-skills/`. To remove: delete its directory — the orphan cleanup
 * pass on next launch hard-deletes the user's copy from
 * `~/.hamuna/skills/`.
 */
export { SYSTEM_SKILLS, type SystemSkillName } from './systemSkills.generated';

/**
 * Product-owned skills that are part of HamunaAgent' always-available runtime
 * contract.
 *
 * These cannot be disabled as ordinary user skills. The memory skills back
 * managed workflows, while hamuna-cli and hamuna-docs are the product's
 * baseline operation and product-knowledge surfaces.
 */
export const REQUIRED_SYSTEM_SKILLS = [
  'hamuna-memory-update',
  'hamuna-memory-gardener',
  'hamuna-memory-molt',
  'hamuna-cli',
  'hamuna-docs',
] as const;

export type RequiredSystemSkill = typeof REQUIRED_SYSTEM_SKILLS[number];

const REQUIRED_SYSTEM_SKILL_SET = new Set<string>(REQUIRED_SYSTEM_SKILLS);

export function isRequiredSystemSkill(name: string): name is RequiredSystemSkill {
  return REQUIRED_SYSTEM_SKILL_SET.has(name);
}

/** Canonicalize persisted disabled names so required contracts stay enabled. */
export function withoutRequiredSystemSkills(names: readonly unknown[]): string[] {
  return names.filter((name): name is string => (
    typeof name === 'string' && !isRequiredSystemSkill(name)
  ));
}
