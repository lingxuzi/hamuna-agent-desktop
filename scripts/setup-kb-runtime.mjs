// setup-kb-runtime.mjs — populate src-tauri/resources/kb-runtime/ with the
// native-adjacent deps the KB store needs at RUNTIME but esbuild must NOT
// inline into the ESM server-dist.js bundle.
//
// Why this exists (Windows prod crash, fixed here):
//   better-sqlite3 (CJS) locates its per-platform prebuild via
//   `path.join(__dirname, '../prebuilds/<platform>-<arch>.node')`, and
//   jieba-wasm reads `path.join(__dirname, 'jieba_rs_wasm_bg.wasm')`. When
//   esbuild bundles a CJS module into the ESM server-dist.js, `__dirname`
//   stops existing (ReferenceError) — and even a banner shim can't help
//   because the .node/.wasm files live next to the REAL module on disk, not
//   next to the bundle. Dev (tsx, real node_modules) never hit this; the
//   packaged app does, every KB poll, forever:
//     [kb-relations] poll failed: ReferenceError: __dirname is not defined
//     at getPrebuildPath (server-dist.js)   ← better-sqlite3
//     at jieba_rs_wasm.js (server-dist.js)  ← jieba-wasm
//
// The fix mirrors sharp-runtime: keep the packages OUT of the bundle
// (esbuild `external`), ship their real directories as a Tauri resource, and
// let Node resolve the bare imports at runtime. kb-runtime's contents are
// laid out as a node_modules root — tauri.conf.json maps this dir to
// "node_modules" (resource-dir root), exactly where Node's ESM resolver
// walks up from server-dist.js to find `better-sqlite3` / `jieba-wasm`.
//
// Copy-from-project-node_modules (not npm install): the dev install already
// carries every platform prebuild (better-sqlite3 ships all 8 prebuilds in
// node_modules/better-sqlite3/prebuilds/), so one copy serves darwin/linux/
// win32 × x64/arm64 builds — no per-target npm install needed.
//
// Usage: node scripts/setup-kb-runtime.mjs

import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

// ── Packages to ship out-of-bundle ─────────────────────────────────────────
// better-sqlite3: native .node prebuild; jieba-wasm: .wasm + loader. Both are
// CJS and read files relative to __dirname — the exact thing esbuild-inline
// breaks. Keep in sync with `external` in esbuild-bundle.mjs (server target).
const KB_RUNTIME_PACKAGES = ['better-sqlite3', 'jieba-wasm'];

const RUNTIME_DIR = resolve(PROJECT_ROOT, 'src-tauri', 'resources', 'kb-runtime');

await rm(RUNTIME_DIR, { recursive: true, force: true });
await mkdir(RUNTIME_DIR, { recursive: true });

for (const pkg of KB_RUNTIME_PACKAGES) {
  const src = resolve(PROJECT_ROOT, 'node_modules', pkg);
  const dst = resolve(RUNTIME_DIR, pkg);
  await cp(src, dst, { recursive: true });
  console.log(`  ↳ copied node_modules/${pkg} → kb-runtime/${pkg}`);
}

// Strip nested .bin shims (platform launcher junk, not needed at runtime).
await rm(resolve(RUNTIME_DIR, 'better-sqlite3', 'node_modules'), { recursive: true, force: true }).catch(() => {});
console.log(`✓ kb-runtime → ${RUNTIME_DIR}`);
