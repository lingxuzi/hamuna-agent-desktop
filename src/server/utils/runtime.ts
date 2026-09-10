/**
 * Runtime Path Utilities
 *
 * Provides functions to locate bundled bun or fallback to system runtimes.
 * This ensures the app can run without requiring users to have Node.js installed.
 */

import { existsSync } from 'fs';
import { homedir } from 'node:os';
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

/**
 * Get the absolute path to the bundled uvx (Astral uv) binary.
 * Windows-only — uv ships as a single self-contained binary that we rename
 * to `uvx.exe` so MCP servers declared with `command: 'uvx'` find it via
 * plain PATH lookup, and so the spawn path doesn't need to think about the
 * uv→uvx trampoline.
 *
 * Probe order (Windows):
 *   1. <install-dir>/uvx.exe                            (Tauri 2 NSIS preferred — confirmed in 0.3.136+ installed builds)
 *   2. <install-dir>/resources/uvx.exe                  (fallback if NSIS layout changes)
 *   3. ~/.hamuna/bin/uvx.exe                            (mcp-bundled-seed.ts copies here on startup; covers
 *                                                        older installs where install-dir uvx.exe is missing or
 *                                                        if the user manually removed bundled resources)
 *   4. <walk-up>/src-tauri/resources/uvx.exe            (dev box)
 *
 * macOS/Linux: returns null (Homebrew / system packages are the convention).
 *
 * Always returns the path to uvx.exe, or null if not present.
 */
export function getBundledUvPath(): string | null {
  if (!isWindows()) return null;

  const scriptDir = getScriptDir();

  // Production (preferred): Tauri 2 NSIS places uvx.exe flat at install-dir root.
  // scriptDir is <install-dir>/resources/, so we walk one level up.
  const rootBin = resolve(scriptDir, '..', 'uvx.exe');
  if (existsSync(rootBin)) return rootBin;

  // Production (fallback): if Tauri's layout ever changes to nest all
  // bundle.resources under `resources/`, this catches it without breaking prod.
  const nestedBin = resolve(scriptDir, 'uvx.exe');
  if (existsSync(nestedBin)) return nestedBin;

  // Production (user dir fallback): mcp-bundled-seed.ts copies the bundled uvx
  // here on every sidecar startup. Covers the gap where install-dir uvx.exe is
  // missing (older releases without the bundle.resources entry, partial
  // upgrades, anti-virus quarantine of the install dir, etc.). The user dir
  // path is stable across reinstalls and is on the user PATH via the CLI shim
  // registration in system_binary.rs (only relevant for new shells — the
  // Sidecar spawn path prepends the explicit directory instead of relying on
  // PATH inheritance).
  const homeBin = getUserHomeBinUvxPath();
  if (homeBin && existsSync(homeBin)) return homeBin;

  // Development: walk up from scriptDir to find src-tauri/resources/uvx.exe
  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const devBin = resolve(dir, 'src-tauri', 'resources', 'uvx.exe');
    if (existsSync(devBin)) return devBin;
    dir = dirname(dir);
  }

  return null;
}

/**
 * Resolve `~/.hamuna/bin/uvx.exe` lazily — Sidecar startup is hot-path,
 * and a static `import { homedir } from 'node:os'` is fine here because
 * `homedir()` only resolves on the first call (cached internally by Node),
 * and the user dir fallback is probe slot #3 of 4 — most calls short-circuit
 * on slots 1 or 2 before reaching this.
 */
function getUserHomeBinUvxPath(): string | null {
  try {
    const home = homedir();
    if (!home) return null;
    return join(home, '.hamuna', 'bin', 'uvx.exe');
  } catch {
    return null;
  }
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
