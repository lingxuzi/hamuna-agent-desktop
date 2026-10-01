// kinds/file-explorer.ts — file-explorer worker kind definition (Phase 4.2).
//
// Second concrete kind registered via the Phase 4.1 registry. Methods:
//   - file.tree:     recursive directory listing up to a depth cap
//   - file.read:     bounded-size text read (skips binary)
//   - file.search:   case-insensitive substring scan across files in a dir
//
// All handlers run INSIDE the worker thread (post-shim) so `fs` access here
// uses the host bundle's `node:fs` import — the user code loaded via the
// shim still cannot require('fs'). Each handler opens its own paths and
// defends against symlink escapes with `fs.lstatSync` + canonicalize.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { z } from 'zod';

import {
  registerKind,
  type WorkerKindDef,
  type WorkerMethodHandler,
} from '../worker-rpc';

const here = path.dirname(fileURLToPath(import.meta.url));

// ───── schemas ────────────────────────────────────────────────────────────────

const FileTreeParams = z.object({
  root: z.string().min(1),
  maxDepth: z.number().int().min(1).max(8).default(4),
  // Cap entries so a single MiniApp can't enumerate a million-file repo.
  maxEntries: z.number().int().min(1).max(5000).default(500),
});

const FileReadParams = z.object({
  path: z.string().min(1),
  // 256KB cap mirrors tool_attachment_pipeline.md's spill threshold. Binary
  // detection (see handler) returns null content rather than throwing so the
  // MiniApp UI can fall back to a download link.
  maxBytes: z.number().int().min(1).max(1024 * 1024).default(256 * 1024),
});

const FileSearchParams = z.object({
  root: z.string().min(1),
  query: z.string().min(1),
  // Glob is intentionally NOT supported — path-template expansion at install
  // time defines the scope (mirror git-graph's `$WORKSPACE/**` pattern). Plain
  // substring keeps the handler a single-file scan, no glob parser dep.
  maxHits: z.number().int().min(1).max(500).default(50),
  caseInsensitive: z.boolean().default(true),
});

// ───── guards ─────────────────────────────────────────────────────────────────

function assertReadableRoot(root: string): string {
  const resolved = path.resolve(root);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error(`root not accessible: ${resolved}`);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`root is a symlink (refused): ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`root is not a directory: ${resolved}`);
  }
  return resolved;
}

function isBinary(buf: Buffer, sampleBytes = 4096): boolean {
  const end = Math.min(buf.length, sampleBytes);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// ───── handlers ───────────────────────────────────────────────────────────────

interface TreeEntry {
  rel: string;
  type: 'file' | 'dir';
  size: number;
}

const fileTree: WorkerMethodHandler<z.infer<typeof FileTreeParams>> = (params) => {
  const root = assertReadableRoot(params.root);
  const maxDepth = params.maxDepth;
  const maxEntries = params.maxEntries;
  const out: TreeEntry[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || out.length >= maxEntries) {
      truncated = truncated || out.length >= maxEntries;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) continue;
      const rel = path.relative(root, abs);
      if (ent.isDirectory()) {
        out.push({ rel: rel || '.', type: 'dir', size: 0 });
        walk(abs, depth + 1);
      } else if (ent.isFile()) {
        out.push({ rel, type: 'file', size: lstat.size });
      }
    }
  };

  walk(root, 0);
  return { root, entries: out, truncated };
};

const fileRead: WorkerMethodHandler<z.infer<typeof FileReadParams>> = (params) => {
  const resolved = path.resolve(params.path);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error(`file not accessible: ${resolved}`);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`file is a symlink (refused): ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new Error(`not a file: ${resolved}`);
  }
  const buf = fs.readFileSync(resolved);
  const slice = buf.subarray(0, params.maxBytes);
  const binary = isBinary(slice);
  return {
    path: resolved,
    size: stat.size,
    truncated: buf.length > params.maxBytes,
    binary,
    // Empty content for binary so the MiniApp UI doesn't try to render base64.
    content: binary ? '' : slice.toString('utf8'),
  };
};

interface SearchHit {
  rel: string;
  line: number;
  snippet: string;
}

const fileSearch: WorkerMethodHandler<z.infer<typeof FileSearchParams>> = (params) => {
  const root = assertReadableRoot(params.root);
  const needle = params.caseInsensitive ? params.query.toLowerCase() : params.query;
  const hits: SearchHit[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (hits.length >= params.maxHits) {
        truncated = true;
        return;
      }
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        walk(abs, depth + 1);
      } else if (ent.isFile() && lstat.size <= 256 * 1024) {
        const buf = fs.readFileSync(abs);
        if (isBinary(buf)) continue;
        const text = buf.toString('utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (hits.length >= params.maxHits) {
            truncated = true;
            return;
          }
          const hay = params.caseInsensitive ? lines[i].toLowerCase() : lines[i];
          if (hay.includes(needle)) {
            hits.push({
              rel: path.relative(root, abs),
              line: i + 1,
              snippet: lines[i].slice(0, 200),
            });
          }
        }
      }
    }
  };

  walk(root, 0);
  return { root, query: params.query, hits, truncated };
};

// ───── kind export ────────────────────────────────────────────────────────────

export const FILE_EXPLORER_KIND: WorkerKindDef = {
  kind: 'file-explorer',
  entryPath: path.join(here, '..', 'worker-entry-file-explorer.js'),
  methods: [
    { name: 'file.tree', schema: FileTreeParams, handler: fileTree as never },
    { name: 'file.read', schema: FileReadParams, handler: fileRead as never },
    { name: 'file.search', schema: FileSearchParams, handler: fileSearch as never },
  ],
};

registerKind(FILE_EXPLORER_KIND);
