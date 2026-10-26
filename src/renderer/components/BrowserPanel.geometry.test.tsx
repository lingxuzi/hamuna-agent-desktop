/**
 * Geometry reconciler regression tests for issue #339.
 *
 * The bug: the OS-level child webview ended up parked on a mid-flight layout
 * rect (x=272 while the panel settled at x≈440) because every sync mechanism
 * (create stable-frame wait, ResizeObserver, layoutSignature pump, show
 * force-sync) was one-shot and stopped once it believed the layout had
 * settled. A position-only move after the last sample never re-triggered
 * anything, so the webview floated over the workspace file tree forever.
 *
 * These tests pin the reconciler invariant at the component level: while the
 * webview is alive and visible, ANY container rect change — including
 * position-only moves and moves long after a previous sync — produces another
 * cmd_browser_resize. They fail against the pre-reconciler implementation.
 */
import { render, cleanup } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from './BrowserPanel';
import type { BrowserBounds } from './browserConstants';

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock('@/utils/tauriListen', () => ({
  listenWithCleanup: vi.fn(async () => ({ unlisten: vi.fn(), isRegistered: () => true })),
}));

vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn() }));

vi.mock('@/hooks/useBrowserOverlayGuard', () => ({
  useBrowserOverlayGuard: () => false,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/Tip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Manual rAF pump: the reconciler is frame-paced, the test drives frames.
let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafIdCounter = 0;

function toDomRect(b: BrowserBounds): DOMRect {
  return {
    ...b,
    top: b.y,
    left: b.x,
    right: b.x + b.width,
    bottom: b.y + b.height,
    toJSON: () => b,
  } as DOMRect;
}

let containerRect: BrowserBounds = { x: 698, y: 80, width: 690, height: 662 };

async function flushFrame() {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  await act(async () => {
    cbs.forEach((cb) => cb(0));
    // Drain the invoke promise chain (.catch/.finally) queued by the tick.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function resizeCalls(): Array<{ x: number; y: number; width: number; height: number }> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'cmd_browser_resize')
    .map(([, args]) => args as { x: number; y: number; width: number; height: number });
}

function createCalls(): Array<{ x: number; y: number; width: number; height: number }> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'cmd_browser_create')
    .map(([, args]) => args as { x: number; y: number; width: number; height: number });
}

function panelProps(overrides: { isVisible?: boolean; isSplitTransitioning?: boolean; browserAlive?: boolean; sessionId?: string | null } = {}) {
  return {
    tabId: 'tab-1',
    url: 'https://example.com',
    sessionId: overrides.sessionId ?? null,
    isVisible: overrides.isVisible ?? true,
    isDraggingSplit: false,
    isSplitTransitioning: overrides.isSplitTransitioning ?? false,
    browserAlive: overrides.browserAlive ?? true,
    sourceFile: null,
    onBrowserCreated: vi.fn(),
    onCreateFailed: vi.fn(),
    onClose: vi.fn(),
  };
}

function renderPanel() {
  return render(<BrowserPanel {...panelProps()} />);
}

beforeEach(() => {
  rafCallbacks = new Map();
  rafIdCounter = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafIdCounter += 1;
    rafCallbacks.set(rafIdCounter, cb);
    return rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() =>
    toDomRect(containerRect),
  );
  containerRect = { x: 698, y: 80, width: 690, height: 662 };
  invokeMock.mockClear();
  invokeMock.mockImplementation(async () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrowserPanel geometry reconciler (#339)', () => {
  it('does not create the native webview from split-transition sliver bounds', async () => {
    containerRect = { x: 1223, y: 80, width: 165, height: 662 };
    const view = render(<BrowserPanel {...panelProps({ browserAlive: false, isSplitTransitioning: true })} />);

    await flushFrame();
    await flushFrame();
    expect(createCalls()).toHaveLength(0);

    containerRect = { x: 698, y: 80, width: 690, height: 662 };
    view.rerender(<BrowserPanel {...panelProps({ browserAlive: false, isSplitTransitioning: false })} />);
    await flushFrame();

    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0]).toMatchObject({ x: 698, y: 80, width: 690, height: 662 });
  });

  it('keeps converging onto the container rect across successive layout moves', async () => {
    renderPanel();

    // Frame 1: first usable rect delivered.
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1);
    expect(resizeCalls()[0]).toMatchObject({ x: 698, y: 80, width: 690, height: 662 });

    // The #339 sequence: workspace overlay flip moves the panel WITHOUT
    // resizing it (never fires ResizeObserver)…
    containerRect = { x: 272, y: 80, width: 690, height: 662 };
    await flushFrame();
    expect(resizeCalls()).toHaveLength(2);
    expect(resizeCalls()[1]).toMatchObject({ x: 272, y: 80 });

    // …then the %-width transition settles the panel somewhere else entirely,
    // long after any one-shot mechanism would have declared "stable".
    containerRect = { x: 440, y: 95, width: 820, height: 610 };
    await flushFrame();
    expect(resizeCalls()).toHaveLength(3);
    expect(resizeCalls()[2]).toMatchObject({ x: 440, y: 95, width: 820, height: 610 });
  });

  it('stays idle while the rect is unchanged (no IPC churn at rest)', async () => {
    renderPanel();
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1);

    await flushFrame();
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1);
  });

  it('retries on the next frame when a resize invoke fails', async () => {
    renderPanel();
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1);

    invokeMock.mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'cmd_browser_resize') throw new Error('webview busy');
      return undefined;
    });
    containerRect = { x: 440, y: 95, width: 820, height: 610 };
    await flushFrame(); // delivery fails — must not be remembered as synced
    expect(resizeCalls()).toHaveLength(2);

    await flushFrame(); // retried with the same rect
    expect(resizeCalls()).toHaveLength(3);
    expect(resizeCalls()[2]).toMatchObject({ x: 440, y: 95, width: 820, height: 610 });
  });

  it('keeps resize invokes serialized across visibility-driven effect restarts', async () => {
    // Codex review finding on the first reconciler version: an effect-local
    // in-flight flag resets when the effect restarts (visibility toggle), so
    // a second resize could be issued while the first is still pending — the
    // two have no ordering guarantee on the Rust side, and the older landing
    // last parks the webview on stale bounds believed to be synced.
    let resolveFirst!: () => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'cmd_browser_resize') {
        return new Promise<unknown>((res) => {
          resolveFirst = () => res(undefined);
        });
      }
      return Promise.resolve(undefined);
    });

    const view = render(<BrowserPanel {...panelProps()} />);
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1); // pending, unresolved

    // Restart the reconciler effect while the invoke is still in flight.
    view.rerender(<BrowserPanel {...panelProps({ isVisible: false })} />);
    view.rerender(<BrowserPanel {...panelProps({ isVisible: true })} />);
    containerRect = { x: 440, y: 95, width: 820, height: 610 };
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1); // still deferred — serialization survived

    invokeMock.mockImplementation(async () => undefined);
    resolveFirst();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushFrame(); // first settled → new rect delivered
    expect(resizeCalls()).toHaveLength(2);
    expect(resizeCalls()[1]).toMatchObject({ x: 440, y: 95, width: 820, height: 610 });
  });

  it('never syncs degenerate rects (issue #290 floor still holds)', async () => {
    containerRect = { x: 0, y: 0, width: 0, height: 662 };
    renderPanel();
    await flushFrame();
    await flushFrame();
    expect(resizeCalls()).toHaveLength(0);

    // Once the container lays out for real, the reconciler picks it up.
    containerRect = { x: 440, y: 95, width: 820, height: 610 };
    await flushFrame();
    expect(resizeCalls()).toHaveLength(1);
  });
});

