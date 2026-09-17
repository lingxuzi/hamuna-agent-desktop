// Unit tests for `seedBundledSkills` orphan-cleanup pass in
// `src/server/index.ts`.
//
// Covers the orphan cleanup contract (task #155):
//   - bundled-originated names (`config.seeded` + removed from `bundled-skills/`)
//     → hard-deleted from `~/.hamuna/skills/<name>/`
//   - names not in `config.seeded` → never touched (user-installed)
//   - names still in `bundled-skills/` → kept (re-seed skip)
//   - SYSTEM_SKILLS-managed names → kept (Rust owns)
//   - platform-blocked bundled names → kept (e.g. agent-browser on Windows)
//   - `skills-config.json::disabled` orphan entries cleaned up
//   - broken symlink at orphan path survives the lstatSync guard
//
// Test seams (declared as `export` for testing):
//   - `seedBundledSkills` — public (just declared `export`)
//   - `__testing` — re-exports module-private `readSkillsConfig`,
//     `writeSkillsConfig`, `resolveBundledSkillsDir`
//
// Test infrastructure:
//   - `getScriptDir` is mocked to point at a tmpdir containing a fake
//     `bundled-skills/<name>/SKILL.md` tree.
//   - `process.env.HOME` is redirected at the tmpdir so `readSkillsConfig`
//     reads/writes `<tmpdir>/.hamuna/skills-config.json`.
//   - `isSkillBlockedOnPlatform` is real (mirrors src/server/utils/platform.ts:
//     only `agent-browser` is blocked on win32).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MOCK_SCRIPT_DIR = '/tmp/hamuna-seed-test';

vi.mock('./utils/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/runtime')>();
  return {
    ...actual,
    getScriptDir: vi.fn(() => MOCK_SCRIPT_DIR),
  };
});

import { seedBundledSkills, __testing as seedTest } from './index';

const { readSkillsConfig, writeSkillsConfig, resolveBundledSkillsDir } = seedTest;

let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalPlatform: NodeJS.Platform;

function setupBundledSkillsDir(folders: string[]): void {
  const bundled = join(MOCK_SCRIPT_DIR, 'bundled-skills');
  rmSync(bundled, { recursive: true, force: true });
  mkdirSync(bundled, { recursive: true });
  for (const folder of folders) {
    const dir = join(bundled, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `# ${folder}\n`);
  }
}

function setupUserSkill(name: string, opts?: { symlinkTarget?: string }): void {
  const dir = join(tempHome, '.hamuna', 'skills', name);
  mkdirSync(dir, { recursive: true });
  if (opts?.symlinkTarget) {
    // Replace the directory with a symlink for broken-symlink tests.
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(opts.symlinkTarget, dir);
  } else {
    writeFileSync(join(dir, 'SKILL.md'), `# user ${name}\n`);
  }
}

function setupUserSkillNoSkillMd(name: string): void {
  // A folder name NOT in bundled-skills — user installed it manually and
  // didn't write SKILL.md. Must still survive orphan cleanup.
  const dir = join(tempHome, '.hamuna', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'notes.txt'), 'user content');
}

function readSeededConfig(): { seeded: string[]; disabled: string[]; generation: number } {
  return readSkillsConfig();
}

function writeSeededConfig(cfg: { seeded: string[]; disabled: string[]; generation: number }): void {
  // Use the same internal write path so disabled-canonicalization etc. apply.
  writeSkillsConfig(cfg);
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'hamuna-seed-skills-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  originalPlatform = process.platform;
  // Make sure the mock script dir parent exists; the mock returns the
  // literal path regardless.
  mkdirSync(MOCK_SCRIPT_DIR, { recursive: true });
  // Sanity-check that resolveBundledSkillsDir honours the mock.
  mkdirSync(join(MOCK_SCRIPT_DIR, 'bundled-skills'), { recursive: true });
  expect(resolveBundledSkillsDir()).toBe(join(MOCK_SCRIPT_DIR, 'bundled-skills'));
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
});

