import { describe, it, expect } from 'vitest';

import { htmlToMarkdown } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('converts headings, paragraphs and lists', () => {
    const markdown = htmlToMarkdown(
      '<html><body><h1>Title</h1><p>Hello world</p><ul><li>one</li><li>two</li></ul></body></html>',
    );
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('Hello world');
    expect(markdown).toContain('- one');
    expect(markdown).toContain('- two');
  });

  it('drops chrome (script / style / nav) but keeps body content', () => {
    const markdown = htmlToMarkdown(
      '<html><head><style>.x{color:red}</style></head><body>' +
        '<nav>Skip to content</nav>' +
        '<script>alert(1)</script>' +
        '<p>Real content</p>' +
        '</body></html>',
    );
    expect(markdown).toContain('Real content');
    expect(markdown).not.toContain('Skip to content');
    expect(markdown).not.toContain('alert(1)');
    expect(markdown).not.toContain('color:red');
  });

  it('keeps link hrefs so the agent can act on them', () => {
    const markdown = htmlToMarkdown(
      '<html><body><p><a href="https://example.com/docs">Docs</a></p></body></html>',
    );
    expect(markdown).toContain('https://example.com/docs');
  });

  it('strips noisy attributes but keeps semantic ones', () => {
    const markdown = htmlToMarkdown(
      '<html><body><p class="sc-x" id="y" style="color:red" data-reactid="7">Text</p>' +
        '<a href="/a" target="_blank">Link</a></body></html>',
    );
    expect(markdown).toContain('Text');
    expect(markdown).not.toContain('sc-x');
    expect(markdown).not.toContain('color:red');
    expect(markdown).not.toContain('data-reactid');
    expect(markdown).not.toContain('target=');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });

  it('truncates output at maxLength', () => {
    const html = `<html><body><p>${'x'.repeat(5000)}</p></body></html>`;
    const markdown = htmlToMarkdown(html, { maxLength: 100 });
    expect(markdown.length).toBeLessThan(200);
    expect(markdown).toContain('truncated');
  });

  it('does not throw on malformed markup', () => {
    expect(() => htmlToMarkdown('<div><p>unclosed <b>bold')).not.toThrow();
    expect(htmlToMarkdown('<div><p>unclosed <b>bold')).toContain('unclosed');
  });
});
