import { describe, expect, it } from 'vitest';
import {
  GLOBAL_SIDEBAR_DEFAULT_WIDTH,
  GLOBAL_SIDEBAR_MAX_WIDTH,
  GLOBAL_SIDEBAR_MIN_WIDTH,
  normalizeGlobalSidebarWidth,
  parseGlobalSidebarPreference,
} from './globalSidebarPreference';

describe('normalizeGlobalSidebarWidth', () => {
  it('clamps out-of-range widths', () => {
    expect(normalizeGlobalSidebarWidth(10)).toBe(GLOBAL_SIDEBAR_MIN_WIDTH);
    expect(normalizeGlobalSidebarWidth(9999)).toBe(GLOBAL_SIDEBAR_MAX_WIDTH);
  });

  it('keeps in-range widths and rounds fractions', () => {
    expect(normalizeGlobalSidebarWidth(300)).toBe(300);
    expect(normalizeGlobalSidebarWidth(300.6)).toBe(301);
  });

  it('falls back to the default for non-finite input', () => {
    expect(normalizeGlobalSidebarWidth(Number.NaN)).toBe(GLOBAL_SIDEBAR_DEFAULT_WIDTH);
    expect(normalizeGlobalSidebarWidth(Number.POSITIVE_INFINITY)).toBe(GLOBAL_SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('parseGlobalSidebarPreference', () => {
  it('returns defaults for absent or corrupt payloads', () => {
    const fallback = { mode: 'expanded', width: GLOBAL_SIDEBAR_DEFAULT_WIDTH };
    expect(parseGlobalSidebarPreference(null)).toEqual(fallback);
    expect(parseGlobalSidebarPreference('not json')).toEqual(fallback);
    expect(parseGlobalSidebarPreference('null')).toEqual(fallback);
  });

  it('reads mode and clamps width from stored payloads', () => {
    expect(parseGlobalSidebarPreference('{"version":1,"mode":"rail","width":9999}')).toEqual({
      mode: 'rail',
      width: GLOBAL_SIDEBAR_MAX_WIDTH,
    });
    expect(parseGlobalSidebarPreference('{"mode":"bogus","width":"wide"}')).toEqual({
      mode: 'expanded',
      width: GLOBAL_SIDEBAR_DEFAULT_WIDTH,
    });
  });
});