/**
 * The agent CLI addresses the browser by Chat session id. A Chat's id rotates
 * (`pending-<tabId>` → real UUID once the SDK reports system_init), so the
 * browser must be re-bound whenever the id changes — otherwise every agent
 * command would look up a browser under an id the browser no longer carries.
 */
describe('BrowserPanel session binding', () => {
  function setSessionCalls(): Array<{ tabId: string; sessionId: string | null }> {
    return invokeMock.mock.calls
      .filter(([cmd]) => cmd === 'cmd_browser_set_session')
      .map(([, args]) => args as { tabId: string; sessionId: string | null });
  }

  it('creates the webview with the current session id', async () => {
    render(<BrowserPanel {...panelProps({ browserAlive: false, sessionId: 'session-abc' })} />);
    await flushFrame();

    const creates = invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_browser_create');
    expect(creates).toHaveLength(1);
    expect(creates[0][1]).toMatchObject({ sessionId: 'session-abc' });
  });

  it('re-binds when the session id is upgraded', async () => {
    const view = render(<BrowserPanel {...panelProps({ browserAlive: true, sessionId: 'pending-tab-1' })} />);
    await flushFrame();

    view.rerender(<BrowserPanel {...panelProps({ browserAlive: true, sessionId: 'session-real' })} />);
    await flushFrame();

    const binds = setSessionCalls();
    expect(binds.length).toBeGreaterThan(0);
    expect(binds[binds.length - 1]).toMatchObject({ tabId: 'tab-1', sessionId: 'session-real' });
  });

  it('does not bind before the webview exists', async () => {
    render(<BrowserPanel {...panelProps({ browserAlive: false, sessionId: 'session-abc' })} />);
    await flushFrame();
    expect(setSessionCalls()).toHaveLength(0);
  });
});

