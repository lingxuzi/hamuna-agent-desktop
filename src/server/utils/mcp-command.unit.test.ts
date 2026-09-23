import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>();
  return {
    ...actual,
    getBundledNodeDir: vi.fn(),
    getBundledNodePath: vi.fn(),
    getSystemNpxPaths: vi.fn(() => []),
    getSystemNodeDirs: vi.fn(() => []),
    findExistingPath: vi.fn(() => null),
  };
});

import { resolveNpxMcpInvocation } from './mcp-command';
import {
  findExistingPath,
  getBundledNodeDir,
  getBundledNodePath,
  getSystemNodeDirs,
  getSystemNpxPaths,
} from './runtime';

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
}

function createWindowsNodeDistribution(root: string): {
  nodePath: string;
  npxCliPath: string;
} {
  const nodePath = join(root, 'node.exe');
  const npxCliPath = join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
  touch(nodePath);
  touch(npxCliPath);
  return { nodePath, npxCliPath };
}

describe('resolveNpxMcpInvocation', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'hamuna-npx-'));
    vi.mocked(findExistingPath).mockReset().mockReturnValue(null);
    vi.mocked(getBundledNodeDir).mockReset().mockReturnValue(null);
    vi.mocked(getBundledNodePath).mockReset().mockReturnValue(null);
    vi.mocked(getSystemNpxPaths).mockReset().mockReturnValue([]);
    vi.mocked(getSystemNodeDirs).mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('on win32 projects system npx through node.exe and npx-cli.js (no .cmd shim)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const system = createWindowsNodeDistribution(join(testRoot, 'system-node'));
    vi.mocked(getSystemNodeDirs).mockReturnValue([dirname(system.nodePath)]);

    const invocation = resolveNpxMcpInvocation(['@playwright/mcp@0.0.68']);

    expect(invocation.command).toBe(system.nodePath);
    expect(invocation.command.toLowerCase()).not.toMatch(/npx\.cmd$/);
    expect(invocation.args[0]).toBe(system.npxCliPath);
    expect(invocation.args.slice(1)).toEqual(['-y', '@playwright/mcp@0.0.68']);
    expect(invocation.source).toBe('system');
  });

  it('on win32 prefers bundled Node over system Node when bundled is staged', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const system = createWindowsNodeDistribution(join(testRoot, 'system-node'));
    const bundled = createWindowsNodeDistribution(join(testRoot, 'bundled-node'));
    vi.mocked(getSystemNodeDirs).mockReturnValue([dirname(system.nodePath)]);
    vi.mocked(getBundledNodePath).mockReturnValue(bundled.nodePath);

    const invocation = resolveNpxMcpInvocation(['package-name']);

    expect(invocation.command).toBe(bundled.nodePath);
    expect(invocation.source).toBe('bundled');
  });

  it('on win32 throws NpxMcpResolutionError when no complete Node+npxCli pair exists', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    // system npx path exists but the node distribution behind it is incomplete
    // (no node.exe sibling or no node_modules/npm/bin/npx-cli.js)
    const incompleteDir = join(testRoot, 'incomplete');
    mkdirSync(incompleteDir, { recursive: true });
    vi.mocked(getSystemNodeDirs).mockReturnValue([incompleteDir]);
    vi.mocked(getSystemNpxPaths).mockReturnValue([join(incompleteDir, 'npx.cmd')]);

    expect(() => resolveNpxMcpInvocation(['package-name'])).toThrow(
      'No usable Node.js / npx was found for MCP startup',
    );
  });

  it('on darwin keeps the direct absolute npx executable contract', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(findExistingPath).mockReturnValue('/usr/local/bin/npx');
    vi.mocked(getSystemNpxPaths).mockReturnValue(['/usr/local/bin/npx']);

    const invocation = resolveNpxMcpInvocation(['package-name', '-y']);

    expect(invocation.command).toBe('/usr/local/bin/npx');
    expect(invocation.args).toEqual(['package-name', '-y']); // -y already present, don't double-add
    expect(invocation.source).toBe('system');
  });

  it('prepends -y when not already in args', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(findExistingPath).mockReturnValue('/usr/local/bin/npx');

    const invocation = resolveNpxMcpInvocation(['package-name']);

    expect(invocation.args).toEqual(['-y', 'package-name']);
  });

  it('does not double-add -y when caller passed --yes (long form)', () => {
    // npm <7 / explicit long form should be treated equivalently to -y so we
    // don't produce `npx -y --yes <pkg>` argv noise.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(findExistingPath).mockReturnValue('/usr/local/bin/npx');

    const invocation = resolveNpxMcpInvocation(['--yes', 'package-name']);

    expect(invocation.args).toEqual(['--yes', 'package-name']);
  });

  it('on darwin throws NpxMcpResolutionError when no system npx and no bundled Node (mirrors win32 branch)', () => {
    // Previously the POSIX branch silently returned `resolve('.', 'npx')` =
    // `<cwd>/npx` which never exists, producing ENOENT at spawn with no
    // diagnostic. Mirror the win32 throw so callers get one actionable error
    // regardless of platform.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(findExistingPath).mockReturnValue(null);
    vi.mocked(getSystemNpxPaths).mockReturnValue([]);
    vi.mocked(getBundledNodeDir).mockReturnValue(null);

    expect(() => resolveNpxMcpInvocation(['package-name'])).toThrow(
      'No usable Node.js / npx was found for MCP startup',
    );
  });
});