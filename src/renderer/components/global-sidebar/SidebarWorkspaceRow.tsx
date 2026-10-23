import { memo, useCallback, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MenuItem } from '@/components/ui/MenuItem';
import { Popover } from '@/components/ui/Popover';
import WorkspaceIcon from '@/components/launcher/WorkspaceIcon';
import { isProjectArchived, type Project } from '@/config/types';
import { getFolderName } from '@/types/tab';

export interface SidebarWorkspaceRowProps {
  project: Project;
  selected: boolean;
  /** Whether the row's history is currently shown underneath it. */
  expanded: boolean;
  onSelect: (project: Project) => void;
  onTogglePin: (project: Project) => void;
  onArchive: (project: Project) => void;
  onUnarchive: (project: Project) => void;
  onAgentSettings: (project: Project) => void;
  onOpenFolder: (project: Project) => void;
  onRemove: (project: Project) => void;
}

/** Compact workspace row for the global sidebar. Same actions as the old
 *  launcher WorkspaceCard, but one line tall. Clicking selects the workspace
 *  (driving the Launcher composer) and toggles its nested history. */
export const SidebarWorkspaceRow = memo(function SidebarWorkspaceRow({
  project,
  selected,
  expanded,
  onSelect,
  onTogglePin,
  onArchive,
  onUnarchive,
  onAgentSettings,
  onOpenFolder,
  onRemove,
}: SidebarWorkspaceRowProps) {
  const { t } = useTranslation('launcher');
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const archived = isProjectArchived(project);
  const pinned = Boolean(project.pinnedAt);
  const label = project.displayName || getFolderName(project.path);

  const closeMenu = useCallback(() => setMenuAt(null), []);
  const openMenu = useCallback((x: number, y: number) => setMenuAt({ x, y }), []);
  const run = useCallback((action: (p: Project) => void) => {
    closeMenu();
    action(project);
  }, [closeMenu, project]);

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!archived) onSelect(project); }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        aria-disabled={archived || undefined}
        className={`group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
          archived
            ? 'cursor-default text-[var(--ink-muted)] opacity-60'
            : selected
              ? 'bg-[var(--paper-inset)] font-medium text-[var(--ink)]'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]'
        }`}
        title={project.path}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-[var(--ink-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <WorkspaceIcon icon={project.icon} size={16} />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />}
        <span
          role="button"
          tabIndex={-1}
          aria-label={t('workspaceCard.more')}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openMenu(rect.right, rect.bottom);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-[var(--paper)] hover:text-[var(--ink)] group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </span>
      </button>
      {menuAt && (
        <>
          <span ref={anchorRef} className="fixed h-px w-px" style={{ left: menuAt.x, top: menuAt.y }} aria-hidden />
          <Popover open onClose={closeMenu} anchorRef={anchorRef} placement="bottom-end" offset={2} className="w-36 py-1">
            {!archived && (
              <MenuItem
                icon={pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                label={pinned ? t('workspaceCard.unpin') : t('workspaceCard.pin')}
                onClick={() => run(onTogglePin)}
              />
            )}
            <MenuItem
              icon={<Settings2 className="h-3.5 w-3.5" />}
              label={t('workspaceCard.agentSettings')}
              onClick={() => run(onAgentSettings)}
            />
            <MenuItem
              icon={archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              label={archived ? t('workspaceCard.unarchive') : t('workspaceCard.archive')}
              onClick={() => run(archived ? onUnarchive : onArchive)}
            />
            <MenuItem
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t('workspaceCard.openFolder')}
              onClick={() => run(onOpenFolder)}
            />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={t('workspaceCard.remove')}
              tone="danger"
              onClick={() => run(onRemove)}
            />
          </Popover>
        </>
      )}
    </>
  );
});
