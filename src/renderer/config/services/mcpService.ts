// MCP server management — CRUD, env, args, effective servers
import type { AppConfig, McpServerDefinition } from '../types';
import { PRESET_MCP_SERVERS } from '../types';
import { withProjectsLock } from './configStore';
import { loadAppConfig, atomicModifyConfig } from './appConfigService';
import { loadProjects, saveProjects } from './projectService';
import { apiGetJson, apiPostJson } from '@/api/apiFetch';
import { applyMcpServerConfigAdditions } from '../../../shared/mcpConfig';

/**
 * Detect host platform in the renderer using the same vocabulary as
 * `process.platform` (`'darwin' | 'win32' | 'linux'`). `navigator.platform`
 * is reliable enough for a coarse 3-way split and matches the existing
 * pattern used elsewhere in the renderer (see App.tsx, TitleBar.tsx).
 */
function getRendererPlatform(): NodeJS.Platform {
    if (typeof navigator === 'undefined') return 'linux';
    const p = navigator.platform.toLowerCase();
    if (p.includes('mac')) return 'darwin';
    if (p.includes('win')) return 'win32';
    return 'linux';
}

/**
 * Filter out presets whose `platforms` field doesn't include the host.
 * Keeps platform-specific presets (e.g. cuse on darwin/win32) invisible
 * everywhere on unsupported hosts. Mirror of admin-config.ts filter —
 * the two sites share the same semantic so catalogue and effective server
 * list stay in sync.
 */
function getPlatformFilteredPresets(): McpServerDefinition[] {
    const host = getRendererPlatform();
    return PRESET_MCP_SERVERS.filter(p => !p.platforms || p.platforms.includes(host));
}

/**
 * Synchronous variant — merges preset + custom MCP servers from an
 * already-loaded `AppConfig`. Same semantics as `getAllMcpServers` (custom
 * overrides preset on id collision; user args/env merged in; presets
 * filtered by host platform), but takes the config as a parameter so
 * callers that already hold an in-memory snapshot (`useConfig().config`)
 * don't pay the disk-read round-trip and don't need an async hook.
 *
 * Single source of truth for "what MCP catalogue does the renderer
 * consider available right now" — both `getAllMcpServers` (async / disk)
 * and renderer components (sync / in-memory) go through this. Without
 * the shared core, components were duplicating preset+custom merge logic
 * (and silently dropping args/env overrides; see TaskAdvancedConfigEditor
 * v0.2.4 review).
 *
 * `extended` (optional) is the list of bundled `extended_buildin_mcp/mcp.json`
 * entries fetched once per page load via `fetchExtendedBuiltinMcpServers`.
 * They sit between preset and custom in priority — a custom entry with the
 * same id wins over extended; extended wins over hardcoded preset; the UI
 * de-duplicates by id when rendering the toggle list.
 */
export function getAllMcpServersFromConfig(
    config: AppConfig,
    extended: McpServerDefinition[] = [],
): McpServerDefinition[] {
    const customServers = Array.isArray(config.mcpServers) ? config.mcpServers : [];
    const customIds = new Set(customServers.map(s => s.id));
    const extendedIds = new Set(extended.map(s => s.id));
    const allServers = [
        ...getPlatformFilteredPresets().filter(p => !customIds.has(p.id) && !extendedIds.has(p.id)),
        // extended is filtered by customIds too — custom wins on collision
        // (ToolboxSection renders one row per array entry, so an unfiltered
        // duplicate would produce two toggles for the same id).
        ...extended.filter(s => !customIds.has(s.id)),
        ...customServers,
    ];
    return applyMcpServerConfigAdditions(allServers, config);
}

/**
 * Async variant — loads the config from disk and returns the merged MCP
 * catalogue. Use when the caller has no in-memory config (most legacy
 * callers); for components inside `<ConfigProvider>` prefer the sync
 * `getAllMcpServersFromConfig(config)` to avoid the disk round-trip.
 *
 * Defensive: all disk-loaded array fields are validated with Array.isArray()
 * before spread, because config.json is a trust boundary.
 */
export async function getAllMcpServers(): Promise<McpServerDefinition[]> {
    const [config, extended] = await Promise.all([
        loadAppConfig(),
        fetchExtendedBuiltinMcpServers(),
    ]);
    return getAllMcpServersFromConfig(config, extended);
}

// Module-level memoised cache of extended builtin presets served from
// /api/mcp/extended-presets. The underlying resource ships with the bundle,
// so values are process-lifetime stable — one fetch per page load is correct.
// `resetExtendedBuiltinMcpCache()` exposes an explicit clear for tests.
let extendedCache: McpServerDefinition[] | null = null;
let extendedFetchPromise: Promise<McpServerDefinition[]> | null = null;

