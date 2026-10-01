// workerCallBridge.unit.test.ts — pure-helper trust boundary tests.
//
// Mirrors `bubbleClaimBridge.unit.test.ts` pattern: each test builds a fake
// `PostMessageEnvelope` and verifies the trust rules in `verifyWorkerCall`.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetWorkerKindsForTest,
  buildWorkerResult,
  loadWorkerKinds,
  mintWorkerCallId,
  mintWorkerCallNonce,
  verifyWorkerCall,
  type PostMessageEnvelope,
} from './workerCallBridge';

vi.mock('@/api/apiFetch', () => ({
  apiGetJson: vi.fn(),
}));

import { apiGetJson } from '@/api/apiFetch';

const FAKE_IFRAME = {} as Window;
const OTHER_IFRAME = {} as Window;
const NONCE = 'nonce-1234';
const APP_ID = 'git-graph';
const ALLOWLIST = ['git.log', 'git.show', 'git.checkout', 'git.diff', 'git.status'];

function envelope(
  overrides: Partial<{ source: Window | null; data: unknown }> = {},
): PostMessageEnvelope {
  return {
    source: FAKE_IFRAME,
    origin: 'null',
    data: {
      kind: 'worker.call',
      nonce: NONCE,
      id: 'req-1',
      payload: { method: 'git.log', params: { cwd: '/tmp/repo' }, appId: APP_ID },
    },
    ...overrides,
  };
}

