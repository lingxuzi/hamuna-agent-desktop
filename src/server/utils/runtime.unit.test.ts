/**
 * Unit tests for `findPipInstalledUvxScriptsDir` (Windows uv/uvx discovery).
 *
 * The probe exists because the installer's HKCU\Environment\Path write is
 * best-effort and only reaches *newly spawned* processes, so a Sidecar
 * started before that write has a PATH without the pip Scripts dir. It
 * originally hardcoded `Python312`, which silently missed every machine
 * whose `pip install --user uv` landed on a different interpreter — these
 * tests pin the enumeration + version-preference behaviour that replaced it.
 *
 * `fs` is mocked against a tiny virtual tree. Expected paths are built with
 * the same `path` helpers as the implementation so the suite passes on any
 * host, even though the code under test only runs on win32.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'path';

const fsState = vi.hoisted(() => ({
  /** dir path -> entry names */
  dirs: new Map<string, string[]>(),
  /** full file paths that "exist" */
  files: new Set<string>(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => fsState.files.has(p)),
  readdirSync: vi.fn((p: string) => {
    const entries = fsState.dirs.get(p);
    if (!entries) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: scandir '${p}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return entries;
  }),
}));

import { findPipInstalledUvxScriptsDir } from './runtime';

const APPDATA = 'C:\\Users\\tester\\AppData\\Roaming';
const LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';

const roamingPythonRoot = resolve(APPDATA, 'Python');
const localPythonRoot = resolve(LOCALAPPDATA, 'Programs', 'Python');

/** Register a per-user Python whose Scripts dir does / doesn't carry uvx.exe. */
function addPython(root: string, version: string, hasUvx: boolean): string {
  const scriptsDir = join(root, `Python${version}`, 'Scripts');
  fsState.dirs.set(root, [...(fsState.dirs.get(root) ?? []), `Python${version}`]);
  if (hasUvx) fsState.files.add(join(scriptsDir, 'uvx.exe'));
  return scriptsDir;
}

describe('findPipInstalledUvxScriptsDir', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    fsState.dirs.clear();
    fsState.files.clear();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubEnv('APPDATA', APPDATA);
    vi.stubEnv('LOCALAPPDATA', LOCALAPPDATA);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.unstubAllEnvs();
  });

  it('returns null on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    addPython(roamingPythonRoot, '312', true);

    expect(findPipInstalledUvxScriptsDir()).toBeNull();
  });

  it('finds the PEP 370 roaming per-user install', () => {
    const scriptsDir = addPython(roamingPythonRoot, '312', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(scriptsDir);
  });

  it('finds the LOCALAPPDATA installer layout too', () => {
    const scriptsDir = addPython(localPythonRoot, '312', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(scriptsDir);
  });

  it('picks a version other than 3.12 when that is what pip installed into', () => {
    // Regression guard for the old hardcoded `Python312` candidate list.
    const scriptsDir = addPython(roamingPythonRoot, '313', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(scriptsDir);
  });

  it('prefers the newest Python version carrying uvx', () => {
    addPython(roamingPythonRoot, '311', true);
    const newest = addPython(roamingPythonRoot, '313', true);
    addPython(roamingPythonRoot, '312', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(newest);
  });

  it('prefers the installer-pinned roaming uv over a non---user LOCALAPPDATA one', () => {
    // Regression guard: §UvxFallback installs `pip install --user
    // uv==0.11.33`, and `--user` sends it to the roaming user site no
    // matter which interpreter invoked it. A uv in the installer's own
    // LOCALAPPDATA Scripts dir came from a plain `pip install uv` — no
    // pin, so 0.12.x is possible there, and 0.12.x silently breaks
    // `uvx --from` for the multimedia-creator MCP. It must not win.
    const pinned = addPython(roamingPythonRoot, '312', true);
    addPython(localPythonRoot, '313', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(pinned);
  });

  it('falls back to the LOCALAPPDATA install when the roaming site has no uvx', () => {
    addPython(roamingPythonRoot, '312', false);
    const localInstall = addPython(localPythonRoot, '311', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(localInstall);
  });

  it('skips versions whose Scripts dir has no uvx.exe', () => {
    addPython(roamingPythonRoot, '313', false);
    const withUvx = addPython(roamingPythonRoot, '312', true);

    expect(findPipInstalledUvxScriptsDir()).toBe(withUvx);
  });

  it('ignores dirs that are not PEP 370 version dirs', () => {
    fsState.dirs.set(roamingPythonRoot, ['Python', 'Python3', 'python-packages', 'Python312']);
    const scriptsDir = join(roamingPythonRoot, 'Python312', 'Scripts');
    fsState.files.add(join(scriptsDir, 'uvx.exe'));

    expect(findPipInstalledUvxScriptsDir()).toBe(scriptsDir);
  });

  it('returns null when neither root exists (no per-user Python)', () => {
    expect(findPipInstalledUvxScriptsDir()).toBeNull();
  });

  it('returns null when APPDATA / LOCALAPPDATA are unset', () => {
    addPython(roamingPythonRoot, '312', true);
    vi.stubEnv('APPDATA', '');
    vi.stubEnv('LOCALAPPDATA', '');

    expect(findPipInstalledUvxScriptsDir()).toBeNull();
  });
});
