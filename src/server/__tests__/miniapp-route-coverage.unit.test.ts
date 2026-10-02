/**
 * Every MiniApp endpoint the renderer calls must exist in the Node sidecar.
 *
 * The MiniApp scene tab POSTs `/api/miniapp/source` to fetch a MiniApp's
 * entry HTML. Rust implements that route, but the renderer's requests go to
 * the SIDECAR first, and the sidecar had no matching forward-port — so the
 * POST fell through to its 404 handler. Installing a MiniApp therefore
 * succeeded and then failed to open with
 * "Failed to load MiniApp source: HTTP 404", which reads like a corrupt
 * install rather than a missing route.
 *
 * The failure mode is invisible from any single file: the client declares the
 * endpoint, Rust serves it, and nothing in between complains. This test pins
 * the middle layer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function read(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf8');
}

function endpointsIn(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map(m => m[1]));
}

const sidecarRoutes = endpointsIn(
  read('server/index.ts'),
  /pathname === '(\/api\/miniapp\/[a-z/]*)'/g,
);

const rendererCalls = endpointsIn(
  read('renderer/lib/marketplaceClient.ts'),
  /'(\/api\/miniapp\/[a-z/]*)'/g,
);

describe('MiniApp sidecar route coverage', () => {
  it('the sidecar actually declares miniapp routes (guards the regex)', () => {
    // If either regex ever stops matching, the "no missing routes" assertion
    // below would pass vacuously.
    expect(sidecarRoutes.size).toBeGreaterThan(5);
    expect(rendererCalls.size).toBeGreaterThan(0);
  });

  it('forwards every MiniApp endpoint the renderer calls', () => {
    const missing = [...rendererCalls].filter(route => !sidecarRoutes.has(route));

    expect(
      missing,
      `Sidecar has no forward-port for: ${missing.join(', ')}. ` +
      'The renderer posts to the sidecar, not to Rust directly, so an ' +
      'endpoint implemented only in Rust 404s before it is ever reached.',
    ).toEqual([]);
  });

  it('forwards /api/miniapp/source, the one that was missing', () => {
    expect(rendererCalls).toContain('/api/miniapp/source');
    expect(sidecarRoutes).toContain('/api/miniapp/source');
  });
});
