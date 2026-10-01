// Marketplace.tsx — Phase 3 (PRD v0.4 §B.4) MiniApp Marketplace UI.
//
// Hash routing (#marketplace / #marketplace/<appId>). Two views:
//   - List: searchable/filterable card grid of bundled + installed MiniApps
//   - Detail: meta + install path + Install/Uninstall
//
// Catalog comes from Rust `cmd_miniapp_list_marketplace` (bundled ∪ installed).
// Both install and uninstall route through a confirm dialog — uninstalling
// deletes files from the user's workspace, so it is as irreversible as
// installing is not.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import {
  installMarketplace,
  listMarketplace,
  uninstallMarketplace,
  type MiniAppMarketplaceItem,
} from '@/lib/marketplaceClient';
import { localizeMiniApp } from '../../shared/miniapp/localize';
import {
  PAPER_GRID_STYLE,
  SPACE_BACKGROUND_STYLE,
  SPACE_COLLECTION_FRAME_CLASS,
  SPACE_REFRESH_TOOL_BUTTON_CLASS,
} from '@/pages/space/spaceUi';
import MiniAppIcon from './miniappIcon';
import { miniAppTints, NEUTRAL_TINT, type MiniAppTint } from './miniappUi';

export interface MarketplaceProps {
  isActive: boolean;
}

type View = { kind: 'list' } | { kind: 'detail'; appId: string };
type SourceFilter = 'all' | 'installed' | 'bundled';
type PendingAction = 'install' | 'uninstall';

const SOURCE_PILL_INSTALLED =
  'border border-[var(--success)]/20 bg-[var(--success-bg)] text-[var(--success)]';
const SOURCE_PILL_BUNDLED =
  'border border-[var(--line-subtle)] bg-[var(--paper-inset)] text-[var(--ink-muted)]';
const SOURCE_PILL_CLASS = 'shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold';
const TAG_PILL_CLASS =
  'rounded-md bg-[var(--paper-inset)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]';

