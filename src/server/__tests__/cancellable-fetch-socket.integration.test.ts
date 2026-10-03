/**
 * `cancellableFetch` 第一次真开 socket（integration 池，**零成本**）。
 *
 * ## 为什么之前没有
 *
 * 不是因为做不到，是因为没人做：仓库里对 `cancellableFetch` 的覆盖全是
 * `withAbortSignal` 那类纯逻辑（`cancellation.integration.test.ts` 里 18 条，
 * 没有一条碰过网络），而 MiniApp 的**每一次**出站请求都走它。
 *
 * 这类"只断言参数、没跑过机制"的测试有一个具体的失效形状，而且它正好压在一道
 * 安全闸门上。`app.net.fetch` 的 SSRF 防线里有一条是 `redirect: 'manual'`：
 * 作者声明的 host 确实是 https、第一跳也确实是 https，但它完全可以 302 到
 * `169.254.169.254`，而那一跳从头到尾没人检查过。`miniapp-net-redirect.integration.test.ts`
 * 钉的是"传给 transport 的 `init.redirect` 确实是 `'manual'`"——**参数**。
 *
 * 参数对了不等于机制对：`redirect: 'manual'` 是 undici 的行为，不是本仓的代码。
 * 如果 undici 某个版本对 manual 的处理变了（跟随、抛错、或把 3xx 当失败），
 * 现有全部测试**一条都不会红**，而 SSRF 闸门已经洞了。这条测试直接对着一个真的
 * loopback 服务器验机制本身：3xx 原样回来，且**第二跳一次都没被请求过**。
 *
 * ## 为什么用 127.0.0.1 而不是公网 host
 *
 * `app.net.fetch` 走完整条权限链时第一跳必须既 https 又非私网，本机签不出证书
 * （`miniapp-net-redirect.integration.test.ts` 的文件头已经写明这个约束）。但
 * **权限链不是这里要验的东西** —— 它由那个文件负责。这里验的是闸门底下那层
 * fetch 机制，所以直接对 `cancellableFetch` 说话，用 loopback 就够。
 * 代价说清楚：作者可见的 `{status, body}` 那一层仍然是 mock 覆盖的。
 *
 * 代理不会污染这些用例：`getGeneralRequestDispatcher` 用
 * `mergeNoProxyWithLocalhost` 把 localhost 并进 no_proxy，所以即使机器上配了
 * 系统代理，loopback 也不走它。
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { cancellableFetch } from '../utils/cancellation';

interface Hit {
  method: string;
  url: string;
  body: string;
}

let server: Server | undefined;
let base = '';
/** 服务端自己记的收到过什么。断言"没发生的事"只能用服务端的视角。 */
let hits: Hit[] = [];
/** 开了 socket 之后不吭声的连接，测超时/中断用。 */
const parked = new Set<ServerResponse>();

function listen(): Promise<string> {
  hits = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
    });
    req.on('end', () => {
      hits.push({ method: req.method ?? 'GET', url, body });
      if (url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('hello from a real socket');
        return;
      }
      if (url === '/echo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body, ct: req.headers['content-type'] ?? null }));
        return;
      }
      if (url === '/start') {
        // 302 指向同机另一个 path。第一跳过了，**第二跳**就是"内网"那一跳。
        res.writeHead(302, { Location: '/internal-only' });
        res.end();
        return;
      }
      if (url === '/internal-only') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SHOULD NEVER BE FETCHED');
        return;
      }
      if (url === '/hang') {
        // 收到请求、什么都不回。测的是客户端有没有真的放弃，而不是服务器慢。
        parked.add(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

afterEach(async () => {
  for (const res of parked) res.destroy();
  parked.clear();
  const s = server;
  server = undefined;
  if (s) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('cancellableFetch against a real loopback server', () => {
  it('returns the real status and body over a real socket', async () => {
    base = await listen();
    const res = await cancellableFetch(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello from a real socket');
    expect(hits.map((h) => h.url)).toEqual(['/ok']);
  });

  it('actually transmits method, headers and body', async () => {
    // 纯透传层最容易出现"参数收下了但没发出去"。断言放在**服务端**视角：
    // 只有服务端真的收到了，才算数。
    base = await listen();
    const res = await cancellableFetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Probe': 'yes' },
      body: '{"items":[1,2]}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      method: 'POST',
      body: '{"items":[1,2]}',
      ct: 'application/json',
    });
    expect(hits[0]?.method).toBe('POST');
  });

  it('hands back a 3xx without ever requesting the redirect target', async () => {
    // 这是本文件最重要的一条：`app.net.fetch` 的 SSRF 闸门靠
    // `redirect: 'manual'` 成立，而那是 **undici 的行为**，不是本仓的代码。
    // 现有测试只断言"传给 transport 的参数是 manual"，参数对而机制坏掉的
    // 情形一条都拦不住。
    //
    // 断言两件事，缺一不可：3xx 原样回来（不是跟随、不是抛错、不是当失败），
    // 且**第二跳一次都没发生** —— 后者只能用服务端的 hit 表证。
    base = await listen();
    const res = await cancellableFetch(`${base}/start`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/internal-only');
    // 关键：目标没被碰过。
    expect(hits.map((h) => h.url)).toEqual(['/start']);
  });

  it('follows the redirect when the caller does not ask for manual (proves the flag is load-bearing)', async () => {
    // 反向护栏：证明上一条不是因为这台机器上的 undici 压根不跟随重定向。
    // 没有这条，"manual 没跟随"可能只是 undici 全局行为，而闸门其实在裸奔。
    base = await listen();
    const res = await cancellableFetch(`${base}/start`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SHOULD NEVER BE FETCHED');
    expect(hits.map((h) => h.url)).toEqual(['/start', '/internal-only']);
  });

  it('gives up on a hanging server instead of waiting forever', async () => {
    // 参数传对了不等于机制对：timeoutMs 必须真的把 socket 掐掉。
    base = await listen();
    const started = Date.now();
    await expect(cancellableFetch(`${base}/hang`, {}, { timeoutMs: 250 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
    // 服务器确实收到了请求 —— 排除"压根没发出去所以当然没超时"。
    expect(hits.map((h) => h.url)).toEqual(['/hang']);
  });

  it('aborts a real in-flight request when the parent signal fires', async () => {
    // 与上一条互补：那是超时自发的，这条是**外部**取消。两者走的是
    // withAbortSignal 的不同分支（timeoutMs vs parentSignal），只测一个会漏。
    base = await listen();
    const ac = new AbortController();
    const p = cancellableFetch(`${base}/hang`, {}, { parentSignal: ac.signal, timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 120));
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(hits.map((h) => h.url)).toEqual(['/hang']);
  });

  it('refuses immediately when the parent signal is already aborted', async () => {
    base = await listen();
    const ac = new AbortController();
    ac.abort();
    await expect(cancellableFetch(`${base}/ok`, {}, { parentSignal: ac.signal })).rejects.toThrow();
    // 已经中止的信号不该还把请求发出去。
    expect(hits).toEqual([]);
  });
});
