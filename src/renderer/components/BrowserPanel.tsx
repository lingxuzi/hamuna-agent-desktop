/**
 * BrowserPanel — Embedded browser preview panel for the split view.
 *
 * Renders a tab strip + a navigation toolbar + a placeholder container. The
 * actual web content is rendered by native Tauri child Webviews positioned
 * over the placeholder using absolute coordinates (OS-level overlay).
 *
 * One panel owns up to MAX_BROWSER_TABS native webviews. Only the frontmost
 * one is on screen; the others stay alive so switching tabs is instant and
 * keeps each page's own state.
 *
 * The toolbar always includes a close button (×), so the separate
 * single-view header in Chat.tsx is not needed — one row handles
 * both navigation and panel control.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listenWithCleanup } from '@/utils/tauriListen';
import { ChevronLeft, ChevronRight, Code2, RotateCw, ExternalLink, Loader2, Globe, X, Plus } from 'lucide-react';
import { openExternal } from '@/utils/openExternal';
import {
  BROWSER_BLANK_URL,
  MAX_BROWSER_TABS,
  shouldSyncBrowserBounds,
  toUsableBrowserBounds,
  type BrowserBounds,
} from '@/components/browserConstants';
import { useBrowserOverlayGuard } from '@/hooks/useBrowserOverlayGuard';
import { useToast } from '@/components/Toast';
import Tip from '@/components/Tip';

/**
 * One embedded browser tab — a native child webview owned by this panel.
 *
 * `id` is Rust's browser tab id (`bt-7`): the key of every per-tab native
 * event and the handle every select/close call takes. It is NOT the owner
 * tab id — that one groups the tabs of a panel.
 */
interface BrowserTab {
  id: string;
  /** The URL the tab was opened with — the blank sentinel for a fresh tab. */
  seedUrl: string;
  /** The URL the tab is on right now. */
  url: string;
  loading: boolean;
  /** Whether the tab ever left its seed page (the blank-state latch). */
  hasNavigated: boolean;
}

/** How long a tab creation waits for the container to be laid out. */
const CREATE_BOUNDS_TIMEOUT_MS = 5000;

interface BrowserPanelProps {
  tabId: string;
  url: string | null;
  /**
   * Chat session that owns this browser. The agent CLI addresses the browser
   * by session id (it only knows `HAMUNA_SESSION_ID`), so Rust stores this
   * id and the renderer re-binds it whenever the id upgrades from
   * `pending-<tabId>` to the real UUID.
   */
  sessionId?: string | null;
  /** Whether this panel should be visible (includes isActive + splitActiveView + splitPanelVisible) */
  isVisible: boolean;
  isDraggingSplit: boolean;
  isSplitTransitioning?: boolean;
  /** When previewing a local file, stores its metadata for editor toggle */
  sourceFile?: { name: string; content: string; size: number; path: string } | null;
  /**
   * Active chat workspace path. Forwarded to `openExternal()` when the user
   * clicks "open in external browser" so Rust can accept workspace files
   * outside home/tmp (e.g. Windows `D:\workspace\foo.html`). Issue #125
   * follow-up — without this the path validator rejects every non-system-
   * drive workspace.
   */
  workspace?: string | null;
  onCreateFailed: () => void;
  /**
   * Single-page mode: the panel hosts exactly one page, so the tab strip is
   * hidden and no extra tab can be opened.
   *
   * The social-login takeover needs this. Its probe addresses the owner and
   * Rust resolves that to the owner's SELECTED tab — a second tab would take
   * the selection away from the login page, and the probe would poll a blank
   * page forever. A login page has no use for a tab strip anyway.
   */
  singleTab?: boolean;
  /**
   * Called once a native webview of this panel exists. Consumers that need
   * to know "the browser is up" (the social-login probe polls the page)
   * use it; the panel itself does not need the answer.
   */
  onBrowserCreated?: () => void;
  onClose: () => void;
  /** Switch to code editor view (only available when sourceFile is set) */
  onSwitchToEditor?: () => void;
  /**
   * Notify parent when the visible URL changes (Rust emits `browser:url-changed`
   * after navigation / page-load). Lets the parent keep its own UI bits — like
   * the split-view tab label — in sync with what the user actually sees.
   */
  onUrlChange?: (url: string) => void;
}

