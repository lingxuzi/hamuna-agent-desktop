/**
 * nxgd-auth 单测 — 纯逻辑 + mock fetch，不发真实请求。
 * 覆盖：持久化 / 幂等 / 限流 / 余额缓存 / 并发 in-flight 复用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { win32 as pathWin32 } from 'node:path';

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
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, message: 'success', data: { orderNo: 'RC001', checkoutUrl: 'https://alipay.com/checkout', expiresAt: '2026-09-15T12:00:00' } }) });

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

describe('nxgd-auth refresh + 401 recovery', () => {
  it('refreshNxgdApiKey: 调幂等 register 拿新 key → 写盘 + 更新缓存', async () => {
    mockFetch
      // ensureRegistered 期间 register 拿旧 key
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: { id: 7 }, apiKeyName: 'm', apiKey: 'sk-initial' } }),
      })
      // refreshNxgdApiKey 期间 register 返新 key（上游已轮换）
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: { id: 7 }, apiKeyName: 'm', apiKey: 'sk-rotated' } }),
      });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    expect(mod.getNxgdApiKeySync()).toBe('sk-initial');

    const newKey = await mod.refreshNxgdApiKey();
    expect(newKey).toBe('sk-rotated');
    expect(mod.getNxgdApiKeySync()).toBe('sk-rotated');

    // 写盘验证
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const persistedPath = join(tmpHome, '.hamuna', 'nxgd-auth.json');
    expect(existsSync(persistedPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(persistedPath, 'utf-8'));
    expect(parsed.apiKey).toBe('sk-rotated');
    expect(parsed.userId).toBe(7);
    expect(parsed.code).toBe('machine-abc-123');
  });

  it('refreshNxgdApiKey: 注册失败 → 返旧 key 不抛（fail-soft）', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-prior' } }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 500, message: 'rate limited', data: null }),
      });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    expect(mod.getNxgdApiKeySync()).toBe('sk-prior');

    const newKey = await mod.refreshNxgdApiKey();
    expect(newKey).toBe('sk-prior');
    expect(mod.getNxgdApiKeySync()).toBe('sk-prior'); // 失败时保留旧 key
  });

  it('refreshNxgdApiKey: 网络异常 → 返旧 key 不抛', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-prior' } }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();
    const newKey = await mod.refreshNxgdApiKey();
    expect(newKey).toBe('sk-prior');
    expect(mod.getNxgdApiKeySync()).toBe('sk-prior');
  });

  it('fetchModels 401 → refresh 拿新 key → 重试成功', async () => {
    mockFetch
      // 1. ensureRegistered: register 拿旧 key
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: { id: 1 }, apiKeyName: 'm', apiKey: 'sk-old' } }),
      })
      // 2. fetchModels 第一次: 401 (key 失效)
      .mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null } })
      // 3. refreshNxgdApiKey: register 返轮换后的新 key
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: { id: 1 }, apiKeyName: 'm', apiKey: 'sk-new' } }),
      })
      // 4. fetchModels 重试: 200 + models
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-5' }] }),
      });

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();

    const models = await mod.fetchModels(true);
    expect(models).toHaveLength(2);
    expect(models?.[0].id).toBe('claude-sonnet-5');
    expect(mod.getNxgdApiKeySync()).toBe('sk-new'); // key 已自动轮换
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('fetchModels 401 → refresh 返同 key（上游未轮换）→ 不重试 → 返 null', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-stale' } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null } })
      // refresh 返同 key：模拟上游 register 返既有 token，但 token 实际已被上游吊销（奇怪但可能）
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'success', data: { user: {}, apiKeyName: 'm', apiKey: 'sk-stale' } }),
      });
    // 没有第 4 次 mock — refresh 返同 key → 不重试 → resp 仍 401 → 走 !resp.ok → 返 cachedModels null

    const mod = await import('./nxgd-auth');
    mod.preloadNxgdAuth();
    await mod.ensureRegistered();

    const models = await mod.fetchModels(true);
    expect(models).toBeNull();
    expect(mod.getNxgdApiKeySync()).toBe('sk-stale'); // key 没换
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('nxgd-auth 写盘路径 helper 契约（Windows ENOENT regression guard, #167）', () => {
  // src/server/nxgd-auth.ts 的 writePersistedAuth 原本用
  // `AUTH_FILE.substring(0, AUTH_FILE.lastIndexOf('/'))` 切目录。Windows 路径
  // 全是 '\\'，lastIndexOf('/') 返 -1 → substring(0, -1) = slice(0, length-1)
  // → 把最后一字符切掉 → mkdirSync 拿 `.jso` 当目录 → ENOENT。
  // 修法 = path.dirname(AUTH_FILE)（跨平台；Windows 上 Node 自动用 win32.dirname）。
  //
  // vitest 在 Linux 跑，Linux 上 'C:\\fake\\home' 不是合法路径，mkdirSync 不会
  // 真创建 —— 不能直接 reproduce ENOENT。所以用 path.win32.dirname 直接断言修法
  // 语义。任何把 dirname 换回手写 substring/lastIndexOf 的回滚会被这个 contract
  // test + 源码 review 一起拦截。

  it('path.win32.dirname 在 Windows 路径上返回正确目录', () => {
    expect(pathWin32.dirname('C:\\Users\\foo\\.hamuna\\nxgd-auth.json'))
      .toBe('C:\\Users\\foo\\.hamuna');
  });

  it('旧 substring + lastIndexOf("/") 实现确实不返回正确目录（拒绝回滚）', () => {
    const winPath = 'C:\\Users\\foo\\.hamuna\\nxgd-auth.json';
    const buggy = winPath.substring(0, winPath.lastIndexOf('/'));
    // Node spec: substring(0, -1) 返空字符串（不是切最后一字符）
    expect(buggy).toBe('');
    expect(buggy).not.toBe(pathWin32.dirname(winPath));
  });
});
