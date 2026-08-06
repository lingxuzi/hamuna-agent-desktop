/**
 * useLauncherDataV2 — Launcher assembly layer, copied verbatim from v1
 * `src/renderer/pages/Launcher.tsx` (user decision: replicate the assembly
 * layer, don't trim it). Owns every data hook + state + handler the Launcher
 * needs; the v2 page (`LauncherV2.tsx`) only renders BrandSection /
 * LauncherRightRail + dialogs against this data.
 *
 * Deliberate deviations from v1 (all surfaced as caveats):
 *  - `onLaunchProject` → `launchChat`: v2 has no App tab-flip; AppV2 hands
 *    over a callback that stores the launch context and switches the view.
 *  - `handleGoToSettings` → `openSettings`: v2 Settings lives in-tree; the
 *    CUSTOM_EVENTS.OPEN_SETTINGS dispatch (v1) has no v2 listener.
 *  - `isStarting` / `startError` / `attachmentSessionId` /
 *    `sessionNotificationBadgeCounts` dropped: v2 has no App-side launch
 *    state / attachment re-entry / per-session badge plumbing yet.
 * Everything else is a faithful copy — state names, effects, deps arrays,
 * eslint suppressions, persistInputOptionChange calls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { perfMark } from '@/utils/perfMark';
import { open } from '@tauri-apps/plugin-dialog';

import { track } from '@/analytics';
import type { EntryIntent, HistoryEntrySource, Surface } from '@/analytics';
import { type ImageAttachment } from '@/components/SimpleChatInput';
import { projectTaskExecutionOverrides } from '@/utils/taskProviderProjection';
import { coerceRuntimeBirthPermissionMode } from '../../shared/runtimeBirthFields';
import { useToast } from '@/components/Toast';
import { useConfig } from '@/hooks/useConfig';
import { useTaskCenterData } from '@/hooks/useTaskCenterData';
import { CODEX_SUBSCRIPTION_PROVIDER_ID, type Project, type PermissionMode, type McpServerDefinition, type WorkspaceTemplate, isProjectActiveForUser, isProjectArchived, isProjectVisibleToUser, isProviderEnabled } from '@/config/types';
import { normalizeWorkspacePathIdentity, workspacePathsEqual } from '../../shared/workspacePath';
import {
    getAllMcpServers,
    getEnabledMcpServerIds,
    isProviderAvailable,
    resolveProvider,
    pairBuiltinSelection,
} from '@/config/configService';
import { patchAgentConfig, patchAgentProjectConfig, getAgentById, disableAgentAndStopChannels, enableAgentAndStartChannels } from '@/config/services/agentConfigService';
import { archiveProject, unarchiveProject } from '@/config/services/projectService';
import { persistInputOptionChange } from '@/api/persistInputOption';
import { createCronTask, startCronTask } from '@/api/cronTaskClient';
import type { RuntimeType, RuntimeModelInfo, RuntimePermissionMode, RuntimeDetections, RuntimeConfig } from '../../shared/types/runtime';
import { CC_MODELS, CC_PERMISSION_MODES, CODEX_PERMISSION_MODES, GEMINI_PERMISSION_MODES, buildRuntimeChangePatch } from '../../shared/types/runtime';
import {
    isRuntimeBackedProvider,
    toProviderExecutionIntent,
} from '../../shared/providerExecution';
import {
    IMAGE_UNDERSTANDING_TOOL_ID,
    isImageUnderstandingToolConfigured,
    normalizeOfficialToolIds,
    type OfficialToolId,
} from '../../shared/official-tools';
import { apiGetJson } from '@/api/apiFetch';
import { isBrowserDevMode, pickFolderForDialog } from '@/utils/browserMock';
import { resolveLauncherProvider } from '@/utils/optionResolve';
import { useAgentStatuses } from '@/hooks/useAgentStatuses';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import type { SessionMetadata } from '@/api/sessionClient';
import type { InitialMessage, LaunchSessionBirthHint } from '@/types/tab';

export interface LauncherLaunchContext {
    project: Project;
    sessionId?: string;
    initialMessage?: InitialMessage;
    analyticsContext?: { surface?: Surface; entryIntent?: EntryIntent; historyEntrySource?: HistoryEntrySource };
    sessionBirthHint?: LaunchSessionBirthHint;
}

interface UseLauncherDataV2Options {
    /** v2 handoff: store launch context + switch active tab to 'chat'. */
    launchChat: (ctx: LauncherLaunchContext) => void;
    /** v2 in-tree navigation to Settings (v1 dispatches CUSTOM_EVENTS.OPEN_SETTINGS). */
    openSettings: () => void;
    isActive?: boolean;
}

