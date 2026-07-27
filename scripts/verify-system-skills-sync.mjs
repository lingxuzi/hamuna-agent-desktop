#!/usr/bin/env node
/**
 * scripts/verify-system-skills-sync.mjs
 *
 * Verify the bundled-skills filesystem and the SYSTEM_SKILLS / REQUIRED_SYSTEM_SKILLS
 * / PLATFORM_BLOCKED_SKILLS literals stay in lockstep across the codebase.
 *
 * Background — per commands.rs:1190-1207, adding a system skill touches:
 *   - bundled-skills/<name>/                                   (filesystem)
 *   - src-tauri/src/commands.rs::SYSTEM_SKILLS                          (Rust)
 *   - src/server/index.ts::SYSTEM_SKILLS                                 (Node)
 *   - src/shared/systemSkills.ts::SYSTEM_SKILLS_VERSION / REQUIRED_SYSTEM_SKILLS (TS canonical)
 *   - src-tauri/src/workspace_files/skills_config.rs::REQUIRED_SYSTEM_SKILLS    (Rust mirror)
 *   - src-tauri/src/commands.rs::is_skill_blocked_on_platform + src/server/utils/platform.ts::PLATFORM_BLOCKED_SKILLS (per-skill platform blocks)
 *
 * Today these cross-language sync points rely on comment cross-references alone —
 * drift is silent. This script is the early-warning: every check here corresponds to
 * one of the documented "must keep in sync" contracts in the codebase.
 *
 * Wired into `npm run lint` (CI gate). Pure-Node, no external deps.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const failures = [];

function fail(label, details) {
  failures.push([label, details]);
}

function readText(rel) {
  return readFileSync(join(repoRoot, rel), 'utf-8');
}

// Rust's cfg!(target_os = "...") and Node's process.platform use different
// names for the same OS (windows ↔ win32, macos ↔ darwin). Normalize to
// process.platform before comparing so the verifier doesn't fire on
// semantically identical entries.
const CFG_OS_TO_PROCESS_PLATFORM = {
  windows: 'win32',
  macos: 'darwin',
  linux: 'linux',
};
function cfgOsToPlatform(name) {
  return CFG_OS_TO_PROCESS_PLATFORM[name] ?? name;
}

/**
 * Extract every string literal from a `const NAME ... = [ ... ];` array block.
 * Supports `pub const` (Rust), `const` (both), `export const` (TS). Tolerates
 * line + block comments and any type-annotation shape between NAME and `=`.
 * The `&?` before `[` accommodates Rust array literals (`= &[ ... ]`).
 *
 * Assumes `=` and `[` are on the same line and the closing `]` sits on its own
 * line (matching how every existing constant in this repo is laid out).
 */
function extractArrayStrings(content, constName) {
  const headerRe = new RegExp(
    `(?:^|\\n)\\s*(?:(?:export|pub)\\s+)?const\\s+${constName}\\b.*?=\\s*&?\\s*\\[`,
  );
  const headerMatch = headerRe.exec(content);
  if (!headerMatch) return null;
  const afterHeader = headerMatch.index + headerMatch[0].length;
  const rest = content.slice(afterHeader);

  // Find closing `]` on its own line. Allow optional trailing `;` / `as const;`.
  const closeRe = /\n\s*\](\s*;|\s*as\s+const;)?\s*$/m;
  const closeMatch = closeRe.exec(rest);
  if (!closeMatch) return null;
  const block = rest.slice(0, closeMatch.index);

  // Strip block + line comments, then collect 'foo' / "bar" entries.
  const stripped = block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const matches = [...stripped.matchAll(/['"]([^'"\n]+)['"]/g)];
  return matches.map((m) => m[1]);
}

