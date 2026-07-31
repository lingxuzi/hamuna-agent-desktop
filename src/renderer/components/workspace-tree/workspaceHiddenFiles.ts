/**
 * Hidden-files toggle: kept off the default UI on purpose.
 *
 * The workspace tree hides dotfile nodes (`.env`, `.vscode`, …) by default;
 * the toggle that flips this lives nowhere in the chrome so casual users
 * never see a "show hidden files" affordance. Power users unlock it via a
 * 5-click easter egg on the Settings → About → Website link (see
 * `SettingsPage.tsx::handleWebsiteTap`). Because the trigger lives in a
 * sibling subtree (Settings overlay, not Chat tree), we can't pipe the
 * signal through React props — a tiny module-scoped emitter bridges the two.
 *
 * Why an emitter instead of context: the toggle state has exactly one
 * producer (the easter-egg) and one consumer (`useWorkspaceTreeModel`,
 * scoped to a single Chat tab). Anything heavier than a `Set<callback>`
 * would be over-engineered for a state shape that is "fire once, store
 * locally, no cross-tab sync required".
 *
 * Why a Set (not a counter): the model owns the boolean; the emitter
 * just notifies. Subscribers read the latest value via their own hook
 * (`showHidden`). The emitter avoids stale-closure footguns by being
 * called once per tap, never with a value.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Notify every subscriber that a toggle was requested. */
export function dispatchToggleWorkspaceHiddenFiles(): void {
  for (const listener of listeners) {
    // Swallow per-listener errors so a buggy subscriber cannot block the
    // rest. The error is logged (console.error survives both renderer and
    // jsdom) so the failure remains observable.
    try {
      listener();
    } catch (error) {
      console.error("[workspaceHiddenFiles] subscriber threw", error);
    }
  }
}

/** Subscribe to toggle requests. Returns an unsubscribe function. */
export function subscribeWorkspaceHiddenFilesToggle(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}