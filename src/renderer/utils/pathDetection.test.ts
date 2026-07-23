import { describe, expect, it } from 'vitest';

import { shortenPathForDisplay } from '@/utils/pathDetection';

describe('shortenPathForDisplay', () => {
  it('shortens macOS and Windows user profile paths', () => {
    expect(shortenPathForDisplay('/Users/zhihu/Documents/project/HamunaAgent')).toBe('~/Documents/project/HamunaAgent');
    expect(shortenPathForDisplay('C:\\Users\\zhihu\\Documents\\project\\HamunaAgent')).toBe('~/Documents/project/HamunaAgent');
    expect(shortenPathForDisplay('D:/Users/zhihu/work/HamunaAgent')).toBe('~/work/HamunaAgent');
  });

  it('keeps non-user paths unchanged', () => {
    expect(shortenPathForDisplay('/opt/HamunaAgent')).toBe('/opt/HamunaAgent');
  });
});
