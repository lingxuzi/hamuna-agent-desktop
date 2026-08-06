/**
 * NavCluster — the 4 global nav entries in the v2 chrome (Home/Tasks/Team/
 * Settings). Verifies the label resolution, the active-state highlight
 * (aria-current) and the navigation callback. No theme dependency — pure i18n
 * + props, so this is a fast dom test.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NavCluster from './NavCluster';

describe('NavCluster', () => {
  it('renders all four global nav entries with translated labels', () => {
    render(<NavCluster activeView="launcher" onNavigate={() => {}} />);
    // setup-dom defaults to zh-CN.
    expect(screen.getByRole('button', { name: /启动页/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /任务中心/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /团队/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
  });

  it('marks the active view with aria-current=page', () => {
    render(<NavCluster activeView="settings" onNavigate={() => {}} />);
    const settings = screen.getByRole('button', { name: /设置/ });
    expect(settings).toHaveAttribute('aria-current', 'page');
  });

  it('fires onNavigate with the clicked view', () => {
    const onNavigate = vi.fn();
    render(<NavCluster activeView="launcher" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /任务/ }));
    expect(onNavigate).toHaveBeenCalledWith('taskcenter');
  });
});
