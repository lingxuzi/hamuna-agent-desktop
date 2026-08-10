#!/usr/bin/env node
/**
 * Cross-platform shim for install_easy_tdx — picks the right script for the
 * current OS. npm `beforeDevCommand` runs through cmd.exe on Windows, so we
 * can't just `bash scripts/install_easy_tdx.sh` (no bash on stock Windows).
 *
 * Usage:
 *   node scripts/install_easy_tdx.mjs [args...]
 *
 * Args are forwarded to the platform-specific script verbatim (e.g.
 * `--force`, `--check`).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";

let cmd;
let args;

if (isWin) {
  // PowerShell is on every Windows since Win7 SP1; .ps1 script does the work.
  // Use -ExecutionPolicy Bypass to avoid "running scripts is disabled" errors
  // on systems where the user hasn't set a permissive policy.
  cmd = "powershell.exe";
  args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(here, "install_easy_tdx.ps1"),
    ...process.argv.slice(2),
  ];
} else {
  // macOS / Linux — direct shell exec. Already a POSIX env.
  cmd = "bash";
  args = [
    path.join(here, "install_easy_tdx.sh"),
    ...process.argv.slice(2),
  ];
}

const result = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(result.status ?? 1);