/**
 * Runtime Path Utilities
 *
 * Provides functions to locate bundled bun or fallback to system runtimes.
 * This ensures the app can run without requiring users to have Node.js installed.
 */

import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Get script directory at runtime (not compile-time).
 * IMPORTANT: bun build hardcodes __dirname at compile time, breaking production builds.
 * This function uses import.meta.url which is evaluated at runtime.
 */
export function getScriptDir(): string {
  // For ESM modules: use import.meta.url
  if (typeof import.meta?.url === 'string') {
    return dirname(fileURLToPath(import.meta.url));
  }
  // Fallback for bundled environments - use cwd
  // NOTE: In production, sidecar.rs sets cwd to Resources directory
  console.warn('[getScriptDir] import.meta.url unavailable, falling back to cwd:', process.cwd());
  return process.cwd();
}

/**
 * Check if running on Windows
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Historical note: v0.1.x shipped with bundled Bun; this file used to expose
 * `getBundledBunPaths()`, `getBundledBunDir()`, `getSystemBunPaths()`, and
 * `isBunRuntime()`. v0.2.0 removed Bun from the app bundle — all runtime
 * lookups now go through Node.js helpers below (`getBundledNodePath`,
 * `getBundledNodeDir`, `getSystemNpxPaths`, etc.).
 *
 * Directory structure:
 * - Windows: Flat structure, bun.exe and server-dist.js in same directory
 *   C:\Users\xxx\AppData\Local\HamunaAgent\
 *   ├── bun.exe
 *   ├── server-dist.js
 *   └── hamuna.exe
 *
 * - macOS: App bundle structure
 *   HamunaAgent.app/Contents/
 *   ├── MacOS/bun         <- bundled bun
 *   └── Resources/server-dist.js  <- scriptDir
 */
// v0.2.0: Bun path-discovery helpers removed. HamunaAgent no longer bundles Bun;
// the SDK's own native binary contains its embedded Bun (SDK-team managed,
// unreachable to us). All bundled-runtime lookups now go through
// getBundledNodePath() / getBundledNodeDir() below.

/**
 * Get system node paths (user-installed).
 */
/**
 * Get system Node.js directories where node/npm/npx are co-located.
 * Single source of truth — node, npm, npx share the same directories.
 */
export function getSystemNodeDirs(): string[] {
  if (isWindows()) {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env.LOCALAPPDATA;
    const dirs: string[] = [];
    // Standard Node.js installer
    if (programFiles) dirs.push(resolve(programFiles, 'nodejs'));
    if (programFilesX86) dirs.push(resolve(programFilesX86, 'nodejs'));
    // nvm-windows: symlinks active version to NVM_SYMLINK (default: Program Files\nodejs)
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) dirs.push(nvmSymlink);
    // Volta: shims live in %LOCALAPPDATA%\Volta\bin
    if (localAppData) dirs.push(resolve(localAppData, 'Volta', 'bin'));
    // fnm: session-specific path via env var
    const fnmPath = process.env.FNM_MULTISHELL_PATH;
    if (fnmPath) dirs.push(fnmPath);
    return dirs;
  }

  const home = process.env.HOME || '';
  return [
    '/opt/homebrew/bin',      // macOS Homebrew (Apple Silicon)
    '/usr/local/bin',         // macOS Homebrew (Intel) / Linux manual install
    '/usr/bin',               // Linux apt/yum
    ...(home ? [
      `${home}/.volta/bin`,   // Volta
      `${home}/.nvm/current/bin`,  // nvm
      `${home}/.fnm/current/bin`,  // fnm
    ] : []),
  ];
}

function getSystemNodePaths(): string[] {
  const exe = isWindows() ? 'node.exe' : 'node';
  return getSystemNodeDirs().map(d => resolve(d, exe));
}

function getSystemNpmPaths(): string[] {
  const exe = isWindows() ? 'npm.cmd' : 'npm';
  return getSystemNodeDirs().map(d => resolve(d, exe));
}

export function getSystemNpxPaths(): string[] {
  const exe = isWindows() ? 'npx.cmd' : 'npx';
  return getSystemNodeDirs().map(d => resolve(d, exe));
}

/**
 * Find the first existing path from a list.
 */
