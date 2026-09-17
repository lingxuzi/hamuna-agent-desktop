import { describe, expect, it } from 'vitest';

import {
  isRequiredSystemSkill,
  REQUIRED_SYSTEM_SKILLS,
  withoutRequiredSystemSkills,
} from './systemSkills';

describe('required system skill contract', () => {
  it('contains exactly the five product-required global skills', () => {
    expect(REQUIRED_SYSTEM_SKILLS).toEqual([
      'hamuna-memory-update',
      'hamuna-memory-gardener',
      'hamuna-memory-molt',
      'hamuna-cli',
      'hamuna-docs',
    ]);
    for (const name of REQUIRED_SYSTEM_SKILLS) {
      expect(isRequiredSystemSkill(name)).toBe(true);
    }
    expect(isRequiredSystemSkill('prompt-writer')).toBe(false);
  });

  it('removes required and malformed entries without disturbing optional disabled skills', () => {
    expect(withoutRequiredSystemSkills([
      'hamuna-cli',
      'prompt-writer',
      null,
      'hamuna-docs',
      'user-skill',
    ])).toEqual(['prompt-writer', 'user-skill']);
  });
});
