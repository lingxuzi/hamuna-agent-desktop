// MiniAppCenter.tsx — Phase 4 entry (PRD v0.4 §B.5).
//
// Launcher entry for installed MiniApps. Clicking a card dispatches
// OPEN_MINIAPP_SCENE → App creates a new `view: 'miniapp-scene'` tab that
// mounts <MiniAppRunner>. Empty state nudges users to the Marketplace (which
// is where installs live).
//
// Catalog comes from the same `listMarketplace()` endpoint as the Marketplace
// page; we filter by `source === 'installed'` here.
//
// The page leads with a one-line explainer so the feature is never
// unexplained. It expands into a full intro — what a MiniApp is, plus the
// three properties that make one worth installing — whenever nothing is
// installed yet, which is exactly when the user needs the explanation.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  MessageSquarePlus,
  Package,
  PanelsTopLeft,
  RefreshCw,
  Store,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { CUSTOM_EVENTS } from '../../shared/constants';
import { localizeMiniApp } from '../../shared/miniapp/localize';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import {
  listMarketplace,
  uninstallMarketplace,
  type MiniAppMarketplaceItem,
} from '@/lib/marketplaceClient';
import {
  PAPER_GRID_STYLE,
  SPACE_BACKGROUND_STYLE,
  SPACE_COLLECTION_FRAME_CLASS,
  SPACE_PRIMARY_TOOL_BUTTON_CLASS,
  SPACE_REFRESH_TOOL_BUTTON_CLASS,
} from '@/pages/space/spaceUi';
import MiniAppIcon from './miniappIcon';
import { miniAppTints, NEUTRAL_TINT } from './miniappUi';

export interface MiniAppCenterProps {
  isActive: boolean;
}

const KIND_PILL_CLASS =
  'rounded-md px-2 py-0.5 text-xs font-semibold';
const KIND_PILL_WORKER =
  'border border-[var(--accent-warm)]/20 bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]';
const KIND_PILL_IFRAME =
  'border border-[var(--line-subtle)] bg-[var(--paper-inset)] text-[var(--ink-muted)]';

function dispatchOpenMiniAppScene(item: MiniAppMarketplaceItem): void {
  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, {
      detail: {
        appId: item.id,
        kind: item.kind,
        workerKind: item.worker_kind,
        icon: item.icon,
        permissions: item.permissions,
        dependencies: item.dependencies,
        appearance: item.appearance,
      },
    }),
  );
}

function dispatchOpenMarketplace(): void {
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_MARKETPLACE));
}

