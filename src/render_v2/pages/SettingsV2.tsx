/**
 * SettingsV2 — v2 Settings page per the [final] cTjk2 "经典设置（侧边导航）" comp.
 *
 * Frame = ChromeBar(38) + Body. AppV2 already renders the fused Chrome, so this
 * page implements only Body: NavSidebar (208w) + ContentPanel (1232w). The
 * ContentPanel holds a PanelHead (Playfair Display panel title + description)
 * and a BentoGrid of four tiles (外观 776w + 启动 392w / 队列 584w + 工作区 584w).
 *
 * Static prototype: the tiles render the comp's sample values (语言=跟随系统…)
 * until the settings config is wired. Nav clicks stay on 通用设置.
 *
 * Font notes: PanelTitle is 26px — not in the locked seven-step scale
 * (2xl=22 / 3xl=28), so text-2xl (22px) is used and letterSpacing -0.02 is
 * dropped. PanelDesc is 13px → text-xs (12px).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FolderOpen,
    Globe,
    HardDrive,
    ListOrdered,
    MessageSquare,
    Monitor,
    MoonStar,
    Palette,
    PanelBottom,
    Power,
    Rocket,
    SwatchBook,
} from 'lucide-react';

import NavSidebar from '../components/settings/NavSidebar';
import SettingTile from '../components/settings/SettingTile';

export default memo(function SettingsV2() {
    const { t } = useTranslation('app');

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--paper)]">
            {/* Left navigation — 208w */}
            <NavSidebar />

            {/* Right content panel — 1232w, padding 24 */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
                {/* Panel head */}
                <div className="flex flex-col gap-1">
                    <h1 className="font-serif text-2xl font-semibold text-[var(--ink)]">
                        {t('v2.settings.panelTitle')}
                    </h1>
                    <p className="text-xs text-[var(--ink-muted)]">
                        {t('v2.settings.panelDesc')}
                    </p>
                </div>

                {/* Bento grid — two rows: [776|392] then [584|584] */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                        <SettingTile
                            titleKey="appearance"
                            headerIcon={Palette}
                            className="w-[776px]"
                            rows={[
                                { icon: Globe, label: 'language', value: 'languageValue' },
                                { icon: Monitor, label: 'appearanceMode', value: 'appearanceModeValue' },
                                { icon: SwatchBook, label: 'themePreset', value: 'themePresetValue' },
                            ]}
                        />
                        <SettingTile
                            titleKey="startup"
                            headerIcon={Rocket}
                            className="w-[392px]"
                            rows={[
                                { icon: Power, label: 'launchOnStartup', value: 'onValue' },
                                { icon: PanelBottom, label: 'minimizeToTray', value: 'onValue' },
                                { icon: MoonStar, label: 'preventSleep', value: 'offValue' },
                            ]}
                        />
                    </div>
                    <div className="flex items-center gap-4">
                        <SettingTile
                            titleKey="queue"
                            headerIcon={ListOrdered}
                            className="w-[584px]"
                            rows={[{ icon: MessageSquare, label: 'queueResponse', value: 'queueResponseValue' }]}
                        />
                        <SettingTile
                            titleKey="workspace"
                            headerIcon={HardDrive}
                            className="w-[584px]"
                            rows={[{ icon: FolderOpen, label: 'defaultWorkspace', value: 'defaultWorkspaceValue' }]}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});
