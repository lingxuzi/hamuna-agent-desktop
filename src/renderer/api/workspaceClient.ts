// Workspace API — thin wrapper around the Rust workspace-deletion command.
//
// The command is a CASCADE (tasks → goals → conversations → files → browser
// profile → search index), so its result is a report, not a boolean: it says
// what was deleted AND what was left behind. The UI must show the leftovers —
// "deleted everything" that silently skipped half the conversations is worse
// than an honest partial delete.

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Something that could not be deleted, and why. */
export interface WorkspaceSkippedItem {
  id: string;
  reason: string;
}

export interface WorkspaceDeleteReport {
  deletedSessions: string[];
  skippedSessions: WorkspaceSkippedItem[];
  deletedTasks: string[];
  skippedTasks: WorkspaceSkippedItem[];
  cancelledGoals: string[];
  /** Whether the directory is gone from its original place (trashed, or already absent). */
  diskDeleted: boolean;
  diskPath: string;
  profileDeleted: boolean;
  errors: string[];
}

/**
 * Delete a workspace and everything that belongs to it.
 *
 * Files go to the system trash (recoverable), conversations are deleted for
 * good. `workspacePath` is the workspace's own path — the Rust side matches
 * sessions by that key.
 */
export async function deleteWorkspaceCascade(
  workspacePath: string,
): Promise<WorkspaceDeleteReport> {
  if (!isTauri()) {
    throw new Error(
      `Workspace deletion requires Tauri runtime; ran in browser mode: cmd_delete_workspace`,
    );
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<WorkspaceDeleteReport>('cmd_delete_workspace', { workspacePath });
}
