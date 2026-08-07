/**
 * SplitViewPanel — right split pane of the v2 Chat (t06we). A 640px overlay
 * with a tab bar (文件 / 终端 / 浏览器) and a pane body. The design shows the
 * terminal (dark) and file-editor (light) states; we render the terminal for
 * now with a static transcript. Static — live terminal/file wiring is deferred.
 */
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SplitTab = 'file' | 'terminal' | 'browser';

const TERM_LINES = [
    '$ npm run dev',
    '✓ ready in 540ms',
    '➜  Local:  http://localhost:5173',
    '$ git status',
];

export default memo(function SplitViewPanel() {
    const { t } = useTranslation('app');
    const [tab, setTab] = useState<SplitTab>('terminal');

    return (
        <div className="flex w-[640px] shrink-0 flex-col overflow-hidden rounded-l-lg border border-[var(--line)] bg-[var(--paper)]">
            {/* Tab bar */}
            <div className="flex h-9 items-center gap-1.5 px-2.5">
                {(['file', 'terminal', 'browser'] as const).map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        aria-pressed={tab === key}
                        className={`flex h-6 items-center rounded-md px-2.5 text-xs font-medium transition-colors ${
                            tab === key
                                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                        }`}
                    >
                        {t(`v2.chat.splitTabs.${key}`)}
                    </button>
                ))}
            </div>

            {/* Pane body */}
            {tab === 'terminal' ? (
                <div className="flex flex-1 flex-col gap-1.5 bg-[var(--code-bg)] p-3">
                    <p className="h-[18px] text-xs text-[var(--ink-subtle)]">zsh</p>
                    {TERM_LINES.map((line) => (
                        <p key={line} className="truncate font-mono text-xs text-[var(--code-text)]">
                            {line}
                        </p>
                    ))}
                </div>
            ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[var(--paper-inset)]">
                    <p className="text-xs text-[var(--ink-muted)]">
                        {t(`v2.chat.splitTabs.${tab}`)}
                    </p>
                    <p className="text-xs text-[var(--ink-subtle)]">
                        {t('v2.chat.splitComingSoon')}
                    </p>
                </div>
            )}
        </div>
    );
});
