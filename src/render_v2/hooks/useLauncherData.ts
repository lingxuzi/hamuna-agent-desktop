/**
 * useLauncherData — data feed for the v2 Launcher page (qjQtx design).
 *
 * Reuses the same stores v1 Launcher consumes — useConfig for workspaces,
 * useTaskCenterData for recent sessions — and projects them onto the shapes
 * the qjQtx layout needs. No new fetch; ownership stays in the shared stores.
 */
import { useMemo } from 'react';

import { useConfig } from '@/hooks/useConfig';
import { useTaskCenterData } from '@/hooks/useTaskCenterData';
import type { SessionMetadata } from '@/api/sessionClient';
import { sortSessionsByLastActive } from '@/hooks/taskCenterStore';
import {
    isProjectActiveForUser,
    isProjectVisibleToUser,
    type Project,
} from '@/config/types';

/** Subset of SessionMetadata the v2 Recent row renders. */
export interface V2RecentSession {
    id: string;
    title: string;
    lastActiveAt: string;
    providerId?: string;
}

function toV2Recent(s: SessionMetadata): V2RecentSession {
    return {
        id: s.id,
        title: s.title || s.id.slice(0, 8),
        lastActiveAt: s.lastActiveAt,
        providerId: s.providerId,
    };
}

export interface V2LauncherData {
    workspaces: Project[];
    recentSessions: V2RecentSession[];
    isLoading: boolean;
}

export function useLauncherData(): V2LauncherData {
    const { projects, isLoading } = useConfig();
    const task = useTaskCenterData({ isActive: true });

    const workspaces = useMemo(
        () => projects.filter(isProjectVisibleToUser).filter(isProjectActiveForUser),
        [projects],
    );

    const recentSessions = useMemo(() => {
        if (task.isSessionsLoading && task.sessions.length === 0) return [];
        return sortSessionsByLastActive(task.sessions)
            .slice(0, 3)
            .map(toV2Recent);
    }, [task.sessions, task.isSessionsLoading]);

    return { workspaces, recentSessions, isLoading };
}
