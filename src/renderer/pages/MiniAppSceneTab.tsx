// MiniAppSceneTab.tsx — Phase 4 entry (PRD v0.4 §B.5).
//
// Thin wrapper: reads `tab.miniapp` (set by App when creating a
// `view: 'miniapp-scene'` tab), fetches the MiniApp's compiled source HTML
// from Rust via `/api/miniapp/source`, and mounts <MiniAppRunner>. The
// runner already handles iframe sandbox + worker spawn + postMessage trust
// rules; no extra logic belongs here. The scene tab is intentionally a leaf:
// future per-MiniApp chrome (close confirmation, refresh, share) belongs in a
// different wrapper, not here.

import { useEffect, useState } from 'react';

import MiniAppRunner from '@/components/miniapp-host/MiniAppRunner';
import { loadMiniAppSource } from '@/lib/marketplaceClient';
import type { Tab } from '@/types/tab';

export interface MiniAppSceneTabProps {
  tab: Tab;
  isActive: boolean;
}

export default function MiniAppSceneTab({ tab }: MiniAppSceneTabProps) {
  const payload = tab.miniapp;
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload source on appId change OR when the tab becomes active again (cheap
  // mirror of Marketplace.tsx reload-on-activation — but for source it's
  // strictly cosmetic; the runner keeps state across toggles).
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setSrcDoc(null);
    setError(null);
    void loadMiniAppSource(payload.appId)
      .then((html) => {
        if (!cancelled) setSrcDoc(html);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the appId changes — `isActive` is intentional no-op
    // (the runner handles its own mount/cleanup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.appId]);

  if (!payload) {
    // Defensive: App should never create a miniapp-scene tab without
    // `miniapp`. Render a soft fallback so a bad dispatch doesn't blank
    // the tab.
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--paper)] text-sm text-[var(--ink-muted)]">
        Missing MiniApp payload — close this tab and reopen from the MiniApp Center.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--paper)] p-6 text-sm text-red-700">
        Failed to load MiniApp source: {error}
      </div>
    );
  }

  if (srcDoc === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--paper)] text-sm text-[var(--ink-muted)]">
        Loading {payload.appId}…
      </div>
    );
  }

  return (
    <MiniAppRunner
      appId={payload.appId}
      kind={payload.kind}
      workerKind={payload.workerKind}
      srcDoc={srcDoc}
    />
  );
}