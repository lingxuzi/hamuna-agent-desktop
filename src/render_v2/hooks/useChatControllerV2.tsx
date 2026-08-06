/**
 * useChatControllerV2 — Chat orchestration hook for the v2 render layer.
 *
 * Faithful port of the orchestration core from v1 `src/renderer/pages/Chat.tsx`
 * (L450–4780): provider/session-snapshot resolution chain, sidecar config
 * disposition (push/adopt/pending), runtime detection, send/stop/permission,
 * launcher auto-send handoff, MCP/plugin/official-tool sync, split-view state
 * machine, chat scroll/search, and workspace (agents/skills/commands) wiring.
 *
 * Deliberate deviations from v1 (surfaced as caveats in CHAT-IDEAS):
 *  - Header chrome orchestration (SessionMenuButton / SessionHistoryDropdown /
 *    SessionTitleEditor / new-session / session-fork / provider-switch dialog)
 *    is NOT ported — WUM12 has no header chrome, only the three-column body.
 *    Multi-tab chrome lives in the v2 Chrome bar, not per-page.
 *  - cron / goal / rewind / retry / runtime-change confirm dialogs are not wired
 *    yet (v2 phase boundary); the SimpleChatInput toolbar shows them but the
 *    underlying handlers are stubbed to a toast. See CHAT-IDEAS caveats.
 *
 * Consumes useTabState() (TabProvider must be mounted above), returns everything
 * the ChatV2 three-column view needs to render against.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useCloseLayer } from '@/hooks/useCloseLayer';
import { useToast } from '@/components/Toast';
import { type DirectoryPanelHandle } from '@/components/DirectoryPanel';
import { type ImageAttachment, type SimpleChatInputHandle } from '@/components/SimpleChatInput';
import AgentStatusPanel from '@/components/agent-status/AgentStatusPanel';
import ContextUsageIndicator from '@/components/ContextUsageIndicator';
import { useChatSearch, isHighlightApiSupported } from '@/hooks/useChatSearch';
import { useChatScrollController } from '@/hooks/useChatScrollController';
import { useChatScrollModel } from '@/hooks/useChatScrollModel';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { useWorkspaceChangeSignal } from '@/hooks/useWorkspaceChangeSignal';
import { useConfig } from '@/hooks/useConfig';
import { useFileDropZone } from '@/hooks/useFileDropZone';
import { useTauriFileDrop } from '@/hooks/useTauriFileDrop';
import { isIntroductionAbsentError, shouldShowIntroductionOverlay, useIntroductionContent } from '@/hooks/useIntroductionContent';
import { resolveAdoptedBuiltinProviderId } from '@/utils/sessionConfigAdoption';
import { getAgentById } from '@/config/services/agentConfigService';
import {
  getAllMcpServers,
  getEnabledMcpServerIds,
  isProviderAvailable,
  resolveProvider,
} from '@/config/configService';
import { syncMcpServerNames } from '@/components/tools/toolBadgeConfig';
import { BROWSER_BLANK_URL } from '@/components/browserConstants';
import { CUSTOM_EVENTS, isPendingSessionId } from '../../shared/constants';
import {
  IMAGE_UNDERSTANDING_TOOL_ID,
  isImageUnderstandingToolConfigured,
  normalizeOfficialToolIds,
  type OfficialToolId,
} from '../../shared/official-tools';
import { workspacePathsEqual } from '../../shared/workspacePath';
import { coerceReasoningEffortForRuntime } from '../../shared/reasoningEffort';
import { createConcreteProviderRoute, hasProviderRouteCredential, isConcreteProviderRoute } from '../../shared/providerRoute';
import type { ProviderRoute } from '../../shared/providerRoute';
import {
  isRuntimeBackedProvider,
  managedCodexRuntimePermissionToProviderPermission,
  runtimeBackedProviderPermissionMode,
  toProviderExecutionIntent,
  type ProviderExecutionIntent,
} from '../../shared/providerExecution';
import {
  CC_MODELS,
  CC_PERMISSION_MODES,
  CODEX_PERMISSION_MODES,
  coerceModelForRuntime,
  coercePermissionModeForRuntime,
  GEMINI_PERMISSION_MODES,
  getDefaultRuntimePermissionMode,
} from '../../shared/types/runtime';
import type { RuntimeType, RuntimeDetections, RuntimeConfig } from '../../shared/types/runtime';
import type { InitialMessage, SidecarConfigDisposition } from '@/types/tab';
import { shouldAutoSendInitialMessage } from '@/utils/initialMessageAutoSend';
import {
  resolveBuiltinPermissionMode,
  resolveCurrentProviderForSession,
  resolveLegacyBuiltinSnapshotProviderId,
} from '@/utils/optionResolve';
import { shouldUseExternalRuntimeInputControls } from '@/utils/runtimeUiProjection';
import {
  isManagedProviderSessionSnapshot,
  managedProviderSnapshotProviderId,
  shouldSessionSnapshotUseProviderPicker,
} from '@/utils/sessionSnapshotProviderProjection';
import { launchSupportDiagnostics } from '@/utils/supportDiagnostics';
import { isTauriEnvironment } from '@/utils/browserMock';
import { isDebugMode } from '@/utils/debug';
import { CODEX_SUBSCRIPTION_PROVIDER_ID, getEffectiveModelAliases, type McpServerDefinition, type PermissionMode, type Provider } from '@/config/types';
import { useTabState, useTabActive } from '@/context/TabContext';
import { track } from '@/analytics';
import { type RichDocKind } from '../../shared/fileTypes';

// ─── module-scope helpers (copied verbatim from v1 Chat.tsx) ──────────────────

type SplitPreviewFile = {
  name: string;
  content: string;
  size: number;
  path: string;
  sourceScope?: 'workspace' | 'local';
  localPath?: string;
  richDocKind?: RichDocKind;
  initialEditMode?: boolean;
  initialLineNumber?: number;
  focusTarget?: import('@/types/filePreview').FilePreviewFocusTarget;
};

function buildBuiltinProviderRoute(provider: Provider | undefined, model: string | undefined): ProviderRoute | undefined {
  if (!provider || !model) return undefined;
  if (isRuntimeBackedProvider(provider)) return undefined;
  return createConcreteProviderRoute(provider.id, model);
}

function buildProviderExecutionIntent(
  provider: Pick<Provider, 'id' | 'execution'> | undefined,
  model: string | undefined,
): ProviderExecutionIntent | undefined {
  if (!provider || !model) return undefined;
  return toProviderExecutionIntent(provider, model);
}

function isRuntimeBackedIntent(intent: ProviderExecutionIntent | undefined): boolean {
  return intent?.kind === 'runtime-backed-provider';
}

function coerceExternalRuntimeModelForUi(model: string | undefined, runtime: RuntimeType): string | undefined {
  return runtime === 'builtin' ? model : coerceModelForRuntime(model, runtime);
}

function coerceExternalRuntimePermissionForUi(mode: string | undefined, runtime: RuntimeType): string | undefined {
  return runtime === 'builtin' ? mode : coercePermissionModeForRuntime(mode, runtime);
}

function coerceInitialMessageRuntimePermission(
  initialMessage: InitialMessage,
  runtime: RuntimeType,
): string | undefined {
  const identity = initialMessage.providerExecutionIdentity;
  if (identity) {
    return runtimeBackedProviderPermissionMode(identity, initialMessage.permissionMode);
  }
  return coerceExternalRuntimePermissionForUi(initialMessage.permissionMode, runtime);
}

function coerceReasoningEffortForUi(effort: string | undefined, runtime: RuntimeType): string | undefined {
  return coerceReasoningEffortForRuntime(effort, runtime);
}

function getRuntimePermissionModesFor(runtime: RuntimeType) {
  return runtime === 'claude-code' ? CC_PERMISSION_MODES
    : runtime === 'codex' ? CODEX_PERMISSION_MODES
    : runtime === 'gemini' ? GEMINI_PERMISSION_MODES
    : undefined;
}

// ─── hook props / return ──────────────────────────────────────────────────────

export interface ChatControllerV2Options {
  /** Launcher / discuss handoff context. Cleared via onInitialMessageConsumed. */
  initialMessage?: InitialMessage;
  onInitialMessageConsumed?: () => void;
  /** Sidecar config disposition — set by useChatLaunchV2 after ensure. */
  sidecarConfigDisposition: SidecarConfigDisposition;
  onSidecarConfigAdopted?: () => void;
  isActive?: boolean;
  /** Session title (v2 Tab bar shows it; rename via onRenameSession). */
  sessionTitle?: string | null;
  onRenameSession?: (title: string) => void;
}

export interface ChatControllerV2 {
  // tab state
  agentDir: string;
  sessionId: string | null;
  messages: ReturnType<typeof useTabState>['messages'];
  streamingMessage: ReturnType<typeof useTabState>['streamingMessage'];
  isLoading: boolean;
  isSessionLoading: boolean;
  sessionState: ReturnType<typeof useTabState>['sessionState'];
  sessionRuntime: ReturnType<typeof useTabState>['sessionRuntime'];
  sessionMeta: ReturnType<typeof useTabState>['sessionMeta'];
  setSessionMeta: ReturnType<typeof useTabState>['setSessionMeta'];
  agentError: ReturnType<typeof useTabState>['agentError'];
  systemStatus: ReturnType<typeof useTabState>['systemStatus'];
  systemNotice: ReturnType<typeof useTabState>['systemNotice'];
  pendingPermission: ReturnType<typeof useTabState>['pendingPermission'];
  pendingAskUserQuestion: ReturnType<typeof useTabState>['pendingAskUserQuestion'];
  pendingExitPlanMode: ReturnType<typeof useTabState>['pendingExitPlanMode'];
  queuedMessages: ReturnType<typeof useTabState>['queuedMessages'];
  toolCompleteCount: number;
  isConnected: boolean;
  sdkSlashCommands: ReturnType<typeof useTabState>['sdkSlashCommands'];
  runtimeDiagnostics: ReturnType<typeof useTabState>['runtimeDiagnostics'];
  lastTerminalReason: ReturnType<typeof useTabState>['lastTerminalReason'];

