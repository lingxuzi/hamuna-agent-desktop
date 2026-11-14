import { beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYWRIGHT_FALLBACK_THRESHOLD,
  getConsecutiveBrowserFailures,
  isPlaywrightFallbackUnlocked,
  recordEmbeddedBrowserOutcome,
  resetEmbeddedBrowserQuota,
} from './embedded-browser-quota';

describe('embedded browser quota', () => {
  beforeEach(() => resetEmbeddedBrowserQuota());

  it('unlocks Playwright only after N consecutive failures', () => {
    for (let i = 1; i < PLAYWRIGHT_FALLBACK_THRESHOLD; i++) {
      recordEmbeddedBrowserOutcome(false);
      expect(isPlaywrightFallbackUnlocked()).toBe(false);
    }
    recordEmbeddedBrowserOutcome(false);
    expect(isPlaywrightFallbackUnlocked()).toBe(true);
  });

  it('resets the streak on any success', () => {
    recordEmbeddedBrowserOutcome(false);
    recordEmbeddedBrowserOutcome(false);
    recordEmbeddedBrowserOutcome(true);
    expect(getConsecutiveBrowserFailures()).toBe(0);
    expect(isPlaywrightFallbackUnlocked()).toBe(false);
  });

  it('does not unlock from scattered failures', () => {
    // The rule is CONSECUTIVE: two failures then a success never accumulates.
    for (let i = 0; i < 5; i++) {
      recordEmbeddedBrowserOutcome(false);
      recordEmbeddedBrowserOutcome(false);
      recordEmbeddedBrowserOutcome(true);
    }
    expect(isPlaywrightFallbackUnlocked()).toBe(false);
  });
});
