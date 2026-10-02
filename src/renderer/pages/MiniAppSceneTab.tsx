// MiniAppSceneTab.tsx — Phase 4 entry (PRD v0.4 §B.5).
//
// Thin wrapper: reads `tab.miniapp` (set by App when creating a
// `view: 'miniapp-scene'` tab), fetches the MiniApp's compiled source HTML
// from Rust via `/api/miniapp/source`, and mounts <MiniAppRunner>. The
// runner already handles iframe sandbox + worker spawn + postMessage trust
// rules; no extra logic belongs here. The scene tab is intentionally a leaf:
// future per-MiniApp chrome (close confirmation, refresh, share) belongs in a
// different wrapper, not here.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MiniAppRunner from '@/components/miniapp-host/MiniAppRunner';
import type { BubbleClaimMessage } from '@/components/miniapp-host/bubbleClaimBridge';
import { loadMiniAppSource } from '@/lib/marketplaceClient';
import { useResolvedTheme } from '@/theme';
import { isSupportedLocale } from '@/../shared/i18n';
import type { Tab } from '@/types/tab';

export interface MiniAppSceneTabProps {
  tab: Tab;
  isActive: boolean;
  /**
   * Bubble Claim sink. The runner verifies the claim (source + nonce + appId)
   * and hands it here; App routes it into a Chat tab's composer. Optional so
   * a bare mount (tests, storybook) still renders.
   */
  onBubbleClaim?: (msg: BubbleClaimMessage) => void;
}

export default function MiniAppSceneTab({ tab, isActive, onBubbleClaim }: MiniAppSceneTabProps) {
  const payload = tab.miniapp;
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const { i18n } = useTranslation();

  // 宿主环境事实，随 `host.ready` 下发给 iframe 侧 runtime，填充
  // `app.locale` / `app.appearanceMode` / `app.platform`。
  // `app.t(...)` 与 `onLocaleChange` 依赖它，因此必须在首帧就正确。
  const runtimeEnv = useMemo(
    () => ({
      appearanceMode: theme.appearanceMode,
      locale: isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN',
      platform: navigator.platform.toLowerCase().includes('win')
        ? 'win32'
        : navigator.platform.toLowerCase().includes('mac')
          ? 'darwin'
          : 'linux',
    }),
    [theme.appearanceMode, i18n.language],
  );

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
      // `meta.json::permissions` 是 `window.app.*` 的 renderer 侧授权依据；
      // 缺省即无授权，所有能力调用 fail-closed。
      permissions={payload.permissions}
      dependencies={payload.dependencies}
      env={runtimeEnv}
      isActive={isActive}
      srcDoc={srcDoc}
      onBubbleClaim={onBubbleClaim}
    />
  );
}