  // chat scroll model
  chatScrollModel: ReturnType<typeof useChatScrollModel>;
  chatScrollController: ReturnType<typeof useChatScrollController>;
  virtuosoRef: ReturnType<typeof useChatScrollController>['virtuosoRef'];
  scrollerRef: ReturnType<typeof useChatScrollController>['scrollerRef'];
  followEnabledRef: ReturnType<typeof useChatScrollController>['followEnabledRef'];
  scrollToBottom: ReturnType<typeof useChatScrollController>['scrollToBottom'];
  pauseAutoScroll: ReturnType<typeof useChatScrollController>['pauseAutoScroll'];
  handleAtBottomChange: ReturnType<typeof useChatScrollController>['handleAtBottomChange'];
  attachScroller: ReturnType<typeof useChatScrollController>['attachScroller'];
  scrollToMessage: ReturnType<typeof useChatScrollController>['scrollToMessage'];
  scrollToTool: ReturnType<typeof useChatScrollController>['scrollToTool'];
  captureAnchor: ReturnType<typeof useChatScrollController>['captureAnchor'];
  restoreAnchorAfterNextCommit: ReturnType<typeof useChatScrollController>['restoreAnchorAfterNextCommit'];
  onRowLayoutChanged: ReturnType<typeof useChatScrollController>['onRowLayoutChanged'];

  // chat search
  chatSearchOpen: boolean;
  setChatSearchOpen: (v: boolean) => void;
  chatSearch: ReturnType<typeof useChatSearch>;
  closeChatSearch: () => void;

  // provider chain
  selectedProviderId: string | undefined;
  selectedModel: string | undefined;
  setSelectedModel: (m: string | undefined) => void;
  effectiveSelectedProviderId: string | undefined;
  currentProvider: ReturnType<typeof resolveProvider> | Provider | null;
  currentProviderAvailableForInput: boolean;
  availableProviderIdsForInput: string[];
  selectedModelForInput: string;
  reasoningEffort: string;
  setReasoningEffort: (e: string) => void;
  effectivePermissionMode: PermissionMode;
  inputChromePermissionMode: PermissionMode;
  inputUsesExternalRuntimeControls: boolean;
  currentRuntime: RuntimeType;
  isExternalRuntime: boolean;
  multiAgentRuntimeEnabled: boolean;
  managedProviderRuntimeActive: boolean;
  runtimeDetections: RuntimeDetections;
  runtimeModels: typeof CC_MODELS | undefined;
  runtimePermissionModes: ReturnType<typeof getRuntimePermissionModesFor>;
  runtimeModel: string | undefined;
  runtimePermissionMode: string;
  currentProviderExecutionIntent: ProviderExecutionIntent | undefined;
  currentProviderForHistory: ReturnType<typeof resolveProvider> | Provider | null;
  builtinSnapshotProviderSelectionIncomplete: boolean;
  builtinSnapshotProviderHistoryUnknown: boolean;
  apiKeys: ReturnType<typeof useConfig>['apiKeys'];
  providerVerifyStatus: ReturnType<typeof useConfig>['providerVerifyStatus'];

  // handlers (input chrome)
  handleSendMessage: (text: string, images?: ImageAttachment[]) => Promise<boolean | void>;
  handleStop: () => Promise<void>;
  handleProviderChange: (providerId: string, targetModel?: string) => Promise<void>;
  handleBuiltinModelSelect: (selection: { providerId: string; model: string }) => void;
  handleModelChange: (modelId: string) => void;
  handleReasoningEffortChange: (effort: string) => void;
  handlePermissionModeChange: (mode: PermissionMode) => void;
  handleWorkspaceMcpToggle: (serverId: string, enabled: boolean) => void;
  handleWorkspaceOfficialToolToggle: (toolId: OfficialToolId, enabled: boolean) => void;
  handleWorkspacePluginToggle: (pluginId: string, enabled: boolean) => void;
  handleCancelQueued: (queueId: string) => void;
  handleForceExecuteQueued: (queueId: string) => void;
  handleCancelQueuedVoid: (queueId: string) => void;
  handleForceExecuteQueuedVoid: (queueId: string) => void;
  handleLoadOlderMessages: () => void;
  handlePermissionDecision: (requestId: string, decision: 'deny' | 'allow_once' | 'always_allow') => Promise<void>;
  handleAskUserQuestionSubmit: (requestId: string, answers: Record<string, string>) => void;
  handleAskUserQuestionCancel: () => void;
  handleExitPlanModeApprove: () => Promise<void>;
  handleExitPlanModeReject: (feedback?: string) => Promise<void>;
  handleDismissSystemNotice: () => void;

  // workspace
  fileService: ReturnType<typeof useWorkspaceFileService>;
  enabledAgents: Record<string, { description: string; prompt?: string; model?: string; scope?: 'user' | 'project'; folderName?: string }> | undefined;
  enabledSkills: Array<{ name: string; description: string; scope?: 'user' | 'project'; folderName?: string }>;
  enabledCommands: Array<{ name: string; description: string; scope?: 'user' | 'project'; fileName?: string }>;
  globalSkillFolderNames: Set<string>;
  workspaceRefreshTrigger: number;
  triggerWorkspaceRefresh: () => void;
  loadAndSyncAgents: () => Promise<void>;
  loadSkillsAndCommands: () => Promise<void>;
  handleSyncSkillToGlobal: (folderName: string) => Promise<void>;
  handleInsertReference: (paths: string[]) => void;
  handleInsertSlashCommand: (command: string) => void;
  handleOpenSettings: (initialSelect?: import('../../shared/skillsTypes').CapabilityInitialSelect) => void;
  currentProject: ReturnType<typeof useConfig>['projects'][number] | undefined;
  currentAgent: ReturnType<typeof getAgentById> | undefined;
  workspaceMcpEnabled: string[];
  globalMcpEnabled: string[];
  mcpServers: McpServerDefinition[];
  workspaceEnabledPlugins: string[];
  workspaceOfficialToolEnabled: OfficialToolId[];
  globalOfficialToolEnabled: OfficialToolId[];
  officialToolNeedsConfig: Partial<Record<OfficialToolId, boolean>>;
  globallyVisiblePlugins: Array<{ id: string; name: string; description?: string }>;

  // split view
  splitFile: SplitPreviewFile | null;
  setSplitFile: (f: SplitPreviewFile | null) => void;
  splitRatio: number;
  setSplitRatio: (r: number) => void;
  isDraggingSplit: boolean;
  splitPanelVisible: boolean;
  splitActiveView: 'file' | 'terminal' | 'browser';
  setSplitActiveView: (v: 'file' | 'terminal' | 'browser') => void;
  terminalId: string | null;
  setTerminalId: (v: string | null) => void;
  terminalAlive: boolean;
  setTerminalAlive: (v: boolean) => void;
  terminalPinned: boolean;
  setTerminalPinned: (v: boolean) => void;
  browserUrl: string | null;
  browserAlive: boolean;
  setBrowserAlive: (v: boolean) => void;
  browserSourceFile: { name: string; content: string; size: number; path: string } | null;
  browserCurrentUrl: string;
  handleBrowserUrlChange: (u: string) => void;
  handleSplitDividerMouseDown: (e: React.MouseEvent) => void;
  handleSplitFilePreview: (file: SplitPreviewFile, options?: { initialEditMode?: boolean }) => void;
  handleOpenTerminal: () => void;
  handleOpenInBrowserPanel: (url: string) => void;
  handleOpenBrowser: () => void;
  handleBrowserCreated: () => void;
  handleBrowserCreateFailed: () => void;
  handleBrowserClose: () => void;
  handleBrowserSwitchToEditor: () => Promise<void>;
  handleEditorSwitchToBrowser: () => void;
  handleRevealInTree: (path: string) => void;
  handleExternalRevealHandled: (id: number) => void;
  treeExternalReveal: { id: number; path: string } | null;
  browserPanelCtx: { openUrl: (url: string) => void } | null;
  terminalMounted: boolean;

  // file drop / drag
  isAnyDragActive: boolean;
  dragHandlers: ReturnType<typeof useFileDropZone>['dragHandlers'];
  isTauriDragging: boolean;
  activeZoneId: string | null;
  chatContentRef: React.RefObject<HTMLDivElement | null>;
  directoryPanelContainerRef: React.RefObject<HTMLDivElement | null>;

  // input chrome
  chatInputRef: React.RefObject<SimpleChatInputHandle | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  directoryPanelRef: React.RefObject<DirectoryPanelHandle | null>;
  inputOverlayHeight: number;
  handleInputOverlayHeightChange: (height: number) => void;
  agentStatusSlot: React.ReactNode;
  contextIndicatorSlot: React.ReactNode;
  visibleSdkSlashCommands: ReturnType<typeof useTabState>['sdkSlashCommands'];

  // overlays / dialog state
  showStartupOverlay: boolean;
  showIntroductionOverlay: boolean;
  introductionContent: string | null;
  showWorkspaceConfig: boolean;
  setShowWorkspaceConfig: (v: boolean) => void;
  workspaceConfigInitialTab: string | undefined;
  workspaceConfigInitialSelect: import('../../shared/skillsTypes').CapabilityInitialSelect | undefined;
  setWorkspaceConfigInitialTab: (v: string | undefined) => void;
  setWorkspaceConfigInitialSelect: (v: import('../../shared/skillsTypes').CapabilityInitialSelect | undefined) => void;

  // misc passthrough
  config: ReturnType<typeof useConfig>['config'];
  providers: ReturnType<typeof useConfig>['providers'];
  refreshProviderData: ReturnType<typeof useConfig>['refreshProviderData'];
  t: TFunction<'chat'>;
  tabId: string;
  agentErrorBannerProps: { message: string; onDiagnose: (message: string) => void; onRetry: () => void };
  currentProjectIcon?: string;
  currentProjectDisplayName?: string;
}

