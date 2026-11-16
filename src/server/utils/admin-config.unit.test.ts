import { describe, expect, it } from 'vitest';

import { PLAYWRIGHT_MCP_PACKAGE_SPEC } from '../../shared/mcpPackages';
import { SUBSCRIPTION_PROVIDER_ID } from '../../shared/config-types';
import { getAllMcpServers, resolveOwnedProviderRouteForCatalog } from './admin-config';
import type { AdminAppConfig } from './admin-config';
import type { SessionMetadata } from '../types/session';

describe('server MCP catalogue merge', () => {
  it('appends preset args instead of replacing the executable package spec', () => {
    const servers = getAllMcpServers({
      mcpServers: [],
      mcpEnabledServers: ['playwright'],
      mcpServerArgs: {
        playwright: ['--user-data-dir=/tmp/playwright-profile'],
      },
    });

    expect(servers.find((server) => server.id === 'playwright')?.args).toEqual([
      PLAYWRIGHT_MCP_PACKAGE_SPEC,
      '--user-data-dir=/tmp/playwright-profile',
    ]);
  });

  // `hamuna mcp list` and the Sidecar fallback path rely on the server-side
  // catalogue merge to surface `extended_buildin_mcp/mcp.json` entries — the
  // bundled file ships `stock-datasource` (uvx-based stock data) in dev. The
  // exact id varies per admin build, so we look up by `isBuiltin` instead of
  // asserting on a specific name.
  it('includes extended_buildin_mcp/mcp.json entries so hamuna mcp list and Sidecar fallback see them', () => {
    const servers = getAllMcpServers({} as AdminAppConfig);
    const extendedEntries = servers.filter((s) => s.isBuiltin && s.id !== 'playwright');
    // Sanity: at least one extended entry is bundled — if this trips, the
    // extended_buildin_mcp/mcp.json fixture was removed.
    expect(extendedEntries.length).toBeGreaterThan(0);
    // All extended entries must be platform-eligible stdio/sse/http — the
    // loader's `platforms` filter already dropped unsupported hosts, but
    // surface the type for any future schema regression.
    for (const s of extendedEntries) {
      expect(['stdio', 'sse', 'http']).toContain(s.type);
    }
  });
});

describe('owned session provider route resolution', () => {
  const providers = [
    {
      id: 'custom-api',
      type: 'api' as const,
      enabled: true,
      models: [{ model: 'agnes-3.0-flash', modelName: 'agnes-3.0-flash', modelSeries: 'agnes' }],
    },
    {
      id: SUBSCRIPTION_PROVIDER_ID,
      type: 'subscription' as const,
      enabled: true,
      models: [{ model: 'claude-opus-4-7', modelName: 'claude-opus-4-7', modelSeries: 'claude' }],
    },
  ];
  const credentials = { apiKeys: { 'custom-api': 'secret' } };

  function sessionMeta(overrides: Partial<SessionMetadata>): SessionMetadata {
    return {
      id: 'session-1',
      agentDir: '/tmp/workspace',
      title: 'session',
      createdAt: '2026-11-16T00:00:00.000Z',
      lastActiveAt: '2026-11-16T00:00:00.000Z',
      configSnapshotAt: '2026-11-16T00:00:00.000Z',
      ...overrides,
    };
  }

  it('honors a stored route whose provider serves the model', () => {
    expect(resolveOwnedProviderRouteForCatalog({
      sessionMeta: sessionMeta({
        providerId: 'custom-api',
        model: 'agnes-3.0-flash',
        providerRoute: { kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' },
      }),
      providers,
      credentials,
    })).toEqual({ kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' });
  });

  it('recovers the provider from the model when the stored pair never held', () => {
    // The subscription provider frozen with a third-party model: honoring it
    // would resume the session on a provider that can never answer it.
    expect(resolveOwnedProviderRouteForCatalog({
      sessionMeta: sessionMeta({
        providerId: SUBSCRIPTION_PROVIDER_ID,
        model: 'agnes-3.0-flash',
        providerRoute: {
          kind: 'subscription',
          providerId: SUBSCRIPTION_PROVIDER_ID,
          model: 'agnes-3.0-flash',
        },
      }),
      providers,
      credentials,
    })).toEqual({ kind: 'provider', providerId: 'custom-api', model: 'agnes-3.0-flash' });
  });

  it('keeps the pin for a deleted provider instead of switching silently', () => {
    const route = resolveOwnedProviderRouteForCatalog({
      sessionMeta: sessionMeta({
        providerId: 'deleted-provider',
        model: 'agnes-3.0-flash',
        providerRoute: { kind: 'provider', providerId: 'deleted-provider', model: 'agnes-3.0-flash' },
      }),
      providers,
      credentials,
    });
    // The deleted provider's route is kept verbatim: the session stays pinned
    // so the UI reports "provider unavailable" instead of silently re-billing
    // whichever provider happens to serve the model.
    expect(route).toEqual({
      kind: 'provider',
      providerId: 'deleted-provider',
      model: 'agnes-3.0-flash',
    });
  });
});
