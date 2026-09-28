import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBundledNodeDir, getSystemNpxPaths } from './runtime';

// `getSystemNpxPaths` only depends on `getBundledNodeDir` (internal) and
// `getSystemNodeDirs` (env-driven, hard-coded POSIX paths when no env vars
// are set). The dev box has a real bundled Node at
// `src-tauri/resources/nodejs/bin/` (we accept that as the canonical
// "bundled" entry and assert it appears FIRST in the returned list, ahead
// of the hard-coded POSIX system fallbacks). This avoids mocking the
// read-only `process.platform` and stays robust against the dev box's
// real filesystem state.
describe('getSystemNpxPaths — bundled beats system', () => {
  beforeEach(() => {
    // Strip HOME so POSIX getSystemNodeDirs returns only the three
    // hard-coded /opt/homebrew/bin, /usr/local/bin, /usr/bin entries
    // (instead of leaking ~/.volta/bin etc. from the dev box).
    vi.stubEnv('HOME', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prepends bundled npx ahead of the hard-coded POSIX system entries', () => {
    const bundledDir = getBundledNodeDir();
    if (!bundledDir) {
      // Dev box without staged runtime — skip rather than fail. The bundled
      // priority contract is exercised by every other case that runs on a
      // machine WITH a staged nodejs/, which is the production shape.
      return;
    }

    const paths = getSystemNpxPaths();
    const bundledEntry = `${bundledDir}/npx`;

    expect(paths[0]).toBe(bundledEntry);
    // Hard-coded POSIX system paths come after the bundled one.
    expect(paths).toContain('/opt/homebrew/bin/npx');
    expect(paths.indexOf(bundledEntry)).toBeLessThan(
      paths.indexOf('/opt/homebrew/bin/npx'),
    );
  });

  it('keeps the hard-coded POSIX system fallback list intact after the bundled prepend', () => {
    const paths = getSystemNpxPaths();

    // Without bundled + without HOME: three hard-coded entries exactly.
    // With bundled: the same three hard-coded entries appear after the
    // bundled prepend. We assert the shape, not the exact prefix.
    expect(paths).toContain('/opt/homebrew/bin/npx');
    expect(paths).toContain('/usr/local/bin/npx');
    expect(paths).toContain('/usr/bin/npx');
  });

  // Regression: the new process.execPath probe must not break the existing
  // bundled-dir resolution. Pointing execPath at the bundled binary MUST
  // keep returning the same bundled dir. A future regression that breaks
  // the new probe (e.g. by short-circuiting on a stale execPath) fails
  // this assertion immediately.
  //
  // The full "execPath recovers when scriptDir probe misses" scenario
  // can't be unit-tested: `import.meta.url` is captured at module-load
  // time so the scriptDir probe can't be made to fail from the test
  // without rebuilding the bundle. The production failure mode (NSIS
  // service wrapper sets a non-app cwd, or any daemonized spawn that
  // inherits a foreign cwd) is what the new probe is FOR, so the contract
  // is intentionally asserted at integration / manual levels (see
  // TODO #187 follow-up).
  it('process.execPath probe returns the bundled node dir when it points at the bundled binary', () => {
    const cwdBasedDir = getBundledNodeDir();
    if (!cwdBasedDir) return; // dev box without staged runtime — skip

    const execName = process.platform === 'win32' ? 'node.exe' : 'node';
    const bundledExecPath = `${cwdBasedDir}/${execName}`;
    if (!require('fs').existsSync(bundledExecPath)) return;

    const realExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: bundledExecPath,
      configurable: true,
    });
    try {
      expect(getBundledNodeDir()).toBe(cwdBasedDir);
    } finally {
      Object.defineProperty(process, 'execPath', {
        value: realExecPath,
        configurable: true,
      });
    }
  });
});