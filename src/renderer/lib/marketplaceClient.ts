// marketplaceClient.ts — Phase 3 (PRD v0.4 §B.4) MiniApp Marketplace API.
//
// All calls go through Rust `managementApi` (forwarded by Sidecar). Workers
// run inside Sidecar; the marketplace UI is just a catalog + install flow.

import { apiGetJson, apiPostJson } from '@/api/apiFetch';
import type { MiniAppI18n } from '../../shared/miniapp/types';

export interface MiniAppMarketplaceItem {
  id: string;
  name: string;
  /** Top-level (default-locale) description. Pair with `i18n` via
   *  `localizeMiniApp` rather than picking a locale here. */
  description: string;
  version: number;
  path: string;
  /** 'bundled' (read-only seed under resource_dir/bundled-miniapps/) or
   *  'installed' (under ~/.hamuna/miniapps/). */
  source: 'bundled' | 'installed';
  /** Phase 4 entry (PRD v0.4 §B.5): MiniApp icon (emoji or asset ref). The
   *  launcher grid uses this; absent values fall back to a `📦` emoji. */
  icon?: string;
  /** Phase 4 entry (PRD v0.4 §B.5): execution kind. The scene tab uses this
   *  to choose runner; absent values default to `'iframe'`. */
  kind?: 'iframe' | 'worker';
  /** Phase 4 entry (PRD v0.4 §B.5): worker entry name (e.g. `git-graph`).
   *  Required when `kind = 'worker'`; passed to the worker pool. */
  worker_kind?: string;
  /** Per-locale name/description/tags, resolved through `localizeMiniApp`. */
  i18n?: MiniAppI18n;
  tags?: string[];
}

export interface MarketplaceListResponse {
  ok: boolean;
  items?: MiniAppMarketplaceItem[];
  error?: string;
}

export interface MarketplaceInstallResponse {
  ok: boolean;
  appId?: string;
  version?: number;
  path?: string;
  error?: string;
}

export async function listMarketplace(): Promise<MiniAppMarketplaceItem[]> {
  const result = await apiGetJson<MarketplaceListResponse>('/api/miniapp/list');
  if (!result.ok || !result.items) {
    throw new Error(result.error ?? 'failed to load marketplace');
  }
  return result.items;
}

export async function installMarketplace(appId: string): Promise<void> {
  const result = await apiPostJson<MarketplaceInstallResponse>('/api/miniapp/install', {
    appId,
  });
  if (!result.ok) {
    throw new Error(result.error ?? `install failed for ${appId}`);
  }
}

export async function uninstallMarketplace(appId: string): Promise<void> {
  const result = await apiPostJson<MarketplaceInstallResponse>('/api/miniapp/uninstall', {
    appId,
  });
  if (!result.ok) {
    throw new Error(result.error ?? `uninstall failed for ${appId}`);
  }
}

/** Phase 4 entry (PRD v0.4 §B.5): fetch a MiniApp's compiled source HTML so
 *  the scene tab can mount <MiniAppRunner srcDoc={...}>. Looks up installed
 *  → bundled. The HTML is whatever the MiniApp ships under its `entry`
 *  field (default `source/index.html`). */
export interface MiniAppSourceResponse {
  ok: boolean;
  appId?: string;
  source?: string;
  entry?: string;
  error?: string;
}

export async function loadMiniAppSource(appId: string): Promise<string> {
  const result = await apiPostJson<MiniAppSourceResponse>('/api/miniapp/source', {
    appId,
  });
  if (!result.ok || result.source === undefined) {
    throw new Error(result.error ?? `source read failed for ${appId}`);
  }
  return result.source;
}
