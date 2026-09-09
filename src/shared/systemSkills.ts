/** Version shared with Rust's SYSTEM_SKILLS_VERSION contract. */
export const SYSTEM_SKILLS_VERSION = '51';

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
