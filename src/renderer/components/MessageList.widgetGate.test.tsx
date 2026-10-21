// Only the NEWEST assistant message's widgets may send actions back.
//
// A widget click becomes a user turn. If an older widget in scrollback stayed
// live, clicking it would inject a gesture into a conversation that has already
// moved past that widget — the model would act on stale UI. The gate lives in
// MessageList (it knows the transcript order); this asserts it is applied where
// the row is built, not inside WidgetRenderer where order is unknowable.
import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VirtuosoMockContext } from 'react-virtuoso';

import type { Message as MessageType } from '@/types/chat';

const seen: Array<{ id: string; interactive: boolean; hasAction: boolean }> = [];

vi.mock('@/components/Message', () => ({
  default: (props: {
    message: { id: string };
    widgetsInteractive?: boolean;
    onWidgetAction?: unknown;
  }) => {
    seen.push({
      id: props.message.id,
      interactive: props.widgetsInteractive === true,
      hasAction: typeof props.onWidgetAction === 'function',
    });
    return <div data-testid={`msg-${props.message.id}`} />;
  },
}));
vi.mock('@/components/PermissionPrompt', () => ({ PermissionPrompt: () => null }));
vi.mock('@/components/AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => null }));
vi.mock('@/components/ExitPlanModePrompt', () => ({ ExitPlanModePrompt: () => null }));

import MessageList from './MessageList';

function msg(id: string, role: 'user' | 'assistant' = 'assistant'): MessageType {
  return { id, role, content: 'x', timestamp: new Date() } as MessageType;
}

describe('MessageList widget interactivity gate', () => {
  it('enables widgets only on the newest assistant row', () => {
    seen.length = 0;
    const messages = [
      msg('u1', 'user'),
      msg('a1'),
      msg('u2', 'user'),
      msg('a2'),
      msg('u3', 'user'),
    ];

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>
        <MessageList
          messages={messages}
          streamingMessage={null}
          isLoading={false}
          sessionId="s1"
          isActive
          firstItemIndex={1_000_000}
          virtuosoRef={{ current: null }}
          followEnabledRef={{ current: true } as React.MutableRefObject<boolean | 'force'>}
          scrollToBottom={vi.fn()}
          handleAtBottomChange={vi.fn()}
          onWidgetAction={() => {}}
        />
      </VirtuosoMockContext.Provider>,
    );

    const byId = Object.fromEntries(seen.map((row) => [row.id, row]));
    expect(byId.a2.interactive).toBe(true);
    expect(byId.a1.interactive).toBe(false);
    expect(byId.u1.interactive).toBe(false);
    // The callback is wired on every row; WidgetRenderer is what drops a stale
    // click, so a missing callback here would silently kill the live widget too.
    expect(byId.a2.hasAction).toBe(true);
  });
});
