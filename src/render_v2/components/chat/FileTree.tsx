/**
 * FileTree — left file column of the v2 Chat (WUM12 MainArea.i17Zk). 220px
 * warm-inset sidebar with a tree header, mono directory nodes, a divider, and
 * the AgentDock (yzoEt) pinned to the bottom. Static tree for now — live
 * workspace files hook in later (see CHAT-IDEAS caveats).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentDock from './AgentDock';

/** Static sample tree from the comp — placeholder until live workspace wiring. */
const TREE_NODES = ['hamuna-agent-desktop', 'src', 'renderer', 'server', 'cli', 'src-tauri'];

export default memo(function FileTree() {
    const { t } = useTranslation('app');
    return (
        <div className="flex w-[220px] shrink-0 flex-col overflow-hidden bg-[var(--paper-inset)] py-4">
            {/* Header + collapse */}
            <div className="flex items-center justify-between px-3">
                <span className="text-xs font-semibold tracking-[0.3px] text-[var(--ink-muted)]">
                    {t('v2.chat.fileTreeTitle')}
                </span>
                <span className="text-xs text-[var(--ink-subtle)]" aria-hidden="true">
                    {t('v2.chat.fileTreeCollapse')}
                </span>
            </div>

            {/* Tree — root bold, children muted, indented per depth */}
            <div className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-3">
                {TREE_NODES.map((node, i) => (
                    <span
                        key={node}
                        className={`truncate font-mono text-xs ${
                            i === 0
                                ? 'font-medium text-[var(--ink)]'
                                : i === 1
                                  ? 'pl-0 text-[var(--ink-muted)]'
                                  : 'pl-2 text-[var(--ink-muted)]'
                        }`}
                    >
                        {node}
                    </span>
                ))}
            </div>

            {/* Divider + AgentDock pinned to bottom */}
            <div className="mx-3 h-px bg-[var(--line-subtle)]" aria-hidden="true" />
            <AgentDock />
        </div>
    );
});
