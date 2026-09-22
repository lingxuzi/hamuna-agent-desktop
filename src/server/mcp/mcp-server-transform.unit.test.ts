/**
 * Unit tests for `transformMcpServerForSpawn` PATH injection logic.
 *
 * We mock the runtime helpers (`getBundledPythonBinDir`,
 * `getBundledAgnesMcpBinDirs`) so the assertions don't depend on actual
 * staging on disk — the production code path is straightforward, but the
 * gate (only macOS injects) and the prepend order (host-arch first, then
 * other arch, then agnes bin) are regression-prone and worth pinning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/runtime')>();
  return {
    ...actual,
    getBundledPythonBinDir: vi.fn(),
    getBundledAgnesMcpBinDirs: vi.fn(() => []),
    getBundledCusePath: vi.fn(() => null),
    findPipInstalledUvxScriptsDir: vi.fn(() => null),
  };
});

import { transformMcpServerForSpawn } from './mcp-server-transform';
import {
  getBundledAgnesMcpBinDirs,
  getBundledPythonBinDir,
} from '../utils/runtime';

const PY_ARM = '/Resources/python-arm64/bin';
const PY_X64 = '/Resources/python-x64/bin';
const AGNES_ARM = '/Resources/hosted-mcps/agnes-video-25-mcp-arm64/bin';
const AGNES_X64 = '/Resources/hosted-mcps/agnes-video-25-mcp-x64/bin';

describe('transformMcpServerForSpawn — macOS PATH injection', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    vi.mocked(getBundledPythonBinDir).mockReset();
    vi.mocked(getBundledAgnesMcpBinDirs).mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  function setPlatformDarwinArm64() {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
  }

  it('on darwin/arm64 injects bundled python + agnes bin into PATH, host arch first', async () => {
    setPlatformDarwinArm64();
    vi.mocked(getBundledPythonBinDir).mockImplementation((arch?: 'arm64' | 'x64') =>
      arch === 'arm64' ? PY_ARM : arch === 'x64' ? PY_X64 : null,
    );
    vi.mocked(getBundledAgnesMcpBinDirs).mockReturnValue([AGNES_ARM, AGNES_X64]);

    const result = await transformMcpServerForSpawn({
      id: 'multimedia-creator',
      name: 'multimedia-creator',
      isBuiltin: true,
      type: 'stdio',
      command: 'agnes-video-25-mcp',
      args: [],
      env: {},
    });

    expect(result.spawn).not.toBeNull();
    const path = result.spawn!.env.PATH;
    // host arch (arm64) must come BEFORE other arch (x64) for python dirs
    expect(path.indexOf(PY_ARM)).toBeLessThan(path.indexOf(PY_X64));
    // python dirs come first, then agnes bin dirs (prepend order)
    expect(path.startsWith(`${PY_ARM}:${PY_X64}:`)).toBe(true);
    expect(path).toContain(`:${AGNES_ARM}:`);
    expect(path).toContain(`:${AGNES_X64}:`);
    // original PATH preserved at the end
    expect(path.endsWith(process.env.PATH ?? '')).toBe(true);
  });

  it('on darwin/x64 host prefers x64 python bin first', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    vi.mocked(getBundledPythonBinDir).mockImplementation((arch?: 'arm64' | 'x64') =>
      arch === 'x64' ? PY_X64 : arch === 'arm64' ? PY_ARM : null,
    );
    vi.mocked(getBundledAgnesMcpBinDirs).mockReturnValue([AGNES_ARM, AGNES_X64]);

    const result = await transformMcpServerForSpawn({
      id: 'multimedia-creator',
      name: 'multimedia-creator',
      isBuiltin: true,
      type: 'stdio',
      command: 'agnes-video-25-mcp',
      args: [],
      env: {},
    });

    const path = result.spawn!.env.PATH;
    expect(path.indexOf(PY_X64)).toBeLessThan(path.indexOf(PY_ARM));
  });

  it('on non-darwin (e.g. linux), PATH starts with the platform-rebuilt fallback (not raw parentEnv.PATH)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    vi.mocked(getBundledPythonBinDir).mockReturnValue(null);
    vi.mocked(getBundledAgnesMcpBinDirs).mockReturnValue([]);

    const result = await transformMcpServerForSpawn({
      id: 'multimedia-creator',
      name: 'multimedia-creator',
      isBuiltin: true,
      type: 'stdio',
      command: 'agnes-video-25-mcp',
      args: [],
      env: {},
    });

    const pathStr = result.spawn!.env.PATH;
    // The PATH now comes from getShellPath() which prepends platform fallback
    // (homebrew, /usr/bin, bundled node, etc.) so an MCP child spawned by a
    // Sidecar launched without a login shell PATH can still find binaries.
    expect(pathStr).toBeTruthy();
    expect(pathStr.split(':')[0]).toMatch(/opt\/homebrew|usr\/local|usr\/bin|bin/);
    // Inherited PATH is preserved at the tail.
    expect(pathStr.endsWith(process.env.PATH ?? '')).toBe(true);
  });

  it('skips missing staging dirs (helper returns null) without breaking PATH', async () => {
    setPlatformDarwinArm64();
    // arm64 staging present, x64 missing → only arm64 dir prepended
    vi.mocked(getBundledPythonBinDir).mockImplementation((arch?: 'arm64' | 'x64') =>
      arch === 'arm64' ? PY_ARM : null,
    );
    vi.mocked(getBundledAgnesMcpBinDirs).mockReturnValue([AGNES_ARM]); // only arm64

    const originalPath = process.env.PATH ?? '';
    const result = await transformMcpServerForSpawn({
      id: 'multimedia-creator',
      name: 'multimedia-creator',
      isBuiltin: true,
      type: 'stdio',
      command: 'agnes-video-25-mcp',
      args: [],
      env: {},
    });

    const path = result.spawn!.env.PATH;
    expect(path.startsWith(`${PY_ARM}:${AGNES_ARM}:`)).toBe(true);
    expect(path.endsWith(originalPath)).toBe(true);
    expect(path).not.toContain(PY_X64); // null filtered
  });

  it('non-stdio server: returns null without touching env', async () => {
    setPlatformDarwinArm64();
    const result = await transformMcpServerForSpawn({
      id: 'stock-datasource',
      name: 'stock-datasource',
      isBuiltin: false,
      type: 'http',
      url: 'http://example.com/mcp',
      env: {},
    });
    expect(result.spawn).toBeNull();
    expect(result.skipReason).toMatch(/non-stdio/);
  });
});

describe('transformMcpServerForSpawn — npx resolution', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(getBundledPythonBinDir).mockReset().mockReturnValue(null);
    vi.mocked(getBundledAgnesMcpBinDirs).mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('on win32 spawns the resolved command verbatim (resolver hands back node.exe+npx-cli.js)', async () => {
    // The Windows-npx strategy (node.exe + npx-cli.js) is asserted in
    // utils/mcp-command.unit.test.ts; here we only need to confirm transform
    // does not re-introduce a .cmd shim via PATH prepend. We mock the
    // resolver to return a known node.exe path so the assertion is stable
    // across dev boxes (which may or may not have a staged Win node).
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const spy = vi.spyOn(
      await import('../utils/mcp-command'),
      'resolveNpxMcpInvocation',
    );
    spy.mockReturnValue({
      command: 'C:\\staged\\node\\node.exe',
      args: ['C:\\staged\\node\\node_modules\\npm\\bin\\npx-cli.js', '-y', '@mobilenext/mobile-mcp@latest'],
      source: 'bundled',
    });

    const result = await transformMcpServerForSpawn({
      id: 'mobile-control',
      name: 'mobile-control',
      isBuiltin: true,
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@mobilenext/mobile-mcp@latest'],
      env: {},
    });

    expect(result.spawn!.command.toLowerCase()).toMatch(/node\.exe$/);
    expect(result.spawn!.command.toLowerCase()).not.toMatch(/npx\.cmd$/);
    expect(result.spawn!.args[0]).toMatch(/npx-cli\.js$/);
    expect(result.spawn!.args.slice(1)).toEqual(['-y', '@mobilenext/mobile-mcp@latest']);
    spy.mockRestore();
  });

  it('on darwin keeps the direct npx binary (no shim layer to bypass)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const result = await transformMcpServerForSpawn({
      id: 'mobile-control',
      name: 'mobile-control',
      isBuiltin: true,
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@mobilenext/mobile-mcp@latest'],
      env: {},
    });

    expect(result.spawn!.command).toMatch(/npx$/);
    expect(result.spawn!.args).toEqual(['-y', '@mobilenext/mobile-mcp@latest']);
  });
});
