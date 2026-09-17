#!/usr/bin/env node
// Generate a placeholder `cuse-<target-triple>` external binary for Linux.
//
// tauri.conf.json declares `bundle.externalBin: ["binaries/cuse"]`, which is a
// GLOBAL list (Tauri v2 has no per-platform condition for externalBin). Tauri
// resolves it to `cuse-<target-triple>` and hard-fails in BOTH `tauri dev` and
// `tauri build` if that file is missing — but cuse ships no Linux package
// (setup.sh only downloads it for macOS, Windows uses setup_windows.ps1).
//
// This script (wired into beforeDevCommand / beforeBuildCommand) drops a valid
// ELF placeholder so Tauri's existence check passes. The runtime never executes
// it: src/server/utils/runtime.ts::getBundledCusePath() early-returns null for
// `process.platform !== 'linux'`-family. It must be a real ELF (not an empty
// file) or linuxdeploy rejects it during bundling — /usr/bin/true is a ~27KB
// valid host-arch ELF.
//
// `src-tauri/binaries/` is gitignored, so the placeholder never pollutes git.

import { existsSync, copyFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') {
  process.exit(0);
}

const triple =
  process.arch === 'arm64' || process.arch === 'aarch64'
    ? 'aarch64-unknown-linux-gnu'
    : 'x86_64-unknown-linux-gnu';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stubPath = path.join(projectDir, 'src-tauri', 'binaries', `cuse-${triple}`);

if (existsSync(stubPath)) {
  process.exit(0);
}

let trueBin = null;
for (const candidate of ['/usr/bin/true', '/bin/true']) {
  if (existsSync(candidate)) {
    trueBin = candidate;
    break;
  }
}
if (!trueBin) {
  console.error(`[cuse-stub] cannot find /usr/bin/true or /bin/true to generate ${stubPath}`);
  process.exit(1);
}

copyFileSync(trueBin, stubPath);
chmodSync(stubPath, 0o755);
console.log(`[cuse-stub] created placeholder ${stubPath} (from ${trueBin})`);
