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

  it('on non-darwin (e.g. linux), PATH is unchanged for agnes command', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    vi.mocked(getBundledPythonBinDir).mockReturnValue(null);
    vi.mocked(getBundledAgnesMcpBinDirs).mockReturnValue([]);

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

    expect(result.spawn!.env.PATH).toBe(originalPath);
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
