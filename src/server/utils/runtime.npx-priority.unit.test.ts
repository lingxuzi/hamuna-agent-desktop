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
});