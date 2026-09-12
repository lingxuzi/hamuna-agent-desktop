/**
 * ForceUpdateModal — full-screen, undismissable update prompt.
 *
 * Triggered by `useUpdater.forceUpdateActive`. While mounted:
 * - The whole app behind the modal is unreachable (backdrop intercepts clicks).
 * - `useCloseLayer` is intentionally NOT called — there's no "close" path.
 * - Cmd/Ctrl+W / Esc / Cmd+T / Cmd+1~9 / Cmd+Y / Cmd+U / Cmd+R / F5 are all
 *   swallowed here in capture-phase so they never reach the global app-shortcut
 *   table (which would otherwise fall through to newTab / closeCurrentTab).
 * - Cmd+Q / Alt+F4 / Dock Quit are NOT intercepted — the "Quit App" button
 *   routes through the existing `tray:confirm-exit` channel so the run-loop's
 *   ExitRequested cleanup still runs, but the user can still quit by OS
 *   shortcut if they really want to skip the upgrade. (Acceptance: render-
 *   layer block, not OS-level force.)
 *
 * Two buttons only: "立即更新" and "退出 App". The update button reuses the
 * existing `restartAndUpdate()` install path — Windows NSIS via `install_pending_update`,
 * macOS/Linux relaunch via `cmd_shutdown_for_update` + `relaunch`.
 *
 * Why this is NOT built on `ConfirmDialog`: `ConfirmDialog` always has an `onCancel`
 * that Esc / overlay-click / Cmd+W all funnel into. ForceUpdateModal has no
 * cancel semantic; the only way out is "立即更新" or "退出 App".
 */
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ForceUpdateModalProps {
  /** New version string. Null while still preparing; modal still blocks either way. */
  updateVersion: string | null;
  /** Release notes / changelog from the update manifest, if available. */
  updateNotes?: string | null;
  /** Install in flight — disables "立即更新" to prevent double-clicks. */
  updating: boolean;
  /** Click handler for "立即更新" — invoke restartAndUpdate + tab-state flush. */
  onUpdate: () => void;
  /** Click handler for "退出 App" — invoke cmd_quit_app. */
  onQuit: () => void;
}

/** Capture-phase keydown interceptor. Registered globally so it runs BEFORE the
 *  App.tsx keydown handler that feeds `dispatchAppShortcut` — without capture,
 *  a component that calls stopPropagation (Monaco, etc.) could leak through. */
function useForceUpdateKeyboardBlock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const ac = new AbortController();
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const modHeld = isMac ? e.metaKey : e.ctrlKey;
      // Eat Escape, any Cmd/Ctrl combo, and F5. This covers the full
      // APP_SHORTCUTS table (close-tab / new-tab / cycle-tab / jump-to-tab /
      // open-task-center / open-settings / block-reload). The app-wide
      // keydown handler still runs after this capture handler, but because
      // `dispatchAppShortcut` short-circuits on `preventDefault`, the
      // matched shortcut never executes.
      if (e.key === 'Escape' || modHeld || e.key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    ac.signal.addEventListener('abort', () => {
      window.removeEventListener('keydown', handler, { capture: true });
    });
    return () => ac.abort();
  }, [active]);
}

/** Lock body scroll while modal is mounted. Pure visual guard — the modal itself
 *  is position:fixed and not scrollable. */
function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

export default function ForceUpdateModal({
  updateVersion,
  updateNotes,
  updating,
  onUpdate,
  onQuit,
}: ForceUpdateModalProps) {
  const { t } = useTranslation('app');
  const active = true; // Mounted == active; this component is rendered only when forceUpdateActive.

  useForceUpdateKeyboardBlock(active);
  useBodyScrollLock(active);

  // Refs so the stable `useEffect` keydown handler reads the latest props
  // without rebuilding on every render — see react_stability_rules Rule 3.
  // Synchronized inside useEffect (not during render) per react-hooks/refs.
  const updatingRef = useRef(updating);
  const onUpdateRef = useRef(onUpdate);
  const onQuitRef = useRef(onQuit);
  useEffect(() => {
    updatingRef.current = updating;
    onUpdateRef.current = onUpdate;
    onQuitRef.current = onQuit;
  }, [updating, onUpdate, onQuit]);

  const handleUpdate = useCallback(() => {
    if (updatingRef.current) return;
    onUpdateRef.current();
  }, []);

  const handleQuit = useCallback(() => {
    onQuitRef.current();
  }, []);

  const titleId = 'force-update-title';
  const descId = 'force-update-desc';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      // z-[9999] > all other overlays (Cmd+W blocker / ConfirmDialog z-300 /
      // BugReportOverlay etc.). backdrop-blur + bg-black/60 mirror the existing
      // APP_SHORTCUTS close-tab guard `hasBlockingBackdrop` check (App.tsx) so
      // even if a child bubble ever escapes, Cmd+W short-circuits at the guard.
      // No onMouseDown handler: clicking the backdrop is a no-op — the only way
      // out is one of the two buttons.
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="glass-panel w-full max-w-md px-6 py-5 shadow-2xl">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">
            {t('updater.force.title')}
          </h2>
        </div>
        <div className="py-4">
          <p id={descId} className="whitespace-pre-line text-sm leading-relaxed text-[var(--ink-muted)]">
            {updateVersion
              ? t('updater.force.descriptionWithVersion', { version: updateVersion })
              : t('updater.force.description')}
          </p>
          {updateNotes && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-[var(--ink-muted)]">{t('updater.force.releaseNotes')}</p>
              <div className="max-h-32 overflow-y-auto rounded-md bg-[var(--bg-tertiary)] p-2.5 text-xs leading-relaxed text-[var(--ink-muted)] whitespace-pre-wrap">
                {updateNotes}
              </div>
            </div>
          )}
          {updating && (
            <div className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t('updater.force.installing')}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-3">
          <button
            type="button"
            onClick={handleQuit}
            disabled={updating}
            data-testid="force-update-quit"
            className="rounded-full bg-[var(--button-secondary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--button-secondary-bg-hover)] disabled:opacity-50"
          >
            {t('updater.force.quitApp')}
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            data-testid="force-update-update"
            className="flex items-center gap-1.5 rounded-full bg-[var(--button-primary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
          >
            {updating && <Loader2 className="h-3 w-3 animate-spin" />}
            {updating ? t('updater.force.installing') : t('updater.force.updateNow')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}