/**
 * Double-create regression. `cmd_browser_create` rejects a tabId that already
 * owns a webview, and the renderer's second call lands AFTER the first one
 * succeeded but BEFORE the parent has committed `browserAlive=true` — 20ms
 * apart in the wild (unified-2026-10-25: 21.281 create → 21.297 created →
 * 21.316 duplicate blocked). The rejection then called `onCreateFailed`, which
 * tore down the working webview, so the first login attempt always failed and
 * only a manual retry worked.
 */
describe('BrowserPanel create is issued once per tab', () => {
  it('survives a parent re-render that changes callback identities mid-flight', async () => {
    const onCreateFailed = vi.fn();
    const view = render(
      <BrowserPanel {...panelProps({ browserAlive: false })} onCreateFailed={onCreateFailed} />,
    );
    await flushFrame();
    expect(createCalls()).toHaveLength(1);

    // Parent still believes the webview is dead (it has not processed
    // onBrowserCreated yet) and hands down fresh callbacks — the common shape
    // of an inline arrow prop. Pre-fix this re-armed the create branch.
    view.rerender(
      <BrowserPanel {...panelProps({ browserAlive: false })} onCreateFailed={onCreateFailed} />,
    );
    await flushFrame();

    expect(createCalls()).toHaveLength(1);
    expect(onCreateFailed).not.toHaveBeenCalled();
  });

  it('survives an isVisible toggle while the parent still reports browserAlive=false', async () => {
    const onCreateFailed = vi.fn();
    const view = render(
      <BrowserPanel {...panelProps({ browserAlive: false, isVisible: true })} onCreateFailed={onCreateFailed} />,
    );
    await flushFrame();
    expect(createCalls()).toHaveLength(1);

    view.rerender(
      <BrowserPanel {...panelProps({ browserAlive: false, isVisible: false })} onCreateFailed={onCreateFailed} />,
    );
    await flushFrame();
    view.rerender(
      <BrowserPanel {...panelProps({ browserAlive: false, isVisible: true })} onCreateFailed={onCreateFailed} />,
    );
    await flushFrame();

    expect(createCalls()).toHaveLength(1);
    expect(onCreateFailed).not.toHaveBeenCalled();
  });

  it('creates again when the same instance is pointed at a different tabId', async () => {
    const view = render(<BrowserPanel {...panelProps({ browserAlive: false })} />);
    await flushFrame();
    expect(createCalls()).toHaveLength(1);

    view.rerender(<BrowserPanel {...panelProps({ browserAlive: false })} tabId="tab-2" />);
    await flushFrame();

    const creates = invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_browser_create');
    expect(creates).toHaveLength(2);
    expect(creates[1][1]).toMatchObject({ tabId: 'tab-2' });
  });
});
