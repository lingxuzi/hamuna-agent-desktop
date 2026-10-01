import { describe, expect, it } from 'vitest';

import { projectPromptCacheBreakpoint } from './cache-semantics';

describe('projectPromptCacheBreakpoint — bridge cache_control projection', () => {
  it('returns undefined when projection is disabled', () => {
    expect(projectPromptCacheBreakpoint(false, { type: 'ephemeral' })).toBeUndefined();
  });

  it('returns undefined when cacheControl is absent', () => {
    expect(projectPromptCacheBreakpoint(true, undefined)).toBeUndefined();
    expect(projectPromptCacheBreakpoint(true, null)).toBeUndefined();
  });

  it('returns undefined when cacheControl.type is not ephemeral', () => {
    expect(projectPromptCacheBreakpoint(true, { type: '5m' as 'ephemeral' })).toBeUndefined();
  });

  it('returns { mode: "explicit" } when enabled and cache_control is ephemeral', () => {
    expect(projectPromptCacheBreakpoint(true, { type: 'ephemeral' }))
      .toEqual({ mode: 'explicit' });
    // ttl is preserved on the input side but deliberately NOT projected —
    // OpenAI Responses wire only carries the mode discriminator.
    expect(projectPromptCacheBreakpoint(true, { type: 'ephemeral', ttl: '5m' }))
      .toEqual({ mode: 'explicit' });
  });

  it('treats null cache_control identically to absent', () => {
    expect(projectPromptCacheBreakpoint(true, null)).toBeUndefined();
  });
});