/**
 * modelDiscoveryService::parseModelsResponse contract —
 * Locks in support for 3 upstream response shapes so the parser can never
 * silently regress to `[]` for a payload shape we already use.
 *
 * Most recent regression: 2026-09-16 — `discoverNxgdModels()` passes the
 * unwrapped `resp.models` array (after server strips its `{ models, checkedAt }`
 * envelope), and the parser didn't recognize top-level arrays → the
 * Model Management panel's "Discover" section rendered empty even though the
 * upstream `/v1/models` returned a valid model list.
 */
import { describe, expect, it } from 'vitest';

import { parseModelsResponse } from './modelDiscoveryService';

describe('parseModelsResponse', () => {
  it('顶层数组（nxgd unwrap 后的 resp.models）→ 解析', () => {
    const arr = [
      { id: 'deepseek-v4-flash-0731', object: 'model', created: 1789542605, owned_by: 'api-gateway' },
    ];
    const out = parseModelsResponse(arr);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('deepseek-v4-flash-0731');
    expect(out[0]?.ownedBy).toBe('api-gateway');
  });

  it('OpenAI wrapper { object: "list", data: [...] } → 解析', () => {
    const out = parseModelsResponse({ object: 'list', data: [{ id: 'gpt-4' }] });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('gpt-4');
  });

  it('Anthropic wrapper { data: [{ type: "model" }] } → 解析', () => {
    const out = parseModelsResponse({
      data: [{ id: 'claude-fable-5', type: 'model' }],
      has_more: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('claude-fable-5');
  });

  it('null / 空对象 / 未知 shape → 返空数组（不抛）', () => {
    expect(parseModelsResponse(null)).toEqual([]);
    expect(parseModelsResponse(undefined)).toEqual([]);
    expect(parseModelsResponse({})).toEqual([]);
    expect(parseModelsResponse({ data: 'not-an-array' })).toEqual([]);
  });

  it('Shutting-down 模型被过滤（status === "Shutdown"）', () => {
    const out = parseModelsResponse([
      { id: 'live', object: 'model' },
      { id: 'dead', object: 'model', status: 'Shutdown' },
    ]);
    expect(out.map(m => m.id)).toEqual(['live']);
  });
});
