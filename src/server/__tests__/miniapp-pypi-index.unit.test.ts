/**
 * The PyPI index an MCP subprocess actually reaches.
 *
 * `multimedia-creator` is a `uv tool run` server, so its first spawn resolves a
 * Python distribution over the network. That made it the slowest MCP to open,
 * and the config shipped a per-server `UV_INDEX_URL` pinned at pypi.org while
 * the Sidecar was already being launched with a domestic mirror.
 *
 * Two traps this file exists to prevent, both found by measuring rather than
 * reading:
 *
 *  1. Deleting the per-server key is NOT the fix. `buildMcpSubprocessEnv` is
 *     an allowlist — it forwards proxy keys, NO_PROXY and PATH, and nothing
 *     else. The mirror the Sidecar inherits therefore never reaches the child,
 *     which silently falls back to uv's own default (pypi.org). The value has
 *     to be present HERE for it to be present there.
 *
 *  2. A mirror that does not carry the package is worse than no mirror. At the
 *     time of writing, pypi.tuna.tsinghua.edu.cn answered 403 for the
 *     project's own `agnes-video-25-mcp` — and for every other package probed
 *     alongside it — so pointing uv at it broke the install outright. This
 *     test is a reminder to re-measure before repointing, not a guarantee that
 *     a given mirror is reachable from every network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'extended_buildin_mcp', 'mcp.json'), 'utf8'),
) as { servers: Array<{ id: string; env?: Record<string, string> }> };

const sidecarInstances = readFileSync(
  join(repoRoot, 'src-tauri', 'src', 'sidecar', 'instances.rs'),
  'utf8',
);

const multimedia = manifest.servers.find(s => s.id === 'multimedia-creator');

/** Extract the index host configured for a given env key in the Rust spawn. */
function sidecarIndex(key: 'UV_INDEX_URL' | 'PIP_INDEX_URL'): string | null {
  const match = new RegExp(`cmd\\.env\\("${key}",\\s*"([^"]+)"\\)`).exec(sidecarInstances);
  return match ? match[1] : null;
}

describe('MiniApp PyPI index', () => {
  it('multimedia-creator is present in the extended MiniApp manifest', () => {
    // Otherwise every assertion below passes vacuously.
    expect(multimedia).toBeDefined();
  });

  it('declares UV_INDEX_URL so the child actually receives an index', () => {
    // Not "it has a mirror" — it HAS the key. Without it the allowlist in
    // buildMcpSubprocessEnv drops the inherited value and uv silently uses
    // pypi.org, which is the regression this file guards.
    expect(multimedia!.env?.UV_INDEX_URL).toBeTruthy();
  });

  it('does not pin pypi.org, which is the slow path this was meant to avoid', () => {
    expect(multimedia!.env?.UV_INDEX_URL).not.toMatch(/^https:\/\/pypi\.org/);
  });

  it('uses a mirror that carries the package it installs', async () => {
    // Best-effort reachability probe. Skipped when the network is unavailable
    // rather than failing the suite on someone else's outage.
    const url = multimedia!.env?.UV_INDEX_URL;
    if (!url) return;
    let status: number;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/agnes-video-25-mcp/`, {
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
    } catch {
      return; // offline — nothing to assert
    }
    expect(status, `${url} must serve the package, got HTTP ${status}`).toBe(200);
  });

  it('stays consistent with the index the Sidecar injects for uv', () => {
    // The Sidecar already launches with a UV index. If the two drift, a reader
    // has no way to tell which one an MCP actually resolves against.
    const sidecar = sidecarIndex('UV_INDEX_URL');
    expect(sidecar).toBeTruthy();
    expect(multimedia!.env?.UV_INDEX_URL).toBe(sidecar);
  });

  it('keeps PIP_INDEX_URL on a mirror too (Python skills share the same network)', () => {
    const pip = sidecarIndex('PIP_INDEX_URL');
    expect(pip).toBeTruthy();
    expect(pip).not.toMatch(/^https:\/\/pypi\.org/);
  });
});
