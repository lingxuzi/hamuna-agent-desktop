// Unit tests for src/server/mcp-bundled-seed.ts
//
// Covers:
//   - seedBundledExtendedMcpServers: idempotent diff-merge into user
//     config; bundled empty / all-present / partial-present; never
//     overwrites user entries.
//   - seedBundledUvToHamunaBin: idempotent copy; bundled missing /
//     target exists with same size / target exists with different size /
//     broken symlink at target. Tests that expect actual copy behavior
//     override process.platform to 'win32' since the production guard
//     short-circuits on non-win32.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the two file-system-coupled helpers we don't want to hit in tests.
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

vi.mock('./utils/runtime', () => ({
  getBundledUvPath: vi.fn(() => null), // off by default; per-test override
}));

// Import AFTER vi.mock so the module graph picks up the mocks.
import {
  seedBundledExtendedMcpServers,
  seedBundledUvToHamunaBin,
} from './mcp-bundled-seed';
import * as adminConfig from './utils/admin-config';
import * as extendedBuiltinMcp from './utils/extended-builtin-mcp';
import * as runtimeMod from './utils/runtime';

let tempHome = '';
let originalPlatform: NodeJS.Platform;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'hamuna-mcp-seed-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  // Default to win32 — most tests in this file want to exercise the
  // Windows-only copy path. The non-win32 test overrides back.
  originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
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

function fakeBundledUvx(sizeBytes = 48 * 1024 * 1024): string {
  const bundledDir = join(tempHome, 'install');
  mkdirSync(bundledDir, { recursive: true });
  const bundled = join(bundledDir, 'uvx.exe');
  // Cheap size mock: sparse file written with a single byte at the end.
  const fh = openSync(bundled, 'w');
  try {
    writeSync(fh, Buffer.from([0]), 0, 1, sizeBytes - 1);
  } finally {
    closeSync(fh);
  }
  return bundled;
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

describe('seedBundledUvToHamunaBin', () => {
  it('skips silently when no bundled uvx is available', () => {
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(null);
    const binDir = join(tempHome, '.hamuna', 'bin');
    seedBundledUvToHamunaBin();
    expect(existsSync(binDir)).toBe(false);
  });

  it('copies bundled uvx to ~/.hamuna/bin/uvx.exe when target is missing', () => {
    const bundled = fakeBundledUvx();
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(bundled);
    seedBundledUvToHamunaBin();
    const target = join(tempHome, '.hamuna', 'bin', 'uvx.exe');
    expect(existsSync(target)).toBe(true);
    expect(lstatSync(target).size).toBe(lstatSync(bundled).size);
  });

  it('skips when target already exists with the same size (idempotent)', async () => {
    const bundled = fakeBundledUvx();
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(bundled);
    const binDir = join(tempHome, '.hamuna', 'bin');
    mkdirSync(binDir, { recursive: true });
    const target = join(binDir, 'uvx.exe');
    // Pre-stage target with same size.
    copyFileSync(bundled, target);
    const mtimeBefore = lstatSync(target).mtimeMs;
    // Wait so a real copy would change mtime.
    await new Promise((r) => setTimeout(r, 20));
    seedBundledUvToHamunaBin();
    const mtimeAfter = lstatSync(target).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('overwrites when target size differs (version bump)', () => {
    const bundled = fakeBundledUvx(50 * 1024 * 1024);
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(bundled);
    const binDir = join(tempHome, '.hamuna', 'bin');
    mkdirSync(binDir, { recursive: true });
    const target = join(binDir, 'uvx.exe');
    // Stage a smaller dummy file at the target.
    writeFileSync(target, Buffer.alloc(1024));
    seedBundledUvToHamunaBin();
    expect(lstatSync(target).size).toBe(50 * 1024 * 1024);
  });

  it('removes a broken symlink at the target before re-copying', () => {
    const bundled = fakeBundledUvx();
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(bundled);
    const binDir = join(tempHome, '.hamuna', 'bin');
    mkdirSync(binDir, { recursive: true });
    const target = join(binDir, 'uvx.exe');
    symlinkSync(join(tempHome, 'does-not-exist'), target);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedBundledUvToHamunaBin();
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('removed broken symlink'),
    );
  });

  it('skips when platform is non-win32 (macOS/Linux rely on system uv)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const bundled = fakeBundledUvx();
    vi.mocked(runtimeMod.getBundledUvPath).mockReturnValue(bundled);
    seedBundledUvToHamunaBin();
    const target = join(tempHome, '.hamuna', 'bin', 'uvx.exe');
    expect(existsSync(target)).toBe(false);
  });
});
