/** Global sidebar geometry preference. Kept free of React so both the resize
 *  handle and App-level state read the same clamp/fallback rules. */

export const GLOBAL_SIDEBAR_DEFAULT_WIDTH = 256;
export const GLOBAL_SIDEBAR_MIN_WIDTH = 224;
export const GLOBAL_SIDEBAR_MAX_WIDTH = 480;
export const GLOBAL_SIDEBAR_RAIL_WIDTH = 64;

/** Sidebar toggle button box (MyAgents parity: 32px hit target, not 28px). */
export const GLOBAL_SIDEBAR_TOGGLE_SIZE = 32;
/** Horizontal inset of the toggle inside the sidebar. Sized so the button's
 *  16px glyph lands on the nav icon axis (12px nav gutter + 12px row padding
 *  = 24px, minus the 8px half-button offset), so the control reads as the
 *  first row of the sidebar rather than a stray chip floating in the header. */
export const GLOBAL_SIDEBAR_TOGGLE_INSET = 16;
/** On macOS the native traffic lights float over the webview, so the toggle
 *  must clear them; that pushes the control out of the 64px rail and onto the
 *  titlebar surface in rail mode. Every other platform keeps its window chrome
 *  outside the webview, so the toggle stays inside the rail. */
export const GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET = 84;
/** Leading slot the titlebar must reserve in rail mode so the first Tab never
 *  renders under the overhanging toggle: toggle inset + its button box + 8px
 *  gap, minus the rail that already sits left of the titlebar. macOS only —
 *  elsewhere the toggle never leaves the rail, so the titlebar needs no slot. */
export const GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET =
  GLOBAL_SIDEBAR_MACOS_TOGGLE_INSET + GLOBAL_SIDEBAR_TOGGLE_SIZE + 8 - GLOBAL_SIDEBAR_RAIL_WIDTH;

export type GlobalSidebarMode = 'expanded' | 'rail';

export interface GlobalSidebarPreference {
  mode: GlobalSidebarMode;
  width: number;
}

export const GLOBAL_SIDEBAR_STORAGE_KEY = 'hamuna.globalSidebar.v1';

const DEFAULT_PREFERENCE: GlobalSidebarPreference = {
  mode: 'expanded',
  width: GLOBAL_SIDEBAR_DEFAULT_WIDTH,
};

export function normalizeGlobalSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return GLOBAL_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    GLOBAL_SIDEBAR_MAX_WIDTH,
    Math.max(GLOBAL_SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

export function parseGlobalSidebarPreference(raw: string | null): GlobalSidebarPreference {
  if (!raw) return DEFAULT_PREFERENCE;
  try {
    const parsed = JSON.parse(raw) as Partial<GlobalSidebarPreference> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFERENCE;
    return {
      mode: parsed.mode === 'rail' ? 'rail' : 'expanded',
      width: normalizeGlobalSidebarWidth(
        typeof parsed.width === 'number' ? parsed.width : GLOBAL_SIDEBAR_DEFAULT_WIDTH,
      ),
    };
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export function readGlobalSidebarPreference(): GlobalSidebarPreference {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCE;
  try {
    return parseGlobalSidebarPreference(localStorage.getItem(GLOBAL_SIDEBAR_STORAGE_KEY));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export function writeGlobalSidebarPreference(preference: GlobalSidebarPreference): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      GLOBAL_SIDEBAR_STORAGE_KEY,
      JSON.stringify({ version: 1, mode: preference.mode, width: normalizeGlobalSidebarWidth(preference.width) }),
    );
  } catch {
    // Storage full / disabled: geometry still works for this session.
  }
}