export default function BrowserPanel({
  tabId,
  url,
  sessionId,
  isVisible,
  isDraggingSplit,
  isSplitTransitioning = false,
  sourceFile,
  workspace,
  onCreateFailed,
  singleTab = false,
  onBrowserCreated,
  onClose,
  onSwitchToEditor,
  onUrlChange,
}: BrowserPanelProps) {
  const { t } = useTranslation('app');
  const urlPlaceholder = t('browserPanel.urlPlaceholder');
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Tab registry ──
  //
  // The panel owns its tabs: Rust owns the native webviews, the renderer owns
  // which one is frontmost and what each shows. The refs are the source of
  // truth so callbacks can read the current list without being re-created —
  // a fresh callback identity would re-arm the create effect.
  const [tabs, setTabsState] = useState<BrowserTab[]>([]);
  const tabsRef = useRef<BrowserTab[]>([]);
  const setTabs = useCallback((next: BrowserTab[] | ((prev: BrowserTab[]) => BrowserTab[])) => {
    const value = typeof next === 'function' ? next(tabsRef.current) : next;
    tabsRef.current = value;
    setTabsState(value);
  }, []);

  const [activeTabId, setActiveTabIdState] = useState<string | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const setActiveTabId = useCallback((id: string | null) => {
    activeTabIdRef.current = id;
    setActiveTabIdState(id);
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const hasTabs = tabs.length > 0;

  // Overlay detection — an open modal covers the native webview, so the
  // webview has to be hidden while one is up.
  const overlayDetected = useBrowserOverlayGuard(hasTabs);

  // Toast accessed via ref so the create effect doesn't list it as a dep
  // (project convention — see CLAUDE.md react_stability_rules). Ref is
  // updated in a post-commit effect rather than during render to satisfy
  // react-hooks/refs.
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  // onUrlChange via ref — same reason as toastRef. Lets the url-changed
  // listener effect stay stable across parent re-renders.
  const onUrlChangeRef = useRef(onUrlChange);
  useEffect(() => { onUrlChangeRef.current = onUrlChange; }, [onUrlChange]);

  const onBrowserCreatedRef = useRef(onBrowserCreated);
  useEffect(() => { onBrowserCreatedRef.current = onBrowserCreated; }, [onBrowserCreated]);

  // Mount-tracking ref to gate post-resolve setState in async chains, guarding
  // the close→reopen race where an unmounted instance's create promise still
  // resolves and would otherwise mutate state for the new instance's tabId.
  // Must be declared BEFORE any effect that depends on it.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Track the last URL we told the webview to load
  const lastRequestedUrlRef = useRef<string | null>(null);
  // Guards against issuing a second create while the first is still in
  // flight — Rust would reject it ("already exists") and the rejection would
  // tear down the webview that had just been created.
  const createInFlightRef = useRef(false);
  const lastSyncedBoundsRef = useRef<BrowserBounds | null>(null);
  // Resize-invoke serialization marker. A ref (not effect-local state) so it
  // survives reconciler effect restarts: if visibility toggles while a resize
  // is pending, the restarted loop must keep deferring until that invoke
  // settles — two in-flight resizes have no ordering guarantee on the Rust
  // side, and the older one landing last would park the webview on stale
  // bounds that the ref-bookkeeping believes are current.
  const resizeInFlightRef = useRef(false);

  const readUsableBounds = useCallback((): BrowserBounds | null => {
    const el = containerRef.current;
    if (!el) return null;
    return toUsableBrowserBounds(el.getBoundingClientRect());
  }, []);

  /**
   * Create one native webview and register it as a tab of this panel.
   *
   * The webview can only be created by the renderer (it owns the container
   * geometry), so this waits for a usable rect before handing the call to
   * Rust. A mid-transition rect would park the native webview at the wrong
   * position (issue #290) — hence the wait rather than a one-shot read.
   */
  const createTab = useCallback((seedUrl: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const deadline = Date.now() + CREATE_BOUNDS_TIMEOUT_MS;
      const attempt = () => {
        if (!isMountedRef.current) { resolve(null); return; }
        const bounds = readUsableBounds();
        if (!bounds) {
          if (Date.now() > deadline) {
            toastRef.current.error(t('browserPanel.openFailed', { message: t('browserPanel.noBounds') }));
            resolve(null);
            return;
          }
          requestAnimationFrame(attempt);
          return;
        }
        invoke<string>('cmd_browser_create', {
          tabId, url: seedUrl,
          x: bounds.x, y: bounds.y,
          width: bounds.width, height: bounds.height,
          sessionId: sessionId ?? null,
        })
          .then((id) => {
            if (!isMountedRef.current) { resolve(null); return; }
            setTabs((prev) => (prev.some((tab) => tab.id === id) ? prev : [
              ...prev,
              { id, seedUrl, url: seedUrl, loading: false, hasNavigated: false },
            ]));
            setActiveTabId(id);
            onBrowserCreatedRef.current?.();
            resolve(id);
          })
          .catch((err) => {
            if (!isMountedRef.current) { resolve(null); return; }
            console.error('[browser] Create failed:', err);
            const msg = typeof err === 'string' ? err : (err?.message ?? String(err));
            toastRef.current.error(t('browserPanel.openFailed', { message: msg }));
            // A failure that leaves the panel with NO tab is panel-level (the
            // seed URL could not be opened) — the parent tears the panel down.
            // A failure on an extra tab only loses that tab.
            if (tabsRef.current.length === 0) onCreateFailed();
            resolve(null);
          });
      };
      attempt();
    });
  }, [tabId, sessionId, readUsableBounds, onCreateFailed, t, setTabs, setActiveTabId]);

  // ── Seed / navigate ──
  //
  // The parent's `url` prop is the panel's seed URL: the first time it is set
  // the panel opens a tab with it. Later changes navigate the FRONTMOST tab —
  // "open this link in the browser" means "show it in the browser I am using".
  useEffect(() => {
    if (!url) return;
    if (tabsRef.current.length === 0) {
      // No tab yet — open one, but only while the panel is on screen and
      // settled (a transition rect would misplace the native webview).
      if (!isVisible || isSplitTransitioning || createInFlightRef.current) return;
      createInFlightRef.current = true;
      lastRequestedUrlRef.current = url;
      void createTab(url).finally(() => { createInFlightRef.current = false; });
      return;
    }
    if (url !== lastRequestedUrlRef.current) {
      lastRequestedUrlRef.current = url;
      invoke('cmd_browser_navigate', { tabId, url }).catch(() => {});
    }
  }, [url, isVisible, isSplitTransitioning, tabId, hasTabs, createTab]);

  // ── Owner change ──
  //
  // The tabs belong to the owner tab id. Pointing the same instance at a
  // different owner means a different panel — the old tabs must go, and the
  // new owner starts from scratch. The reset must be a side effect (it has to
  // fire together with the native teardown), so the setState-in-effect rule is
  // disabled here rather than moving the reset to render, where `setTabs`
  // would read a ref during render — a worse violation.
  const ownerTabIdRef = useRef(tabId);
  useEffect(() => {
    if (ownerTabIdRef.current === tabId) return;
    const previousOwner = ownerTabIdRef.current;
    ownerTabIdRef.current = tabId;
    invoke('cmd_browser_close_owner', { tabId: previousOwner }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs([]);
    setActiveTabId(null);
    lastRequestedUrlRef.current = null;
  }, [tabId, setTabs, setActiveTabId]);

  // ── Re-bind the browser to the Chat session id ──
  //
  // A Chat's session id is not stable: a fresh tab starts as
  // `pending-<tabId>` and is upgraded to the real UUID once the SDK reports
  // `system_init`. The agent CLI only ever knows the final id (it reads
  // `HAMUNA_SESSION_ID` from its own environment), so the browser has to be
  // re-pointed at the new id — otherwise every agent command would look up a
  // browser that does not exist under that id.
  useEffect(() => {
    if (!hasTabs) return;
    invoke('cmd_browser_set_session', {
      tabId,
      sessionId: sessionId ?? null,
    }).catch(() => {});
  }, [hasTabs, tabId, sessionId]);

  // ── Listen for URL/loading events from Rust ──
  //
  // One listener pair per browser tab — the native events are keyed by the
  // browser tab id, not by the owner.
  const tabIdsKey = tabs.map((tab) => tab.id).join(',');
  useEffect(() => {
    if (!tabIdsKey) return;
    const ac = new AbortController();

    for (const id of tabIdsKey.split(',')) {
      void listenWithCleanup<string>(`browser:url-changed:${id}`, (event) => {
        const next = event.payload;
        setTabs((prev) => prev.map((tab) => {
          if (tab.id !== id) return tab;
          // Latch hasNavigated on the first real navigation — lets the React
          // empty state release control over the tab for the rest of its
          // lifetime. Anchored to the scheme (anything but `data:`) rather
          // than string equality with BROWSER_BLANK_URL: WebKit reports the
          // data: URL back with Tauri's CSP `<meta>` injection appended, so
          // equality check breaks and the latch would fire on the very first
          // blank-page load.
          const navigated = tab.hasNavigated || (!!next && !next.startsWith('data:'));
          return { ...tab, url: next, hasNavigated: navigated };
        }));
        if (id === activeTabIdRef.current) onUrlChangeRef.current?.(next);
      }, ac.signal);

      void listenWithCleanup<boolean>(`browser:loading:${id}`, (event) => {
        setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, loading: event.payload } : tab)));
      }, ac.signal);
    }

    return () => ac.abort();
  }, [tabIdsKey, setTabs]);

  // ── Frontmost tab ──
  //
  // Rust owns the native visibility and announces every change — the agent
  // can switch tabs behind the user's back, and the strip has to follow.
  useEffect(() => {
    const ac = new AbortController();

    void listenWithCleanup<string>(`browser:tab-selected:${tabId}`, (event) => {
      const selected = event.payload;
      if (!selected) return;
      setActiveTabId(selected);
      const tab = tabsRef.current.find((candidate) => candidate.id === selected);
      if (tab) onUrlChangeRef.current?.(tab.url);
    }, ac.signal);

    return () => ac.abort();
  }, [tabId, setActiveTabId]);

  // ── Agent-requested extra tab ──
  //
  // The agent asks for a tab by URL; the renderer is the only side that can
  // create a webview. Chat.tsx listens to the same event to bring the browser
  // view on screen — this side creates the tab.
  //
  // A single-page panel does not register the listener at all: an extra tab
  // would steal the owner selection from the page the parent probes.
  useEffect(() => {
    if (singleTab) return;
    const ac = new AbortController();

    void listenWithCleanup<{ url?: string }>(
      `browser:agent-new-tab-request:${tabId}`,
      (event) => {
        const requested = event.payload?.url;
        if (!requested) return;
        void createTab(requested);
      },
      ac.signal,
    );

    return () => ac.abort();
  }, [tabId, createTab, singleTab]);

  // ── Geometry reconciler (issue #339) ──
  //
  // Single always-on loop owning the invariant: while the webview is alive
  // and this panel's tab is visible, the native webview bounds converge onto
  // the container's DOM rect — no matter what moved it, or when.
  //
  // This replaces the previous one-shot mechanisms (create-time stable-frame
  // wait, ResizeObserver, layoutSignature-keyed track-until-stable pump, show
  // force-sync). Each of those stopped sampling once it believed the layout
  // had settled, but the set of motion sources is open-ended — workspace
  // overlay flips move x without resizing, %-widths re-resolve after window
  // resizes, the 300ms width transition outlives timer-based gates — so the
  // last delivered sample could be a mid-flight rect with nothing scheduled
  // to ever run again (#290 → #329 → #339 are all instances of this class).
  // A frame-paced reconciler has no "settled" heuristic to get wrong: one
  // getBoundingClientRect per frame (≈μs, read-after-layout), an invoke only
  // when the rect actually changed, serialized so native updates stay
  // ordered. Same strategy as floating-ui's autoUpdate({animationFrame}).
  //
  // Runs even while the webview is suspension-hidden (drag / transition):
  // cmd_browser_resize updates Rust's cached geometry on hidden webviews, so
  // the next SHOW restores the current rect, not a stale one.
  useEffect(() => {
    if (!hasTabs || !isVisible) return;
    let rafId = 0;
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      const bounds = readUsableBounds();
      if (shouldSyncBrowserBounds(lastSyncedBoundsRef.current, bounds, resizeInFlightRef.current)) {
        resizeInFlightRef.current = true;
        lastSyncedBoundsRef.current = bounds;
        invoke('cmd_browser_resize', {
          tabId,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        })
          .catch(() => {
            // Failed delivery must not be remembered as synced — clear so the
            // next frame retries (invoke latency naturally paces retries).
            // Rust propagates native set_position/set_size failures as Err,
            // so this also covers "IPC succeeded but geometry didn't apply".
            lastSyncedBoundsRef.current = null;
          })
          .finally(() => {
            resizeInFlightRef.current = false;
          });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [hasTabs, isVisible, readUsableBounds, tabId]);

  // Blank-state detection.
  //
  // Anchored to the tab's SEED url and a one-way `hasNavigated` latch — NOT
  // to the moving `url`. This means:
  //   - Toolbar-opened browser (seed = BROWSER_BLANK_URL) → blank state
  //     until the user types a URL and navigates away.
  //   - User opens a chat link (seed = 'https://…') → never blank.
  //   - User navigates from blank → site → presses Back to the blank page →
  //     hasNavigated stays true, so the native webview keeps control instead
  //     of our React empty state hijacking the back button.
  const isBlankPage = activeTab !== null
    && activeTab.seedUrl === BROWSER_BLANK_URL
    && !activeTab.hasNavigated;

  const currentUrl = activeTab?.url ?? '';
  const isLoading = activeTab?.loading ?? false;

  // ── Consolidated show/hide ──
  useEffect(() => {
    if (!hasTabs) return;
    const nativeViewSuspended = isDraggingSplit || isSplitTransitioning;
    const shouldShow = isVisible && !nativeViewSuspended && !overlayDetected && !isBlankPage;
    if (shouldShow) {
      // SHOW restores Rust's cached geometry; the reconciler keeps that cache
      // current (it syncs even while hidden), and corrects any residue within
      // a frame — no force-sync needed here.
      invoke('cmd_browser_show', { tabId }).catch(() => {});
    } else {
      invoke('cmd_browser_hide', { tabId }).catch(() => {});
    }
  }, [hasTabs, isVisible, isDraggingSplit, isSplitTransitioning, overlayDetected, isBlankPage, tabId]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    const tid = tabId;
    return () => { invoke('cmd_browser_close_owner', { tabId: tid }).catch(() => {}); };
  }, [tabId]);

  // ── Tab actions ──
  const handleSelectTab = useCallback((browserTabId: string) => {
    setActiveTabId(browserTabId);
    invoke('cmd_browser_select', { browserTabId }).catch(() => {});
  }, [setActiveTabId]);

  const handleCloseTab = useCallback((browserTabId: string) => {
    invoke('cmd_browser_close_tab', { browserTabId }).catch(() => {});
    const remaining = tabsRef.current.filter((tab) => tab.id !== browserTabId);
    setTabs(remaining);
    if (remaining.length === 0) {
      // The last tab is gone — the browser panel itself has nothing to show.
      onClose();
      return;
    }
    if (activeTabIdRef.current === browserTabId) {
      // Rust promotes the newest remaining tab; mirror that locally so the
      // strip and the native overlay agree immediately.
      const promoted = remaining[remaining.length - 1];
      setActiveTabId(promoted.id);
      onUrlChangeRef.current?.(promoted.url);
    }
  }, [onClose, setTabs, setActiveTabId]);

  const handleNewTab = useCallback(() => {
    if (singleTab) return;
    if (tabsRef.current.length >= MAX_BROWSER_TABS) return;
    void createTab(BROWSER_BLANK_URL);
  }, [createTab, singleTab]);

  // ── Navigation handlers ──
  const handleGoBack = useCallback(() => {
    invoke('cmd_browser_go_back', { tabId }).catch(() => {});
  }, [tabId]);

  const handleGoForward = useCallback(() => {
    invoke('cmd_browser_go_forward', { tabId }).catch(() => {});
  }, [tabId]);

  const handleReload = useCallback(() => {
    invoke('cmd_browser_reload', { tabId }).catch(() => {});
  }, [tabId]);

  const handleOpenExternal = useCallback(() => {
    // openExternal auto-routes file:// URLs through Rust (see openExternal.ts);
    // web URLs go through Tauri shell.open. Forwarding `workspace` lets Rust
    // accept paths under non-system-drive workspaces (issue #125 follow-up);
    // it's a no-op for web URLs.
    if (currentUrl) openExternal(currentUrl, { workspace });
  }, [currentUrl, workspace]);

  // ── URL bar editing ──
  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  const handleUrlClick = useCallback(() => {
    // On blank state, start with empty draft so user can type immediately.
    setUrlDraft(isBlankPage ? '' : currentUrl);
    setUrlEditing(true);
    // Focus will happen after render via autoFocus
  }, [currentUrl, isBlankPage]);

  const handleUrlSubmit = useCallback(() => {
    setUrlEditing(false);
    let trimmed = urlDraft.trim();
    if (!trimmed) return;
    // Add https:// only when the input has no scheme at all. Detecting any
    // RFC-3986 scheme prefix (not just http/https) preserves `about:blank`,
    // `file://`, `data:`, etc. unchanged. Tauri's on_navigation already blocks
    // dangerous schemes (e.g. `javascript:`), so we don't sanitize here.
    if (!/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }
    if (trimmed !== currentUrl) {
      invoke('cmd_browser_navigate', { tabId, url: trimmed }).catch(() => {});
      lastRequestedUrlRef.current = trimmed;
    }
  }, [urlDraft, currentUrl, tabId]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlSubmit();
    } else if (e.key === 'Escape') {
      setUrlEditing(false);
    }
  }, [handleUrlSubmit]);

  // Extract display hostname (suppressed for blank state so we don't show the raw sentinel URL)
  const displayUrl = currentUrl && !isBlankPage
    ? (() => { try { return new URL(currentUrl).hostname || currentUrl; } catch { return currentUrl; } })()
    : '';

  // No `transition-colors` — let global `button { transition-property: ...transform... }` handle it,
  // so the unified active:scale(0.98) animates smoothly instead of snapping.
  const navBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]';

  // Tab strip — every control shares one height so the row reads as one band.
  const tabBtn =
    'flex h-6 min-w-0 max-w-[150px] items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-xs';

  const tabLabel = (tab: BrowserTab): string => {
    if (tab.seedUrl === BROWSER_BLANK_URL && !tab.hasNavigated) return t('browserPanel.newTab');
    try {
      return new URL(tab.url).hostname || tab.url;
    } catch {
      return tab.url || t('browserPanel.newTab');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip — one native webview per tab, frontmost one on screen */}
      {!singleTab && tabs.length > 0 && (
        <div className="flex h-7 flex-shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[var(--paper)] px-1.5">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`${tabBtn} ${
                  isActive
                    ? 'bg-[var(--paper-inset)] text-[var(--ink)]'
                    : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={tab.url || tabLabel(tab)}
                >
                  {tabLabel(tab)}
                </button>
                <button
                  type="button"
                  onClick={() => handleCloseTab(tab.id)}
                  aria-label={t('browserPanel.closeTab')}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--ink-faint)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <Tip label={t('browserPanel.newTab')} position="bottom">
            <button
              type="button"
              aria-label={t('browserPanel.newTab')}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleNewTab}
              disabled={tabs.length >= MAX_BROWSER_TABS}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tip>
        </div>
      )}

      {/* Navigation toolbar — always includes close button (single row for all states) */}
      <div className="relative flex h-9 flex-shrink-0 items-center gap-0.5 border-b border-[var(--line)] bg-[var(--paper)] px-2">
        <Tip label={t('browserPanel.back')} position="bottom">
          <button type="button" className={navBtn} onClick={handleGoBack}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </Tip>
        <Tip label={t('browserPanel.forward')} position="bottom">
          <button type="button" className={navBtn} onClick={handleGoForward}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </Tip>
        <Tip label={isLoading ? t('browserPanel.stop') : t('browserPanel.reload')} position="bottom">
          <button type="button" className={navBtn} onClick={handleReload}>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </button>
        </Tip>

        {/* Editable URL bar */}
        {urlEditing ? (
          <input
            ref={urlInputRef}
            autoFocus
            placeholder={urlPlaceholder}
            className="ml-1.5 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-transparent px-2 py-0.5 text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            onBlur={() => setUrlEditing(false)}
            spellCheck={false}
          />
        ) : (
          <button
            type="button"
            onClick={handleUrlClick}
            className="ml-1.5 min-w-0 flex-1 cursor-text truncate rounded-[var(--radius-sm)] px-2 py-0.5 text-left text-xs transition-colors hover:bg-[var(--paper-inset)]"
            title={isBlankPage ? urlPlaceholder : currentUrl}
          >
            {isBlankPage ? (
              <span className="text-[var(--ink-faint)]">{urlPlaceholder}</span>
            ) : (
              <span className="text-[var(--ink-muted)]">{currentUrl}</span>
            )}
          </button>
        )}

        {/* Edit Source — only for local file previews */}
        {sourceFile && onSwitchToEditor && (
          <Tip label={t('browserPanel.editSource')} position="bottom" align="end">
            <button type="button" className={navBtn} onClick={onSwitchToEditor}>
              <Code2 className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}

        <Tip label={t('browserPanel.openExternal')} position="bottom" align="end">
          <button
            type="button"
            className={navBtn}
            onClick={handleOpenExternal}
            disabled={!currentUrl || isBlankPage}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </Tip>

        {/* Close button — always present */}
        <Tip label={t('browserPanel.close')} position="bottom" align="end">
          <button type="button" className={navBtn} onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </Tip>

        {/* Loading progress indicator */}
        {isLoading && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
            <div className="animate-indeterminate h-full w-1/3 bg-[var(--accent-warm)]" />
          </div>
        )}
      </div>

      {/* Placeholder container — native Webview overlays this area */}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-[var(--paper)]">
        {!hasTabs && !isBlankPage && (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-[var(--ink-subtle)]">
              <Globe className="h-6 w-6" />
              <span className="text-xs">{url ? t('common.loading') : ''}</span>
            </div>
          </div>
        )}

        {/* Blank state — shown for the blank-page sentinel or alive-but-no-url. Click anywhere to focus URL bar. */}
        {isBlankPage && (
          <button
            type="button"
            onClick={handleUrlClick}
            className="group absolute inset-0 flex cursor-text select-none flex-col items-center justify-center bg-[var(--paper)] text-left outline-none"
          >
            {/* Soft radial wash for warmth */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse at 50% 38%, var(--accent-warm-subtle) 0%, var(--accent-warm-subtle-a0) 60%)',
              }}
            />
            <div className="relative flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-elevated)] shadow-md">
                <Globe
                  className="h-7 w-7 text-[var(--accent-warm)]"
                  strokeWidth={1.5}
                />
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="text-base font-medium tracking-tight text-[var(--ink)]">
                  {t('browserPanel.newTab')}
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  {t('browserPanel.blankHint')}
                </div>
              </div>
            </div>
          </button>
        )}

        {(isDraggingSplit || isSplitTransitioning) && hasTabs && !isBlankPage && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--paper)]/80 backdrop-blur-md">
            <div className="flex flex-col items-center gap-2 text-[var(--ink-subtle)]">
              <Globe className="h-5 w-5" />
              <span className="text-xs">{displayUrl}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
