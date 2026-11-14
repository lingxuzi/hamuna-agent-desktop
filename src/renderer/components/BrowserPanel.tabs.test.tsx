/**
 * Tab-strip behaviour of the multi-tab embedded browser.
 *
 * The panel owns up to MAX_BROWSER_TABS native webviews; only the frontmost
 * one is on screen. These tests pin the user-visible contract:
 *
 *   - "+" opens another tab and makes it frontmost;
 *   - the "+" button is disabled once the cap is reached;
 *   - clicking a tab selects that native webview;
 *   - closing the frontmost tab promotes the newest remaining one;
 *   - closing the last tab tears the whole panel down;
 *   - the agent's `browser open --new-tab` request creates a tab too.
 *
 * The native side (Rust) is mocked — what matters here is the renderer's
 * bookkeeping of which tab is frontmost, because that is what decides which
 * page the agent's next `read` lands on.
 */
import { render, cleanup, fireEvent } from '@testing-library/react';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from './BrowserPanel';
import { i18n } from '@/i18n';

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

// Listeners are captured so the test can fire the agent's new-tab request.
const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@/utils/tauriListen', () => ({
  listenWithCleanup: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return { unlisten: vi.fn(), isRegistered: () => true };
  }),
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

/**
 * Resolved lazily: i18next finishes its async init after this module is
 * evaluated, so a module-scope `i18n.t` would capture the raw key and never
 * match the rendered label.
 */
function label(key: string): string {
  return i18n.t(`browserPanel.${key}`, { ns: 'app' });
}

let createdTabSeq = 0;

function toDomRect(): DOMRect {
  const bounds = { x: 698, y: 80, width: 690, height: 662 };
  return {
    ...bounds,
    top: bounds.y,
    left: bounds.x,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
    toJSON: () => bounds,
  } as DOMRect;
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    tabId: 'tab-1',
    url: 'https://example.com',
    sessionId: null,
    isVisible: true,
    isDraggingSplit: false,
    isSplitTransitioning: false,
    sourceFile: null,
    onCreateFailed: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function createCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_browser_create');
}

function selectCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_browser_select');
}

/** The "+" button — the only control carrying the new-tab aria-label. */
function newTabButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label('newTab')}"]`);
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

/** Every tab of the strip, in display order. */
function tabWrappers(container: HTMLElement): HTMLElement[] {
  const strip = newTabButton(container).parentElement;
  expect(strip).not.toBeNull();
  return Array.from(strip!.querySelectorAll(':scope > div'));
}

/** The label of the frontmost tab's page, as shown in the URL bar. */
function urlBarText(container: HTMLElement): string {
  return container.textContent ?? '';
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  createdTabSeq = 0;
  listeners.clear();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(toDomRect);
  invokeMock.mockClear();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'cmd_browser_create') {
      createdTabSeq += 1;
      return `bt-${createdTabSeq}`;
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrowserPanel tab strip', () => {
  it('opens a second tab from the strip and makes it frontmost', async () => {
    const { container } = render(<BrowserPanel {...panelProps()} />);
    await flush();
    expect(createCalls()).toHaveLength(1);
    expect(tabWrappers(container)).toHaveLength(1);

    fireEvent.click(newTabButton(container));
    await flush();

    expect(createCalls()).toHaveLength(2);
    expect(tabWrappers(container)).toHaveLength(2);
    // The fresh tab is frontmost: its blank seed shows the URL placeholder
    // instead of the first tab's URL.
    expect(urlBarText(container)).toContain(label('urlPlaceholder'));
  });

  it('disables the new-tab button once three tabs are open', async () => {
    const { container } = render(<BrowserPanel {...panelProps()} />);
    await flush();

    fireEvent.click(newTabButton(container));
    await flush();
    expect(newTabButton(container)).not.toBeDisabled();

    fireEvent.click(newTabButton(container));
    await flush();

    expect(tabWrappers(container)).toHaveLength(3);
    expect(newTabButton(container)).toBeDisabled();
  });

  it('selects the native webview of the clicked tab', async () => {
    const { container } = render(<BrowserPanel {...panelProps()} />);
    await flush();
    fireEvent.click(newTabButton(container));
    await flush();

    // Click the FIRST tab's label button (the second tab is frontmost).
    const firstTab = tabWrappers(container)[0];
    const label = firstTab.querySelector('button') as HTMLButtonElement;
    fireEvent.click(label);
    await flush();

    expect(selectCalls()).toHaveLength(1);
    expect(selectCalls()[0][1]).toMatchObject({ browserTabId: 'bt-1' });
    // The URL bar follows the selection back to the first tab's page.
    expect(urlBarText(container)).toContain('https://example.com');
  });

  it('closes a tab and promotes the newest remaining one', async () => {
    const { container } = render(<BrowserPanel {...panelProps()} />);
    await flush();
    fireEvent.click(newTabButton(container));
    await flush();
    expect(tabWrappers(container)).toHaveLength(2);

    // Close the frontmost (second) tab.
    const secondTab = tabWrappers(container)[1];
    const closeButton = secondTab.querySelector(`button[aria-label="${label('closeTab')}"]`) as HTMLButtonElement;
    fireEvent.click(closeButton);
    await flush();

    const closeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_browser_close_tab');
    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0][1]).toMatchObject({ browserTabId: 'bt-2' });
    expect(tabWrappers(container)).toHaveLength(1);
    // The surviving tab becomes frontmost — the URL bar shows its page again.
    expect(urlBarText(container)).toContain('https://example.com');
  });

  it('tears the panel down when the last tab is closed', async () => {
    const onClose = vi.fn();
    // The parent owns the teardown (Chat.tsx drops the panel when the browser
    // view closes) — model it here, otherwise the panel would immediately
    // re-seed a fresh tab from its unchanged `url` prop.
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <BrowserPanel {...panelProps({ onClose: () => { setOpen(false); onClose(); } })} />
      ) : null;
    }

    const { container } = render(<Harness />);
    await flush();

    const onlyTab = tabWrappers(container)[0];
    const closeButton = onlyTab.querySelector(`button[aria-label="${label('closeTab')}"]`) as HTMLButtonElement;
    fireEvent.click(closeButton);
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector(`button[aria-label="${label('newTab')}"]`)).toBeNull();
  });

  it('creates a tab when the agent asks for one', async () => {
    const { container } = render(<BrowserPanel {...panelProps()} />);
    await flush();
    expect(createCalls()).toHaveLength(1);

    const request = listeners.get('browser:agent-new-tab-request:tab-1');
    expect(request).toBeDefined();
    act(() => {
      request!({ payload: { url: 'https://agent.example' } });
    });
    await flush();

    expect(createCalls()).toHaveLength(2);
    expect(tabWrappers(container)).toHaveLength(2);
    // The agent's page is the frontmost one.
    expect(urlBarText(container)).toContain('https://agent.example');
  });
});
