import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MiniAppRunner from './MiniAppRunner';
import { THEME_TOKEN_STYLE_ID } from './theme-tokens';

describe('MiniAppRunner', () => {
  it('renders iframe with sandbox flags and srcDoc containing user markup', () => {
    const srcDoc = '<html><body><p>hi</p></body></html>';
    const { container } = render(
      <MiniAppRunner appId="hello-miniapp" srcDoc={srcDoc} height={200} />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    // Theme token CSS is prepended by the runner, then user srcdoc follows.
    const rendered = iframe?.getAttribute('srcdoc') ?? '';
    expect(rendered).toContain('<p>hi</p>');
    expect(iframe?.getAttribute('name')).toMatch(/^miniapp-iframe-hello-miniapp/);
  });

  it('injects x-miniapp-id meta into srcDoc', () => {
    const srcDoc = '<html><head></head><body></body></html>';
    render(
      <MiniAppRunner appId="hello-miniapp" srcDoc={srcDoc} height={100} />
    );
    const iframe = screen.getByTitle('MiniApp hello-miniapp');
    const rendered = iframe.getAttribute('srcdoc') ?? '';
    expect(rendered).toContain('name="x-miniapp-id"');
    expect(rendered).toContain('content="hello-miniapp"');
  });

  it('exposes sandbox attr with exactly two flags (PRD v0.3 §11.1)', () => {
    render(<MiniAppRunner appId="a" srcDoc="<html></html>" height={50} />);
    const iframe = document.querySelector('iframe');
    const sandbox = iframe?.getAttribute('sandbox') ?? '';
    const flags = sandbox.split(/\s+/).filter(Boolean);
    expect(flags).toEqual(['allow-scripts', 'allow-forms']);
  });

  it('never grants allow-same-origin — it is a full sandbox escape, not a lock', () => {
    // 单独一条，是因为这个 flag 一旦被"顺手加回来"，上面那条 toEqual 也未必有人
    // 会先看到，而它加回来的后果是 MiniApp 直接拿到
    // `window.parent.__TAURI_INTERNALS__.invoke` —— 本仓所有 MiniApp 权限判定
    // （app-permissions / resolvePolicyForSidecar / checkAppPermission /
    // path-safety）一次性作废。理由详见 MiniAppRunner 里 SANDBOX_FLAGS 的注释。
    render(<MiniAppRunner appId="a" srcDoc="<html></html>" height={50} />);
    const flags = (document.querySelector('iframe')?.getAttribute('sandbox') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    expect(flags).not.toContain('allow-same-origin');
  });

  it('does not put \'self\' in the iframe CSP — an opaque origin matches nothing', () => {
    // 去掉 allow-same-origin 之后 iframe 是 opaque origin，CSP 里 `'self'` 匹配不到
    // 任何来源。留着它不会放宽任何东西，但会让后来人以为 MiniApp 与宿主同源，
    // 进而以为 `'self'` 还能兜住兄弟文件 —— 而兄弟文件早已由 Rust 的
    // `inline_miniapp_siblings` 内联，兜底的从来不是 CSP。
    const { container } = render(
      <MiniAppRunner appId="a" srcDoc="<html></html>" height={50} />
    );
    // CSP 写在 HTML 属性里，`escapeHtml` 已把 `'` 变成 `&#39;`；不断码的话每条
    // 断言都会读成"策略写错了"，而其实是对的。必须锚到 `default-src` —— 第一个
    // `content="…"` 是 `x-miniapp-id` 那条 meta，不是 CSP。
    const raw =
      container
        .querySelector('iframe')
        ?.getAttribute('srcdoc')
        ?.match(/content="([^"]*default-src[^"]*)"/)?.[1] ?? '';
    const csp = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'self'/);
    expect(csp).not.toMatch(/style-src[^;]*'self'/);
  });

  it('wraps the theme tokens in a <style> element — bare CSS in a document is inert', () => {
    // 没有 <style> 包裹时，`:root { --x: … }` 只是 body 里的一段文本，浏览器一行
    // CSS 都不会应用。PRD v0.3 §5.3 的主题 token 特性从落地那天起就是死的，而本文件
    // 上面那句"Theme token CSS is prepended by the runner"一直把它当已验证事实。
    const { container } = render(
      <MiniAppRunner appId="a" srcDoc="<html><head></head><body><p>hi</p></body></html>" height={50} />,
    );
    const doc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';

    // 允许带属性：id 是承重的，不是装饰 —— appRuntimeScript 靠它找到首屏那个元素，
    // 切亮暗时改写的就是它（见 MiniAppRunner.wire.dom.test.tsx 的推送用例）。
    expect(doc).toMatch(/<style[^>]*>\s*:root\s*\{/);
    expect(doc).toContain(`id="${THEME_TOKEN_STYLE_ID}"`);
    expect(doc).toContain('--hamuna-bg-primary');
  });

  it('an installed theme cannot inject a script into the MiniApp iframe', () => {
    // 端到端：Theme 的 CSS 变量值 → readThemeTokens → buildThemeTokenCss → srcDoc。
    // 只测纯函数不够 —— 拼装那一步才是当初漏掉 <style> 的地方，两处都要断。
    const payload = '</style><script>window.__pwned=1</script><style>';
    const real = window.getComputedStyle;
    window.getComputedStyle = ((_el: Element) => ({
      getPropertyValue: (name: string) => (name === '--paper' ? payload : ''),
    })) as unknown as typeof window.getComputedStyle;
    try {
      const { container } = render(
        <MiniAppRunner appId="a" srcDoc="<html><head></head><body><p>hi</p></body></html>" height={50} />,
      );
      const doc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';

      // 整个文档只允许有 runtime 那一个 <script>；payload 拼不出第二个
      expect(doc.match(/<script>/g) ?? []).toHaveLength(1);
      expect(doc).not.toContain('window.__pwned=1</script>');
      expect(doc).toContain('\\3c ');
    } finally {
      window.getComputedStyle = real;
    }
  });
});