export function findExistingPath(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Get the directory containing the bundled Node.js distribution.
 * Returns the directory that should be added to PATH so that `node`, `npm`, `npx`
 * are all available. Returns null if bundled Node.js is not found.
 *
 * Directory structure:
 * - macOS (prod):  Contents/Resources/nodejs/bin/  (contains node, npm, npx)
 * - macOS (dev):   src-tauri/resources/nodejs/bin/
 * - Windows (prod): <install_dir>/nodejs/           (contains node.exe, npm.cmd, npx.cmd)
 * - Windows (dev):  src-tauri/resources/nodejs/
 */
export function getBundledNodeDir(): string | null {
  const scriptDir = getScriptDir();

  if (isWindows()) {
    // Windows prod: nodejs/ is alongside server-dist.js
    const winDir = resolve(scriptDir, 'nodejs');
    if (existsSync(resolve(winDir, 'node.exe'))) {
      return winDir;
    }
  } else {
    // macOS prod: Contents/Resources/nodejs/bin/
    // scriptDir = Contents/Resources, so nodejs/bin/ is a subdirectory
    const macDir = resolve(scriptDir, 'nodejs', 'bin');
    if (existsSync(resolve(macDir, 'node'))) {
      return macDir;
    }
  }

  // Development: walk up from scriptDir to find src-tauri/resources/nodejs/
  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const devBinDir = resolve(dir, 'src-tauri', 'resources', 'nodejs', 'bin');
    const devWinDir = resolve(dir, 'src-tauri', 'resources', 'nodejs');
    if (!isWindows() && existsSync(resolve(devBinDir, 'node'))) {
      return devBinDir;
    }
    if (isWindows() && existsSync(resolve(devWinDir, 'node.exe'))) {
      return devWinDir;
    }
    dir = dirname(dir);
  }

  return null;
}

/**
 * Get the absolute path to the bundled Node.js binary.
 * Returns null if bundled Node.js is not found.
 */
export function getBundledNodePath(): string | null {
  const nodeDir = getBundledNodeDir();
  if (!nodeDir) return null;

  const nodeBin = isWindows() ? resolve(nodeDir, 'node.exe') : resolve(nodeDir, 'node');
  return existsSync(nodeBin) ? nodeBin : null;
}

/**
 * Get the path to the JavaScript runtime used to execute our own scripts
 * (sidecar entrypoint, plugin bridge, etc.).
 *
 * Priority:
 *   1. Bundled Node.js (app-local — guarantees a matching version)
 *   2. System Node.js (user-maintained, usually newer patch version)
 *   3. Literal "node" (last resort — relies on $PATH)
 *
 * v0.2.0+: Bun is no longer a candidate. The SDK carries its own runtime
 * inside the native binary; everything else runs on Node.js.
 */
export function getBundledRuntimePath(): string {
  const bundledNode = getBundledNodePath();
  if (bundledNode) {
    return bundledNode;
  }

  const systemNode = findExistingPath(getSystemNodePaths());
  if (systemNode) {
    return systemNode;
  }

  return 'node';
}

/**
 * Get the absolute path to the bundled cuse (computer-use MCP) binary.
 *
 * Layout mirrors bundled bun:
 * - macOS (prod):     <bundle>/Contents/MacOS/cuse
 * - Windows (prod):   <install-dir>/cuse.exe (flat, alongside bun.exe + server-dist.js)
 * - Dev:              <project>/src-tauri/binaries/cuse-<target-triple>[.exe]
 *
 * Returns null on unsupported platforms (Linux) or when the binary is
 * missing — callers (MCP resolver) are responsible for gracefully disabling
 * the cuse preset in that case.
 */
