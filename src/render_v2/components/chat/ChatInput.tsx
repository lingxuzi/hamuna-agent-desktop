/**
 * ChatInput — bottom message composer of the v2 Chat (MUwhu). Elevated-paper
 * rounded card: placeholder line, then a bottom bar with the enter-hint on the
 * left and the sage send button on the right. Static for now — live send wiring
 * lands with the transcript hook (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { SendHorizontal } from 'lucide-react';

interface ChatInputProps {
    disabled?: boolean;
}

export default memo(function ChatInput({ disabled }: ChatInputProps) {
    const { t } = useTranslation('app');

    return (
        <div className="flex w-full max-w-[680px] flex-col gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-elevated)] px-4 pb-2.5 pt-3.5 shadow-sm">
            {/* Placeholder line */}
            <p className="text-sm text-[var(--ink-subtle)]">{t('v2.chat.chatInputPlaceholder')}</p>

            {/* Bottom bar: hint + send */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--ink-subtle)]">{t('v2.chat.chatInputHint')}</span>
                <button
                    type="button"
                    disabled={disabled}
                    title={t('v2.chat.send')}
                    aria-label={t('v2.chat.send')}
                    className="flex h-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <SendHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {t('v2.chat.send')}
                </button>
            </div>
        </div>
    );
});
