import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

import { listenWithCleanup } from '@/utils/tauriListen';

import './collector-board.css';

/** Mirrors `collector_board::BoardRow` (serde default naming: snake_case). */
interface BoardRow {
  browser_tab_id: string;
  workspace: string;
  url: string;
  session_id: string;
  showing: boolean;
}

export default function CollectorBoard() {
  const { t } = useTranslation('app');
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await invoke<BoardRow[]>('cmd_collector_board_rows'));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Rust owns the truth: which page is in the slot, and whether a collector
    // was reaped. Both events mean "re-read", never "patch locally".
    const ac = new AbortController();
    void listenWithCleanup('collector-board:showing', () => { void refresh(); }, ac.signal);
    void listenWithCleanup('collector-board:changed', () => { void refresh(); }, ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const showingId = useMemo(
    () => rows.find(row => row.showing)?.browser_tab_id ?? null,
    [rows],
  );

  const show = useCallback(async (browserTabId: string) => {
    setBusy(true);
    try {
      await invoke('cmd_collector_board_show', { browserTabId });
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [refresh]);

  return (
    <div className="cb-root">
      <header className="cb-header">
        <span className="cb-title">{t('collectorBoard.title')}</span>
        <button
          type="button"
          className="cb-collapse"
          onClick={() => { void invoke('cmd_collector_board_toggle'); }}
        >
          {t('collectorBoard.collapse')}
        </button>
      </header>

      <nav className="cb-list">
        {rows.map(row => (
          <button
            key={row.browser_tab_id}
            type="button"
            className="cb-row"
            data-active={row.browser_tab_id === showingId}
            disabled={busy}
            onClick={() => { void show(row.browser_tab_id); }}
          >
            <span className="cb-row-name">{workspaceName(row, t('collectorBoard.unnamed'))}</span>
            <span className="cb-row-url">{siteName(row.url, t('collectorBoard.loading'))}</span>
          </button>
        ))}
        {rows.length === 0 && !error && (
          <p className="cb-empty">{t('collectorBoard.emptyList')}</p>
        )}
        {error && <p className="cb-empty">{error}</p>}
      </nav>

      {/* Right column: an empty area the native collector webview is parked on
       *  top of. Nothing rendered here is visible while a page is showing, so
       *  this only ever explains an empty slot. */}
      <div className="cb-stage">
        {!showingId && rows.length > 0 && <span>{t('collectorBoard.emptyStage')}</span>}
      </div>
    </div>
  );
}

/** Last path segment — the workspace name people recognise. */
function workspaceName(row: BoardRow, unnamed: string): string {
  const leaf = row.workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  if (leaf) return leaf;
  return row.session_id ? row.session_id.slice(0, 8) : unnamed;
}

/** Hostname only: the full URL does not fit the column, and the tail of a deep
 *  link is the part nobody recognises. */
function siteName(url: string, loading: string): string {
  if (!url) return loading;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
