import { createContext, useContext } from 'react';
import type { Project } from '@/config/types';
import { workspacePathsEqual } from '../../shared/workspacePath';

export interface WorkspaceSelection {
  workspace: Project | null;
  selectWorkspace: (project: Project) => void;
}

const WorkspaceSelectionContext = createContext<WorkspaceSelection | null>(null);

export const WorkspaceSelectionProvider = WorkspaceSelectionContext.Provider;

export function useWorkspaceSelection(): WorkspaceSelection {
  const value = useContext(WorkspaceSelectionContext);
  if (!value) throw new Error('useWorkspaceSelection must be used within WorkspaceSelectionProvider');
  return value;
}

/** Fallback chain: configured default → mino project → first visible project. */
export function resolveDefaultWorkspace(
  projects: readonly Project[],
  defaultWorkspacePath?: string,
): Project | null {
  if (defaultWorkspacePath) {
    const def = projects.find(p => workspacePathsEqual(p.path, defaultWorkspacePath));
    if (def) return def;
  }
  const mino = projects.find(p => p.path.replace(/\\/g, '/').endsWith('/mino'));
  return mino ?? projects[0] ?? null;
}