export default function MiniAppCenter({ isActive }: MiniAppCenterProps) {
  const { t, i18n } = useTranslation('app');
  const toast = useToast();
  const [items, setItems] = useState<MiniAppMarketplaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingUninstall, setPendingUninstall] = useState<MiniAppMarketplaceItem | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  // Reload whenever the tab becomes active (mirror Marketplace pattern). The
  // previous error is cleared up front so a banner from a failed load never
  // survives into a later successful one.
  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const all = await listMarketplace();
      setItems(all.filter((i) => i.source === 'installed'));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  // Uninstall is destructive and irreversible (Rust `remove_dir_all`s the whole
  // `~/.hamuna/miniapps/<id>/` tree, `storage.json` included), so it goes
  // through a confirm dialog rather than firing on a single click.
  const onUninstall = useCallback(
    async (item: MiniAppMarketplaceItem) => {
      setUninstallingId(item.id);
      try {
        await uninstallMarketplace(item.id);
        toast.info(t('miniappCenter.uninstallSuccess', { appId: item.id }));
        setPendingUninstall(null);
        await load();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setUninstallingId(null);
      }
    },
    [load, t, toast],
  );

  const installedCount = items?.length ?? 0;
  const tints = useMemo(() => miniAppTints((items ?? []).map((i) => i.id)), [items]);

  return (
    <div className="relative h-full overflow-hidden bg-[var(--paper)]" style={SPACE_BACKGROUND_STYLE}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={PAPER_GRID_STYLE} />
      <div className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-h-12 items-center gap-2.5 border-b border-[var(--line)] bg-[var(--paper-elevated)]/60 px-5 py-1.5 backdrop-blur-md">
          <Package className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
          <h1 className="truncate text-sm font-semibold text-[var(--ink-secondary)]">
            {t('miniappCenter.title')}
          </h1>
          <span className="rounded-md bg-[var(--paper-inset)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
            {installedCount}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* Only once something is installed. The empty state carries its own
                "browse Marketplace" button, and showing both would put two
                buttons for one job on screen at the same time — worse than the
                gap this replaces. It also stays hidden while loading (`items`
                is null) and in the error state, where the empty-state block
                isn't rendered either and a stray entry point would point at a
                catalog the page just failed to load. */}
            {items !== null && items.length > 0 && (
              <button
                type="button"
                onClick={dispatchOpenMarketplace}
                data-testid="miniapp-center-browse-marketplace-header"
                className={SPACE_PRIMARY_TOOL_BUTTON_CLASS}
              >
                <Store className="h-4 w-4" />
                {t('miniappCenter.browseMarketplace')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className={SPACE_REFRESH_TOOL_BUTTON_CLASS}
              aria-label={t('miniappCenter.refresh')}
              title={t('miniappCenter.refresh')}
              disabled={refreshing}
            >
              {refreshing
                ? (<Loader2 className="h-4 w-4 animate-spin" />)
                : (<RefreshCw className="h-4 w-4" />)}
            </button>
          </div>
        </header>

        <main className="min-h-0 overflow-y-auto px-6 pb-10 pt-5">
          <div className={`${SPACE_COLLECTION_FRAME_CLASS} space-y-3`}>
            {error === null && <IntroSection expanded={items !== null && installedCount === 0} />}

            {error !== null ? (
              <LoadError message={error} onRetry={() => void load()} />
            ) : items === null ? (
              <CardSkeletonGrid />
            ) : items.length === 0 ? (
              <EmptyState onBrowseMarketplace={dispatchOpenMarketplace} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const localized = localizeMiniApp(item, i18n.language);
                  const isWorker = item.kind === 'worker';
                  const busy = uninstallingId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="flex w-full flex-col gap-2 rounded-xl bg-[var(--paper-elevated)] px-3.5 py-3 text-left transition-shadow hover:shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => dispatchOpenMiniAppScene(item)}
                        data-testid={`miniapp-center-card-${item.id}`}
                        className="flex flex-col gap-2 text-left"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <MiniAppIcon
                            icon={item.icon}
                            tint={tints.get(item.id) ?? NEUTRAL_TINT}
                            className="h-5 w-5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[var(--ink)]">
                              {localized.name || item.id}
                            </span>
                            <span className="block truncate font-mono text-xs text-[var(--ink-subtle)]">
                              {item.id}
                            </span>
                          </span>
                        </span>
                        <span className="line-clamp-2 min-h-[2.5em] text-sm leading-6 text-[var(--ink-muted)]">
                          {localized.description}
                        </span>
                      </button>
                      <span className="mt-auto flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-[var(--ink-subtle)]">v{item.version}</span>
                          <span
                            className={`${KIND_PILL_CLASS} ${isWorker ? KIND_PILL_WORKER : KIND_PILL_IFRAME}`}
                          >
                            {isWorker ? t('miniappCenter.kindWorker') : t('miniappCenter.kindIframe')}
                          </span>
                        </span>
                        {/* Sibling of the launch button, never a child: a <button>
                            inside a <button> is invalid HTML, and the click would
                            also bubble to the launcher. */}
                        <button
                          type="button"
                          onClick={() => setPendingUninstall(item)}
                          disabled={uninstallingId !== null}
                          data-testid={`miniapp-center-uninstall-${item.id}`}
                          aria-label={t('miniappCenter.uninstallNamed', { name: localized.name || item.id })}
                          title={t('miniappCenter.uninstall')}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--ink-subtle)] transition-colors hover:bg-[var(--error-subtle)] hover:text-[var(--error)] disabled:cursor-wait disabled:opacity-50"
                        >
                          {busy
                            ? (<Loader2 className="h-3.5 w-3.5 animate-spin" />)
                            : (<Trash2 className="h-3.5 w-3.5" />)}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {pendingUninstall !== null && (
        <ConfirmDialog
          title={t('miniappCenter.uninstallConfirmTitle')}
          message={t('miniappCenter.uninstallConfirmMessage', {
            name: localizeMiniApp(pendingUninstall, i18n.language).name || pendingUninstall.id,
          })}
          confirmText={t('miniappCenter.uninstall')}
          confirmVariant="danger"
          loading={uninstallingId !== null}
          onConfirm={() => { void onUninstall(pendingUninstall); }}
          onCancel={() => { if (uninstallingId === null) setPendingUninstall(null); }}
        />
      )}
    </div>
  );
}

function IntroSection({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation('app');

  if (!expanded) {
    return (
      <section className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]/60 px-3.5 py-2.5">
        <Package className="h-4 w-4 shrink-0 text-[var(--accent-warm)]" />
        <p className="min-w-0 truncate text-sm text-[var(--ink-secondary)]">
          {t('miniappCenter.introBody')}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]/60 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[var(--accent-warm)]/20 bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]">
          <Package className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          {t('miniappCenter.title')}
        </h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-secondary)]">
        {t('miniappCenter.introBody')}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <CapabilityCard
          icon={PanelsTopLeft}
          title={t('miniappCenter.capTabTitle')}
          body={t('miniappCenter.capTabBody')}
        />
        <CapabilityCard
          icon={MessageSquarePlus}
          title={t('miniappCenter.capCreateTitle')}
          body={t('miniappCenter.capCreateBody')}
        />
        <CapabilityCard
          icon={Workflow}
          title={t('miniappCenter.capWorkflowTitle')}
          body={t('miniappCenter.capWorkflowBody')}
        />
      </div>
    </section>
  );
}