export async function fetchExtendedBuiltinMcpServers(): Promise<McpServerDefinition[]> {
    if (extendedCache) return extendedCache;
    if (extendedFetchPromise) return extendedFetchPromise;
    extendedFetchPromise = (async () => {
        try {
            const res = await apiGetJson<{ success: boolean; servers: McpServerDefinition[] }>(
                '/api/mcp/extended-presets',
            );
            extendedCache = res?.success && Array.isArray(res.servers) ? res.servers : [];
        } catch (err) {
            console.warn('[mcpService] failed to fetch extended presets:', err);
            extendedCache = [];
        }
        return extendedCache;
    })();
    return extendedFetchPromise;
}

export function resetExtendedBuiltinMcpCache(): void {
    extendedCache = null;
    extendedFetchPromise = null;
}

export async function getEnabledMcpServerIds(): Promise<string[]> {
    const config = await loadAppConfig();
    return Array.isArray(config.mcpEnabledServers) ? config.mcpEnabledServers : [];
}

export async function toggleMcpServerEnabled(serverId: string, enabled: boolean): Promise<void> {
    await atomicModifyConfig(c => {
        const enabledServers = new Set(Array.isArray(c.mcpEnabledServers) ? c.mcpEnabledServers : []);
        if (enabled) {
            enabledServers.add(serverId);
        } else {
            enabledServers.delete(serverId);
        }
        return { ...c, mcpEnabledServers: Array.from(enabledServers) };
    });
    console.log('[configService] MCP server toggled:', serverId, enabled);
}

export async function addCustomMcpServer(server: McpServerDefinition): Promise<void> {
    await atomicModifyConfig(c => {
        const customServers = [...(Array.isArray(c.mcpServers) ? c.mcpServers : [])];
        const existingIndex = customServers.findIndex(s => s.id === server.id);
        if (existingIndex >= 0) {
            customServers[existingIndex] = server;
        } else {
            customServers.push(server);
        }
        return { ...c, mcpServers: customServers };
    });
    console.log('[configService] Custom MCP server added:', server.id);
}

export async function deleteCustomMcpServer(serverId: string): Promise<void> {
    const result = await apiPostJson<{ success: boolean; error?: string }>('/api/admin/mcp/remove', { id: serverId });
    if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete MCP server');
    }
    console.log('[configService] Custom MCP server deleted:', serverId);
}

export async function saveMcpServerEnv(serverId: string, env: Record<string, string>): Promise<void> {
    await atomicModifyConfig(c => ({
        ...c,
        mcpServerEnv: { ...(c.mcpServerEnv ?? {}), [serverId]: env },
    }));
    console.log('[configService] MCP server env saved:', serverId);
}

export async function getMcpServerEnv(serverId: string): Promise<Record<string, string>> {
    const config = await loadAppConfig();
    return config.mcpServerEnv?.[serverId] ?? {};
}

export async function saveMcpServerArgs(serverId: string, args: string[]): Promise<void> {
    await atomicModifyConfig(c => ({
        ...c,
        mcpServerArgs: { ...(c.mcpServerArgs ?? {}), [serverId]: args },
    }));
    console.log('[configService] MCP server args saved:', serverId);
}

export async function getMcpServerArgs(serverId: string): Promise<string[] | undefined> {
    const config = await loadAppConfig();
    const args = config.mcpServerArgs?.[serverId];
    return Array.isArray(args) ? args : undefined;
}

export async function updateProjectMcpServers(projectId: string, enabledServerIds: string[]): Promise<void> {
    return withProjectsLock(async () => {
        const projects = await loadProjects();
        const index = projects.findIndex(p => p.id === projectId);
        if (index >= 0) {
            projects[index] = { ...projects[index], mcpEnabledServers: enabledServerIds };
            await saveProjects(projects);
            console.log('[configService] Project MCP servers updated:', projectId, enabledServerIds);
        }
    });
}

export async function getEffectiveMcpServers(projectId: string): Promise<McpServerDefinition[]> {
    const projects = await loadProjects();
    const project = projects.find(p => p.id === projectId);
    const workspaceEnabledIds = Array.isArray(project?.mcpEnabledServers) ? project.mcpEnabledServers : [];

    if (workspaceEnabledIds.length === 0) {
        return [];
    }

    const allServers = await getAllMcpServers();
    const config = await loadAppConfig();
    const globalEnabledIds = new Set(Array.isArray(config.mcpEnabledServers) ? config.mcpEnabledServers : []);

    return allServers.filter(s =>
        globalEnabledIds.has(s.id) && workspaceEnabledIds.includes(s.id)
    );
}
