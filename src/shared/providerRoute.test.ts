import { describe, expect, it } from 'vitest';
import type { Provider } from './config-types';
import { SUBSCRIPTION_PROVIDER_ID, XAI_SUBSCRIPTION_PROVIDER_ID } from './config-types';
import {
  getCredentialConfiguredProviderCandidates,
  hasProviderRouteCredential,
  isConcreteProviderRoute,
  isProviderRouteModelMismatch,
  resolveFrozenProviderIdentity,
  resolveLegacyModelOnlyProviderRoute,
} from './providerRoute';

function provider(
  id: string,
  models: string[],
  type: Provider['type'] = 'api',
  enabled = true,
): Provider {
  return {
    id,
    name: id,
    vendor: id,
    cloudProvider: id,
    type,
    primaryModel: models[0] ?? 'model',
    isBuiltin: true,
    enabled,
    config: {},
    models: models.map(model => ({
      model,
      modelName: model,
      modelSeries: model,
    })),
  };
}

describe('provider route credential candidates', () => {
  it('matches legacy model-only sessions only against API providers with configured keys', () => {
    const providers = [
      provider('no-key', ['shared-model']),
      provider('with-key', ['shared-model']),
      provider('other-model', ['other-model']),
    ];

    expect(getCredentialConfiguredProviderCandidates(providers, 'shared-model', {
      apiKeys: { 'with-key': 'secret', 'other-model': 'secret' },
    }).map(candidate => candidate.id)).toEqual(['with-key']);
  });

  it('does not treat blank API keys as credentials', () => {
    expect(hasProviderRouteCredential(provider('blank', ['m']), {
      apiKeys: { blank: '   ' },
    })).toBe(false);
  });

  it('does not exclude disabled providers from credential-configured legacy candidates', () => {
    const providers = [
      provider('disabled-with-key', ['shared-model'], 'api', false),
    ];

    expect(getCredentialConfiguredProviderCandidates(providers, 'shared-model', {
      apiKeys: { 'disabled-with-key': 'secret' },
    }).map(candidate => candidate.id)).toEqual(['disabled-with-key']);
  });

  it('treats Anthropic subscription account evidence as credential-configured even without a live valid status', () => {
    const sub = provider(SUBSCRIPTION_PROVIDER_ID, ['claude-sonnet-4-6'], 'subscription');

    expect(hasProviderRouteCredential(sub, {
      verifyStatus: {
        [SUBSCRIPTION_PROVIDER_ID]: {
          status: 'invalid',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          accountEmail: 'user@example.com',
        },
      },
    })).toBe(true);
  });

  it('treats verified Grok OAuth projection as a concrete subscription credential', () => {
    const sub = provider(XAI_SUBSCRIPTION_PROVIDER_ID, ['grok-4.5'], 'subscription');
    expect(hasProviderRouteCredential(sub, {
      verifyStatus: {
        [XAI_SUBSCRIPTION_PROVIDER_ID]: {
          status: 'valid',
          verifiedAt: '2026-07-11T00:00:00.000Z',
        },
      },
    })).toBe(true);
    expect(isConcreteProviderRoute({
      kind: 'subscription',
      providerId: XAI_SUBSCRIPTION_PROVIDER_ID,
      model: 'grok-4.5',
    })).toBe(true);
    expect(hasProviderRouteCredential(sub, {
      verifyStatus: {
        [XAI_SUBSCRIPTION_PROVIDER_ID]: {
          status: 'invalid',
          verifiedAt: '2026-07-11T00:00:00.000Z',
          accountEmail: 'user@example.com',
          invalidReason: 'entitlement_required',
        },
      },
    })).toBe(false);
  });

  it('auto repairs only when the credential-configured candidate is unique', () => {
    const providers = [
      provider('deepseek', ['same-model']),
      provider('zhipu', ['same-model']),
    ];

    expect(resolveLegacyModelOnlyProviderRoute({
      model: 'same-model',
      providers,
      credentials: { apiKeys: { deepseek: 'secret' } },
    })).toEqual({ kind: 'provider', providerId: 'deepseek', model: 'same-model' });

    expect(resolveLegacyModelOnlyProviderRoute({
      model: 'same-model',
      providers,
      credentials: { apiKeys: { deepseek: 'secret', zhipu: 'secret' } },
    })).toEqual({
      kind: 'unknown-legacy',
      model: 'same-model',
      reason: 'ambiguous-model',
      candidateProviderIds: ['deepseek', 'zhipu'],
    });
  });

  it('rejects malformed concrete routes at runtime boundaries', () => {
    expect(isConcreteProviderRoute({ kind: 'provider', providerId: '', model: 'm' })).toBe(false);
    expect(isConcreteProviderRoute({ kind: 'subscription', providerId: 'anthropic-api', model: 'm' } as never)).toBe(false);
    expect(isConcreteProviderRoute({ kind: 'subscription', providerId: SUBSCRIPTION_PROVIDER_ID, model: 'm' })).toBe(true);
  });
});

