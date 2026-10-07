#!/usr/bin/env node
// Post-generation gate for MiniApps: syntax, then method contract.
//
//   node --import tsx/esm scripts/validate-miniapp.mts <miniapp-dir> [...]
//
// Exits 0 when every behaviour layer parses AND every `app.*` call resolves to
// something the host implements, 1 otherwise, printing the failing file, the
// 1-based line/column, and the exact source line so the caller can feed it
// straight back into a regeneration prompt.
//
// Two checks because they fail in opposite directions. A parse error means the
// browser discards the file and the page renders as static markup. An unknown
// method parses fine, renders fine, passes every colour and token probe — and
// then throws `TypeError: app.fs.readFileSync is not a function` the moment a
// button is pressed. Neither is visible in a screenshot.
//
// Why this exists as a standalone step rather than a test: the file being
// checked is usually *not in the repo yet*. It is whatever an AI just wrote into
// a workspace, which no committed test can see. The repo-side guards
// (`src/shared/miniapp/method-contract.unit.test.ts`,
// `src/shared/miniapp/miniapp-script-syntax.test.ts`) cover everything that has
// been committed; this covers the gap between "the model returned" and "someone
// committed it", which is exactly where both failures are cheapest to catch
// and most expensive to miss.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { findAppMethodErrors, formatAppMethodError } from '../src/shared/miniapp/method-contract';
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
    + 'Exits 1 if any behaviour layer fails to parse or calls a method the host\n'
    + 'does not implement.\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) usage();

const parseErrors: ScriptSyntaxError[] = [];
const methodErrors: ReturnType<typeof findAppMethodErrors> = [];
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
    const file = relative(process.cwd(), path) || path;
    const syntax = findScriptSyntaxError(source, file);
    if (syntax) {
      parseErrors.push(syntax);
      // Call sites in unparseable source are not attributable; the syntax error
      // is the actionable one and repeating it as method errors would bury it.
      continue;
    }
    methodErrors.push(...findAppMethodErrors(source, file));
  }
}

if (parseErrors.length === 0 && methodErrors.length === 0) {
  const suffix = args.length > 1 ? ` (${args.length} apps)` : '';
  console.log(`ok: ${checked} behaviour layer${checked === 1 ? '' : 's'} passed${suffix}`);
  process.exit(0);
}

const blocks: string[] = [];
if (parseErrors.length > 0) {
  blocks.push(
    `${parseErrors.length} of ${checked} behaviour layer(s) failed to parse:\n\n`
    + parseErrors.map(formatScriptSyntaxError).join('\n\n')
    + '\n\nFix the source and re-run. Do not ship a MiniApp that does not parse —\n'
    + 'a parse error means the page renders as static markup and looks merely\n'
    + '"unfinished" rather than broken.\n',
  );
}
if (methodErrors.length > 0) {
  blocks.push(
    `${methodErrors.length} call(s) name a method the host does not implement:\n\n`
    + methodErrors.map(formatAppMethodError).join('\n\n')
    + '\n',
  );
}
process.stderr.write(`\n${blocks.join('\n')}`);
process.exit(1);