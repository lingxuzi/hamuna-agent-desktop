/**
 * `app.net.fetch` 的重定向闸（integration 池，**零成本**）。
 *
 * 漏洞形状很简单：权限层与 sidecar 都只对**第一跳**判定（https-only、域名在
 * `net.allow` 里、hostname 不是私网），判定通过之后 fetch 用的却是默认的
 * `redirect: 'follow'`。作者声明的 host 确实是 https、第一跳也确实是 https，
 * 它完全可以回一个 `302 Location: https://169.254.169.254/...`，而那一跳从头
 * 到尾没人检查过。于是「只允许 https + 不许私网」这条约束等于没有，`net.fetch`
 * 变成一条把 sidecar 当跳板去读云 metadata / 打内网的通道。
 *
 * 这是本仓已知的 SSRF 形状。CLAUDE.md 红线表写着「不限 scheme / 不挡私网 →
 * SSRF」，而 tool-attachments / kb-ingest / provider-probe 三处早就为它关掉了
 * 重定向（理由记在 provider-probe.ts：「host says https, hops internal」）。
 * `app.net.fetch` 是唯一漏掉的一处。
 *
 * ## 为什么用注入的 transport，而不是起一个真的重定向服务器
 *
 * 想过起真的，但那走不通：要让第一跳通过三道判定，它必须既 https 又不在私网，
 * 而本机没有 openssl 也没有 selfsigned / node-forge 可以签证书（为一个测试引入
 * 依赖不值）。用 `127.0.0.1` 当第一跳则会在 `isPrivateHostname` 就被拒，根本
 * 走不到重定向那一步 —— 也就是说**端到端版本在原理上测不到这个洞**。
 *
 * 所以改为在 `dispatchMiniAppApp` 这一层注入 transport，并断言两件事：
 *   1. 传给 transport 的 `init.redirect` 确实是 `'manual'`（机制本身）；
 *   2. transport 回 3xx 时，作者拿到的是一条指名"redirect"的拒绝（作者可见面）。
 *
 * 只断言第 1 条不够 —— 参数传对了但 3xx 仍然被当成功返回，是很容易发生的写法。
 * 只断言第 2 条也不够 —— 那可能只是因为请求压根没发出去。
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_ID = 'net-redirect-probe';
/** 作者声明并"访问"的公网 host。必须是假的公网形态：127.0.0.1 会被私网判定先拒。 */
const PUBLIC_HOST = 'cdn.example.com';

let sandboxHome = '';

vi.mock('../utils/admin-config', () => ({
  getConfigDir: () => sandboxHome,
}));

const { dispatchMiniAppApp } = await import('../miniapp-app-dispatch');
const { _setGeneralFetchTransportForTests } = await import('../utils/cancellation');

type Seen = { url: string; redirect: unknown };

/** 装一个假 transport，记录它看到的参数并回一个可控的响应。 */
function stubTransport(response: () => Response): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  // 参数类型由 `_setGeneralFetchTransportForTests` 的签名推断：走的是 undici 的
  // RequestInit，手写成 DOM 那个会因 `body` 不兼容而报错（与本用例无关的噪音）。
  _setGeneralFetchTransportForTests((url, init) => {
    seen.push({ url, redirect: (init as { redirect?: unknown } | undefined)?.redirect });
    return Promise.resolve(response());
  });
  return { seen, restore: () => _setGeneralFetchTransportForTests() };
}

function writeMeta(): void {
  const dir = join(sandboxHome, 'miniapps', APP_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      id: APP_ID,
      name: 'Net Redirect Probe',
      description: 'redirect SSRF fixture',
      icon: 'p',
      category: 'other',
      version: 1,
      min_host_version: '0.0.1',
      permissions: { net: { allow: [PUBLIC_HOST] } },
    }),
    'utf8',
  );
}

beforeEach(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'miniapp-net-redirect-'));
  writeMeta();
});

afterEach(() => {
  _setGeneralFetchTransportForTests();
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // Windows 上文件句柄可能尚未释放；清理失败不影响断言结论
  }
});

describe('app.net.fetch refuses to follow a redirect past its own checks', () => {
  it('asks the transport for manual redirects instead of the default follow', async () => {
    const stub = stubTransport(
      () => new Response('ok', { status: 200 }),
    );

    const res = await dispatchMiniAppApp('net.fetch', APP_ID, {
      url: `https://${PUBLIC_HOST}/thing`,
    });
    stub.restore();

    expect(res.ok).toBe(true);
    // 机制本身：默认是 'follow'，那正是被绕过的原因。
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0].redirect).toBe('manual');
  });

  it('turns a 3xx into a directed rejection rather than a result the author would trust', async () => {
    const stub = stubTransport(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://169.254.169.254/latest/meta-data/' },
        }),
    );

    const res = await dispatchMiniAppApp('net.fetch', APP_ID, {
      url: `https://${PUBLIC_HOST}/start`,
    });
    stub.restore();

    expect(res.ok, JSON.stringify(res.error)).toBe(false);
    if (res.ok || !res.error) throw new Error('expected a failure envelope');
    expect(res.error.code).toBe('PERMISSION_DENIED');
    // 作者要能照着改：告诉他"别跟，直接请求最终 URL"。
    expect(res.error.message).toMatch(/redirect/i);
    expect(res.error.message).toMatch(/302/);
    // 关键：目标地址没有被当成结果回传给作者。
    expect(JSON.stringify(res)).not.toContain('169.254.169.254');
  });

  it('still serves a plain 200 with its body', async () => {
    // 闸不能把正常请求也堵死：3xx 被拒，2xx 照常。
    const stub = stubTransport(
      () => new Response('hello from cdn', { status: 200 }),
    );

    const res = await dispatchMiniAppApp('net.fetch', APP_ID, {
      url: `https://${PUBLIC_HOST}/thing`,
    });
    stub.restore();

    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ status: 200, body: 'hello from cdn' });
  });

  it('a 4xx is still passed through, not mistaken for a redirect', async () => {
    // 边界：304 也是 3xx 但不是重定向（无 Location），403 是 4xx。
    // 至少 403 必须原样透出状态码，作者才知道是"没有权限"而不是"网络坏了"。
    const stub = stubTransport(() => new Response('nope', { status: 403 }));

    const res = await dispatchMiniAppApp('net.fetch', APP_ID, {
      url: `https://${PUBLIC_HOST}/private`,
    });
    stub.restore();

    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ status: 403, body: 'nope' });
  });
});
