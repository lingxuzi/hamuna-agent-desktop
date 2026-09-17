import { describe, it, expect } from 'vitest';
import type { AppConfig, McpServerDefinition } from '../types';
import { getAllMcpServersFromConfig } from './mcpService';

// Issue #303: mineru-mcp subprocess started without MINERU_API_KEY even though
// the user set it in Settings. Root cause was renderer→sidecar propagation, not
// the merge itself — but pin the merge invariant so a future refactor can't
// re-introduce the split-source-of-truth bug at this layer too.
//
// Storage shape: env can live on `mcpServers[].env` (custom server form / JSON
// import) OR `mcpServerEnv[id]` (per-server env editor / admin CLI). The
// merged catalogue used by Chat's `/api/mcp/set` push MUST overlay both so the
// sidecar's `currentMcpServers[id].env` reaches the SDK subprocess.

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mcpServers: [],
    mcpEnabledServers: [],
    mcpServerEnv: {},
    mcpServerArgs: {},
    ...overrides,
  } as AppConfig;
}

function customMineru(env?: Record<string, string>): McpServerDefinition {
  return {
    id: 'mineru',
    name: 'mineru',
    type: 'stdio',
    command: 'uvx',
    args: ['mineru-mcp'],
    isBuiltin: false,
    ...(env ? { env } : {}),
  };
}

function findById(
  servers: McpServerDefinition[],
  id: string,
): McpServerDefinition | undefined {
  return servers.find(s => s.id === id);
}

describe('getAllMcpServersFromConfig — env merge (issue #303)', () => {
  it('merges mcpServerEnv into server.env when the entry has no inline env', () => {
    // Exact reporter shape: mineru added to mcpServers[] without env, key set
    // via per-server env editor → lives only on mcpServerEnv.mineru.
    const cfg = baseConfig({
      mcpServers: [customMineru()],
      mcpEnabledServers: ['mineru'],
      mcpServerEnv: { mineru: { MINERU_API_KEY: 'k-from-env-dict' } },
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.env).toEqual({ MINERU_API_KEY: 'k-from-env-dict' });
  });

  it('lets mcpServerEnv override matching keys on server.env (user override wins)', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru({ MINERU_API_KEY: 'inline-stale', EXTRA: 'keep' })],
      mcpEnabledServers: ['mineru'],
      mcpServerEnv: { mineru: { MINERU_API_KEY: 'override-wins' } },
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.env).toEqual({
      MINERU_API_KEY: 'override-wins',
      EXTRA: 'keep',
    });
  });

  it('leaves server unchanged when neither inline env nor mcpServerEnv has entries', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru()],
      mcpEnabledServers: ['mineru'],
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.env).toBeUndefined();
  });

  it('ignores a malformed mcpServerEnv entry (array instead of object) — fails closed, no env injected', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru()],
      mcpEnabledServers: ['mineru'],
      // Hand-edited config / corrupt write — surface should not crash and
      // should not silently coerce an array into a Record<string,string>.
      mcpServerEnv: { mineru: ['MINERU_API_KEY=oops'] as unknown as Record<string, string> },
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.env).toBeUndefined();
  });

  it('appends mcpServerArgs without losing existing args (custom mineru: uvx mineru-mcp + --debug)', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru()],
      mcpEnabledServers: ['mineru'],
      mcpServerArgs: { mineru: ['--debug'] },
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.args).toEqual(['mineru-mcp', '--debug']);
  });
});

// `getAllMcpServersFromConfig` second arg is the bundled `extended_buildin_mcp/mcp.json`
// entries fetched once per page load. Pin the priority order so a future
// refactor can't silently swap it (custom wins over extended wins over preset).

const extendedMineru: McpServerDefinition = {
  id: 'mineru',
  name: 'mineru (extended)',
  type: 'stdio',
  command: 'uvx',
  args: ['mineru-mcp'],
  isBuiltin: true,
};

describe('getAllMcpServersFromConfig — extended builtin presets', () => {
  it('passes empty extended by default (back-compat with existing call sites)', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru()],
    });
    const merged = findById(getAllMcpServersFromConfig(cfg), 'mineru');
    expect(merged?.name).toBe('mineru');
  });

  it('surfaces an extended entry that does not collide with custom or preset', () => {
    const cfg = baseConfig();
    const merged = getAllMcpServersFromConfig(cfg, [extendedMineru]);
    expect(findById(merged, 'mineru')?.isBuiltin).toBe(true);
    expect(findById(merged, 'mineru')?.name).toBe('mineru (extended)');
  });

  it('custom entry wins over extended on id collision', () => {
    const cfg = baseConfig({
      mcpServers: [customMineru()],
    });
    const merged = findById(getAllMcpServersFromConfig(cfg, [extendedMineru]), 'mineru');
    expect(merged?.name).toBe('mineru');
    expect(merged?.isBuiltin).toBe(false);
  });

  it('extended entry suppresses a hardcoded preset with the same id (preset loses)', () => {
    // playwright is in PRESET_MCP_SERVERS — extended with the same id should
    // shadow it. (This is the realistic "admin wants to ship a forked
    // playwright" case.) The merge order is custom > extended > preset, so
    // the preset is filtered out at the array-spread step when an extended
    // entry claims the same id.
    const extendedPlaywright: McpServerDefinition = {
      id: 'playwright',
      name: 'playwright (extended)',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@experimental'],
      isBuiltin: true,
    };
    const merged = findById(getAllMcpServersFromConfig(baseConfig(), [extendedPlaywright]), 'playwright');
    expect(merged?.name).toBe('playwright (extended)');
  });

  it('preserves an unrelated preset when extended entries are present', () => {
    // Sanity: adding extended entries must not silently drop entries from
    // PRESET_MCP_SERVERS that don't collide.
    const cfg = baseConfig();
    const merged = getAllMcpServersFromConfig(cfg, [extendedMineru]);
    expect(findById(merged, 'playwright')).toBeDefined();
  });
});
