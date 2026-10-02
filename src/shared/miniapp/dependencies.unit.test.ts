// `meta.json::dependencies` 的 schema 边界。
//
// 这些用例守的是一条权限升级路径：依赖声明是 iframe CSP **唯一**的放宽来源，
// 所以 "域名必须在 net.allow 里" 这条一旦漏掉，MiniApp 就能让宿主替自己打开
// script-src 给任意域名 —— 一个伪装成构建期便利的提权。

import { describe, expect, it } from 'vitest';

import { parseMiniAppMetadata } from './meta-schema';

const CDN = 'https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js';

/**
 * `MiniAppResponse` is a discriminated union, so `expect(r.ok).toBe(true)` does
 * not narrow `r` for the type checker. These helpers do the narrowing properly
 * and give a readable failure message instead of `undefined` deep in a
 * `toEqual`.
 */
function expectOk(r: ReturnType<typeof parseMiniAppMetadata>) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error.message}`);
  return r.result;
}

function expectErr(r: ReturnType<typeof parseMiniAppMetadata>) {
  if (r.ok) throw new Error('expected an error, got ok');
  return r.error;
}

function baseMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dep-test',
    name: 'Dep Test',
    description: 'd',
    icon: '📦',
    category: 'developer',
    version: 1,
    min_host_version: '0.1.0',
    permissions: {},
    ...overrides,
  };
}

describe('meta.json::dependencies schema', () => {
  it('accepts an https script dep whose host is in net.allow', () => {
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['cdn.jsdelivr.net'] } },
        dependencies: [{ url: CDN, type: 'script' }],
      }),
    );
    expect(expectOk(r).dependencies).toEqual([{ url: CDN, type: 'script' }]);
  });

  it('accepts style deps on the same allow-list', () => {
    const url = 'https://cdn.jsdelivr.net/npm/x@1/dist/x.css';
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['cdn.jsdelivr.net'] } },
        dependencies: [{ url, type: 'style' }],
      }),
    );
    expect(expectOk(r).dependencies?.[0]?.type).toBe('style');
  });

  it('rejects a host that is NOT in net.allow — the escalation guard', () => {
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['api.example.com'] } },
        dependencies: [{ url: CDN, type: 'script' }],
      }),
    );
    expect(expectErr(r).message).toContain('permissions.net.allow');
  });

  it('rejects every dep when net.allow is absent', () => {
    const r = parseMiniAppMetadata(
      baseMeta({ dependencies: [{ url: CDN, type: 'script' }] }),
    );
    expect(expectErr(r).message).toContain('net.allow is empty');
  });

  it('rejects plain http — same-origin observation makes it an injection vector', () => {
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['cdn.jsdelivr.net'] } },
        dependencies: [{ url: 'http://cdn.jsdelivr.net/npm/x@1/x.js', type: 'script' }],
      }),
    );
    expect(expectErr(r).message).toContain('must be https');
  });

  it('rejects a wildcard allow-list entry (hostAllowed strips *. but keeps it narrow)', () => {
    // `*.jsdelivr.net` is normalised to `jsdelivr.net` by hostAllowed, so it
    // legitimately matches the subdomain. This case pins that behaviour so a
    // future tightening of hostAllowed does not silently break real MiniApps.
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['*.jsdelivr.net'] } },
        dependencies: [{ url: CDN, type: 'script' }],
      }),
    );
    expectOk(r);
  });

  it('rejects a relative / unparseable URL', () => {
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['cdn.jsdelivr.net'] } },
        dependencies: [{ url: '/local/x.js', type: 'script' }],
      }),
    );
    expect(expectErr(r).message).toContain('not a valid absolute URL');
  });

  it('rejects an unknown type', () => {
    const r = parseMiniAppMetadata(
      baseMeta({
        permissions: { net: { allow: ['cdn.jsdelivr.net'] } },
        dependencies: [{ url: CDN, type: 'font' }],
      }),
    );
    expect(expectErr(r).message).toContain("dependency.type must be 'script' | 'style'");
  });

  it('rejects more than 10 deps', () => {
    const deps = Array.from({ length: 11 }, () => ({ url: CDN, type: 'script' as const }));
    const r = parseMiniAppMetadata(
      baseMeta({ permissions: { net: { allow: ['cdn.jsdelivr.net'] } }, dependencies: deps }),
    );
    expect(expectErr(r).message).toContain('≤ 10');
  });

  it('omits the key entirely when dependencies is absent (back-compat)', () => {
    const r = parseMiniAppMetadata(baseMeta());
    expect(expectOk(r).dependencies).toBeUndefined();
  });

  it('omits the key when dependencies is an empty array', () => {
    // An author who writes `"dependencies": []` should not see `[]` echoed
    // back in every listing payload.
    const r = parseMiniAppMetadata(baseMeta({ dependencies: [] }));
    expect(expectOk(r).dependencies).toBeUndefined();
  });
});
