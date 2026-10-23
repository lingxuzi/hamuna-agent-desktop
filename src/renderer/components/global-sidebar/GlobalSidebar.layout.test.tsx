import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
// The workspace tree pulls in the config/workspace-action hooks; this file
// only asserts the toggle's own geometry.
vi.mock('./SidebarWorkspaceTree', () => ({
  SidebarWorkspaceTree: () => <div data-testid="workspace-tree" />,
}));

import { i18n } from '@/i18n';
import {
  GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET,
  GLOBAL_SIDEBAR_TOGGLE_INSET,
} from '@/utils/globalSidebarPreference';
import GlobalSidebar from './GlobalSidebar';

function renderSidebar() {
  return render(
    <GlobalSidebar
      expanded
      width={256}
      onToggleExpanded={() => {}}
      onCommitWidth={() => {}}
      projects={[]}
      isProjectsLoading={false}
      selectedWorkspaceId={null}
      onSelectWorkspace={() => {}}
      onNewChat={() => {}}
      activeView={null}
      notificationCount={0}
    />,
  );
}

function toggleLeft(container: HTMLElement): number {
  const button = container.querySelector('[data-no-drag]');
  const slot = button?.closest('div[style]') as HTMLElement | null;
  return Number.parseInt(slot?.style.left ?? '', 10);
}

describe('GlobalSidebar — 收起/展开按钮位置', () => {
  let userAgentSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    userAgentSpy = vi.spyOn(navigator, 'userAgent', 'get');
  });

  afterEach(() => {
    userAgentSpy.mockRestore();
  });

  it('避开 macOS 红绿灯，落在让位坐标上', () => {
    userAgentSpy.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const { container } = renderSidebar();
    expect(toggleLeft(container)).toBe(GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET);
  });

  it('非 macOS 落在侧栏内的导航图标轴上', () => {
    userAgentSpy.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    const { container } = renderSidebar();
    expect(toggleLeft(container)).toBe(GLOBAL_SIDEBAR_TOGGLE_INSET);
  });

  it('两态用同一个图标，收起时不换形状', () => {
    userAgentSpy.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    const { container, rerender } = renderSidebar();
    const glyph = () => container.querySelector('[data-no-drag] svg');
    const before = glyph()?.innerHTML;
    expect(before).toBeTruthy();

    rerender(
      <GlobalSidebar
        expanded={false}
        width={256}
        onToggleExpanded={() => {}}
        onCommitWidth={() => {}}
        projects={[]}
        isProjectsLoading={false}
        selectedWorkspaceId={null}
        onSelectWorkspace={() => {}}
        onNewChat={() => {}}
        activeView={null}
        notificationCount={0}
      />,
    );
    expect(glyph()?.innerHTML).toBe(before);
  });

  it('两态都保留同一个可访问名称入口', () => {
    userAgentSpy.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    renderSidebar();
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeTruthy();
  });
});

describe('GlobalSidebar — 设置入口在 footer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('设置按钮在 footer 里，且不在 nav 列表中', () => {
    const { container } = renderSidebar();
    const settings = screen.getByRole('button', { name: '设置' });

    const nav = container.querySelector('nav');
    expect(nav?.contains(settings)).toBe(false);

    const footer = container.querySelector('.global-sidebar-footer-action');
    expect(footer?.contains(settings)).toBe(true);
  });
});
