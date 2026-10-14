import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SessionKnowledgePanel from './SessionKnowledgePanel';
import type { SessionKnowledgeGraph } from '../../shared/sessionKnowledge';
import type { TabContextValue } from '@/context/TabContext';

const { useTabStateMock } = vi.hoisted(() => ({ useTabStateMock: vi.fn() }));

vi.mock('@/context/TabContext', async () => {
  const actual = await vi.importActual<typeof import('@/context/TabContext')>('@/context/TabContext');
  return { ...actual, useTabState: useTabStateMock };
});

// canvas 2D context is unavailable in jsdom — stub the drawing surface so the
// graph engine can mount.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  setTransform: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 10 })),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  canvas: document.createElement('canvas'),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

function makeContext(knowledgeGraph: SessionKnowledgeGraph | null, knowledgeExtracting = false): TabContextValue {
  return {
    knowledgeGraph,
    knowledgeExtracting,
  } as unknown as TabContextValue;
}

const graph: SessionKnowledgeGraph = {
  version: 1,
  entities: [
    { id: 'React', label: 'React', entityType: 'CODE', sources: ['m1'], weight: 2 },
    { id: 'Vite', label: 'Vite', entityType: 'CODE', sources: ['m1'], weight: 1 },
  ],
  relations: [
    { subject: 'React', object: 'Vite', relationType: 'integrates_with', weight: 1, typed: true, sources: ['m1'] },
  ],
  turnCount: 2,
  updatedAtMs: 1,
};

describe('SessionKnowledgePanel', () => {
  it('renders the empty state when no graph has arrived', () => {
    useTabStateMock.mockReturnValue(makeContext(null));
    render(<SessionKnowledgePanel onClose={vi.fn()} onLocateMessage={vi.fn()} />);
    expect(screen.getByText('还没有知识节点')).toBeInTheDocument();
  });

  it('renders stats when a graph is present', () => {
    useTabStateMock.mockReturnValue(makeContext(graph));
    render(<SessionKnowledgePanel onClose={vi.fn()} onLocateMessage={vi.fn()} />);
    expect(screen.getByText('2 概念 · 1 关系')).toBeInTheDocument();
  });

  it('closes via the header button', () => {
    useTabStateMock.mockReturnValue(makeContext(graph));
    const onClose = vi.fn();
    render(<SessionKnowledgePanel onClose={onClose} onLocateMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭看板' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the absorbing indicator only while the sidecar is extracting', () => {
    useTabStateMock.mockReturnValue(makeContext(graph, true));
    const { rerender } = render(<SessionKnowledgePanel onClose={vi.fn()} onLocateMessage={vi.fn()} />);
    expect(screen.getByText('吸收中…')).toBeInTheDocument();

    useTabStateMock.mockReturnValue(makeContext(graph, false));
    rerender(<SessionKnowledgePanel onClose={vi.fn()} onLocateMessage={vi.fn()} />);
    expect(screen.queryByText('吸收中…')).not.toBeInTheDocument();
  });
});
