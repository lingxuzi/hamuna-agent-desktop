import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react';
import { Archive, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ConfirmDialog from '@/components/ConfirmDialog';
import PathInputDialog from '@/components/PathInputDialog';
import SessionStatsModal from '@/components/SessionStatsModal';
import { useToast } from '@/components/Toast';
import AddWorkspaceMenu from '@/components/launcher/AddWorkspaceMenu';
import { LauncherHistoryRow } from '@/components/launcher/LauncherHistoryRow';
import TemplateLibraryDialog from '@/components/launcher/TemplateLibraryDialog';
import { sortLauncherProjects } from '@/components/launcher/workspaceSort';
import type { SessionMetadata } from '@/api/sessionClient';
import {
  isProjectActiveForUser,
  isProjectArchived,
  isSystemPresetProject,
  type Project,
} from '@/config/types';
import { useAddWorkspace } from '@/hooks/useAddWorkspace';
import { useConfig } from '@/hooks/useConfig';
import { useTaskCenterData, type SessionTag } from '@/hooks/useTaskCenterData';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { getSessionDisplayText } from '@/utils/taskCenterUtils';
import { CUSTOM_EVENTS } from '../../../shared/constants';
import { SidebarWorkspaceRow } from './SidebarWorkspaceRow';
import { groupSessionsByProject, SIDEBAR_HISTORY_LIMIT } from './sidebarWorkspaceGrouping';

const WorkspaceConfigPanel = lazy(() => import('@/components/WorkspaceConfigPanel'));

const EMPTY_SESSION_TAGS: SessionTag[] = [];
const EMPTY_SESSIONS: SessionMetadata[] = [];
const EMPTY_OVERRIDES: ReadonlyMap<string, boolean> = new Map();
const EMPTY_EXPANDED_HISTORY: ReadonlySet<string> = new Set();

interface SidebarWorkspaceTreeProps {
  projects: Project[];
  isLoading: boolean;
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (project: Project) => void;
  sessionNotificationBadgeCounts?: ReadonlyMap<string, number>;
}

/**
 * Expanded-mode workspace section: each workspace is a collapsible node with
 * its own recent history nested underneath, so browsing sessions never requires
 * matching two parallel lists by name.
 *
 * Expansion is derived, not stored: a workspace is open when the user toggled
 * it, otherwise when it is the selected one. Selecting another workspace
 * therefore folds the previous one without an effect chasing the selection.
 */
export const SidebarWorkspaceTree = memo(function SidebarWorkspaceTree({
  projects,
  isLoading,
  selectedWorkspaceId,
  onSelectWorkspace,
  sessionNotificationBadgeCounts,
}: SidebarWorkspaceTreeProps) {
  const { t } = useTranslation('launcher');
  const toast = useToast();
  const { touchProject } = useConfig();
  const taskCenterData = useTaskCenterData({ isActive: true });
  const { addWorkspace, pathDialogProps, createFromTemplate } = useAddWorkspace();
  const actions = useWorkspaceActions();
  const { openPathExternal } = useWorkspaceFileService(null);

  const [showArchived, setShowArchived] = useState(false);
  const [expandedOverrides, setExpandedOverrides] = useState(EMPTY_OVERRIDES);
  const [fullyExpanded, setFullyExpanded] = useState(EMPTY_EXPANDED_HISTORY);
  const [agentOverlay, setAgentOverlay] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Project | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [statsSession, setStatsSession] = useState<{ id: string; title: string } | null>(null);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);

  const active = useMemo(() => sortLauncherProjects(projects.filter(isProjectActiveForUser)), [projects]);
  const archived = useMemo(() => sortLauncherProjects(projects.filter(isProjectArchived)), [projects]);
  const sessionsByProject = useMemo(
    () => groupSessionsByProject(taskCenterData.sessions, active),
    [taskCenterData.sessions, active],
  );

  const isExpanded = useCallback(
    (projectId: string) => expandedOverrides.get(projectId) ?? projectId === selectedWorkspaceId,
    [expandedOverrides, selectedWorkspaceId],
  );

  // One click both selects and toggles: the row *is* the disclosure, so there is
  // no separate chevron hit target to miss.
  const handleActivate = useCallback((project: Project) => {
    const expanded = expandedOverrides.get(project.id) ?? project.id === selectedWorkspaceId;
    onSelectWorkspace(project);
    setExpandedOverrides((current) => {
      const next = new Map(current);
      next.set(project.id, !expanded);
      return next;
    });
  }, [expandedOverrides, onSelectWorkspace, selectedWorkspaceId]);

  const handleOpenSession = useCallback((session: SessionMetadata, project: Project) => {
    touchProject(project.id).catch(() => {});
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_SESSION_IN_NEW_TAB, {
      detail: { sessionId: session.id, workspacePath: project.path },
    }));
  }, [touchProject]);

  const handleToggleFavorite = useCallback(async (session: SessionMetadata) => {
    const ok = await taskCenterData.actions.setSessionFavorite(session.id, !session.favorite);
    if (!ok) toast.error(t('rightRail.favoriteFailedRetry'));
  }, [taskCenterData.actions, t, toast]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    const ok = await taskCenterData.actions.deleteSession(id);
    if (ok) toast.success(t('rightRail.deleted'));
    else toast.error(t('rightRail.deleteFailedRetry'));
  }, [pendingDelete, taskCenterData.actions, t, toast]);

  const handleMenuOpenChange = useCallback((sessionId: string, open: boolean) => {
    setOpenMenuSessionId(current => (open ? sessionId : current === sessionId ? null : current));
  }, []);

  const handleOpenFolder = useCallback((project: Project) => {
    openPathExternal({ fullPath: project.path, workspace: null }).catch(err => {
      console.error('[GlobalSidebar] Failed to open project folder:', err);
    });
  }, [openPathExternal]);

  const handleConfirmRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const project = pendingRemove;
    setPendingRemove(null);
    await actions.remove(project);
  }, [actions, pendingRemove]);

  const toggleShowAll = useCallback((projectId: string) => {
    setFullyExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const rowProps = {
    onSelect: handleActivate,
    onTogglePin: actions.togglePin,
    onArchive: actions.archive,
    onUnarchive: actions.unarchive,
    onAgentSettings: (p: Project) => setAgentOverlay(p.path),
    onOpenFolder: handleOpenFolder,
    onRemove: (p: Project) => setPendingRemove(p),
  };

  const renderHistory = (project: Project) => {
    const sessions = sessionsByProject.get(project.id) ?? EMPTY_SESSIONS;
    if (sessions.length === 0) {
      return <p className="px-2 py-1.5 text-xs text-[var(--ink-muted)]/70">{t('rightRail.emptyHistory')}</p>;
    }
    const showAll = fullyExpanded.has(project.id);
    const visible = showAll ? sessions : sessions.slice(0, SIDEBAR_HISTORY_LIMIT);
    return (
      <>
        {visible.map(session => (
          <LauncherHistoryRow
            key={session.id}
            session={session}
            project={project}
            tags={taskCenterData.sessionTagsMap.get(session.id) ?? EMPTY_SESSION_TAGS}
            unreadNotificationCount={sessionNotificationBadgeCounts?.get(session.id) ?? 0}
            isCronProtected={taskCenterData.protectedSchedulerSessionIds.has(session.id)}
            onOpen={handleOpenSession}
            onToggleFavorite={handleToggleFavorite}
            onShowStats={s => setStatsSession({ id: s.id, title: getSessionDisplayText(s) })}
            onRequestDelete={s => setPendingDelete({ id: s.id, title: getSessionDisplayText(s) })}
            menuOpen={openMenuSessionId === session.id}
            onMenuOpenChange={handleMenuOpenChange}
            compact
          />
        ))}
        {sessions.length > SIDEBAR_HISTORY_LIMIT && (
          <button
            type="button"
            onClick={() => toggleShowAll(project.id)}
            className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showAll ? 'rotate-90' : ''}`} />
            {showAll
              ? t('globalSidebar.collapseHistory')
              : t('globalSidebar.showAllHistory', { count: sessions.length })}
          </button>
        )}
      </>
    );
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-4 pb-1">
        <h2 className="text-xs font-semibold tracking-[0.04em] text-[var(--ink-muted)]">
          {t('rightRail.workspaceTitle')}
        </h2>
        <AddWorkspaceMenu
          compact
          onAddFolder={addWorkspace}
          onCreateFromTemplate={() => setShowTemplates(true)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--ink-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('rightRail.loading')}
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-col gap-1 px-2 py-3">
            <p className="text-sm text-[var(--ink-muted)]">{t('rightRail.emptyWorkspaceTitle')}</p>
            <button
              type="button"
              onClick={addWorkspace}
              className="flex w-full items-center gap-2 rounded-md py-1 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              {t('rightRail.addFolder')}
            </button>
          </div>
        ) : (
          active.map(project => {
            const expanded = isExpanded(project.id);
            return (
              <div key={project.id} className="mb-0.5">
                <SidebarWorkspaceRow
                  project={project}
                  selected={project.id === selectedWorkspaceId}
                  expanded={expanded}
                  {...rowProps}
                />
                {expanded && (
                  <div className="ml-3 border-l border-[var(--line)] pl-1">{renderHistory(project)}</div>
                )}
              </div>
            );
          })
        )}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived(v => !v)}
              className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{t('workspaceCard.showArchived')}</span>
              <span>{archived.length}</span>
            </button>
            {showArchived && archived.map(project => (
              <SidebarWorkspaceRow
                key={project.id}
                project={project}
                selected={false}
                expanded={false}
                {...rowProps}
              />
            ))}
          </>
        )}
      </div>

      {pathDialogProps && <PathInputDialog {...pathDialogProps} />}

      {showTemplates && (
        <TemplateLibraryDialog
          onCreateWorkspace={createFromTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={isSystemPresetProject(pendingRemove) ? t('dialogs.hideDefaultWorkspace') : t('dialogs.removeWorkspace')}
          message={isSystemPresetProject(pendingRemove)
            ? t('dialogs.hideWorkspaceMessage', { name: pendingRemove.displayName || pendingRemove.name })
            : t('dialogs.removeWorkspaceMessage', { name: pendingRemove.name })}
          confirmText={isSystemPresetProject(pendingRemove) ? t('dialogs.hide') : t('dialogs.remove')}
          confirmVariant="danger"
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('rightRail.deleteDialogTitle')}
          message={t('rightRail.deleteDialogMessage', { title: pendingDelete.title })}
          confirmText={t('rightRail.delete')}
          confirmVariant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {statsSession && (
        <SessionStatsModal
          sessionId={statsSession.id}
          sessionTitle={statsSession.title}
          onClose={() => setStatsSession(null)}
        />
      )}

      {agentOverlay && (
        <Suspense fallback={null}>
          <WorkspaceConfigPanel
            agentDir={agentOverlay}
            onClose={() => setAgentOverlay(null)}
            initialTab="agent"
          />
        </Suspense>
      )}
    </>
  );
});
