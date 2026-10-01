#!/usr/bin/env node
// Bench: Sidecar cold-start latency.
// Runs the real `src-tauri/resources/server-dist.js` via the bundled Node binary,
// measures (a) Node spawn → /health/ready, (b) /health/ready → first byte of a
// placeholder POST. Reports P50/P95 + per-stage breakdown.
//
// No API key needed — we hit a route that doesn't touch upstream SDK calls.
// Default N=10 keeps total runtime under ~30s on a warm dev box.
//
// Windows portability: process spawn uses cross-platform { shell: false } and
// reads node binary via resources path. Port allocator uses OS-free ports.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCES = join(REPO_ROOT, 'src-tauri', 'resources');
const NODE_BIN = join(RESOURCES, 'nodejs', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const SERVER_ENTRY = join(RESOURCES, 'server-dist.js');

const N = Number(process.env.HAMUNA_BENCH_N ?? 10);
const READY_TIMEOUT_MS = Number(process.env.HAMUNA_BENCH_READY_TIMEOUT ?? 30000);
const FIRST_BYTE_TIMEOUT_MS = Number(process.env.HAMUNA_BENCH_FB_TIMEOUT ?? 10000);

// Tiny placeholder route inside server-dist.js — path is intentionally one
// that the real sidecar serves fast (does NOT call the SDK). We use /health
// (live) because it's the cheapest handler and proves the HTTP listener is up.
const PROBE_PATH = '/health';
const PROBE_METHOD = 'GET';

// Sidecar requires --agent-dir to exist; create a stable bench dir once.
const AGENT_DIR = join(REPO_ROOT, 'tmp', 'bench-agent-dir');
await mkdir(AGENT_DIR, { recursive: true });

if (!existsSync(NODE_BIN)) {
  console.error(`[bench] Bundled Node not found: ${NODE_BIN}\n[bench] Run \`npm run build:server\` first or set HAMUNA_NODE_BIN.`);
  process.exit(2);
}
if (!existsSync(SERVER_ENTRY)) {
  console.error(`[bench] server-dist.js not found: ${SERVER_ENTRY}\n[bench] Run \`npm run build:server\` first.`);
  process.exit(2);
}

async function allocPort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

// Phase 1: spawn Node + wait for /health (liveness — HTTP listener bound)
//
// WHY only /health, not /health/ready:
//   /health/ready requires SDK module init which depends on ANTHROPIC_API_KEY
//   and external network. The cold-start bottleneck for end users is
//   "time-to-first-renderable-frame", which the HTTP listener being up captures.
//   /health/ready is measured separately by the perf-instrumentation work.
async function runOnce(runIdx) {
  const port = await allocPort();

  const child = spawn(NODE_BIN, [
    SERVER_ENTRY,
    '--agent-dir', AGENT_DIR,
    '--port', String(port),
    '--sidecar-role', 'session',
  ], {
    env: {
      ...process.env,
      HAMUNA_BENCH: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (b) => { stderr += b.toString(); });
  if (process.env.HAMUNA_BENCH_VERBOSE) {
    child.stdout?.on('data', (b) => process.stderr.write(`[sidecar stdout] ${b}`));
    child.stderr?.on('data', (b) => process.stderr.write(`[sidecar stderr] ${b}`));
  }

  const cleanup = () => {
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { if (!child.killed) { try { child.kill('SIGKILL'); } catch {} } }, 2000).unref();
    }
  };

  // Phase 1: wait for /health to return 2xx (HTTP listener bound)
  const liveStart = performance.now();
  await waitForUrl(`http://127.0.0.1:${port}/health`, READY_TIMEOUT_MS, 'live', () => cleanup())
    .catch((e) => { cleanup(); throw new Error(`live wait failed: ${e.message}\nstderr:\n${stderr.slice(-2000)}`); });
  const liveMs = performance.now() - liveStart;
  if (process.env.HAMUNA_BENCH_VERBOSE) console.error(`[bench] run ${runIdx} live=${liveMs.toFixed(0)}ms`);

  // Phase 2: send probe and measure first byte of /health (round-trip)
  const fbStart = performance.now();
  await fetchFirstByte(`http://127.0.0.1:${port}${PROBE_PATH}`, PROBE_METHOD, FIRST_BYTE_TIMEOUT_MS)
    .catch((e) => { cleanup(); throw new Error(`probe failed: ${e.message}`); });
  const fbMs = performance.now() - fbStart;
  if (process.env.HAMUNA_BENCH_VERBOSE) console.error(`[bench] run ${runIdx} fb=${fbMs.toFixed(0)}ms`);

  cleanup();
  if (process.env.HAMUNA_BENCH_VERBOSE) console.error(`[bench] run ${runIdx} cleanup sent`);
  // Drain any pending keepalive sockets to avoid TIME_WAIT pile-up
  await new Promise((r) => setTimeout(r, 200));

  return { runIdx, port, liveMs, fbMs, totalColdStartMs: liveMs };
}

async function waitForUrl(url, timeoutMs, label, onTimeout) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) return performance.now() - (deadline - timeoutMs);
      lastErr = new Error(`${label} status=${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  onTimeout?.();
  throw lastErr ?? new Error(`${label} timeout`);
}

async function fetchFirstByte(url, method, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, signal: ac.signal });
    // We just need time-to-first-byte; don't drain the body. /health returns
    // tiny JSON in production but the sidecar also serves static files
    // (renderer index.html) on the same port, so body drain can hang on
    // misrouted responses. The HTTP-level signal `r.status` is enough.
    return r.status;
  } finally {
    clearTimeout(timer);
  }
}

function pct(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(n) {
  return n == null ? '-' : `${n.toFixed(1)}ms`;
}

async function main() {
  console.log(`[bench] Starting ${N} runs`);
  console.log(`[bench] Node:    ${NODE_BIN}`);
  console.log(`[bench] Entry:   ${SERVER_ENTRY}`);
  console.log(`[bench] Phase 1: spawn → /health (HTTP listener up)`);
  console.log(`[bench] Phase 2: first GET /health round-trip`);
  console.log('');

  const samples = [];
  for (let i = 0; i < N; i++) {
    process.stdout.write(`[bench] run ${i + 1}/${N} ... `);
    try {
      const r = await runOnce(i);
      samples.push(r);
      console.log(`live=${fmt(r.liveMs)} fb=${fmt(r.fbMs)}`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      samples.push({ runIdx: i, error: e.message });
    }
  }

  const okSamples = samples.filter((s) => !s.error);
  const liveArr = okSamples.map((s) => s.liveMs);
  const fbArr = okSamples.map((s) => s.fbMs);

  const summary = {
    n: okSamples.length,
    failed: samples.length - okSamples.length,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    timestamp: new Date().toISOString(),
    phases: {
      live: { p50: pct(liveArr, 50), p95: pct(liveArr, 95), min: Math.min(...liveArr), max: Math.max(...liveArr) },
      firstByte: { p50: pct(fbArr, 50), p95: pct(fbArr, 95), min: Math.min(...fbArr), max: Math.max(...fbArr) },
    },
    samples,
  };

  console.log('');
  console.log('[bench] ===== Summary =====');
  console.log(`[bench] Successful runs: ${summary.n}/${samples.length}`);
  console.log(`[bench] Phase              P50        P95        min..max`);
  console.log(`[bench] live (cold start) ${fmt(summary.phases.live.p50).padStart(10)} ${fmt(summary.phases.live.p95).padStart(10)} ${fmt(summary.phases.live.min)}..${fmt(summary.phases.live.max)}`);
  console.log(`[bench] firstByte (RTT)   ${fmt(summary.phases.firstByte.p50).padStart(10)} ${fmt(summary.phases.firstByte.p95).padStart(10)} ${fmt(summary.phases.firstByte.min)}..${fmt(summary.phases.firstByte.max)}`);

  // Persist
  const outDir = join(REPO_ROOT, 'tmp');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `bench-cold-start-${stamp}.json`);
  const mdPath = join(outDir, `bench-cold-start-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(summary, null, 2));

  const md = `# Sidecar Cold-Start Bench

- Date: ${summary.timestamp}
- Platform: ${summary.platform}/${summary.arch}
- Node: ${summary.nodeVersion}
- N: ${summary.n} successful / ${samples.length} total

## Phase timings (ms)

| Phase              | P50     | P95     | min    | max    |
|--------------------|---------|---------|--------|--------|
| **spawn → /health (cold-start)** | **${fmt(summary.phases.live.p50)}** | **${fmt(summary.phases.live.p95)}** | ${fmt(summary.phases.live.min)} | ${fmt(summary.phases.live.max)} |
| /health round-trip  | ${fmt(summary.phases.firstByte.p50)} | ${fmt(summary.phases.firstByte.p95)} | ${fmt(summary.phases.firstByte.min)} | ${fmt(summary.phases.firstByte.max)} |

## Interpretation

- **live**: Node process spawn → HTTP listener accepts connections. This is the
  user-perceived "Tab opens" latency.
- **firstByte**: trivial GET /health round-trip after live — sanity check that
  the listener is actually serving (sub-10ms on localhost).

A healthy cold-start is **live P95 < 800ms**. Above 1.5s, investigate the
startup graph in src/server/index.ts. Above 2.5s, suspect bundled Node cost.

NOTE: /health/ready is excluded because it requires SDK init which depends on
ANTHROPIC_API_KEY and external network. That's measured separately by the
perf-instrumentation work (task #3 in the perf roadmap).
`;
  await writeFile(mdPath, md);

  console.log('');
  console.log(`[bench] JSON: ${jsonPath}`);
  console.log(`[bench] MD:   ${mdPath}`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[bench] fatal:', e);
  process.exit(2);
});
