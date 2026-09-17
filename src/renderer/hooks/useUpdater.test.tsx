/**
 * useUpdater startup-check behavior.
 *
 * Verifies that the one-shot startup effect:
 *   - fires `checkForUpdate` once after a short delay on mount,
 *   - is a no-op outside the Tauri environment,
 *   - survives React StrictMode's intentional double-mount in dev without
 *     dispatching more than one startup check.
 *
 * The 30-min periodic interval is unrelated; these tests isolate the startup
 * effect by advancing only its 2s timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';

// Tauri environment must report true so the effect actually runs.
beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function mockTauriApis() {
  const invoke = vi.fn().mockResolvedValue('version: 9.9.9\n'); // remote > local → trigger download path
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
  vi.doMock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.0.0') }));
  vi.doMock('@tauri-apps/plugin-process', () => ({ relaunch: () => Promise.resolve() }));
  vi.doMock('@/utils/tauriListen', () => ({ listenWithCleanup: () => Promise.resolve(() => {}) }));
  return invoke;
}

describe('useUpdater startup check', () => {
  it('fires checkForUpdate once ~2s after mount in Tauri', async () => {
    vi.useFakeTimers();
    const invoke = mockTauriApis();
    const { useUpdater } = await import('./useUpdater');

    function Probe() {
      useUpdater();
      return null;
    }

    render(<Probe />);
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // test_update_connectivity is the first IPC inside checkForUpdate.
    const calls = invoke.mock.calls.filter(([cmd]) => cmd === 'test_update_connectivity');
    expect(calls.length).toBe(1);
  });

  it('does not fire when not in Tauri', async () => {
    vi.useFakeTimers();
    // Remove Tauri marker so isTauriEnvironment() returns false.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const invoke = vi.fn();
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.0.0') }));
    vi.doMock('@tauri-apps/plugin-process', () => ({ relaunch: () => Promise.resolve() }));
    vi.doMock('@/utils/tauriListen', () => ({ listenWithCleanup: () => Promise.resolve(() => {}) }));

    const { useUpdater } = await import('./useUpdater');
    function Probe() {
      useUpdater();
      return null;
    }
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('survives StrictMode dev double-mount without firing twice', async () => {
    vi.useFakeTimers();
    const invoke = mockTauriApis();
    const { useUpdater } = await import('./useUpdater');

    function Probe() {
      useUpdater();
      return null;
    }

    // React 18 StrictMode invokes effect → cleanup → effect on the same
    // fiber in dev. The startup effect's ref gate MUST prevent the second
    // effect from scheduling a second timer. Verify by counting IPCs after
    // the timer window — must be exactly one.
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    const calls = invoke.mock.calls.filter(([cmd]) => cmd === 'test_update_connectivity');
    expect(calls.length).toBe(1);
  });
});