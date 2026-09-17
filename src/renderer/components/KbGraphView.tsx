// KbGraphView — interactive force-directed knowledge-graph visualization.
//
// Physics: d3.forceSimulation on plain objects (no DOM elements).
// Rendering: a single <canvas> 2D context — thousands of nodes cost zero DOM
// nodes, so large graphs stay smooth (the previous SVG version throttled DOM
// updates; canvas removes the DOM cost entirely).
//
// Interaction: wheel = zoom, drag background = pan, drag node = pin it.
// Hover shows the entity label in a corner tooltip. Fullscreen overlay + ESC.

import * as d3 from 'd3';
import { Loader2, Maximize2, Minimize2, RefreshCw, Share2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getKbGraphData, type KbEntity, type KbGraph } from '@/api/kbClient';

// Keep the layout sane for very large graphs.
const MAX_NODES = 400;
const MAX_EDGES = 1200;

// Perf mode kicks in above this many nodes: faster settle, no label drawing
// until zoomed in.
const LARGE_THRESHOLD = 60;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  entityType?: string;
  sources: string[];
  /** relations touching this node (computed once links resolve) */
  rels: { label: string; other: string; typed: boolean }[];
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationType: string;
  typed: boolean;
  weight: number;
}

interface GraphView {
  nodes: GraphNode[];
  links: GraphLink[];
  simulation: d3.Simulation<GraphNode, GraphLink>;
  /** view transform: translate(x,y) scale(k) */
  transform: { x: number; y: number; k: number };
  /** node under the cursor (drag target) */
  dragging: GraphNode | null;
  dragOffset: { x: number; y: number } | null;
  hover: GraphNode | null;
  /** node ids whose full neighborhood is currently expanded (click toggles) */
  expanded: Set<string>;
  raf: number;
  destroyed: boolean;
  /** localized tooltip labels */
  ui: { type: string; sources: string; relations: string };
}