export function getBundledCusePath(): string | null {
  // Hard platform gate: cuse only ships macOS + Windows binaries.
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return null;
  }

  const scriptDir = getScriptDir();

  if (isWindows()) {
    // Production: flat layout, cuse.exe next to bun.exe / server-dist.js
    const prodBin = resolve(scriptDir, 'cuse.exe');
    if (existsSync(prodBin)) return prodBin;
  } else {
    // macOS production: Contents/MacOS/cuse (sibling of bun, via externalBin)
    const prodBin = resolve(scriptDir, '..', 'MacOS', 'cuse');
    if (existsSync(prodBin)) return prodBin;
  }

  // Development: walk up from scriptDir to find src-tauri/binaries/cuse-<triple>.
  // download_cuse.sh always writes both macOS target triples (same
  // universal binary), so checking the arch-matching triple is enough —
  // no alt-triple fallback needed.
  const triple = isWindows()
    ? 'cuse-x86_64-pc-windows-msvc.exe'
    : (process.arch === 'arm64'
        ? 'cuse-aarch64-apple-darwin'
        : 'cuse-x86_64-apple-darwin');

  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const devBin = resolve(dir, 'src-tauri', 'binaries', triple);
    if (existsSync(devBin)) return devBin;
    dir = dirname(dir);
  }

  return null;
}

/** Parse the `XY` out of a PEP 370 `PythonXY` dir name, or -1 if it isn't one. */
function pythonVersionOfDirName(name: string): number {
  const matched = /^Python(\d+)$/i.exec(name);
  return matched ? Number(matched[1]) : -1;
}

/**
 * Enumerate `<root>/PythonXY/Scripts` for every PEP 370 per-user Python
 * install found under the given roots, ordered by caller preference.
 *
 * Roots are ranked by the `roots` array order, NOT by Python version
 * across roots. `§UvxFallback` installs uv with
 * `pip install --user uv==0.11.33`, and `--user` redirects the install
 * target to the PEP 370 *roaming* user site regardless of which
 * interpreter invoked it — so the pinned, MCP-verified uv always lands
 * under `%APPDATA%\Roaming\Python`, never under the installer's own
 * `%LOCALAPPDATA%\Programs\Python`. Ranking the interpreter's own Scripts
 * dir first would prefer a *non*-`--user` uv (unpinned, possibly 0.12.x,
 * whose `uvx --from` parsing silently breaks the multimedia-creator MCP)
 * over the pin the installer deliberately applied.
 *
 * Within a single root the newest version wins. Enumerating at all
 * (instead of hardcoding `Python312`) is what lets the pin be found when
 * the installer targeted an interpreter other than 3.12.
 *
 * Missing roots are normal (most users have at most one of the two
 * layouts), so readdir failures are swallowed and the caller decides
 * via the `uvx.exe` presence check.
 */
function enumeratePythonScriptsDirs(roots: string[]): string[] {
  const found: { dir: string; version: number; rootIndex: number }[] = [];

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const version = pythonVersionOfDirName(name);
      if (version < 0) continue;
      found.push({ dir: join(root, name, 'Scripts'), version, rootIndex: i });
    }
  }

  return found
    .sort((a, b) => a.rootIndex - b.rootIndex || b.version - a.version || a.dir.localeCompare(b.dir))
    .map(item => item.dir);
}

/**
 * Locate the per-user pip-installed `uv` / `uvx` Scripts directory on
 * Windows. The HamunaAgent NSIS installer runs `pip install --user uv`
 * (via Section UvxFallback in installer.nsi), which PEP 370 places at
 * `%APPDATA%\Roaming\Python\PythonXY\Scripts\`. That path is NOT on the
 * system PATH by default — the installer also runs `uvx-path-setup.ps1`
 * to register it on HKCU\Environment\Path.
 *
 * Serves both binary names: pip's `uv` distribution installs `uv.exe`
 * and `uvx.exe` side by side, and MCP entries use either spelling
 * (`uv tool run --from ...` for the bundled multimedia-creator server,
 * `uvx <pkg>` for ad-hoc ones). `uvx.exe` is used as the presence probe
 * for the whole install, which is sound because the two always ship
 * together from the same wheel.
 *
 * This probe is the safety net for when that registration did not take
 * effect: the installer step is best-effort (it is skipped in update
 * mode, and any failure is swallowed so install proceeds), and Windows
 * only refreshes the environment for *newly spawned* processes — so a
 * Sidecar started before the registry write still has a PATH without
 * the Scripts dir. The MCP spawn path (`mcp-server-transform.ts`) calls
 * this to prepend the dir, which makes bare `uv` / `uvx` work
 * immediately rather than after an app restart.
 *
 * Returns null on non-Windows (macOS/Linux rely on Homebrew / system uv)
 * or when no per-user Python install carries a `uvx.exe`.
 */
