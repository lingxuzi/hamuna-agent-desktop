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
import { dirname, join } from 'path';

import type { McpServerDefinition } from '../../shared/config-types';
import { buildMcpSubprocessEnv } from '../session-core/mcp-env-policy';
import { resolveNpxMcpInvocation } from '../utils/mcp-command';
import { getHamunaAgentUserDir } from '../utils/project-user-config-sync';
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
  const env = buildMcpSubprocessEnv(process.env, server.env);

  // For npx commands: prefer system npx → bundled Node.js npx → bun x.
  // System Node.js is maintained by the user's package manager, more reliable
  // than our bundled npm. Bundled Node.js serves as fallback.
  if (command === 'npx') {
    const invocation = resolveNpxMcpInvocation(args, {
      pinPresetPackages: server.isBuiltin === true,
    });
    command = invocation.command;
    args = invocation.args;
    // Prepend the directory holding the resolved npx shim so the shim
    // itself can locate `node.exe` on Windows. `npx.cmd` is a one-line
    // Node launcher — if the Sidecar's inherited PATH omits the bundled
    // node dir (e.g. when launched by Tauri without an explicit shell
    // PATH), Windows cmd reports `node is not recognized as an internal
    // or external command` and the spawn fails before any handshake
    // attempt. The injected dir is the same one `resolveNpxMcpInvocation`
    // just selected, so bundled vs system npx both get the right node.
    // De-dup against the existing PATH to keep env size bounded.
    const npxDir = dirname(command);
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const sep = process.platform === 'win32' ? ';' : ':';
    const currentPath = env[pathKey] || '';
    if (!currentPath.split(sep).includes(npxDir)) {
      env[pathKey] = `${npxDir}${sep}${currentPath}`;
    }
  }

  // uvx PATH injection (Windows only). The Windows installer no longer bundles
  // a uvx.exe — it runs `pip install --user uv` and registers the resulting
  // Scripts dir on HKCU\Environment\Path. The probe below is a last-resort
  // fallback for the edge case where the user just installed and is launching
  // MCPs BEFORE Sidecar has restarted (inherited PATH still predates the
  // HKCU write — Windows only refreshes for newly-spawned procs).
  // macOS/Linux rely on Homebrew / system uv being on PATH.
  if (command === 'uvx') {
    const scriptsDir = findPipInstalledUvxScriptsDir();
    if (scriptsDir) {
      const delimiter = process.platform === 'win32' ? ';' : ':';
      env.PATH = `${scriptsDir}${delimiter}${env.PATH}`;
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
      env.PATH = `${prepend.join(delimiter)}${delimiter}${env.PATH}`;
    }
  }

  // Playwright MCP: two user-selectable modes (configured in Settings UI):
  // - Isolated (--isolated): concurrent browser sessions, storage-state for login
  // - Persistent (--user-data-dir): full profile, single-session only
  // Backend just respects the args and injects --storage-state when applicable.
  if (server.id === 'playwright') {
    const hasIsolated = args.includes('--isolated');
    if (hasIsolated) {
      const storageStatePath = join(getHamunaAgentUserDir(), 'browser-storage-state.json');
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
