// Regression guard for the subscription auth-kind allowlist.
//
// The builtin gate and the materializer each used to hard-code
// "host-managed-oauth" as the only kind they accept. When 广电 (nxgd) landed on
// `host-managed-auto-register`, `resolveProviderEnv` learned to materialize it
// but neither allowlist did, so every builtin turn was rejected with
// "Subscription provider 'nxgd' cannot execute in builtin runtime" before a
// single token streamed. Both now read one shared set, and these tests pin the
// kinds apart so the next auth kind cannot silently miss one of them.

import { describe, expect, it, vi } from 'vitest';

import {
  BUILTIN_MATERIALIZABLE_AUTH_KINDS,
  materializeProviderRouteEnv,
  resolveSubscriptionAuthKind,
} from './admin-config';
import type { AdminAppConfig } from './admin-config';

// 广电's bearer comes from the server-side auto-register flow, not from the
// config's api-key store, so it has to be stubbed for materialization.
vi.mock('../nxgd-auth', () => ({
  getNxgdApiKeySync: () => 'nxgd-issued-key',
  preloadNxgdAuth: () => {},
}));

const config = {
  providers: [
    {
      id: 'nxgd',
      name: '广电 (云广智能)',
      type: 'subscription',
      subscriptionAuth: { kind: 'host-managed-auto-register' },
      config: { baseUrl: 'https://ai-models.cloudwasu.cn' },
    },
  ],
} as unknown as AdminAppConfig;

describe('builtin subscription auth allowlist', () => {
  it('classifies 广电 as host-managed-auto-register', () => {
    expect(resolveSubscriptionAuthKind('nxgd', config)).toBe('host-managed-auto-register');
  });

  it('accepts auto-register as builtin-materializable', () => {
    expect(BUILTIN_MATERIALIZABLE_AUTH_KINDS.has('host-managed-auto-register')).toBe(true);
    expect(BUILTIN_MATERIALIZABLE_AUTH_KINDS.has('host-managed-oauth')).toBe(true);
  });

  // The actual regression: this returned undefined, so the turn died with
  // "unavailable or missing an API key" even though 广电's endpoint and its
  // auto-registered key were both resolvable.
  it('materializes a 广电 subscription route into a real ProviderEnv', () => {
    const env = materializeProviderRouteEnv(
      { kind: 'subscription', providerId: 'nxgd', model: 'deepseek-v4-flash-0731' },
      config,
    );

    expect(env).toMatchObject({
      providerId: 'nxgd',
      baseUrl: 'https://ai-models.cloudwasu.cn',
      apiKey: 'nxgd-issued-key',
      authType: 'api_key',
    });
  });

  it('keeps sdk-native, runtime-managed and unknown kinds out of the allowlist', () => {
    // sdk-native rides the 'subscription' sentinel and deliberately gets no
    // base URL / key injection; runtime-managed belongs to an external runtime
    // (Codex / Claude Code). Neither may be handed to the builtin SDK.
    expect(BUILTIN_MATERIALIZABLE_AUTH_KINDS.has('sdk-native')).toBe(false);
    expect(BUILTIN_MATERIALIZABLE_AUTH_KINDS.has('runtime-managed')).toBe(false);
    expect(BUILTIN_MATERIALIZABLE_AUTH_KINDS.has(undefined)).toBe(false);
  });
});
