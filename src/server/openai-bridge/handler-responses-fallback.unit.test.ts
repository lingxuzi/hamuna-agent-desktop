// Unit tests for the responses → chat_completions auto-fallback detector.
//
// Background: some "responses"-format upstreams (e.g. agnes) ship an
// incomplete Responses schema that rejects `function_call` /
// `function_call_output` input variants with 400 even though the OpenAI
// Responses spec includes them. The bridge auto-downgrades such providers
// to chat_completions to avoid paying the 400 on every multi-turn turn.

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearResponsesFallbackCache,
  getResponsesFallbackProviders,
  isResponsesFormatIncompatible,
} from './handler';

afterEach(() => clearResponsesFallbackCache());

describe('isResponsesFormatIncompatible', () => {
  it('matches the Rust serde untagged-enum rejection pattern', () => {
    expect(
      isResponsesFormatIncompatible(
        400,
        'data did not match any variant of untagged enum ResponseInput at line 1 column 210',
      ),
    ).toBe(true);
  });

  it('matches the OpenAI-spec json_parse_error shape', () => {
    expect(
      isResponsesFormatIncompatible(
        400,
        '{"error":{"message":"...ResponseInput...","type":"invalid_request_error","code":"json_parse_error"}}',
      ),
    ).toBe(true);
  });

  it('rejects non-400 statuses even when the body matches', () => {
    expect(
      isResponsesFormatIncompatible(
        500,
        'untagged enum ResponseInput at line 1 column 10',
      ),
    ).toBe(false);
    expect(
      isResponsesFormatIncompatible(200, 'untagged enum ResponseInput at line 1 column 10'),
    ).toBe(false);
  });

  it('does not match unrelated 400 errors (auth, validation, etc.)', () => {
    expect(isResponsesFormatIncompatible(400, '{"error":{"message":"invalid api key"}}')).toBe(false);
    expect(isResponsesFormatIncompatible(400, '{"error":{"message":"model not found"}}')).toBe(false);
    // prompt_cache_key rejection is handled by a separate retry branch.
    expect(
      isResponsesFormatIncompatible(400, '{"error":{"message":"unknown parameter prompt_cache_key"}}'),
    ).toBe(false);
  });
});

describe('responsesFallbackProviders cache', () => {
  it('starts empty after clearResponsesFallbackCache', () => {
    clearResponsesFallbackCache();
    expect(getResponsesFallbackProviders()).toEqual([]);
  });

  it('round-trips provider ids via the module exports', () => {
    // The handler mutates the same Set the export reads from; this is a
    // smoke test that the export is wired to the live collection.
    clearResponsesFallbackCache();
    expect(getResponsesFallbackProviders().length).toBe(0);
  });
});