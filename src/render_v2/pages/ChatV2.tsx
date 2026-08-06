/**
 * ChatV2 — v2 Chat page ([final] WUM12 "Chat — B: 三栏工作台").
 *
 * Three-column workbench: FileTree (left, DirectoryPanel + AgentDock at the
 * bottom) / ChatColumn (middle: MessageList + ChatSearchPanel + SimpleChatInput +
 * SplitViewPanel) / AgentPanel (right: resident AgentStatusPanel).
 *
 * Orchestration lives in useChatControllerV2 (see its header for deliberate
 * deviations from v1). This view is a pure consumer of the controller contract —
 * no session/sidecar/MCP logic lives here.
 *
 * Layout notes (see CHAT-IDEAS caveats):
 *  - Split view uses v1's FLOW layout (left-column % width + divider + flex-1
 *    right panel), NOT WUM12's absolute overlay. handleSplitDividerMouseDown
 *    derives the ratio from `parentElement.getBoundingClientRect().width`, so
 *    the divider must be a direct child of the width-scaled column — an absolute
 *    overlay would silently break ratio math (drag = full-container-width jumps).
 *  - AgentStatusPanel (right column) keeps its own fade lifecycle: it unmounts
 *    when todos+subagents go to zero, so the right column shows an empty inset
 *    surface between activity. The always-present compact summary is the left
 *    column's AgentDock (v2-only, no v1 counterpart).
 *  - agentStatusSlot is NOT passed to SimpleChatInput — WUM12 moves it to the
 *    right column. contextIndicatorSlot stays in the input as in v1.
 */
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, TerminalSquare, X } from 'lucide-react';

import { FileActionProvider } from '@/context/FileActionContext';
import { BrowserPanelContext } from '@/context/BrowserPanelContext';
import DirectoryPanel, { type DirectoryPanelHandle } from '@/components/DirectoryPanel';
import DropZoneOverlay from '@/components/DropZoneOverlay';
import MessageList from '@/components/MessageList';
import SimpleChatInput from '@/components/SimpleChatInput';
import ChatSearchPanel from '@/components/ChatSearchPanel';
import ChatBootOverlay from '@/components/ChatBootOverlay';
import WorkspaceConfigPanel, { type Tab as WorkspaceTab } from '@/components/WorkspaceConfigPanel';
import { OFFICIAL_TOOLS } from '../../shared/official-tools';
import { useAgentStatusState } from '@/components/agent-status/useAgentStatusState';
import { useTabState } from '@/context/TabContext';
import type { ChatControllerV2 } from '../hooks/useChatControllerV2';

// Heavy leaf views — lazy like v1 Chat.
const LazyTerminalPanel = lazy(() => import('@/components/TerminalPanel').then(m => ({ default: m.TerminalPanel })));
const LazyBrowserPanel = lazy(() => import('@/components/BrowserPanel'));
const LazyIntroductionOverlay = lazy(() => import('@/components/IntroductionOverlay'));
const LazyFilePreviewModal = lazy(() => import('@/components/FilePreviewModal'));

/** WUM12 geometry — three-column workbench widths. */
const FILE_TREE_WIDTH = 220;
const AGENT_PANEL_WIDTH = 260;

interface ChatV2Props {
  controller: ChatControllerV2;
  isActive?: boolean;
}

