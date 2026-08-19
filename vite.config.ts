import { readFileSync } from 'fs';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Read version info from package.json and Cargo.toml at build time
function getBuildVersions() {
  const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
  const cargoToml = readFileSync(resolve(__dirname, 'src-tauri/Cargo.toml'), 'utf-8');

  // Extract Claude Agent SDK version
  const claudeAgentSdkVersion = packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk']?.replace('^', '') || 'unknown';

  // Extract bundled Node.js version from scripts/download_nodejs.sh (NODE_VERSION="x.y.z")
  const nodeScript = (() => {
    try {
      return readFileSync(resolve(__dirname, 'scripts/download_nodejs.sh'), 'utf-8');
    } catch { return ''; }
  })();
  const nodeMatch = nodeScript.match(/NODE_VERSION\s*=\s*"([^"]+)"/);
  const nodeVersion = nodeMatch ? nodeMatch[1] : 'unknown';

  // Extract Tauri version from Cargo.toml (look for: tauri = { version = "2.9.5", ... })
  const tauriMatch = cargoToml.match(/tauri\s*=\s*\{\s*version\s*=\s*"([^"]+)"/);
  const tauriVersion = tauriMatch ? tauriMatch[1] : 'unknown';

  return {
    claudeAgentSdk: claudeAgentSdkVersion,
    node: nodeVersion,
    tauri: tauriVersion,
  };
}

const buildVersions = getBuildVersions();

// Vite 7 dep discovery scans dynamic imports before `resolve.alias` runs, so
// bare specifiers `chartjs-umd-source` / `d3-umd-source` / `lucide-umd-source`
// get registered with `optimizeDeps` even when excluded from prebundling —
// `optimizeDeps.exclude` skips prebundle but leaves the bare id in metadata,
// so at request time the alias redirects to an absolute file but the
// optimizer has no entry for that id → Vite errors
// "optimized info should be defined". An `enforce: 'pre'` plugin resolves
// the specifier in the CRAWLER phase too, so the optimizer never sees a bare
// name. The `?raw` query is preserved verbatim so Vite's built-in raw
// pipeline inlines the UMD source as a default-exported string.
//
// Plain `resolve.alias` would also fail here: Vite's alias uses
// `importee.replace(find, replacement)` so the lookahead keeps `?raw` intact,
// but the crawler regex-extracts bare specifiers BEFORE alias runs.
function widgetUmdSourceResolver(): Plugin {
  const files: Record<string, string> = {
    'chartjs-umd-source': resolve(__dirname, 'node_modules/chart.js/dist/chart.umd.js'),
    'd3-umd-source': resolve(__dirname, 'node_modules/d3/dist/d3.min.js'),
    'lucide-umd-source': resolve(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js'),
  };
  return {
    name: 'hamuna:widget-umd-source',
    enforce: 'pre',
    resolveId(source) {
      const queryIndex = source.indexOf('?');
      const name = queryIndex === -1 ? source : source.slice(0, queryIndex);
      const query = queryIndex === -1 ? '' : source.slice(queryIndex);
      const filePath = files[name];
      if (!filePath) return null;
      return filePath + query;
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // .env lives at the repo root, not under root/src/renderer. Vite's default
  // envDir is root, which would silently drop VITE_* vars (analytics). Point
  // it at the repo root.
  envDir: resolve(__dirname),
  plugins: [widgetUmdSourceResolver(), react(), tailwindcss()],
  optimizeDeps: {
    // Belt-and-suspenders with `widgetUmdSourceResolver` above: even if a
    // future crawler regression bypassed the pre plugin, the bare specifiers
    // must not enter the prebundle list (UMD files have no ESM exports and
    // crash esbuild's CJS-to-ESM transform). The pre plugin is the load-bearing
    // fix; this exclude is a guard rail.
    exclude: ['chartjs-umd-source', 'd3-umd-source', 'lucide-umd-source'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src/renderer') },
      // Force pdf.js's LEGACY (polyfilled) build everywhere. The modern build
      // calls `Map.prototype.getOrInsertComputed` (a 2024 TC39 proposal) which the
      // macOS WKWebView (JavaScriptCore) doesn't implement, so every page.render()
      // threw "getOrInsertComputed is not a function" → blank PDF. The legacy bundle
      // ships the polyfill (pdf.js's documented path for older engines). Regex so
      // ONLY the bare `pdfjs-dist` specifier is rewritten — subpath imports like
      // `pdfjs-dist/legacy/build/pdf.worker.min.mjs?url` must pass through untouched.
      { find: /^pdfjs-dist$/, replacement: resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs') },
    ]
  },
  // Define environment variables for client code
  define: {
    // DEBUG_MODE: true when VITE_DEBUG_MODE is set or in dev server mode
    '__DEBUG_MODE__': JSON.stringify(process.env.VITE_DEBUG_MODE === 'true'),
    // Build-time version info for developer mode
    '__BUILD_VERSIONS__': JSON.stringify(buildVersions),
  },
  server: {
    port: 5173,
    proxy: {
      // All API endpoints under /api/ (excludes source files like /api/*.ts).
      // The excluded-source check must tolerate the HMR `?t=` timestamp query
      // that Vite appends to `.ts` imports (`/api/spaceCloud.ts?t=…`) — the old
      // `\.(ts|tsx|js|jsx)$` anchored on the raw URL end, so a timestamp query
      // made it look non-source and the request was wrongly proxied to the
      // sidecar (403/404 → dynamic-import failure → AppErrorBoundary).
      '^/api/(?!.*\\.(ts|tsx|js|jsx)(\\?|$))': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path, // Keep path as-is
      },
      '/chat': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/sessions': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // P1: pages are route-split (React.lazy in App.tsx); the markdown / mermaid /
    // katex / syntax-highlighter chain now lives in the lazy Chat chunk, not the
    // entry. Limit stays generous because the Chat chunk itself is still large.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Stable vendor chunk for the React runtime so it caches across app
        // updates (app code changes every release; React rarely does).
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  }
});
