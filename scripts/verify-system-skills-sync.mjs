#!/usr/bin/env node
/**
 * scripts/verify-system-skills-sync.mjs
 *
 * Verify the bundled-skills filesystem and the SYSTEM_SKILLS / REQUIRED_SYSTEM_SKILLS
 * / PLATFORM_BLOCKED_SKILLS literals stay in lockstep across the codebase.
 *
 * SYSTEM_SKILLS is auto-derived from `bundled-skills/<name>/SKILL.md` by
 * `scripts/generate-system-skills.mjs` (invoked via npm `prebuild:*` /
 * `pretest` / `prelint` hooks and `src-tauri/build.rs` for bare cargo).
 * Both `src-tauri/src/system_skills.generated.rs` and
 * `src/shared/systemSkills.generated.ts` are emitted by the same Node
 * pass, so cross-language parity is impossible by construction — Check 1
 * was deleted for that reason.
 *
 * Remaining invariants this verifier enforces:
 *   1. (removed — Rust ↔ Node parity is by-construction)
 *   2. bundled-skills/ ↔ generated.ts + generated.rs sync (the generator
 *      actually ran, so the Rust const / TS literal match the filesystem)
 *   3. SYSTEM_SKILLS_VERSION parity (Rust `const` vs TS canonical)
 *   4. REQUIRED_SYSTEM_SKILLS Rust ↔ TS parity
 *   5. REQUIRED_SYSTEM_SKILLS ⊆ SYSTEM_SKILLS
 *   6. Required skill names exist on disk
 *   7. PLATFORM_BLOCKED_SKILLS Rust ↔ Node parity (with OS-name normalization)
 *   8. Platform-blocked skill names exist on disk
 *   9. generated files exist on disk (added — would otherwise be silent if
 *      a contributor skipped `npm install`/`prebuild:*` and the generator
 *      never ran)
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
  commandsRs:             'src-tauri/src/commands.rs',
  generatedRs:            'src-tauri/src/system_skills.generated.rs',
  generatedTs:            'src/shared/systemSkills.generated.ts',
  skillsConfigRs:         'src-tauri/src/workspace_files/skills_config.rs',
  sharedSkillsTs:         'src/shared/systemSkills.ts',
  platformTs:             'src/server/utils/platform.ts',
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
const generatedRs    = readText(files.generatedRs);
const generatedTs    = readText(files.generatedTs);
const skillsConfig   = readText(files.skillsConfigRs);
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

const bundledWithSkillMd = bundledSkillFolders.filter((name) =>
  existsSync(join(repoRoot, 'bundled-skills', name, 'SKILL.md')),
);

// SYSTEM_SKILLS is auto-derived; read it from the generated files instead
// of parsing hand-maintained constants (which no longer exist).
const systemSkillsRust = extractArrayStrings(generatedRs, 'SYSTEM_SKILLS') ?? [];
const systemSkillsNode = extractArrayStrings(generatedTs, 'SYSTEM_SKILLS') ?? [];
const sysVersionRust   = extractStringConstant(cmd, 'SYSTEM_SKILLS_VERSION');
const sysVersionTs     = extractStringConstant(sharedSkillsTs, 'SYSTEM_SKILLS_VERSION');
const requiredTs       = extractArrayStrings(sharedSkillsTs, 'REQUIRED_SYSTEM_SKILLS') ?? [];
const requiredRust     = extractArrayStrings(skillsConfig, 'REQUIRED_SYSTEM_SKILLS')     ?? [];
const platformBlocksRust = extractRustPlatformBlocks(cmd, 'is_skill_blocked_on_platform');
const platformBlocksNode = extractNodePlatformBlocks(platformTs);

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

// 2. bundled-skills/<name>/SKILL.md ↔ generated.ts and generated.rs sync.
// (Replaces the old Check 2, which only checked that every SYSTEM_SKILLS
// name existed on disk. Now also catches "added a directory but forgot to
// run the generator" and "removed a directory but the stale generated
// file was kept around".)
{
  const expected = [...bundledWithSkillMd].sort();
  const missingInGen = expected.filter((n) => !systemSkillsRust.includes(n) || !systemSkillsNode.includes(n));
  const extraInGen = [...new Set([...systemSkillsRust, ...systemSkillsNode])]
    .filter((n) => !expected.includes(n));

  if (missingInGen.length === 0 && extraInGen.length === 0) {
    console.log(`  [ok] bundled-skills/ ↔ generated sync (${expected.length} entries)`);
  } else {
    const lines = [];
    if (missingInGen.length) {
      lines.push('  Present in bundled-skills/ but missing from generated:');
      for (const name of missingInGen) lines.push(`    - ${name}`);
      lines.push('  → run `npm run generate:system-skills`');
    }
    if (extraInGen.length) {
      lines.push('  In generated but no bundled-skills/<name>/SKILL.md on disk:');
      for (const name of extraInGen) lines.push(`    - ${name}`);
      lines.push('  → remove the directory or regenerate (the directory must ship a SKILL.md)');
    }
    fail('bundled-skills/ ↔ SYSTEM_SKILLS drift', lines.join('\n'));
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

// 9. Both generated files exist on disk. (By Check 1 mirror, both files
// are emitted by a single Node pass over the same source; if either is
// missing, the generator didn't run at all — caught separately from
// Check 2's drift check so a missing file doesn't masquerade as a sync
// failure.)
{
  const rsExists = existsSync(join(repoRoot, files.generatedRs));
  const tsExists = existsSync(join(repoRoot, files.generatedTs));
  if (rsExists && tsExists) {
    console.log(`  [ok] generated SYSTEM_SKILLS files exist (rs + ts)`);
  } else {
    const missing = [];
    if (!rsExists) missing.push(files.generatedRs);
    if (!tsExists) missing.push(files.generatedTs);
    fail(
      'SYSTEM_SKILLS generated files missing',
      missing.map((m) => `  - ${m}\n  → run \`npm run generate:system-skills\``).join('\n'),
    );
  }
}

// --- Summary ---

console.log('');
if (failures.length === 0) {
  console.log(
    `[ok] verify-skills-sync: ${bundledWithSkillMd.length} bundled-skills with SKILL.md, ` +
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