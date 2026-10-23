import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessions: [] as unknown[],
  deleteSession: vi.fn(async () => true),
  setSessionFavorite: vi.fn(async () => true),
}));

vi.mock('@/i18n', async (importOriginal) => importOriginal());
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/hooks/useTaskCenterData', () => ({
  useTaskCenterData: () => ({
    sessions: mocks.sessions,
    sessionTagsMap: new Map(),
    protectedSchedulerSessionIds: new Set(),
    actions: {
      deleteSession: mocks.deleteSession,
      setSessionFavorite: mocks.setSessionFavorite,
    },
  }),
}));
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    touchProject: vi.fn(async () => {}),
    config: {},
    projects: [],
    patchProject: vi.fn(),
    removeProject: vi.fn(),
    refreshConfig: vi.fn(),
  }),
}));
vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    togglePin: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAddWorkspace', () => ({
  useAddWorkspace: () => ({ addWorkspace: vi.fn(), pathDialogProps: null, createFromTemplate: vi.fn() }),
}));
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({ openPathExternal: vi.fn(async () => {}) }),
}));

import { i18n } from '@/i18n';
import type { Project } from '@/config/types';
import { SidebarWorkspaceTree } from './SidebarWorkspaceTree';
import { SIDEBAR_HISTORY_LIMIT } from './sidebarWorkspaceGrouping';

const PROJECT: Project = {
  id: 'p1',
  name: 'hamuna',
  displayName: 'HamunaAgent',
  path: '/Users/me/projects/hamuna',
  providerId: null,
  permissionMode: null,
} as Project;

function session(index: number) {
  return {
    id: `s${index}`,
    agentDir: PROJECT.path,
    title: `session-${index}`,
    lastActiveAt: `2026-01-${String(28 - index).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function renderTree(selectedWorkspaceId: string | null = null) {
  const onSelectWorkspace = vi.fn();
  render(
    <SidebarWorkspaceTree
      projects={[PROJECT]}
      isLoading={false}
      selectedWorkspaceId={selectedWorkspaceId}
      onSelectWorkspace={onSelectWorkspace}
    />,
  );
  return { onSelectWorkspace };
}

describe('SidebarWorkspaceTree', () => {
  beforeEach(async () => {
    mocks.sessions = [];
    await i18n.changeLanguage('zh-CN');
  });

  it('keeps the selected workspace open by default and folds the rest', () => {
    mocks.sessions = [session(1)];
    renderTree(PROJECT.id);
    expect(screen.getByText('session-1')).toBeTruthy();
  });

  it('starts collapsed when no workspace is selected', () => {
    mocks.sessions = [session(1)];
    renderTree(null);
    expect(screen.queryByText('session-1')).toBeNull();
  });

  it('one click both selects the workspace and toggles its history', () => {
    mocks.sessions = [session(1)];
    const { onSelectWorkspace } = renderTree(null);

    fireEvent.click(screen.getByRole('button', { name: /HamunaAgent/ }));
    expect(onSelectWorkspace).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByText('session-1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /HamunaAgent/ }));
    expect(screen.queryByText('session-1')).toBeNull();
  });

  it('caps history at the limit and reveals the rest on demand', () => {
    mocks.sessions = Array.from({ length: SIDEBAR_HISTORY_LIMIT + 2 }, (_, i) => session(i));
    renderTree(PROJECT.id);

    expect(screen.queryByText(`session-${SIDEBAR_HISTORY_LIMIT}`)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /显示全部/ }));
    expect(screen.getByText(`session-${SIDEBAR_HISTORY_LIMIT}`)).toBeTruthy();
  });

  it('shows an empty-history hint for a workspace with no sessions', () => {
    renderTree(PROJECT.id);
    expect(screen.getByText('暂无历史对话')).toBeTruthy();
  });
});
