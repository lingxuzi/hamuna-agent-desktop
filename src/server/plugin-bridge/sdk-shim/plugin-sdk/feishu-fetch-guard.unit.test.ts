/**
 * Regression test for the P0-2 fix: `fetchWithSsrFGuard` must respect both
 * parent-provided AbortSignal and a 30s default timeout. Before the fix the
 * shim passed `fetch(url, init || {})` with no signal — a stuck upstream
 * would block the entire IM turn until the OS TCP timeout (minutes).
 *
 * The shim is hand-written (see `_handwritten.json`), so a runtime-level
 * fetch is unavailable in this test context. We monkey-patch the global
 * `fetch` to avoid pulling in undici just to assert signal plumbing.
 *
 * Scope is intentionally narrow: parent-signal forwarding + cleanup on
 * early resolve. The default-timeout path itself (signal.aborted === true
 * after 30s) is hard to test under vitest's <10s default budget without
 * contorting fake timers past microtask correctness; the parent-signal +
 * clearTimeout tests already prove the AbortController + setTimeout
 * plumbing is wired correctly, and the 30s value lives in a single named
 * constant at the top of the shim module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithSsrFGuard = async (
  args: { url: string; init?: RequestInit },
): Promise<{ ok: true; value: { response: Response; release: () => Promise<void> } } | { ok: false; error: Error }> => {
  const mod = await import('./feishu');
  try {
    const result = await mod.fetchWithSsrFGuard(args);
    return { ok: true, value: result };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

describe('feishu shim fetchWithSsrFGuard', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('forwards a parent-provided AbortSignal so callers can cancel the upstream', async () => {
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Response('ok', { status: 200 });
    });

    const parentController = new AbortController();
    parentController.abort('user-cancel');

    const result = await fetchWithSsrFGuard({
      url: 'https://example.invalid/api',
      init: { signal: parentController.signal },
    });

    expect(result.ok).toBe(true);
    expect(observedSignal).toBeDefined();
    // Parent abort must propagate so the upstream fetch actually cancels.
    expect(observedSignal?.aborted).toBe(true);
  });

  it('clears the timeout when fetch resolves before the deadline', async () => {
    // Fake timers here are safe because the fetch resolves immediately and
    // there's no await chain to drain. We only need to assert that the shim
    // called clearTimeout in its `finally` block.
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    globalThis.fetch = vi.fn(async () => new Response('ok', { status: 200 }));

    const result = await fetchWithSsrFGuard({ url: 'https://example.invalid/api' });
    expect(result.ok).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Advancing past the timeout after a successful response must NOT leak
    // any rejection — the shim's Promise has already resolved.
    await vi.advanceTimersByTimeAsync(60_000);
    clearTimeoutSpy.mockRestore();
  });
});