describe('seedBundledSkills — orphan cleanup', () => {
  it('removes ~/.hamuna/skills/<name>/ when <name> is dropped from bundled-skills/', () => {
    // v1 shipped `foo` and `bar`; v2 drops `foo`. foo's user copy must die.
    setupBundledSkillsDir(['bar']);
    setupUserSkill('foo');
    setupUserSkill('bar');
    writeSeededConfig({ seeded: ['foo', 'bar'], disabled: [], generation: 1 });

    seedBundledSkills();

    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'foo'))).toBe(false);
    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'bar'))).toBe(true);
    expect(readSeededConfig().seeded).toEqual(['bar']);
  });

  it('keeps user-installed skill not present in skills-config.json::seeded', () => {
    // v1 shipped `bar` only. User installed `mycustom` via `hamuna skill add`
    // (so it's NOT in `seeded`). v2 drops nothing — but a hostile regression
    // must not delete `mycustom`.
    setupBundledSkillsDir(['bar']);
    setupUserSkillNoSkillMd('mycustom');
    writeSeededConfig({ seeded: ['bar'], disabled: [], generation: 1 });

    seedBundledSkills();

    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'mycustom'))).toBe(true);
    expect(readSeededConfig().seeded).toEqual(['bar']);
  });

  it('keeps bundled skill on disk when still in bundled-skills/ (re-seed skip)', () => {
    setupBundledSkillsDir(['keep']);
    setupUserSkill('keep'); // already seeded previously
    writeSeededConfig({ seeded: ['keep'], disabled: [], generation: 1 });

    seedBundledSkills();

    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'keep'))).toBe(true);
    // User's SKILL.md content preserved (re-seed skipped because seeded + exists)
    expect(readFileSync(join(tempHome, '.hamuna', 'skills', 'keep', 'SKILL.md'), 'utf-8'))
      .toBe('# user keep\n');
  });

  it('keeps SYSTEM_SKILLS-managed skill even when not in current bundledFolders loop', () => {
    // SYSTEM_SKILLS is owned by Rust; Node must skip it from orphan cleanup
    // even if a regression makes it disappear from bundled-skills/.
    setupBundledSkillsDir([]); // empty bundle, simulating a bad release
    setupUserSkill('task-alignment'); // a SYSTEM_SKILLS name
    writeSeededConfig({ seeded: ['task-alignment'], disabled: [], generation: 1 });

    seedBundledSkills();

    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'task-alignment'))).toBe(true);
    expect(readSeededConfig().seeded).toEqual(['task-alignment']);
  });

  it('keeps platform-blocked skill (agent-browser on Windows) even if seeded previously', () => {
    // Pretend we are on Windows so agent-browser is platform-blocked.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    setupBundledSkillsDir([]); // dropped from bundle in v2
    setupUserSkill('agent-browser'); // user had it from v1
    writeSeededConfig({ seeded: ['agent-browser'], disabled: [], generation: 1 });

    seedBundledSkills();

    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'agent-browser'))).toBe(true);
    expect(readSeededConfig().seeded).toEqual(['agent-browser']);
  });

  it('cleans stale entries in skills-config.json::disabled that point to orphans', () => {
    setupBundledSkillsDir(['bar']);
    setupUserSkill('foo'); // orphan on disk
    writeSeededConfig({
      seeded: ['foo', 'bar'],
      disabled: ['foo'], // stale disable pointing at orphan
      generation: 1,
    });

    seedBundledSkills();

    const cfg = readSeededConfig();
    expect(cfg.disabled).toEqual([]); // 'foo' pruned (no longer in bundled/system)
  });

  it('survives broken symlink at orphan path (lstatSync guard, no C++ exception)', () => {
    setupBundledSkillsDir(['bar']);
    setupUserSkill('foo', { symlinkTarget: '/nonexistent/never-existed' });
    writeSeededConfig({ seeded: ['foo', 'bar'], disabled: [], generation: 1 });

    // The lstat-then-unlink pattern must not throw a Node v24 C++ exception
    // from std::filesystem::equivalent. If it does, the whole sidecar aborts
    // — this test asserts the operation completes and the orphan entry
    // leaves the seeded list.
    expect(() => seedBundledSkills()).not.toThrow();

    // The broken symlink itself is removed; we don't keep a dangling link.
    expect(existsSync(join(tempHome, '.hamuna', 'skills', 'foo'))).toBe(false);
    expect(readSeededConfig().seeded).toEqual(['bar']);
  });
});
