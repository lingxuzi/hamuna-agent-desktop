/**
 * ChatV2 — v2 Chat page per the [final] WUM12 "三栏工作台" comp.
 *
 * MainArea (1440×826) = FileTree (220) + ChatColumn (1220). Inside ChatColumn:
 * AgentPanel (260, left), ChatArea (message list + floating search bar, padding
 * [16,120]), InputWrap (ChatInput), and SplitViewPanel (640, right overlay —
 * the split file/terminal/browser pane sits on top, x=580 per the comp).
 *
 * The design nests TitleBar/TabBar inside the frame; AppV2 already renders the
 * fused 44px Chrome, so this page implements only MainArea. All visual values
 * map to theme tokens (—paper-inset, —paper-elevated, —message-user-bg,
 * —accent-primary, —accent-sky, —accent-warm, —code-bg…).
 *
 * Static prototype for now: transcript, agent status, file tree, and split pane
 * render sample content until live hooks land (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';

import FileTree from '../components/chat/FileTree';
import AgentPanel from '../components/chat/AgentPanel';
import MessageList from '../components/chat/MessageList';
import ChatInput from '../components/chat/ChatInput';
import ChatSearchBar from '../components/chat/ChatSearchBar';
import SplitViewPanel from '../components/chat/SplitViewPanel';

export default memo(function ChatV2() {
    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
            {/* Left file column */}
            <FileTree />

            {/* Right chat column: AgentPanel | chat area+input | split pane overlay */}
            <div className="relative flex min-w-0 flex-1 overflow-hidden bg-[var(--paper)]">
                {/* AgentPanel — 260px static left column (260 of 1220 per comp) */}
                <AgentPanel />

                {/* Chat area + input — flex-1 owns the remaining 960px; padding [16,120] */}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div className="flex min-h-0 flex-1 flex-col px-[120px] pt-4">
                            <MessageList />
                        </div>
                        {/* Floating search bar */}
                        <ChatSearchBar />
                    </div>

                    {/* Input wrap — centered, same side padding as the chat area */}
                    <div className="flex shrink-0 justify-center px-[120px] pb-4 pt-2">
                        <ChatInput />
                    </div>
                </div>

                {/* Split pane — 640px right overlay (x=580 within the 1220 chat column) */}
                <SplitViewPanel />
            </div>
        </div>
    );
});