describe('provider route model mismatch', () => {
  const providers = [
    provider('custom-api', ['agnes-3.0-flash']),
    provider(SUBSCRIPTION_PROVIDER_ID, ['claude-opus-4-7'], 'subscription'),
  ];

  it('flags a route whose provider does not serve the model', () => {
    // The exact shape a session snapshot freezes when a third-party model is
    // sent on the subscription provider: a pair that never held.
    expect(isProviderRouteModelMismatch(
      { kind: 'subscription', providerId: SUBSCRIPTION_PROVIDER_ID, model: 'agnes-3.0-flash' },
      providers,
    )).toBe(true);
  });

  it('accepts a route whose provider serves the model', () => {
    expect(isProviderRouteModelMismatch(
      { kind: 'subscription', providerId: SUBSCRIPTION_PROVIDER_ID, model: 'claude-opus-4-7' },
      providers,
    )).toBe(false);
    expect(isProviderRouteModelMismatch(
      { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
      providers,
    )).toBe(false);
  });

  it('keeps the pin for a deleted provider — the pair cannot be disproved', () => {
    expect(isProviderRouteModelMismatch(
      { kind: 'provider', providerId: 'deleted-provider', model: 'agnes-3.0-flash' },
      providers,
    )).toBe(false);
  });

  it('keeps the pin for a disabled provider so #300 still refuses the send', () => {
    expect(isProviderRouteModelMismatch(
      { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
      providers.map(candidate => candidate.id === 'custom-api'
        ? { ...candidate, enabled: false }
        : candidate),
    )).toBe(false);
  });

  it('keeps the pin when the provider catalogue is empty', () => {
    expect(isProviderRouteModelMismatch(
      { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
      [{ id: 'custom-api', models: [] }],
    )).toBe(false);
  });
});

describe('frozen provider identity', () => {
  const providers = [
    { id: 'custom-api', models: [{ model: 'agnes-3.0-flash' }] },
    { id: SUBSCRIPTION_PROVIDER_ID, models: [{ model: 'claude-opus-4-7' }] },
  ];

  it('refuses to freeze a pair the registry rejects', () => {
    // The exact lie that used to be written into the session store: the
    // subscription provider paired with a third-party model. Freezing it
    // pinned the session to a provider that can never answer it, so the next
    // turn read as a provider switch and the sidecar opened a *fresh session*
    // instead of continuing the conversation.
    expect(resolveFrozenProviderIdentity({
      providerId: SUBSCRIPTION_PROVIDER_ID,
      model: 'agnes-3.0-flash',
      providers,
    })).toEqual({});
  });

  it('freezes a pair the registry confirms', () => {
    expect(resolveFrozenProviderIdentity({
      providerId: 'custom-api',
      model: 'agnes-3.0-flash',
      providers,
    })).toEqual({
      providerId: 'custom-api',
      providerRoute: { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
    });
  });

  it('keeps the provider pin when the catalogue cannot disprove it', () => {
    // Deleted provider / empty catalogue: #300 must keep refusing the send,
    // so the pin survives and no route is invented.
    expect(resolveFrozenProviderIdentity({
      providerId: 'deleted-provider',
      model: 'agnes-3.0-flash',
      providers,
    })).toEqual({
      providerId: 'deleted-provider',
      providerRoute: { kind: 'provider', providerId: 'deleted-provider', model: 'agnes-3.0-flash' },
    });

    expect(resolveFrozenProviderIdentity({
      providerId: 'custom-api',
      model: 'agnes-3.0-flash',
      providers: [{ id: 'custom-api', models: [] }],
    })).toEqual({
      providerId: 'custom-api',
      providerRoute: { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
    });
  });

  it('freezes the provider alone when no model is known yet', () => {
    expect(resolveFrozenProviderIdentity({
      providerId: 'custom-api',
      model: undefined,
      providers,
    })).toEqual({ providerId: 'custom-api' });
  });
});
