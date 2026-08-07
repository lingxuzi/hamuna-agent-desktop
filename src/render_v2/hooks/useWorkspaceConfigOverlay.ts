/**
 * useWorkspaceConfigOverlay — mounts the Workspace Config full-screen overlay
 * when the hash's first segment is `workspace-config` (`/#workspace-config`).
 *
 * Deliberately separate from the tab-view state (useTabs / V2_VIEWS): the
 * overlay is not a Tab view (v1's Tab['view'] is a closed 5-value union), so it
 * can't ride parseInitialView. Same dev smoke-test aid — harmless in prod (no
 * hash → false). Renders above Chrome in AppV2 via z-50.
 */
import { useState } from 'react';

const WORKSPACE_CONFIG_HASH = 'workspace-config';

export function useWorkspaceConfigOverlay(): boolean {
    const [open] = useState(() => {
        if (typeof window === 'undefined') return false;
        const view = window.location.hash.replace(/^#/, '').split('/')[0];
        return view === WORKSPACE_CONFIG_HASH;
    });
    return open;
}