function CapabilityCard({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)]/60 p-3.5">
      <Icon className="h-4 w-4 text-[var(--ink-subtle)]" />
      <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{body}</p>
    </div>
  );
}

function EmptyState({ onBrowseMarketplace }: { onBrowseMarketplace: () => void }) {
  const { t } = useTranslation('app');
  return (
    <div
      className="grid min-h-52 place-items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-elevated)]/40 px-6 text-center"
      data-testid="miniapp-center-empty"
    >
      <div>
        <Store className="mx-auto h-8 w-8 text-[var(--ink-subtle)]" />
        <p className="mt-3 text-sm font-semibold text-[var(--ink)]">
          {t('miniappCenter.emptyTitle')}
        </p>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {t('miniappCenter.emptyHint')}
        </p>
        <button
          type="button"
          onClick={onBrowseMarketplace}
          data-testid="miniapp-center-browse-marketplace"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--button-secondary-bg)] px-3 text-sm font-semibold text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--button-secondary-bg-hover)]"
        >
          <Store className="h-4 w-4" />
          {t('miniappCenter.browseMarketplace')}
        </button>
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('app');
  return (
    <div className="grid min-h-52 place-items-center rounded-xl border border-[var(--error)]/20 bg-[var(--error-bg)]/40 px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-[var(--error)]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 text-sm font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[var(--paper-inset)]"
        >
          <RefreshCw className="h-4 w-4" />
          {t('miniappCenter.retry')}
        </button>
      </div>
    </div>
  );
}

function CardSkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-xl bg-[var(--paper-elevated)] px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-[var(--paper-inset)]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-[var(--paper-inset)]" />
              <div className="h-2.5 w-1/2 rounded bg-[var(--paper-inset)]" />
            </div>
          </div>
          <div className="mt-2.5 space-y-1.5">
            <div className="h-2.5 w-full rounded bg-[var(--paper-inset)]" />
            <div className="h-2.5 w-4/5 rounded bg-[var(--paper-inset)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
