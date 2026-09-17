// GlobalKbPanel — Knowledge base (资料库) management for the Settings page.
//
// Knowledge bases are app-level entities stored in Rust (KbEngine). A workspace
// mounts a set of KBs; the AI's `kb_query` tool then queries only the mounted
// ones. This panel covers KB CRUD + adding text/markdown material + the
// workspace↔KB mount mapping. Deterministic ingestion (jieba skeleton + Tantivy
// index) runs in Rust; LLM relation typing is a separate async step.

import { Check, Database, FileText, Globe, Link2, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addKbText,
  createKb,
  deleteKb,
  getKbGraph,
  ingestKbMaterial,
  listKbDocs,
  listKbMounts,
  listKbs,
  rebuildKb,
  renameKb,
  setKbMounts,
  type KbDocMeta,
  type KbGraphSummary,
  type KbInfo,
  type KbIngestKind,
} from '@/api/kbClient';
import { useToast } from '@/components/Toast';
import CustomSelect from '@/components/CustomSelect';
import { useConfigData } from '@/config/useConfigData';
import KbGraphView from '@/components/KbGraphView';

interface KbRow extends KbInfo {
  summary: KbGraphSummary | null;
}

export default function GlobalKbPanel() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const { config } = useConfigData();

  const [kbs, setKbs] = useState<KbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create / rename
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Add material (per selected KB)
  const [activeKbId, setActiveKbId] = useState<string | null>(null);
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialText, setMaterialText] = useState('');
  const [materialUrl, setMaterialUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mount mapping
  const [mounts, setMounts] = useState<Record<string, string[]>>({});
  const [mountWorkspace, setMountWorkspace] = useState('');
  const [selectedMounts, setSelectedMounts] = useState<string[]>([]);
  const [savingMounts, setSavingMounts] = useState(false);

  // Per-KB docs (raw uploaded files) + rebuild
  const [docsByKb, setDocsByKb] = useState<Record<string, KbDocMeta[]>>({});
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [kbList, mountMap] = await Promise.all([listKbs(), listKbMounts()]);
      if (!isMountedRef.current) return;
      const rows: KbRow[] = await Promise.all(
        kbList.map(async (kb) => {
          let summary: KbGraphSummary | null = null;
          try {
            summary = await getKbGraph(kb.id);
          } catch {
            summary = null;
          }
          return { ...kb, summary };
        }),
      );
      setKbs(rows);
      setMounts(mountMap);
    } catch (e) {
      console.error('[GlobalKbPanel] loadData failed:', e);
      if (!isMountedRef.current) return;
      toastRef.current.error(t('kb.loadFailed'));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  // When the mount workspace changes, load its current mounts.
  useEffect(() => {
    if (!mountWorkspace) {
      setSelectedMounts([]);
      return;
    }
    setSelectedMounts(mounts[mountWorkspace] ?? []);
  }, [mountWorkspace, mounts]);

  const workspaceOptions = (config.agents ?? [])
    .filter((a) => a.workspacePath)
    .map((a) => ({
      value: a.workspacePath,
      label: a.name || a.workspacePath,
    }));

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      toastRef.current.error(t('kb.nameRequired'));
      return;
    }
    try {
      await createKb(name);
      setNewName('');
      setRefreshKey((k) => k + 1);
      toastRef.current.success(t('kb.created'));
    } catch (e) {
      console.error('[GlobalKbPanel] createKb failed:', e);
      toastRef.current.error(e instanceof Error ? e.message : t('kb.createFailed'));
    }
  }, [newName, t]);

  const handleRename = useCallback(
    async (kbId: string) => {
      const name = renameValue.trim();
      if (!name) return;
      try {
        await renameKb(kbId, name);
        setRenamingId(null);
        setRefreshKey((k) => k + 1);
      } catch (e) {
        toastRef.current.error(e instanceof Error ? e.message : t('kb.renameFailed'));
      }
    },
    [renameValue, t],
  );

  const handleDelete = useCallback(
    async (kbId: string) => {
      try {
        await deleteKb(kbId);
        setRefreshKey((k) => k + 1);
      } catch (e) {
        toastRef.current.error(e instanceof Error ? e.message : t('kb.deleteFailed'));
      }
    },
    [t],
  );

  const handleAddMaterial = useCallback(async () => {
    if (!activeKbId) return;
    const text = materialText.trim();
    const title = materialTitle.trim() || `未命名材料 ${new Date().toLocaleDateString()}`;
    if (!text) return;
    setAdding(true);
    try {
      await addKbText(activeKbId, title, text);
      setMaterialText('');
      setMaterialTitle('');
      setRefreshKey((k) => k + 1);
      toastRef.current.success(t('kb.materialAdded'));
    } catch (e) {
      toastRef.current.error(e instanceof Error ? e.message : t('kb.materialAddFailed'));
    } finally {
      setAdding(false);
    }
  }, [activeKbId, materialText, materialTitle, t]);

  /** Ingest a parsed/text result, then refresh + toast. */
  const finishIngest = useCallback(
    async (result: { ok: boolean; error?: string }) => {
      if (result.ok) {
        setRefreshKey((k) => k + 1);
        toastRef.current.success(t('kb.materialAdded'));
        return true;
      }
      toastRef.current.error(result.error || t('kb.materialAddFailed'));
      return false;
    },
    [t],
  );

  const handleAddUrl = useCallback(async () => {
    if (!activeKbId) return;
    const url = materialUrl.trim();
    if (!url) return;
    setAdding(true);
    try {
      const title = materialTitle.trim() || url;
      const result = await ingestKbMaterial(activeKbId, title, 'url', url);
      const ok = await finishIngest(result);
      if (ok) setMaterialUrl('');
    } catch (e) {
      toastRef.current.error(e instanceof Error ? e.message : t('kb.materialAddFailed'));
    } finally {
      setAdding(false);
    }
  }, [activeKbId, materialUrl, materialTitle, finishIngest, t]);

  /** .md/.txt → text IPC; .pdf/.docx/.xlsx → base64 → sidecar ingest. */
  const handleFileUpload = useCallback(
    (file: File) => {
      if (!activeKbId) return;
      const lower = file.name.toLowerCase();
      const isText = lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.markdown');
      const ext: KbIngestKind | null = lower.endsWith('.pdf')
        ? 'pdf'
        : lower.endsWith('.docx') || lower.endsWith('.doc')
          ? 'docx'
          : lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
            ? 'xlsx'
            : null;
      if (!isText && !ext) {
        toastRef.current.error(t('kb.unsupportedFile'));
        return;
      }
      setAdding(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          if (isText) {
            const text = String(reader.result ?? '');
            if (!text.trim()) return;
            await addKbText(activeKbId, materialTitle.trim() || file.name, text);
          } else {
            const base64 = String(reader.result ?? '').split(',')[1] ?? '';
            const result = await ingestKbMaterial(activeKbId, materialTitle.trim() || file.name, ext!, base64);
            await finishIngest(result);
          }
          setRefreshKey((k) => k + 1);
          toastRef.current.success(t('kb.materialAdded'));
        } catch (e) {
          toastRef.current.error(e instanceof Error ? e.message : t('kb.materialAddFailed'));
        } finally {
          setAdding(false);
        }
      };
      reader.onerror = () => {
        setAdding(false);
        toastRef.current.error(t('kb.materialAddFailed'));
      };
      if (isText) {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    },
    [activeKbId, materialTitle, finishIngest, t],
  );

  /** Load the raw doc list for a KB (on expand). */
  const loadDocs = useCallback(async (kbId: string) => {
    try {
      const docs = await listKbDocs(kbId);
      setDocsByKb((prev) => ({ ...prev, [kbId]: docs }));
    } catch (e) {
      console.error('[GlobalKbPanel] list docs failed:', e);
    }
  }, []);

  /** Rebuild a KB's graph from its stored raw docs, then refresh everything. */
  const handleRebuild = useCallback(
    async (kbId: string) => {
      setRebuildingId(kbId);
      try {
        const summary = await rebuildKb(kbId);
        toastRef.current.success(t('kb.rebuildDone', { entities: summary.entityCount, relations: summary.relationCount }));
        setRefreshKey((k) => k + 1);
        setDocsByKb((prev) => prev); // keep doc list; graph below refreshes via KbGraphView
      } catch (e) {
        toastRef.current.error(e instanceof Error ? e.message : t('kb.rebuildFailed'));
      } finally {
        setRebuildingId(null);
      }
    },
    [t],
  );

  const handleSaveMounts = useCallback(async () => {
    if (!mountWorkspace) return;
    setSavingMounts(true);
    try {
      await setKbMounts(mountWorkspace, selectedMounts);
      setRefreshKey((k) => k + 1);
      toastRef.current.success(t('kb.mountSaved'));
    } catch (e) {
      toastRef.current.error(e instanceof Error ? e.message : t('kb.mountSaveFailed'));
    } finally {
      setSavingMounts(false);
    }
  }, [mountWorkspace, selectedMounts, t]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--ink-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* KB list + CRUD */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[var(--ink-muted)]" />
            <h3 className="text-base font-semibold text-[var(--ink)]">{t('kb.title')}</h3>
            <span className="text-xs text-[var(--ink-muted)]">({kbs.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder={t('kb.newNamePlaceholder')}
              className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <button
              onClick={handleCreate}
              className="flex items-center gap-1 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)]"
            >
              <Plus className="h-4 w-4" />
              {t('kb.create')}
            </button>
          </div>
        </div>

        {kbs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-inset)]/30 py-10 text-center">
            <Database className="mx-auto h-10 w-10 text-[var(--ink-muted)]/30" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{t('kb.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {kbs.map((kb) => (
              <div
                key={kb.id}
                className={`rounded-xl border p-3 ${activeKbId === kb.id ? 'border-[var(--accent)] bg-[var(--paper-inset)]/40' : 'border-[var(--line)] bg-[var(--paper)]'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[var(--ink-muted)]" />
                    {renamingId === kb.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(kb.id); if (e.key === 'Escape') setRenamingId(null); }}
                          autoFocus
                          className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-sm text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        />
                        <button onClick={() => handleRename(kb.id)} className="rounded p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]" title="Save">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => setRenamingId(null)} className="rounded p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]" title="Cancel">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setActiveKbId(activeKbId === kb.id ? null : kb.id)}
                        className="text-sm font-medium text-[var(--ink)] hover:text-[var(--accent)]"
                      >
                        {kb.name}
                      </button>
                    )}
                    {kb.summary && (
                      <span className="text-xs text-[var(--ink-muted)]">
                        {t('kb.summary', {
                          entities: kb.summary.entityCount,
                          relations: kb.summary.relationCount,
                          typed: kb.summary.typedRelationCount,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setRenamingId(kb.id); setRenameValue(kb.name); }}
                      className="rounded p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                      title={t('kb.rename')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(kb.id)}
                      className="rounded p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--error)]"
                      title={t('kb.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Add material (expanded) */}
                {activeKbId === kb.id && (
                  <div className="mt-3 space-y-3 border-t border-[var(--line)] pt-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={materialTitle}
                        onChange={(e) => setMaterialTitle(e.target.value)}
                        placeholder={t('kb.materialTitlePlaceholder')}
                        className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      >
                        <FileText className="h-4 w-4" />
                        {t('kb.uploadFile')}
                      </button>
                    </div>

                    {/* Web page ingestion */}
                    <div className="flex items-center gap-2">
                      <input
                        value={materialUrl}
                        onChange={(e) => setMaterialUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl(); }}
                        placeholder={t('kb.urlPlaceholder')}
                        className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                      <button
                        onClick={handleAddUrl}
                        disabled={adding || !materialUrl.trim()}
                        className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
                      >
                        <Globe className="h-4 w-4" />
                        {t('kb.fetchUrl')}
                      </button>
                    </div>

                    <textarea
                      value={materialText}
                      onChange={(e) => setMaterialText(e.target.value)}
                      placeholder={t('kb.materialPlaceholder')}
                      rows={5}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleAddMaterial}
                        disabled={adding || !materialText.trim()}
                        className="flex items-center gap-1 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                      >
                        {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t('kb.addMaterial')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Raw files list + rebuild */}
                {activeKbId === kb.id && (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    {(() => {
                      const docs = docsByKb[kb.id];
                      if (docs === undefined) {
                        void loadDocs(kb.id);
                      }
                      return null;
                    })()}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--ink-muted)]">
                        {t('kb.docsTitle', { count: docsByKb[kb.id]?.length ?? 0 })}
                      </span>
                      <button
                        onClick={() => handleRebuild(kb.id)}
                        disabled={rebuildingId === kb.id || (docsByKb[kb.id]?.length ?? 0) === 0}
                        className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
                        title={t('kb.rebuild')}
                      >
                        {rebuildingId === kb.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {t('kb.rebuild')}
                      </button>
                    </div>
                    {docsByKb[kb.id] && docsByKb[kb.id].length > 0 && (
                      <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                        {docsByKb[kb.id].map((d) => (
                          <li key={d.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[var(--paper-inset)]">
                            <span className="flex min-w-0 items-center gap-1.5 text-[var(--ink)]">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                              <span className="truncate">{d.title}</span>
                            </span>
                            <span className="ml-2 shrink-0 text-[var(--ink-muted)]">
                              {new Date(d.addedAtMs).toLocaleDateString()} · {d.textLength} 字
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Knowledge graph visualization */}
                {activeKbId === kb.id && (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    <KbGraphView kbId={kb.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.markdown,.pdf,.docx,.doc,.xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = '';
          }}
        />
      </section>

      {/* Workspace mount mapping */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-[var(--ink-muted)]" />
          <h3 className="text-base font-semibold text-[var(--ink)]">{t('kb.mountTitle')}</h3>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4">
          <div className="mb-3">
            <label className="mb-1 block text-xs text-[var(--ink-muted)]">{t('kb.mountWorkspaceLabel')}</label>
            <CustomSelect
              value={mountWorkspace}
              options={workspaceOptions}
              onChange={setMountWorkspace}
              placeholder={t('kb.mountWorkspacePlaceholder')}
              size="md"
            />
          </div>

          {mountWorkspace ? (
            <>
              <div className="mb-3 space-y-1">
                {kbs.map((kb) => {
                  const checked = selectedMounts.includes(kb.id);
                  return (
                    <label key={kb.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--ink)] hover:bg-[var(--paper-inset)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedMounts((prev) =>
                            checked ? prev.filter((id) => id !== kb.id) : [...prev, kb.id],
                          )
                        }
                        className="h-4 w-4"
                      />
                      {kb.name}
                    </label>
                  );
                })}
                {kbs.length === 0 && (
                  <p className="text-sm text-[var(--ink-muted)]">{t('kb.empty')}</p>
                )}
              </div>
              <button
                onClick={handleSaveMounts}
                disabled={savingMounts}
                className="flex items-center gap-1 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
              >
                {savingMounts && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('kb.saveMounts')}
              </button>
            </>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">{t('kb.mountWorkspaceHint')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
