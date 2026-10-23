import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/Toast';
import { useConfig } from '@/hooks/useConfig';
import {
  disableAgentAndStopChannels,
  enableAgentAndStartChannels,
  getAgentById,
} from '@/config/services/agentConfigService';
import { archiveProject, unarchiveProject } from '@/config/services/projectService';
import { isProjectArchived, type Project } from '@/config/types';

/** Pin / archive / remove for a workspace. Moved out of the Launcher right
 *  rail when the global sidebar took over workspace management. */
export function useWorkspaceActions() {
  const { t } = useTranslation('launcher');
  const toast = useToast();
  const { config, projects, patchProject, removeProject, refreshConfig } = useConfig();
  const pinInFlightRef = useRef(new Set<string>());
  const archiveInFlightRef = useRef(new Set<string>());

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

  const remove = useCallback(async (project: Project) => {
    await removeProject(project.id);
  }, [removeProject]);

  return { togglePin, archive, unarchive, remove };
}
