import { memo, useMemo } from 'react';
import {
  Bell,
  CheckSquare,
  MessageSquarePlus,
  PanelLeft,
  Settings,
  Sparkles,
  Store,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Tip from '@/components/Tip';
import WorkspaceIcon from '@/components/launcher/WorkspaceIcon';
import { sortLauncherProjects } from '@/components/launcher/workspaceSort';
import type { Project } from '@/config/types';
import { isProjectActiveForUser } from '@/config/types';
import { CUSTOM_EVENTS } from '../../../shared/constants';
import { getFolderName } from '@/types/tab';
import { isMacPlatform } from '@/utils/hamunaProtocol';
import {
  GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET,
  GLOBAL_SIDEBAR_RAIL_WIDTH,
  GLOBAL_SIDEBAR_TOGGLE_INSET,
} from '@/utils/globalSidebarPreference';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarWorkspaceTree } from './SidebarWorkspaceTree';

interface GlobalSidebarProps {
  expanded: boolean;
  width: number;
  onToggleExpanded: () => void;
  onCommitWidth: (width: number) => void;
  projects: Project[];
  isProjectsLoading: boolean;
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (project: Project) => void;
  onNewChat: () => void;
  activeView: string | null;
  notificationCount: number;
  sessionNotificationBadgeCounts?: ReadonlyMap<string, number>;
}

export default memo(function GlobalSidebar({
  expanded,
  width,
  onToggleExpanded,
  onCommitWidth,
  projects,
  isProjectsLoading,
  selectedWorkspaceId,
  onSelectWorkspace,
  onNewChat,
  activeView,
  notificationCount,
  sessionNotificationBadgeCounts,
}: GlobalSidebarProps) {
  const { t } = useTranslation('launcher');
  const toggleInset = isMacPlatform() ? GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET : GLOBAL_SIDEBAR_TOGGLE_INSET;
  const activeProjects = useMemo(
    () => sortLauncherProjects(projects.filter(isProjectActiveForUser)),
    [projects],
  );

  const navItems = [
    { key: 'newChat', icon: MessageSquarePlus, label: t('globalSidebar.newChat'), onClick: onNewChat, active: false },
    { key: 'taskCenter', icon: CheckSquare, label: t('globalSidebar.taskCenter'), onClick: () => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CENTER)), active: activeView === 'taskcenter' },
    { key: 'marketplace', icon: Store, label: t('globalSidebar.marketplace'), onClick: () => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_MARKETPLACE)), active: activeView === 'marketplace' },
    { key: 'miniapps', icon: Sparkles, label: t('globalSidebar.miniappCenter'), onClick: () => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_MINIAPP_CENTER)), active: activeView === 'miniapp-center' },
  ];

  return (
    <aside
      data-global-sidebar-mode={expanded ? 'expanded' : 'rail'}
      className="global-sidebar relative z-[60] flex h-screen shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper)]"
      style={{ width: expanded ? 'var(--global-sidebar-width)' : GLOBAL_SIDEBAR_RAIL_WIDTH }}
    >
      {/* One toggle at one window-x in both modes, so collapse never reads as a
          layout jump. Only macOS clears the native traffic lights (which float
          over the webview); that pushes the control out of the 64px rail and
          onto the titlebar surface, and CustomTitleBar reserves the matching
          inset to keep the first Tab clear. Elsewhere the toggle stays on the
          nav icon axis inside the rail. */}
      <div className="relative h-11 shrink-0" data-tauri-drag-region>
        <div className="absolute top-1.5" style={{ left: toggleInset }}>
          <Tip label={expanded ? t('globalSidebar.collapse') : t('globalSidebar.expand')} position="bottom">
            <button
              type="button"
              onClick={onToggleExpanded}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
              aria-label={expanded ? t('globalSidebar.collapse') : t('globalSidebar.expand')}
              data-no-drag
            >
              {/* One glyph for both states: swapping icons made the control
                  change shape on every collapse. */}
              <PanelLeft className="h-4 w-4" />
            </button>
          </Tip>
        </div>
      </div>

      {/* Nav stays mounted in both modes: rows keep the same glyph x, only the
          label fades and clips as the width animates. Remounting icon rows per
          mode made collapse blink. */}
      <nav className="flex shrink-0 flex-col gap-0.5 px-3">
        {navItems.map(item => (
          <Tip key={item.key} label={item.label} position="bottom" disabled={expanded} className="w-full">
            <button
              type="button"
              onClick={item.onClick}
              aria-label={item.label}
              className={`flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-3 text-sm transition-colors ${
                item.active
                  ? 'bg-[var(--paper-inset)] font-medium text-[var(--ink)]'
                  : 'text-[var(--ink-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]'
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="global-sidebar-label min-w-0 truncate">{item.label}</span>
            </button>
          </Tip>
        ))}
      </nav>

      {/* Both bodies share one grid cell and cross-fade, so neither the tree
          nor the rail blinks to an empty box mid-animation. The tree keeps its
          mounted state (expanded rows, scroll) across a collapse. */}
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-hidden">
        <div
          className="col-start-1 row-start-1 flex min-h-0 flex-col transition-opacity duration-150"
          aria-hidden={!expanded}
          inert={!expanded}
          style={{ opacity: expanded ? 1 : 0 }}
        >
          <SidebarWorkspaceTree
            projects={projects}
            isLoading={isProjectsLoading}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
            sessionNotificationBadgeCounts={sessionNotificationBadgeCounts}
          />
        </div>
        <div
          className="col-start-1 row-start-1 min-h-0 overflow-y-auto px-3 transition-opacity duration-150"
          aria-hidden={expanded}
          inert={expanded}
          style={{ opacity: expanded ? 0 : 1 }}
        >
          {activeProjects.map(project => {
            const selected = project.id === selectedWorkspaceId;
            const label = project.displayName || getFolderName(project.path);
            return (
              <Tip key={project.id} label={label} position="bottom" className="w-full">
                <button
                  type="button"
                  onClick={() => onSelectWorkspace(project)}
                  className={`mb-1 flex h-8 w-full items-center justify-start rounded-md px-3 transition-colors ${
                    selected ? 'bg-[var(--paper-inset)]' : 'hover:bg-[var(--hover-bg)]'
                  }`}
                  aria-label={label}
                >
                  <WorkspaceIcon icon={project.icon} size={16} />
                </button>
              </Tip>
            );
          })}
        </div>
      </div>

      {/* Settings leads the footer from the left, the bell stays right-anchored
          so it rides the moving border instead of teleporting between center
          and end. The 64px rail cannot hold both 32px buttons side by side on
          the icon axis, so rail mode stacks them and centers each on that
          axis — the same treatment the nav rows get. */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--line)] px-2 py-2">
        <div className="global-sidebar-footer-action flex w-full items-center">
          <Tip label={t('globalSidebar.settings')} position="bottom" disabled={expanded}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_SETTINGS))}
              className="flex h-8 items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
              aria-label={t('globalSidebar.settings')}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="global-sidebar-label min-w-0 truncate">{t('globalSidebar.settings')}</span>
            </button>
          </Tip>
        </div>
        <div className="global-sidebar-footer-bell flex w-full items-center justify-end">
          <Tip label={t('globalSidebar.notifications')}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CENTER))}
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
              aria-label={t('globalSidebar.notifications')}
            >
              <Bell className="h-4 w-4" />
              {notificationCount > 0 && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              )}
            </button>
          </Tip>
        </div>
      </div>

      <SidebarResizeHandle expanded={expanded} width={width} onCommit={onCommitWidth} />
    </aside>
  );
});