/** Read a CSS variable value (fallback for missing/unset). */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Main render loop: redraw the canvas every frame while animating. */
function drawFrame(view: GraphView, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { transform, nodes, links } = view;
  const isLarge = nodes.length > LARGE_THRESHOLD;

  const colors = {
    link: cssVar('--line', '#d0d0d0'),
    linkTyped: cssVar('--accent', '#4f8cff'),
    node: cssVar('--accent', '#4f8cff'),
    nodeText: cssVar('--ink', '#222'),
    labelText: cssVar('--ink-muted', '#888'),
    hover: cssVar('--button-primary-bg', '#4f8cff'),
  };

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  // ── Clean relation display ─────────────────────────────────────────────
  // Default view shows only the strongest relations (a readable core, not a
  // hairball). Clicking a node expands its FULL neighborhood; the whole edge
  // set is always available for hover details.
  const expanded = view.expanded;
  const visible = new Set<GraphLink>();
  if (expanded.size > 0) {
    // All edges touching any expanded node.
    for (const l of links) {
      const s = l.source as GraphNode;
      const t = l.target as GraphNode;
      if (expanded.has(s.id) || expanded.has(t.id)) visible.add(l);
    }
  } else {
    // Curated core: per-node strongest edges (top K by weight) — a clean
    // skeleton. Weighted toward typed relations.
    const perNode = new Map<string, { l: GraphLink; w: number }[]>();
    for (const l of links) {
      const s = l.source as GraphNode;
      const t = l.target as GraphNode;
      const w = l.weight * (l.typed ? 1.5 : 1);
      for (const id of [s.id, t.id]) {
        const arr = perNode.get(id) ?? [];
        arr.push({ l, w });
        perNode.set(id, arr);
      }
    }
    for (const arr of perNode.values()) {
      arr.sort((a, b) => b.w - a.w);
      for (const { l } of arr.slice(0, 3)) visible.add(l);
    }
  }

  // Links.
  ctx.lineWidth = 1 / transform.k;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  let any = false;
  for (const l of visible) {
    const s = l.source as GraphNode;
    const t = l.target as GraphNode;
    if (s.x == null || t.x == null) continue;
    any = true;
    ctx.moveTo(s.x ?? 0, s.y ?? 0);
    ctx.lineTo(t.x ?? 0, t.y ?? 0);
  }
  if (any) {
    ctx.strokeStyle = colors.link;
    ctx.stroke();
  }
  // Typed links drawn over, slightly thicker + accent colored.
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.8 / transform.k;
  ctx.beginPath();
  let typedDrawn = false;
  for (const l of visible) {
    if (!l.typed) continue;
    typedDrawn = true;
    const s = l.source as GraphNode;
    const t = l.target as GraphNode;
    if (s.x == null || t.x == null) continue;
    ctx.moveTo(s.x ?? 0, s.y ?? 0);
    ctx.lineTo(t.x ?? 0, t.y ?? 0);
  }
  if (typedDrawn) {
    ctx.strokeStyle = colors.linkTyped;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Nodes.
  const r = isLarge ? 5 : 7;
  ctx.fillStyle = colors.node;
  for (const n of nodes) {
    if (n.x == null) continue;
    ctx.beginPath();
    ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hover highlight.
  if (view.hover && view.hover.x != null) {
    ctx.fillStyle = colors.hover;
    ctx.beginPath();
    ctx.arc(view.hover.x ?? 0, view.hover.y ?? 0, r + 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels: always for small graphs; for large graphs only when zoomed in
  // enough that they don't overlap.
  const showLabels = !isLarge || transform.k > 1.6;
  if (showLabels) {
    ctx.font = `${11 / transform.k}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.nodeText;
    for (const n of nodes) {
      if (n.x == null) continue;
      ctx.fillText(n.label, n.x ?? 0, (n.y ?? 0) - r - 6 / transform.k);
    }
  }

  ctx.restore();

  // Hover detail panel (screen space): node knowledge — label, type, source
  // docs, and the relations touching this node.
  if (view.hover && view.hover.x != null) {
    const h = view.hover;
    const sx = (transform.x + (h.x ?? 0) * transform.k) as number;
    const sy = (transform.y + (h.y ?? 0) * transform.k) as number;

    const lines: string[] = [h.label];
    if (h.entityType) lines.push(`${view.ui.type}: ${h.entityType}`);
    if (h.sources.length > 0) lines.push(`${view.ui.sources}: ${h.sources.length}`);
    const rels = h.rels.slice(0, 6);
    if (rels.length > 0) {
      lines.push(view.ui.relations + ':');
      for (const r of rels) lines.push(`  ${r.other} — ${r.label}`);
    }

    ctx.font = '12px system-ui, sans-serif';
    const lineH = 16;
    const panelH = lines.length * lineH + 14;
    let panelW = 0;
    for (const ln of lines) {
      panelW = Math.max(panelW, ctx.measureText(ln).width);
    }
    panelW = Math.min(Math.max(panelW + 20, 140), width - 16);

    // Anchor the panel left of the cursor (or right when near the left edge).
    let px = sx + 14 * transform.k;
    if (px + panelW > width - 6) px = sx - panelW - 14 * transform.k;
    px = Math.max(4, Math.min(px, width - panelW - 4));
    const py = Math.max(4, Math.min(sy - panelH / 2, height - panelH - 4));

    ctx.fillStyle = cssVar('--paper-inset', '#1e1e1e');
    ctx.globalAlpha = 0.96;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(px, py, panelW, panelH, 8);
    } else {
      ctx.rect(px, py, panelW, panelH);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // Accent bar + title.
    ctx.fillStyle = colors.hover;
    ctx.fillRect(px, py, 3, panelH);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cssVar('--ink', '#222');
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(h.label, px + 12, py + lineH / 2 + 2);

    ctx.font = '11px system-ui, sans-serif';
    const relHeader = view.ui.relations + ':';
    for (let i = 1; i < lines.length; i++) {
      const y = py + lineH / 2 + 4 + i * lineH;
      if (lines[i] === relHeader) {
        ctx.fillStyle = colors.linkTyped;
      } else if (lines[i].startsWith('  ')) {
        ctx.fillStyle = cssVar('--ink-muted', '#888');
      } else {
        ctx.fillStyle = cssVar('--ink', '#222');
      }
      ctx.fillText(lines[i], px + 12, y);
    }
  }
}

function stopAnimation(view: GraphView | null): void {
  if (!view) return;
  view.destroyed = true;
  if (view.raf) cancelAnimationFrame(view.raf);
  view.simulation.stop();
}

/**
 * Merge newly fetched graph data into a live view WITHOUT resetting the
 * layout: new nodes spawn near the view center, existing nodes keep their
 * positions, new links get wired in, and the simulation re-heats gently.
 */
function updateGraph(view: GraphView, host: HTMLCanvasElement, graph: KbGraph): boolean {
  const existing = new Map(view.nodes.map((n) => [n.id.toLowerCase(), n]));
  const cx = (view.transform.x + (host.clientWidth || 600) / 2) / Math.max(view.transform.k, 0.1);
  const cy = (view.transform.y + (host.clientHeight || 420) / 2) / Math.max(view.transform.k, 0.1);
  let added = 0;
  for (const e of graph.entities.slice(0, MAX_NODES)) {
    const key = e.id.trim().toLowerCase();
    if (existing.has(key)) continue;
    const n: GraphNode = {
      id: e.id,
      label: e.label,
      entityType: e.entityType,
      sources: e.sources ?? [],
      rels: [],
      x: cx + (Math.random() - 0.5) * 120,
      y: cy + (Math.random() - 0.5) * 120,
    };
    view.nodes.push(n);
    existing.set(key, n);
    added++;
  }
  if (added === 0) return false;

  // Recompute rels (links may reference new nodes).
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  for (const n of view.nodes) n.rels = [];
  view.links.length = 0;
  const pairSeen = new Set<string>();
  for (const r of graph.relations) {
    if (view.links.length >= MAX_EDGES) break;
    if (!byId.has(r.subject) || !byId.has(r.object) || r.subject === r.object) continue;
    const a = r.subject.toLowerCase() <= r.object.toLowerCase() ? r.subject : r.object;
    const b = a === r.subject ? r.object : r.subject;
    const key = `${a}\u0000${b}`;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    const l: GraphLink = { source: r.subject, target: r.object, relationType: r.relationType, typed: r.typed, weight: r.weight };
    view.links.push(l);
    const s = byId.get(r.subject);
    const t = byId.get(r.object);
    if (s && t) {
      s.rels.push({ label: r.relationType, other: t.label, typed: r.typed });
      t.rels.push({ label: r.relationType, other: s.label, typed: r.typed });
    }
  }

  view.simulation.nodes(view.nodes);
  (view.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink> | null)?.links(view.links);
  view.simulation.alpha(0.35).restart();
  return true;
}

/** Build the graph inside a canvas host. Returns the view (caller stops it). */
function renderGraph(host: HTMLCanvasElement, graph: KbGraph, ui: { type: string; sources: string; relations: string }): GraphView {
  const width = host.clientWidth || 600;
  const height = host.clientHeight || 420;
  if (width <= 0 || height <= 0) throw new Error('graph host has no size');

  // ── Clean the raw graph ────────────────────────────────────────────────
  // 1) Merge duplicate nodes: id normalized (trim + lowercase) so the same
  //    entity extracted in different chunks/casings becomes ONE node.
  // 2) Dedupe relations: one edge per (subject, object) pair — prefer the
  //    typed/higher-weight copy; drop self-loops.
  const merged = new Map<string, KbEntity>();
  for (const e of graph.entities) {
    const key = e.id.trim().toLowerCase();
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, e);
    } else {
      // Merge sources, keep the first non-null type and the longest label.
      if (!prev.entityType && e.entityType) prev.entityType = e.entityType;
      for (const s of e.sources ?? []) {
        if (!prev.sources?.includes(s)) prev.sources = [...(prev.sources ?? []), s];
      }
      if (e.label.length > prev.label.length) prev.label = e.label;
    }
  }
  const nodes: GraphNode[] = [...merged.values()].slice(0, MAX_NODES).map((e) => ({
    id: e.id,
    label: e.label,
    entityType: e.entityType,
    sources: e.sources ?? [],
    rels: [],
  }));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const pairSeen = new Map<string, GraphLink>();
  for (const r of graph.relations) {
    if (!nodeIds.has(r.subject) || !nodeIds.has(r.object) || r.subject === r.object) continue;
    const a = r.subject.toLowerCase() <= r.object.toLowerCase() ? r.subject : r.object;
    const b = a === r.subject ? r.object : r.subject;
    const key = `${a}\u0000${b}`;
    const prev = pairSeen.get(key);
    if (!prev || (r.typed && !prev.typed) || (r.typed === prev.typed && r.weight > prev.weight)) {
      pairSeen.set(key, { source: r.subject, target: r.object, relationType: r.relationType, typed: r.typed, weight: r.weight });
    }
  }
  const links: GraphLink[] = [...pairSeen.values()].slice(0, MAX_EDGES);

  // Precompute each node's touching relations for the hover detail panel.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    const s = nodeById.get(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id);
    const t = nodeById.get(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id);
    if (s && t) {
      s.rels.push({ label: l.relationType, other: t.label, typed: l.typed });
      t.rels.push({ label: l.relationType, other: s.label, typed: l.typed });
    }
  }

  const isLarge = nodes.length > LARGE_THRESHOLD;

  const simulation = d3
    .forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => (d.typed ? 90 : 55))
        .strength(0.35),
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(isLarge ? -140 : -240))
    .force('center', d3.forceCenter(width / 2, height / 2));

  // forceCollide is O(n²) — skip it for large graphs.
  if (!isLarge) {
    simulation.force('collide', d3.forceCollide<GraphNode>().radius(26));
  }

  // Large graphs settle much faster (fewer ticks).
  simulation.alphaDecay(isLarge ? 0.09 : 0.04).velocityDecay(isLarge ? 0.6 : 0.4);

  const view: GraphView = {
    nodes,
    links,
    simulation,
    transform: { x: 0, y: 0, k: 1 },
    dragging: null,
    dragOffset: null,
    hover: null,
    expanded: new Set<string>(),
    raf: 0,
    destroyed: false,
    ui,
  };

  // ── interaction: zoom / pan / drag ────────────────────────────────────

  function screenToWorld(cx: number, cy: number): { x: number; y: number } {
    return { x: (cx - view.transform.x) / view.transform.k, y: (cy - view.transform.y) / view.transform.k };
  }

  function nodeAt(cx: number, cy: number): GraphNode | null {
    const p = screenToWorld(cx, cy);
    const rr = (isLarge ? 8 : 12) / view.transform.k;
    let best: GraphNode | null = null;
    let bestD = rr * rr;
    for (const n of nodes) {
      if (n.x == null) continue;
      const dx = (n.x ?? 0) - p.x;
      const dy = (n.y ?? 0) - p.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  let panning = false;
  let panStart = { x: 0, y: 0 };
  let downNode: GraphNode | null = null;
  let downPos = { x: 0, y: 0 };

  host.addEventListener('pointerdown', (e) => {
    const rect = host.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const n = nodeAt(cx, cy);
    downNode = n;
    downPos = { x: cx, y: cy };
    if (n) {
      view.dragging = n;
      view.dragOffset = { x: cx, y: cy };
      simulation.alphaTarget(0.3).restart();
      n.fx = n.x;
      n.fy = n.y;
      host.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      panning = true;
      panStart = { x: cx, y: cy };
      host.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  host.addEventListener('pointermove', (e) => {
    const rect = host.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (view.dragging) {
      const p = screenToWorld(cx, cy);
      if (view.dragOffset) {
        view.dragging.fx = p.x;
        view.dragging.fy = p.y;
      }
    } else if (panning) {
      view.transform.x += cx - panStart.x;
      view.transform.y += cy - panStart.y;
      panStart = { x: cx, y: cy };
    } else {
      view.hover = nodeAt(cx, cy);
    }
  });

  const endPointer = (e: PointerEvent) => {
    // Click (no drag movement) on a node toggles its neighborhood expansion.
    const rect = host.getBoundingClientRect();
    const moved = Math.hypot(e.clientX - rect.left - downPos.x, e.clientY - rect.top - downPos.y);
    if (downNode && moved < 4 && !view.dragging) {
      // Treat as a click: expand/collapse this node's relations.
      // (view.dragging is still set here — use the movement heuristic.)
    }
    if (view.dragging) {
      const wasClick = downNode && moved < 4;
      if (wasClick) {
        const id = view.dragging.id;
        if (view.expanded.has(id)) {
          view.expanded.delete(id);
        } else {
          view.expanded.add(id);
        }
        // Wake the layout so expanded edges pull neighbors closer.
        simulation.alpha(0.4).restart();
      }
      view.dragging.fx = null;
      view.dragging.fy = null;
      view.dragging = null;
      view.dragOffset = null;
      if (!e.shiftKey) simulation.alphaTarget(0);
    }
    downNode = null;
    panning = false;
    try {
      host.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
  };
  host.addEventListener('pointerup', endPointer);
  host.addEventListener('pointercancel', endPointer);
  host.addEventListener('pointerleave', () => {
    view.hover = null;
  });

  host.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = Math.min(6, Math.max(0.15, view.transform.k * factor));
      // Zoom toward cursor.
      view.transform.x = cx - ((cx - view.transform.x) / view.transform.k) * k;
      view.transform.y = cy - ((cy - view.transform.y) / view.transform.k) * k;
      view.transform.k = k;
    },
    { passive: false },
  );

  // ── animation loop ────────────────────────────────────────────────────

  simulation.on('tick', () => {
    // No DOM to update — the raf loop redraws from simulation state. With
    // throttled ticks (alphaDecay) this stays smooth even for large graphs.
  });

  function loop(): void {
    if (view.destroyed) return;
    try {
      drawFrame(view, host);
    } catch (err) {
      // A draw error must never kill the animation loop permanently.
      console.error('[KbGraphView] drawFrame error:', err);
      if (view.destroyed) return;
    }
    view.raf = requestAnimationFrame(loop);
  }
  view.raf = requestAnimationFrame(loop);

  return view;
}

/** Resize the canvas backing store to the host, keeping the view centered. */
function resizeGraph(view: GraphView | null, host: HTMLCanvasElement): void {
  if (!view) return;
  const w = host.clientWidth || 600;
  const h = host.clientHeight || 420;
  if (w <= 0 || h <= 0) return;
  view.simulation.force('center', d3.forceCenter(w / 2, h / 2));
  view.simulation.alpha(0.3).restart();
  drawFrame(view, host);
}

export default function KbGraphView({ kbId }: { kbId: string }) {
  const { t } = useTranslation('settings');
  const [graph, setGraph] = useState<KbGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const inlineRef = useRef<HTMLCanvasElement>(null);
  const fullscreenRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GraphView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getKbGraphData(kbId);
      setGraph(data);
      setLoadError(null);
      return data;
    } catch (e) {
      console.error('[KbGraphView] load failed:', e);
      setLoadError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Live update: while the LLM poller still has pending chunks, poll every few
  // seconds and merge the new nodes/relations into the running simulation.
  const graphRef = useRef<KbGraph | null>(null);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  useEffect(() => {
    const host = () => (isFullscreen ? fullscreenRef.current : inlineRef.current);
    const pending = graph?.pendingCount ?? 0;
    if (pending === 0) return; // extraction done — no polling needed
    const timer = setInterval(async () => {
      try {
        const data = await getKbGraphData(kbId);
        graphRef.current = data;
        setGraph(data);
        const v = viewRef.current;
        const h = host();
        if (v && h && data.entities.length > 0) {
          if (updateGraph(v, h, data)) {
            // draw immediately so growth is visible without waiting a tick
            drawFrame(v, h);
          }
        }
      } catch (e) {
        console.warn('[KbGraphView] live refresh failed:', e);
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [graph?.pendingCount, kbId, isFullscreen]);

  // Render the graph into whichever host is mounted (inline vs fullscreen).
  useEffect(() => {
    const host = isFullscreen ? fullscreenRef.current : inlineRef.current;
    if (!host || !graph) return;
    if (host.clientWidth === 0) {
      console.warn('[KbGraphView] host has 0 width at render time; waiting for ResizeObserver');
      return; // fullscreen transition — wait for size
    }
    console.log(
      `[KbGraphView] rendering ${graph.entities.length} entities / ${graph.relations.length} relations into ${host.clientWidth}x${host.clientHeight} canvas; ctx=`,
      host.getContext('2d') !== null ? 'ok' : 'NULL',
    );
    stopAnimation(viewRef.current);
    viewRef.current = null;
    try {
      viewRef.current = renderGraph(host, graph, {
        type: t('kb.nodeType'),
        sources: t('kb.nodeSources'),
        relations: t('kb.nodeRelations'),
      });
    } catch (e) {
      console.error('[KbGraphView] render failed:', e);
    }
    return () => {
      stopAnimation(viewRef.current);
      viewRef.current = null;
    };
  }, [graph, isFullscreen, refreshKey, t]);

  // Resize: in-place re-center (no rebuild). Re-render once the host has size.
  useEffect(() => {
    const host = isFullscreen ? fullscreenRef.current : inlineRef.current;
    if (!host || !graph) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (viewRef.current) {
          resizeGraph(viewRef.current, host);
        } else if (host.clientWidth > 0) {
          viewRef.current = renderGraph(host, graph, {
            type: t('kb.nodeType'),
            sources: t('kb.nodeSources'),
            relations: t('kb.nodeRelations'),
          });
        }
      }, 150);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [graph, isFullscreen, t]);

  // ESC closes fullscreen.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const hasGraph = !!graph && graph.entities.length > 0;
  const pendingCount = graph?.pendingCount ?? 0;

  // Progress badge — rendered in the header AND in the empty state, so users
  // see extraction progress even before the first entities land.
  const progressBadge =
    pendingCount > 0 ? (
      <span className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('kb.extracting', { count: pendingCount })}
      </span>
    ) : hasGraph ? (
      <span className="rounded-full bg-[var(--line)]/40 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
        {t('kb.extractDone')}
      </span>
    ) : null;

  const header = (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--ink-muted)]">
          {t('kb.graphStats', { entities: graph?.entities.length ?? 0, relations: graph?.relations.length ?? 0 })}
        </span>
        {progressBadge}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          title={t('kb.refresh')}
        >
          <RefreshCw className="h-3 w-3" />
          {t('kb.refresh')}
        </button>
        <button
          onClick={() => setIsFullscreen(true)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          title={t('kb.fullscreen')}
        >
          <Maximize2 className="h-3 w-3" />
          {t('kb.fullscreen')}
        </button>
      </div>
    </div>
  );

  const graphBody = (
    <canvas
      ref={inlineRef}
      className="h-[420px] w-full rounded-lg border border-[var(--line)] bg-[var(--paper)]"
    />
  );

  return (
    <div>
      {loading && !graph ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] p-4 text-center text-sm text-[var(--error)]">
          {t('kb.graphLoadFailed')}
        </div>
      ) : !hasGraph ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--paper-inset)]/30 py-6 text-center text-sm text-[var(--ink-muted)]">
          <Share2 className="mx-auto h-6 w-6 text-[var(--ink-muted)]/40" />
          <p className="mt-1">{t('kb.graphEmpty')}</p>
          {pendingCount > 0 && <div className="mt-3 flex justify-center">{progressBadge}</div>}
        </div>
      ) : (
        <>
          {header}
          {graphBody}
        </>
      )}

      {/* Fullscreen overlay */}
      {isFullscreen && hasGraph && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--ink)]">
              {t('kb.graphStats', { entities: graph?.entities.length ?? 0, relations: graph?.relations.length ?? 0 })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
              >
                <RefreshCw className="h-4 w-4" />
                {t('kb.refresh')}
              </button>
              <button
                onClick={() => setIsFullscreen(false)}
                className="flex items-center gap-1 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] hover:bg-[var(--button-primary-bg-hover)]"
              >
                <Minimize2 className="h-4 w-4" />
                {t('kb.exitFullscreen')}
              </button>
              <button
                onClick={() => setIsFullscreen(false)}
                className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                title={t('kb.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <canvas
            ref={fullscreenRef}
            className="min-h-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)]"
          />
        </div>
      )}
    </div>
  );
}
