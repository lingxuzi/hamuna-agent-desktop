#!/usr/bin/env node
// Post-generation syntax gate for MiniApps.
//
//   node --import tsx/esm scripts/validate-miniapp.mts <miniapp-dir> [...]
//
// Exits 0 when every behaviour layer parses, 1 otherwise, printing the failing
// file, the 1-based line/column, and the exact source line so the caller can
// feed it straight back into a regeneration prompt.
//
// Why this exists as a standalone step rather than a test: the file being
// checked is usually *not in the repo yet*. It is whatever an AI just wrote into
// a workspace, which no committed test can see. The repo-side guard
// (`src/shared/miniapp/miniapp-script-syntax.test.ts`) covers everything that
// has been committed; this covers the gap between "the model returned" and
// "someone committed it", which is exactly where a syntax error is cheapest to
// catch and most expensive to miss.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  MINIAPP_SCRIPT_NAMES,
  findScriptSyntaxError,
  formatScriptSyntaxError,
  type ScriptSyntaxError,
} from '../src/shared/miniapp/script-syntax';

function collectScripts(dir: string): string[] {
  const srcDir = join(dir, 'source');
  if (!existsSync(srcDir)) return [];
  return MINIAPP_SCRIPT_NAMES
    .map(name => join(srcDir, name))
    .filter(path => existsSync(path));
}

function usage(): never {
  process.stderr.write(
    'usage: node --import tsx/esm scripts/validate-miniapp.mts <miniapp-dir> [...]\n'
    + '\n'
    + 'Each directory is a MiniApp root (containing meta.json and source/).\n'
    + 'Exits 1 if any behaviour layer fails to parse.\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) usage();

const errors: ScriptSyntaxError[] = [];
let checked = 0;

for (const arg of args) {
  const dir = resolve(arg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`not a directory: ${arg}\n`);
    process.exit(2);
  }
  const scripts = collectScripts(dir);
  if (scripts.length === 0) {
    // Not a failure: a MiniApp may legitimately be style/markup only, and the
    // committed guard makes the same allowance for the template.
    continue;
  }
  for (const path of scripts) {
    checked++;
    const source = readFileSync(path, 'utf8');
    const error = findScriptSyntaxError(source, relative(process.cwd(), path) || path);
    if (error) errors.push(error);
  }
}

if (errors.length === 0) {
  const suffix = args.length > 1 ? ` (${args.length} apps)` : '';
  console.log(`ok: ${checked} behaviour layer${checked === 1 ? '' : 's'} parsed${suffix}`);
  process.exit(0);
}

process.stderr.write(
  `\n${errors.length} of ${checked} behaviour layer(s) failed to parse:\n\n`
  + errors.map(formatScriptSyntaxError).join('\n\n')
  + '\n\nFix the source and re-run. Do not ship a MiniApp that does not parse —\n'
  + 'a parse error means the page renders as static markup and looks merely\n'
  + '"unfinished" rather than broken.\n',
);
process.exit(1);