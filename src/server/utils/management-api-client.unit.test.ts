/**
 * Regression: the Sidecar generation header name MUST match the name Rust
 * reads (`x-hamuna-sidecar-generation`, management_api.rs::request_sidecar_generation).
 *
 * The initial implementation sent `X-HamunaAgent-Sidecar-Generation` — a
 * different header (no hyphen before `Sidecar`) — so Rust never saw it and
 * every generation-guarded management call (cron `/api/task/turn/authorize`,
 * goal endpoints, `/api/grok/bearer`) got a 409 "A valid Sidecar generation is
 * required", which surfaced as "sidecar 找不到" on cron tasks.
 */

import { describe, expect, it, vi } from 'vitest';

// management-api-client reads HAMUNA_MANAGEMENT_PORT / HAMUNA_SIDECAR_GENERATION
// into top-level consts at module load, so the env MUST be set before the
// dynamic import below — beforeEach stubEnv is too late.
process.env.HAMUNA_MANAGEMENT_PORT = '4242';
process.env.HAMUNA_SIDECAR_GENERATION = '17';

const { mockCancellableFetch } = vi.hoisted(() => ({
  mockCancellableFetch: vi.fn<
    (url: string, init?: RequestInit, opts?: { parentSignal?: AbortSignal; timeoutMs?: number }) => Promise<Response>
  >(),
}));

vi.mock('./cancellation', () => ({
  cancellableFetch: (url: string, init?: RequestInit, opts?: { parentSignal?: AbortSignal; timeoutMs?: number }) =>
    mockCancellableFetch(url, init, opts),
}));

const { managementApi } = await import('./management-api-client');

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('managementApi sidecar generation header', () => {
  it('sends the exact header name Rust reads (x-hamuna-sidecar-generation)', async () => {
    mockCancellableFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await managementApi('/api/task/turn/authorize', 'POST', {});

    expect(mockCancellableFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockCancellableFetch.mock.calls[0];
    const headers =
      init?.headers instanceof Headers ? init.headers : new Headers((init?.headers as Record<string, string>) ?? {});
    expect(headers.get('X-Hamuna-Sidecar-Generation')).toBe('17');
    // Rust reads the lowercase-hyphenated form; HTTP is case-insensitive, so
    // the exact case is cosmetic — but the hyphen placement is not.
    expect(headers.get('X-HamunaAgent-Sidecar-Generation')).toBeNull();
  });
});
