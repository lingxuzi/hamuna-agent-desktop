// MiniAppCenter.tsx — Phase 4 entry (PRD v0.4 §B.5).
//
// Launcher entry for installed MiniApps. Shows a 3-column grid; clicking a
// card dispatches OPEN_MINIAPP_SCENE → App creates a new `view: 'miniapp-scene'`
// tab that mounts <MiniAppRunner>. Empty state nudges users to the
// Marketplace (which is where installs live).
//
// Catalog comes from the same `listMarketplace()` endpoint as the Marketplace
// page; we filter by `source === 'installed'` here. Future Phase 4 plans:
// multi-instance tabs, recent launches row, search.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CUSTOM_EVENTS } from '../../shared/constants';
import {
  listMarketplace,
  type MiniAppMarketplaceItem,
} from '@/lib/marketplaceClient';

export interface MiniAppCenterProps {
  isActive: boolean;
}

const FALLBACK_ICON = '📦';

function dispatchOpenMiniAppScene(item: MiniAppMarketplaceItem): void {
  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, {
      detail: {
        appId: item.id,
        kind: item.kind,
        workerKind: item.worker_kind,
        icon: item.icon,
      },
    }),
  );
}

function dispatchOpenMarketplace(): void {
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_MARKETPLACE));
}

export default function MiniAppCenter({ isActive }: MiniAppCenterProps) {
  const { t } = useTranslation('app');
  const [items, setItems] = useState<MiniAppMarketplaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload whenever the tab becomes active (mirror Marketplace pattern).
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void listMarketplace()
      .then((all) => {
        if (!cancelled) setItems(all.filter((i) => i.source === 'installed'));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const installedCount = items?.length ?? 0;
  const gridItems = useMemo(() => items ?? [], [items]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--paper)] p-6">
      <h1
        className="text-2xl font-semibold text-[var(--ink)]"
        data-testid="miniapp-center-title"
      >
        {t('miniappCenter.title') ?? 'MiniApps'}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {t('miniappCenter.subtitle') ??
          'Your installed MiniApps. Click to launch.'}
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {items === null ? (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          {t('miniappCenter.loading') ?? 'Loading…'}
        </p>
      ) : installedCount === 0 ? (
        <EmptyState onBrowseMarketplace={dispatchOpenMarketplace} />
      ) : (
        <div
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="miniapp-center-grid"
        >
          {gridItems.map((item) => (
            <button
              key={item.id}
              onClick={() => dispatchOpenMiniAppScene(item)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)]"
              data-testid={`miniapp-center-card-${item.id}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-2)] text-xl"
                  aria-hidden="true"
                >
                  {item.icon || FALLBACK_ICON}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-medium text-[var(--ink)]">
                    {item.name || item.id}
                  </h3>
                  <p className="truncate text-xs text-[var(--ink-muted)]">{item.id}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-[var(--ink-muted)]">v{item.version}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    item.kind === 'worker'
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--surface-2)] text-[var(--ink-muted)]'
                  }`}
                  data-testid={`miniapp-center-kind-${item.id}`}
                >
                  {item.kind === 'worker' ? 'worker' : 'iframe'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface EmptyStateProps {
  onBrowseMarketplace: () => void;
}

function EmptyState({ onBrowseMarketplace }: EmptyStateProps) {
  const { t } = useTranslation('app');
  return (
    <div
      className="mt-10 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center"
      data-testid="miniapp-center-empty"
    >
      <p className="text-4xl" aria-hidden="true">
        📦
      </p>
      <h2 className="mt-4 text-lg font-medium text-[var(--ink)]">
        {t('miniappCenter.emptyTitle') ?? 'No MiniApps installed'}
      </h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        {t('miniappCenter.emptyHint') ??
          'Browse the Marketplace to install your first MiniApp.'}
      </p>
      <button
        onClick={onBrowseMarketplace}
        className="mt-6 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90"
        data-testid="miniapp-center-browse-marketplace"
      >
        {t('miniappCenter.browseMarketplace') ?? 'Browse Marketplace'}
      </button>
    </div>
  );
}