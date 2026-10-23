/** Global sidebar geometry preference. Kept free of React so both the resize
 *  handle and App-level state read the same clamp/fallback rules. */

export const GLOBAL_SIDEBAR_DEFAULT_WIDTH = 256;
export const GLOBAL_SIDEBAR_MIN_WIDTH = 224;
export const GLOBAL_SIDEBAR_MAX_WIDTH = 480;
export const GLOBAL_SIDEBAR_RAIL_WIDTH = 64;

/** Window-x of the sidebar toggle in both modes. On macOS it must clear the
 *  traffic lights, which live over the sidebar; in rail mode the control
 *  therefore overhangs the 64px rail and sits on the titlebar surface. Keeping
 *  one coordinate in both modes is what stops the button from jumping when the
 *  sidebar collapses. */
export const GLOBAL_SIDEBAR_TOGGLE_INSET = 84;
/** Leading slot the titlebar must reserve in rail mode so the first Tab never
 *  renders under the overhanging toggle: toggle inset + its 28px box + 8px gap,
 *  minus the rail that already sits left of the titlebar. */
export const GLOBAL_SIDEBAR_RAIL_TITLEBAR_INSET =
  GLOBAL_SIDEBAR_TOGGLE_INSET + 28 + 8 - GLOBAL_SIDEBAR_RAIL_WIDTH;

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
