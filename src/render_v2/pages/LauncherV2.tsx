/**
 * LauncherV2 — v2 Launcher page (Pencil [final] qjQtx "品牌驱动（杂志封面）").
 * 60/40 split: BrandPanel (left 60%, brand hero) + RailPanel (right 40%,
 * workspace rail). Assembly logic lives in useLauncherDataV2 (copied from v1
 * Launcher.tsx); this page only renders BrandSection / LauncherRightRail and
 * the overlay/dialog stack against that data.
 *
 * Layout follows the Pencil frame: BrandPanel (LogoRow → HeroBlock → HeroSub →
 * QuickInput, separated by Spacers) on the left, RailPanel (RailHeader →
 * CardStack → RecentLabel → RecentList) on the right. All values map to theme
 * tokens — no orphan hex/px.
 */
import { Suspense, lazy, memo } from 'react';

import { useTranslation } from 'react-i18next';

import { UnifiedLogsPanel } from '@/components/UnifiedLogsPanel';
import PathInputDialog from '@/components/PathInputDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { BrandSection, LauncherRightRail, TemplateLibraryDialog, WorkspaceEditDialog } from '@/components/launcher';
import { OFFICIAL_TOOLS } from '../../shared/official-tools';
import { isSystemPresetProject } from '@/config/types';
import { useLauncherDataV2, type LauncherLaunchContext } from '../hooks/useLauncherDataV2';

// Click-opened overlays — lazy so their subtrees leave the eager entry chunk
// (same as v1 Launcher.tsx).
const TaskCenterOverlay = lazy(() => import('@/components/TaskCenterOverlay'));
const WorkspaceConfigPanel = lazy(() => import('@/components/WorkspaceConfigPanel'));

export interface LauncherV2Props {
    launchChat: (ctx: LauncherLaunchContext) => void;
    openSettings: () => void;
    isActive?: boolean;
}

