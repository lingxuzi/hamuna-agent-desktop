import { describe, expect, it } from 'vitest';

import { evaluateSkillReload, evaluateSkillReloadForMiniApp } from './skill-reload';

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

describe('evaluateSkillReloadForMiniApp', () => {
  it('returns needsRestart=false when no skills are declared', () => {
    expect(evaluateSkillReloadForMiniApp([], true, [])).toEqual({
      needsRestart: false,
      missing: [],
    });
  });

  it('returns missing=[] and needsRestart=false when all declared skills loaded', () => {
    expect(
      evaluateSkillReloadForMiniApp(
        ['icon-design', 'compaction'],
        true,
        ['icon-design', 'compaction', 'other'],
      ),
    ).toEqual({ needsRestart: false, missing: [] });
  });

  it('lists missing skills and surfaces needsRestart when subset is partial', () => {
    expect(
      evaluateSkillReloadForMiniApp(
        ['icon-design', 'compaction'],
        true,
        ['compaction'],
      ),
    ).toEqual({ needsRestart: true, missing: ['icon-design'] });
  });

  it('treats reloaded=false as needsRestart with every declared skill missing', () => {
    expect(
      evaluateSkillReloadForMiniApp(
        ['icon-design', 'compaction'],
        false,
        [],
      ),
    ).toEqual({ needsRestart: true, missing: ['icon-design', 'compaction'] });
  });
});
