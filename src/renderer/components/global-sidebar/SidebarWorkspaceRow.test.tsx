import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { Project } from '@/config/types';
import { SidebarWorkspaceRow } from './SidebarWorkspaceRow';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'hamuna',
    displayName: 'HamunaAgent',
    path: '/Users/me/projects/hamuna',
    providerId: null,
    permissionMode: null,
    ...overrides,
  } as Project;
}

function renderRow(over: Partial<Project> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onAgentSettings: vi.fn(),
    onOpenFolder: vi.fn(),
    onRemove: vi.fn(),
  };
  render(
    <SidebarWorkspaceRow
      project={project(over)}
      selected={false}
      expanded={false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('SidebarWorkspaceRow', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('selects the workspace instead of launching it', () => {
    const handlers = renderRow();
    fireEvent.click(screen.getByRole('button', { name: /HamunaAgent/ }));
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it('opens the row menu from the more button without selecting', () => {
    const handlers = renderRow();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('置顶')).toBeTruthy();
    fireEvent.click(screen.getByText('归档'));
    expect(handlers.onArchive).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('offers unarchive (and no pin) for archived workspaces', () => {
    renderRow({ archivedAt: '2026-01-01T00:00:00.000Z' });
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByText('置顶')).toBeNull();
    expect(screen.queryByText('取消置顶')).toBeNull();
    expect(screen.getByText('取消归档')).toBeTruthy();
  });

  it('does not select an archived workspace — archived is not launchable', () => {
    const handlers = renderRow({ archivedAt: '2026-01-01T00:00:00.000Z' });
    fireEvent.click(screen.getByRole('button', { name: /HamunaAgent/ }));
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });
});
