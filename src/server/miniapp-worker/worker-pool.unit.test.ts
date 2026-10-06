// worker-pool.unit.test.ts — pool guards that do NOT need a live worker thread.
//
// Scope note, because the previous version of this file got it wrong: the
// *successful* spawn and LRU-eviction paths need real built worker entries
// (`src-tauri/resources/worker-entry-*.js`, which is gitignored build output).
// They therefore cannot live in the unit pool -- CI runs `test:unit` BEFORE
// `build:server`, so the artifacts do not exist yet. Those paths are covered
// instead by `scripts/verify-miniapp-workers.mjs`, which `build:server` runs as
// its last step and CI therefore always executes.
//
// The old header claimed these tests "use a tiny inline echo worker" and the old
// `it.skip` waited for an `echo` fixture to land. Neither ever existed: there is
// no echo worker and no `tests/fixtures/` directory in this repo. Keep the two
// files in sync -- asserted there but not here means "needs a real entry";
// asserted here but not there means it should move down.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pool, PER_APP_WORKER_CAP } from './worker-pool';

describe('worker-pool (Node-only MiniApp sandbox)', () => {
  beforeEach(() => {
    pool.__resetForTest();
  });

  afterEach(() => {
    pool.__resetForTest();
  });

  it('rejects unknown kind names', async () => {
    await expect(
      pool.spawn({ appId: 'test-app', kind: 'definitely-not-a-kind' }),
    ).rejects.toThrow(/unknown kind/);
  });

  it('snapshot starts at zero', () => {
    expect(pool.snapshot()).toEqual({ workerCount: 0, byApp: {} });
  });

  it('exposes the per-app cap constant', () => {
    expect(PER_APP_WORKER_CAP).toBe(4);
  });

  it('call() to a non-existent worker returns WORKER_NOT_FOUND', async () => {
    const r = await pool.call({ workerId: 'no-such-worker', method: 'noop', params: {} });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('WORKER_NOT_FOUND');
  });
});