function readView(): View {
  const match = window.location.hash.match(/^#marketplace\/([a-z0-9-]+)$/);
  return match ? { kind: 'detail', appId: match[1] } : { kind: 'list' };
}

function writeView(view: View): void {
  const next = view.kind === 'detail' ? `#marketplace/${view.appId}` : '#marketplace';
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

export default function Marketplace({ isActive }: MarketplaceProps) {
  const { t, i18n } = useTranslation('app');
  const toast = useToast();
  const [items, setItems] = useState<MiniAppMarketplaceItem[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const reload = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      setItems(await listMarketplace());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void reload();
  }, [isActive, reload]);

  // The hash is global to the window, but this view state is per-tab: a fresh
  // Marketplace tab must not inherit the detail route of a tab that was
  // closed. Reset on mount, then let hashchange drive navigation from there.
  useEffect(() => {
    writeView({ kind: 'list' });
    const onHash = () => setView(readView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onSelect = useCallback((appId: string) => {
    setView({ kind: 'detail', appId });
    writeView({ kind: 'detail', appId });
  }, []);
  const onBack = useCallback(() => {
    setView({ kind: 'list' });
    writeView({ kind: 'list' });
  }, []);

  // A detail route whose appId is not in the catalog (still loading is fine,
  // but a resolved miss is not) used to fall through to the list while the URL
  // still claimed a detail. Correct the URL instead of drifting.
  useEffect(() => {
    if (view.kind !== 'detail' || items === null) return;
    if (items.some((i) => i.id === view.appId)) return;
    setView({ kind: 'list' });
    writeView({ kind: 'list' });
  }, [view, items]);

  const onInstall = useCallback(
    async (appId: string) => {
      setBusyId(appId);
      try {
        await installMarketplace(appId);
        toast.info(t('marketplace.installSuccess', { appId }));
        await reload();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [reload, t, toast],
  );

  const onUninstall = useCallback(
    async (appId: string) => {
      setBusyId(appId);
      try {
        await uninstallMarketplace(appId);
        toast.info(t('marketplace.uninstallSuccess', { appId }));
        await reload();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [reload, t, toast],
  );

  const detailItem = useMemo(
    () => (view.kind === 'detail' ? items?.find((i) => i.id === view.appId) ?? null : null),
    [items, view],
  );

  const visibleItems = useMemo(() => {
    if (!items) return [];
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (sourceFilter === 'installed' && item.source !== 'installed') return false;
      if (sourceFilter === 'bundled' && item.source !== 'bundled') return false;
      if (!needle) return true;
      const localized = localizeMiniApp(item, i18n.language);
      return [localized.name, item.id, localized.description, ...(localized.tags ?? [])].some((field) =>
        field.toLowerCase().includes(needle),
      );
    });
  }, [items, query, sourceFilter, i18n.language]);

  const tints = useMemo(() => miniAppTints((items ?? []).map((i) => i.id)), [items]);

  if (view.kind === 'detail' && detailItem) {
    return (
      <MarketplaceDetail
        item={detailItem}
        tint={tints.get(detailItem.id) ?? NEUTRAL_TINT}
        locale={i18n.language}
        busy={busyId === detailItem.id}
        onBack={onBack}
        onInstall={onInstall}
        onUninstall={onUninstall}
      />
    );
  }

  const filtersActive = query.trim().length > 0 || sourceFilter !== 'all';
  const clearFilters = () => {
    setQuery('');
    setSourceFilter('all');
  };

  return (
    <div className="relative h-full overflow-hidden bg-[var(--paper)]" style={SPACE_BACKGROUND_STYLE}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={PAPER_GRID_STYLE} />
      <div className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-h-12 items-center gap-2.5 border-b border-[var(--line)] bg-[var(--paper-elevated)]/60 px-5 py-1.5 backdrop-blur-md">
          <Package className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
          <h1 className="truncate text-sm font-semibold text-[var(--ink-secondary)]">
            {t('marketplace.title')}
          </h1>
          <span className="rounded-md bg-[var(--paper-inset)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
            {items?.length ?? 0}
          </span>
          <div className="ml-auto shrink-0">
            <button
              type="button"
              onClick={() => void reload()}
              className={SPACE_REFRESH_TOOL_BUTTON_CLASS}
              aria-label={t('marketplace.refresh')}
              title={t('marketplace.refresh')}
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
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('marketplace.searchPlaceholder')}
                  aria-label={t('marketplace.searchPlaceholder')}
                  className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]/85 pl-9 pr-9 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[var(--accent-warm)]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('marketplace.clearSearch')}
                    title={t('marketplace.clearSearch')}
                    className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </label>
              <div className="flex items-center gap-1.5">
                <FilterChip
                  active={sourceFilter === 'all'}
                  onClick={() => setSourceFilter('all')}
                  label={t('marketplace.filterAll')}
                />
                <FilterChip
                  active={sourceFilter === 'installed'}
                  onClick={() => setSourceFilter('installed')}
                  label={t('marketplace.filterInstalled')}
                />
                <FilterChip
                  active={sourceFilter === 'bundled'}
                  onClick={() => setSourceFilter('bundled')}
                  label={t('marketplace.filterBundled')}
                />
              </div>
            </div>

            {error !== null ? (
              <LoadError message={error} onRetry={() => void reload()} />
            ) : items === null ? (
              <CardSkeletonGrid />
            ) : items.length === 0 ? (
              <PlainEmpty message={t('marketplace.empty')} />
            ) : visibleItems.length === 0 ? (
              <PlainEmpty
                message={t('marketplace.noResults')}
                action={
                  filtersActive ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 text-sm font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[var(--paper-inset)]"
                    >
                      <X className="h-4 w-4" />
                      {t('marketplace.clearFilters')}
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleItems.map((item) => {
                  const localized = localizeMiniApp(item, i18n.language);
                  const installed = item.source === 'installed';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      data-testid={`miniapp-card-${item.id}`}
                      className="flex w-full flex-col gap-2 rounded-xl bg-[var(--paper-elevated)] px-3.5 py-3 text-left transition-shadow hover:shadow-sm"
                    >
                      <span className="flex min-w-0 items-start gap-2.5">
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
                        <span className={`${SOURCE_PILL_CLASS} ${installed ? SOURCE_PILL_INSTALLED : SOURCE_PILL_BUNDLED}`}>
                          {installed ? t('marketplace.filterInstalled') : t('marketplace.filterBundled')}
                        </span>
                      </span>
                      {localized.description && (
                        <span className="line-clamp-2 min-h-[2.5em] text-sm leading-6 text-[var(--ink-muted)]">
                          {localized.description}
                        </span>
                      )}
                      <span className="mt-auto flex items-center gap-2 text-xs text-[var(--ink-subtle)]">
                        <span>v{item.version}</span>
                        {localized.tags?.map((tag) => (
                          <span key={tag} className={TAG_PILL_CLASS}>{tag}</span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
        active
          ? 'border-[var(--accent-warm)]/20 bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]'
          : 'border-[var(--line)] bg-[var(--paper-elevated)]/70 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
      }`}
    >
      {label}
    </button>
  );
}

interface MarketplaceDetailProps {
  item: MiniAppMarketplaceItem;
  tint: MiniAppTint;
  locale: string;
  busy: boolean;
  onBack: () => void;
  onInstall: (appId: string) => void;
  onUninstall: (appId: string) => void;
}

function MarketplaceDetail({
  item,
  tint,
  locale,
  busy,
  onBack,
  onInstall,
  onUninstall,
}: MarketplaceDetailProps) {
  const { t } = useTranslation('app');
  const [pending, setPending] = useState<PendingAction | null>(null);

  const isInstalled = item.source === 'installed';
  const localized = localizeMiniApp(item, locale);
  const displayName = localized.name || item.id;

  return (
    <div className="relative h-full overflow-hidden bg-[var(--paper)]" style={SPACE_BACKGROUND_STYLE}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={PAPER_GRID_STYLE} />
      <div className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-h-12 items-center gap-2.5 border-b border-[var(--line)] bg-[var(--paper-elevated)]/60 px-5 py-1.5 backdrop-blur-md">
          <button
            type="button"
            onClick={onBack}
            data-testid="marketplace-back"
            aria-label={t('marketplace.back')}
            title={t('marketplace.back')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <MiniAppIcon
            icon={item.icon}
            tint={tint}
            className="h-5 w-5"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-[var(--ink-secondary)]">
              {displayName}
            </h1>
            <p className="truncate font-mono text-xs text-[var(--ink-subtle)]">
              {item.id} · v{item.version}
            </p>
          </div>
          <span className={`${SOURCE_PILL_CLASS} ${isInstalled ? SOURCE_PILL_INSTALLED : SOURCE_PILL_BUNDLED}`}>
            {isInstalled ? t('marketplace.filterInstalled') : t('marketplace.filterBundled')}
          </span>
        </header>

        <main className="min-h-0 overflow-y-auto px-6 pb-10 pt-5">
          <div className={`${SPACE_COLLECTION_FRAME_CLASS} space-y-3`}>
            {localized.description && (
              <section className="rounded-xl bg-[var(--paper-elevated)] px-4 py-3.5">
                <p className="text-sm leading-6 text-[var(--ink-secondary)]">
                  {localized.description}
                </p>
                {localized.tags && localized.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {localized.tags.map((tag) => (
                      <span key={tag} className={TAG_PILL_CLASS}>{tag}</span>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]/60">
                {t('marketplace.path')}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--ink-subtle)]">
                {item.path}
              </p>
            </section>

            <div>
              {isInstalled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending('uninstall')}
                  data-testid="marketplace-uninstall"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 text-sm font-semibold text-[var(--error)] transition-colors hover:bg-[var(--error-bg)] disabled:cursor-wait disabled:opacity-70"
                >
                  {busy
                    ? (<Loader2 className="h-4 w-4 animate-spin" />)
                    : (<Trash2 className="h-4 w-4" />)}
                  {busy ? t('marketplace.uninstalling') : t('marketplace.uninstall')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending('install')}
                  data-testid="marketplace-install"
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--button-primary-bg)] px-4 text-sm font-semibold text-[var(--button-primary-text)] shadow-sm transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:cursor-wait disabled:opacity-70"
                >
                  {busy
                    ? (<Loader2 className="h-4 w-4 animate-spin" />)
                    : (<Download className="h-4 w-4" />)}
                  {busy ? t('marketplace.installing') : t('marketplace.install')}
                </button>
              )}
            </div>
          </div>
        </main>
      </div>

      {pending === 'install' && (
        <ConfirmDialog
          title={t('marketplace.confirmTitle')}
          message={t('marketplace.confirmMessage', { name: displayName })}
          confirmText={t('marketplace.install')}
          confirmVariant="primary"
          loading={busy}
          onConfirm={() => {
            setPending(null);
            onInstall(item.id);
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === 'uninstall' && (
        <ConfirmDialog
          title={t('marketplace.uninstallConfirmTitle')}
          message={t('marketplace.uninstallConfirmMessage', { name: displayName })}
          confirmText={t('marketplace.uninstall')}
          confirmVariant="danger"
          loading={busy}
          onConfirm={() => {
            setPending(null);
            onUninstall(item.id);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

function PlainEmpty({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-elevated)]/40 px-6 text-center">
      <div>
        <Package className="mx-auto h-8 w-8 text-[var(--ink-subtle)]" />
        <p className="mt-3 text-sm text-[var(--ink-muted)]">{message}</p>
        {action}
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