export function findPipInstalledUvxScriptsDir(): string | null {
  if (!isWindows()) return null;

  // Two PEP 370 per-user layouts, in preference order:
  //   1. %APPDATA%\Roaming\Python\PythonXY — where §UvxFallback's
  //      `pip install --user uv==0.11.33` actually lands (`--user`
  //      overrides the invoking interpreter's own site), and the only
  //      one of the two that is NOT on PATH — i.e. the dir this probe
  //      exists to rescue. Holds the pinned, MCP-verified uv.
  //   2. %LOCALAPPDATA%\Programs\Python\PythonXY — the Python for
  //      Windows installer's Scripts dir, which the installer does put
  //      on HKCU\Environment\Path. A uv here is whatever the user
  //      installed without `--user`: unpinned, so only a fallback.
  // Ordering matters: see enumeratePythonScriptsDirs.
  const roots: string[] = [];
  const roaming = process.env.APPDATA;
  if (roaming) roots.push(resolve(roaming, 'Python'));
  const localApp = process.env.LOCALAPPDATA;
  if (localApp) roots.push(resolve(localApp, 'Programs', 'Python'));

  for (const scriptsDir of enumeratePythonScriptsDirs(roots)) {
    if (existsSync(join(scriptsDir, 'uvx.exe'))) return scriptsDir;
  }
  return null;
}

/**
 * Default arch for resolving bundled darwin runtime dirs. We default to the
 * current process arch so callers don't have to plumb it everywhere; the
 * Sidecar's MCP spawn path also probes the other arch for rosetta / universal
 * binary launches (see `getBundledAgnesMcpBinDirs` below).
 */
