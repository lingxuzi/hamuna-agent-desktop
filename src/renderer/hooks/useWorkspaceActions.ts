import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/Toast';
import { useConfig } from '@/hooks/useConfig';
import {
  disableAgentAndStopChannels,
  enableAgentAndStartChannels,
  getAgentById,
  removeAgentConfig,
} from '@/config/services/agentConfigService';
import { archiveProject, unarchiveProject } from '@/config/services/projectService';
import {
  isProjectArchived,
  isSystemPresetProject,
  type Project,
} from '@/config/types';
import { deleteWorkspaceCascade } from '@/api/workspaceClient';
import { CUSTOM_EVENTS } from '../../shared/constants';

/** Pin / archive / remove for a workspace. Moved out of the Launcher right
 *  rail when the global sidebar took over workspace management. */
export function useWorkspaceActions() {
  const { t } = useTranslation('launcher');
  const toast = useToast();
  const { config, projects, patchProject, removeProject, refreshConfig } = useConfig();
  const pinInFlightRef = useRef(new Set<string>());
  const archiveInFlightRef = useRef(new Set<string>());
  const removeInFlightRef = useRef(new Set<string>());

  const togglePin = useCallback(async (project: Project) => {
    if (isProjectArchived(project)) return;
    if (pinInFlightRef.current.has(project.id)) return;
    pinInFlightRef.current.add(project.id);
    try {
      const current = projects.find(candidate => candidate.id === project.id) ?? project;
      await patchProject(project.id, {
        pinnedAt: current.pinnedAt ? undefined : new Date().toISOString(),
      });
    } catch (err) {
      console.error('[useWorkspaceActions] failed to toggle workspace pin:', err);
      toast.warning(t('toasts.pinFailed'));
    } finally {
      pinInFlightRef.current.delete(project.id);
    }
  }, [patchProject, projects, t, toast]);

  const archive = useCallback(async (project: Project) => {
    if (archiveInFlightRef.current.has(project.id)) return;
    archiveInFlightRef.current.add(project.id);
    try {
      const current = projects.find(candidate => candidate.id === project.id) ?? project;
      const agent = current.agentId ? getAgentById(config, current.agentId) : undefined;
      const wasProactive = agent?.enabled === true;
      const archived = await archiveProject(current.id, { agentEnabledBeforeArchive: wasProactive });
      if (!archived) throw new Error(`Project ${current.id} not found`);
      if (agent && wasProactive) await disableAgentAndStopChannels(agent);
      await refreshConfig();
      toast.success(t('toasts.workspaceArchived'));
    } catch (err) {
      console.error('[useWorkspaceActions] failed to archive workspace:', err);
      toast.warning(t('toasts.archiveFailed'));
    } finally {
      archiveInFlightRef.current.delete(project.id);
    }
  }, [config, projects, refreshConfig, t, toast]);

  const unarchive = useCallback(async (project: Project) => {
    if (archiveInFlightRef.current.has(project.id)) return;
    archiveInFlightRef.current.add(project.id);
    try {
      const current = projects.find(candidate => candidate.id === project.id) ?? project;
      const shouldRestoreAgent = current.archivedAgentEnabledBeforeArchive === true;
      const unarchived = await unarchiveProject(current.id);
      if (!unarchived) throw new Error(`Project ${current.id} not found`);
      if (shouldRestoreAgent && current.agentId) {
        try {
          await enableAgentAndStartChannels(current.agentId);
        } catch (err) {
          await archiveProject(current.id, {
            archivedAtIso: current.archivedAt,
            agentEnabledBeforeArchive: true,
          });
          throw err;
        }
      }
      await refreshConfig();
      toast.success(t('toasts.workspaceUnarchived'));
    } catch (err) {
      console.error('[useWorkspaceActions] failed to unarchive workspace:', err);
      toast.warning(t('toasts.unarchiveFailed'));
    } finally {
      archiveInFlightRef.current.delete(project.id);
    }
  }, [projects, refreshConfig, t, toast]);

  /**
   * Delete a workspace for good: its conversations, its scheduled tasks, its
   * goals and its files (into the system Trash). Archiving is the soft
   * counterpart — this one is not reversible.
   *
   * The order matters. IM channels hold the conversation's sidecar, so they
   * must be stopped before the cascade runs; the tabs are closed right after
   * so the user doesn't sit on a workspace that is about to disappear.
   */
  const remove = useCallback(async (project: Project) => {
    // System preset workspaces (mino) are only hidden — their registry row is
    // what startup self-healing reads to tell "user hid it" from "registry
    // got corrupted". The service layer hides them; nothing is deleted.
    if (isSystemPresetProject(project)) {
      await removeProject(project.id);
      return;
    }
    if (removeInFlightRef.current.has(project.id)) return;
    removeInFlightRef.current.add(project.id);
    try {
      const current = projects.find(candidate => candidate.id === project.id) ?? project;
      const name = current.displayName || current.name;

      // 1) Stop the Agent's IM channels — a live channel holds the session's
      //    sidecar, and a held session can't be deleted.
      const agent = current.agentId ? getAgentById(config, current.agentId) : undefined;
      if (agent) {
        await disableAgentAndStopChannels(agent);
        await removeAgentConfig(agent.id);
      }

      // 2) Take down the tabs of this workspace. The Rust cascade force-
      //    releases leftover owners, so this doesn't wait for teardown.
      window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CLOSE_TABS_FOR_WORKSPACE, {
        detail: { workspacePath: current.path },
      }));

      // 3) The cascade: tasks → goals → conversations → files → browser
      //    profile → search index.
      const report = await deleteWorkspaceCascade(current.path);

      // 4) Drop it from the list (projects.json only — the disk cleanup above
      //    is what actually removes the files).
      await removeProject(current.id);
      await refreshConfig();

      // 5) Report honestly: what was left behind is named, not swallowed.
      const leftovers =
        report.skippedSessions.length + report.skippedTasks.length + report.errors.length;
      if (!report.profileDeleted) {
        // 登录状态单独说一句：它是「工作区没了、东西还在」里唯一带凭据性质的，
        // 混进「N 项未清理」等于没报告。而且它在同一路径重建工作区时会被继承
        // —— 那是上一个工作区的号，不是新的。
        console.warn('[useWorkspaceActions] workspace logins not deleted:', report.errors);
        toast.warning(t('toasts.workspaceDeletedLoginKept', {
          name,
          sessions: report.deletedSessions.length,
        }));
      }
      if (leftovers > 0) {
        console.warn('[useWorkspaceActions] workspace delete left items behind:', report);
        toast.warning(t('toasts.workspaceDeletedPartial', {
          name,
          sessions: report.deletedSessions.length,
          leftovers,
        }));
      } else if (report.profileDeleted) {
        toast.success(t('toasts.workspaceDeleted', {
          name,
          sessions: report.deletedSessions.length,
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `workspace_guarded` = the path is the App's own data directory (or
      // contains it). Retrying will never work, so don't tell the user to.
      if (message.startsWith('workspace_guarded')) {
        console.warn('[useWorkspaceActions] workspace delete refused:', message);
        toast.warning(t('toasts.workspaceDeleteGuarded'));
      } else {
        console.error('[useWorkspaceActions] failed to delete workspace:', err);
        toast.warning(t('toasts.workspaceDeleteFailed', { message }));
      }
    } finally {
      removeInFlightRef.current.delete(project.id);
    }
  }, [config, projects, refreshConfig, removeProject, t, toast]);

  return { togglePin, archive, unarchive, remove };
}
