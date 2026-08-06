/**
 * SettingsV2 — v2 Settings page (Pencil [final] cTjk2 "经典侧边导航" + t2DE7F
 * "Bento 卡片").
 *
 * Left: SettingsSidebar (reused from v1) — nav across 11 sections.
 * Right: section body. `general` is rewritten as the Pencil BentoGrid
 * (2×2 tiles: 外观 / 启动 / 队列 / 工作区) plus the trailing
 * notification / proxy / logs cards v1 carries; everything else reuses v1
 * shared panels (GlobalPluginsPanel, BotPlatformRegistry, UsageStatsPanel,
 * SkillsAgentsSection, FloatingBallPetSettings, …) so only the visual shell
 * is v2.
 *
 * All visual values map to theme tokens — no orphan hex/px.
 */
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettingsNavigation } from '@/pages/settings/hooks/useSettingsNavigation';
import { VALID_SECTIONS, type SettingsSection } from '@/pages/settings/settingsSections';
import { SettingsSidebar } from '@/pages/settings/components/SettingsSidebar';
import { AppearanceModeControl } from '@/pages/settings/components/AppearanceModeControl';
import { ThemePresetSelect } from '@/pages/settings/components/ThemePresetSelect';
import { SpaceEnvironmentSwitch } from '@/pages/settings/components/SpaceEnvironmentSwitch';
import { SkillsAgentsSection } from '@/pages/settings/sections/SkillsAgentsSection';
import GlobalPluginsPanel from '@/components/GlobalPluginsPanel';
import { BotPlatformRegistry } from '@/components/ImSettings';
import UsageStatsPanel from '@/components/UsageStatsPanel';
import FloatingBallPetSettings from '@/components/FloatingBallPetSettings';
import ProxyScopeDialog from '@/components/ProxyScopeDialog';
import CustomSelect from '@/components/CustomSelect';
import { Toggle } from '@/components/task-center/editors/PanelChrome';
import { useConfig } from '@/hooks/useConfig';
import { useSpaceBuildCapability } from '@/hooks/useSpaceBuildCapability';
import type { SpaceEnvironment } from '../../shared/config-types';

import { useGeneralSettingsV2 } from '../hooks/useGeneralSettingsV2';
import { BentoCard, SettingRow, RowDivider } from '../components/settings/Bento';

interface SettingsV2Props {
    onShowLogs: () => void;
    /** Deep-link target from outside (Launcher hint, helper prompt, …). */
    initialSection?: string;
}

/** Dev smoke-test aid: `/#settings/general` mounts that section directly so
 *  the Bento layout can be screenshot-verified without clicking nav. Mirrors
 *  useTabs#parseInitialView; harmless in prod (no hash → v1 default). */