describe('workerCallBridge', () => {
  afterEach(() => {
    vi.mocked(apiGetJson).mockReset();
    __resetWorkerKindsForTest();
  });

  describe('verifyWorkerCall() — 4-rule trust boundary', () => {
    it('accepts a well-formed envelope from the bound iframe', () => {
      const result = verifyWorkerCall(envelope(), FAKE_IFRAME, NONCE, APP_ID, ALLOWLIST);
      expect(result).not.toBeNull();
      expect(result!.payload.method).toBe('git.log');
    });

    it('rejects when source is not the bound iframe', () => {
      const result = verifyWorkerCall(
        envelope({ source: OTHER_IFRAME }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when iframeContentWindow is null', () => {
      const result = verifyWorkerCall(envelope(), null, NONCE, APP_ID, ALLOWLIST);
      expect(result).toBeNull();
    });

    it('rejects when nonce does not match', () => {
      const result = verifyWorkerCall(envelope(), FAKE_IFRAME, 'wrong-nonce', APP_ID, ALLOWLIST);
      expect(result).toBeNull();
    });

    it('rejects when method is not in the kind allow-list', () => {
      const result = verifyWorkerCall(
        envelope({
          data: {
            kind: 'worker.call',
            nonce: NONCE,
            id: 'req-1',
            payload: { method: 'fs.read', params: {}, appId: APP_ID },
          },
        }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when appId in payload does not match the bound appId', () => {
      const result = verifyWorkerCall(
        envelope({
          data: {
            kind: 'worker.call',
            nonce: NONCE,
            id: 'req-1',
            payload: { method: 'git.log', params: {}, appId: 'evil-app' },
          },
        }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when kind is not "worker.call"', () => {
      const result = verifyWorkerCall(
        envelope({
          data: {
            kind: 'worker.result',
            nonce: NONCE,
            id: 'req-1',
            payload: { method: 'git.log', params: {}, appId: APP_ID },
          },
        }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when data is missing fields (no id)', () => {
      const result = verifyWorkerCall(
        envelope({
          data: {
            kind: 'worker.call',
            nonce: NONCE,
            payload: { method: 'git.log', params: {}, appId: APP_ID },
          },
        }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when data is non-object', () => {
      const result = verifyWorkerCall(
        envelope({ data: 'string-not-envelope' }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when payload.method is non-string', () => {
      const result = verifyWorkerCall(
        envelope({
          data: {
            kind: 'worker.call',
            nonce: NONCE,
            id: 'req-1',
            payload: { method: 123, params: {}, appId: APP_ID },
          },
        }),
        FAKE_IFRAME,
        NONCE,
        APP_ID,
        ALLOWLIST,
      );
      expect(result).toBeNull();
    });

    it('rejects when kindAllowlist is undefined (cache miss fail-closed)', () => {
      const result = verifyWorkerCall(envelope(), FAKE_IFRAME, NONCE, APP_ID, undefined);
      expect(result).toBeNull();
    });
  });

  describe('buildWorkerResult()', () => {
    it('builds a success envelope with the request id and result', () => {
      const env = buildWorkerResult(NONCE, 'req-1', {
        ok: true,
        result: { commits: ['abc', 'def'] },
      });
      expect(env).toEqual({
        kind: 'worker.result',
        nonce: NONCE,
        id: 'req-1',
        ok: true,
        result: { commits: ['abc', 'def'] },
      });
    });

    it('builds a failure envelope with error code and message', () => {
      const env = buildWorkerResult(NONCE, 'req-1', {
        ok: false,
        error: { code: 'TIMEOUT', message: 'timed out after 5s' },
      });
      expect(env).toEqual({
        kind: 'worker.result',
        nonce: NONCE,
        id: 'req-1',
        ok: false,
        error: { code: 'TIMEOUT', message: 'timed out after 5s' },
      });
    });

    it('fills in UNKNOWN error if missing (defensive)', () => {
      const env = buildWorkerResult(NONCE, 'req-1', { ok: false });
      expect(env.error).toEqual({ code: 'UNKNOWN', message: 'unknown error' });
    });
  });

  describe('loadWorkerKinds()', () => {
    it('fetches /api/miniapp/kinds and flattens to {kind: methods[]}', async () => {
      vi.mocked(apiGetJson).mockResolvedValueOnce({
        ok: true,
        kinds: [
          { kind: 'git-graph', methods: ['git.log', 'git.show'] },
          { kind: 'file-explorer', methods: ['file.tree', 'file.read', 'file.search'] },
        ],
      });

      const map = await loadWorkerKinds();
      expect(map).toEqual({
        'git-graph': ['git.log', 'git.show'],
        'file-explorer': ['file.tree', 'file.read', 'file.search'],
      });
      expect(Object.isFrozen(map['git-graph'])).toBe(true);
    });

    it('throws on ok:false response and allows the next call to retry', async () => {
      vi.mocked(apiGetJson).mockResolvedValueOnce({ ok: false, error: 'registry empty' });

      await expect(loadWorkerKinds()).rejects.toThrow(/registry empty/);

      // Second call retries because the first failed
      vi.mocked(apiGetJson).mockResolvedValueOnce({
        ok: true,
        kinds: [{ kind: 'git-graph', methods: ['git.log'] }],
      });
      await expect(loadWorkerKinds()).resolves.toBeTruthy();
    });

    it('returns the same promise for concurrent calls (single-flight)', async () => {
      let resolveOuter: (v: unknown) => void = () => {};
      vi.mocked(apiGetJson).mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            resolveOuter = resolve;
          }),
      );

      const p1 = loadWorkerKinds();
      const p2 = loadWorkerKinds();
      expect(p1).toBe(p2);

      resolveOuter({
        ok: true,
        kinds: [{ kind: 'git-graph', methods: ['git.log'] }],
      });
      const map = await p1;
      expect(map['git-graph']).toEqual(['git.log']);
      // apiGetJson called exactly once across both callers
      expect(vi.mocked(apiGetJson).mock.calls.length).toBe(1);
    });
  });

  describe('mintWorkerCallNonce() / mintWorkerCallId()', () => {
    it('mints nonces of reasonable length and uniqueness', () => {
      const a = mintWorkerCallNonce();
      const b = mintWorkerCallNonce();
      expect(a.length).toBeGreaterThan(8);
      expect(a).not.toBe(b);
    });

    it('mints ids of reasonable length and uniqueness', () => {
      const a = mintWorkerCallId();
      const b = mintWorkerCallId();
      expect(a.length).toBeGreaterThan(8);
      expect(a).not.toBe(b);
    });
  });
});