export interface LauncherDataV2 {
    config: ReturnType<typeof useConfig>['config'];
    projects: ReturnType<typeof useConfig>['projects'];
    providers: ReturnType<typeof useConfig>['providers'];
    apiKeys: ReturnType<typeof useConfig>['apiKeys'];
    providerVerifyStatus: ReturnType<typeof useConfig>['providerVerifyStatus'];
    isLoading: boolean;
    refreshProviderData: ReturnType<typeof useConfig>['refreshProviderData'];
    userVisibleProjects: Project[];
    visibleProjects: Project[];
    agentLookup: Map<string, { agent: NonNullable<ReturnType<typeof useConfig>['config']['agents']>[number]; status?: (ReturnType<typeof useAgentStatuses>['statuses'])[string] }>;
    taskCenterData: ReturnType<typeof useTaskCenterData>;
    selectedWorkspace: Project | null;
    setSelectedWorkspace: (p: Project) => void;
    launcherPermissionMode: PermissionMode;
    launcherProviderId: string | undefined;
    launcherSelectedModel: string | undefined;
    launcherReasoningEffort: string;
    launcherRuntime: RuntimeType;
    isExternalRuntime: boolean;
    multiAgentRuntimeEnabled: boolean;
    runtimeDetections: RuntimeDetections;
    launcherProvider: ReturnType<typeof resolveProvider>;
    launcherRuntimeModels: RuntimeModelInfo[] | undefined;
    launcherRuntimePermissionModes: RuntimePermissionMode[] | undefined;
    launcherMcpServers: McpServerDefinition[];
    launcherGlobalMcpEnabled: string[];
    launcherWorkspaceMcpEnabled: string[];
    launcherEnabledPlugins: string[];
    launcherOfficialToolEnabled: OfficialToolId[];
    launcherGlobalOfficialToolEnabled: OfficialToolId[];
    launcherOfficialToolNeedsConfig: Partial<Record<OfficialToolId, boolean>>;
    launchingProjectId: string | null;
    // overlay / dialog state + setters
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    projectToRemove: Project | null;
    setProjectToRemove: (v: Project | null) => void;
    showOverlay: boolean;
    setShowOverlay: (v: boolean) => void;
    overlayMode: 'default' | 'search';
    showTemplateDialog: boolean;
    editingProject: Project | null;
    agentOverlay: { workspacePath: string; initialTab: 'agent' } | null;
    pathDialogOpen: boolean;
    pendingFolderName: string;
    pendingDefaultPath: string;
    // handlers
    handleBrandSend: ReturnType<typeof useLauncherDataV2> extends never ? never : (text: string, images?: ImageAttachment[], cron?: import('@/types/tab').InitialMessageCron) => Promise<void>;
    handleLaunch: (project: Project, sessionId?: string, historyEntrySource?: HistoryEntrySource) => void;
    handleOpenTask: (session: SessionMetadata, project: Project, historyEntrySource?: HistoryEntrySource) => void;
    handleOpenOverlay: (mode?: 'default' | 'search') => void;
    handleCloseOverlay: () => void;
    handleOverlayOpenTask: (session: SessionMetadata, project: Project) => void;
    handleAddProject: () => Promise<void>;
    handlePathConfirm: (path: string) => Promise<void>;
    handlePathCancel: () => void;
    handleRemoveProject: (project: Project) => void;
    handleToggleProjectPin: (project: Project) => Promise<void>;
    handleArchiveProject: (project: Project) => Promise<void>;
    handleUnarchiveProject: (project: Project) => Promise<void>;
    confirmRemoveProject: () => Promise<void>;
    handleCreateFromTemplate: (path: string, template: WorkspaceTemplate, displayName?: string) => Promise<void>;
    handleEditProject: (projectId: string, updates: { displayName?: string; icon?: string }) => Promise<void>;
    handleOpenTemplateDialog: () => void;
    handleCloseTemplateDialog: () => void;
    handleCloseEditDialog: () => void;
    handleShowLogs: () => void;
    handleAgentSettings: (project: Project) => void;
    handleOpenProjectFolder: (project: Project) => Promise<void>;
    handleCloseAgentOverlay: () => void;
    handleRequestInitFromAgentOverlay: () => void;
    handleLauncherPermissionModeChange: (mode: PermissionMode) => void;
    handleLauncherModelChange: (model: string | undefined) => void;
    handleLauncherReasoningEffortChange: (effort: string) => void;
    handleLauncherRuntimeChange: (runtime: RuntimeType) => Promise<void>;
    handleLauncherProviderChange: (providerId: string | undefined, targetModel?: string) => void;
    handleSetDefault: (project: Project) => Promise<void>;
    handleLauncherPluginToggle: (pluginId: string, enabled: boolean) => void;
    handleLauncherOfficialToolToggle: (toolId: OfficialToolId, enabled: boolean) => void;
    handleWorkspaceMcpToggle: (serverId: string, enabled: boolean) => void;
    handleGoToSettings: () => void;
}

