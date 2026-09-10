// Unit tests for src/server/mcp-bundled-seed.ts
//
// Covers:
//   - seedBundledExtendedMcpServers: idempotent diff-merge into user
//     config; bundled empty / all-present / partial-present; never
//     overwrites user entries.

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
      isBuiltin: true,
    },
    {
      id: 'stock-datasource',
      name: '股票数据服务',
      type: 'http',
      url: 'http://example/mcp',
      args: [],
      env: {},
      isBuiltin: true,
    },
  ]),
}));

// Import AFTER vi.mock so the module graph picks up the mocks.
import { seedBundledExtendedMcpServers } from './mcp-bundled-seed';
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

function readUserConfig(): unknown {
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
    const cfg = readUserConfig() as { mcpServers: Array<{ id: string }> };
    const ids = cfg.mcpServers.map((s) => s.id).sort();
    expect(ids).toEqual(['multimedia-creator', 'stock-datasource']);
  });

  it('is a no-op when user config already contains all bundled entries', async () => {
    writeUserConfig([
      { id: 'multimedia-creator', command: 'uvx', args: ['user-customized'], isBuiltin: true },
      { id: 'stock-datasource', type: 'http', url: 'http://example/mcp', isBuiltin: true },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig() as { mcpServers: Array<{ args?: string[]; type?: string }> };
    // User's customized args preserved (no overwrite).
    expect(cfg.mcpServers[0].args).toEqual(['user-customized']);
    expect(cfg.mcpServers).toHaveLength(2);
  });

  it('only adds the missing entries (diff-merge)', async () => {
    writeUserConfig([
      { id: 'multimedia-creator', command: 'uvx', args: [], isBuiltin: true },
    ]);
    await flushAsync();
    seedBundledExtendedMcpServers();
    await flushAsync();
    const cfg = readUserConfig() as { mcpServers: Array<{ id: string }> };
    expect(cfg.mcpServers).toHaveLength(2);
    expect(cfg.mcpServers.map((s) => s.id).sort()).toEqual(['multimedia-creator', 'stock-datasource']);
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