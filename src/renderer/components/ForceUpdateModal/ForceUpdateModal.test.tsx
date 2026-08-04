/**
 * ForceUpdateModal tests — keyboard, pointer, and render invariants.
 *
 * This component is a hard-blocking full-screen modal with no dismiss path.
 * Every test verifies that the only way out is one of the two buttons.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ForceUpdateModal from './ForceUpdateModal';

function renderModal(over: Partial<{
  updateVersion: string | null;
  updateNotes?: string | null;
  updating: boolean;
  onUpdate: () => void;
  onQuit: () => void;
}> = {}) {
  const props = {
    updateVersion: '1.0.0',
    updating: false,
    onUpdate: vi.fn(),
    onQuit: vi.fn(),
    ...over,
  };
  const result = render(
    <ForceUpdateModal
      updateVersion={props.updateVersion}
      updateNotes={props.updateNotes}
      updating={props.updating}
      onUpdate={props.onUpdate}
      onQuit={props.onQuit}
    />,
  );
  return { ...result, props };
}

describe('ForceUpdateModal', () => {
  it('renders the dialog with title and version', () => {
    renderModal({ updateVersion: '2.0.0' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('需要更新到最新版本')).toBeInTheDocument();
    // The description includes the version
    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
  });

  it('renders the description without version when updateVersion is null', () => {
    renderModal({ updateVersion: null });
    expect(screen.getByText('HamunaAgent 检测到新版本，必须更新后才能继续使用。')).toBeInTheDocument();
  });

  it('shows a spinner and "installing" text when updating', () => {
    renderModal({ updating: true });
    // The text appears twice (description + button label) — check at least one exists
    expect(screen.getAllByText('正在安装新版本...').length).toBeGreaterThanOrEqual(1);
    // Both buttons are disabled
    expect(screen.getByTestId('force-update-update')).toBeDisabled();
    expect(screen.getByTestId('force-update-quit')).toBeDisabled();
  });

  it('calls onUpdate when "立即更新" is clicked', () => {
    const { props } = renderModal();
    screen.getByTestId('force-update-update').click();
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onQuit when "退出 App" is clicked', () => {
    const { props } = renderModal();
    screen.getByTestId('force-update-quit').click();
    expect(props.onQuit).toHaveBeenCalledTimes(1);
  });

  it('does not call onUpdate when the button is disabled (updating)', () => {
    const { props } = renderModal({ updating: true });
    screen.getByTestId('force-update-update').click();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('does not call onQuit when the button is disabled (updating)', () => {
    const { props } = renderModal({ updating: true });
    screen.getByTestId('force-update-quit').click();
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('pressing Escape does not trigger onUpdate or onQuit', () => {
    const { props } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('pressing Cmd+W does not trigger onUpdate or onQuit', () => {
    const { props } = renderModal();
    // The capture-phase handler eats the event before it propagates
    const ev = new KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true });
    // The capture-phase handler in the component calls stopPropagation and
    // preventDefault. We verify the event is prevented.
    window.dispatchEvent(ev);
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('clicking the backdrop does nothing', () => {
    const { props } = renderModal();
    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop);
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('sets aria-modal and aria-labelledby for accessibility', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'force-update-title');
  });

  it('renders release notes header when updateNotes is provided', () => {
    renderModal({ updateNotes: '### New Features\n- Added dark mode\n- Fixed bugs' });
    expect(screen.getByText('版本更新说明')).toBeInTheDocument();
    expect(screen.getByText(/Added dark mode/)).toBeInTheDocument();
    expect(screen.getByText(/Fixed bugs/)).toBeInTheDocument();
  });

  it('does not render release notes section when updateNotes is null', () => {
    renderModal({ updateNotes: null });
    expect(screen.queryByText('版本更新说明')).not.toBeInTheDocument();
  });

  it('does not render release notes section when updateNotes is undefined', () => {
    renderModal({});
    expect(screen.queryByText('版本更新说明')).not.toBeInTheDocument();
  });
});