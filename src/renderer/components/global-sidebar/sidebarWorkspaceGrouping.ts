import type { SessionMetadata } from '@/api/sessionClient';
import type { Project } from '@/config/types';
import { normalizeWorkspacePathIdentity } from '../../../shared/workspacePath';

/** History rows shown per workspace before the "show all" toggle kicks in. */
export const SIDEBAR_HISTORY_LIMIT = 8;

/**
 * Bucket sessions by owning project id. `sessions` is already sorted by
 * lastActiveAt desc globally, so insertion order preserves recency per bucket.
 * Paths go through the shared identity normalizer — raw `\` vs `/` never
 * matches on Windows (#320).
 */
export function groupSessionsByProject(
  sessions: readonly SessionMetadata[],
  projects: readonly Project[],
): Map<string, SessionMetadata[]> {
  const idByPath = new Map<string, string>();
  for (const project of projects) idByPath.set(normalizeWorkspacePathIdentity(project.path), project.id);

  const groups = new Map<string, SessionMetadata[]>();
  for (const session of sessions) {
    const projectId = idByPath.get(normalizeWorkspacePathIdentity(session.agentDir ?? ''));
    if (!projectId) continue;
    const bucket = groups.get(projectId);
    if (bucket) bucket.push(session);
    else groups.set(projectId, [session]);
  }
  return groups;
}
