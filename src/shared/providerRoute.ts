import type { Provider, ProviderVerifyStatus } from './config-types';
import {
  isBuiltinSubscriptionProviderId,
  isProviderEnabled,
  XAI_SUBSCRIPTION_PROVIDER_ID,
  type BuiltinSubscriptionProviderId,
} from './config-types';

export type ProviderRoute =
  | {
      kind: 'provider';
      providerId: string;
      model: string;
    }
  | {
      kind: 'subscription';
      providerId: BuiltinSubscriptionProviderId;
      model: string;
    }
  | {
      kind: 'unknown-legacy';
      model?: string;
      reason:
        | 'missing-model'
        | 'missing-provider-id'
        | 'provider-deleted'
        | 'provider-disabled'
        | 'provider-model-mismatch'
        | 'no-credentialed-provider'
        | 'ambiguous-model';
      candidateProviderIds?: string[];
    };

export interface ProviderRouteCredentialState {
  apiKeys?: Record<string, string | null | undefined>;
  verifyStatus?: Record<string, ProviderVerifyStatus | undefined>;
}

export type ProviderForRoute = Pick<Provider, 'id' | 'type' | 'models' | 'enabled'>;

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function providerDeclaresModel(
  provider: Pick<Provider, 'models'> | null | undefined,
  model: string | null | undefined,
): boolean {
  const modelId = nonEmpty(model);
  if (!modelId) return false;
  return provider?.models?.some(entry => entry.model === modelId) ?? false;
}

/**
 * The minimal provider shape the route rules need. The renderer and the
 * sidecar keep their own provider record types; this keeps "does the provider
 * serve the model?" in one place.
 */
export interface ProviderRouteCatalogProvider {
  id: string;
  models?: ReadonlyArray<{ model?: string | null }> | null;
}

/**
 * Does the provider's catalogue contain this model?
 *
 * An empty catalogue means "unknown" — we cannot disprove the pair, so it
 * counts as serving. Some providers ship an empty list and fill it from the
 * upstream API at runtime; treating that as "does not serve" would reject
 * perfectly valid pairs.
 */
export function providerServesModel(
  provider: ProviderRouteCatalogProvider | null | undefined,
  model: string | null | undefined,
): boolean {
  const modelId = nonEmpty(model);
  if (!modelId) return false;
  const models = provider?.models ?? [];
  if (models.length === 0) return true;
  return models.some(entry => nonEmpty(entry.model) === modelId);
}

/**
 * A provider route is an *identity*: "this session runs on provider P with
 * model M". That only means something when P actually serves M.
 *
 * `isConcreteProviderRoute` only checks the shape (both ids non-empty), which
 * is not enough: a route frozen from a mismatched turn — the Anthropic
 * subscription provider paired with a third-party model — is a lie that pins
 * the session to a provider which can never answer it. The renderer then
 * refuses every send with "provider unavailable" (#300), and it is right to:
 * the pinned identity was never real.
 *
 * Only a *model* mismatch invalidates the identity:
 *   - provider deleted → keep the pin (#300 must keep refusing the send
 *     instead of silently re-billing a different provider),
 *   - provider disabled → keep the pin (same reason),
 *   - empty catalogue → cannot disprove, keep the pin.
 */
export function isProviderRouteModelMismatch(
  route: ProviderRoute | null | undefined,
  providers: ReadonlyArray<ProviderRouteCatalogProvider>,
): boolean {
  if (!isConcreteProviderRoute(route)) return false;
  const provider = providers.find(candidate => candidate.id === route.providerId);
  if (!provider) return false;
  return !providerServesModel(provider, route.model);
}

export function hasProviderRouteCredential(
  provider: ProviderForRoute,
  credentials: ProviderRouteCredentialState,
): boolean {
  if (provider.type === 'subscription') {
    if (!isBuiltinSubscriptionProviderId(provider.id)) return false;
    const status = credentials.verifyStatus?.[provider.id];
    if (provider.id === XAI_SUBSCRIPTION_PROVIDER_ID) {
      return status?.status === 'valid';
    }
    return (
      status?.status === 'valid'
      || !!nonEmpty(status?.accountEmail)
      || !!nonEmpty(status?.verifiedAt)
    );
  }

  return !!nonEmpty(credentials.apiKeys?.[provider.id]);
}

export function getCredentialConfiguredProviderCandidates<T extends ProviderForRoute>(
  providers: ReadonlyArray<T>,
  model: string | null | undefined,
  credentials: ProviderRouteCredentialState,
): T[] {
  const modelId = nonEmpty(model);
  if (!modelId) return [];
  return providers.filter(provider =>
    providerDeclaresModel(provider, modelId)
    && hasProviderRouteCredential(provider, credentials),
  );
}

