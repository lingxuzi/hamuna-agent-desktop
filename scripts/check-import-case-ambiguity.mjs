#!/usr/bin/env node

// Guard against extensionless imports that resolve to a DIFFERENT file
// depending on the filesystem's case sensitivity.
//
// Vite resolves `./Foo` by trying DEFAULT_EXTENSIONS in order
// (.mjs, .js, .mts, .ts, .jsx, .tsx, .json) — `.ts` BEFORE `.tsx`. On a
// case-sensitive FS (Linux CI) `Foo.ts` and `foo.ts` are different files, so
// the extensionless import of `Foo` falls through to `Foo.tsx`. On a
// case-INSENSITIVE FS (Windows/macOS runners) `Foo.ts` matches `foo.ts`,
// `.ts` wins the extension order, and the import silently binds the wrong
// module — the Windows release build died with
// `"SidebarWorkspaceTree" is not exported by "sidebarWorkspaceTree.ts"`.
//
// The repo's own rule (CLAUDE.md) says a fix must leave an executable
// contract behind. This script is that contract: it fails `npm run lint`
// the moment two files in one directory share a stem case-insensitively.
//
// Only extensions Vite can actually resolve are considered — `.css` / `.png`
// / `.cmd` are NOT in DEFAULT_EXTENSIONS, so `Theme.ts` + `Theme.css` is
// safe and must not be reported. Files whose stems differ ONLY by case are
// the dangerous ones: `index.ts` + `index.tsx` resolve identically on both
// filesystems and are safe.

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src'];

// Mirrors vite's DEFAULT_EXTENSIONS — the only suffixes that can shadow an
// extensionless import. `.css` and friends are excluded on purpose.
const RESOLVABLE_EXTENSIONS = new Set(['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    out.push(path);
  }
  return out;
}

function stemOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot);
}

const errors = [];

for (const scanRoot of SCAN_ROOTS) {
  const files = walk(join(ROOT, scanRoot));
  const byDirectory = new Map();
  for (const file of files) {
    const dir = join(file, '..');
    if (!byDirectory.has(dir)) byDirectory.set(dir, []);
    byDirectory.get(dir).push(file);
  }

  for (const [dir, dirFiles] of byDirectory) {
    const groups = new Map();
    for (const file of dirFiles) {
      const extension = extensionOf(file);
      if (!RESOLVABLE_EXTENSIONS.has(extension)) continue;
      const stem = stemOf(file);
      const key = stem.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ stem, file });
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const stems = new Set(group.map((entry) => entry.stem));
      // Identical stems (e.g. `index.ts` + `index.tsx`) resolve the same way
      // on every filesystem — only case-DIFFERENT stems can diverge.
      if (stems.size < 2) continue;
      const names = group.map((entry) => relative(ROOT, entry.file).replace(/\\/g, '/')).sort();
      errors.push([
        `Case-ambiguous module files in ${relative(ROOT, dir).replace(/\\/g, '/')}:`,
        ...names.map((name) => `  - ${name}`),
        `An extensionless import resolves to the ".ts" match on a case-INSENSITIVE`,
        'filesystem (Windows/macOS) but to the ".tsx" match on Linux. Rename one',
        'file so the stem is unique.',
      ].join('\n'));
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}

console.log('import case-ambiguity ok: no colliding module stems in src/');
