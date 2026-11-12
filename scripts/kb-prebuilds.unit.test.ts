import { describe, expect, it } from 'vitest';
import { selectKbPrebuilds } from './kb-prebuilds.mjs';

// better-sqlite3's tarball ships every platform's prebuild. The regression
// this guards: the AppImage bundler (linuxdeploy) resolves the DT_NEEDED of
// every ELF in the AppDir, and a musl / foreign-arch prebuild points at a
// library that does not exist on the host — linuxdeploy then exits non-zero
// and Tauri reports nothing but "failed to run linuxdeploy".

const ALL_PREBUILDS = [
  'darwin-arm64.node',
  'darwin-x64.node',
  'linux-arm64.node',
  'linux-x64.node',
  'linuxmusl-arm64.node',
  'linuxmusl-x64.node',
  'win32-arm64.node',
  'win32-x64.node',
];

describe('selectKbPrebuilds', () => {
  it('drops the musl prebuilds on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      const kept = selectKbPrebuilds(ALL_PREBUILDS, { platform, arch: 'x64' });
      expect(kept).not.toContain('linuxmusl-x64.node');
      expect(kept).not.toContain('linuxmusl-arm64.node');
    }
  });

  it('keeps only the running arch on linux', () => {
    const kept = selectKbPrebuilds(ALL_PREBUILDS, { platform: 'linux', arch: 'x64' });
    expect(kept).toContain('linux-x64.node');
    expect(kept).not.toContain('linux-arm64.node');
  });

  it('keeps sibling arches on darwin and win32 — their bundlers never resolve ELF dependencies', () => {
    const darwin = selectKbPrebuilds(ALL_PREBUILDS, { platform: 'darwin', arch: 'arm64' });
    expect(darwin).toContain('darwin-arm64.node');
    expect(darwin).toContain('darwin-x64.node');

    const win32 = selectKbPrebuilds(ALL_PREBUILDS, { platform: 'win32', arch: 'x64' });
    expect(win32).toContain('win32-x64.node');
    expect(win32).toContain('win32-arm64.node');
  });

  it('leaves files that are not prebuilds alone', () => {
    const kept = selectKbPrebuilds(['README.md', 'linux-x64.node'], {
      platform: 'linux',
      arch: 'x64',
    });
    expect(kept).toEqual(['README.md', 'linux-x64.node']);
  });
});
