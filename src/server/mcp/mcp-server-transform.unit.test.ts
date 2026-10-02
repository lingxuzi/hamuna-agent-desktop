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

import * as shellUtils from '../utils/shell';

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
  findPipInstalledUvxScriptsDir,
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

  it('on win32 prefixes PATH with the resolver-chosen nodeDir (npx inner-spawn node lookup)', async () => {
    // Regression for the "node is not recognized" symptom: npx-cli.js spawns
    // `node` internally; that inner `node` resolves against the subprocess
    // PATH, not the parent shell. `getShellPath()` puts bundled Node around
    // slot #7 (after PROGRAMFILES/nodejs etc.), so without pinning nodeDir to
    // the front the inner spawn can land on an uninstalled / mismatched
    // system Node. MyAgents `buildMcpStdioLaunchConfig` solves this; we
    // mirror the contract here.
    //
    // The transform routes `dirname` through `__pathModuleForTest` (a
    // mutable holder) so tests can spyOn/replace individual functions on a
    // Linux CI runner without snapshotting `process.platform` at module
    // load time. ESM module namespaces are non-configurable so the seam
    // has to be a plain mutable binding rather than an export.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const transformModule = await import('./mcp-server-transform');
    const pathHolder = transformModule.__pathModuleForTest;
    const originalDirname = pathHolder.dirname;
    const win32Dirname = (p: string): string => {
      const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
      return idx <= 0 ? '.' : p.slice(0, idx);
    };
    const dirnameSpy = vi.spyOn(pathHolder, 'dirname').mockImplementation(win32Dirname);
    const spy = vi.spyOn(
      await import('../utils/mcp-command'),
      'resolveNpxMcpInvocation',
    );
    const nodeDir = 'C:\\staged\\node';
    spy.mockReturnValue({
      command: `${nodeDir}\\node.exe`,
      args: [`${nodeDir}\\node_modules\\npm\\bin\\npx-cli.js`, '-y', '@mobilenext/mobile-mcp@latest'],
      source: 'bundled',
    });

    try {
      const result = await transformMcpServerForSpawn({
        id: 'mobile-control',
        name: 'mobile-control',
        isBuiltin: true,
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@mobilenext/mobile-mcp@latest'],
        env: {},
      });

      const pathKey = 'Path';
      const pathStr = result.spawn!.env[pathKey];
      expect(pathStr).toBeTruthy();
      // nodeDir must be the FIRST entry.
      expect(pathStr!.split(';')[0].toLowerCase()).toBe(nodeDir.toLowerCase());
      // And it must NOT appear again later (case-insensitive on win32).
      const restEntries = pathStr!.split(';').slice(1);
      expect(restEntries.some((e) => e.toLowerCase() === nodeDir.toLowerCase())).toBe(false);
      expect(dirnameSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      dirnameSpy.mockRestore();
      // Belt-and-suspenders: re-bind to the original in case the spy
      // call didn't fully clean up.
      pathHolder.dirname = originalDirname;
    }
  });

  it('on win32 dedupes a case-insensitive pre-existing nodeDir entry (case-insensitive move-to-front)', async () => {
    // Realistic scenario: getShellPath() already included
    // `C:\Program Files\nodejs` (system Node); the resolver picks
    // `C:\staged\node` (bundled). We want the bundled node first AND the
    // system entry preserved (later in PATH) — but never duplicated.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const transformModule = await import('./mcp-server-transform');
    const pathHolder = transformModule.__pathModuleForTest;
    const originalDirname = pathHolder.dirname;
    const win32Dirname = (p: string): string => {
      const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
      return idx <= 0 ? '.' : p.slice(0, idx);
    };
    const dirnameSpy = vi.spyOn(pathHolder, 'dirname').mockImplementation(win32Dirname);
    const spy = vi.spyOn(
      await import('../utils/mcp-command'),
      'resolveNpxMcpInvocation',
    );
    const nodeDir = 'C:\\staged\\node';
    spy.mockReturnValue({
      command: `${nodeDir}\\node.exe`,
      args: [`${nodeDir}\\node_modules\\npm\\bin\\npx-cli.js`, '-y', '@mobilenext/mobile-mcp@latest'],
      source: 'bundled',
    });
    // Force PATH to contain nodeDir in a different position + case, plus a
    // unrelated system Node entry that should be preserved.
    const fakePath = `C:\\Program Files\\nodejs;${nodeDir.toUpperCase()};C:\\Windows\\System32`;
    vi.spyOn(await import('../utils/shell'), 'getShellPath').mockReturnValue(fakePath);

    try {
      const result = await transformMcpServerForSpawn({
        id: 'mobile-control',
        name: 'mobile-control',
        isBuiltin: true,
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@mobilenext/mobile-mcp@latest'],
        env: {},
      });

      const pathKey = 'Path';
      const pathStr = result.spawn!.env[pathKey];
      const entries = pathStr!.split(';');
      expect(entries[0].toLowerCase()).toBe(nodeDir.toLowerCase());
      // nodeDir appears exactly once (case-insensitive dedupe).
      const occurrences = entries.filter((e) => e.toLowerCase() === nodeDir.toLowerCase()).length;
      expect(occurrences).toBe(1);
      // Unrelated system Node entry is preserved later.
      expect(pathStr).toContain('C:\\Program Files\\nodejs');
      expect(pathStr).toContain('C:\\Windows\\System32');
    } finally {
      spy.mockRestore();
      dirnameSpy.mockRestore();
      pathHolder.dirname = originalDirname;
    }
  });
});

