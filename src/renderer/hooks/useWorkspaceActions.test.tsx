import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '@/config/types';
import { CUSTOM_EVENTS } from '../../shared/constants';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  removeProject: vi.fn(async () => {}),
  refreshConfig: vi.fn(async () => {}),
  patchProject: vi.fn(async () => {}),
  disableAgentAndStopChannels: vi.fn(async () => 1),
  removeAgentConfig: vi.fn(async () => {}),
  deleteWorkspaceCascade: vi.fn(),
  translations: [] as { key: string; params?: Record<string, unknown> }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      mocks.translations.push({ key, params });
      return key;
    },
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
    info: vi.fn(),
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    config: { agents: [{ id: 'agent-1' }] },
    projects: [PROJECT],
    patchProject: mocks.patchProject,
    removeProject: mocks.removeProject,
    refreshConfig: mocks.refreshConfig,
  }),
}));

vi.mock('@/config/services/agentConfigService', () => ({
  disableAgentAndStopChannels: mocks.disableAgentAndStopChannels,
  removeAgentConfig: mocks.removeAgentConfig,
  getAgentById: (config: { agents?: { id: string }[] }, agentId: string) =>
    config.agents?.find(agent => agent.id === agentId),
}));

vi.mock('@/config/services/projectService', () => ({
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
}));

vi.mock('@/api/workspaceClient', () => ({
  deleteWorkspaceCascade: mocks.deleteWorkspaceCascade,
}));

import { useWorkspaceActions } from './useWorkspaceActions';

const PROJECT: Project = {
  id: 'p1',
  name: 'sino',
  displayName: 'Sino',
  path: '/Users/me/projects/sino',
  agentId: 'agent-1',
  providerId: null,
  permissionMode: null,
} as Project;

const SYSTEM_PRESET: Project = {
  ...PROJECT,
  id: 'p2',
  name: 'mino',
  displayName: 'Mino',
  agentId: undefined,
  workspaceType: 'system-preset',
  systemPresetId: 'mino',
} as Project;

function emptyReport() {
  return {
    deletedSessions: [],
    skippedSessions: [],
    deletedTasks: [],
    skippedTasks: [],
    cancelledGoals: [],
    diskDeleted: true,
    diskPath: PROJECT.path,
    profileDeleted: true,
    errors: [],
  };
}

describe('useWorkspaceActions.remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.translations = [];
    mocks.removeProject.mockImplementation(async () => {
      mocks.calls.push('removeProject');
    });
    mocks.refreshConfig.mockImplementation(async () => {
      mocks.calls.push('refreshConfig');
    });
    mocks.disableAgentAndStopChannels.mockImplementation(async () => {
      mocks.calls.push('stopChannels');
      return 1;
    });
    mocks.removeAgentConfig.mockImplementation(async () => {
      mocks.calls.push('removeAgentConfig');
    });
    mocks.deleteWorkspaceCascade.mockImplementation(async () => {
      mocks.calls.push('cascade');
      return emptyReport();
    });
  });

  it('stops the IM channels, closes the tabs, cascades and only then drops the project', async () => {
    const closedWorkspaces: string[] = [];
    const listener = (event: Event) => {
      closedWorkspaces.push((event as CustomEvent<{ workspacePath?: string }>).detail?.workspacePath ?? '');
    };
    window.addEventListener(CUSTOM_EVENTS.CLOSE_TABS_FOR_WORKSPACE, listener);

    const { result } = renderHook(() => useWorkspaceActions());

    await act(async () => {
      await result.current.remove(PROJECT);
    });

    window.removeEventListener(CUSTOM_EVENTS.CLOSE_TABS_FOR_WORKSPACE, listener);

    expect(mocks.calls).toEqual([
      'stopChannels',
      'removeAgentConfig',
      'cascade',
      'removeProject',
      'refreshConfig',
    ]);
    // The tabs of this workspace are closed before the cascade runs, so the
    // Rust side never sees a live Tab owner for these conversations.
    expect(closedWorkspaces).toEqual([PROJECT.path]);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('reports what it could not delete instead of claiming a clean sweep', async () => {
    mocks.deleteWorkspaceCascade.mockImplementation(async () => ({
      ...emptyReport(),
      deletedSessions: ['s1', 's2'],
      skippedSessions: [{ id: 's3', reason: 'still in use by an IM channel' }],
    }));

    const { result } = renderHook(() => useWorkspaceActions());

    await act(async () => {
      await result.current.remove(PROJECT);
    });

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.translations).toContainEqual({
      key: 'toasts.workspaceDeletedPartial',
      params: { name: 'Sino', sessions: 2, leftovers: 1 },
    });
  });

  it('says so when the saved logins could not be deleted', async () => {
    // macOS 的浏览器存储被活着的 webview 占着时删不掉。那份登录态还在本机，
    // 而且在同一路径重建工作区会被继承 —— 混在「N 项未清理」里等于没报告。
    mocks.deleteWorkspaceCascade.mockImplementation(async () => ({
      ...emptyReport(),
      profileDeleted: false,
      errors: ['failed to delete browser profile store abc: data store is in use'],
    }));

    const { result } = renderHook(() => useWorkspaceActions());

    await act(async () => {
      await result.current.remove(PROJECT);
    });

    expect(mocks.translations).toContainEqual({
      key: 'toasts.workspaceDeletedLoginKept',
      params: { name: 'Sino', sessions: 0 },
    });
    // 登录态没删掉 = 不算删干净，不能报成功。
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('tells the user the path is refused instead of asking them to retry', async () => {
    mocks.deleteWorkspaceCascade.mockImplementation(async () => {
      throw new Error('workspace_guarded: /Users/me contains ~/.hamuna');
    });

    const { result } = renderHook(() => useWorkspaceActions());

    await act(async () => {
      await result.current.remove(PROJECT);
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith('toasts.workspaceDeleteGuarded');
    // The workspace stays in the list — nothing was deleted.
    expect(mocks.removeProject).not.toHaveBeenCalled();
  });

  it('only hides a system preset workspace — no cascade, no files touched', async () => {
    const { result } = renderHook(() => useWorkspaceActions());

    await act(async () => {
      await result.current.remove(SYSTEM_PRESET);
    });

    expect(mocks.deleteWorkspaceCascade).not.toHaveBeenCalled();
    expect(mocks.disableAgentAndStopChannels).not.toHaveBeenCalled();
    expect(mocks.removeProject).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
