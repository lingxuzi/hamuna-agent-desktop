// SessionKnowledgePanel — per-conversation knowledge dashboard popover.
//
// Visual language: SETS MACHINE's gene-pool mesh (filled nodes with thin paper
// strokes, ambient drift, birth pulse rings, dashed selection rings, hairline
// edges) repainted in the app theme tokens, plus pulse particles travelling
// along relations. The graph engine (KbGraphView) owns that rendering; this
// component owns the popover shell.
//
// Shell: a 4:3 popover that unfolds from the toolbar toggle button like a
// sheet of paper (transform-origin top-right, scaleY → scaleX two-stage ease).
// Width ≈ 40% of the app viewport, so it never covers the whole conversation.

import { Waypoints, X, LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTabState } from '@/context/TabContext';
import { renderGraph, stopAnimation, updateGraph, type GraphNode, type GraphView } from '@/components/KbGraphView';
import type { KbGraph } from '@/api/kbClient';
import type { SessionKnowledgeGraph } from '../../shared/sessionKnowledge';
import './SessionKnowledgePanel.css';

interface SessionKnowledgePanelProps {
  onClose: () => void;
  onLocateMessage: (messageId: string) => void;
}

export default function SessionKnowledgePanel({ onClose, onLocateMessage }: SessionKnowledgePanelProps) {
  const { t } = useTranslation('chat');
  const { knowledgeGraph, knowledgeExtracting } = useTabState();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [unfolded, setUnfolded] = useState(false);

  // Paper-unfold: mount hidden, then flip the class on the next frame so the
  // transition actually plays (scaleY 0.6 → 1, then scaleX finishes the sheet).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setUnfolded(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mount: build the graph view. Unmount / graph-identity change: stop raf.
  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    try {
      viewRef.current = renderGraph(
        host,
        (knowledgeGraph ?? { entities: [], relations: [] }) as KbGraph,
        {
          type: t('shell.knowledge.nodeType'),
          sources: t('shell.knowledge.sources'),
          relations: t('shell.knowledge.relations'),
        },
        node => setSelected(node),
      );
    } catch {
      /* host not laid out yet — retry on graph update */
    }
    return () => {
      stopAnimation(viewRef.current);
      viewRef.current = null;
    };
    // Rebuild only when switching sessions (graph object identity from a
    // different TabProvider instance), not on every incremental update —
    // updateGraph below handles those in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Incremental updates: merge new entities/relations into the live view
  // without resetting positions — new nodes carry their own birth pulse.
  const lastGraphRef = useRef<SessionKnowledgeGraph | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    const host = canvasRef.current;
    if (!knowledgeGraph) return;
    if (!view || !host) {
      lastGraphRef.current = knowledgeGraph;
      return;
    }
    const prev = lastGraphRef.current;
    if (prev && prev === knowledgeGraph) return;
    lastGraphRef.current = knowledgeGraph;
    try {
      updateGraph(view, host, knowledgeGraph as KbGraph);
    } catch (err) {
      console.error('[SessionKnowledgePanel] updateGraph failed:', err);
    }
  }, [knowledgeGraph]);

  const stats = useMemo(() => {
    const g = knowledgeGraph;
    if (!g) return null;
    return { entities: g.entities.length, relations: g.relations.length, turns: g.turnCount };
  }, [knowledgeGraph]);

  const handleLocate = useCallback(
    (messageId: string) => {
      onLocateMessage(messageId);
    },
    [onLocateMessage],
  );

  return (
    <div
      ref={rootRef}
      className={`skp-root ${unfolded ? 'skp-open' : ''}`}
      role="complementary"
      aria-label={t('shell.knowledge.title')}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="skp-bar">
        <Waypoints className={`skp-icon ${knowledgeExtracting ? 'skp-pulse' : ''}`} />
        <span className="skp-title">{t('shell.knowledge.title')}</span>
        {knowledgeExtracting && <span className="skp-pulse skp-extracting">{t('shell.knowledge.extracting')}</span>}
        {stats && stats.entities > 0 && (
          <span className="skp-stats">
            {t('shell.knowledge.stats', { entities: stats.entities, relations: stats.relations })}
          </span>
        )}
        <div className="skp-spacer" />
        <button type="button" onClick={onClose} className="skp-close" title={t('shell.knowledge.close')} aria-label={t('shell.knowledge.close')}>
          <X className="skp-close-x" />
        </button>
      </div>

      <div className="skp-body">
        <div className="skp-stage">
          <canvas ref={canvasRef} className="skp-canvas" />
          {(!stats || stats.entities === 0) && (
            <div className="skp-empty">
              <Waypoints className="skp-empty-icon" />
              <p className="skp-empty-p">{t('shell.knowledge.empty')}</p>
              <p className="skp-empty-hint">{t('shell.knowledge.emptyHint')}</p>
            </div>
          )}
        </div>

        {/* Concept ledger — numbered scan column; selection syncs both ways
            (ledger row ⇆ graph node). Hidden when nothing extracted yet. */}
        {stats && stats.entities > 0 && (
          <div className="skp-ledger">
            {knowledgeGraph?.entities.slice(0, 24).map((e, i) => (
              <button
                key={e.id}
                type="button"
                className={`skp-row ${selected?.id === e.id ? 'skp-row-sel' : ''}`}
                onClick={() => setSelected(viewRef.current?.nodes.find(n => n.id === e.id) ?? null)}
              >
                <span className="skp-row-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="skp-row-nm">{e.label}</span>
                <span className="skp-row-ct">{e.sources?.length ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="skp-detail">
          <div className="skp-detail-head">
            <span className="skp-detail-label">{selected.label}</span>
            {selected.entityType && <span className="skp-detail-type">{selected.entityType}</span>}
            <div className="skp-spacer" />
            <button type="button" onClick={() => setSelected(null)} aria-label={t('shell.knowledge.closeDetail')} className="skp-close">
              <X className="skp-close-x" />
            </button>
          </div>
          {selected.rels.length > 0 && (
            <ul className="skp-rels">
              {selected.rels.slice(0, 8).map((r, i) => (
                <li key={i} className="skp-rel">
                  <span className="skp-rel-other">{r.other}</span>
                  <span className="skp-rel-sep">—</span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}
          {selected.sources.length > 0 && (
            <div className="skp-sources">
              <span className="skp-sources-label">{t('shell.knowledge.sources')}:</span>
              {selected.sources.slice(0, 6).map(mid => (
                <button key={mid} type="button" onClick={() => handleLocate(mid)} title={t('shell.knowledge.locate')} className="skp-chip">
                  <LocateFixed className="skp-chip-x" />
                  {t('shell.knowledge.messageChip')}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
