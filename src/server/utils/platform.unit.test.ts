import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSkillBlockedOnPlatform } from './platform';

describe('skill platform blocks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the Windows-only agent-browser block without affecting required skills', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    expect(isSkillBlockedOnPlatform('agent-browser')).toBe(true);
    expect(isSkillBlockedOnPlatform('hamuna-memory-update')).toBe(false);
    expect(isSkillBlockedOnPlatform('hamuna-memory-gardener')).toBe(false);
    expect(isSkillBlockedOnPlatform('hamuna-memory-molt')).toBe(false);
    expect(isSkillBlockedOnPlatform('hamuna-cli')).toBe(false);
    expect(isSkillBlockedOnPlatform('hamuna-docs')).toBe(false);
  });

  it('does not block agent-browser on macOS', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

    expect(isSkillBlockedOnPlatform('agent-browser')).toBe(false);
  });
});