export default function ChatV2({ controller, isActive }: ChatV2Props) {
  const { t } = useTranslation('chat');
  const { t: tApp } = useTranslation('app');

  const tabState = useTabState();

  // AgentDock (left column bottom): always-present compact summary derived from
  // the same state machine AgentStatusPanel uses. Right column AgentStatusPanel
  // unmounts when activity ends, so the dock carries the persistent "how busy
  // am I" read. tabState.messages is the mutable Message[] (chatScrollModel.data
  // is readonly), matching useAgentStatusState's contract.
  const agentStatusState = useAgentStatusState(tabState.messages, tabState.agentPlanTodos ?? null, tabState.sessionId ?? null);
  const contextUsage = tabState.contextUsage;

  const isStreaming =
    controller.isLoading ||
    controller.sessionState === 'running' ||
    controller.sessionState === 'starting';

  const {
    agentDir,
    sessionId,
    sessionState,
    systemStatus,
    isLoading,
    isSessionLoading,
    agentError,
    systemNotice,
    pendingPermission,
    pendingAskUserQuestion,
    pendingExitPlanMode,
    queuedMessages,
    chatScrollModel,
    virtuosoRef,
    followEnabledRef,
    scrollToBottom,
    handleAtBottomChange,
    attachScroller,
    onRowLayoutChanged,
    chatSearchOpen,
    chatSearch,
    closeChatSearch,
    handleSendMessage,
    handleStop,
    handleLoadOlderMessages,
    handlePermissionDecision,
    handleAskUserQuestionSubmit,
    handleAskUserQuestionCancel,
    handleExitPlanModeApprove,
    handleExitPlanModeReject,
    handleDismissSystemNotice,
    handleInsertReference,
    handleInsertSlashCommand,
    handleOpenSettings,
    handleWorkspaceMcpToggle,
    handleWorkspaceOfficialToolToggle,
    handleWorkspacePluginToggle,
    handleSyncSkillToGlobal,
    triggerWorkspaceRefresh,
    loadAndSyncAgents,
    loadSkillsAndCommands,
    enabledAgents,
    enabledSkills,
    enabledCommands,
    globalSkillFolderNames,
    workspaceRefreshTrigger,
    toolCompleteCount,
    currentProject,
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
    terminalMounted,
    browserUrl,
    browserAlive,
    browserSourceFile,
    browserCurrentUrl,
    handleBrowserUrlChange,
    handleSplitDividerMouseDown,
    handleSplitFilePreview,
    handleOpenTerminal,
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
    selectedModel,
    currentProvider,
    currentProviderAvailableForInput,
    availableProviderIdsForInput,
    builtinSnapshotProviderSelectionIncomplete,
    providers,
    refreshProviderData,
    reasoningEffort,
    handleReasoningEffortChange,
    handlePermissionModeChange,
    inputChromePermissionMode,
    inputUsesExternalRuntimeControls,
    currentRuntime,
    runtimeModel,
    runtimeModels,
    runtimePermissionModes,
    apiKeys,
    providerVerifyStatus,
    tabId,
    agentStatusSlot,
    agentErrorBannerProps,
  } = controller;

  // ---- Fullscreen preview (split panel's 「fullscreen」 — v1 keeps it in Chat
  // state; v2 owns a minimal local copy). ----
  const [fullscreenFile, setFullscreenFile] = useState<{
    name: string; content: string; size: number; path: string;
  } | null>(null);

  const handleWorkspaceConfigClose = useCallback(() => {
    setShowWorkspaceConfig(false);
    setWorkspaceConfigInitialTab(undefined);
    setWorkspaceConfigInitialSelect(undefined);
    triggerWorkspaceRefresh();
    loadAndSyncAgents();
    loadSkillsAndCommands();
  }, [setShowWorkspaceConfig, setWorkspaceConfigInitialTab, setWorkspaceConfigInitialSelect, triggerWorkspaceRefresh, loadAndSyncAgents, loadSkillsAndCommands]);

  // v2 phase boundary: quote-file (append @path, no trailing space) reuses
  // insert-reference (cursor insert). Same visual result in the composer.
  const handleQuoteFile = useCallback(
    (path: string) => handleInsertReference([path]),
    [handleInsertReference],
  );

  // ---- Split view tab switcher rows (v1 flow layout, verbatim semantics) ----

  const splitViewCount = [splitFile, terminalPinned && terminalAlive, browserUrl].filter(Boolean).length;

  const activeTabRow = useMemo(() => {
    if (splitViewCount < 2) return null;
    return (
      <div className="flex h-9 flex-shrink-0 items-center gap-0.5 border-b border-[var(--line)] bg-[var(--paper-elevated)] px-2">
        {splitFile && (
          <button
            type="button"
            onClick={() => setSplitActiveView('file')}
            className={`group relative flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              splitActiveView === 'file'
                ? 'text-[var(--ink)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            <span className="max-w-[120px] truncate">{splitFile.name}</span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setSplitFile(null);
                if (browserUrl) setSplitActiveView('browser');
                else if (terminalPinned && terminalAlive) setSplitActiveView('terminal');
              }}
              className="ml-0.5 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--paper-inset)] group-hover:opacity-100"
              title={t('shell.split.closeFile')}
            >
              <span className="text-sm leading-none text-[var(--ink-muted)]">×</span>
            </span>
            {splitActiveView === 'file' && (
              <div className="absolute inset-x-1 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent-warm)]" />
            )}
          </button>
        )}
        {terminalPinned && terminalAlive && (
          <button
            type="button"
            onClick={() => setSplitActiveView('terminal')}
            className={`group relative flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              splitActiveView === 'terminal'
                ? 'text-[var(--ink)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            <TerminalSquare className="h-3 w-3" />
            {t('shell.split.terminal')}
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setTerminalPinned(false);
                if (browserUrl) setSplitActiveView('browser');
                else if (splitFile) setSplitActiveView('file');
              }}
              className="ml-0.5 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--paper-inset)] group-hover:opacity-100"
              title={t('shell.split.hideTerminal')}
            >
              <span className="text-sm leading-none text-[var(--ink-muted)]">×</span>
            </span>
            {splitActiveView === 'terminal' && (
              <div className="absolute inset-x-1 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent-warm)]" />
            )}
          </button>
        )}
        {browserUrl && (
          <button
            type="button"
            onClick={() => setSplitActiveView('browser')}
            className={`group relative flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              splitActiveView === 'browser'
                ? 'text-[var(--ink)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            <span className="max-w-[120px] truncate">
              {browserSourceFile
                ? browserSourceFile.name
                : (() => {
                    const liveUrl = browserCurrentUrl || browserUrl;
                    try {
                      return new URL(liveUrl).hostname || t('shell.split.newTab');
                    } catch {
                      return t('shell.split.browser');
                    }
                  })()}
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                // Browser close resets url/source/alive + switches back — the
                // controller owns all four state transitions (handleBrowserClose).
                handleBrowserClose();
              }}
              className="ml-0.5 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--paper-inset)] group-hover:opacity-100"
              title={t('shell.split.closeBrowser')}
            >
              <span className="text-sm leading-none text-[var(--ink-muted)]">×</span>
            </span>
            {splitActiveView === 'browser' && (
              <div className="absolute inset-x-1 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent-warm)]" />
            )}
          </button>
        )}
      </div>
    );
  }, [splitViewCount, splitFile, terminalPinned, terminalAlive, browserUrl, browserSourceFile, browserCurrentUrl, splitActiveView, setSplitActiveView, setSplitFile, setTerminalPinned, handleBrowserClose, handleBrowserUrlChange, t]);

  return (
    <div className="relative flex h-full flex-row overflow-hidden overscroll-none bg-[var(--paper-elevated)] text-[var(--ink)]">
      {/* Left column — FileTree: workspace tree + bottom AgentDock (WUM12 220w,
          bg-secondary → var(--paper-inset), padding [16,12]). */}
      <div
        ref={directoryPanelContainerRef}
        className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line-subtle)] bg-[var(--paper-inset)]"
        style={{ width: FILE_TREE_WIDTH }}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-subtle)]">
            {tApp('space.agents.workspace')}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
          <DirectoryPanel
            ref={directoryPanelRef}
            agentDir={agentDir}
            projectIcon={currentProject?.icon}
            projectDisplayName={currentProject?.displayName}
            provider={currentProvider}
            providers={providers}
            onProviderChange={controller.handleProviderChange}
            onOpenConfig={handleOpenSettings}
            refreshTrigger={toolCompleteCount + workspaceRefreshTrigger}
            isTauriDragActive={isTauriDragging && activeZoneId === 'directory-panel'}
            onInsertReference={handleInsertReference}
            onQuoteFile={handleQuoteFile}
            externalRevealRequest={treeExternalReveal}
            onExternalRevealHandled={handleExternalRevealHandled}
            enabledAgents={enabledAgents}
            enabledSkills={enabledSkills}
            enabledCommands={enabledCommands}
            globalSkillFolderNames={globalSkillFolderNames}
            onInsertSlashCommand={handleInsertSlashCommand}
            onOpenSettings={handleOpenSettings}
            onSyncSkillToGlobal={handleSyncSkillToGlobal}
            onRefreshAll={triggerWorkspaceRefresh}
            onFilePreviewExternal={handleSplitFilePreview}
            onOpenTerminal={handleOpenTerminal}
            terminalAlive={terminalAlive}
            onOpenBrowser={handleOpenBrowser}
          />
        </div>
        <AgentDock statusState={agentStatusState} contextUsage={contextUsage} />
      </div>

      {/* Middle column — chat area + split view.
          Split view is v1's FLOW layout: left chat column (width %) + divider +
          flex-1 right panel. See file header caveat on ratio math. */}
      <div className="flex min-w-0 flex-1 flex-row overflow-hidden">
        {/* Chat column — width % when split open (transition like v1). */}
        <div
          className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${!isDraggingSplit ? 'transition-[width] duration-300 ease-in-out' : ''}`}
          style={{ width: splitPanelVisible ? `${splitRatio * 100}%` : '100%' }}
        >
          <div
            ref={chatContentRef}
            className="relative flex flex-1 flex-col overflow-hidden"
            {...dragHandlers}
          >
            {chatSearchOpen && (
              <ChatSearchPanel controller={chatSearch} onClose={closeChatSearch} />
            )}
            <DropZoneOverlay
              isVisible={isAnyDragActive && (!isTauriDragging || activeZoneId === 'chat-content' || activeZoneId === null)}
              message={t('shell.dropZone.message')}
              subtitle={t('shell.dropZone.subtitle')}
            />
            <ChatBootOverlay show={showStartupOverlay} />

            {/* Agent error banner — reuses v1's compact props contract. */}
            {agentError && (
              <div className="relative z-10 flex-shrink-0 border-b border-[var(--line)] bg-[var(--paper-inset)] px-4 py-2 text-xs text-[var(--ink)]">
                <div className="mx-auto flex max-w-3xl items-start gap-2">
                  <div className="flex-1">
                    <span className="font-semibold text-[var(--ink)]">{agentErrorBannerProps.message}</span>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => agentErrorBannerProps.onRetry()}
                        className="text-[var(--accent)] hover:text-[var(--accent-hover)]"
                      >
                        {t('shell.agentError.resend')}
                      </button>
                      <button
                        type="button"
                        onClick={() => agentErrorBannerProps.onDiagnose(agentError)}
                        className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      >
                        {t('shell.agentError.diagnose')}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDismissSystemNotice}
                    className="flex-shrink-0 rounded p-0.5 text-[var(--ink-subtle)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink-muted)]"
                    title={t('shell.common.close')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Message list + introduction overlay */}
            <BrowserPanelContext.Provider value={browserPanelCtx}>
              <FileActionProvider
                workspacePath={agentDir}
                onInsertReference={handleInsertReference}
                refreshTrigger={workspaceRefreshTrigger}
                onFilePreviewExternal={handleSplitFilePreview}
                onQuoteFile={handleQuoteFile}
                onRevealInTree={handleRevealInTree}
              >
                <MessageList
                  messages={chatScrollModel.data}
                  streamingMessage={controller.streamingMessage}
                  firstItemIndex={chatScrollModel.firstItemIndex}
                  heightEstimateSeed={chatScrollModel.heightEstimateSeed}
                  layoutByMessageId={chatScrollModel.layoutByMessageId}
                  onLoadOlder={handleLoadOlderMessages}
                  isLoading={isLoading}
                  isSessionLoading={isSessionLoading}
                  sessionId={sessionId}
                  isActive={isActive}
                  virtuosoRef={virtuosoRef}
                  onScrollerRef={attachScroller}
                  followEnabledRef={followEnabledRef}
                  scrollToBottom={scrollToBottom}
                  handleAtBottomChange={handleAtBottomChange}
                  onRowLayoutChanged={onRowLayoutChanged}
                  pendingPermission={pendingPermission}
                  onPermissionDecision={handlePermissionDecision}
                  pendingAskUserQuestion={pendingAskUserQuestion}
                  onAskUserQuestionSubmit={handleAskUserQuestionSubmit}
                  onAskUserQuestionCancel={handleAskUserQuestionCancel}
                  pendingExitPlanMode={pendingExitPlanMode}
                  onExitPlanModeApprove={handleExitPlanModeApprove}
                  onExitPlanModeReject={handleExitPlanModeReject}
                  systemStatus={systemStatus}
                  systemNotice={systemNotice}
                  onDismissSystemNotice={handleDismissSystemNotice}
                  isStreaming={isStreaming}
                  sessionState={sessionState}
                  onRetry={() => agentErrorBannerProps.onRetry()}
                  bottomSpacerPx={inputOverlayHeight}
                />

                {showIntroductionOverlay && introductionContent && (
                  <Suspense fallback={null}>
                    <LazyIntroductionOverlay content={introductionContent} />
                  </Suspense>
                )}
              </FileActionProvider>
            </BrowserPanelContext.Provider>

            {/* Floating input — no agentStatusSlot (moved to right column),
                contextIndicatorSlot stays per v1. */}
            <SimpleChatInput
              ref={chatInputRef}
              onSend={handleSendMessage}
              onStop={handleStop}
              active={isActive}
              isLoading={isStreaming}
              sessionState={sessionState}
              systemStatus={systemStatus}
              agentDir={agentDir}
              workspacePath={agentDir}
              sessionId={sessionId}
              sdkSlashCommands={visibleSdkSlashCommands}
              provider={currentProvider}
              providers={providers}
              providerAvailable={currentProviderAvailableForInput}
              availableProviderIds={availableProviderIdsForInput}
              providerUnavailableMessage={builtinSnapshotProviderSelectionIncomplete
                ? t('shell.toasts.reselectModelFirst')
                : undefined}
              onProviderChange={controller.handleProviderChange}
              selectedModel={inputUsesExternalRuntimeControls ? runtimeModel : selectedModel}
              onBuiltinModelSelect={inputUsesExternalRuntimeControls ? undefined : controller.handleBuiltinModelSelect}
              onModelChange={inputUsesExternalRuntimeControls ? undefined : controller.handleModelChange}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={handleReasoningEffortChange}
              contextIndicator={contextIndicatorSlot}
              permissionMode={inputChromePermissionMode}
              onPermissionModeChange={handlePermissionModeChange}
              apiKeys={apiKeys}
              providerVerifyStatus={providerVerifyStatus}
              inputRef={inputRef}
              workspaceMcpEnabled={workspaceMcpEnabled}
              globalMcpEnabled={globalMcpEnabled}
              mcpServers={mcpServers}
              onWorkspaceMcpToggle={handleWorkspaceMcpToggle}
              officialTools={OFFICIAL_TOOLS}
              workspaceOfficialToolEnabled={workspaceOfficialToolEnabled}
              globalOfficialToolEnabled={globalOfficialToolEnabled}
              officialToolNeedsConfig={officialToolNeedsConfig}
              onWorkspaceOfficialToolToggle={handleWorkspaceOfficialToolToggle}
              globallyVisiblePlugins={globallyVisiblePlugins}
              workspaceEnabledPlugins={workspaceEnabledPlugins}
              onWorkspacePluginToggle={handleWorkspacePluginToggle}
              onRefreshProviders={refreshProviderData}
              onOpenAgentSettings={handleOpenSettings}
              onWorkspaceRefresh={triggerWorkspaceRefresh}
              runtime={inputUsesExternalRuntimeControls ? currentRuntime : undefined}
              runtimeModels={inputUsesExternalRuntimeControls ? runtimeModels : undefined}
              runtimePermissionModes={inputUsesExternalRuntimeControls ? runtimePermissionModes : undefined}
              queuedMessages={queuedMessages}
              onCancelQueued={controller.handleCancelQueuedVoid}
              onForceExecuteQueued={controller.handleForceExecuteQueuedVoid}
              onOverlayHeightChange={handleInputOverlayHeightChange}
            />
          </div>
        </div>

        {/* Split view: draggable divider + right panel (v1 flow semantics). */}
        {(splitPanelVisible || terminalMounted) && (
          <>
            <div
              className={`z-10 flex w-1 cursor-col-resize items-center justify-center bg-[var(--line)] transition-colors hover:bg-[var(--accent)] ${!splitPanelVisible ? 'hidden' : ''}`}
              onMouseDown={handleSplitDividerMouseDown}
            >
              <div className="h-8 w-0.5 rounded-full bg-[var(--ink-subtle)]" />
            </div>
            <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${!splitPanelVisible ? 'hidden' : ''}`}>
              {activeTabRow}

              {splitFile && (
                <div className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--paper-elevated)] ${splitActiveView !== 'file' ? 'hidden' : ''}`}>
                  <Suspense fallback={<div className="flex h-full items-center justify-center text-[var(--ink-muted)]"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                    <LazyFilePreviewModal
                      name={splitFile.name}
                      content={splitFile.content}
                      size={splitFile.size}
                      path={splitFile.path}
                      localPath={splitFile.localPath}
                      richDocKind={splitFile.richDocKind}
                      workspacePath={splitFile.sourceScope === 'local' ? null : agentDir}
                      initialEditMode={splitFile.initialEditMode}
                      initialLineNumber={splitFile.initialLineNumber}
                      focusTarget={splitFile.focusTarget}
                      externalRefreshSignal={toolCompleteCount}
                      onExternalContentUpdated={(updated) => {
                        setSplitFile(prev => prev && prev.path === updated.path
                          ? { ...prev, name: updated.name, content: updated.content, size: updated.size, initialEditMode: undefined }
                          : prev);
                      }}
                      onClose={() => {
                        setSplitFile(null);
                        if (browserUrl) setSplitActiveView('browser');
                        else if (terminalPinned && terminalAlive) setSplitActiveView('terminal');
                      }}
                      onSaved={() => triggerWorkspaceRefresh()}
                      onRenamed={(newPath, newName) => {
                        setSplitFile(prev => prev ? { ...prev, path: newPath, name: newName, initialEditMode: undefined } : prev);
                        triggerWorkspaceRefresh();
                      }}
                      embedded
                      onFullscreen={(currentContent) => {
                        const file = currentContent !== undefined ? { ...splitFile, content: currentContent } : splitFile;
                        if (file) {
                          setSplitFile(null);
                          setFullscreenFile(file);
                        }
                      }}
                      onSwitchToBrowser={browserUrl ? handleEditorSwitchToBrowser : undefined}
                      onQuoteFile={handleQuoteFile}
                      onRevealInTree={handleRevealInTree}
                    />
                  </Suspense>
                </div>
              )}

              {terminalMounted && (
                <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${splitActiveView !== 'terminal' ? 'hidden' : ''}`}>
                  {splitViewCount < 2 && (
                    <div className="flex h-9 flex-shrink-0 items-center justify-between bg-[var(--paper)] px-3">
                      <div className="flex items-center gap-1.5">
                        <TerminalSquare className="h-3.5 w-3.5 text-[var(--ink)]" />
                        <span className="text-sm font-medium text-[var(--ink)]">{t('shell.split.terminal')}</span>
                        <span className="text-xs text-[var(--ink-muted)]">
                          {agentDir ? `~/${agentDir.split(/[/\\]/).pop()}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTerminalPinned(false);
                          if (browserUrl) setSplitActiveView('browser');
                          else if (splitFile) setSplitActiveView('file');
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <Suspense fallback={<div className="flex h-full items-center justify-center bg-[var(--paper)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--ink-muted)]" /></div>}>
                    <LazyTerminalPanel
                      workspacePath={agentDir}
                      terminalId={terminalId}
                      sessionId={sessionId}
                      isVisible={splitPanelVisible && splitActiveView === 'terminal'}
                      onTerminalCreated={(id) => {
                        setTerminalId(id);
                        setTerminalAlive(true);
                      }}
                      onTerminalExited={() => {
                        const deadId = terminalId;
                        setTerminalAlive(false);
                        setTerminalPinned(false);
                        setTerminalId(null);
                        if (deadId) {
                          import('@tauri-apps/api/core').then(({ invoke: inv }) => {
                            inv('cmd_terminal_close', { terminalId: deadId }).catch(() => {});
                          });
                        }
                      }}
                    />
                  </Suspense>
                </div>
              )}

              {browserUrl && (
                <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${splitActiveView !== 'browser' ? 'hidden' : ''}`}>
                  <Suspense fallback={<div className="flex h-full items-center justify-center bg-[var(--paper)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--ink-muted)]" /></div>}>
                    <LazyBrowserPanel
                      tabId={tabId}
                      url={browserUrl}
                      isVisible={!!isActive && splitPanelVisible && splitActiveView === 'browser'}
                      isDraggingSplit={isDraggingSplit}
                      isSplitTransitioning={false}
                      browserAlive={browserAlive}
                      sourceFile={browserSourceFile}
                      workspace={agentDir}
                      onBrowserCreated={handleBrowserCreated}
                      onCreateFailed={handleBrowserCreateFailed}
                      onClose={handleBrowserClose}
                      onSwitchToEditor={handleBrowserSwitchToEditor}
                      onUrlChange={handleBrowserUrlChange}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right column — AgentPanel (WUM12 260w): resident AgentStatusPanel.
          AgentStatusPanel self-subscribes to TabContext and manages its own fade
          lifecycle; containerRef scopes its in-tree querySelector. */}
      <div
        className="flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--line-subtle)] bg-[var(--paper-inset)]"
        style={{ width: AGENT_PANEL_WIDTH }}
      >
        <div className="flex shrink-0 items-center px-3 pt-3 pb-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-subtle)]">
            {tApp('v2.chat.agentPanelTitle')}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {agentStatusSlot}
        </div>
      </div>

      {/* Workspace config panel — required: handleOpenSettings sets
          showWorkspaceConfig true; without this render the entry is a no-op. */}
      {showWorkspaceConfig && (
        <WorkspaceConfigPanel
          agentDir={agentDir}
          onClose={handleWorkspaceConfigClose}
          refreshKey={workspaceRefreshTrigger}
          initialTab={workspaceConfigInitialTab as WorkspaceTab | undefined}
          initialSelect={workspaceConfigInitialSelect}
        />
      )}

      {/* Fullscreen preview (non-embedded) — opened from split panel's fullscreen. */}
      {fullscreenFile && (
        <Suspense fallback={null}>
          <LazyFilePreviewModal
            name={fullscreenFile.name}
            content={fullscreenFile.content}
            size={fullscreenFile.size}
            path={fullscreenFile.path}
            workspacePath={agentDir}
            onClose={() => setFullscreenFile(null)}
            onQuoteFile={handleQuoteFile}
            onRevealInTree={handleRevealInTree}
          />
        </Suspense>
      )}
    </div>
  );
}

/** WUM12 bottom dock in the left FileTree column — v2-only compact agent status.
 *  Glass surface ($bg-glass → paper-elevated + blur), rounded [8,8,0,0], header
 *  row + one-line status + context usage track. Not a v1 component. */
function AgentDock({
  statusState,
  contextUsage,
}: {
  statusState: ReturnType<typeof useAgentStatusState>;
  contextUsage: import('../../shared/types/context-usage').ContextUsage | null | undefined;
}) {
  const { t } = useTranslation('app');
  const { summary } = statusState;
  const hasTodos = summary.todoTotal > 0;
  const inProgress = summary.todoInProgress + summary.subagentRunning;

  const usedPct = contextUsage ? Math.round((contextUsage.usedPercent ?? 0) * 100) : 0;
  const windowLabel = contextUsage ? `${Math.round((contextUsage.contextWindow ?? 0) / 1000)}k` : '—';

  return (
    <div className="mx-2 mb-2 flex shrink-0 flex-col rounded-t-lg border border-b-0 border-[var(--line-subtle)] bg-[var(--paper-elevated)]/90 backdrop-blur-md">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-xs font-medium text-[var(--ink)]">{t('v2.chat.agentDockTitle')}</span>
        <span className="text-[var(--ink-subtle)]">▾</span>
      </div>
      <div className="px-3 pb-2">
        <span className="text-xs text-[var(--ink-muted)]">
          {hasTodos ? t('v2.chat.agentDockBusy', { count: inProgress }) : t('v2.chat.agentDockIdle')}
        </span>
      </div>
      <div className="px-3 pb-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--ink-subtle)]">{t('v2.chat.agentDockCtx')}</span>
          <span className="text-[10px] tabular-nums text-[var(--ink-subtle)]">
            {usedPct}% / {windowLabel}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--paper-inset)]">
          <div
            className="h-full rounded-full bg-[var(--accent-cool)] transition-[width] duration-300"
            style={{ width: `${Math.min(100, usedPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Re-export the DirectoryPanel handle type so AppV2 wiring can type its refs.
export type { DirectoryPanelHandle };