export default memo(function LauncherV2({ launchChat, openSettings, isActive }: LauncherV2Props) {
    const { t } = useTranslation('launcher');
    const d = useLauncherDataV2({ launchChat, openSettings, isActive });

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
            {/* Path Input Dialog (browser dev mode) */}
            <PathInputDialog
                isOpen={d.pathDialogOpen}
                folderName={d.pendingFolderName}
                defaultPath={d.pendingDefaultPath}
                onConfirm={d.handlePathConfirm}
                onCancel={d.handlePathCancel}
            />

            {/* Logs Panel */}
            <UnifiedLogsPanel
                sseLogs={[]}
                isVisible={d.showLogs}
                onClose={() => d.setShowLogs(false)}
            />

            {/* Remove Workspace Confirm Dialog */}
            {d.projectToRemove && (
                <ConfirmDialog
                    title={isSystemPresetProject(d.projectToRemove) ? t('dialogs.hideDefaultWorkspace') : t('dialogs.removeWorkspace')}
                    message={isSystemPresetProject(d.projectToRemove)
                        ? t('dialogs.hideWorkspaceMessage', { name: d.projectToRemove.displayName || d.projectToRemove.name })
                        : t('dialogs.removeWorkspaceMessage', { name: d.projectToRemove.name })}
                    confirmText={isSystemPresetProject(d.projectToRemove) ? t('dialogs.hide') : t('dialogs.remove')}
                    confirmVariant="danger"
                    onConfirm={d.confirmRemoveProject}
                    onCancel={() => d.setProjectToRemove(null)}
                />
            )}

            {/* Main Content: 60/40 split (BrandPanel + RailPanel) */}
            <main className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left 60%: Brand panel */}
                <section className="relative flex min-w-0 flex-[3] items-center justify-center overflow-hidden">
                    <BrandSection
                        projects={d.visibleProjects}
                        selectedProject={d.selectedWorkspace}
                        defaultWorkspacePath={d.config.defaultWorkspacePath}
                        onSelectWorkspace={d.setSelectedWorkspace}
                        onAddFolder={d.handleAddProject}
                        onSetDefaultWorkspace={d.handleSetDefault}
                        onSend={d.handleBrandSend}
                        isStarting={d.launchingProjectId === d.selectedWorkspace?.id && d.launchingProjectId !== null}
                        provider={d.launcherProvider}
                        providers={d.providers}
                        selectedModel={d.launcherSelectedModel}
                        onProviderChange={d.handleLauncherProviderChange}
                        onModelChange={d.handleLauncherModelChange}
                        reasoningEffort={d.launcherReasoningEffort}
                        onReasoningEffortChange={d.handleLauncherReasoningEffortChange}
                        permissionMode={d.launcherPermissionMode}
                        onPermissionModeChange={d.handleLauncherPermissionModeChange}
                        apiKeys={d.apiKeys}
                        providerVerifyStatus={d.providerVerifyStatus}
                        workspaceMcpEnabled={d.launcherWorkspaceMcpEnabled}
                        globalMcpEnabled={d.launcherGlobalMcpEnabled}
                        mcpServers={d.launcherMcpServers}
                        onWorkspaceMcpToggle={d.handleWorkspaceMcpToggle}
                        officialTools={OFFICIAL_TOOLS}
                        workspaceOfficialToolEnabled={d.launcherOfficialToolEnabled}
                        globalOfficialToolEnabled={d.launcherGlobalOfficialToolEnabled}
                        officialToolNeedsConfig={d.launcherOfficialToolNeedsConfig}
                        onWorkspaceOfficialToolToggle={d.handleLauncherOfficialToolToggle}
                        globallyVisiblePlugins={(d.config.plugins ?? [])
                            .filter(p => d.config.enabledPlugins?.[p.id] === true)
                            .map(p => ({ id: p.id, name: p.name, description: p.description }))}
                        workspaceEnabledPlugins={d.launcherEnabledPlugins}
                        onWorkspacePluginToggle={d.handleLauncherPluginToggle}
                        onRefreshProviders={d.refreshProviderData}
                        onGoToSettings={d.handleGoToSettings}
                        runtime={d.isExternalRuntime ? d.launcherRuntime : undefined}
                        runtimeModels={d.isExternalRuntime ? d.launcherRuntimeModels : undefined}
                        runtimePermissionModes={d.isExternalRuntime ? d.launcherRuntimePermissionModes : undefined}
                        multiAgentRuntimeEnabled={d.multiAgentRuntimeEnabled}
                        runtimeDetections={d.runtimeDetections}
                        onRuntimeChange={d.handleLauncherRuntimeChange}
                        activeRuntime={d.launcherRuntime}
                    />
                </section>

                {/* Right 40%: Workspace rail */}
                <div className="relative flex min-w-0 flex-[2] flex-col overflow-hidden border-l border-[var(--line)]">
                    <LauncherRightRail
                        projects={d.userVisibleProjects}
                        agentLookup={d.agentLookup}
                        isProjectsLoading={d.isLoading}
                        isStarting={false}
                        launchingProjectId={d.launchingProjectId}
                        showDevTools={d.config.showDevTools}
                        taskCenterData={d.taskCenterData}
                        onLaunch={d.handleLaunch}
                        onOpenTask={d.handleOpenTask}
                        onOpenOverlay={d.handleOpenOverlay}
                        onRemoveProject={d.handleRemoveProject}
                        onArchiveProject={d.handleArchiveProject}
                        onUnarchiveProject={d.handleUnarchiveProject}
                        onAgentSettings={d.handleAgentSettings}
                        onOpenProjectFolder={d.handleOpenProjectFolder}
                        onToggleProjectPin={d.handleToggleProjectPin}
                        onAddFolder={d.handleAddProject}
                        onCreateFromTemplate={d.handleOpenTemplateDialog}
                        onShowLogs={d.handleShowLogs}
                    />
                </div>
            </main>

            {/* Task Center Overlay */}
            {d.showOverlay && (
                <Suspense fallback={null}>
                    <TaskCenterOverlay
                        projects={d.visibleProjects}
                        onOpenTask={d.handleOverlayOpenTask}
                        onClose={d.handleCloseOverlay}
                        taskCenterData={d.taskCenterData}
                        initialMode={d.overlayMode}
                    />
                </Suspense>
            )}

            {/* Template Library Dialog */}
            {d.showTemplateDialog && (
                <TemplateLibraryDialog
                    onCreateWorkspace={d.handleCreateFromTemplate}
                    onClose={d.handleCloseTemplateDialog}
                />
            )}

            {/* Workspace Edit Dialog */}
            {d.editingProject && (
                <WorkspaceEditDialog
                    key={d.editingProject.id}
                    project={d.editingProject}
                    onSave={d.handleEditProject}
                    onClose={d.handleCloseEditDialog}
                />
            )}

            {/* Agent Config Overlay */}
            {d.agentOverlay && (
                <Suspense fallback={null}>
                    <WorkspaceConfigPanel
                        agentDir={d.agentOverlay.workspacePath}
                        onClose={d.handleCloseAgentOverlay}
                        initialTab={d.agentOverlay.initialTab}
                        onRequestInit={d.handleRequestInitFromAgentOverlay}
                    />
                </Suspense>
            )}
        </div>
    );
});