/** Extract the string literal value of a `const NAME ... = "value";` declaration. */
function extractStringConstant(content, constName) {
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:(?:export|pub)\\s+)?const\\s+${constName}\\b.*?=\\s*['"]([^'"]+)['"]`,
  );
  const m = re.exec(content);
  return m ? m[1] : null;
}

/** Extract Rust match arms of the form `"name" => cfg!(target_os = "platform"),`. */
function extractRustPlatformBlocks(content, fnName) {
  const fnRe = new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?fn\\s+${fnName}\\s*\\([^)]*\\)\\s*->\\s*[^{]*\\{`);
  const fnMatch = fnRe.exec(content);
  if (!fnMatch) return [];
  const afterHeader = fnMatch.index + fnMatch[0].length;
  const closeRe = /\n\}/;
  const closeMatch = closeRe.exec(content.slice(afterHeader));
  if (!closeMatch) return [];
  const body = content.slice(afterHeader, afterHeader + closeMatch.index);

  const arms = [];
  const armRe = /['"]([^'"]+)['"]\s*=>\s*cfg!\(\s*target_os\s*=\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = armRe.exec(body)) !== null) {
    arms.push({ name: m[1], platform: m[2] });
  }
  return arms;
}

/** Extract Node `PLATFORM_BLOCKED_SKILLS` record entries. */
function extractNodePlatformBlocks(content) {
  const startRe =
    /PLATFORM_BLOCKED_SKILLS\s*:\s*Record<string,\s*Set<string>>\s*=\s*\{/;
  const startMatch = startRe.exec(content);
  if (!startMatch) return [];
  const afterHeader = startMatch.index + startMatch[0].length;
  const closeRe = /\n\};?/;
  const closeMatch = closeRe.exec(content.slice(afterHeader));
  if (!closeMatch) return [];
  const body = content.slice(afterHeader, afterHeader + closeMatch.index);
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const out = [];
  const re = /['"]([^'"]+)['"]\s*:\s*new\s+Set\(\[\s*((?:['"][^'"]+['"]\s*,?\s*)*)\s*\]\)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    const platforms = [...m[2].matchAll(/['"]([^'"]+)['"]/g)]
      .map((p) => p[1])
      .sort();
    out.push({ name, platforms });
  }
  return out;
}

// --- Source files (must all exist) ---

const files = {
  commandsRs:     'src-tauri/src/commands.rs',
  skillsConfigRs: 'src-tauri/src/workspace_files/skills_config.rs',
  indexTs:        'src/server/index.ts',
  sharedSkillsTs: 'src/shared/systemSkills.ts',
  platformTs:     'src/server/utils/platform.ts',
};

const missingFiles = Object.entries(files)
  .filter(([, rel]) => !existsSync(join(repoRoot, rel)))
  .map(([label, rel]) => `${label} (${rel})`);
if (missingFiles.length) {
  console.error(
    `[fatal] verify-skills-sync: expected source files are missing:\n${missingFiles.map((m) => '  - ' + m).join('\n')}`,
  );
  process.exit(1);
}

const cmd            = readText(files.commandsRs);
const skillsConfig   = readText(files.skillsConfigRs);
const indexTs        = readText(files.indexTs);
const sharedSkillsTs = readText(files.sharedSkillsTs);
const platformTs     = readText(files.platformTs);

