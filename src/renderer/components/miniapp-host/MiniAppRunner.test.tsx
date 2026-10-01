import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MiniAppRunner from './MiniAppRunner';

describe('MiniAppRunner', () => {
  it('renders iframe with sandbox flags and srcDoc containing user markup', () => {
    const srcDoc = '<html><body><p>hi</p></body></html>';
    const { container } = render(
      <MiniAppRunner appId="hello-miniapp" srcDoc={srcDoc} height={200} />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms'
    );
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

  it('exposes sandbox attr with exactly three flags (PRD v0.3 §11.1)', () => {
    render(<MiniAppRunner appId="a" srcDoc="<html></html>" height={50} />);
    const iframe = document.querySelector('iframe');
    const sandbox = iframe?.getAttribute('sandbox') ?? '';
    const flags = sandbox.split(/\s+/).filter(Boolean);
    expect(flags).toEqual([
      'allow-scripts',
      'allow-same-origin',
      'allow-forms',
    ]);
  });
});