export function useLauncherDataV2({ launchChat, openSettings, isActive }: UseLauncherDataV2Options): LauncherDataV2 {
    const { t } = useTranslation('launcher');
    const toast = useToast();
    const toastRef = useRef(toast);
    const pinToggleInFlightRef = useRef(new Set<string>());
    const {
        config,
        projects,
        providers,
        isLoading,
        addProject,
        removeProject,
        patchProject,
        touchProject,
        apiKeys,
        providerVerifyStatus,
        refreshProviderData,
        updateConfig,
        refreshConfig,
    } = useConfig();

    useEffect(() => {
        toastRef.current = toast;
    }, [toast]);

    // Filter out internal projects (e.g. ~/.hamuna diagnostic workspace).
    const userVisibleProjects = useMemo(() => projects.filter(isProjectVisibleToUser), [projects]);
    const visibleProjects = useMemo(() => userVisibleProjects.filter(isProjectActiveForUser), [userVisibleProjects]);

    // Poll agent statuses only when any project has proactive mode
    const hasAnyAgent = useMemo(() => visibleProjects.some(p => p.isAgent), [visibleProjects]);
    const { statuses: agentStatuses } = useAgentStatuses(hasAnyAgent);
    const taskCenterData = useTaskCenterData({ isActive });
    const { openPathExternal } = useWorkspaceFileService(null);

    // Build agent lookup: project path → { agent config, runtime status }
    const agentLookup = useMemo(() => {
        const map = new Map<string, { agent: NonNullable<typeof config.agents>[number]; status?: (typeof agentStatuses)[string] }>();
        if (!config.agents) return map;
        for (const agent of config.agents) {
            const key = normalizeWorkspacePathIdentity(agent.workspacePath);
            map.set(key, { agent, status: agentStatuses[agent.id] });
        }
        return map;
     
    }, [config.agents, agentStatuses]);

    const [launchingProjectId, setLaunchingProjectId] = useState<string | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
    const [showOverlay, setShowOverlay] = useState(false);
    const [showTemplateDialog, setShowTemplateDialog] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [agentOverlay, setAgentOverlay] = useState<{ workspacePath: string; initialTab: 'agent' } | null>(null);

    // ===== Launcher-specific state for BrandSection =====

    const resolveDefaultWorkspace = useCallback((projs: Project[]): Project | null => {
        if (config.defaultWorkspacePath) {
            const def = projs.find(p => workspacePathsEqual(p.path, config.defaultWorkspacePath));
            if (def) return def;
        }
        const mino = projs.find(p => p.path.replace(/\\/g, '/').endsWith('/mino'));
        if (mino) return mino;
        return projs[0] ?? null;
    }, [config.defaultWorkspacePath]);

    const [selectedWorkspace, setSelectedWorkspace] = useState<Project | null>(() =>
        resolveDefaultWorkspace(visibleProjects)
    );

    // P0/P4: mark when the Launcher shell first commits, for the new-tab timeline.
    useEffect(() => {
        perfMark('tab_shell_painted', { surface: 'launcher' });
    }, []);

    // A6 (instant-nav): warm the v1 Chat chunk while on the Launcher — the real
    // lazy() retries on open even if this warm fails; kept for parity with v1.
    useEffect(() => {
        if (!isActive) return;
        let cancelled = false;
        void import('@/pages/Chat')
            .then(() => { if (!cancelled) console.log('[LauncherV2] Chat-chunk preload DONE'); })
            .catch(() => { /* non-fatal */ });
        return () => { cancelled = true; };
    }, [isActive]);

    // Sync selectedWorkspace when visible projects change.
    useEffect(() => {
        setSelectedWorkspace(prev => {
            if (!prev) return resolveDefaultWorkspace(visibleProjects);
            const updated = visibleProjects.find(p => p.id === prev.id);
            return updated ?? resolveDefaultWorkspace(visibleProjects);
        });
    }, [visibleProjects, resolveDefaultWorkspace]);

    const [launcherPermissionMode, setLauncherPermissionMode] = useState<PermissionMode>(config.defaultPermissionMode);
    const [launcherProviderId, setLauncherProviderId] = useState<string | undefined>();
    const [launcherSelectedModel, setLauncherSelectedModel] = useState<string | undefined>();
    const [launcherReasoningEffort, setLauncherReasoningEffort] = useState<string>('default');

    // Runtime state — adapts model/permission selectors when workspace uses external runtime
    const multiAgentRuntimeEnabled = !!config.multiAgentRuntime;

    const [runtimeDetections, setRuntimeDetections] = useState<RuntimeDetections>({
        builtin: { installed: true },
        'claude-code': { installed: false },
        codex: { installed: false },
        gemini: { installed: false },
    });
    useEffect(() => {
        if (!multiAgentRuntimeEnabled) return;
        let cancelled = false;
        import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke<Record<string, { installed: boolean; version?: string; path?: string }>>('cmd_detect_runtimes')
                .then(d => { if (!cancelled) setRuntimeDetections(d as RuntimeDetections); })
                .catch(() => { /* non-fatal */ });
        });
        return () => { cancelled = true; };
    }, [multiAgentRuntimeEnabled]);

    // MCP state
    const [launcherMcpServers, setLauncherMcpServers] = useState<McpServerDefinition[]>([]);
    const [launcherGlobalMcpEnabled, setLauncherGlobalMcpEnabled] = useState<string[]>([]);
    const [launcherWorkspaceMcpEnabled, setLauncherWorkspaceMcpEnabled] = useState<string[]>([]);
    const [launcherEnabledPlugins, setLauncherEnabledPlugins] = useState<string[]>([]);
    const [launcherOfficialToolEnabled, setLauncherOfficialToolEnabled] = useState<OfficialToolId[]>([]);
    const launcherGlobalOfficialToolEnabled = useMemo(
        () => normalizeOfficialToolIds(config.enabledOfficialToolIds ?? []),
        [config.enabledOfficialToolIds],
    );

    // Resolve AgentConfig for selected workspace (source of truth for AI settings)
    const selectedAgent = useMemo(() => {
        if (!selectedWorkspace?.agentId) return undefined;
        return getAgentById(config, selectedWorkspace.agentId);
    }, [selectedWorkspace?.agentId, config]);

    // Ref for runtimeConfig — avoids stale closure in rapid write-back handlers
    const runtimeConfigRef = useRef(selectedAgent?.runtimeConfig);
    runtimeConfigRef.current = selectedAgent?.runtimeConfig;

    // Runtime-aware model/permission lists — adapts input bar for external runtimes
    const selectedAgentRuntimeConfig = selectedAgent?.runtimeConfig as RuntimeConfig | undefined;
    const selectedAgentUsesManagedCodexProvider =
        selectedAgent?.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID
        || selectedAgentRuntimeConfig?.source === 'managed-provider';
    const launcherRuntime: RuntimeType = selectedAgentUsesManagedCodexProvider
        ? 'builtin'
        : multiAgentRuntimeEnabled
        ? ((selectedAgent?.runtime as RuntimeType) || 'builtin') : 'builtin';
    const isExternalRuntime = launcherRuntime !== 'builtin';

    // Codex + Gemini models are dynamic (fetched from the CLI); CC models are static
    const [codexModels, setCodexModels] = useState<RuntimeModelInfo[]>([]);
    const [geminiModels, setGeminiModels] = useState<RuntimeModelInfo[]>([]);
    useEffect(() => {
        if (!multiAgentRuntimeEnabled || launcherRuntime !== 'codex') { setCodexModels([]); return; }
        let cancelled = false;
        apiGetJson<{ models?: RuntimeModelInfo[] }>('/api/runtime/models?type=codex')
            .then(res => { if (!cancelled && res?.models?.length) setCodexModels(res.models); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [multiAgentRuntimeEnabled, launcherRuntime]);
    useEffect(() => {
        if (!multiAgentRuntimeEnabled || launcherRuntime !== 'gemini') { setGeminiModels([]); return; }
        let cancelled = false;
        apiGetJson<{ models?: RuntimeModelInfo[] }>('/api/runtime/models?type=gemini')
            .then(res => { if (!cancelled && res?.models?.length) setGeminiModels(res.models); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [multiAgentRuntimeEnabled, launcherRuntime]);

    const launcherRuntimeModels: RuntimeModelInfo[] | undefined = launcherRuntime === 'claude-code' ? CC_MODELS
        : launcherRuntime === 'codex' ? codexModels
        : launcherRuntime === 'gemini' ? geminiModels : undefined;
    const launcherRuntimePermissionModes: RuntimePermissionMode[] | undefined = launcherRuntime === 'claude-code'
        ? CC_PERMISSION_MODES
        : launcherRuntime === 'codex' ? CODEX_PERMISSION_MODES
        : launcherRuntime === 'gemini' ? GEMINI_PERMISSION_MODES : undefined;

    // Derive provider for launcher — only select providers with valid credentials
    const launcherProvider = useMemo(() => {
        const id = launcherProviderId ?? selectedAgent?.providerId ?? selectedWorkspace?.providerId ?? config.defaultProviderId;
        return resolveProvider(id, providers, apiKeys, providerVerifyStatus);
    }, [launcherProviderId, selectedAgent, selectedWorkspace, config.defaultProviderId, providers, apiKeys, providerVerifyStatus]);
    const imageUnderstandingConfiguredForInput = useMemo(() => {
        if (!isImageUnderstandingToolConfigured(config.officialToolSettings)) return false;
        const selection = config.officialToolSettings?.imageUnderstanding;
        const provider = providers.find(item => item.id === selection?.providerId);
        if (!provider || isRuntimeBackedProvider(provider)) return false;
        if (!isProviderAvailable(provider, apiKeys, providerVerifyStatus)) return false;
        const model = provider.models.find(item => item.model === selection?.model);
        return Array.isArray(model?.inputModalities) && model.inputModalities.includes('image');
    }, [apiKeys, config.officialToolSettings, providerVerifyStatus, providers]);
    const launcherOfficialToolNeedsConfig = useMemo(
        () => ({ [IMAGE_UNDERSTANDING_TOOL_ID]: !imageUnderstandingConfiguredForInput }),
        [imageUnderstandingConfiguredForInput],
    );

    // Load MCP servers when workspace changes
    useEffect(() => {
        const load = async () => {
            try {
                const servers = await getAllMcpServers();
                const enabled = await getEnabledMcpServerIds();
                setLauncherMcpServers(servers);
                setLauncherGlobalMcpEnabled(enabled);
                setLauncherWorkspaceMcpEnabled(selectedAgent?.mcpEnabledServers ?? selectedWorkspace?.mcpEnabledServers ?? []);
            } catch (err) {
                console.warn('[LauncherV2] Failed to load MCP servers:', err);
            }
        };
        void load();
     
    }, [selectedWorkspace?.id]);

    // Refresh MCP local state when tab becomes active.
    const prevIsActiveRef = useRef(isActive);
    useEffect(() => {
        const wasInactive = !prevIsActiveRef.current;
        prevIsActiveRef.current = isActive;
        if (!wasInactive || !isActive) return;

        void (async () => {
            try {
                const servers = await getAllMcpServers();
                const enabled = await getEnabledMcpServerIds();
                setLauncherMcpServers(servers);
                setLauncherGlobalMcpEnabled(enabled);
            } catch (err) {
                console.warn('[LauncherV2] Failed to reload MCP servers on activation:', err);
            }
        })();
    }, [isActive]);

    // PRD 0.2.17 — Launcher plugin toggle (local state only).
    const handleLauncherPluginToggle = useCallback((pluginId: string, enabled: boolean) => {
        setLauncherEnabledPlugins(prev =>
            enabled ? [...prev, pluginId] : prev.filter(id => id !== pluginId),
        );
    }, []);

    const handleLauncherOfficialToolToggle = useCallback((toolId: OfficialToolId, enabled: boolean) => {
        setLauncherOfficialToolEnabled(prev => {
            const newEnabled = normalizeOfficialToolIds(
                enabled ? [...prev, toolId] : prev.filter(id => id !== toolId),
            );
            if (selectedWorkspace) {
                void persistInputOptionChange({
                    workspaceId: selectedWorkspace.id,
                    agentId: selectedWorkspace.agentId ?? null,
                    isExternalRuntime,
                    currentRuntimeConfig: runtimeConfigRef.current,
                    currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                    fields: { enabledOfficialToolIds: newEnabled },
                    patchProject,
                    patchAgentConfig,
                    patchAgentProjectConfig,
                });
            }
            return newEnabled;
        });
     
    }, [selectedWorkspace?.id, patchProject, isExternalRuntime]);

    // Handle workspace MCP toggle — delegates to the shared dual-write helper.
    const handleWorkspaceMcpToggle = useCallback((serverId: string, enabled: boolean) => {
        setLauncherWorkspaceMcpEnabled(prev => {
            const newEnabled = enabled ? [...prev, serverId] : prev.filter(id => id !== serverId);
            if (selectedWorkspace) {
                void persistInputOptionChange({
                    workspaceId: selectedWorkspace.id,
                    agentId: selectedWorkspace.agentId ?? null,
                    isExternalRuntime,
                    currentRuntimeConfig: runtimeConfigRef.current,
                    currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                    fields: { mcpEnabledServers: newEnabled },
                    patchProject,
                    patchAgentConfig,
                    patchAgentProjectConfig,
                });
            }
            return newEnabled;
        });
     
    }, [selectedWorkspace?.id, patchProject, isExternalRuntime]);

    // Restore launcherLastUsed settings once config finishes loading from disk.
    const lastUsedAppliedRef = useRef(false);
    useEffect(() => {
        if (isLoading || lastUsedAppliedRef.current) return;
        lastUsedAppliedRef.current = true;
        const lastUsed = config.launcherLastUsed;
        if (!lastUsed) return;
        if (lastUsed.permissionMode) setLauncherPermissionMode(lastUsed.permissionMode);
        const resolved = resolveLauncherProvider({
            lastUsedProviderId: lastUsed.providerId,
            lastUsedModel: lastUsed.model,
            agentProviderId: selectedAgent?.providerId,
            agentModel: selectedAgent?.model,
            workspaceProviderId: selectedWorkspace?.providerId,
            workspaceModel: selectedWorkspace?.model,
            defaultProviderId: config.defaultProviderId,
        });
        if (resolved.providerId) setLauncherProviderId(resolved.providerId);
        if (resolved.model) setLauncherSelectedModel(resolved.model);
        if (lastUsed.mcpEnabledServers) setLauncherWorkspaceMcpEnabled(lastUsed.mcpEnabledServers);
        if (lastUsed.enabledPluginIds) setLauncherEnabledPlugins(lastUsed.enabledPluginIds);
        if (lastUsed.enabledOfficialToolIds) setLauncherOfficialToolEnabled(normalizeOfficialToolIds(lastUsed.enabledOfficialToolIds));
     
    }, [isLoading, config.launcherLastUsed]);

    // Extract runtimeConfig primitives for stable useEffect deps.
    const agentRuntimeModel = (selectedAgent?.runtimeConfig as { model?: string } | undefined)?.model;
    const agentRuntimePermMode = (selectedAgent?.runtimeConfig as { permissionMode?: string } | undefined)?.permissionMode;
    const agentRuntimeReasoningEffort = (selectedAgent?.runtimeConfig as { reasoningEffort?: string } | undefined)?.reasoningEffort;

    // Sync launcher settings from selected workspace's per-project config.
    useEffect(() => {
        if (isLoading || !selectedWorkspace) return;
        if (isExternalRuntime) {
            setLauncherSelectedModel(agentRuntimeModel ?? undefined);
            setLauncherPermissionMode((agentRuntimePermMode as PermissionMode | undefined) ?? config.defaultPermissionMode);
            setLauncherReasoningEffort(agentRuntimeReasoningEffort ?? 'default');
        } else {
            setLauncherPermissionMode((selectedAgent?.permissionMode as PermissionMode | undefined) ?? selectedWorkspace.permissionMode ?? config.defaultPermissionMode);
            setLauncherSelectedModel(selectedAgent?.model ?? selectedWorkspace.model ?? undefined);
            setLauncherReasoningEffort(selectedAgent?.reasoningEffort ?? 'default');
        }
        setLauncherProviderId(selectedAgent?.providerId ?? selectedWorkspace.providerId ?? undefined);
        setLauncherWorkspaceMcpEnabled(selectedAgent?.mcpEnabledServers ?? selectedWorkspace.mcpEnabledServers ?? []);
        setLauncherOfficialToolEnabled(normalizeOfficialToolIds(selectedAgent?.enabledOfficialToolIds ?? selectedWorkspace.enabledOfficialToolIds ?? []));
     
    }, [isLoading, selectedWorkspace?.id, selectedAgent?.permissionMode, selectedAgent?.model, selectedAgent?.providerId, selectedAgent?.mcpEnabledServers, selectedAgent?.enabledOfficialToolIds, selectedAgent?.runtime, selectedAgent?.reasoningEffort, agentRuntimeModel, agentRuntimePermMode, agentRuntimeReasoningEffort, selectedWorkspace?.permissionMode, selectedWorkspace?.model, selectedWorkspace?.providerId, selectedWorkspace?.mcpEnabledServers, selectedWorkspace?.enabledOfficialToolIds, config.defaultPermissionMode, multiAgentRuntimeEnabled, isExternalRuntime]);

    // Write-back handlers: persist Launcher setting changes to the selected project

    const handleLauncherPermissionModeChange = useCallback((mode: PermissionMode) => {
        setLauncherPermissionMode(mode);
        if (selectedWorkspace) {
            void persistInputOptionChange({
                workspaceId: selectedWorkspace.id,
                agentId: selectedWorkspace.agentId ?? null,
                isExternalRuntime,
                currentRuntimeConfig: runtimeConfigRef.current,
                currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                fields: { permissionMode: mode },
                patchProject,
                patchAgentConfig,
                patchAgentProjectConfig,
            });
        }
     
    }, [selectedWorkspace?.id, patchProject, isExternalRuntime]);

    const handleLauncherModelChange = useCallback((model: string | undefined) => {
        setLauncherSelectedModel(model);
        if (selectedWorkspace) {
            const providerExecutionIntent = !isExternalRuntime && launcherProvider && model
                ? toProviderExecutionIntent(launcherProvider, model)
                : undefined;
            void persistInputOptionChange({
                workspaceId: selectedWorkspace.id,
                agentId: selectedWorkspace.agentId ?? null,
                isExternalRuntime,
                currentRuntimeConfig: runtimeConfigRef.current,
                currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                fields: isExternalRuntime
                    ? { runtimeModel: model ?? null }
                    : providerExecutionIntent?.kind === 'runtime-backed-provider'
                        ? { runtimeBackedProviderSelection: providerExecutionIntent }
                        : { builtinModel: model ?? null },
                patchProject,
                patchAgentConfig,
                patchAgentProjectConfig,
            });
        }
     
    }, [selectedWorkspace?.id, patchProject, isExternalRuntime, launcherProvider]);

    // #324 — 推理强度 write-back.
    const handleLauncherReasoningEffortChange = useCallback((effort: string) => {
        setLauncherReasoningEffort(effort);
        if (selectedWorkspace) {
            void persistInputOptionChange({
                workspaceId: selectedWorkspace.id,
                agentId: selectedWorkspace.agentId ?? null,
                isExternalRuntime,
                currentRuntimeConfig: runtimeConfigRef.current,
                currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                fields: { reasoningEffort: effort },
                patchProject,
                patchAgentConfig,
                patchAgentProjectConfig,
            });
        }
     
    }, [selectedWorkspace?.id, patchProject, isExternalRuntime]);

    // PRD 0.2.7 D6: Runtime change persists to Agent.runtime.
    const handleLauncherRuntimeChange = useCallback(async (runtime: RuntimeType) => {
        if (!selectedWorkspace?.agentId) {
            toastRef.current.warning(t('toasts.runtimeNeedsAgent'));
            return;
        }
        try {
            await patchAgentConfig(
                selectedWorkspace.agentId,
                buildRuntimeChangePatch(selectedAgent?.runtimeConfig, runtime),
            );
        } catch (err) {
            console.error('[LauncherV2] runtime change failed:', err);
            toastRef.current.error(t('toasts.runtimeSwitchFailed'));
        }
    }, [selectedWorkspace?.agentId, selectedAgent?.runtimeConfig, t]);

    const handleLauncherProviderChange = useCallback((providerId: string | undefined, targetModel?: string) => {
        setLauncherProviderId(providerId);
        const newProvider = providerId ? providers.find(p => p.id === providerId) : undefined;
        const model = targetModel ?? newProvider?.primaryModel;
        if (model) {
            setLauncherSelectedModel(model);
        }
        if (selectedWorkspace) {
            const providerExecutionIntent = newProvider && model
                ? toProviderExecutionIntent(newProvider, model)
                : undefined;
            void persistInputOptionChange({
                workspaceId: selectedWorkspace.id,
                agentId: selectedWorkspace.agentId ?? null,
                isExternalRuntime,
                currentRuntimeConfig: runtimeConfigRef.current,
                currentProviderId: selectedAgent?.providerId ?? selectedWorkspace.providerId,
                fields: {
                    ...(providerExecutionIntent?.kind === 'runtime-backed-provider'
                        ? { runtimeBackedProviderSelection: providerExecutionIntent }
                        : {
                            providerId: providerId ?? undefined,
                            builtinModel: model ?? undefined,
                        }),
                },
                patchProject,
                patchAgentConfig,
                patchAgentProjectConfig,
            });
        }
     
    }, [selectedWorkspace?.id, patchProject, providers, isExternalRuntime]);

    // Navigate to Settings > Providers page (v2: in-tree setView('settings')).
    const handleGoToSettings = useCallback(() => {
        openSettings();
    }, [openSettings]);

    // Promote a project to the global default workspace.
    const handleSetDefault = useCallback(async (project: Project) => {
        try {
            await updateConfig({ defaultWorkspacePath: project.path });
        } catch (err) {
            console.error('[LauncherV2] failed to set default workspace:', err);
            toastRef.current.warning(t('toasts.setDefaultFailed'));
        }
    }, [t, updateConfig]);

    // Handle send from BrandSection — `cron` is the launcher-staged cron config.
    const handleBrandSend = useCallback(async (
        text: string,
        images?: ImageAttachment[],
        cron?: import('@/types/tab').InitialMessageCron,
    ) => {
        if (!selectedWorkspace) {
            toastRef.current.error(t('toasts.selectWorkspaceFirst'));
            return;
        }

        const launcherModelForProvider = launcherSelectedModel ?? launcherProvider?.primaryModel;
        const providerExecutionIntent = (!isExternalRuntime && launcherProvider && launcherModelForProvider)
            ? toProviderExecutionIntent(launcherProvider, launcherModelForProvider)
            : undefined;
        const runtimeBackedProviderIdentity = providerExecutionIntent?.kind === 'runtime-backed-provider'
            ? providerExecutionIntent
            : undefined;
        const builtinSelection = (!isExternalRuntime && launcherProvider && !isRuntimeBackedProvider(launcherProvider))
            ? pairBuiltinSelection(launcherProvider, launcherSelectedModel)
            : undefined;
        const runtimeModel = isExternalRuntime
            ? launcherSelectedModel
            : runtimeBackedProviderIdentity?.model;
        const launcherVisiblePluginIds = new Set(
            (config.plugins ?? [])
                .filter(p => config.enabledPlugins?.[p.id] === true)
                .map(p => p.id),
        );
        const carriedEnabledPlugins = launcherEnabledPlugins.filter(id =>
            launcherVisiblePluginIds.has(id),
        );
        const carriedOfficialTools = launcherOfficialToolEnabled.filter(id =>
            launcherGlobalOfficialToolEnabled.includes(id)
            && (id !== IMAGE_UNDERSTANDING_TOOL_ID || imageUnderstandingConfiguredForInput),
        );

        const initialMessage: InitialMessage = {
            text,
            images,
            permissionMode: launcherPermissionMode,
            mcpEnabledServers: launcherWorkspaceMcpEnabled.filter(id => launcherGlobalMcpEnabled.includes(id)),
            ...(carriedEnabledPlugins.length > 0 ? { enabledPluginIds: carriedEnabledPlugins } : {}),
            enabledOfficialToolIds: carriedOfficialTools,
            ...(builtinSelection ? { builtinSelection } : {}),
            ...(runtimeModel ? { runtimeModel } : {}),
            ...(runtimeBackedProviderIdentity ? { providerExecutionIdentity: runtimeBackedProviderIdentity } : {}),
            ...(launcherReasoningEffort !== 'default' ? { reasoningEffort: launcherReasoningEffort } : {}),
            ...(cron ? { cron } : {}),
        };

        // Persist launcher settings for next app launch
        updateConfig({
            launcherLastUsed: {
                providerId: launcherProvider?.id,
                model: launcherSelectedModel,
                permissionMode: launcherPermissionMode,
                mcpEnabledServers: launcherWorkspaceMcpEnabled,
                enabledPluginIds: launcherEnabledPlugins,
                enabledOfficialToolIds: launcherOfficialToolEnabled,
            },
        }).catch(err => console.warn('[LauncherV2] Failed to save launcherLastUsed:', err));

        setLaunchingProjectId(selectedWorkspace.id);
        touchProject(selectedWorkspace.id).catch(() => {});

        // Cron standalone: create a task without opening a chat tab (same
        // promise as v1: "创建独立定时任务，不占用当前对话").
        if (cron?.taskKind === 'cron' && cron.executionTarget === 'new_task') {
            try {
                const standaloneSessionId = `cron-standalone-${crypto.randomUUID()}`;
                const launcherProviderId =
                    !isExternalRuntime && launcherProvider
                        ? launcherProvider.id
                        : undefined;
                const cronExecution = projectTaskExecutionOverrides({
                    providers,
                    runtime: launcherRuntime,
                    providerId: launcherProviderId,
                    model: builtinSelection?.model ?? runtimeModel,
                    runtimeConfig: isExternalRuntime ? runtimeConfigRef.current : undefined,
                });
                const cronPermissionMode = coerceRuntimeBirthPermissionMode(
                    launcherPermissionMode,
                    cronExecution.runtime ?? launcherRuntime,
                );
                const created = await createCronTask({
                    workspacePath: selectedWorkspace.path,
                    sessionId: standaloneSessionId,
                    prompt: text,
                    intervalMinutes: cron.intervalMinutes,
                    endConditions: cron.endConditions,
                    runMode: 'new_session',
                    notifyEnabled: cron.notifyEnabled,
                    schedule: cron.schedule,
                    delivery: cron.delivery,
                    name: cron.name,
                    permissionMode: cronPermissionMode,
                    model: cronExecution.model,
                    providerId: cronExecution.providerId,
                    runtime: cronExecution.runtime,
                    runtimeConfig: cronExecution.runtimeConfig,
                    mcpEnabledServers: launcherWorkspaceMcpEnabled,
                });
                await startCronTask(created.id);
                track('launcher_cron_create_standalone', {
                    interval_minutes: cron.intervalMinutes,
                    schedule_kind: cron.schedule.kind,
                });
                toastRef.current.success(t('toasts.standaloneCronCreated'));
                setLaunchingProjectId(null);
                return;
            } catch (err) {
                console.error('[LauncherV2] Failed to create standalone cron task:', err);
                toastRef.current.error(t('toasts.createCronFailed', { message: err instanceof Error ? err.message : String(err) }));
                setLaunchingProjectId(null);
                return;
            }
        }

        launchChat({
            project: selectedWorkspace,
            initialMessage,
            analyticsContext: { surface: 'launcher_input', entryIntent: 'send_message' },
        });
    }, [selectedWorkspace, launcherProvider, launcherPermissionMode,
        launcherSelectedModel, launcherReasoningEffort, launcherWorkspaceMcpEnabled, launcherGlobalMcpEnabled,
        launcherEnabledPlugins, launcherOfficialToolEnabled, launcherGlobalOfficialToolEnabled,
        imageUnderstandingConfiguredForInput, config.plugins, config.enabledPlugins,
        isExternalRuntime, launcherRuntime, providers, t,
        touchProject, launchChat, updateConfig]);

    // Path input dialog state (for browser dev mode)
    const [pathDialogOpen, setPathDialogOpen] = useState(false);
    const [pendingFolderName, setPendingFolderName] = useState('');
    const [pendingDefaultPath, setPendingDefaultPath] = useState('');

    const handleLaunch = useCallback((project: Project, sessionId?: string, historyEntrySource?: HistoryEntrySource) => {
        perfMark('card_click');
        console.log(`[LauncherV2] CARD CLICK project=${project.id} sessionId=${sessionId ?? 'NEW'}`);
        setLaunchingProjectId(project.id);
        touchProject(project.id).catch((err) => {
            console.warn('[LauncherV2] Failed to update lastOpened:', err);
        });
        let sessionBirthHint: LaunchSessionBirthHint | undefined;
        if (
            !sessionId
            && selectedWorkspace
            && workspacePathsEqual(selectedWorkspace.path, project.path)
            && !isExternalRuntime
            && launcherProvider
        ) {
            const model = launcherSelectedModel ?? launcherProvider.primaryModel;
            const intent = model ? toProviderExecutionIntent(launcherProvider, model) : undefined;
            if (intent?.kind === 'runtime-backed-provider') {
                const visiblePluginIds = new Set(
                    (config.plugins ?? [])
                        .filter(p => config.enabledPlugins?.[p.id] === true)
                        .map(p => p.id),
                );
                sessionBirthHint = {
                    providerExecutionIdentity: intent,
                    permissionMode: launcherPermissionMode,
                    reasoningEffort: launcherReasoningEffort,
                    mcpEnabledServers: launcherWorkspaceMcpEnabled.filter(id => launcherGlobalMcpEnabled.includes(id)),
                    enabledPluginIds: launcherEnabledPlugins.filter(id => visiblePluginIds.has(id)),
                    enabledOfficialToolIds: launcherOfficialToolEnabled.filter(id =>
                        launcherGlobalOfficialToolEnabled.includes(id)
                        && (id !== IMAGE_UNDERSTANDING_TOOL_ID || imageUnderstandingConfiguredForInput),
                    ),
                };
            }
        }
        launchChat({
            project,
            sessionId,
            ...(sessionId
                ? { analyticsContext: { historyEntrySource: historyEntrySource ?? 'launcher_recent' } }
                : { analyticsContext: { surface: 'agent_card', entryIntent: 'open_workspace' } }),
            ...(sessionBirthHint ? { sessionBirthHint } : {}),
        });
    }, [
        touchProject,
        launchChat,
        selectedWorkspace,
        isExternalRuntime,
        launcherProvider,
        launcherSelectedModel,
        launcherPermissionMode,
        launcherReasoningEffort,
        launcherWorkspaceMcpEnabled,
        launcherGlobalMcpEnabled,
        launcherEnabledPlugins,
        launcherOfficialToolEnabled,
        launcherGlobalOfficialToolEnabled,
        imageUnderstandingConfiguredForInput,
        config.plugins,
        config.enabledPlugins,
    ]);

    const handleOpenTask = useCallback((session: SessionMetadata, project: Project, historyEntrySource: HistoryEntrySource = 'launcher_recent') => {
        handleLaunch(project, session.id, historyEntrySource);
    }, [handleLaunch]);

    const [overlayMode, setOverlayMode] = useState<'default' | 'search'>('default');
    const handleOpenOverlay = useCallback((mode: 'default' | 'search' = 'default') => { track('task_center_open', {}); setOverlayMode(mode); setShowOverlay(true); }, []);
    const handleCloseOverlay = useCallback(() => { setShowOverlay(false); setOverlayMode('default'); }, []);

    const handleOverlayOpenTask = useCallback((session: SessionMetadata, project: Project) => {
        handleOpenTask(session, project, 'launcher_overlay');
        handleCloseOverlay();
    }, [handleOpenTask, handleCloseOverlay]);

    const handleAddProject = async () => {
        try {
            if (isBrowserDevMode()) {
                const folderInfo = await pickFolderForDialog();
                if (folderInfo) {
                    setPendingFolderName(folderInfo.folderName);
                    setPendingDefaultPath(folderInfo.defaultPath);
                    setPathDialogOpen(true);
                } else {
                    console.log('[LauncherV2] Folder picker cancelled');
                }
            } else {
                const selected = await open({
                    directory: true,
                    multiple: false,
                    title: t('dialogs.pickProjectFolder'),
                });
                console.log('[LauncherV2] Dialog result:', selected);

                if (selected && typeof selected === 'string') {
                    console.log('[LauncherV2] Adding project:', selected);
                    const project = await addProject(selected);
                    console.log('[LauncherV2] Project added:', project);
                } else {
                    console.log('[LauncherV2] No folder selected or dialog cancelled');
                }
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[LauncherV2] Failed to add project:', errorMsg);
            toast.error(t('toasts.addProjectFailed', { message: errorMsg }));
        }
    };

    const handlePathConfirm = async (path: string) => {
        setPathDialogOpen(false);
        console.log('[LauncherV2] Path confirmed:', path);

        try {
            const project = await addProject(path);
            console.log('[LauncherV2] Project added:', project);
            const normalizedPath = path.replace(/\\/g, '/');
            const parentDir = normalizedPath.split('/').slice(0, -1).join('/');
            if (parentDir) {
                localStorage.setItem('hamuna:lastProjectDir', parentDir);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[LauncherV2] Failed to add project:', errorMsg);
            toast.error(t('toasts.addProjectFailed', { message: errorMsg }));
        }
    };

    const handlePathCancel = () => {
        setPathDialogOpen(false);
        console.log('[LauncherV2] Path dialog cancelled');
    };

    const handleRemoveProject = useCallback((project: Project) => {
        setProjectToRemove(project);
    }, []);

    const handleToggleProjectPin = useCallback(async (project: Project) => {
        if (isProjectArchived(project)) return;
        if (pinToggleInFlightRef.current.has(project.id)) return;
        pinToggleInFlightRef.current.add(project.id);
        try {
            const currentProject = projects.find(candidate => candidate.id === project.id) ?? project;
            await patchProject(project.id, {
                pinnedAt: currentProject.pinnedAt ? undefined : new Date().toISOString(),
            });
        } catch (err) {
            console.error('[LauncherV2] failed to toggle workspace pin:', err);
            toastRef.current.warning(t('toasts.pinFailed'));
        } finally {
            pinToggleInFlightRef.current.delete(project.id);
        }
    }, [patchProject, projects, t]);

    const archiveToggleInFlightRef = useRef(new Set<string>());

    const handleArchiveProject = useCallback(async (project: Project) => {
        if (archiveToggleInFlightRef.current.has(project.id)) return;
        archiveToggleInFlightRef.current.add(project.id);
        try {
            const currentProject = projects.find(candidate => candidate.id === project.id) ?? project;
            const agent = currentProject.agentId ? getAgentById(config, currentProject.agentId) : undefined;
            const wasProactive = agent?.enabled === true;
            const archivedProject = await archiveProject(currentProject.id, { agentEnabledBeforeArchive: wasProactive });
            if (!archivedProject) throw new Error(`Project ${currentProject.id} not found`);
            if (agent && wasProactive) await disableAgentAndStopChannels(agent);
            await refreshConfig();
            toastRef.current.success(t('toasts.workspaceArchived'));
        } catch (err) {
            console.error('[LauncherV2] failed to archive workspace:', err);
            toastRef.current.warning(t('toasts.archiveFailed'));
        } finally {
            archiveToggleInFlightRef.current.delete(project.id);
        }
    }, [config, projects, refreshConfig, t]);

    const handleUnarchiveProject = useCallback(async (project: Project) => {
        if (archiveToggleInFlightRef.current.has(project.id)) return;
        archiveToggleInFlightRef.current.add(project.id);
        try {
            const currentProject = projects.find(candidate => candidate.id === project.id) ?? project;
            const shouldRestoreAgent = currentProject.archivedAgentEnabledBeforeArchive === true;
            const unarchivedProject = await unarchiveProject(currentProject.id);
            if (!unarchivedProject) throw new Error(`Project ${currentProject.id} not found`);
            if (shouldRestoreAgent && currentProject.agentId) {
                try {
                    await enableAgentAndStartChannels(currentProject.agentId);
                } catch (err) {
                    await archiveProject(currentProject.id, {
                        archivedAtIso: currentProject.archivedAt,
                        agentEnabledBeforeArchive: true,
                    });
                    throw err;
                }
            }
            await refreshConfig();
            toastRef.current.success(t('toasts.workspaceUnarchived'));
        } catch (err) {
            console.error('[LauncherV2] failed to unarchive workspace:', err);
            toastRef.current.warning(t('toasts.unarchiveFailed'));
        } finally {
            archiveToggleInFlightRef.current.delete(project.id);
        }
    }, [projects, refreshConfig, t]);

    const confirmRemoveProject = async () => {
        if (projectToRemove) {
            await removeProject(projectToRemove.id);
            setProjectToRemove(null);
        }
    };

    const handleCreateFromTemplate = useCallback(async (path: string, template: WorkspaceTemplate, displayName?: string) => {
        await addProject(path, {
            icon: template.icon,
            displayName,
            templateId: template.id,
            templateSource: template.isBuiltin ? 'builtin' : 'user',
            agentDefaults: template.isBuiltin ? template.agentDefaults : undefined,
        });
        track('workspace_create', { source: 'template' });
    }, [addProject]);

    const handleEditProject = useCallback(async (projectId: string, updates: { displayName?: string; icon?: string }) => {
        await patchProject(projectId, updates);
    }, [patchProject]);

    const handleOpenTemplateDialog = useCallback(() => setShowTemplateDialog(true), []);
    const handleCloseTemplateDialog = useCallback(() => setShowTemplateDialog(false), []);
    const handleCloseEditDialog = useCallback(() => setEditingProject(null), []);
    const handleShowLogs = useCallback(() => setShowLogs(true), []);

    // Agent overlay handlers
    const handleAgentSettings = useCallback((project: Project) => {
        setAgentOverlay({ workspacePath: project.path, initialTab: 'agent' });
    }, []);
    const handleOpenProjectFolder = useCallback(async (project: Project) => {
        try {
            await openPathExternal({ fullPath: project.path, workspace: null });
        } catch (err) {
            console.error('[LauncherV2] Failed to open project folder:', err);
            toastRef.current.error(t('toasts.openFolderFailed'));
        }
    }, [openPathExternal, t]);
    const handleCloseAgentOverlay = useCallback(() => setAgentOverlay(null), []);

    // SystemPromptsPanel "智能生成" → close the overlay and launch into a Chat tab.
    const handleRequestInitFromAgentOverlay = useCallback(() => {
        if (!agentOverlay) return;
        const project = projects.find(p => workspacePathsEqual(p.path, agentOverlay.workspacePath));
        if (!project) return;
        const effectiveProvider = launcherProvider ?? providers.find(isProviderEnabled);
        if (!effectiveProvider) {
            toastRef.current.error(t('toasts.noProvider'));
            return;
        }
        setAgentOverlay(null);
        const initModelForProvider = launcherSelectedModel ?? effectiveProvider.primaryModel;
        const providerExecutionIntent = !isExternalRuntime && initModelForProvider
            ? toProviderExecutionIntent(effectiveProvider, initModelForProvider)
            : undefined;
        const runtimeBackedProviderIdentity = providerExecutionIntent?.kind === 'runtime-backed-provider'
            ? providerExecutionIntent
            : undefined;
        const builtinSelection = !isExternalRuntime && !isRuntimeBackedProvider(effectiveProvider)
            ? pairBuiltinSelection(effectiveProvider, launcherSelectedModel)
            : undefined;
        const runtimeModel = isExternalRuntime ? launcherSelectedModel : runtimeBackedProviderIdentity?.model;
        const initialMessage: InitialMessage = {
            text: '/init',
            permissionMode: launcherPermissionMode,
            ...(builtinSelection ? { builtinSelection } : {}),
            ...(runtimeModel ? { runtimeModel } : {}),
            ...(runtimeBackedProviderIdentity ? { providerExecutionIdentity: runtimeBackedProviderIdentity } : {}),
        };
        launchChat({
            project,
            initialMessage,
            analyticsContext: { surface: 'agent_setup', entryIntent: 'workspace_init' },
        });
    }, [agentOverlay, projects, launcherProvider, providers, launcherPermissionMode, launcherSelectedModel, isExternalRuntime, launchChat, t]);

    return {
        config,
        projects,
        providers,
        apiKeys,
        providerVerifyStatus,
        isLoading,
        refreshProviderData,
        userVisibleProjects,
        visibleProjects,
        agentLookup,
        taskCenterData,
        selectedWorkspace,
        setSelectedWorkspace,
        launcherPermissionMode,
        launcherProviderId,
        launcherSelectedModel,
        launcherReasoningEffort,
        launcherRuntime,
        isExternalRuntime,
        multiAgentRuntimeEnabled,
        runtimeDetections,
        launcherProvider,
        launcherRuntimeModels,
        launcherRuntimePermissionModes,
        launcherMcpServers,
        launcherGlobalMcpEnabled,
        launcherWorkspaceMcpEnabled,
        launcherEnabledPlugins,
        launcherOfficialToolEnabled,
        launcherGlobalOfficialToolEnabled,
        launcherOfficialToolNeedsConfig,
        launchingProjectId,
        showLogs,
        setShowLogs,
        projectToRemove,
        setProjectToRemove,
        showOverlay,
        setShowOverlay,
        overlayMode,
        showTemplateDialog,
        editingProject,
        agentOverlay,
        pathDialogOpen,
        pendingFolderName,
        pendingDefaultPath,
        handleBrandSend,
        handleLaunch,
        handleOpenTask,
        handleOpenOverlay,
        handleCloseOverlay,
        handleOverlayOpenTask,
        handleAddProject,
        handlePathConfirm,
        handlePathCancel,
        handleRemoveProject,
        handleToggleProjectPin,
        handleArchiveProject,
        handleUnarchiveProject,
        confirmRemoveProject,
        handleCreateFromTemplate,
        handleEditProject,
        handleOpenTemplateDialog,
        handleCloseTemplateDialog,
        handleCloseEditDialog,
        handleShowLogs,
        handleAgentSettings,
        handleOpenProjectFolder,
        handleCloseAgentOverlay,
        handleRequestInitFromAgentOverlay,
        handleLauncherPermissionModeChange,
        handleLauncherModelChange,
        handleLauncherReasoningEffortChange,
        handleLauncherRuntimeChange,
        handleLauncherProviderChange,
        handleSetDefault,
        handleLauncherPluginToggle,
        handleLauncherOfficialToolToggle,
        handleWorkspaceMcpToggle,
        handleGoToSettings,
    };
}