describe('transformMcpServerForSpawn — Windows uv PATH injection', () => {
  const originalPlatform = process.platform;
  const UV_SCRIPTS = 'C:\\Users\\tester\\AppData\\Roaming\\Python\\Python312\\Scripts';
  const BASE_PATH = 'C:\\Windows\\System32;C:\\staged\\node';
  // win32 uses the `Path` spelling. The transform must leave EXACTLY ONE
  // path-ish key in the env: `buildMcpSubprocessEnv` seeds the POSIX-spelled
  // `PATH`, and a leftover `PATH` alongside `Path` makes Node's spawn pick the
  // sort-order winner (`PATH`) and drop the injected value entirely.
  const PATH_KEY = 'Path';

  let shellPathSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(findPipInstalledUvxScriptsDir).mockReset().mockReturnValue(null);
    vi.mocked(getBundledPythonBinDir).mockReset().mockReturnValue(null);
    vi.mocked(getBundledAgnesMcpBinDirs).mockReset().mockReturnValue([]);
    shellPathSpy = vi.spyOn(shellUtils, 'getShellPath').mockReturnValue(BASE_PATH);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    shellPathSpy.mockRestore();
  });

  function stdioServer(command: string) {
    return {
      id: 'probe',
      name: 'probe',
      isBuiltin: true,
      type: 'stdio' as const,
      command,
      args: [],
      env: {},
    };
  }

  // Both spellings must be probed: `uvx` is the documented Python-MCP
  // launcher, but the bundled multimedia-creator MCP declares bare `"command":
  // "uv"` (with `tool run --from ...`). Gating on `uvx` alone left that
  // server with an unresolvable `uv` → spawn ENOENT.
  it.each(['uv', 'uvx'])(
    'prepends the pip Scripts dir for a bare %s command',
    async (command) => {
      vi.mocked(findPipInstalledUvxScriptsDir).mockReturnValue(UV_SCRIPTS);

      const result = await transformMcpServerForSpawn(stdioServer(command));

      expect(result.spawn!.env[PATH_KEY]).toBe(`${UV_SCRIPTS};${BASE_PATH}`);
    },
  );

  it('leaves PATH untouched when the probe finds no install', async () => {
    vi.mocked(findPipInstalledUvxScriptsDir).mockReturnValue(null);

    const result = await transformMcpServerForSpawn(stdioServer('uv'));

    expect(result.spawn!.env[PATH_KEY]).toBe(BASE_PATH);
  });

  it('does not probe for unrelated commands', async () => {
    vi.mocked(findPipInstalledUvxScriptsDir).mockReturnValue(UV_SCRIPTS);

    await transformMcpServerForSpawn(stdioServer('some-other-tool'));

    expect(findPipInstalledUvxScriptsDir).not.toHaveBeenCalled();
  });

  // Regression guard for a bug that made EVERY Windows PATH injection above a
  // no-op while the whole suite stayed green: `buildMcpSubprocessEnv` seeds
  // `env.PATH`, the transform wrote `env.Path`, and the child process saw only
  // the raw inherited value. Node serialises a spawn env into the Win32 env
  // block — a case-insensitive sorted array, not a map — so with both keys
  // present the sort-order winner (`PATH`) is the one the child resolves.
  // Assert on the surviving keys, not on the value under `Path`, because the
  // value looked right in the object while being dropped at spawn time.
  it('emits exactly one path-ish key so the injected value survives spawn', async () => {
    vi.mocked(findPipInstalledUvxScriptsDir).mockReturnValue(UV_SCRIPTS);

    const result = await transformMcpServerForSpawn(stdioServer('uvx'));

    const pathKeys = Object.keys(result.spawn!.env).filter((k) => /^path$/i.test(k));
    expect(pathKeys).toEqual([PATH_KEY]);
  });
});

describe('transformMcpServerForSpawn — npx npm env', () => {
  function npxServer(overrides: Record<string, unknown> = {}) {
    return {
      id: 'probe',
      name: 'probe',
      isBuiltin: true,
      type: 'stdio' as const,
      command: 'npx',
      args: ['-y', 'some-mcp'],
      env: {},
      ...overrides,
    };
  }

  it('sets prefer-offline on npx servers so a warm cache skips the registry', async () => {
    const result = await transformMcpServerForSpawn(npxServer());

    expect(result.spawn).not.toBeNull();
    // npx revalidates the packument on every run without this — the single
    // biggest contributor to slow MCP enable/startup on a poor link.
    expect(result.spawn!.env.NPM_CONFIG_PREFER_OFFLINE).toBe('true');
  });

  it('does not inject npm env into non-npx servers', async () => {
    const result = await transformMcpServerForSpawn({
      id: 'probe',
      name: 'probe',
      isBuiltin: true,
      type: 'stdio',
      command: 'some-other-tool',
      args: [],
      env: {},
    });

    expect(result.spawn!.env.NPM_CONFIG_PREFER_OFFLINE).toBeUndefined();
  });

  it('leaves registry unset unless explicitly opted in', async () => {
    const result = await transformMcpServerForSpawn(npxServer());

    // No hardcoded mirror — corporate/private registries must keep resolving.
    expect(result.spawn!.env.NPM_CONFIG_REGISTRY).toBeUndefined();
  });
});
