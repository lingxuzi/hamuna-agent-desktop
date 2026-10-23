import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { useToast } from '@/components/Toast';
import { useConfig } from '@/hooks/useConfig';
import { isBrowserDevMode, pickFolderForDialog } from '@/utils/browserMock';
import { track } from '@/analytics';
import type { WorkspaceTemplate } from '@/config/types';

export interface AddWorkspacePathDialog {
  isOpen: boolean;
  folderName: string;
  defaultPath: string;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

/** Shared "add workspace folder" flow: native picker in Tauri, a path dialog in
 *  browser dev mode. Both the sidebar and Launcher's empty state use this. */
export function useAddWorkspace() {
  const { t } = useTranslation('launcher');
  const toast = useToast();
  const { addProject } = useConfig();
  const [pathDialog, setPathDialog] = useState<{ folderName: string; defaultPath: string } | null>(null);

  const addPath = useCallback(async (path: string) => {
    try {
      await addProject(path);
      const normalizedPath = path.replace(/\\/g, '/');
      const parentDir = normalizedPath.split('/').slice(0, -1).join('/');
      if (parentDir) localStorage.setItem('hamuna:lastProjectDir', parentDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[useAddWorkspace] Failed to add project:', message);
      toast.error(t('toasts.addProjectFailed', { message }));
    }
  }, [addProject, t, toast]);

  const addWorkspace = useCallback(async () => {
    try {
      if (isBrowserDevMode()) {
        const folderInfo = await pickFolderForDialog();
        if (folderInfo) setPathDialog(folderInfo);
        return;
      }
      const selected = await open({ directory: true, multiple: false, title: t('dialogs.pickProjectFolder') });
      if (typeof selected === 'string') await addPath(selected);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[useAddWorkspace] Failed to pick folder:', message);
      toast.error(t('toasts.addProjectFailed', { message }));
    }
  }, [addPath, t, toast]);

  const pathDialogProps: AddWorkspacePathDialog | null = pathDialog && {
    isOpen: true,
    folderName: pathDialog.folderName,
    defaultPath: pathDialog.defaultPath,
    onConfirm: (path: string) => {
      setPathDialog(null);
      void addPath(path);
    },
    onCancel: () => setPathDialog(null),
  };

  const createFromTemplate = useCallback(async (path: string, template: WorkspaceTemplate, displayName?: string) => {
    await addProject(path, {
      icon: template.icon,
      displayName,
      templateId: template.id,
      templateSource: template.isBuiltin ? 'builtin' : 'user',
      agentDefaults: template.isBuiltin ? template.agentDefaults : undefined,
    });
    track('workspace_create', { source: 'template' });
  }, [addProject]);

  return { addWorkspace, pathDialogProps, createFromTemplate };
}
