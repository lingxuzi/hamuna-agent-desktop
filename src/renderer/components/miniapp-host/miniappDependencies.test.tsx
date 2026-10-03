// 宿主侧 `dependencies` 行为：CSP 放宽 + 标签注入。
//
// 与 shared 的 schema 用例配对：schema 保证作者"声明得合法"，这里保证宿主
// "只对已授权的依赖放宽"。两道闸都要在 —— 只有 schema 时，手工改过的 meta.json
// 仍能驱动宿主放宽 CSP；只有宿主时，一个漏网的 schema 分支就等于没有授权。

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MiniAppRunner from './MiniAppRunner';

const CDN = 'https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js';
const CSS = 'https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.css';

function renderDoc(opts: {
  dependencies?: { url: string; type: 'script' | 'style' }[];
  allow?: string[];
}): string {
  const { container } = render(
    <MiniAppRunner
      appId="dep-app"
      srcDoc="<html><head><title>t</title></head><body><p>hi</p></body></html>"
      height={200}
      dependencies={opts.dependencies}
      permissions={{ net: { allow: opts.allow ?? [] } }}
    />,
  );
  return container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
}

function cspOf(doc: string): string {
  const raw = doc.match(/content="([^"]*)"/)?.[1] ?? '';
  // The CSP is written into an HTML attribute, so `escapeHtml` has already
  // turned `'` into `&#39;`. Decode before asserting on directives, otherwise
  // every expectation reads as a mismatch against a *correct* policy.
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('MiniAppRunner CDN dependencies', () => {
  it('keeps the strict default CSP when nothing is declared', () => {
    const csp = cspOf(renderDoc({}));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    // No bare origin token smuggled into script-src.
    expect(csp).not.toContain('jsdelivr');
  });

  it('injects <script defer> and widens script-src for an authorized host', () => {
    const doc = renderDoc({
      dependencies: [{ url: CDN, type: 'script' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(doc).toContain(`<script src="${CDN}" defer></script>`);
    expect(cspOf(doc)).toContain(
      "script-src 'unsafe-inline' cdn.jsdelivr.net",
    );
  });

  it('injects <link rel=stylesheet> and widens style-src', () => {
    const doc = renderDoc({
      dependencies: [{ url: CSS, type: 'style' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(doc).toContain(`<link rel="stylesheet" href="${CSS}">`);
    expect(cspOf(doc)).toContain("style-src 'unsafe-inline' cdn.jsdelivr.net");
  });

  it('places the tags inside <head>, before user markup', () => {
    const doc = renderDoc({
      dependencies: [{ url: CDN, type: 'script' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(doc.indexOf(CDN)).toBeLessThan(doc.indexOf('</head>'));
    expect(doc.indexOf(CDN)).toBeLessThan(doc.indexOf('<p>hi</p>'));
  });

  it('blocks a dep whose host is outside net.allow (fail-closed)', () => {
    const doc = renderDoc({
      dependencies: [{ url: CDN, type: 'script' }],
      allow: ['api.example.com'],
    });
    expect(doc).not.toContain(CDN);
    expect(cspOf(doc)).not.toContain('jsdelivr');
    expect(cspOf(doc)).toContain("default-src 'none'");
  });

  it('blocks every dep when net.allow is empty', () => {
    const doc = renderDoc({ dependencies: [{ url: CDN, type: 'script' }], allow: [] });
    expect(doc).not.toContain(CDN);
    expect(cspOf(doc)).not.toContain('jsdelivr');
  });

  it('never widens connect-src, even with an authorized dep', () => {
    // The dependency is a load-time asset, not a channel. Leaving connect-src
    // at 'none' is what stops a CDN compromise from exfiltrating app state.
    const doc = renderDoc({
      dependencies: [{ url: CDN, type: 'script' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(cspOf(doc)).toContain("connect-src 'none'");
  });

  it('never widens font-src, which would need CORS headers anyway', () => {
    const doc = renderDoc({
      dependencies: [{ url: CDN, type: 'style' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(cspOf(doc)).toContain('font-src data:');
  });

  it('dedupes repeated hosts in the CSP', () => {
    const doc = renderDoc({
      dependencies: [
        { url: CDN, type: 'script' },
        { url: 'https://cdn.jsdelivr.net/npm/other@1/other.js', type: 'script' },
      ],
      allow: ['cdn.jsdelivr.net'],
    });
    const csp = cspOf(doc);
    expect(csp.match(/cdn\.jsdelivr\.net/g)?.length).toBe(2); // script-src + style-src
    // Both tags still present — dedupe is about the CSP, not the tags.
    expect(doc).toContain('other.js');
  });

  it('escapes quotes in a dependency URL rather than breaking out of the attribute', () => {
    const nasty = 'https://cdn.jsdelivr.net/npm/x@1/x.js"><script>alert(1)</script>';
    const doc = renderDoc({
      dependencies: [{ url: nasty, type: 'script' }],
      allow: ['cdn.jsdelivr.net'],
    });
    expect(doc).not.toContain('"><script>alert(1)</script>');
    expect(doc).toContain('&quot;');
  });
});
