/**
 * Per-server spawn-shape transformation shared by SDK assembly
 * (`buildSdkMcpServers` in `agent-session.ts`) and the
 * `/api/mcp/enable` startup validator.
 *
 * Single source of truth for:
 *  - `__bundled_cuse__` sentinel → platform-specific cuse binary path
 *  - `npx` → system npx → bundled Node.js npx → bun x (via `resolveNpxMcpInvocation`)
 *  - env assembly (proxy + NO_PROXY enforcement via `buildMcpSubprocessEnv`)
 *  - `uvx` PATH injection on Windows (last-resort probe for pip-installed uvx)
 *  - macOS bundled Python + agnes-video-25-mcp PATH injection (DMG has no install-time hook;
 *    build-time staging under `src-tauri/resources/{python,hosted-mcps/agnes-video-25-mcp}-<arch>/`)
 *  - Playwright `--isolated` arg → `--storage-state=<userdir>/browser-storage-state.json`
 *
 * `__builtin__` (in-process) is intentionally NOT routed through this helper —
 * it's handled at the call site before calling `transformMcpServerForSpawn`.
 *
 * ponytail: helper used by both SDK runtime spawn and the activation
 * preflight. If a third caller appears (e.g. `handleMcpTest`), fold its
 * duplicated transformation into this helper instead of copy-pasting.
 */
import { existsSync } from 'fs';
import * as nodePath from 'path';

// Mutable holder so tests can swap the path.dirname / path.join behaviour
// via `vi.spyOn(pathModule, 'dirname')` — ESM module namespaces are
// non-configurable, so the seam has to be a plain mutable binding rather
// than an export. Production callers read through `dirname` / `pathJoin`
// (local function refs) so test replacements actually take effect.
const pathModule: { dirname: (p: string) => string; join: (...parts: string[]) => string } = {
  dirname: (p: string) => nodePath.dirname(p),
  join: (...parts: string[]) => nodePath.join(...parts),
};
const dirname: (p: string) => string = (p: string) => pathModule.dirname(p);
const pathJoin: (...parts: string[]) => string = (...parts: string[]) => pathModule.join(...parts);

// Test-only export of the mutable holder so vitest can spyOn/replace
// individual functions. NOT intended for production callers — production
// code uses `dirname` / `pathJoin` above.
export const __pathModuleForTest = pathModule;

import type { McpServerDefinition } from '../../shared/config-types';
import { applyNpmEnv, buildMcpSubprocessEnv } from '../session-core/mcp-env-policy';
import { resolveNpxMcpInvocation } from '../utils/mcp-command';
import { getHamunaAgentUserDir } from '../utils/project-user-config-sync';
import { getShellPath } from '../utils/shell';
import {
  findPipInstalledUvxScriptsDir,
  getBundledAgnesMcpBinDirs,
  getBundledCusePath,
  getBundledPythonBinDir,
} from '../utils/runtime';

