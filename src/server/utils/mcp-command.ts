import { existsSync } from 'fs';
import { dirname, resolve } from 'path';

import { pinPresetMcpPackageVersions } from '../../shared/mcpPackages';
import {
  findExistingPath,
  getBundledNodeDir,
  getBundledRuntimePath,
  getBundledNodePath,
  getSystemNodeDirs,
  getSystemNpxPaths,
} from './runtime';

export interface ResolvedNpxMcpInvocation {
  command: string;
  args: string[];
  source: 'system' | 'bundled' | 'runtime-sibling';
}

export class NpxMcpResolutionError extends Error {
  constructor() {
    super('No complete Windows Node.js distribution with npm/bin/npx-cli.js was found for MCP startup');
    this.name = 'NpxMcpResolutionError';
  }
}

/**
 * Resolve a `npx` invocation that bypasses the .cmd shim on Windows.
 * `npx.cmd` is a one-line launcher that re-spawns `node.exe`; if PATH misses
 * node.exe (common when the Sidecar is launched by Tauri without a login
 * shell PATH) cmd.exe reports `node is not recognized as an internal or
 * external command` and the spawn fails before any handshake. Returning
 * { command: node.exe, args: [npx-cli.js, ...withYes] } removes the shim
 * layer entirely — npm ships npx-cli.js inside every Node distribution.
 */
function resolveWindowsNodeNpxInvocation(
  nodePath: string,
  args: readonly string[],
  source: ResolvedNpxMcpInvocation['source'],
): ResolvedNpxMcpInvocation | null {
  const npxCliPath = resolve(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!existsSync(nodePath) || !existsSync(npxCliPath)) return null;
  return { command: nodePath, args: [npxCliPath, ...args], source };
}

/**
 * Resolve a product-owned `npx` MCP invocation once, before handing it to an
 * SDK/runtime process. Both builtin Claude and managed Codex consume this
 * owner so they cannot drift on package pinning or bundled Node fallback.
 *
 * Windows strategy: bypass the .cmd shim and spawn `node.exe` directly with
 * `npx-cli.js` as argv[1]. POSIX keeps the direct `npx` binary — there's no
 * shim layer to worry about on Mac/Linux.
 */
export function resolveNpxMcpInvocation(
  args: readonly string[],
  options: { pinPresetPackages?: boolean } = {},
): ResolvedNpxMcpInvocation {
  const normalizedArgs = options.pinPresetPackages
    ? pinPresetMcpPackageVersions(args)
    : [...args];
  const withYes = normalizedArgs.includes('-y') ? normalizedArgs : ['-y', ...normalizedArgs];

  if (process.platform === 'win32') {
    // Bundled first — installer guarantees a complete Node distribution with
    // npm bundled in (Node 16.7+ ships npm 7+ which carries npx-cli.js).
    const bundledNode = getBundledNodePath();
    if (bundledNode) {
      const invocation = resolveWindowsNodeNpxInvocation(bundledNode, withYes, 'bundled');
      if (invocation) return invocation;
    }

    // Then every system-installed Node we know how to locate.
    for (const dir of getSystemNodeDirs()) {
      const nodePath = resolve(dir, 'node.exe');
      const invocation = resolveWindowsNodeNpxInvocation(nodePath, withYes, 'system');
      if (invocation) return invocation;
    }

    throw new NpxMcpResolutionError();
  }

  const systemNpx = findExistingPath(getSystemNpxPaths());
  if (systemNpx) {
    return { command: systemNpx, args: withYes, source: 'system' };
  }

  const bundledNodeDir = getBundledNodeDir();
  if (bundledNodeDir) {
    return {
      command: resolve(bundledNodeDir, 'npx'),
      args: withYes,
      source: 'bundled',
    };
  }

  const runtimePath = getBundledRuntimePath();
  return {
    command: resolve(dirname(runtimePath), 'npx'),
    args: withYes,
    source: 'runtime-sibling',
  };
}
