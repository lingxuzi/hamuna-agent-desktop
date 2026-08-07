/**
 * LauncherV2 — v2 Launcher page per the [final] qjQtx "品牌驱动（杂志封面）" comp.
 *
 * 60/40 split: left BrandPanel is the magazine-cover hero (logo, serif headline,
 * quick input); right RailPanel floats the workspace cards + recent sessions on
 * a warm paper card. Workspaces and recent sessions render live data from the
 * shared stores (useConfig / taskCenterStore) — the comp's sample texts are the
 * empty/sample states, not hardcoded content.
 *
 * Navigation is handled by the parent (AppV2) — this page emits intents via
 * callbacks, it owns no routing.
 */
import { memo } from 'react';

import { useLauncherData } from '../hooks/useLauncherData';
import BrandPanel from '../components/launcher/BrandPanel';
import RailPanel from '../components/launcher/RailPanel';

interface LauncherV2Props {
    /** Open a chat on the given workspace (or null to open a fresh one). */
    onLaunchChat: (workspaceId?: string) => void;
}

export default memo(function LauncherV2({ onLaunchChat }: LauncherV2Props) {
    const data = useLauncherData();

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
            <BrandPanel
                isLoading={data.isLoading}
                onLaunchChat={onLaunchChat}
            />
            <RailPanel
                workspaces={data.workspaces}
                recentSessions={data.recentSessions}
                onLaunchChat={onLaunchChat}
            />
        </div>
    );
});
