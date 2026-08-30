import { describe, expect, it } from 'vitest';

import { evaluateSkillReload } from './skill-reload';

describe('evaluateSkillReload', () => {
  it('needsRestart=false when the reloaded registry contains the expected skill', () => {
    expect(evaluateSkillReload('my-skill', true, ['compact', 'my-skill'])).toEqual({
      needsRestart: false,
    });
  });

  it('needsRestart=true when the reloaded registry does NOT contain the expected skill', () => {
    expect(evaluateSkillReload('my-skill', true, ['compact'])).toEqual({
      needsRestart: true,
    });
  });

  it('needsRestart=true when no live session reloaded (still the startup snapshot)', () => {
    expect(evaluateSkillReload('my-skill', false, [])).toEqual({
      needsRestart: true,
    });
  });

  it('needsRestart=false when no expected skill was requested (caller has nothing to prove)', () => {
    expect(evaluateSkillReload(undefined, false, [])).toEqual({
      needsRestart: false,
    });
  });
});