export function useChatControllerV2(options: ChatControllerV2Options): ChatControllerV2 {
  const {
    initialMessage,
    onInitialMessageConsumed,
    sidecarConfigDisposition,
    onSidecarConfigAdopted,
    // v2 phase boundary: `isActive`/`sessionTitle`/`onRenameSession` are
    // accepted by ChatV2Options for the future header/title chrome, but the
    // current WUM12 three-column body doesn't consume them yet.
    isActive: _isActive,
    sessionTitle: _sessionTitle,
    onRenameSession: _onRenameSession,
  } = options;

  // ── Tab context ──
  const {
    tabId,
    agentDir,
    sessionId,
    messages,
    historyMessages,
    streamingMessage,
    firstItemIndex,
    loadOlderMessages,
    isLoading,
    isSessionLoading,
    sessionState,
    sessionRuntime,
    sessionRuntimeSource,
    sessionMeta,
    setSessionMeta,
    sdkSlashCommands,
    runtimeDiagnostics,
    agentError,
    systemStatus,
    systemNotice,
    lastTerminalReason,
    pendingPermission,
    pendingAskUserQuestion,
    pendingExitPlanMode,
    respondExitPlanMode,
    toolCompleteCount,
    setMessages,
    setIsLoading,
    setSystemNotice,
    sendMessage,
    stopResponse,
    respondPermission,
    respondAskUserQuestion,
    apiPost,
    apiGet,
    setSessionState,
    queuedMessages,
    cancelQueuedMessage,
    forceExecuteQueuedMessage,
    isConnected,
  } = useTabState();
  const tabIsActive = useTabActive();
  const toast = useToast();
  const { t } = useTranslation('chat');

  const fileService = useWorkspaceFileService(agentDir);
  const { config, projects, providers, apiKeys, providerVerifyStatus, refreshProviderData } = useConfig();
  const currentProject = projects.find((p) => workspacePathsEqual(p.path, agentDir));
  const currentAgent = currentProject?.agentId ? getAgentById(config, currentProject.agentId) : undefined;

  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(
    currentAgent?.providerId ?? currentProject?.providerId ?? config.defaultProviderId ?? undefined,
  );
  const sessionSnapshotOwnsConfig = !!sessionMeta?.configSnapshotAt;
  const waitingForExistingSessionMeta = !!sessionId && !isPendingSessionId(sessionId) && !sessionMeta;
  const sessionSnapshotRuntime = (sessionMeta?.runtime as RuntimeType | undefined) ?? 'builtin';
  const sessionSnapshotIsManagedProvider = sessionSnapshotOwnsConfig
    && isManagedProviderSessionSnapshot(sessionMeta);
  const sessionSnapshotUsesProviderPicker = sessionSnapshotOwnsConfig
    && shouldSessionSnapshotUseProviderPicker({
      session: sessionMeta,
      runtime: sessionSnapshotRuntime,
    });
  const concreteSessionProviderRoute = isConcreteProviderRoute(sessionMeta?.providerRoute)
    ? sessionMeta.providerRoute
    : undefined;
  const sessionSnapshotProviderId = sessionSnapshotUsesProviderPicker
    ? (sessionSnapshotIsManagedProvider
      ? (sessionMeta ? managedProviderSnapshotProviderId(sessionMeta) : undefined)
      : (concreteSessionProviderRoute?.providerId ?? resolveLegacyBuiltinSnapshotProviderId({
        snapshotProviderId: sessionMeta?.providerId,
        snapshotModel: sessionMeta?.model,
        selectedProviderId,
        providers,
        apiKeys,
        providerVerifyStatus,
      })))
    : undefined;
  const effectiveSelectedProviderId = sessionSnapshotUsesProviderPicker
    ? sessionSnapshotProviderId
    : selectedProviderId;
  const selectedProviderExact = effectiveSelectedProviderId ? providers.find(p => p.id === effectiveSelectedProviderId) : undefined;
  const selectedProviderAvailable = selectedProviderExact
    ? (
      isRuntimeBackedProvider(selectedProviderExact)
        ? isProviderAvailable(selectedProviderExact, apiKeys, providerVerifyStatus)
        : sessionSnapshotOwnsConfig && selectedProviderExact.type === 'subscription'
        ? hasProviderRouteCredential(selectedProviderExact, { apiKeys, verifyStatus: providerVerifyStatus })
        : isProviderAvailable(selectedProviderExact, apiKeys, providerVerifyStatus)
    )
    : false;
  const availableProviderIdsForInput = useMemo(() => providers
    .filter(provider => isRuntimeBackedProvider(provider)
      ? isProviderAvailable(provider, apiKeys, providerVerifyStatus)
      : provider.type === 'subscription'
        ? provider.enabled !== false && hasProviderRouteCredential(provider, { apiKeys, verifyStatus: providerVerifyStatus })
        : isProviderAvailable(provider, apiKeys, providerVerifyStatus))
    .map(provider => provider.id), [providers, apiKeys, providerVerifyStatus]);
  const fallbackProvider = resolveProvider(effectiveSelectedProviderId, providers, apiKeys, providerVerifyStatus);
  const currentProvider = resolveCurrentProviderForSession({
    sessionSnapshotOwnsConfig,
    selectedProviderId: effectiveSelectedProviderId,
    selectedProvider: selectedProviderExact,
    selectedProviderAvailable,
    fallbackProvider,
  });
  const currentProviderForHistory = sessionSnapshotOwnsConfig
    ? selectedProviderExact
    : currentProvider;
  const builtinSnapshotProviderHistoryUnknown = sessionSnapshotOwnsConfig
    && sessionSnapshotRuntime === 'builtin'
    && !!sessionMeta?.model
    && !currentProviderForHistory;
  const builtinSnapshotProviderSelectionIncomplete = sessionSnapshotOwnsConfig
    && sessionSnapshotRuntime === 'builtin'
    && !!sessionMeta?.model
    && !effectiveSelectedProviderId;
  const currentProviderAvailableForInput = builtinSnapshotProviderSelectionIncomplete
    || (!!currentProvider && availableProviderIdsForInput.includes(currentProvider.id));

  // PERFORMANCE: Ref-stabilize object deps used in handleSendMessage
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const currentProviderRef = useRef(currentProvider);
  currentProviderRef.current = currentProvider;
  const apiKeysRef = useRef(apiKeys);
  apiKeysRef.current = apiKeys;
  const configRef = useRef(config);
  configRef.current = config;

  const buildProviderEnv = useCallback((provider: typeof currentProvider) => {
    if (!provider || provider.type === 'subscription') return undefined;
    const aliases = getEffectiveModelAliases(provider, configRef.current.providerModelAliases);
    return {
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: provider.config.baseUrl,
      apiKey: apiKeysRef.current[provider.id],
      authType: provider.authType,
      apiProtocol: provider.apiProtocol,
      maxOutputTokens: provider.maxOutputTokens,
      maxOutputTokensParamName: provider.maxOutputTokensParamName,
      upstreamFormat: provider.upstreamFormat,
      ...(aliases ? { modelAliases: aliases } : {}),
    };
  }, []);

  // ── disposition (push / adopt / pending) ──
  const configDispositionRef = useRef(sidecarConfigDisposition);
  configDispositionRef.current = sidecarConfigDisposition;
  const configPending = sidecarConfigDisposition === 'pending';
  const isAdopt = sidecarConfigDisposition === 'adopt';
  const adoptedSessionRef = useRef<string | null>(null);

  const chatContentRef = useRef<HTMLDivElement>(null);
  const [inputOverlayHeight, setInputOverlayHeight] = useState(176);
  const directoryPanelContainerRef = useRef<HTMLDivElement>(null);

  // Enabled sub-agents / skills / commands for sidebar display.
  const [enabledAgents, setEnabledAgents] = useState<Record<string, { description: string; prompt?: string; model?: string; scope?: 'user' | 'project'; folderName?: string }> | undefined>();
  const [enabledSkills, setEnabledSkills] = useState<Array<{ name: string; description: string; scope?: 'user' | 'project'; folderName?: string }>>([]);
  const [enabledCommands, setEnabledCommands] = useState<Array<{ name: string; description: string; scope?: 'user' | 'project'; fileName?: string }>>([]);
  const [globalSkillFolderNames, setGlobalSkillFolderNames] = useState<Set<string>>(new Set());
  const [workspaceConfigInitialTab, setWorkspaceConfigInitialTab] = useState<string | undefined>();
  const [workspaceConfigInitialSelect, setWorkspaceConfigInitialSelect] = useState<import('../../shared/skillsTypes').CapabilityInitialSelect | undefined>();
  const [workspaceRefreshTrigger, setWorkspaceRefreshTrigger] = useState(0);
  const [introductionRefreshTrigger, setIntroductionRefreshTrigger] = useState(0);
  const workspaceChangeSignal = useWorkspaceChangeSignal(agentDir || null, fileService.isAvailable);

  const readIntroductionContent = useCallback(async (path: string) => {
    if (!fileService.isAvailable) return null;
    try {
      const preview = await fileService.readPreview({ path });
      return preview.content;
    } catch (err) {
      if (isIntroductionAbsentError(err)) return null;
      throw err;
    }
  }, [fileService]);
  const introductionContent = useIntroductionContent(
    agentDir,
    introductionRefreshTrigger + workspaceChangeSignal,
    readIntroductionContent,
  );

  // Runtime detection (v0.1.59)
  const [runtimeDetections, setRuntimeDetections] = useState<RuntimeDetections>({
    'builtin': { installed: true },
    'claude-code': { installed: false },
    'codex': { installed: false },
    'gemini': { installed: false },
  });
  const multiAgentRuntimeEnabled = !!config.multiAgentRuntime;
  const currentAgentRuntimeConfig = currentAgent?.runtimeConfig as RuntimeConfig | undefined;
  const agentUsesManagedCodexProvider =
    currentAgent?.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID
    || currentAgentRuntimeConfig?.source === 'managed-provider';
  const agentRuntime: RuntimeType = agentUsesManagedCodexProvider
    ? 'builtin'
    : multiAgentRuntimeEnabled
    ? ((currentAgent?.runtime as RuntimeType) || 'builtin')
    : 'builtin';
  const currentRuntime: RuntimeType = (sessionRuntime as RuntimeType | null) ?? agentRuntime;
  const isExternalRuntime = currentRuntime !== 'builtin';
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    currentAgent?.model ?? currentProject?.model ?? currentProvider?.primaryModel,
  );
  const currentProviderExecutionIntent = useMemo(
    () => sessionMeta?.providerExecutionIdentity
      ?? buildProviderExecutionIntent(currentProviderForHistory, selectedModel),
    [
      sessionMeta?.providerExecutionIdentity,
      currentProviderForHistory,
      selectedModel,
    ],
  );
  const currentRuntimeSource = sessionMeta?.runtimeSource
    ?? sessionRuntimeSource
    ?? (currentProviderExecutionIntent?.kind === 'runtime-backed-provider'
      ? currentProviderExecutionIntent.runtimeSource
      : undefined);
  const managedProviderRuntimeActive = currentRuntimeSource === 'managed-provider';
  const inputUsesExternalRuntimeControls = shouldUseExternalRuntimeInputControls({
    currentRuntime,
    managedProviderRuntimeActive,
  });
  const visibleSdkSlashCommands = useMemo(
    () => inputUsesExternalRuntimeControls ? [] : sdkSlashCommands,
    [inputUsesExternalRuntimeControls, sdkSlashCommands],
  );

  useEffect(() => {
    let cancelled = false;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<Record<string, { installed: boolean; version?: string; path?: string }>>('cmd_detect_runtimes')
        .then(detections => { if (!cancelled) setRuntimeDetections(detections as RuntimeDetections); })
        .catch(() => { /* detection failure is non-fatal */ });
    });
    return () => { cancelled = true; };
  }, []);

  const [runtimeModel, setRuntimeModel] = useState<string | undefined>(
    (currentAgent?.runtimeConfig as { model?: string } | undefined)?.model,
  );
  const [runtimePermissionMode, setRuntimePermissionMode] = useState<string>(
    coerceExternalRuntimePermissionForUi(
      (currentAgent?.runtimeConfig as { permissionMode?: string } | undefined)?.permissionMode,
      currentRuntime,
    )
    || getDefaultRuntimePermissionMode(currentRuntime) || 'default',
  );
  const [reasoningEffort, setReasoningEffort] = useState<string>('default');

  // Sync runtimePermissionMode + runtimeModel when currentRuntime transitions.
  useEffect(() => {
    if (!isExternalRuntime) return;
    const cfg = currentAgent?.runtimeConfig as { permissionMode?: string; model?: string } | undefined;
    const saved = cfg?.permissionMode;
    const effective = coerceExternalRuntimePermissionForUi(saved, currentRuntime)
      ?? (getDefaultRuntimePermissionMode(currentRuntime) || 'default');
    setRuntimePermissionMode(effective);
    setRuntimeModel(coerceExternalRuntimeModelForUi(cfg?.model, currentRuntime));
    setReasoningEffort(coerceReasoningEffortForUi((cfg as { reasoningEffort?: string } | undefined)?.reasoningEffort, currentRuntime) ?? 'default');
  }, [currentRuntime, isExternalRuntime]);

  const runtimePermissionModes = getRuntimePermissionModesFor(currentRuntime);

  const [codexModels, setCodexModels] = useState<typeof CC_MODELS>([]);
  const [geminiModels, setGeminiModels] = useState<typeof CC_MODELS>([]);
  useEffect(() => {
    if ((!multiAgentRuntimeEnabled && !managedProviderRuntimeActive) || currentRuntime !== 'codex') return;
    let cancelled = false;
    const controller = new AbortController();
    apiGet('/api/runtime/models?type=codex', { signal: controller.signal }).then((res: unknown) => {
      const data = res as { models?: typeof CC_MODELS } | undefined;
      if (!cancelled && data?.models?.length) setCodexModels(data.models);
    }).catch(() => {});
    return () => { cancelled = true; controller.abort(); };
  }, [multiAgentRuntimeEnabled, managedProviderRuntimeActive, currentRuntime, apiGet]);
  useEffect(() => {
    if (!multiAgentRuntimeEnabled || currentRuntime !== 'gemini') return;
    let cancelled = false;
    const controller = new AbortController();
    apiGet('/api/runtime/models?type=gemini', { signal: controller.signal }).then((res: unknown) => {
      const data = res as { models?: typeof CC_MODELS } | undefined;
      if (!cancelled && data?.models?.length) setGeminiModels(data.models);
    }).catch(() => {});
    return () => { cancelled = true; controller.abort(); };
  }, [multiAgentRuntimeEnabled, currentRuntime, apiGet]);

  const runtimeModels = currentRuntime === 'claude-code' ? CC_MODELS
    : currentRuntime === 'codex' ? codexModels
    : currentRuntime === 'gemini' ? geminiModels
    : undefined;

  // Effective model/permission based on runtime.
  const effectiveRuntimeModel = isExternalRuntime
    ? coerceExternalRuntimeModelForUi(runtimeModel, currentRuntime)
    : undefined;
  const effectiveModel = isExternalRuntime
    ? (effectiveRuntimeModel ?? runtimeModels?.find(m => m.isDefault)?.value)
    : selectedModel;
  const effectiveRuntimePermissionMode = isExternalRuntime
    ? (coerceExternalRuntimePermissionForUi(runtimePermissionMode, currentRuntime)
      ?? getDefaultRuntimePermissionMode(currentRuntime)
      ?? 'default')
    : undefined;

  // Permission mode state (v1 seeds from agent/project; resolved via resolveBuiltinPermissionMode)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (currentAgent?.permissionMode as PermissionMode | undefined) ?? currentProject?.permissionMode ?? 'auto',
  );
  const hadInitialMessage = useRef(!!initialMessage);
  const launcherOwnsInitialMcpRef = useRef(hadInitialMessage.current);
  const launcherOwnsInitialOfficialToolsRef = useRef(hadInitialMessage.current);
  const projectSyncedRef = useRef(false);
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;

  const permissionStateAuthoritative =
    projectSyncedRef.current || hadInitialMessage.current || sessionSnapshotOwnsConfig;
  const effectivePermissionMode = isExternalRuntime
    ? effectiveRuntimePermissionMode as PermissionMode
    : resolveBuiltinPermissionMode({
        projectSynced: permissionStateAuthoritative,
        statePermissionMode: permissionMode,
        agentPermissionMode: currentAgent?.permissionMode as string | undefined,
        projectPermissionMode: currentProject?.permissionMode,
        defaultPermissionMode: config.defaultPermissionMode,
      });

  // ── workspace state ──
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([]);
  const [globalMcpEnabled, setGlobalMcpEnabled] = useState<string[]>([]);
  const [workspaceMcpEnabled, setWorkspaceMcpEnabled] = useState<string[]>(
    currentAgent?.mcpEnabledServers ?? currentProject?.mcpEnabledServers ?? [],
  );
  const [workspaceEnabledPlugins, setWorkspaceEnabledPlugins] = useState<string[]>(
    currentAgent?.enabledPluginIds ?? currentProject?.enabledPluginIds ?? [],
  );
  const [workspaceOfficialToolEnabled, setWorkspaceOfficialToolEnabled] = useState<OfficialToolId[]>(
    normalizeOfficialToolIds(currentAgent?.enabledOfficialToolIds ?? currentProject?.enabledOfficialToolIds ?? []),
  );
  const globalOfficialToolEnabled = useMemo(
    () => normalizeOfficialToolIds(config.enabledOfficialToolIds ?? []),
    [config.enabledOfficialToolIds],
  );
  const imageUnderstandingConfiguredForInput = useMemo(() => {
    if (!isImageUnderstandingToolConfigured(config.officialToolSettings)) return false;
    const selection = config.officialToolSettings?.imageUnderstanding;
    const provider = providers.find(item => item.id === selection?.providerId);
    if (!provider || isRuntimeBackedProvider(provider)) return false;
    if (!isProviderAvailable(provider, apiKeys, providerVerifyStatus)) return false;
    const model = provider.models.find(item => item.model === selection?.model);
    return Array.isArray(model?.inputModalities) && model.inputModalities.includes('image');
  }, [apiKeys, config.officialToolSettings, providerVerifyStatus, providers]);
  const officialToolNeedsConfig = useMemo(
    () => ({ [IMAGE_UNDERSTANDING_TOOL_ID]: !imageUnderstandingConfiguredForInput }),
    [imageUnderstandingConfiguredForInput],
  );
  const globallyVisiblePlugins = useMemo(
    () => (config.plugins ?? [])
      .filter(p => config.enabledPlugins?.[p.id] === true)
      .map(p => ({ id: p.id, name: p.name, description: p.description })),
    [config.plugins, config.enabledPlugins],
  );

  // ── split view state machine (v1 L671–1037, minus narrow-layout gate) ──
  const isSplitViewEnabled = config.experimentalSplitView ?? true;
  const [splitFile, setSplitFile] = useState<SplitPreviewFile | null>(null);
  useEffect(() => { if (!isSplitViewEnabled) setSplitFile(null); }, [isSplitViewEnabled]);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const isDraggingSplitRef = useRef(false);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const dragMoveRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const dragUpRef = useRef<(() => void) | null>(null);

  const [terminalId, setTerminalId] = useState<string | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  terminalIdRef.current = terminalId;
  const [terminalAlive, setTerminalAlive] = useState(false);
  const [terminalPinned, setTerminalPinned] = useState(false);
  const [splitActiveView, setSplitActiveView] = useState<'file' | 'terminal' | 'browser'>('file');

  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserAlive, setBrowserAlive] = useState(false);
  const [browserSourceFile, setBrowserSourceFile] = useState<{ name: string; content: string; size: number; path: string } | null>(null);
  const [browserCurrentUrl, setBrowserCurrentUrl] = useState<string>('');
  const handleBrowserUrlChange = useCallback((u: string) => {
    setBrowserCurrentUrl(u);
  }, []);

  const splitPanelVisible = splitFile !== null
    || (terminalPinned && (terminalAlive || splitActiveView === 'terminal'))
    || (browserUrl !== null);
  const terminalMounted = terminalAlive || (terminalPinned && splitActiveView === 'terminal');

  // Cmd+W: split panel absorbs it first.
  useCloseLayer(() => {
    if (!splitPanelVisible) return false;
    if (splitActiveView === 'file' && splitFile) {
      setSplitFile(null);
      if (browserUrl) setSplitActiveView('browser');
      else if (terminalPinned && terminalAlive) setSplitActiveView('terminal');
      return true;
    }
    if (splitActiveView === 'terminal' && terminalPinned) {
      setTerminalPinned(false);
      if (browserUrl) setSplitActiveView('browser');
      else if (splitFile) setSplitActiveView('file');
      return true;
    }
    if (splitActiveView === 'browser' && browserUrl) {
      setBrowserUrl(null);
      setBrowserAlive(false);
      setBrowserSourceFile(null);
      setBrowserCurrentUrl('');
      if (terminalPinned && terminalAlive) setSplitActiveView('terminal');
      else if (splitFile) setSplitActiveView('file');
      return true;
    }
    return false;
  }, 0);

  const handleSplitFilePreview = useCallback((file: SplitPreviewFile, options?: { initialEditMode?: boolean }) => {
    const ext = file.name.toLowerCase().split('.').pop();
    const isLocalFile = file.sourceScope === 'local';
    if ((ext === 'html' || ext === 'htm') && isSplitViewEnabled && !file.focusTarget) {
      setBrowserSourceFile(isLocalFile ? null : file);
      const sep = agentDir?.includes('\\') ? '\\' : '/';
      const absPath = isLocalFile ? (file.localPath ?? file.path) : (agentDir ? `${agentDir}${sep}${file.path}` : file.path);
      setBrowserUrl(absPath);
      setSplitActiveView('browser');
    } else {
      setSplitFile({ ...file, initialEditMode: options?.initialEditMode });
      setSplitActiveView('file');
    }
  }, [isSplitViewEnabled, agentDir]);

  const handleOpenTerminal = useCallback(() => {
    setTerminalPinned(true);
    setSplitActiveView('terminal');
  }, []);

  const handleOpenInBrowserPanel = useCallback((url: string) => {
    setBrowserUrl(url);
    setSplitActiveView('browser');
  }, []);

  const handleOpenBrowser = useCallback(() => {
    setBrowserUrl((prev) => prev ?? BROWSER_BLANK_URL);
    setSplitActiveView('browser');
  }, []);

  const handleBrowserCreated = useCallback(() => setBrowserAlive(true), []);
  const handleBrowserCreateFailed = useCallback(() => {
    setBrowserAlive(false);
    setBrowserUrl(null);
    setBrowserSourceFile(null);
    setBrowserCurrentUrl('');
  }, []);
  const handleBrowserClose = useCallback(() => {
    setBrowserUrl(null);
    setBrowserAlive(false);
    setBrowserSourceFile(null);
    setBrowserCurrentUrl('');
    if (terminalPinned && terminalAlive) setSplitActiveView('terminal');
    else if (splitFile) setSplitActiveView('file');
  }, [terminalPinned, terminalAlive, splitFile]);

  const handleBrowserSwitchToEditor = useCallback(async () => {
    if (!browserSourceFile || !agentDir) return;
    setSplitActiveView('file');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const sep = agentDir.includes('\\') ? '\\' : '/';
      const absPath = `${agentDir}${sep}${browserSourceFile.path}`;
      const fresh = await invoke<string | null>('cmd_read_workspace_file', { path: absPath });
      if (fresh !== null) {
        const updated = { ...browserSourceFile, content: fresh, size: new Blob([fresh]).size };
        setBrowserSourceFile(updated);
        setSplitFile(updated);
      } else {
        setSplitFile(browserSourceFile);
      }
    } catch {
      setSplitFile(browserSourceFile);
    }
  }, [browserSourceFile, agentDir]);

  const handleEditorSwitchToBrowser = useCallback(() => {
    if (!browserUrl) return;
    setSplitActiveView('browser');
    setTimeout(() => {
      import('@tauri-apps/api/core').then(({ invoke: inv }) => {
        inv('cmd_browser_reload', { tabId }).catch(() => {});
      });
    }, 300);
  }, [browserUrl, tabId]);

  const browserPanelCtx = useMemo(
    () => (isSplitViewEnabled ? { openUrl: handleOpenInBrowserPanel } : null),
    [isSplitViewEnabled, handleOpenInBrowserPanel],
  );

  useEffect(() => {
    if (!tabIsActive || !browserPanelCtx) return;
    const handler = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      const url = (e.detail as { url?: unknown } | null)?.url;
      if (typeof url !== 'string' || !url) return;
      e.preventDefault();
      browserPanelCtx.openUrl(url);
    };
    window.addEventListener(CUSTOM_EVENTS.OPEN_IN_BROWSER_PANEL, handler);
    return () => window.removeEventListener(CUSTOM_EVENTS.OPEN_IN_BROWSER_PANEL, handler);
  }, [tabIsActive, browserPanelCtx]);

  // Cleanup terminal PTY on unmount (Tab close).
  useEffect(() => {
    return () => {
      const id = terminalIdRef.current;
      if (id) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('cmd_terminal_close', { terminalId: id }).catch(() => {});
        });
      }
    };
  }, []);

  const handleSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    setIsDraggingSplit(true);
    const startX = e.clientX;
    const startRatio = splitRatioRef.current;
    const containerWidth = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const dx = ev.clientX - startX;
      const newRatio = Math.max(0.35, Math.min(0.65, startRatio + dx / containerWidth));
      setSplitRatio(newRatio);
    };
    const onMouseUp = () => {
      isDraggingSplitRef.current = false;
      setIsDraggingSplit(false);
      dragMoveRef.current = null;
      dragUpRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    dragMoveRef.current = onMouseMove;
    dragUpRef.current = onMouseUp;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Cleanup drag listeners on unmount.
  useEffect(() => {
    return () => {
      if (dragMoveRef.current) document.removeEventListener('mousemove', dragMoveRef.current);
      if (dragUpRef.current) document.removeEventListener('mouseup', dragUpRef.current);
      isDraggingSplitRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // ── chat scroll model + controller ──
  const chatScrollModel = useChatScrollModel({
    historyMessages,
    streamingMessage,
    firstItemIndex,
    sessionId,
  });
  const chatScrollController = useChatScrollController({
    messages: chatScrollModel.data,
    isActive: tabIsActive,
    rootRef: chatContentRef,
  });
  const {
    virtuosoRef,
    scrollerRef,
    followEnabledRef,
    scrollToBottom,
    pauseAutoScroll,
    handleAtBottomChange,
    attachScroller,
    scrollToMessage,
    scrollToTool,
    captureAnchor,
    restoreAnchorAfterNextCommit,
    onRowLayoutChanged,
  } = chatScrollController;
  const handleInputOverlayHeightChange = useCallback((height: number) => {
    setInputOverlayHeight(prev => Math.abs(prev - height) < 1 ? prev : Math.ceil(height));
  }, []);

  // ── in-page text finder (Cmd/Ctrl+F) ──
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const chatSearch = useChatSearch({
    scrollerRef: scrollerRef as React.RefObject<HTMLElement | null>,
    messages: chatScrollModel.data,
    scrollToMessage,
    active: chatSearchOpen,
  });
  const handleLoadOlderMessages = useCallback(() => {
    void loadOlderMessages({
      beforePrepend: () => {
        const anchor = captureAnchor('prepend-older');
        if (anchor) {
          restoreAnchorAfterNextCommit(anchor, { behavior: 'auto' });
        }
      },
    });
  }, [captureAnchor, loadOlderMessages, restoreAnchorAfterNextCommit]);
  const chatSearchSetQueryRef = useRef(chatSearch.setQuery);
  chatSearchSetQueryRef.current = chatSearch.setQuery;
  const closeChatSearch = useCallback(() => {
    setChatSearchOpen(false);
    chatSearchSetQueryRef.current('');
  }, []);

  useCloseLayer(() => {
    if (!chatSearchOpen) return false;
    closeChatSearch();
    return true;
  }, 100);

  useEffect(() => {
    if (!tabIsActive) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      if (!isHighlightApiSupported()) {
        toast.error(t('shell.toasts.searchUnsupported'));
        return;
      }
      setChatSearchOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabIsActive, toast, t]);

  useEffect(() => {
    if (!tabIsActive && chatSearchOpen) closeChatSearch();
  }, [tabIsActive, chatSearchOpen, closeChatSearch]);

  // Auto-focus input when Tab becomes active.
  useEffect(() => {
    if (tabIsActive && inputRef.current) {
      setTimeout(() => { inputRef.current?.focus(); }, 50);
    }
  }, [tabIsActive]);

  // ── handlers ──
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatInputRef = useRef<SimpleChatInputHandle | null>(null);
  const directoryPanelRef = useRef<DirectoryPanelHandle | null>(null);

  const handleSendMessage = useCallback(async (text: string, images?: ImageAttachment[]): Promise<boolean | void> => {
    if ((!text && (!images || images.length === 0)) || sessionState === 'stopping') {
      return false;
    }
    if (builtinSnapshotProviderSelectionIncomplete) {
      toastRef.current.warning(t('shell.toasts.snapshotProviderIncomplete'));
      return false;
    }
    if (!isExternalRuntime && isRuntimeBackedProvider(currentProviderRef.current)) {
      toastRef.current.warning(t('shell.toasts.codexSubscriptionNeedsSession'));
      return false;
    }
    const isAiBusy = isLoading || sessionState === 'running' || sessionState === 'starting';
    if (isAiBusy && queuedMessages.length >= 5) {
      toastRef.current.warning(t('shell.toasts.queueLimit'));
      return false;
    }
    scrollToBottom();
    if (!isAiBusy) setIsLoading(true);

    try {
      const providerRoute = buildBuiltinProviderRoute(currentProviderRef.current, effectiveModel);
      const providerEnv = providerRoute ? undefined : buildProviderEnv(currentProviderRef.current);
      await sendMessage(
        text,
        images,
        effectivePermissionMode,
        effectiveModel,
        isExternalRuntime ? undefined : providerEnv,
        undefined,
        isExternalRuntime ? undefined : reasoningEffort,
        isExternalRuntime ? undefined : providerRoute,
      );
    } catch (error) {
      const errorMessage = {
        id: `error-${crypto.randomUUID()}`,
        role: 'assistant' as const,
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      if (!isAiBusy) {
        setIsLoading(false);
        setSessionState('idle');
      }
    }
  }, [sessionState, isLoading, queuedMessages.length, sendMessage, effectivePermissionMode, effectiveModel, reasoningEffort, isExternalRuntime, builtinSnapshotProviderSelectionIncomplete, scrollToBottom, setMessages, setIsLoading, setSessionState, t]);

  const handleSendMessageRef = useRef(handleSendMessage);
  handleSendMessageRef.current = handleSendMessage;

  const handleStop = useCallback(async () => {
    try {
      await stopResponse();
    } catch (error) {
      console.error('[ChatV2] Failed to stop message:', error);
    }
  }, [stopResponse]);

  // ── auto-send (launcher handoff) ──
  const initialMessageConsumedRef = useRef(false);
  const onInitialMessageConsumedRef = useRef(onInitialMessageConsumed);
  onInitialMessageConsumedRef.current = onInitialMessageConsumed;
  const initialMessageRuntimeReady = useMemo(() => {
    const identity = initialMessage?.providerExecutionIdentity;
    if (!identity) return true;
    if (currentRuntime !== identity.runtime) return false;
    return currentRuntimeSource === identity.runtimeSource;
  }, [initialMessage?.providerExecutionIdentity, currentRuntime, currentRuntimeSource]);

  useEffect(() => {
    if (!initialMessage) return;
    if (!shouldAutoSendInitialMessage({
      hasInitialMessage: true,
      alreadyConsumed: initialMessageConsumedRef.current,
      hasSessionId: !!sessionId,
      isConnected,
      isActive: tabIsActive,
      runtimeReady: initialMessageRuntimeReady,
    })) return;

    const launchMessage = initialMessage;
    initialMessageConsumedRef.current = true;

    const builtinSel = launchMessage.builtinSelection;
    const initialRuntimePermission = isExternalRuntime
      ? coerceInitialMessageRuntimePermission(launchMessage, currentRuntime)
      : undefined;
    const effectivePermission = (isExternalRuntime
      ? (initialRuntimePermission
        ?? effectiveRuntimePermissionMode
        ?? getDefaultRuntimePermissionMode(currentRuntime)
        ?? 'default')
      : (launchMessage.permissionMode ?? resolveBuiltinPermissionMode({
          projectSynced: false,
          statePermissionMode: permissionMode,
          agentPermissionMode: currentAgent?.permissionMode as string | undefined,
          projectPermissionMode: currentProject?.permissionMode,
          defaultPermissionMode: config.defaultPermissionMode,
        }))) as PermissionMode;
    const effectiveModelForSend = isExternalRuntime
      ? (coerceExternalRuntimeModelForUi(launchMessage.runtimeModel, currentRuntime)
        ?? effectiveRuntimeModel
        ?? runtimeModels?.find(m => m.isDefault)?.value)
      : (builtinSel?.model ?? selectedModel);
    const provider = builtinSel
      ? providers.find(p => p.id === builtinSel.providerId) ?? currentProvider
      : currentProvider;
    const providerRoute = buildBuiltinProviderRoute(provider, effectiveModelForSend);
    const providerEnv = providerRoute ? undefined : buildProviderEnv(provider);

    const autoSend = async () => {
      try {
        if (launchMessage.mcpEnabledServers?.length) {
          const allServers = await getAllMcpServers();
          syncMcpServerNames(allServers);
          const globalEnabled = await getEnabledMcpServerIds();
          const effective = allServers.filter(s =>
            globalEnabled.includes(s.id) && launchMessage.mcpEnabledServers!.includes(s.id),
          );
          await apiPost('/api/mcp/set', { servers: effective });
        }
        launcherOwnsInitialMcpRef.current = false;

        if (launchMessage.enabledPluginIds) {
          setWorkspaceEnabledPlugins(launchMessage.enabledPluginIds);
          await apiPost('/api/cc-plugin/session-enable', {
            enabledIds: launchMessage.enabledPluginIds,
          });
        }

        if (launchMessage.enabledOfficialToolIds !== undefined) {
          setWorkspaceOfficialToolEnabled(normalizeOfficialToolIds(launchMessage.enabledOfficialToolIds));
          await apiPost('/api/official-tools/session-enable', {
            enabledIds: launchMessage.enabledOfficialToolIds,
          });
        }
        launcherOwnsInitialOfficialToolsRef.current = false;

        if (launchMessage.permissionMode) {
          if (isExternalRuntime) {
            setRuntimePermissionMode(
              initialRuntimePermission
              ?? getDefaultRuntimePermissionMode(currentRuntime)
              ?? 'default',
            );
            const providerPermission = launchMessage.providerExecutionIdentity
              ? managedCodexRuntimePermissionToProviderPermission(launchMessage.permissionMode)
              : undefined;
            if (providerPermission) {
              setPermissionMode(providerPermission);
            }
          } else {
            setPermissionMode(launchMessage.permissionMode);
            projectSyncedRef.current = true;
          }
        }
        if (isExternalRuntime) {
          if (launchMessage.runtimeModel) {
            setRuntimeModel(coerceExternalRuntimeModelForUi(launchMessage.runtimeModel, currentRuntime));
          }
        } else if (builtinSel) {
          setSelectedProviderId(builtinSel.providerId);
          setSelectedModel(builtinSel.model);
          providerInitRef.current = true;
        }
        if (launchMessage.reasoningEffort) {
          const launchReasoningEffort = isExternalRuntime
            ? (coerceReasoningEffortForUi(launchMessage.reasoningEffort, currentRuntime) ?? 'default')
            : launchMessage.reasoningEffort;
          setReasoningEffort(launchReasoningEffort);
          if (configDispositionRef.current === 'pending') {
            deferredEffortPushRef.current = launchReasoningEffort;
          } else {
            void apiPost('/api/reasoning-effort/set', { effort: launchReasoningEffort });
          }
        }

        setIsLoading(true);
        scrollToBottom();

        await sendMessage(
          launchMessage.text,
          launchMessage.images,
          effectivePermission,
          effectiveModelForSend,
          isExternalRuntime || providerRoute ? undefined : providerEnv,
          undefined,
          isExternalRuntime ? undefined : (launchMessage.reasoningEffort ?? reasoningEffort),
          isExternalRuntime ? undefined : providerRoute,
        );

        onInitialMessageConsumedRef.current?.();
      } catch (err) {
        console.error('[ChatV2] Auto-send failed:', err);
        if (launcherOwnsInitialMcpRef.current) {
          launcherOwnsInitialMcpRef.current = false;
        }
        try {
          chatInputRef.current?.setValue(launchMessage.text);
          if (launchMessage.images && launchMessage.images.length > 0) {
            chatInputRef.current?.setImages(launchMessage.images);
          }
        } catch (restoreErr) {
          console.warn('[ChatV2] failed to restore launcher draft:', restoreErr);
        }
        onInitialMessageConsumedRef.current?.();
        toastRef.current.error(t('shell.toasts.autoSendRestoredDraft'));
      }
    };
    void autoSend();
  }, [initialMessage, sessionId, isConnected, tabIsActive, initialMessageRuntimeReady]);

  // ── permission mode sync from backend ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tabId && detail.tabId !== tabId) return;
      const mode = detail?.permissionMode as PermissionMode | undefined;
      if (mode && mode !== permissionModeRef.current) {
        setPermissionMode(mode);
      }
    };
    window.addEventListener('permission-mode-sync', handler);
    return () => window.removeEventListener('permission-mode-sync', handler);
  }, [tabId]);

  // Stable callbacks for MessageList
  const handlePermissionDecision = useCallback((requestId: string, decision: 'deny' | 'allow_once' | 'always_allow') => {
    return respondPermission(decision, requestId);
  }, [respondPermission]);

  const handleAskUserQuestionSubmit = useCallback((_requestId: string, answers: Record<string, string>) => {
    void respondAskUserQuestion(answers);
  }, [respondAskUserQuestion]);

  const handleAskUserQuestionCancel = useCallback(() => {
    void respondAskUserQuestion(null);
  }, [respondAskUserQuestion]);

  const handleExitPlanModeApprove = useCallback(async () => {
    const ok = await respondExitPlanMode(true);
    if (!ok) toastRef.current.error(t('shell.toasts.submitFailedRetry'));
  }, [respondExitPlanMode, t]);

  const handleExitPlanModeReject = useCallback(async (feedback?: string) => {
    const ok = await respondExitPlanMode(false, feedback);
    if (!ok) toastRef.current.error(t('shell.toasts.submitFailedRetry'));
  }, [respondExitPlanMode, t]);

  const handleDismissSystemNotice = useCallback(() => {
    setSystemNotice(null);
  }, [setSystemNotice]);

  // ── workspace loaders ──
  const loadAndSyncAgents = useCallback(async () => {
    try {
      const response = await apiGet<{ success: boolean; agents: Record<string, { description: string; prompt: string; model?: string; scope?: 'user' | 'project'; folderName?: string }> }>('/api/agents/enabled');
      if (response.success && response.agents) {
        setEnabledAgents(response.agents);
        if (configDispositionRef.current !== 'push') {
          if (isDebugMode()) {
            console.log('[ChatV2] Skipping agents push (joined existing sidecar)');
          }
          return;
        }
        await apiPost('/api/agents/set', { agents: response.agents });
        if (isDebugMode()) {
          console.log('[ChatV2] Agents synced:', Object.keys(response.agents).join(', ') || 'none');
        }
      }
    } catch (err) {
      console.error('[ChatV2] Failed to load agents:', err);
    }
  }, [apiGet, apiPost, configPending]);

  const loadSkillsAndCommands = useCallback(async () => {
    if (!fileService.isAvailable) return;
    try {
      const response = await fileService.listSlashCommands();
      if (response.success && response.commands) {
        setEnabledSkills(response.commands.filter(c => c.source === 'skill').map(c => ({ name: c.name, description: c.description, scope: c.scope, folderName: c.folderName })));
        setEnabledCommands(response.commands.filter(c => c.source === 'custom').map(c => ({ name: c.name, description: c.description, scope: c.scope, fileName: c.fileName })));
        setGlobalSkillFolderNames(new Set(response.globalSkillFolderNames || []));
      }
    } catch (err) {
      console.error('[ChatV2] Failed to load skills/commands:', err);
    }
  }, [fileService]);

  const loadSkillsAndCommandsRef = useRef(loadSkillsAndCommands);
  loadSkillsAndCommandsRef.current = loadSkillsAndCommands;

  const handleSyncSkillToGlobal = useCallback(async (folderName: string) => {
    try {
      const res = await apiPost<{ success: boolean; error?: string }>('/api/skill/copy-to-global', { folderName });
      if (res.success) {
        toastRef.current.success(t('shell.toasts.skillSyncedToGlobal'));
        loadSkillsAndCommandsRef.current();
      } else {
        toastRef.current.error(res.error || t('shell.toasts.syncFailed'));
      }
    } catch (err) {
      console.error('[ChatV2] Sync skill to global failed:', err);
      toastRef.current.error(t('shell.toasts.syncFailedRetry'));
    }
  }, [apiPost, t]);

  const triggerWorkspaceRefresh = useCallback(() => {
    setWorkspaceRefreshTrigger(prev => prev + 1);
    setIntroductionRefreshTrigger(prev => prev + 1);
  }, []);

  const handleInsertReference = useCallback((paths: string[]) => {
    chatInputRef.current?.insertReferences(paths);
  }, []);

  const handleInsertSlashCommand = useCallback((command: string) => {
    chatInputRef.current?.insertSlashCommand(command);
  }, []);

  const [showWorkspaceConfig, setShowWorkspaceConfig] = useState(false);
  const handleOpenSettings = useCallback((initialSelect?: import('../../shared/skillsTypes').CapabilityInitialSelect) => {
    setWorkspaceConfigInitialTab('skills');
    setWorkspaceConfigInitialSelect(initialSelect);
    setShowWorkspaceConfig(true);
  }, []);

  // Load capabilities on mount and when workspace config changes.
  useEffect(() => {
    loadAndSyncAgents();
    loadSkillsAndCommands();
  }, [loadAndSyncAgents, loadSkillsAndCommands, workspaceRefreshTrigger]);

  // MCP config load + sync.
  useEffect(() => {
    const loadMcpConfig = async () => {
      try {
        const servers = await getAllMcpServers();
        const enabledIds = await getEnabledMcpServerIds();
        setMcpServers(servers);
        syncMcpServerNames(servers);
        setGlobalMcpEnabled(enabledIds);

        if (configDispositionRef.current !== 'push') {
          if (isDebugMode()) {
            console.log('[ChatV2] Skipping MCP push (joined existing sidecar)');
          }
          return;
        }
        if (!isConnected) return;
        if (isSessionLoading) return;
        if (launcherOwnsInitialMcpRef.current) return;

        const workspaceEnabled = workspaceMcpEnabled;
        const effectiveServers = servers.filter(s =>
          enabledIds.includes(s.id) && workspaceEnabled.includes(s.id),
        );
        await apiPost('/api/mcp/set', { servers: effectiveServers });
        if (isDebugMode()) {
          console.log('[ChatV2] Initial MCP sync:', effectiveServers.map(s => s.id).join(', ') || 'none');
        }
      } catch (err) {
        console.error('[ChatV2] Failed to load MCP config:', err);
      }
    };
    loadMcpConfig();
  }, [
    configPending,
    isConnected,
    isSessionLoading,
    workspaceMcpEnabled,
    config?.mcpEnabledServers,
    config?.mcpServerEnv,
    config?.mcpServerArgs,
    config?.mcpServers,
  ]);

  useEffect(() => {
    const syncOfficialTools = async () => {
      if (configDispositionRef.current !== 'push') return;
      if (!isConnected || isSessionLoading) return;
      if (launcherOwnsInitialOfficialToolsRef.current) return;
      try {
        await apiPost('/api/official-tools/session-enable', {
          enabledIds: workspaceOfficialToolEnabled,
        });
      } catch (err) {
        console.error('[ChatV2] Failed to sync official tools:', err);
      }
    };
    void syncOfficialTools();
  }, [
    apiPost,
    configPending,
    isConnected,
    isSessionLoading,
    workspaceOfficialToolEnabled,
    config?.enabledOfficialToolIds,
    config?.officialToolSettings,
  ]);

  // Sync workspace MCP to project config when it changes.
  useEffect(() => {
    if (sessionMeta?.configSnapshotAt) return;
    if (currentProject?.mcpEnabledServers) {
      setWorkspaceMcpEnabled(currentProject.mcpEnabledServers);
    }
  }, [currentProject?.mcpEnabledServers, sessionMeta?.configSnapshotAt]);

  useEffect(() => {
    if (sessionMeta?.configSnapshotAt) return;
    const next = currentAgent?.enabledOfficialToolIds ?? currentProject?.enabledOfficialToolIds;
    if (next) setWorkspaceOfficialToolEnabled(normalizeOfficialToolIds(next));
  }, [currentAgent?.enabledOfficialToolIds, currentProject?.enabledOfficialToolIds, sessionMeta?.configSnapshotAt]);

  // Sync selectedModel when provider changes (skip initial mount).
  const providerInitRef = useRef(true);
  useEffect(() => {
    if (providerInitRef.current) {
      providerInitRef.current = false;
      return;
    }
    if (sessionSnapshotOwnsConfig) return;
    if (currentProvider?.primaryModel) {
      setSelectedModel(currentProvider.primaryModel);
    }
  }, [currentProvider?.id, currentProvider?.primaryModel, currentProvider?.models, currentProvider?.type, selectedModel, sessionSnapshotOwnsConfig]);

  // One-time sync: apply project-stored settings after useConfig finishes async load.
  useEffect(() => {
    if (!currentProject || projectSyncedRef.current || hadInitialMessage.current || configPending) return;
    if (waitingForExistingSessionMeta) return;
    if (sessionSnapshotOwnsConfig) {
      projectSyncedRef.current = true;
      return;
    }
    projectSyncedRef.current = true;
    const effectivePermission = (currentAgent?.permissionMode as PermissionMode | undefined) ?? currentProject.permissionMode ?? config.defaultPermissionMode;
    setPermissionMode(effectivePermission);
    const effectiveProvider = currentAgent?.providerId ?? currentProject.providerId;
    if (effectiveProvider) {
      setSelectedProviderId(effectiveProvider);
      providerInitRef.current = true;
    }
    const effectiveModel = currentAgent?.model ?? currentProject.model;
    if (effectiveModel && configDispositionRef.current === 'push') {
      setSelectedModel(effectiveModel);
    }
    if (!isExternalRuntime && configDispositionRef.current === 'push') {
      setReasoningEffort(currentAgent?.reasoningEffort ?? 'default');
    }
  }, [currentProject?.id, configPending, sessionId, sessionMeta, sessionSnapshotOwnsConfig]);

  // Adoption effect (join existing sidecar config).
  const onSidecarConfigAdoptedRef = useRef(onSidecarConfigAdopted);
  onSidecarConfigAdoptedRef.current = onSidecarConfigAdopted;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  useEffect(() => {
    if (!isAdopt) return;
    const adoptingSessionId = sessionId;
    const isCurrentAdoption = () =>
      adoptingSessionId === sessionIdRef.current && configDispositionRef.current === 'adopt';

    const adoptConfig = async () => {
      try {
        const config = await apiGet<{
          success: boolean;
          runtime?: RuntimeType;
          model?: string | null;
          mcpServerIds?: string[] | null;
          enabledOfficialToolIds?: OfficialToolId[] | null;
          permissionMode?: string | null;
          providerId?: string | null;
          reasoningEffort?: string | null;
        }>('/api/session/config');
        if (config.success) {
          if (!isCurrentAdoption()) return;
          const sidecarRuntime = config.runtime ?? currentRuntime;
          const sidecarIsExternal = sidecarRuntime !== 'builtin';

          if (config.model) {
            if (sidecarIsExternal) {
              setRuntimeModel(config.model);
            } else {
              setSelectedModel(config.model);
            }
          }
          if (config.permissionMode) {
            if (sidecarIsExternal) {
              setRuntimePermissionMode(config.permissionMode);
            } else {
              setPermissionMode(config.permissionMode as PermissionMode);
            }
          }
          const adoptedProviderId = resolveAdoptedBuiltinProviderId(sidecarIsExternal, config.providerId);
          if (adoptedProviderId !== undefined) {
            setSelectedProviderId(adoptedProviderId);
          }
          if (Array.isArray(config.mcpServerIds)) {
            setWorkspaceMcpEnabled(config.mcpServerIds);
          }
          if (Array.isArray(config.enabledOfficialToolIds)) {
            setWorkspaceOfficialToolEnabled(normalizeOfficialToolIds(config.enabledOfficialToolIds));
          }
          if (config.reasoningEffort) {
            setReasoningEffort(config.reasoningEffort);
          }
          if (adoptingSessionId) {
            adoptedSessionRef.current = adoptingSessionId;
          }
        }
      } catch (err) {
        console.error('[ChatV2] Failed to read sidecar config:', err);
      } finally {
        if (isCurrentAdoption()) {
          onSidecarConfigAdoptedRef.current?.();
        }
      }
    };
    adoptConfig();
  }, [isAdopt]);

  // ── provider change handlers ──
  const handleProviderChange = useCallback(async (providerId: string, targetModel?: string) => {
    // v2 phase boundary: cross-provider switch on non-empty history requires a
    // new tab (v1 opens via onForkSession). Until v2 multi-tab fork lands, refuse
    // with a toast. Same-provider model change is safe.
    if (effectiveSelectedProviderId === providerId) {
      if (targetModel) {
        setSelectedModel(targetModel);
      }
      return;
    }
    const newProvider = providers.find(p => p.id === providerId);
    const model = targetModel ?? newProvider?.primaryModel;
    if (!model) return;
    const nextIntent = buildProviderExecutionIntent(newProvider, model);
    if (messagesRef.current.length > 0 || isRuntimeBackedIntent(nextIntent)) {
      toastRef.current.warning(t('shell.toasts.switchNeedsNewTab'));
      return;
    }
    track('provider_switch', { provider_id: providerId });
    setSelectedProviderId(providerId);
    if (model) {
      setSelectedModel(model);
      if (nextIntent?.kind === 'runtime-backed-provider') {
        setRuntimeModel(nextIntent.model);
      }
    }
    providerInitRef.current = true;
  }, [effectiveSelectedProviderId, providers, t]);

  const handleBuiltinModelSelect = useCallback((selection: { providerId: string; model: string }) => {
    setSelectedProviderId(selection.providerId);
    setSelectedModel(selection.model);
    providerInitRef.current = true;
  }, []);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    providerInitRef.current = true;
  }, []);

  const handleReasoningEffortChange = useCallback((effort: string) => {
    setReasoningEffort(effort);
    if (configDispositionRef.current === 'push') {
      void apiPost('/api/reasoning-effort/set', { effort });
    }
  }, [apiPost]);

  const handlePermissionModeChange = useCallback((mode: PermissionMode) => {
    setPermissionMode(mode);
  }, []);

  const handleWorkspaceMcpToggle = useCallback((serverId: string, enabled: boolean) => {
    setWorkspaceMcpEnabled(prev => {
      return enabled ? [...prev, serverId] : prev.filter(id => id !== serverId);
    });
  }, []);

  const handleWorkspaceOfficialToolToggle = useCallback((toolId: OfficialToolId, enabled: boolean) => {
    setWorkspaceOfficialToolEnabled(prev => {
      const next = enabled ? [...prev, toolId] : prev.filter(id => id !== toolId);
      return next;
    });
  }, []);

  const handleWorkspacePluginToggle = useCallback((pluginId: string, enabled: boolean) => {
    setWorkspaceEnabledPlugins(prev => {
      return enabled ? [...prev, pluginId] : prev.filter(id => id !== pluginId);
    });
  }, []);

  const handleCancelQueued = useCallback((queueId: string) => {
    void cancelQueuedMessage(queueId);
  }, [cancelQueuedMessage]);

  const handleForceExecuteQueued = useCallback((queueId: string) => {
    void forceExecuteQueuedMessage(queueId);
  }, [forceExecuteQueuedMessage]);

  const handleCancelQueuedVoid = useCallback((queueId: string) => {
    void cancelQueuedMessage(queueId);
  }, [cancelQueuedMessage]);

  const handleForceExecuteQueuedVoid = useCallback((queueId: string) => {
    void forceExecuteQueuedMessage(queueId);
  }, [forceExecuteQueuedMessage]);

  // ── file drop zones ──
  const handleFileDrop = useCallback((files: File[]) => {
    chatInputRef.current?.processDroppedFiles(files);
  }, []);

  const { isDragActive, dragHandlers } = useFileDropZone({
    onFilesDropped: handleFileDrop,
  });

  const handleTauriChatDrop = useCallback(async (paths: string[]) => {
    if (isDebugMode()) console.log('[ChatV2] Tauri drop on chat area:', paths);
    await chatInputRef.current?.processDroppedFilePaths?.(paths);
    triggerWorkspaceRefresh();
  }, [triggerWorkspaceRefresh]);

  const handleTauriDirectoryDrop = useCallback(async (paths: string[], position?: { x: number; y: number }) => {
    if (isDebugMode()) console.log('[ChatV2] Tauri drop on directory panel:', paths, position);
    await directoryPanelRef.current?.handleFileDrop(paths, position);
  }, []);

  const handleTauriChatDropRef = useRef(handleTauriChatDrop);
  const handleTauriDirectoryDropRef = useRef(handleTauriDirectoryDrop);
  useEffect(() => {
    handleTauriChatDropRef.current = handleTauriChatDrop;
    handleTauriDirectoryDropRef.current = handleTauriDirectoryDrop;
  }, [handleTauriChatDrop, handleTauriDirectoryDrop]);

  const { isDragging: isTauriDragging, activeZoneId, registerZone, unregisterZone } = useTauriFileDrop({
    enabled: tabIsActive,
    onDrop: (paths, zoneId, position) => {
      if (isDebugMode()) console.log('[ChatV2] Tauri drop event - zoneId:', zoneId, 'paths:', paths);
      if (zoneId === 'chat-content') {
        void handleTauriChatDropRef.current(paths);
      } else if (zoneId === 'directory-panel') {
        void handleTauriDirectoryDropRef.current(paths, position);
      } else {
        void handleTauriChatDropRef.current(paths);
      }
    },
  });

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    registerZone('chat-content', chatContentRef.current, () => {});
    registerZone('directory-panel', directoryPanelContainerRef.current, () => {});
    return () => {
      unregisterZone('chat-content');
      unregisterZone('directory-panel');
    };
  }, [registerZone, unregisterZone]);

  const isAnyDragActive = isDragActive || isTauriDragging;

  // ── status panel slots ──
  const supportsAgentStatusPanel = currentRuntime === 'builtin' || currentRuntime === 'codex';
  const handleJumpToTool = useCallback((toolId: string) => {
    scrollToTool(toolId);
  }, [scrollToTool]);

  const agentStatusSlot = useMemo(
    () => !supportsAgentStatusPanel
      ? undefined
      : (
        <AgentStatusPanel
          containerRef={chatContentRef}
          onJumpToTool={handleJumpToTool}
        />
      ),
    [supportsAgentStatusPanel, handleJumpToTool],
  );
  const contextIndicatorSlot = useMemo(
    () => <ContextUsageIndicator key={sessionId ?? 'none'} />,
    [sessionId],
  );

  // ── agent error banner props ──
  const handleDiagnoseAgentError = useCallback((message: string) => {
    launchSupportDiagnostics({
      source: 'agent_error',
      message,
      terminalReason: lastTerminalReason,
      sessionId: sessionIdRef.current,
      workspacePath: agentDir,
      runtime: currentRuntime,
    });
  }, [agentDir, currentRuntime, lastTerminalReason]);

  const agentErrorBannerProps = useMemo(() => {
    const message = agentError ?? '';
    return {
      message,
      onDiagnose: handleDiagnoseAgentError,
      onRetry: handleRetryRef.current,
    };
  }, [agentError, handleDiagnoseAgentError]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const handleRetry = useCallback(() => {
    // v2 phase boundary: retry = rewind to before last user message + resend.
    const lastUser = [...messagesRef.current].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    const content = typeof lastUser.content === 'string' ? lastUser.content : '';
    if (content) void handleSendMessageRef.current(content);
  }, []);

  const handleRetryRef = useRef(handleRetry);
  handleRetryRef.current = handleRetry;

  // ── reveal in tree ──
  const [treeExternalReveal, setTreeExternalReveal] = useState<{ id: number; path: string } | null>(null);
  const treeExternalRevealIdRef = useRef(0);
  const handleRevealInTree = useCallback((path: string) => {
    setTreeExternalReveal({ id: ++treeExternalRevealIdRef.current, path });
  }, []);
  const handleExternalRevealHandled = useCallback((id: number) => {
    setTreeExternalReveal((prev) => (prev?.id === id ? null : prev));
  }, []);

  // ── startup overlay / introduction ──
  // v2 phase boundary: v1 toggles showStartupOverlay via the ChatBootOverlay
  // completion callback (its visual slot). WUM12 has no boot overlay — the
  // intro overlay is governed purely by shouldShowIntroductionOverlay, so the
  // startup flag stays constant false. When ChatV2 gains a boot overlay,
  // reintroduce the state + its setter.
  const showStartupOverlay = false;
  const showIntroductionOverlay = shouldShowIntroductionOverlay({
    content: introductionContent,
    historyMessageCount: historyMessages.length,
    hasStreamingMessage: !!streamingMessage,
    isSessionLoading,
    isLoading,
    sessionState,
    showStartupOverlay,
  });

  // Deferred effort push (pending → push after disposition resolves).
  const deferredEffortPushRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (configPending) return;
    const effort = deferredEffortPushRef.current;
    if (effort === undefined) return;
    deferredEffortPushRef.current = undefined;
    if (configDispositionRef.current === 'push') {
      void apiPost('/api/reasoning-effort/set', { effort });
    }
  }, [configPending, apiPost]);

  // ── misc ──
  const currentProjectIcon = currentProject?.icon;
  const currentProjectDisplayName = currentProject?.displayName;

  return {
    tabId,
    agentDir,
    sessionId,
    messages,
    streamingMessage,
    isLoading,
    isSessionLoading,
    sessionState,
    sessionRuntime,
    sessionMeta,
    setSessionMeta,
    agentError,
    systemStatus,
    systemNotice,
    pendingPermission,
    pendingAskUserQuestion,
    pendingExitPlanMode,
    queuedMessages,
    toolCompleteCount,
    isConnected,
    sdkSlashCommands,
    runtimeDiagnostics,
    lastTerminalReason,
    chatScrollModel,
    chatScrollController,
    virtuosoRef,
    scrollerRef,
    followEnabledRef,
    scrollToBottom,
    pauseAutoScroll,
    handleAtBottomChange,
    attachScroller,
    scrollToMessage,
    scrollToTool,
    captureAnchor,
    restoreAnchorAfterNextCommit,
    onRowLayoutChanged,
    chatSearchOpen,
    setChatSearchOpen,
    chatSearch,
    closeChatSearch,
    selectedProviderId,
    selectedModel,
    setSelectedModel,
    effectiveSelectedProviderId,
    currentProvider,
    currentProviderAvailableForInput,
    availableProviderIdsForInput,
    selectedModelForInput: effectiveModel ?? '',
    reasoningEffort,
    setReasoningEffort,
    effectivePermissionMode,
    inputChromePermissionMode: effectivePermissionMode,
    inputUsesExternalRuntimeControls,
    currentRuntime,
    isExternalRuntime,
    multiAgentRuntimeEnabled,
    managedProviderRuntimeActive,
    runtimeDetections,
    runtimeModels,
    runtimePermissionModes,
    runtimeModel,
    runtimePermissionMode,
    currentProviderExecutionIntent,
    currentProviderForHistory,
    builtinSnapshotProviderSelectionIncomplete,
    builtinSnapshotProviderHistoryUnknown,
    apiKeys,
    providerVerifyStatus,
    handleSendMessage,
    handleStop,
    handleProviderChange,
    handleBuiltinModelSelect,
    handleModelChange,
    handleReasoningEffortChange,
    handlePermissionModeChange,
    handleWorkspaceMcpToggle,
    handleWorkspaceOfficialToolToggle,
    handleWorkspacePluginToggle,
    handleCancelQueued,
    handleForceExecuteQueued,
    handleCancelQueuedVoid,
    handleForceExecuteQueuedVoid,
    handleLoadOlderMessages,
    handlePermissionDecision,
    handleAskUserQuestionSubmit,
    handleAskUserQuestionCancel,
    handleExitPlanModeApprove,
    handleExitPlanModeReject,
    handleDismissSystemNotice,
    fileService,
    enabledAgents,
    enabledSkills,
    enabledCommands,
    globalSkillFolderNames,
    workspaceRefreshTrigger,
    triggerWorkspaceRefresh,
    loadAndSyncAgents,
    loadSkillsAndCommands,
    handleSyncSkillToGlobal,
    handleInsertReference,
    handleInsertSlashCommand,
    handleOpenSettings,
    currentProject,
    currentAgent,
    workspaceMcpEnabled,
    globalMcpEnabled,
    mcpServers,
    workspaceEnabledPlugins,
    workspaceOfficialToolEnabled,
    globalOfficialToolEnabled,
    officialToolNeedsConfig,
    globallyVisiblePlugins,
    splitFile,
    setSplitFile,
    splitRatio,
    setSplitRatio,
    isDraggingSplit,
    splitPanelVisible,
    splitActiveView,
    setSplitActiveView,
    terminalId,
    setTerminalId,
    terminalAlive,
    setTerminalAlive,
    terminalPinned,
    setTerminalPinned,
    browserUrl,
    browserAlive,
    setBrowserAlive,
    browserSourceFile,
    browserCurrentUrl,
    handleBrowserUrlChange,
    handleSplitDividerMouseDown,
    handleSplitFilePreview,
    handleOpenTerminal,
    handleOpenInBrowserPanel,
    handleOpenBrowser,
    handleBrowserCreated,
    handleBrowserCreateFailed,
    handleBrowserClose,
    handleBrowserSwitchToEditor,
    handleEditorSwitchToBrowser,
    handleRevealInTree,
    handleExternalRevealHandled,
    treeExternalReveal,
    browserPanelCtx,
    terminalMounted,
    isAnyDragActive,
    dragHandlers,
    isTauriDragging,
    activeZoneId,
    chatContentRef,
    directoryPanelContainerRef,
    chatInputRef,
    inputRef,
    directoryPanelRef,
    inputOverlayHeight,
    handleInputOverlayHeightChange,
    agentStatusSlot,
    contextIndicatorSlot,
    visibleSdkSlashCommands,
    showStartupOverlay,
    showIntroductionOverlay,
    introductionContent,
    showWorkspaceConfig,
    setShowWorkspaceConfig,
    workspaceConfigInitialTab,
    workspaceConfigInitialSelect,
    setWorkspaceConfigInitialTab,
    setWorkspaceConfigInitialSelect,
    config,
    providers,
    refreshProviderData,
    t,
    agentErrorBannerProps,
    currentProjectIcon,
    currentProjectDisplayName,
  };
}
