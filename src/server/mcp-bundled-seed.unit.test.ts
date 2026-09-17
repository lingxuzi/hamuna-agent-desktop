// Unit tests for src/server/mcp-bundled-seed.ts
//
// Covers the selective-merge contract (v2):
//   - add all bundled entries when user config is empty
//   - upgrade product surface (command/args/url/type/etc.) for existing
//     bundled entries on every startup
//   - preserve user `env` and `enabled` fields across an upgrade
//   - keep user-added entries whose id is not in the bundle
//   - bundled deletion does NOT delete a user entry (defensive: we
//     never silently lose user config)
//   - swallow ConfigBusyError and bundle-loader failures
//
// The previous contract (only ADD when id missing — never touch
// existing entries) was changed because it meant shipping a new
// command/args/url in `extended_buildin_mcp/mcp.json` had zero effect
// on already-installed users.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the bundled config loader so we don't read the on-disk JSON.
vi.mock('./utils/extended-builtin-mcp', () => ({
  loadExtendedBuiltinMcpServers: vi.fn(() => [
    {
      id: 'multimedia-creator',
      name: '视频/图片生成（Agnes 2.5）',
      type: 'stdio',
      command: 'uvx',
      args: ['--from', 'agnes-video-25-mcp==0.1.6', 'agnes-video-25-mcp'],
      env: { AGNES_API_KEYS: 'bundled-demo-key' },
      isBuiltin: true,
      enabled: true,
    },
    {
      id: 'stock-datasource',
      name: '股票数据服务',
      type: 'http',
      url: 'http://example/mcp',
      args: [],
      env: {},
      isBuiltin: true,
      enabled: true,
    },
  ]),
}));

// Import AFTER vi.mock so the module graph picks up the mocks.
import { BUNDLED_SEED_USER_FIELDS, seedBundledExtendedMcpServers } from './mcp-bundled-seed';
import * as adminConfig from './utils/admin-config';
import * as extendedBuiltinMcp from './utils/extended-builtin-mcp';

let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'hamuna-mcp-seed-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  vi.restoreAllMocks();
});

function writeUserConfig(servers: unknown[]): void {
  const dir = join(tempHome, '.hamuna');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ mcpServers: servers }, null, 2),
    'utf8',
  );
}

function readUserConfig(): { mcpServers: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(tempHome, '.hamuna', 'config.json'), 'utf8'));
}

// Wait a tick so async atomicModifyConfig calls drain before assertions
// read the on-disk file.
function flushAsync(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('seedBundledExtendedMcpServers', () => {
  it('adds all bundled entries when user config is empty', async () => {
    writeUserConfig([]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const ids = cfg.mcpServers.map((s) => s.id).sort();
    expect(ids).toEqual(['multimedia-creator', 'stock-datasource']);
  });

  it('upgrades product surface (command/args/type/url) when bundled changes', async () => {
    // User has stale bundled entry — the old (pre-upgrade) version.
    writeUserConfig([
      {
        id: 'multimedia-creator',
        name: 'stale-name',
        type: 'stdio',
        command: 'old-cmd',
        args: ['old-arg'],
        env: { AGNES_API_KEYS: 'user-key' },
        isBuiltin: true,
        enabled: true,
      },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const mm = cfg.mcpServers.find((s) => s.id === 'multimedia-creator')!;
    // Product surface refreshed from bundled:
    expect(mm.command).toBe('uvx');
    expect(mm.args).toEqual(['--from', 'agnes-video-25-mcp==0.1.6', 'agnes-video-25-mcp']);
    expect(mm.name).toBe('视频/图片生成（Agnes 2.5）');
    // User env preserved:
    expect(mm.env).toEqual({ AGNES_API_KEYS: 'user-key' });
  });

  it('preserves user env across upgrade even when bundled ships a different env', async () => {
    writeUserConfig([
      {
        id: 'multimedia-creator',
        command: 'uvx',
        args: ['old'],
        env: { AGNES_API_KEYS: 'user-real-key', CUSTOM: 'kept' },
        isBuiltin: true,
        enabled: true,
      },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const mm = cfg.mcpServers.find((s) => s.id === 'multimedia-creator')!;
    // User's env wins, bundled's env is discarded for this entry:
    expect(mm.env).toEqual({ AGNES_API_KEYS: 'user-real-key', CUSTOM: 'kept' });
  });

  it('preserves user enabled:false across upgrade', async () => {
    writeUserConfig([
      {
        id: 'multimedia-creator',
        command: 'uvx',
        args: [],
        env: {},
        isBuiltin: true,
        enabled: false,
      },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const mm = cfg.mcpServers.find((s) => s.id === 'multimedia-creator')!;
    expect(mm.enabled).toBe(false);
  });

  it('keeps user-added entries whose id is not in the bundle', async () => {
    writeUserConfig([
      { id: 'my-custom-mcp', command: 'echo', args: ['hi'], isBuiltin: false },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const ids = cfg.mcpServers.map((s) => s.id).sort();
    expect(ids).toEqual(['multimedia-creator', 'my-custom-mcp', 'stock-datasource']);
    // Custom entry untouched:
    const custom = cfg.mcpServers.find((s) => s.id === 'my-custom-mcp')!;
    expect(custom.command).toBe('echo');
    expect(custom.args).toEqual(['hi']);
  });

  it('does not delete a user entry whose id was removed from the bundle', async () => {
    // User has an entry whose id is in the OLD bundled set but the
    // current bundle mock above no longer ships it. The merge must NOT
    // delete it (defensive — user might be mid-debug, etc.).
    writeUserConfig([
      { id: 'some-removed-id', command: 'echo', args: [], isBuiltin: false },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig();
    const ids = cfg.mcpServers.map((s) => s.id).sort();
    expect(ids).toContain('some-removed-id');
  });

  it('is a no-op when all bundled entries are already up-to-date', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeUserConfig([
      {
        id: 'multimedia-creator',
        name: '视频/图片生成（Agnes 2.5）',
        type: 'stdio',
        command: 'uvx',
        args: ['--from', 'agnes-video-25-mcp==0.1.6', 'agnes-video-25-mcp'],
        env: {},
        isBuiltin: true,
        enabled: true,
      },
      {
        id: 'stock-datasource',
        name: '股票数据服务',
        type: 'http',
        url: 'http://example/mcp',
        args: [],
        env: {},
        isBuiltin: true,
        enabled: true,
      },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('already present and up-to-date'),
    );
  });

  it('exports BUNDLED_SEED_USER_FIELDS with exactly env + enabled', () => {
    // Schema guard: if someone adds a new McpServerDefinition field
    // they MUST explicitly decide whether the seed treats it as bundled
    // or user. This constant is the source of truth for the user side.
    expect([...BUNDLED_SEED_USER_FIELDS].sort()).toEqual(['enabled', 'env']);
  });

  it('swallows ConfigBusyError from atomicModifyConfig', async () => {
    writeUserConfig([]);
    await flushAsync();
    const spy = vi
      .spyOn(adminConfig, 'atomicModifyConfig')
      .mockRejectedValueOnce(new adminConfig.ConfigBusyError());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedBundledExtendedMcpServers();
    await flushAsync();
    expect(spy).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('auto-merge failed'),
      expect.anything(),
    );
  });

  it('swallows a throw from the bundled config loader', () => {
    vi.mocked(extendedBuiltinMcp.loadExtendedBuiltinMcpServers).mockImplementationOnce(() => {
      throw new Error('corrupt bundle');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedBundledExtendedMcpServers();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to load bundled extended MCP config'),
      expect.anything(),
    );
  });
});