function parseSettingsSection(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    const raw = window.location.hash.replace(/^#/, '').split('/')[1];
    return raw && VALID_SECTIONS.includes(raw as SettingsSection) ? raw : undefined;
}

export default function SettingsV2({ onShowLogs, initialSection }: SettingsV2Props) {
    const { t } = useTranslation('settings');
    const { config, updateConfig, providers } = useConfig();
    const spaceBuildCapability = useSpaceBuildCapability(config.spaceEnvironment);
    const g = useGeneralSettingsV2();
    const { activeSection, setActiveSection, proxySectionRef, highlightProxySection } = useSettingsNavigation({
        initialSection: initialSection ?? parseSettingsSection(),
    });

    // Respond to `#settings/<section>` hash changes at runtime so the
    // dev-only deep-link (and any external navigation) can switch sections
    // without a full reload. No-op when the hash isn't settings-scoped.
    useEffect(() => {
        const onHashChange = () => {
            const section = parseSettingsSection();
            if (section && section !== activeSection) setActiveSection(section as SettingsSection);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [activeSection, setActiveSection]);

    const renderGeneral = useMemo(() => (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">{t('general.title')}</h2>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('general.description')}</p>
            </div>

            {/* BentoGrid — 2×2 tiles per Pencil t2DE7F */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Tile 外观 */}
                <BentoCard title={t('general.appearanceTitle')}>
                    <SettingRow label={t('general.languageTitle')} description={t('general.languageDescription')}>
                        <CustomSelect
                            value={g.uiLanguage}
                            options={g.languageOptions}
                            onChange={g.onLanguageChange}
                            className="w-[220px]"
                        />
                    </SettingRow>
                    <RowDivider />
                    <SettingRow label={t('general.appearanceModeTitle')}>
                        <AppearanceModeControl
                            value={config.appearanceMode}
                            onChange={(mode) => void updateConfig({ appearanceMode: mode })}
                        />
                    </SettingRow>
                    <RowDivider />
                    <SettingRow label={t('general.themeTitle')} description={t('general.themeDescription')}>
                        <ThemePresetSelect
                            value={g.themeId}
                            onPersistTheme={g.onPersistTheme}
                            onPersistError={g.onPersistThemeError}
                        />
                    </SettingRow>
                </BentoCard>

                {/* Tile 启动 */}
                <BentoCard title={t('general.startupTitle')}>
                    <SettingRow label={t('general.autostartTitle')} description={t('general.autostartDescription')}>
                        <Toggle
                            checked={g.autostartEnabled}
                            onChange={() => void g.onToggleAutostart()}
                            disabled={g.autostartLoading}
                            ariaLabel={t('general.autostartTitle')}
                        />
                    </SettingRow>
                    <RowDivider />
                    <SettingRow label={t('general.minimizeToTrayTitle')} description={t('general.minimizeToTrayDescription')}>
                        <Toggle checked={g.minimizeToTray} onChange={g.onToggleMinimizeToTray} ariaLabel={t('general.minimizeToTrayTitle')} />
                    </SettingRow>
                    <RowDivider />
                    <SettingRow label={t('general.forceWakeTitle')} description={t('general.forceWakeDescription')}>
                        <Toggle checked={g.forceWakeLock} onChange={g.onToggleForceWake} ariaLabel={t('general.forceWakeTitle')} />
                    </SettingRow>
                </BentoCard>

                {/* Tile 队列 */}
                <BentoCard title={t('general.queueTitle')}>
                    <SettingRow label={t('general.queueModeTitle')}>
                        <div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
                            {(['realtime', 'turn'] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => g.onQueueModeChange(mode)}
                                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                        g.queueMode === mode
                                            ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                            : 'bg-transparent text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'
                                    }`}
                                >
                                    {t(mode === 'realtime' ? 'general.queueRealtime' : 'general.queueTurn')}
                                </button>
                            ))}
                        </div>
                    </SettingRow>
                </BentoCard>

                {/* Tile 工作区 */}
                <BentoCard title={t('general.workspaceTitle')}>
                    <SettingRow label={t('general.defaultWorkspaceTitle')} description={t('general.defaultWorkspaceDescription')}>
                        <CustomSelect
                            value={g.defaultWorkspacePath}
                            options={[
                                { value: '', label: t('general.defaultWorkspaceNone') },
                                ...g.projects.map((p) => ({ value: p.path, label: p.displayName })),
                            ]}
                            onChange={g.onDefaultWorkspaceChange}
                            className="w-[240px]"
                            placeholder={t('general.defaultWorkspaceNone')}
                        />
                    </SettingRow>
                </BentoCard>
            </div>

            {/* Notifications */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
                <h3 className="text-base font-medium text-[var(--ink)]">{t('general.notificationTitle')}</h3>
                <SettingRow label={t('general.notificationEnableTitle')} description={t('general.notificationEnableDescription')}>
                    <Toggle checked={g.osNotifications} onChange={g.onToggleNotifications} ariaLabel={t('general.notificationEnableTitle')} />
                </SettingRow>
                {g.osNotifications && (
                    <>
                        <RowDivider />
                        <SettingRow label={t('general.notificationSoundTitle')} description={t('general.notificationSoundDescription')}>
                            <Toggle checked={g.notificationSound} onChange={g.onToggleSound} ariaLabel={t('general.notificationSoundTitle')} />
                        </SettingRow>
                        <RowDivider />
                        <SettingRow label={t('general.notificationBadgeTitle')} description={t('general.notificationBadgeDescription')}>
                            <Toggle checked={g.notificationBadge} onChange={g.onToggleBadge} ariaLabel={t('general.notificationBadgeTitle')} />
                        </SettingRow>
                    </>
                )}
            </div>

            {/* Proxy — proxySectionRef is the navigateToProxySettings scroll target */}
            <div
                ref={proxySectionRef}
                className={`rounded-xl border bg-[var(--paper-elevated)] p-5 transition-shadow ${
                    highlightProxySection ? 'border-[var(--accent)] shadow-md' : 'border-[var(--line)]'
                }`}
            >
                <h3 className="text-base font-medium text-[var(--ink)]">{t('general.proxyTitle')}</h3>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('general.proxyDescription')}</p>
                <SettingRow label={t('general.proxyEnableTitle')} description={t('general.proxyEnableDescription')}>
                    <Toggle checked={g.proxyEnabled} onChange={g.onToggleProxy} ariaLabel={t('general.proxyEnableTitle')} />
                </SettingRow>

                {g.proxyEnabled && (
                    <>
                        <RowDivider />
                        <SettingRow label={t('general.proxyScopeTitle')}>
                            <div className="flex items-center gap-2">
                                <div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
                                    <button
                                        type="button"
                                        onClick={g.onOpenProxyScopeDialog}
                                        className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                            g.proxyScopeMode === 'all'
                                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                                : 'bg-transparent text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'
                                        }`}
                                    >
                                        {t('general.proxyScopeAll')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={g.onOpenProxyScopeDialog}
                                        className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                            g.proxyScopeMode === 'custom'
                                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                                : 'bg-transparent text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'
                                        }`}
                                    >
                                        {t('general.proxyScopeCustom')}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={g.onOpenProxyScopeDialog}
                                    aria-label={t('general.proxyScopeDialogTitle')}
                                    className="rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                                >
                                    ⚙
                                </button>
                            </div>
                        </SettingRow>
                        <RowDivider />
                        <SettingRow label={t('general.proxyProtocol')}>
                            <CustomSelect
                                value={g.proxyProtocol}
                                options={[
                                    { value: 'http', label: 'HTTP' },
                                    { value: 'https', label: 'HTTPS' },
                                    { value: 'socks5', label: 'SOCKS5' },
                                ]}
                                onChange={g.onProtocolChange}
                                className="w-[160px]"
                            />
                        </SettingRow>
                        <RowDivider />
                        <SettingRow label={t('general.proxyServer')}>
                            <input
                                value={g.proxyHostDraft}
                                onChange={(e) => g.onProxyHostDraftChange(e.target.value)}
                                onBlur={g.commitProxyHost}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                placeholder={config.proxySettings?.host || ''}
                                className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--accent)] focus:outline-none"
                            />
                        </SettingRow>
                        <RowDivider />
                        <SettingRow label={t('general.proxyPort')}>
                            <input
                                value={g.proxyPortDraft}
                                onChange={(e) => g.onProxyPortDraftChange(e.target.value.replace(/\D/g, ''))}
                                onBlur={g.commitProxyPort}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                placeholder={String(config.proxySettings?.port ?? '')}
                                className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--accent)] focus:outline-none"
                            />
                        </SettingRow>
                    </>
                )}
            </div>

            {/* Logs export */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
                <h3 className="text-base font-medium text-[var(--ink)]">{t('general.logsTitle')}</h3>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('general.logsDescription')}</p>
                <div className="mt-3">
                    <button
                        type="button"
                        onClick={g.onExportLogs}
                        disabled={g.logExporting}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--button-secondary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--button-secondary-bg-hover)] disabled:opacity-50"
                    >
                        {g.logExporting ? t('general.logsExporting') : t('general.logsExport')}
                    </button>
                </div>
            </div>
        </div>
    ), [t, config, g, proxySectionRef, highlightProxySection, updateConfig]);

    return (
        <div className="flex h-full overflow-hidden bg-[var(--paper)]">
            <SettingsSidebar
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                showDevTools={config.showDevTools}
                floatingBallDevGate={config.floatingBallDevGate}
                onShowLogs={onShowLogs}
            />
            <div className="h-full flex-1 overflow-y-auto overscroll-contain">
                {activeSection === 'general' && renderGeneral}
                {(activeSection === 'skills' || activeSection === 'sub-agents') && (
                    <SkillsAgentsSection />
                )}
                {activeSection === 'plugins' && (
                    <div className="mx-auto max-w-4xl px-8 py-8">
                        <GlobalPluginsPanel />
                    </div>
                )}
                {activeSection === 'agent' && (
                    <div className="mx-auto max-w-4xl px-8 py-8">
                        <BotPlatformRegistry />
                    </div>
                )}
                {activeSection === 'usage-stats' && (
                    <div className="mx-auto max-w-4xl px-8 py-8">
                        <UsageStatsPanel />
                    </div>
                )}
                {activeSection === 'desktop-pet' && config.floatingBallDevGate !== false && (
                    <FloatingBallPetSettings />
                )}
                {activeSection === 'about' && (
                    <AboutSection
                        available={spaceBuildCapability.available}
                        baseUrl={spaceBuildCapability.baseUrl ?? null}
                        activeEnvironment={config.spaceEnvironment ?? 'production'}
                        onEnvironmentChange={(env) => void updateConfig({ spaceEnvironment: env })}
                    />
                )}
                {(activeSection === 'mcp' || activeSection === 'providers') && (
                    <UnportedSection activeSection={activeSection} />
                )}
            </div>

            {g.showProxyScopeDialog && (
                <ProxyScopeDialog
                    providers={providers}
                    initialGeneralRequests={true}
                    initialProviderIds={[]}
                    onClose={g.onCloseProxyScopeDialog}
                    onSave={g.onSaveProxyScope}
                />
            )}
        </div>
    );
}

/** About section — reuse SpaceEnvironmentSwitch (shared), minimal v2 shell. */
function AboutSection({
    available,
    baseUrl,
    activeEnvironment,
    onEnvironmentChange,
}: {
    available: boolean;
    baseUrl: string | null;
    activeEnvironment: SpaceEnvironment;
    onEnvironmentChange: (env: SpaceEnvironment) => void;
}) {
    const { t } = useTranslation('settings');
    return (
        <div className="mx-auto max-w-4xl px-8 py-8">
            {available && baseUrl && (
                <SpaceEnvironmentSwitch
                    activeEnvironment={activeEnvironment}
                    origin={baseUrl}
                    onChange={onEnvironmentChange}
                />
            )}
            <h2 className="mt-6 text-lg font-semibold text-[var(--ink)]">{t('about.title')}</h2>
        </div>
    );
}

/**
 * v1 的 mcp / providers sections 是 SettingsPage monolith 内联 JSX（约 1000 行，
 * 深耦合 vision / OAuth / runtime-dialog / helper 编排 state），没有可复用的
 * shared panel。Step 4 范围 = Bento general + 无 state 依赖的 shared panels；
 * 这两个 section 先诚实占位，标注未移植。
 */
function UnportedSection({ activeSection }: { activeSection: string }) {
    const { t } = useTranslation('settings');
    return (
        <div className="mx-auto max-w-4xl px-8 py-8">
            <h2 className="text-lg font-semibold text-[var(--ink)]">
                {activeSection === 'mcp' ? t('toolbox.title') : t('providers.title')}
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('providers.description')}</p>
        </div>
    );
}
