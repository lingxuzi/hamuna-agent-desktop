/**
 * MessageList — the chat transcript of the v2 Chat (Gw5Jp / WUM12 MessageList).
 * A vertical stack of alternating user / tool-call / assistant bubbles, per the
 * comp: User (480w) → ToolCall → AI (560w) → User → AI. Static sample content
 * for now — live transcript wiring is deferred (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';

import { MessageAI, MessageUser, ToolCallCard } from './MessageCard';

/** Static sample transcript mirroring the comp's MessageList frame. */
const SAMPLE_TRANSCRIPT = [
    { kind: 'user' as const, content: '帮我分析一下这个项目的代码结构，有哪些模块需要重构？' },
    { kind: 'tool' as const, toolName: '读取 src/renderer/App.tsx', status: 'done' as const },
    {
        kind: 'ai' as const,
        content: '根据分析，项目有以下模块建议重构：\n\n1. 会话管理 — Tab 和 Session 的生命周期管理比较分散\n2. 工具注册 — MCP tool 的注册逻辑可以统一\n3. 配置持久化 — 多处写入 config.json 需要加锁',
    },
    { kind: 'user' as const, content: '那从会话管理开始改吧，具体怎么做？' },
    {
        kind: 'ai' as const,
        content: '好的，我们先从会话管理入手。建议把 Tab 生命周期收敛到一个统一的 Store，并把 Session 的创建/销毁拆成独立 Service…',
    },
] as const;

export default memo(function MessageList() {
    return (
        <div className="flex flex-col gap-4 overflow-y-auto">
            {SAMPLE_TRANSCRIPT.map((m, i) => {
                if (m.kind === 'user') {
                    return <MessageUser key={i} content={m.content} />;
                }
                if (m.kind === 'tool') {
                    return <ToolCallCard key={i} toolName={m.toolName} status={m.status} />;
                }
                return <MessageAI key={i} content={m.content} />;
            })}
        </div>
    );
});
