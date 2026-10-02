// MiniApp 从磁盘到 iframe 的**装配链**（端到端契约）。
//
// 单测各自覆盖了一个环节，但没有一条用例跨越"宿主返回的 HTML → renderer 拼装
// → iframe srcdoc"这条接缝。接缝恰恰是缺陷最容易藏身的地方：每一段单独看都对，
// 拼起来可能让作者代码在运行时以它没预料到的方式失败。
//
// 这里的输入形态取自 `cmd_miniapp_source` 真正返回的东西：siblings 已被内联
// （Rust 侧 `inline_miniapp_siblings` 的职责，见 commands.rs），CSP 尚未注入
// （那是本文件要验的 renderer 职责）。两段职责的归属本身就是契约的一部分 ——
// Rust 内联、CSP 收紧，顺序反了就会出现"作者自己的 <script> 被 CSP 挡掉"。

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MiniAppRunner from './MiniAppRunner';

const NET_ALLOW = ['cdn.jsdelivr.net'];

/** 模拟 `cmd_miniapp_source` 的输出：siblings 已内联的入口 HTML。 */
function compiledSource(body: string, head = ''): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>t</title>${head}
<style>body{color:red}</style>
<script>
  // ui.js 已被 Rust 内联到这里
  window.addEventListener('DOMContentLoaded', function () {
    window.__ui_ran = true;
  });
</script>
</head>
<body>${body}</body>
</html>`;
}

function mount(srcDoc: string, deps?: { url: string; type: 'script' | 'style' }[]) {
  const { container } = render(
    <MiniAppRunner
      appId="pipe-app"
      srcDoc={srcDoc}
      height={200}
      dependencies={deps}
      permissions={{ net: { allow: NET_ALLOW } }}
    />,
  );
  return container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
}

/**
 * 取出注入的那一条 CSP policy。
 *
 * 不能用 `indexOf('connect-src')` 之类：runner 会把 Theme token CSS 拼在
 * 最前面，那段 CSS 里出现 `Content-Security-Policy` 相关的注释会让朴素的
 * 全文搜索命中错误的片段（实测第一版就是这样误报的）。按 meta 标签本身
 * 匹配才是稳定的。
 */
function cspOf(srcdoc: string): string | null {
  const m = srcdoc.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/,
  );
  if (!m) return null;
  return m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('MiniApp assembly pipeline: Rust output → renderer → iframe', () => {
  it('keeps the author’s inlined script and stylesheet intact', () => {
    // 作者代码必须**原样**进 iframe。少一段就是整个 MiniApp 静默不工作。
    const doc = mount(compiledSource('<p>hi</p>'));
    expect(doc).toContain('window.__ui_ran = true');
    expect(doc).toContain('body{color:red}');
    expect(doc).toContain('<p>hi</p>');
  });

  it('runs the runtime before author code in <body>, the shape every bundled app ships', () => {
    // 装配顺序：runtime 插在 `</head>` 前，作者在 `<body>` 里的 <script src>
    // （Rust 已内联）在其后。`<head>` 先于 `<body>` 解析，所以作者代码执行时
    // `window.app` 已存在。
    //
    // 这才是真正的不变量。之前一版测试误以为 runtime 排在作者**所有**脚本
    // 之前，于是给一个从不发生的情况（作者把同步 `app.*` 调用写进 <head>）
    // 标红。实际上四个 bundled MiniApp 全部把脚本放在 <body>，而
    // miniapp-creator 的模板也是这么教的 —— 写进 <head> 的作者会撞上
    // "Cannot read properties of undefined"，那是作者的错误用法，不是宿主的。
    const doc = mount(
      `<html><head><title>t</title></head>
<body><p>hi</p><script>window.__ui_ran = true;</script></body></html>`,
    );
    const runtimeAt = doc.indexOf('if (window.app) return; // 幂等');
    const authorAt = doc.indexOf('__ui_ran');
    expect(runtimeAt).toBeGreaterThanOrEqual(0);
    expect(authorAt).toBeGreaterThanOrEqual(0);
    expect(runtimeAt).toBeLessThan(authorAt);
  });

  it('gives the author a synchronous app.* as soon as their body script runs', () => {
    // 真正要守的是"作者脚本执行那一刻 app 已就绪"，而不是任何字符串位置。
    // 宿主因此必须在 </head> 之前完成 window.app 赋值，且 runtime 自带
    // `if (window.app) return;` 幂等守卫 —— 否则 srcDoc 重建时会重复注入。
    const doc = mount(
      `<html><head></head><body><script>window.__probe = typeof window.app;</script></body></html>`,
    );
    // runtime 段（IIFE 整体）在 body 脚本之前
    expect(doc.indexOf('window.app = app;')).toBeLessThan(doc.indexOf('__probe'));
    // 幂等守卫存在，重复注入不会二次执行
    expect(doc).toContain('if (window.app) return;');
  });

  it('leaves the author’s own script order untouched', () => {
    // runtime 插在 </head> 前，不能打乱作者自己的多个脚本之间的相对顺序。
    const doc = mount(
      `<html><head>
