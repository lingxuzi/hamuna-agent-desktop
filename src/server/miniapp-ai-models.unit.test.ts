// `app.ai.getModels` — the author-facing "what models can I use" call.
//
// `listMiniAppAiModels` had zero coverage: real v8 coverage put
// `miniapp-ai.ts` at 72.5% lines, and this whole function (12 statements) was
// among the never-executed ones. It is the only MiniApp AI method whose result
// an author reads *before* writing any code against it, so its envelope shape
// is a real contract, not an implementation detail.
//
// The function deliberately delegates to `provider-verify.ts::
// fetchSdkSupportedModels` rather than reading config itself — that list
// already knows about subscription OAuth, third-party providers and the
// OpenAI bridge, and a second implementation would drift. This test therefore
// also pins "we reuse theirs": a provider-verify failure has to surface as a
// MiniApp error envelope, not as a thrown rejection that would 500 the call.

import { describe, expect, it, vi } from 'vitest';

const fetchSdkSupportedModels = vi.fn();

vi.mock('./provider-verify', () => ({
  fetchSdkSupportedModels: () => fetchSdkSupportedModels(),
}));

const { listMiniAppAiModels } = await import('./miniapp-ai');

const MODELS = [
  { value: 'model-a', displayName: 'Model A', description: 'first' },
  { value: 'model-b', displayName: 'Model B', description: 'second' },
];

describe('app.ai.getModels', () => {
  it('returns the plain value list plus a display list from the same source', async () => {
    fetchSdkSupportedModels.mockResolvedValueOnce(MODELS);
    const outcome = await listMiniAppAiModels();

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({
      models: ['model-a', 'model-b'],
      display: [
        { value: 'model-a', displayName: 'Model A' },
        { value: 'model-b', displayName: 'Model B' },
      ],
    });
  });

  it('keeps an empty catalogue as an empty ok, not an error', async () => {
    // No provider configured yet is a normal state, not a failure — the author
    // should see an empty dropdown rather than a red error.
    fetchSdkSupportedModels.mockResolvedValueOnce([]);
    const outcome = await listMiniAppAiModels();
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ models: [], display: [] });
  });

  it('converts a provider-verify failure into an error envelope', async () => {
    fetchSdkSupportedModels.mockRejectedValueOnce(new Error('no provider configured'));
    const outcome = await listMiniAppAiModels();
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('HOST_ERROR');
    expect(outcome.error?.message).toMatch(/no provider configured/);
  });

  it('stringifies a non-Error rejection instead of losing it', async () => {
    fetchSdkSupportedModels.mockRejectedValueOnce('bridge died');
    const outcome = await listMiniAppAiModels();
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.message).toBe('bridge died');
  });
});
