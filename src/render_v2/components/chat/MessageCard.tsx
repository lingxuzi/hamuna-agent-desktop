/**
 * MessageCard — the three reusable chat bubbles from the WUM12 comp.
 *
 * - MessageUser  (dIyAj): 480w, paper-white bubble, Inter 14px prose.
 * - MessageAI    (grWRe): 560w, elevated-paper bubble + soft shadow, sage role
 *                 label, mono 12px technical content (comp says JetBrains Mono
 *                 13px; v1 scale locks at text-xs, so 12px is the closest tier).
 * - ToolCallCard (hyxZV): 520w warm-paper pill, zap glyph + mono tool name + a
 *                 sage status badge.
 *
 * Role text is static sample content — the comp is a visual prototype; live
 * transcript wiring is deferred (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

/** Tool status badge — sage pill, white text, matches StatusBadge in hyxZV. */
type ToolStatus = 'done' | 'running';

interface ToolCallCardProps {
    toolName: string;
    status: ToolStatus;
}

export const ToolCallCard = memo(function ToolCallCard({ toolName, status }: ToolCallCardProps) {
    const { t } = useTranslation('app');
    return (
        <div className="flex w-[520px] max-w-full items-center gap-2.5 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-inset)] px-3.5 py-2">
            <Zap className="h-4 w-4 shrink-0 text-[var(--accent-warm)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-[var(--ink)]">
                {toolName}
            </span>
            <span
                className={`flex h-[18px] shrink-0 items-center rounded px-2 text-xs font-medium ${
                    status === 'done'
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'bg-[var(--accent-sky)] text-white'
                }`}
            >
                {status === 'done' ? t('v2.chat.toolDone') : t('v2.chat.toolRunning')}
            </span>
        </div>
    );
});

/** MessageUser — user bubble: 480w paper-white card, Inter 14px content. */
export const MessageUser = memo(function MessageUser({ content }: { content: string }) {
    return (
        <div className="w-[480px] max-w-full rounded-[10px] border border-[var(--line-strong)] bg-[var(--message-user-bg)] px-4 py-3">
            <p className="text-sm leading-[1.5] text-[var(--ink)]">{content}</p>
        </div>
    );
});

/** MessageAI — assistant bubble: 560w elevated-paper card, shadow, sage role, mono content. */
export const MessageAI = memo(function MessageAI({ content }: { content: string }) {
    const { t } = useTranslation('app');
    return (
        <div className="w-[560px] max-w-full rounded-[10px] border border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-[18px] py-3.5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--accent-primary)]">
                {t('v2.chat.roleAssistant')}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap font-mono text-xs leading-[1.6] text-[var(--ink)]">
                {content}
            </p>
        </div>
    );
});
