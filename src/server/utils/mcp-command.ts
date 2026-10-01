import { existsSync } from 'fs';
import { dirname, resolve } from 'path';

import { pinPresetMcpPackageVersions } from '../../shared/mcpPackages';
import {
  findExistingPath,
  getBundledNodeDir,
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
    super('No usable Node.js / npx was found for MCP startup. On Windows this means the bundled nodejs/ tree is incomplete (npm.cmd + npx.cmd + node_modules/npm/bin/npx-cli.js are required); on macOS/Linux install Node.js 20+ so `npx` is on PATH. If you just upgraded HamunaAgent on Windows, fully uninstall the previous version (Control Panel → Programs) and reinstall — see snapshot TODO #187.');
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
  // Recognize both `-y` (npm 7+ short) and `--yes` (npm <7 / explicit long) as
  // pre-existing auto-confirm flags so we don't prepend `-y` and produce
  // `npx -y --yes <pkg>` (npx tolerates the duplicate but it's noise on argv).
  const hasYes = normalizedArgs.includes('-y') || normalizedArgs.includes('--yes');
  const withYes = hasYes ? normalizedArgs : ['-y', ...normalizedArgs];

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

  // POSIX path mirrors Windows: refuse to return a relative / non-existent
  // `npx` path that would fail silently at spawn (ENOENT). `getBundledRuntimePath`
  // // Already RETURNS the string literal `'node'` as a last-resort PATH fallback,
  // // and `dirname('node')` resolves to '.' (current working directory) where
  // // there's no `npx`. Throwing here gives the caller a single, actionable
  // // error matching the Windows branch — same bug class, same fix.
  throw new NpxMcpResolutionError();
}
