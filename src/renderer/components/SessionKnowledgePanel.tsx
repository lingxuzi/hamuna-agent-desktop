// SessionKnowledgePanel — per-conversation knowledge dashboard, horizontal strip.
//
// Visual language borrowed from the neural-creator-dashboard reference:
// deep space ground, an additive-halo orb, drifting jellyfish, glowing curves and
// pulses travelling along them. What is deliberately NOT copied: the reference's
// 1280×720 orb.mp4 and its whole-page topbar/home-stage layout. The orb is
// repainted frame-by-frame into a <canvas> (paintVideo below) instead of shown as
// a bare <video> — some embedded WebViews decode video but never composite the
// frame, which leaves the orb invisible. The <video> stays in the DOM at
// opacity 0 purely to drive playback.
//
// The strip runs full-width along the bottom of the chat content area.

import { Waypoints, X, LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTabState } from '@/context/TabContext';
import { renderGraph, stopAnimation, updateGraph, type GraphNode, type GraphView } from '@/components/KbGraphView';
import type { KbGraph } from '@/api/kbClient';
import type { SessionKnowledgeGraph } from '../../shared/sessionKnowledge';
import orbSrc from '@/assets/knowledge/orb.mp4';
import jellySrc from '@/assets/knowledge/jellyfish.mp4';
import './SessionKnowledgePanel.css';

interface SessionKnowledgePanelProps {
  onClose: () => void;
  onLocateMessage: (messageId: string) => void;
}

/** Posters double as the pre-roll frame: a video that has not decoded yet would
 *  otherwise leave a hole in the orb for the first few hundred ms. */
const ORB_POSTER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="#232523"/><circle cx="50" cy="50" r="22" fill="#3a3d3a"/><circle cx="42" cy="44" r="8" fill="#e6cf98" opacity=".55"/></svg>`,
  );

interface VideoPair {
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  stamp: number;
  ready: boolean;
}

const posterCache = new Map<string, HTMLImageElement>();
function posterOf(url: string): HTMLImageElement | null {
  if (!url) return null;
  let img = posterCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    posterCache.set(url, img);
  }
  return img;
}

/** Draw the current video frame into its canvas, cover-cropped. Mirrors
 *  `paintVideo()` in the reference project: the element that paints is always a
 *  canvas, never the <video> itself. */
function paintVideo(pair: VideoPair): void {
  const { video, canvas } = pair;
  if (!video || !canvas) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cw * dpr);
  const H = Math.round(ch * dpr);
  const resized = canvas.width !== W || canvas.height !== H;
  if (resized) canvas.width = W;
  if (resized) canvas.height = H;
  const ready = video.readyState >= 2 && video.videoWidth > 0;
  const poster = posterOf(video.poster);
  if (!ready && !poster) return;
  const sw0 = ready ? video.videoWidth : poster!.naturalWidth;
  const sh0 = ready ? video.videoHeight : poster!.naturalHeight;
  if (!sw0 || !sh0) return;
  const stamp = ready ? video.currentTime : -1;
  if (!resized && stamp === pair.stamp && ready === pair.ready) return;
  pair.stamp = stamp;
  pair.ready = ready;
  // object-fit: cover
  const k = Math.max(W / sw0, H / sh0);
  const sw = W / k;
  const sh = H / k;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(ready ? video : poster!, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, 0, 0, W, H);
}

function prefersReducedMotion(): boolean {
  // jsdom defines the `matchMedia` key without implementing it, so the guard
  // has to check the value is callable, not just that the key exists.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function SessionKnowledgePanel({ onClose, onLocateMessage }: SessionKnowledgePanelProps) {
  const { t } = useTranslation('chat');
  const { knowledgeGraph, knowledgeExtracting } = useTabState();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  // ── Orb + jellyfish ────────────────────────────────────────────────────
  // Ambient scene behind the graph: an orb breathing at center-left and a
  // jellyfish drifting along it. Both are decorative, so they sit under
  // pointer-events:none and never intercept node clicks.
  const orbVideoRef = useRef<HTMLVideoElement | null>(null);
  const orbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const jellyVideoRef = useRef<HTMLVideoElement | null>(null);
  const jellyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const orbPairRef = useRef<VideoPair>({ video: null, canvas: null, stamp: -1, ready: false });
  const jellyPairRef = useRef<VideoPair>({ video: null, canvas: null, stamp: -1, ready: false });

  useEffect(() => {
    const reduced = prefersReducedMotion();
    orbPairRef.current.video = orbVideoRef.current;
    orbPairRef.current.canvas = orbCanvasRef.current;
    jellyPairRef.current.video = jellyVideoRef.current;
    jellyPairRef.current.canvas = jellyCanvasRef.current;
    let raf = 0;
    let warned = false;

    const tick = () => {
      // Schedule the next frame BEFORE drawing: one bad frame must not freeze
      // the scene permanently (reference project hit exactly this bug).
      raf = requestAnimationFrame(tick);
      try {
        paintVideo(orbPairRef.current);
        paintVideo(jellyPairRef.current);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.error('[SessionKnowledgePanel] scene frame failed:', err);
        }
      }
    };
    raf = requestAnimationFrame(tick);

    const vids = [orbVideoRef.current, jellyVideoRef.current].filter((v): v is HTMLVideoElement => !!v);
    const sync = () => {
      for (const v of vids) {
        if (reduced || document.hidden) {
          v.pause();
          continue;
        }
        // jsdom's play() returns undefined rather than a promise; guard both.
        const r = v.play() as Promise<void> | undefined;
        if (r && typeof r.catch === 'function') r.catch(() => undefined);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', sync);
    };
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
  // without resetting positions.
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
      className="skp-root"
      role="complementary"
      aria-label={t('shell.knowledge.title')}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Ambient scene — decorative, must never swallow graph clicks. */}
      <div className="skp-scene" aria-hidden="true">
        <div className="skp-orb">
          <div className="skp-orb-halo" />
          <video ref={orbVideoRef} className="skp-vsrc" src={orbSrc} poster={ORB_POSTER} muted loop playsInline autoPlay preload="auto" />
          <canvas ref={orbCanvasRef} className="skp-vid skp-orb-vid" />
        </div>
        <div className="skp-jelly">
          <video ref={jellyVideoRef} className="skp-vsrc" src={jellySrc} muted loop playsInline autoPlay preload="auto" />
          <canvas ref={jellyCanvasRef} className="skp-vid skp-jelly-vid" />
        </div>
      </div>

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