export interface SpawnShape {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface TransformResult {
  /** null = server should be skipped entirely (e.g. bundled cuse binary missing on this platform).
   *  Callers must treat this as a "do not include" signal, NOT as an error to surface to the user. */
  spawn: SpawnShape | null;
  /** Optional human-readable explanation when spawn is null — for log lines, not for UI. */
  skipReason?: string;
}

export async function transformMcpServerForSpawn(
  server: McpServerDefinition,
): Promise<TransformResult> {
  if (server.type !== 'stdio' || !server.command) {
    // SSE / HTTP / unrecognised type: out of scope for the stdio startup
    // validator. Returns null so callers skip.
    return { spawn: null, skipReason: `non-stdio type: ${server.type}` };
  }

  let command = server.command;
  // Defensive: args may be non-array (e.g. boolean `true`) due to CLI parsing bugs
  // or manual config edits — mirrors buildSdkMcpServers.
  let args = [...(Array.isArray(server.args) ? server.args : [])];

  // Sentinel: bundled cuse (computer-use) binary — resolve to the
  // platform-specific path shipped in the app bundle. If missing (unsupported
  // platform, or dev build without the binary downloaded), skip with a reason.
  if (command === '__bundled_cuse__') {
    const cusePath = getBundledCusePath();
    if (!cusePath) {
      return {
        spawn: null,
        skipReason: `bundled cuse binary not found (platform=${process.platform})`,
      };
    }
    command = cusePath;
  }

  // Build MCP config with proxy env inherited from parent Sidecar.
  // MCP subprocesses need outbound proxy inheritance, while localhost still
  // needs NO_PROXY protection. Per-server env has final authority so users
  // can work around downstream proxy parser bugs for a specific MCP.
  //
  // PATH starts from `getShellPath()` — the platform-rebuilt PATH the Sidecar
  // also uses for itself (bundled Node, system Node, ~/.hamuna/bin, npm
  // global, Git, homebrew, NVM/fnm/volta, etc.). This matches what the
  // prewarm path in `/api/mcp/enable` already does, so an npx MCP enabled
  // via warmup and the same MCP spawned by the SDK both see identical
  // binary resolution. Bare inherited `process.env.PATH` is unreliable
  // when the Sidecar is launched by Tauri without a login shell.
  //
  // The two `delete`s are load-bearing, not defensive tidying.
  // `buildMcpSubprocessEnv` seeds the POSIX-spelled `PATH` key from the parent,
  // so on Windows the env object would otherwise carry BOTH `PATH` and `Path`.
  // Node's spawn serialises a JS env object into the Win32 env block — a
  // case-insensitive *sorted array*, not a map — and when two entries
  // case-vary the child resolves the sort-order winner and never sees the
  // other. `PATH` sorts before `Path`, so the raw inherited value won and
  // every injection below (getShellPath, the npx nodeDir pin, the uv Scripts
  // dir) was silently discarded: the MCP spawned with the parent PATH and
  // failed to resolve `node` / `uv` with spawn ENOENT. Verified on Windows
  // with a real `spawnSync` probe. `getShellEnv()` in utils/shell.ts deletes
  // both keys for the same reason; keep the two in sync.
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const env: Record<string, string> = buildMcpSubprocessEnv(process.env, server.env);
  delete env.PATH;
  delete env.Path;
  env[pathKey] = getShellPath();

  // For npx commands: prefer system npx → bundled Node.js npx → bun x.
  // On Windows the resolver returns `node.exe` + `npx-cli.js` directly,
  // bypassing the .cmd shim. But npx-cli.js internally spawns `node` (and
  // npm descendants do too) — that inner `node` is resolved against the
  // subprocess PATH, not the parent shell. `getShellPath()` puts bundled
  // Node around slot #7 (after PROGRAMFILES/nodejs etc.) and a nvm-windows
  // / Volta / fnm install on a non-default path can easily make the inner
  // `node` lookup land on an uninstalled / mismatched system Node, so the
  // child surface reports `node is not recognized as an internal or
  // external command` even though npx-cli.js itself spawned successfully.
  // MyAgents `buildMcpStdioLaunchConfig` solves this by pinning the
  // resolver's chosen nodeDir to the FRONT of PATH (re-inserting the
  // existing entry if it was already present elsewhere). We mirror that
  // contract here — both on Windows (where the bug shows up) and POSIX
  // (where `npx` shell shebang also resolves `node` via PATH).
  if (command === 'npx') {
    const invocation = resolveNpxMcpInvocation(args, {
      pinPresetPackages: server.isBuiltin === true,
    });
    command = invocation.command;
    args = invocation.args;
    const nodeDir = dirname(command);
    const separator = process.platform === 'win32' ? ';' : ':';
    const equal = (entry: string): boolean => process.platform === 'win32'
      ? entry.toLowerCase() === nodeDir.toLowerCase()
      : entry === nodeDir;
    env[pathKey] = [
      nodeDir,
      ...env[pathKey].split(separator).filter((entry) => entry && !equal(entry)),
    ].join(separator);
    // npx revalidates against the registry on every run even when the tarball
    // is already cached; prefer-offline lets a warm cache short-circuit that.
    applyNpmEnv(env, process.env, server.env);
  }

  // uv / uvx PATH injection (Windows only). The Windows installer no longer
  // bundles a uv binary — it runs `pip install --user uv` and registers the
  // resulting Scripts dir on HKCU\Environment\Path. The probe below is a
  // last-resort fallback for the cases where that registration is not in
  // effect yet: the installer skips the whole step in update mode, swallows
  // any failure, and Windows only refreshes the environment for *newly
  // spawned* processes — so a Sidecar started before the registry write
  // still has a PATH without the Scripts dir.
  //
  // Both spellings must be probed. `uvx` is the documented way to run a
  // Python-hosted MCP, but the bundled `multimedia-creator` MCP (see
  // extended_buildin_mcp/mcp.json) declares `"command": "uv"` with
  // `tool run --from ...` — gating on `uvx` alone left that server with a
  // bare `uv` that no PATH entry resolves, and it failed the enable-time
  // handshake with spawn ENOENT ("命令 uv 未找到").
  //
  // macOS/Linux rely on Homebrew / system uv being on PATH.
  if (command === 'uv' || command === 'uvx') {
    const scriptsDir = findPipInstalledUvxScriptsDir();
    if (scriptsDir) {
      const delimiter = process.platform === 'win32' ? ';' : ':';
      env[pathKey] = `${scriptsDir}${delimiter}${env[pathKey]}`;
    }
  }

  // macOS: prepend bundled Python + agnes-video-25-mcp bin dirs to PATH.
  // DMG 没有 install-time hook, build-time staging 把 python-build-standalone
  // + uv (pip install --target) 产物打进 Contents/Resources/. MCP subprocess
  // 通过 PATH 查找 `agnes-video-25-mcp` (用户拍板 mcp.json 维持 bare `command`).
  //
  // 注入两条路径:
  //   - python-<arch>/bin            → `python` / `python3`, `pip` (transitively uv via `python -m uv`)
  //   - hosted-mcps/agnes-video-25-mcp-<arch>/bin → `agnes-video-25-mcp` console script
  //
  // arch 注入两个 (arm64 + x64) 而非 process.arch 一个, 覆盖 rosetta / universal
  // 二进制启动场景; 与 build_macos.sh 双 arch ship 策略对齐. 不存在的路径
  // 由 helper 内部 existsSync 过滤, 不会污染 PATH.
  //
  // 只对 macOS 注入 (Linux 端未来跟 macOS 同款 build 模式时再扩). Windows
  // 由 NSIS §UvxFallback 走自己的 install-time hook, 此处不动.
  if (process.platform === 'darwin') {
    const delimiter = ':';
    const prepend: string[] = [];
    // host arch 优先, 这样 PATH 查找走最匹配的 binary
    const hostArch: 'arm64' | 'x64' = process.arch === 'arm64' ? 'arm64' : 'x64';
    const otherArch: 'arm64' | 'x64' = hostArch === 'arm64' ? 'x64' : 'arm64';
    for (const arch of [hostArch, otherArch]) {
      const pyDir = getBundledPythonBinDir(arch);
      if (pyDir) prepend.push(pyDir);
    }
    prepend.push(...getBundledAgnesMcpBinDirs());
    if (prepend.length > 0) {
      env[pathKey] = `${prepend.join(delimiter)}${delimiter}${env[pathKey]}`;
    }
  }

  // Playwright MCP: two user-selectable modes (configured in Settings UI):
  // - Isolated (--isolated): concurrent browser sessions, storage-state for login
  // - Persistent (--user-data-dir): full profile, single-session only
  // Backend just respects the args and injects --storage-state when applicable.
  if (server.id === 'playwright') {
    const hasIsolated = args.includes('--isolated');
    if (hasIsolated) {
      const storageStatePath = pathJoin(getHamunaAgentUserDir(), 'browser-storage-state.json');
      if (
        existsSync(storageStatePath) &&
        !args.some((a: string) => a.startsWith('--storage-state'))
      ) {
        args.push(`--storage-state=${storageStatePath}`);
      }
    }
  }

  return { spawn: { command, args, env } };
}
