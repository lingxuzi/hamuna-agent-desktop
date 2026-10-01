// MiniAppRunner / worker-call wire-up — confirms the runner's worker-call
// postMessage listener (a) ignores foreign sources, (b) terminates a spawned
// worker on unmount. Pure trust rules are covered in
// `workerCallBridge.unit.test.ts`; this file covers the React wiring.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MiniAppRunner from './MiniAppRunner';
import { __resetWorkerKindsForTest } from './workerCallBridge';

const apiPostJson = vi.fn();
const apiGetJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

describe('MiniAppRunner / worker call wire-up', () => {
  afterEach(() => {
    apiPostJson.mockReset();
    apiGetJson.mockReset();
    // Phase 4.2: reset the renderer-scoped single-flight kinds promise so
    // each test gets a fresh fetch (and a previously-successful resolve
    // doesn't bleed into the next test's gate).
    __resetWorkerKindsForTest();
    vi.restoreAllMocks();
  });

  // Phase 4.2: the runner's spawn effect gates on loadWorkerKinds() resolving.
  // by default we want every test to see the cache populate so spawn runs.
  beforeEach(() => {
    apiGetJson.mockResolvedValue({
      ok: true,
      kinds: [{ kind: 'git-graph', methods: ['git.log', 'git.show'] }],
    });
  });

  it('spawns a worker on mount when kind="worker" + workerKind given', async () => {
    apiPostJson.mockResolvedValueOnce({ ok: true, workerId: 'w-1', methods: ['git.log'] });

    const { unmount } = render(
      <MiniAppRunner
        appId="git-graph"
        srcDoc="<html><body>x</body></html>"
        height={200}
        kind="worker"
        workerKind="git-graph"
      />,
    );

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/worker/spawn', {
        appId: 'git-graph',
        kind: 'git-graph',
      });
    });
    unmount();
  });

  it('does NOT spawn when kind is undefined (Phase 0/1/2 default)', async () => {
    render(
      <MiniAppRunner
        appId="icon-generator"
        srcDoc="<html><body>x</body></html>"
        height={200}
      />,
    );

    // give microtasks a tick to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(apiPostJson).not.toHaveBeenCalledWith('/api/miniapp/worker/spawn', expect.anything());
  });

  it('does NOT spawn when loadWorkerKinds fails (cache miss fail-closed)', async () => {
    apiGetJson.mockReset();
    apiGetJson.mockRejectedValue(new Error('server down'));

    render(
      <MiniAppRunner
        appId="git-graph"
        srcDoc="<html><body>x</body></html>"
        height={200}
        kind="worker"
        workerKind="git-graph"
      />,
    );

    await new Promise((r) => setTimeout(r, 50));
    // The spawn effect gates on kindAllowlist !== undefined. When the kinds
    // fetch rejects the gate stays closed → worker never spawned. The iframe
    // never receives worker.ready, so worker.call attempts are dropped at
    // verifyWorkerCall (allowlist undefined → fail-closed).
    expect(apiPostJson).not.toHaveBeenCalledWith('/api/miniapp/worker/spawn', expect.anything());
  });

  it('terminates the spawned worker on unmount', async () => {
    apiPostJson.mockResolvedValueOnce({ ok: true, workerId: 'w-2', methods: ['git.log'] });
    apiPostJson.mockResolvedValueOnce({ ok: true });

    const { unmount } = render(
      <MiniAppRunner
        appId="git-graph"
        srcDoc="<html><body>x</body></html>"
        height={200}
        kind="worker"
        workerKind="git-graph"
      />,
    );

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/worker/spawn', expect.anything());
    });

    unmount();

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/worker/terminate', {
        workerId: 'w-2',
      });
    });
  });

  it('ignores worker.call messages from a foreign window', async () => {
    apiPostJson.mockResolvedValueOnce({ ok: true, workerId: 'w-3', methods: ['git.log'] });

    const { unmount } = render(
      <MiniAppRunner
        appId="git-graph"
        srcDoc="<html><body>x</body></html>"
        height={200}
        kind="worker"
        workerKind="git-graph"
      />,
    );

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalled();
    });

    // Reset to focus on whether a 2nd call (the .call) is dispatched.
    apiPostJson.mockClear();

    const foreignSource = {} as Window;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          kind: 'worker.call',
          nonce: 'anything',
          id: 'req-x',
          payload: { method: 'git.log', params: {}, appId: 'git-graph' },
        },
        origin: '',
        source: foreignSource,
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    // Trust rule 1 rejects the foreign source — no /call is dispatched.
    expect(apiPostJson).not.toHaveBeenCalledWith('/api/miniapp/worker/call', expect.anything());

    unmount();
  });
});
