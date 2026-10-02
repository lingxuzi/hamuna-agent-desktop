/**
 * Mermaid fences inside Markdown go through a `lazy()` boundary.
 *
 * Two things this pins, both of which fail silently otherwise:
 *
 *  1. The ```mermaid branch still renders a diagram. `lazy` without a working
 *     `Suspense` fallback throws on first render, and mermaid is the only
 *     place in the Markdown tree that needs the boundary.
 *  2. The fallback shows the raw source, not a spinner — a diagram that is
 *     still loading (or whose chunk failed) must still read as code instead of
 *     leaving a hole in the conversation.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Stub the heavy module so the test exercises OUR lazy/Suspense wiring rather
// than mermaid's renderer.
vi.mock('./markdown/MermaidDiagram', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="mermaid-diagram">{children}</div>
  ),
}));

import Markdown from './Markdown';

const FENCE = '```mermaid\ngraph TD;\n  A-->B;\n```';

describe('Markdown — mermaid lazy boundary', () => {
  it('renders the diagram for a mermaid fence', async () => {
    render(<Markdown>{FENCE}</Markdown>);

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mermaid-diagram').textContent).toContain('A-->B');
  });

  it('falls back to the raw source while the chunk is in flight', () => {
    render(<Markdown>{FENCE}</Markdown>);

    // Synchronously, before the lazy chunk resolves: the source is visible so
    // the message never renders as an empty gap.
    expect(screen.getByText(/graph TD;/)).toBeInTheDocument();
  });
});
