// Decide which better-sqlite3 prebuilds may ship inside the bundled app.
//
// better-sqlite3's npm tarball carries EVERY platform's prebuild
// (darwin / linux / linuxmusl / win32 × x64 / arm64), and setup-kb-runtime.mjs
// copies the whole package verbatim. Everything the running Node will never
// load is dead weight — and on Linux it is worse than dead weight: it breaks
// the build.
//
// Why Linux is special: the AppImage bundler (linuxdeploy) walks every ELF
// inside the AppDir and resolves its DT_NEEDED entries against the host. A
// musl prebuild asks for `libc.musl-x86_64.so.1` and a foreign-arch prebuild
// asks for `ld-linux-aarch64.so.1`; neither exists on a glibc x86_64 host.
// linuxdeploy treats an unresolvable dependency as fatal, and Tauri discards
// linuxdeploy's stderr — so the whole build dies as a bare
// 'failed to run linuxdeploy' with no hint about the real cause.
//
// The macOS / Windows bundlers never resolve ELF dependencies, so they are
// left alone: keeping every non-musl prebuild there keeps multi-arch
// packages (Rosetta, x86_64-on-ARM) working.
//
// ponytail: the platform/arch pair is read from the build host, which is
// assumed to match the bundle target. True for every workflow in this repo
// (mac aarch64-apple-darwin, win x86_64-pc-windows-msvc, linux
// x86_64-unknown-linux-gnu). If a workflow ever cross-compiles, pass the
// target triple in instead of process.platform.

const PREBUILD_NAME = /^([a-z0-9]+)-([a-z0-9]+)\.node$/;

/**
 * @param {string[]} names file names inside better-sqlite3's `prebuilds/` dir
 * @param {{ platform: string, arch: string }} target
 * @returns {string[]} the subset that may be shipped
 */
export function selectKbPrebuilds(names, { platform, arch }) {
  const kept = [];
  for (const name of names) {
    const match = PREBUILD_NAME.exec(name);
    if (!match) {
      // Not a prebuild (e.g. a README) — leave it alone.
      kept.push(name);
      continue;
    }
    const [, prebuildPlatform, prebuildArch] = match;

    // musl is a different libc, not a different CPU: the bundled Node is
    // always glibc, so a musl prebuild is unreachable on every platform.
    if (prebuildPlatform === 'linuxmusl') continue;

    // A prebuild for another OS is inert here and harmless to the macOS /
    // Windows bundlers, so it stays.
    if (prebuildPlatform !== platform) {
      kept.push(name);
      continue;
    }

    // Same OS. On Linux, linuxdeploy resolves the DT_NEEDED of every ELF in
    // the AppDir, and a foreign-arch prebuild pulls in a loader that does not
    // exist on this host — fatal. On macOS / Windows nothing resolves those
    // dependencies, so sibling arches are kept.
    if (platform === 'linux' && prebuildArch !== arch) continue;

    kept.push(name);
  }
  return kept;
}
