/**
 * File-link appearance must survive a path-cache revalidation.
 *
 * Regression: `refreshTrigger` used to clear the whole path cache. In a
 * streaming turn it bumps constantly, so every inline-code file link
 * collapsed to bare <code> and then flipped back when the re-verify landed —
 * a continuous flicker, not a one-off. A refresh now marks entries STALE:
 * they keep rendering with their last-known result while a background batch
 * re-verifies them.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  checkPaths: vi.fn(),
  checkLocalPaths: vi.fn(),
}));

vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    isAvailable: true,
    checkPaths: harness.checkPaths,
    checkLocalPaths: harness.checkLocalPaths,
  }),
}));

import { FileActionProvider, useFileAction } from './FileActionContext';
import { ImagePreviewProvider } from './ImagePreviewContext';

type PathInfo = { exists: boolean; type: 'file' | 'dir' };

/** Reads the cache through the real provider — what a file link would render. */
function Probe({ onRead }: { onRead: (read: () => PathInfo | null) => void }) {
  const ctx = useFileAction();
  onRead(() => ctx?.checkFileTarget({ scope: 'workspace', path: 'src/app.ts' }) ?? null);
  return null;
}

function Tree({
  workspacePath,
  refreshTrigger,
  onRead,
}: {
  workspacePath: string;
  refreshTrigger: number;
  onRead: (read: () => PathInfo | null) => void;
}) {
  return (
    <ImagePreviewProvider>
      <FileActionProvider
        workspacePath={workspacePath}
        onInsertReference={vi.fn()}
        refreshTrigger={refreshTrigger}
      >
        <Probe onRead={onRead} />
      </FileActionProvider>
    </ImagePreviewProvider>
  );
}

/** Mount once, then let the test drive refreshTrigger / workspacePath. */
function mount(workspacePath: string, onRead: (read: () => PathInfo | null) => void) {
  const { rerender } = render(
    <Tree workspacePath={workspacePath} refreshTrigger={0} onRead={onRead} />,
  );
  return (next: { workspacePath?: string; refreshTrigger?: number }) => {
    act(() => {
      rerender(
        <Tree
          workspacePath={next.workspacePath ?? workspacePath}
          refreshTrigger={next.refreshTrigger ?? 0}
          onRead={onRead}
        />,
      );
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  harness.checkPaths.mockResolvedValue({
    results: { 'src/app.ts': { exists: true, type: 'file' } },
  });
  harness.checkLocalPaths.mockResolvedValue({ results: {} });
});

describe('FileActionContext — cache revalidation keeps the displayed link', () => {
  it('still reports the file as existing after refreshTrigger bumps', async () => {
    let read: () => PathInfo | null = () => null;
    const update = mount('/ws', (r) => { read = r; });

    // First read misses and enqueues the batch.
    expect(read()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(read()).toEqual({ exists: true, type: 'file', stale: false });

    // A refresh fires — this is what every tool completion does.
    update({ refreshTrigger: 1 });

    // The bug: this used to be null, so the chip rendered as bare <code>.
    // The value must survive; the stale flag is an internal scheduling detail
    // (reading it re-arms the background verify), so assert on the payload.
    expect(read()).toMatchObject({ exists: true, type: 'file' });
  });

  it('re-verifies a stale entry in the background and refreshes the value', async () => {
    let read: () => PathInfo | null = () => null;
    const update = mount('/ws', (r) => { read = r; });

    expect(read()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(harness.checkPaths).toHaveBeenCalledTimes(1);

    update({ refreshTrigger: 1 });

    // Reading a stale entry schedules a fresh batch without losing the value.
    expect(read()).toMatchObject({ exists: true, type: 'file' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // The re-verify actually went out, and the newer answer is authoritative.
    expect(harness.checkPaths).toHaveBeenCalledTimes(2);
    expect(read()).toEqual({ exists: true, type: 'file', stale: false });
  });

  it('discards everything on a workspace switch — those entries describe another tree', async () => {
    let read: () => PathInfo | null = () => null;
    const update = mount('/ws-a', (r) => { read = r; });

    expect(read()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(read()).toEqual({ exists: true, type: 'file', stale: false });

    update({ workspacePath: '/ws-b' });

    // A different workspace means the cached answer is meaningless, not stale.
    expect(read()).toBeNull();
  });
});
