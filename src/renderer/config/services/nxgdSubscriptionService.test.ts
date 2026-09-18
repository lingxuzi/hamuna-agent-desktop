import { beforeEach, describe, expect, test, vi } from 'vitest';

import { discoverNxgdModels, NxgdDiscoveryError } from './nxgdSubscriptionService';

const apiGetJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

describe('discoverNxgdModels', () => {
  beforeEach(() => {
    apiGetJson.mockReset();
  });

  test('happy path → 返 { models, checkedAt }', async () => {
    const freshTimestamp = 1700000000000;
    apiGetJson.mockResolvedValueOnce({
      models: [
        { id: 'deepseek-v4-flash-0731', display_name: 'DeepSeek V4 Flash' },
      ],
      checkedAt: freshTimestamp,
    });
    const result = await discoverNxgdModels();
    expect(result).toEqual({
      models: [{ id: 'deepseek-v4-flash-0731', displayName: 'DeepSeek V4 Flash' }],
      checkedAt: freshTimestamp,
    });
  });

  test('429 含 retryAfterSeconds → throw NxgdDiscoveryError(kind=rate-limit)', async () => {
    // 模拟 server 端 429 错误信息被 stderr 替换；title + retry hint 都来自 i18n。
    apiGetJson.mockRejectedValueOnce(
      new Error('{"error":"rate-limited","retryAfterSeconds":30,"models":null,"checkedAt":1700000000000}'),
    );
    await expect(discoverNxgdModels()).rejects.toMatchObject({
      detail: { kind: 'rate-limit', retryAfterSeconds: 30 },
    });
    await expect(discoverNxgdModels()).rejects.toBeInstanceOf(NxgdDiscoveryError);
  });

  test('502 含 cached → 返 stale-cache { models, checkedAt }（不 throw）', async () => {
    const staleTimestamp = 1700000000000;
    apiGetJson.mockRejectedValueOnce(
      new Error(
        `{"error":"models-unavailable","cached":[{"id":"qwen3-max","display_name":"Qwen3 Max"}],"checkedAt":${staleTimestamp}}`,
      ),
    );
    const result = await discoverNxgdModels();
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('qwen3-max');
    expect(result.checkedAt).toBe(staleTimestamp);
  });

  test('502 含 cached 但 cached 解析失败 → throw NxgdDiscoveryError(kind=network)', async () => {
    apiGetJson.mockRejectedValueOnce(
      new Error('{"error":"models-unavailable","cached":"not-valid-json","checkedAt":1700000000000}'),
    );
    await expect(discoverNxgdModels()).rejects.toMatchObject({
      detail: { kind: 'network' },
    });
    await expect(discoverNxgdModels()).rejects.toBeInstanceOf(NxgdDiscoveryError);
  });

  test('其它网络错误 → throw NxgdDiscoveryError(kind=network) 含 message', async () => {
    apiGetJson.mockRejectedValueOnce(new Error('upstream 503'));
    try {
      await discoverNxgdModels();
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NxgdDiscoveryError);
      if (err instanceof NxgdDiscoveryError) {
        expect(err.detail).toEqual({ kind: 'network', message: 'upstream 503' });
        // Error.message 仍携带人类可读文本（ModelManagementPanel 老 caller 兼容）
        expect(err.message).toBe('upstream 503');
      }
    }
  });

  test('NxgdDiscoveryError.message 含结构化信息（rate-limit 路径）', async () => {
    apiGetJson.mockRejectedValueOnce(
      new Error('{"error":"rate-limited","retryAfterSeconds":45,"models":null,"checkedAt":1700000000000}'),
    );
    try {
      await discoverNxgdModels();
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('rate-limited');
      expect((err as Error).message).toContain('45');
    }
  });
});