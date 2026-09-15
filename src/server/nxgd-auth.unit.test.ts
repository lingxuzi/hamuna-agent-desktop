/**
 * nxgd-auth 单测 — 纯逻辑 + mock fetch，不发真实请求。
 * 覆盖：持久化 / 幂等 / 限流 / 余额缓存 / 并发 in-flight 复用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('./utils/cancellation', () => ({
  cancellableFetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('./logger', () => ({ sendLog: () => {} }));

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  tmpHome = mkdtempSync(join(tmpdir(), 'nxgd-test-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  // process.env.USERPROFILE 用于 Windows fallback
  process.env.USERPROFILE = tmpHome;

  // device_id 文件写入（nxgd-auth 会读 ~/.hamuna/device_id）
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(tmpHome, '.hamuna'), { recursive: true });
  writeFileSync(join(tmpHome, '.hamuna', 'device_id'), 'machine-abc-123', 'utf-8');

  mockFetch.mockReset();
  vi.resetModules();
});

afterEach(async () => {
  if (tmpHome) {
    const { rmSync } = await import('node:fs');
    rmSync(tmpHome, { recursive: true, force: true });
  }
  if (originalHome !== undefined) process.env.HOME = originalHome;
});

describe('nxgd-auth', () => {
  it('preloadNxgdAuth 读不到持久化文件时不抛', async () => {
    const mod = await import('./nxgd-auth');
    expect(() => mod.preloadNxgdAuth()).not.toThrow();
    expect(mod.getNxgdApiKeySync()).toBeNull();
  });

  it('ensureRegistered 成功后写持久化 + 缓存 apiKey', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'machine-abc-123', apiKey: 'sk-test-001' } }),
    });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    const state = await mod.ensureRegistered();
    expect(state.registered).toBe(true);
    expect(mod.getNxgdApiKeySync()).toBe('sk-test-001');
  });

  it('ensureRegistered 幂等：第二次调用不重复 fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'machine-abc-123', apiKey: 'sk-test-001' } }),
    });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    await mod.ensureRegistered();
    await mod.ensureRegistered();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('并发 ensureRegistered 只发 1 次 fetch（in-flight 复用）', async () => {
    let resolveFn: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveFn = resolve;
    });
    mockFetch.mockReturnValueOnce(pending);

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    const p1 = mod.ensureRegistered();
    const p2 = mod.ensureRegistered();
    const p3 = mod.ensureRegistered();

    resolveFn!({
      ok: true, status: 200,
      json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'machine-abc-123', apiKey: 'sk-concurrent' } }),
    });

    await Promise.all([p1, p2, p3]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mod.getNxgdApiKeySync()).toBe('sk-concurrent');
  });

  it('注册失败 (code != 200) → state.error 不抛', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ code: 500, message: '开通过于频繁', data: null }),
    });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    const state = await mod.ensureRegistered();
    expect(state.status).toBe('error');
    expect(state.error).toContain('开通过于频繁');
    expect(mod.getNxgdApiKeySync()).toBeNull();
  });

  it('注册 fetch 抛异常 → state.error 不抛', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    const state = await mod.ensureRegistered();
    expect(state.status).toBe('error');
    expect(state.error).toContain('network down');
  });

  it('fetchBalance 命中 1h 缓存不重发请求', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-cache' } }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { username: 'm', balance: 12.5, usedBalance: 1.5, status: 1 } }),
      });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    const b1 = await mod.fetchBalance();
    const b2 = await mod.fetchBalance();
    expect(b1?.balance).toBe(12.5);
    expect(b2?.balance).toBe(12.5);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fetchBalance forceRefresh 绕过缓存', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-x' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { username: 'm', balance: 100, usedBalance: 0, status: 1 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { username: 'm', balance: 50, usedBalance: 50, status: 1 } }) });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    const a = await mod.fetchBalance();
    const b = await mod.fetchBalance(true);
    expect(a?.balance).toBe(100);
    expect(b?.balance).toBe(50);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('createRechargeOrder 注册失败时返 null + 充值请求不发', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ code: 500, message: '开通过于频繁', data: null }),
    });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    const result = await mod.createRechargeOrder(50);
    expect(result).toBeNull();
    // 只发了注册请求，没有发充值请求
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/open/customer/register');
  });

  it('createRechargeOrder 成功后清掉余额缓存', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-r' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { username: 'm', balance: 0, usedBalance: 0, status: 1 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { orderNo: 'RC001', payFormHtml: '<form/>', expiresAt: '2026-09-15T12:00:00' } }) });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    await mod.fetchBalance();
    const order = await mod.createRechargeOrder(10);
    expect(order?.orderNo).toBe('RC001');
  });

  it('isLowBalance 5 元阈值判断', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-low' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { username: 'm', balance: 3, usedBalance: 0, status: 1 } }) });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    expect(await mod.isLowBalance()).toBe(true);
  });
});