export function defaultBundledArch(): 'arm64' | 'x64' {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Get the absolute path to the bundled Python (python-build-standalone) bin
 * directory for a given darwin arch. MCP spawn prepends this to PATH so
 * `python -m uv` and `pip` resolve to our bundled Python instead of any
 * system install the user happens to have.
 *
 * Layout: `src-tauri/resources/python-<arch>/bin/` (production + dev both
 * via `getBundledResourcePath`).
 *
 * Returns null on non-macOS or when the staging dir is missing.
 */
export function getBundledPythonBinDir(arch: 'arm64' | 'x64' = defaultBundledArch()): string | null {
  if (process.platform !== 'darwin') return null;
  return getBundledResourcePath(`python-${arch}/bin`);
}

/**
 * Get the absolute path to the bundled agnes-video-25-mcp wheel's bin dir
 * (where pip's console_scripts entry point `agnes-video-25-mcp` lives) for
 * a given darwin arch. Prepending this to PATH lets the MCP server spawn
 * `command: "agnes-video-25-mcp"` (bare) without writing a wrapper script
 * (user 拍板: ship pip install --target 产物, 不写 wrapper).
 *
 * Returns null on non-macOS or when the staging dir is missing.
 */
export function getBundledAgnesMcpBinDir(arch: 'arm64' | 'x64' = defaultBundledArch()): string | null {
  if (process.platform !== 'darwin') return null;
  return getBundledResourcePath(`hosted-mcps/agnes-video-25-mcp-${arch}/bin`);
}

/**
 * Return both arm64 and x64 bundled darwin bin dirs (whichever are present
 * on disk) so the MCP spawn path can prepend both — covers rosetta launches
 * and matches build_macos.sh 双 arch ship 策略 (两个 arch 都 ship).
 *
 * Returns an empty array on non-macOS or when nothing is bundled.
 */
export function getBundledAgnesMcpBinDirs(): string[] {
  if (process.platform !== 'darwin') return [];
  const out: string[] = [];
  for (const arch of ['arm64', 'x64'] as const) {
    const dir = getBundledAgnesMcpBinDir(arch);
    if (dir) out.push(dir);
  }
  return out;
}

/**
 * Resolve an arbitrary resource that's bundled under `src-tauri/resources/`
 * (per `tauri.conf.json > bundle.resources`). The Tauri build copies each
 * entry to a path relative to the sidecar's `scriptDir` in production; in
 * dev we walk up from `scriptDir` looking for `src-tauri/resources/`.
 *
 * Returns the absolute path on disk if found, otherwise `null`. Callers
 * fall back to a remote fetch when the bundled copy is missing (e.g.
 * older builds that predate the bundling).
 *
 * Mirrors the production / dev split used by `getBundledNodeDir` and
 * `getBundledCusePath` — keep this in sync if the layout changes.
 */
export function getBundledResourcePath(relativePath: string): string | null {
  const scriptDir = getScriptDir();
  const prodPath = resolve(scriptDir, relativePath);
  if (existsSync(prodPath)) return prodPath;
  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const devPath = resolve(dir, 'src-tauri', 'resources', relativePath);
    if (existsSync(devPath)) return devPath;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Get the absolute path to the bundled sharp module's CommonJS entry (`lib/index.js`).
 *
 * sharp ships per-platform native addons (`@img/sharp-<triple>/sharp.node`) that
 * esbuild cannot bundle, so we install sharp into a dedicated `sharp-runtime/`
 * node_modules tree and load it at runtime via absolute-path dynamic import.
 * Sharp's internal `require('./libvips')` and `require('@img/sharp-<triple>/sharp.node')`
 * both resolve correctly because Node walks up from the loaded entry file to
 * find `sharp-runtime/node_modules/`.
 *
 * Search order:
 * 1. Production (macOS):   Contents/Resources/sharp-runtime/node_modules/sharp/lib/index.js
 * 2. Production (Windows): <install-dir>/sharp-runtime/node_modules/sharp/lib/index.js
 * 3. Development:          <project-root>/node_modules/sharp/lib/index.js  (top-level dep)
 *
 * @returns Absolute path to sharp's lib/index.js, or null if not found.
 */
export function getBundledSharpEntryPoint(): string | null {
  const relBundled = join('sharp-runtime', 'node_modules', 'sharp', 'lib', 'index.js');
  const scriptDir = getScriptDir();

  // Production layout: sharp-runtime is alongside server-dist.js in Resources
  const prodPath = resolve(scriptDir, relBundled);
  if (existsSync(prodPath)) return prodPath;

  // Development: use the top-level node_modules install from `npm install sharp`.
  // Walk up from scriptDir to project root.
  const relDev = join('node_modules', 'sharp', 'lib', 'index.js');
  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const devPath = resolve(dir, relDev);
    if (existsSync(devPath)) return devPath;
    // Also check for sharp-runtime under src-tauri/resources/ during dev builds
    const devBundled = resolve(dir, 'src-tauri', 'resources', relBundled);
    if (existsSync(devBundled)) return devBundled;
    dir = dirname(dir);
  }

  return null;
}

/**
 * Get the path to a package manager for installing npm packages.
 *
 * Priority order:
 * 1. Bundled bun (can install npm packages via `bun add`)
 * 2. System bun
 * 3. System npm (if user has Node.js)
 *
 * @returns { command: string, installArgs: (pkg: string) => string[], type: 'npm' }
 */
export function getPackageManagerPath(): {
  command: string;
  installArgs: (packageName: string) => string[];
  type: 'npm';
} {
  // Priority: bundled npm → system npm → fallback to PATH.
  // v0.2.0+: Bun removed from bundle; `bun add` path no longer considered.
  const bundledNodeDir = getBundledNodeDir();
  if (bundledNodeDir) {
    const npmExe = isWindows() ? 'npm.cmd' : 'npm';
    const bundledNpm = resolve(bundledNodeDir, npmExe);
    if (existsSync(bundledNpm)) {
      console.log(`[runtime] Using bundled npm: ${bundledNpm}`);
      return {
        command: bundledNpm,
        installArgs: (pkg) => ['install', pkg],
        type: 'npm' as const,
      };
    }
  }

  const systemNpm = findExistingPath(getSystemNpmPaths());
  if (systemNpm) {
    console.log(`[runtime] Using system npm: ${systemNpm}`);
    return {
      command: systemNpm,
      installArgs: (pkg) => ['install', pkg],
      type: 'npm' as const,
    };
  }

  console.warn('[runtime] No bundled or system npm found, falling back to "npm" from PATH');
  return {
    command: 'npm',
    installArgs: (pkg) => ['install', pkg],
    type: 'npm' as const,
  };
}
