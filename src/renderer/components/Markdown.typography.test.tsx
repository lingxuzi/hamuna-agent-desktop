/**
 * Markdown typography contract.
 *
 * The defect this pins: `compact` used to shrink only the ROOT font size, so
 * everything else — headings, list gaps, table padding — kept full size. A
 * "compact" thinking block therefore rendered a 24px H1 inside a small panel,
 * which is the opposite of compact. The rhythm now comes from CSS variables
 * scoped to `.markdown-content`, and `--compact` scales all of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Markdown from './Markdown';

// Read via cwd, not import.meta.url: this project runs under the jsdom
// ("dom") vitest project, where import.meta.url is rewritten to an http URL.
const css = readFileSync(
  join(process.cwd(), 'src/renderer/components/markdown/Markdown.css'),
  'utf8',
);

describe('Markdown.css — vertical rhythm', () => {
  it('declares the rhythm variables on the base selector', () => {
    const block = css.slice(css.indexOf('.markdown-content {'));
    for (const token of [
      '--markdown-flow-gap',
      '--markdown-heading-gap-top',
      '--markdown-heading-gap-bottom',
      '--markdown-list-indent',
      '--markdown-list-block-gap',
      '--markdown-list-item-gap',
      '--markdown-table-inset',
    ]) {
      expect(block).toContain(token);
    }
  });

  it('overrides every dimension under --compact, not just the font', () => {
    const start = css.indexOf('.markdown-content--compact {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));

    // Each of these must shrink in compact mode. If one is missing, that
    // dimension silently stays full-size — the exact bug being guarded.
    const variables = [...block.matchAll(/(--markdown-[\w-]+):\s*([^;]+);/g)];
    expect(variables.length).toBeGreaterThanOrEqual(7);

    const base = css.slice(css.indexOf('.markdown-content {'));
    for (const [, name, compactValue] of variables) {
      const baseMatch = new RegExp(`${name}:\\s*([^;]+);`).exec(base);
      expect(baseMatch, `${name} must also be declared on the base`).not.toBeNull();
      expect(compactValue.trim(), `${name} compact value`).not.toBe(baseMatch![1].trim());
    }
  });

  it('drops the trailing gap on the last list item', () => {
    // GFM tight and loose lists share element names; without this the final
    // item carries a dangling margin.
    expect(css).toMatch(/:is\(ul, ol\) > li:last-child\s*\{[^}]*margin-bottom:\s*0/);
  });

  it('gives wide tables a container-query escape hatch', () => {
    expect(css).toContain('@container markdown-surface');
    expect(css).toContain('.markdown-wide-table');
  });
});

describe('Markdown — compact root class', () => {
  it('emits the rhythm + compact hooks on the container', () => {
    const { container, rerender } = render(<Markdown>{'# Title\n\nbody'}</Markdown>);
    let root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('markdown-content');
    expect(root.className).not.toContain('markdown-content--compact');
    // Flex children need min-w-0 or a wide table pushes the column sideways.
    expect(root.className).toContain('min-w-0');

    rerender(<Markdown compact>{'# Title\n\nbody'}</Markdown>);
    root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('markdown-content--compact');
  });

  it('keeps rendering a heading inside compact', () => {
    render(<Markdown compact>{'# Compact heading'}</Markdown>);
    // The whole point: the heading still renders, just scaled by CSS rather
    // than by a full-size hardcoded utility.
    expect(screen.getByRole('heading', { level: 1, name: 'Compact heading' })).toBeInTheDocument();
  });
});