function concreteRoute(provider: ProviderForRoute, model: string): ProviderRoute {
  if (provider.type === 'subscription' && isBuiltinSubscriptionProviderId(provider.id)) {
    return { kind: 'subscription', providerId: provider.id, model };
  }
  return { kind: 'provider', providerId: provider.id, model };
}

export function resolveExplicitProviderRoute(args: {
  providerId: string | null | undefined;
  model: string | null | undefined;
  providers: ReadonlyArray<ProviderForRoute>;
}): ProviderRoute {
  const providerId = nonEmpty(args.providerId);
  const model = nonEmpty(args.model);
  if (!model) return { kind: 'unknown-legacy', reason: 'missing-model' };
  if (!providerId) {
    return { kind: 'unknown-legacy', model, reason: 'missing-provider-id' };
  }

  const provider = args.providers.find(candidate => candidate.id === providerId);
  if (!provider) return { kind: 'unknown-legacy', model, reason: 'provider-deleted' };
  if (!isProviderEnabled(provider)) return { kind: 'unknown-legacy', model, reason: 'provider-disabled' };
  if (!providerDeclaresModel(provider, model)) {
    return { kind: 'unknown-legacy', model, reason: 'provider-model-mismatch' };
  }
  return concreteRoute(provider, model);
}

export function resolveLegacyModelOnlyProviderRoute(args: {
  model: string | null | undefined;
  providers: ReadonlyArray<ProviderForRoute>;
  credentials: ProviderRouteCredentialState;
}): ProviderRoute {
  const model = nonEmpty(args.model);
  if (!model) return { kind: 'unknown-legacy', reason: 'missing-model' };

  const candidates = getCredentialConfiguredProviderCandidates(
    args.providers,
    model,
    args.credentials,
  );
  if (candidates.length === 1) return concreteRoute(candidates[0], model);

  return {
    kind: 'unknown-legacy',
    model,
    reason: candidates.length === 0 ? 'no-credentialed-provider' : 'ambiguous-model',
    ...(candidates.length > 0 ? { candidateProviderIds: candidates.map(provider => provider.id) } : {}),
  };
}

export function isConcreteProviderRoute(
  route: ProviderRoute | null | undefined,
): route is Extract<ProviderRoute, { kind: 'provider' | 'subscription' }> {
  if (!route || typeof route !== 'object') return false;
  if (route.kind === 'provider') {
    return !!nonEmpty(route.providerId) && !!nonEmpty(route.model);
  }
  if (route.kind === 'subscription') {
    return isBuiltinSubscriptionProviderId(route.providerId) && !!nonEmpty(route.model);
  }
  return false;
}

export function providerRouteMirrorProviderId(
  route: ProviderRoute | null | undefined,
): string | undefined {
  return isConcreteProviderRoute(route) ? route.providerId : undefined;
}

export function createConcreteProviderRoute(providerId: string, model: string): ProviderRoute {
  if (isBuiltinSubscriptionProviderId(providerId)) {
    return { kind: 'subscription', providerId, model };
  }
  return { kind: 'provider', providerId, model };
}

/**
 * What a session snapshot may freeze as its provider identity.
 *
 * A snapshot freezes the provider so later turns resume on the same one.
 * Freezing a pair the registry rejects writes a lie into the session store:
 * the readers pin the session to a provider that can never answer it (#300
 * then refuses every send with "provider unavailable"), and the sidecar reads
 * the next turn as a provider switch — which ends in a *fresh session* with a
 * new id instead of the conversation the user is looking at.
 *
 * Only a model mismatch invalidates the pair. A deleted/disabled provider
 * keeps its pin on purpose (#300 must keep refusing the send instead of
 * silently re-billing another provider), and an empty catalogue cannot
 * disprove anything.
 *
 * When the pair never held, the model is the only trustworthy part of the
 * snapshot: freeze the model alone and let the readers recover the provider
 * from it.
 */
export function resolveFrozenProviderIdentity(args: {
  providerId: string | null | undefined;
  model: string | null | undefined;
  providers: ReadonlyArray<ProviderRouteCatalogProvider>;
}): { providerId?: string; providerRoute?: ProviderRoute } {
  const providerId = nonEmpty(args.providerId);
  const model = nonEmpty(args.model);
  if (!providerId) return {};
  if (!model) return { providerId };
  const route = createConcreteProviderRoute(providerId, model);
  if (isProviderRouteModelMismatch(route, args.providers)) return {};
  return { providerId, providerRoute: route };
}