<script>window.__first = 1;</script>
<script>window.__second = window.__first + 1;</script>
</head><body>hi</body></html>`,
    );
    expect(doc.indexOf('__first')).toBeLessThan(doc.indexOf('__second'));
  });

  it('always installs a CSP, whatever the source looked like', () => {
    // 作者可能自带一个 CSP meta。两条都不能漏：自带的那条要被剥掉（策略取
    // 交集，作者写一条宽松的 connect-src 就等于重新打开了 bypass），宿主这条
    // 必须存在。
    const withOwn = mount(
      compiledSource(
        '<p>hi</p>',
        '<meta http-equiv="Content-Security-Policy" content="connect-src https://evil.example">',
      ),
    );
    expect(withOwn).not.toContain('evil.example');
    expect(cspOf(withOwn)).toContain("connect-src 'none'");

    // 作者的策略**不能**成为最终策略：这里断言全文里只剩宿主那一条 meta。
    const ownMetaCount = (
      withOwn.match(/http-equiv="Content-Security-Policy"/g) ?? []
    ).length;
    expect(ownMetaCount).toBe(1);
  });

  it('injects a CSP even when the source has no <head>', () => {
    // create_from_chat 只校验「文件存在且非空」，一个纯片段 HTML 装得进去。
    const doc = mount('<p>bare fragment</p>');
    expect(cspOf(doc)).toContain("default-src 'none'");
    expect(doc).toContain('<p>bare fragment</p>');
  });

  it('exposes the environment facts the runtime getters read from host.ready', () => {
    // env 经 host.ready 下发；缺字段时 runtime 退回保守默认值，不会崩。
    // 这里钉住"iframe 侧有地方读得到"，而不是钉住具体值。
    const doc = mount(compiledSource('<p>hi</p>'));
    expect(doc).toContain('host.ready');
    expect(doc).toContain('appearanceMode');
    expect(doc).toContain('workspaceDir');
  });

  it('applies CDN tags and the widened CSP together, or neither', () => {
    // 两者必须同时成立。放宽了 CSP 却没注入标签 = 白放宽（且是攻击面）；
    // 注入了标签却没放宽 = 作者的库静默不加载，看起来像 CDN 挂了。
    const withDeps = mount(compiledSource('<p>hi</p>'), [
      { url: 'https://cdn.jsdelivr.net/npm/x@1/x.js', type: 'script' },
    ]);
    expect(withDeps).toContain('cdn.jsdelivr.net/npm/x@1/x.js');
    expect(cspOf(withDeps)).toContain("script-src 'unsafe-inline' 'self' cdn.jsdelivr.net");

    const withoutDeps = mount(compiledSource('<p>hi</p>'));
    expect(withoutDeps).not.toContain('jsdelivr');
    expect(cspOf(withoutDeps)).toContain("script-src 'unsafe-inline' 'self'");
    expect(cspOf(withoutDeps)).not.toContain('jsdelivr');
  });

  it('a dependency declared but unauthorized is dropped on both sides', () => {
    const doc = mount(compiledSource('<p>hi</p>'), [
      { url: 'https://evil.example.com/x.js', type: 'script' },
    ]);
    expect(doc).not.toContain('evil.example.com');
    expect(doc).not.toContain('evil.example.com;');
  });

  it('stamps the appId so a call cannot be attributed to a sibling MiniApp', () => {
    // 多 Tab 并存时，两个 iframe 的 postMessage 走同一个 window。appId + nonce
    // 是宿主判定"这条消息是不是你发的"的依据。
    const doc = mount(compiledSource('<p>hi</p>'));
    expect(doc).toContain('pipe-app');
  });

  it('sandbox flags keep the iframe off the network and the parent DOM', () => {
    const { container } = render(
      <MiniAppRunner appId="pipe-app" srcDoc={compiledSource('<p>hi</p>')} height={100} />,
    );
    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') ?? '';
    const flags = sandbox.split(/\s+/).filter(Boolean);
    // 少一个 allow-same-origin，srcdoc 的 opaque origin 会让 nonce 校验与
    // storage 分片全部失效；多一个 allow-top-navigation，MiniApp 就能把整个
    // 应用导航走。两者都只锁不放。
    expect(flags).toContain('allow-scripts');
    expect(flags).toContain('allow-same-origin');
    expect(flags).not.toContain('allow-top-navigation');
    expect(flags).not.toContain('allow-popups');
  });
});
