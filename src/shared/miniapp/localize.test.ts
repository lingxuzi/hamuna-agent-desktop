import { describe, expect, it } from 'vitest';

import { localizeMiniApp } from './localize';

const META = {
  name: '五子棋',
  description: '经典 15×15 棋盘',
  tags: ['游戏'],
  i18n: {
    locales: {
      'zh-CN': { name: '五子棋', description: '经典 15×15 棋盘' },
      'en-US': { name: 'Gomoku', description: 'Classic 15x15 board', tags: ['game'] },
      'zh-TW': { name: '五子棋' },
    },
  },
};

describe('localizeMiniApp', () => {
  it('returns the top-level strings when the app declares no i18n', () => {
    const r = localizeMiniApp({ name: 'X', description: 'Y' }, 'en-US');
    expect(r).toEqual({ name: 'X', description: 'Y' });
  });

  it('picks the exact locale', () => {
    expect(localizeMiniApp(META, 'en-US').name).toBe('Gomoku');
  });

  it('falls back a Chinese variant to zh-CN, not to en-US', () => {
    // zh-HK has no table; the user still reads Chinese, so zh-CN beats English.
    expect(localizeMiniApp(META, 'zh-HK').description).toBe('经典 15×15 棋盘');
  });

  it('prefers an exact regional table over the bare language', () => {
    expect(localizeMiniApp(META, 'zh-TW').name).toBe('五子棋');
  });

  it('falls back to en-US for a locale with no entry at all', () => {
    expect(localizeMiniApp(META, 'ja-JP').name).toBe('Gomoku');
  });

  it('merges per field rather than per locale', () => {
    // zh-TW declares only a name; the description must still come from
    // somewhere useful rather than rendering empty.
    const r = localizeMiniApp(META, 'zh-TW');
    expect(r.name).toBe('五子棋');
    expect(r.description).toBe('经典 15×15 棋盘');
    expect(r.tags).toEqual(['游戏']);
  });

  it('prefers translated tags over top-level ones', () => {
    expect(localizeMiniApp(META, 'en-US').tags).toEqual(['game']);
  });

  it('uses the first declared locale when none of the chain matches', () => {
    const jaOnly = {
      name: 'A',
      description: 'B',
      i18n: { locales: { 'ja-JP': { name: 'あ' } } },
    };
    expect(localizeMiniApp(jaOnly, 'en-US').name).toBe('あ');
  });

  it('treats an empty locale table as no i18n at all', () => {
    const r = localizeMiniApp({ ...META, i18n: { locales: {} } }, 'en-US');
    expect(r.name).toBe('五子棋');
  });

  it('falls back to the top level when the locale is undefined', () => {
    expect(localizeMiniApp(META, undefined).description).toBe('经典 15×15 棋盘');
  });
});