const bundledSkillFolders = (() => {
  const dir = join(repoRoot, 'bundled-skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
})();

const systemSkillsRust      = extractArrayStrings(cmd, 'SYSTEM_SKILLS')      ?? [];
const systemSkillsNode      = extractArrayStrings(indexTs, 'SYSTEM_SKILLS')   ?? [];
const sysVersionRust        = extractStringConstant(cmd, 'SYSTEM_SKILLS_VERSION');
const sysVersionTs          = extractStringConstant(sharedSkillsTs, 'SYSTEM_SKILLS_VERSION');
const requiredTs            = extractArrayStrings(sharedSkillsTs, 'REQUIRED_SYSTEM_SKILLS') ?? [];
const requiredRust          = extractArrayStrings(skillsConfig, 'REQUIRED_SYSTEM_SKILLS')     ?? [];
const platformBlocksRust    = extractRustPlatformBlocks(cmd, 'is_skill_blocked_on_platform');
const platformBlocksNode    = extractNodePlatformBlocks(platformTs);

// --- Checks ---

function setDiff(a, b) {
  const aSet = new Set(a);
  const bSet = new Set(b);
  return {
    onlyA: [...aSet].filter((s) => !bSet.has(s)),
    onlyB: [...bSet].filter((s) => !aSet.has(s)),
  };
}

function setsEqual(a, b) {
  const aSet = new Set(a);
  if (aSet.size !== b.length) return false;
  for (const item of b) if (!aSet.has(item)) return false;
  return true;
}

// 1. SYSTEM_SKILLS Rust <-> Node parity.
{
  if (setsEqual(systemSkillsRust, systemSkillsNode)) {
    console.log(`  [ok] SYSTEM_SKILLS parity (Rust <-> Node, ${systemSkillsRust.length} entries)`);
  } else {
    const { onlyA, onlyB } = setDiff(systemSkillsRust, systemSkillsNode);
    fail(
      'SYSTEM_SKILLS drift between Rust and Node',
      [
        '  Rust only (src-tauri/src/commands.rs):  ' + (onlyA.length ? onlyA.join(', ') : '(none)'),
        '  Node only (src/server/index.ts):        ' + (onlyB.length ? onlyB.join(', ') : '(none)'),
        '',
        '  The contract is documented at:',
        '    - src-tauri/src/commands.rs:1204-1207 ("To add a new system skill")',
        '    - src/server/index.ts:1353-1360 (System skills block comment)',
        '  Update both files to the same set.',
      ].join('\n'),
    );
  }
}

// 2. Every SYSTEM_SKILLS name must exist on disk.
{
  const union = new Set([...systemSkillsRust, ...systemSkillsNode]);
  const missing = [...union].filter((n) => !bundledSkillFolders.includes(n));
  if (missing.length === 0) {
    console.log(`  [ok] all SYSTEM_SKILLS names exist on disk (${union.size} folders)`);
  } else {
    fail(
      'SYSTEM_SKILLS references missing folders',
      missing.map((m) => `  bundled-skills/${m}/ does not exist — remove the listing or create the folder with SKILL.md`).join('\n'),
    );
  }
}

// 3. SYSTEM_SKILLS_VERSION parity.
{
  if (sysVersionRust && sysVersionTs && sysVersionRust === sysVersionTs) {
    console.log(`  [ok] SYSTEM_SKILLS_VERSION parity ('${sysVersionRust}')`);
  } else {
    fail(
      'SYSTEM_SKILLS_VERSION drift',
      [
        '  Rust (src-tauri/src/commands.rs):           ' + JSON.stringify(sysVersionRust),
        '  TS   (src/shared/systemSkills.ts):          ' + JSON.stringify(sysVersionTs),
        '  Bump both to the same string after content changes.',
      ].join('\n'),
    );
  }
}

// 4. REQUIRED_SYSTEM_SKILLS Rust <-> TS parity.
{
  if (setsEqual(requiredRust, requiredTs)) {
    console.log(`  [ok] REQUIRED_SYSTEM_SKILLS parity (Rust <-> TS, ${requiredTs.length} entries)`);
  } else {
    const { onlyA, onlyB } = setDiff(requiredRust, requiredTs);
    fail(
      'REQUIRED_SYSTEM_SKILLS drift between Rust and TS',
      [
        '  Rust only (src-tauri/src/workspace_files/skills_config.rs):  ' + (onlyA.length ? onlyA.join(', ') : '(none)'),
        '  TS only   (src/shared/systemSkills.ts, canonical):           ' + (onlyB.length ? onlyB.join(', ') : '(none)'),
        '',
        '  Canonical: src/shared/systemSkills.ts (per cli_architecture.md:256)',
        '  Mirror:    src-tauri/src/workspace_files/skills_config.rs (cross-language test locked)',
      ].join('\n'),
    );
  }
}

// 5. REQUIRED_SYSTEM_SKILLS ⊆ SYSTEM_SKILLS.
{
  const systemSet = new Set(systemSkillsRust);
  const requiredNotSystem = requiredTs.filter((n) => !systemSet.has(n));
  if (requiredNotSystem.length === 0) {
    console.log(`  [ok] REQUIRED_SYSTEM_SKILLS ⊆ SYSTEM_SKILLS (${requiredTs.length} entries)`);
  } else {
    fail(
      'REQUIRED skill missing from SYSTEM_SKILLS',
      '  Required skills must also be in SYSTEM_SKILLS (product contract subset). Add to both SYSTEM_SKILLS lists:\n' +
        requiredNotSystem.map((n) => `  - '${n}'`).join('\n'),
    );
  }
}

// 6. Required skill names exist on disk.
{
  const missing = requiredTs.filter((n) => !bundledSkillFolders.includes(n));
  if (missing.length === 0) {
    console.log(`  [ok] all REQUIRED_SYSTEM_SKILLS names exist on disk`);
  } else {
    fail(
      'REQUIRED skill missing on disk',
      missing.map((m) => `  bundled-skills/${m}/ does not exist`).join('\n'),
    );
  }
}

// 7. PLATFORM_BLOCKED_SKILLS Rust <-> Node parity (with OS-name normalization).
{
  const rustMap = new Map(
    platformBlocksRust.map((b) => [b.name, [cfgOsToPlatform(b.platform)].sort().join(',')]),
  );
  const nodeMap = new Map(
    platformBlocksNode.map((b) => [b.name, b.platforms.join(',')]),
  );
  const allNames = new Set([...rustMap.keys(), ...nodeMap.keys()]);
  const drift = [];
  for (const name of allNames) {
    if (rustMap.get(name) !== nodeMap.get(name)) {
      drift.push({
        name,
        rust: rustMap.get(name) ?? '(absent)',
        node: nodeMap.get(name) ?? '(absent)',
      });
    }
  }
  if (drift.length === 0) {
    if (allNames.size === 0) {
      console.log(`  [skip] PLATFORM_BLOCKED_SKILLS parity (no entries on either side)`);
    } else {
      console.log(`  [ok] PLATFORM_BLOCKED_SKILLS parity (${allNames.size} entries)`);
    }
  } else {
    fail(
      'PLATFORM_BLOCKED_SKILLS drift between Rust and Node',
      [
        ...drift.map((d) => `  '${d.name}': Rust=${d.rust}, Node=${d.node}`),
        '  Update commands.rs::is_skill_blocked_on_platform or src/server/utils/platform.ts::PLATFORM_BLOCKED_SKILLS.',
      ].join('\n'),
    );
  }
}

// 8. Platform-blocked skill names exist on disk.
{
  const allBlocked = new Set([
    ...platformBlocksRust.map((b) => b.name),
    ...platformBlocksNode.map((b) => b.name),
  ]);
  const missing = [...allBlocked].filter((n) => !bundledSkillFolders.includes(n));
  if (missing.length === 0) {
    if (allBlocked.size === 0) {
      console.log(`  [skip] PLATFORM_BLOCKED_SKILLS names on disk (no entries)`);
    } else {
      console.log(`  [ok] all PLATFORM_BLOCKED_SKILLS names exist on disk`);
    }
  } else {
    fail(
      'PLATFORM_BLOCKED_SKILLS references missing folders',
      missing.map((m) => `  bundled-skills/${m}/ does not exist`).join('\n'),
    );
  }
}

// --- Summary ---

console.log('');
if (failures.length === 0) {
  console.log(
    `[ok] verify-skills-sync: ${bundledSkillFolders.length} bundled-skills folders, ` +
      `${systemSkillsRust.length} system, ${requiredTs.length} required, all in lockstep.`,
  );
  process.exit(0);
}

console.error(`[fail] verify-skills-sync: ${failures.length} drift point(s):`);
console.error('');
for (const [label, details] of failures) {
  console.error(`  ${label}`);
  console.error(details);
  console.error('');
}
process.exit(1);