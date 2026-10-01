// Marketplace.tsx — Phase 3 (PRD v0.4 §B.4) MiniApp Marketplace UI.
//
// Hash routing (#marketplace / #marketplace/<appId>). Two views:
//   - List: card grid of bundled + installed MiniApps
//   - Detail: meta + permissions + Install/Uninstall button
//
// Catalog comes from Rust `cmd_miniapp_list_marketplace` (bundled ∪ installed).
// Phase 3 ships List + Detail + Install; search/score/comments deferred to
// Phase 4 (per user grill answer).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import {
  installMarketplace,
  listMarketplace,
  uninstallMarketplace,
  type MiniAppMarketplaceItem,
} from '@/lib/marketplaceClient';

export interface MarketplaceProps {
  isActive: boolean;
}

type View = { kind: 'list' } | { kind: 'detail'; appId: string };

function readView(): View {
  const hash = window.location.hash;
  const match = hash.match(/^#marketplace\/([a-z0-9-]+)$/);
  if (match) return { kind: 'detail', appId: match[1] };
  return { kind: 'list' };
}

function writeView(view: View): void {
  const next = view.kind === 'detail' ? `#marketplace/${view.appId}` : '#marketplace';
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

export default function Marketplace({ isActive }: MarketplaceProps) {
  const { t } = useTranslation('app');
  const toast = useToast();
  const [items, setItems] = useState<MiniAppMarketplaceItem[] | null>(null);
  const [view, setView] = useState<View>(() => readView());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload on activation
  useEffect(() => {
    if (!isActive) return;
    void reload();
  }, [isActive]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await listMarketplace();
      setItems(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, []);

  // Hash routing
  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onSelect = useCallback((appId: string) => {
    const next: View = { kind: 'detail', appId };
    writeView(next);
    setView(next);
  }, []);
  const onBack = useCallback(() => {
    writeView({ kind: 'list' });
    setView({ kind: 'list' });
  }, []);

  const onInstall = useCallback(
    async (appId: string) => {
      setBusyId(appId);
      try {
        await installMarketplace(appId);
        toast.info(t('marketplace.installSuccess', { appId }) ?? `Installed ${appId}`);
        await reload();
      } catch (e) {
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
        toast.info(t('marketplace.uninstallSuccess', { appId }) ?? `Uninstalled ${appId}`);
        await reload();
      } catch (e) {
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

  if (view.kind === 'detail' && detailItem) {
    return (
      <MarketplaceDetail
        item={detailItem}
        busy={busyId === detailItem.id}
        onBack={onBack}
        onInstall={onInstall}
        onUninstall={onUninstall}
      />
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--paper)] p-6">
      <h1 className="text-2xl font-semibold text-[var(--ink)]">
        {t('marketplace.title') ?? 'Marketplace'}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {t('marketplace.subtitle') ?? 'Discover and install MiniApps.'}
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {items === null ? (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          {t('marketplace.loading') ?? 'Loading…'}
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          {t('marketplace.empty') ?? 'No MiniApps available yet.'}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)]"
              data-testid={`miniapp-card-${item.id}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-medium text-[var(--ink)]">{item.name || item.id}</h3>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    item.source === 'installed'
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--surface-2)] text-[var(--ink-muted)]'
                  }`}
                >
                  {item.source}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">v{item.version}</p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">{item.id}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface MarketplaceDetailProps {
  item: MiniAppMarketplaceItem;
  busy: boolean;
  onBack: () => void;
  onInstall: (appId: string) => void;
  onUninstall: (appId: string) => void;
}

function MarketplaceDetail({ item, busy, onBack, onInstall, onUninstall }: MarketplaceDetailProps) {
  const { t } = useTranslation('app');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isInstalled = item.source === 'installed';

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--paper)] p-6">
      <button
        onClick={onBack}
        className="text-sm text-[var(--accent)] hover:underline"
        data-testid="marketplace-back"
      >
        ← {t('marketplace.back') ?? 'Back to Marketplace'}
      </button>

      <h1 className="mt-3 text-2xl font-semibold text-[var(--ink)]">{item.name || item.id}</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {item.id} · v{item.version} · {item.source}
      </p>

      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <div>
          <span className="font-medium">{t('marketplace.path') ?? 'Install path'}:</span>{' '}
          <code className="text-xs">{item.path}</code>
        </div>
      </div>

      <div className="mt-6">
        {isInstalled ? (
          <button
            disabled={busy}
            onClick={() => onUninstall(item.id)}
            className="rounded border border-red-400 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            data-testid="marketplace-uninstall"
          >
            {busy
              ? (t('marketplace.uninstalling') ?? 'Uninstalling…')
              : (t('marketplace.uninstall') ?? 'Uninstall')}
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-50"
            data-testid="marketplace-install"
          >
            {busy
              ? (t('marketplace.installing') ?? 'Installing…')
              : (t('marketplace.install') ?? 'Install')}
          </button>
        )}
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={t('marketplace.confirmTitle') ?? 'Install MiniApp?'}
          message={
            t('marketplace.confirmMessage', { name: item.name || item.id }) ??
            `Install "${item.name || item.id}" v${item.version}?`
          }
          confirmText={t('marketplace.install') ?? 'Install'}
          confirmVariant="primary"
          loading={busy}
          onConfirm={() => {
            setConfirmOpen(false);
            onInstall(item.id);
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
