// Regression test for the permission prompt not rendering.
//
// Root cause: the Virtuoso Footer is memoized (useMemo []) and reads
// `pendingPermission` (and the other footer cards) through a ref mirror.
// A permission request arrives while the SDK turn is PAUSED awaiting the human,
// so the message `data` prop is referentially stable. Virtuoso (memoized) sees
// no prop change and skips re-rendering, so the Footer never re-reads the
// updated ref and the prompt card never mounts — the turn hangs until Stop.
//
// Unlike the other MessageList tests (which mock react-virtuoso to always render
// the Footer), this one renders the REAL Virtuoso inside VirtuosoMockContext so
// the memoization behaviour is actually exercised.
import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VirtuosoMockContext } from 'react-virtuoso';

import type { Message as MessageType } from '@/types/chat';

// Heavy children — stub so jsdom doesn't pull Markdown / tool trees.
vi.mock('@/components/Message', () => ({ default: () => <div data-testid="msg" /> }));
// Sentinel so we can assert the real prompt card mounted in the real Footer.
vi.mock('@/components/PermissionPrompt', () => ({
  PermissionPrompt: ({ request }: { request: { toolName: string } }) => (
    <div data-testid="permission-prompt">{request.toolName}</div>
  ),
}));
vi.mock('@/components/AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => null }));
vi.mock('@/components/ExitPlanModePrompt', () => ({ ExitPlanModePrompt: () => null }));

import MessageList from './MessageList';

function msg(id: string, content: string, role: 'user' | 'assistant' = 'assistant'): MessageType {
  return { id, role, content, timestamp: new Date() } as MessageType;
}

function renderWithRealVirtuoso(overrides: Partial<React.ComponentProps<typeof MessageList>> = {}) {
  const props: React.ComponentProps<typeof MessageList> = {
    messages: [msg('h1', 'hello', 'user')],
    streamingMessage: null,
    isLoading: false,
    sessionId: 's1',
    isActive: true,
    firstItemIndex: 1_000_000,
    virtuosoRef: { current: null },
    followEnabledRef: { current: true } as React.MutableRefObject<boolean | 'force'>,
    scrollToBottom: vi.fn(),
    handleAtBottomChange: vi.fn(),
    ...overrides,
  };
  return render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>
      <MessageList {...props} />
    </VirtuosoMockContext.Provider>,
  );
}

describe('MessageList — permission prompt renders in the real Virtuoso footer', () => {
  it('mounts the PermissionPrompt when pendingPermission arrives (turn is paused, data is stable)', () => {
    const history = [msg('h1', 'hello', 'user')];
    const { rerender, queryByTestId } = renderWithRealVirtuoso({
      messages: history,
      pendingPermission: null,
      onPermissionDecision: () => {},
    });

    expect(queryByTestId('permission-prompt')).not.toBeInTheDocument();

    rerender(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>
        <MessageList
          messages={history}
          streamingMessage={null}
          isLoading={false}
          isActive
          sessionId="s1"
          firstItemIndex={1_000_000}
          virtuosoRef={{ current: null }}
          followEnabledRef={{ current: true } as React.MutableRefObject<boolean | 'force'>}
          scrollToBottom={vi.fn()}
          handleAtBottomChange={vi.fn()}
          pendingPermission={{ requestId: 'perm_1', toolName: 'Bash', input: '{}' }}
          onPermissionDecision={() => {}}
        />
      </VirtuosoMockContext.Provider>,
    );

    expect(queryByTestId('permission-prompt')).toBeInTheDocument();
    expect(queryByTestId('permission-prompt')).toHaveTextContent('Bash');
  });
});
