import { describe, expect, it } from 'vitest';

import { PLAYWRIGHT_MCP_PACKAGE_SPEC } from '../../shared/mcpPackages';
import { getAllMcpServers } from './admin-config';
import type { AdminAppConfig } from './admin-config';

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
