/**
 * useGeneralSettingsV2 — general-section state container for SettingsV2.
 *
 * v1 general section (SettingsPage.tsx L4271-4817) is a monolith of inline
 * JSX + inline state. This hook extracts the *state and handlers* that the
 * Pencil Bento layout (appearance/startup/queue/workspace) + the trailing
 * notification/proxy/logs cards need, so SettingsV2 renders against it.
 *
 * The heavy proxy logic (draft/commit/probe/scope) is lifted verbatim from
 * v1 L462-567 + L2675-2715 — same semantics, same debounce, same guard rails.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConfig } from '@/hooks/useConfig';
import { useAutostart } from '@/hooks/useAutostart';
import { useResolvedTheme } from '@/theme/ThemeRuntime';
import { useToast } from '@/components/Toast';
import { apiGetJson } from '@/api/apiFetch';
import { invoke } from '@tauri-apps/api/core';
import {
    normalizeChatQueueResponseMode,
    PROXY_DEFAULTS,
    isValidProxyHost,
    type ChatQueueResponseMode,
} from '../../shared/config-types';
import { normalizeProxyScope } from '../../shared/proxyScope';
import { describeProxyScopeSummary, type ProxyScopeSummaryDescriptor } from '@/pages/settings/proxyScopePresentation';
import type { NetworkProbeResult, ProxyProbeState } from '@/pages/settings/types';

export interface GeneralSettingsV2 {
    // Appearance
    languageOptions: { value: string; label: string }[];
    uiLanguage: string;
    onLanguageChange: (value: string) => void;
    themeId: string;
    onPersistTheme: (themeId: string) => Promise<void>;
    onPersistThemeError: (error: unknown) => void;

    // Startup
    autostartEnabled: boolean;
    autostartLoading: boolean;
    onToggleAutostart: () => void;
    minimizeToTray: boolean;
    onToggleMinimizeToTray: () => void;
    forceWakeLock: boolean;
    onToggleForceWake: () => void;

    // Queue
    queueMode: ChatQueueResponseMode;
    onQueueModeChange: (mode: ChatQueueResponseMode) => void;

    // Notifications
    osNotifications: boolean;
    onToggleNotifications: () => void;
    notificationSound: boolean;
    onToggleSound: () => void;
    notificationBadge: boolean;
    onToggleBadge: () => void;

    // Workspace
    projects: { path: string; displayName: string }[];
    defaultWorkspacePath: string;
    onDefaultWorkspaceChange: (path: string) => void;

    // Proxy
    proxyEnabled: boolean;
    onToggleProxy: () => void;
    proxyScopeMode: 'all' | 'custom';
    proxyScopeSummaryDescriptor: ProxyScopeSummaryDescriptor;
    onOpenProxyScopeDialog: () => void;
    showProxyScopeDialog: boolean;
    onCloseProxyScopeDialog: () => void;
    onSaveProxyScope: (s: { generalRequests: boolean; providerIds: string[] }) => void;
    proxyProtocol: string;
    onProtocolChange: (p: string) => void;
    proxyHostDraft: string;
    proxyPortDraft: string;
    onProxyHostDraftChange: (v: string) => void;
    onProxyPortDraftChange: (v: string) => void;
    commitProxyHost: () => void;
    commitProxyPort: () => void;
    proxyProbeState: ProxyProbeState;
    proxyAppliedHint: string;
    proxySectionRef: React.RefObject<HTMLDivElement | null>;
    highlightProxySection: boolean;

    // Logs export
    logExporting: boolean;
    onExportLogs: () => void;
}

export function useGeneralSettingsV2(): GeneralSettingsV2 {
    const { t } = useTranslation('settings');
    const { t: tCommon } = useTranslation('common');
    const toast = useToast();
    const {
        config,
        updateConfig,
        patchProxySettings,
        providers,
        projects,
    } = useConfig();
    const { isEnabled: autostartEnabled, isLoading: autostartLoading, setAutostart } = useAutostart();
    const { themeId } = useResolvedTheme();

    const languageOptions = useMemo(
        () => [
            { value: 'system', label: tCommon('language.system') },
            { value: 'zh-CN', label: tCommon('language.zhCN') },
            { value: 'en-US', label: tCommon('language.enUS') },
        ],
        [tCommon],
    );
    const uiLanguage = config.uiLanguage ?? 'system';
    const onLanguageChange = useCallback(
        async (value: string) => {
            await updateConfig({ uiLanguage: value as never });
            toast.success(t('general.languageChanged'));
        },
        [updateConfig, toast, t],
    );
    const onPersistTheme = useCallback(
        (tid: string) => updateConfig({ themeId: tid, themeSelectionExplicit: true }),
        [updateConfig],
    );
    const onPersistThemeError = useCallback(
        (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(t('general.themeSaveFailed', { message }));
        },
        [toast, t],
    );

    const onToggleAutostart = useCallback(async () => {
        const success = await setAutostart(!autostartEnabled);
        if (success) {
            toast.success(autostartEnabled ? t('general.autostartDisabled') : t('general.autostartEnabled'));
        } else {
            toast.error(t('general.saveFailedRetry'));
        }
    }, [autostartEnabled, setAutostart, toast, t]);
    const onToggleMinimizeToTray = useCallback(() => {
        updateConfig({ minimizeToTray: !config.minimizeToTray });
        toast.success(config.minimizeToTray ? t('general.minimizeToTrayDisabled') : t('general.minimizeToTrayEnabled'));
    }, [config.minimizeToTray, updateConfig, toast, t]);
    const onToggleForceWake = useCallback(() => {
        const next = !config.forceWakeLock;
        updateConfig({ forceWakeLock: next });
        toast.success(next ? t('general.forceWakeEnabled') : t('general.forceWakeDisabled'));
    }, [config.forceWakeLock, updateConfig, toast, t]);

    const queueMode = normalizeChatQueueResponseMode(config.chatQueueResponseMode);
    const onQueueModeChange = useCallback(
        (mode: ChatQueueResponseMode) => updateConfig({ chatQueueResponseMode: mode }),
        [updateConfig],
    );

    const osNotifications = config.osNotifications ?? false;
    const onToggleNotifications = useCallback(() => {
        updateConfig({ osNotifications: !osNotifications });
        toast.success(osNotifications ? t('general.notificationDisabled') : t('general.notificationEnabled'));
    }, [osNotifications, updateConfig, toast, t]);
    const notificationSound = config.notificationSound ?? false;
    const onToggleSound = useCallback(() => {
        updateConfig({ notificationSound: !notificationSound });
        toast.success(notificationSound ? t('general.notificationSoundDisabled') : t('general.notificationSoundEnabled'));
    }, [notificationSound, updateConfig, toast, t]);
    const notificationBadge = config.notificationBadge ?? false;
    const onToggleBadge = useCallback(() => {
        updateConfig({ notificationBadge: !notificationBadge });
        toast.success(notificationBadge ? t('general.notificationBadgeDisabled') : t('general.notificationBadgeEnabled'));
    }, [notificationBadge, updateConfig, toast, t]);

    // --- Proxy (lifted verbatim from v1 L462-567 + L2675-2715) ---
    const proxySectionRef = useRef<HTMLDivElement | null>(null);
    const [proxyHostDraft, setProxyHostDraft] = useState<string>(
        () => config.proxySettings?.host || PROXY_DEFAULTS.host,
    );
    const [proxyPortDraft, setProxyPortDraft] = useState<string>(
        () => String(config.proxySettings?.port || PROXY_DEFAULTS.port),
    );
    const [proxyProbeState, setProxyProbeState] = useState<ProxyProbeState>({ status: 'idle' });
    const [showProxyScopeDialog, setShowProxyScopeDialog] = useState(false);
    const proxyProbeGenerationRef = useRef(0);

    useEffect(() => {
        setProxyHostDraft(config.proxySettings?.host || PROXY_DEFAULTS.host);
    }, [config.proxySettings?.host]);
    useEffect(() => {
        setProxyPortDraft(String(config.proxySettings?.port || PROXY_DEFAULTS.port));
    }, [config.proxySettings?.port]);

    const commitProxyHost = useCallback(() => {
        const host = proxyHostDraft.trim();
        const current = config.proxySettings?.host || PROXY_DEFAULTS.host;
        if (host === '') {
            setProxyHostDraft(PROXY_DEFAULTS.host);
            if (current !== PROXY_DEFAULTS.host) patchProxySettings({ host: PROXY_DEFAULTS.host });
            return;
        }
        if (isValidProxyHost(host)) {
            if (host !== current) patchProxySettings({ host });
        } else {
            setProxyHostDraft(current);
        }
    }, [proxyHostDraft, config.proxySettings?.host, patchProxySettings]);

    const commitProxyPort = useCallback(() => {
        const current = config.proxySettings?.port || PROXY_DEFAULTS.port;
        const port = parseInt(proxyPortDraft, 10);
        if (!isNaN(port) && port >= 1 && port <= 65535) {
            if (port !== current) patchProxySettings({ port });
            setProxyPortDraft(String(port));
        } else {
            setProxyPortDraft(String(current));
        }
    }, [proxyPortDraft, config.proxySettings?.port, patchProxySettings]);

    const proxyEnabled = config.proxySettings?.enabled ?? false;
    const onToggleProxy = useCallback(
        () => patchProxySettings({ enabled: !proxyEnabled }),
        [proxyEnabled, patchProxySettings],
    );

    useEffect(() => {
        if (!proxyEnabled) {
            proxyProbeGenerationRef.current += 1;
            setProxyProbeState({ status: 'idle' });
            return;
        }
        const protocol = config.proxySettings?.protocol || PROXY_DEFAULTS.protocol;
        const host = config.proxySettings?.host || PROXY_DEFAULTS.host;
        const port = config.proxySettings?.port || PROXY_DEFAULTS.port;
        const generation = proxyProbeGenerationRef.current + 1;
        proxyProbeGenerationRef.current = generation;
        setProxyProbeState({ status: 'checking' });
        const timer = window.setTimeout(() => {
            invoke<NetworkProbeResult>('cmd_probe_proxy', { protocol, host, port })
                .then((result) => {
                    if (proxyProbeGenerationRef.current !== generation) return;
                    if (result.ok) {
                        setProxyProbeState({
                            status: 'ok',
                            message: result.message,
                            detail: result.httpStatus ? `${result.url} HTTP ${result.httpStatus}` : result.url,
                        });
                    } else {
                        setProxyProbeState({
                            status: 'error',
                            message: result.message,
                            detail: result.detail,
                            stage: result.stage,
                            kind: result.kind,
                        });
                    }
                })
                .catch((error) => {
                    if (proxyProbeGenerationRef.current !== generation) return;
                    setProxyProbeState({
                        status: 'error',
                        message: t('general.proxyProbeFailed'),
                        detail: error instanceof Error ? error.message : String(error),
                    });
                });
        }, 250);
        return () => window.clearTimeout(timer);
    }, [proxyEnabled, config.proxySettings?.protocol, config.proxySettings?.host, config.proxySettings?.port, t]);

    const proxyScopeProviderIds = useMemo(
        () => providers.filter((p) => p.enabled).map((p) => p.id),
        [providers],
    );
    const proxyScope = useMemo(
        () => normalizeProxyScope(config.proxySettings?.scope, proxyScopeProviderIds),
        [config.proxySettings?.scope, proxyScopeProviderIds],
    );
    const proxyScopeSummary = useMemo(
        () => describeProxyScopeSummary({
            enabled: proxyEnabled,
            scope: proxyScope,
            selectedProviderNames: proxyScopeProviderIds
                .filter((id) => proxyScope.mode === 'custom' && proxyScope.providerIds?.includes(id))
                .map((id) => providers.find((p) => p.id === id)?.name ?? id),
        }),
        [proxyEnabled, proxyScope, proxyScopeProviderIds, providers],
    );
    const saveProxyScope = useCallback(
        (s: { generalRequests: boolean; providerIds: string[] }) => {
            const cleaned = s.providerIds.filter((id) => proxyScopeProviderIds.includes(id));
            if (s.generalRequests && cleaned.length === proxyScopeProviderIds.length) {
                patchProxySettings({ scope: { mode: 'all' } });
            } else {
                patchProxySettings({ scope: { mode: 'custom', generalRequests: s.generalRequests, providerIds: cleaned } });
            }
        },
        [patchProxySettings, proxyScopeProviderIds],
    );

    // --- Logs export ---
    const [logExporting, setLogExporting] = useState(false);
    const onExportLogs = useCallback(async () => {
        setLogExporting(true);
        try {
            const res = await apiGetJson<{ success?: boolean; path?: string; error?: string }>('/api/logs/export');
            if (res.success) {
                toast.success(t('general.logsExported', { path: res.path ?? '' }));
            } else {
                toast.error(t('general.logsExportFailed'));
            }
        } catch {
            toast.error(t('general.logsExportFailedRetry'));
        } finally {
            setLogExporting(false);
        }
    }, [t, toast]);

    return {
        languageOptions,
        uiLanguage,
        onLanguageChange,
        themeId,
        onPersistTheme,
        onPersistThemeError,
        autostartEnabled,
        autostartLoading,
        onToggleAutostart,
        minimizeToTray: config.minimizeToTray ?? false,
        onToggleMinimizeToTray,
        forceWakeLock: config.forceWakeLock ?? false,
        onToggleForceWake,
        queueMode,
        onQueueModeChange,
        osNotifications,
        onToggleNotifications,
        notificationSound,
        onToggleSound,
        notificationBadge,
        onToggleBadge,
        projects: projects.map((p) => ({ path: p.path, displayName: p.displayName || p.name })),
        defaultWorkspacePath: config.defaultWorkspacePath ?? '',
        onDefaultWorkspaceChange: async (path: string) => {
            if (path === '') await updateConfig({ defaultWorkspacePath: undefined });
            else {
                await updateConfig({ defaultWorkspacePath: path });
                toast.success(t('general.defaultWorkspaceSaved'));
            }
        },
        proxyEnabled,
        onToggleProxy,
        proxyScopeMode: proxyScope.mode,
        proxyScopeSummaryDescriptor: proxyScopeSummary,
        onOpenProxyScopeDialog: () => setShowProxyScopeDialog(true),
        showProxyScopeDialog,
        onCloseProxyScopeDialog: () => setShowProxyScopeDialog(false),
        onSaveProxyScope: saveProxyScope,
        proxyProtocol: config.proxySettings?.protocol || PROXY_DEFAULTS.protocol,
        onProtocolChange: (p: string) => patchProxySettings({ protocol: p as never }),
        proxyHostDraft,
        proxyPortDraft,
        onProxyHostDraftChange: setProxyHostDraft,
        onProxyPortDraftChange: setProxyPortDraft,
        commitProxyHost,
        commitProxyPort,
        proxyProbeState,
        proxyAppliedHint: '',
        proxySectionRef,
        highlightProxySection: false,
        logExporting,
        onExportLogs,
    };
}
