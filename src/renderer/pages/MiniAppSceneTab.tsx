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
import { loadMiniAppSourceWithRoots } from '@/lib/marketplaceClient';
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
  // 两个路径根由 sidecar 随 source 一起下发。它们必须与 sidecar 展开
  // `{appdata}` / `{workspace}` 权限前缀时用的是同一组值，所以只能来自
  // sidecar —— 见 `loadMiniAppSourceWithRoots` 的注释。
  const [roots, setRoots] = useState({ appDataDir: '', workspaceDir: '' });
  const theme = useResolvedTheme();
  const { i18n } = useTranslation();

  // 宿主环境事实，随 `host.ready` 下发给 iframe 侧 runtime，填充
  // `app.locale` / `app.appearanceMode` / `app.platform` / `app.appDataDir` /
  // `app.workspaceDir`。`app.t(...)` 与 `onLocaleChange` 依赖前三者，因此必须
  // 在首帧就正确。
  const runtimeEnv = useMemo(
    () => ({
      appearanceMode: theme.appearanceMode,
      locale: isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN',
      platform: navigator.platform.toLowerCase().includes('win')
        ? 'win32'
        : navigator.platform.toLowerCase().includes('mac')
          ? 'darwin'
          : 'linux',
      workspaceDir: roots.workspaceDir,
      appDataDir: roots.appDataDir,
    }),
    [theme.appearanceMode, i18n.language, roots.workspaceDir, roots.appDataDir],
  );

  // Reload source when the appId changes — and only then. `isActive` is
  // deliberately NOT a dependency: the runner keeps its own state across tab
  // toggles, and re-fetching srcDoc would tear that state down for nothing.
  // (An earlier comment here claimed this also reloaded on re-activation; it
  // never did, and anyone reading it would wire `isActive` in expecting a
  // refresh that a create would not actually produce.)
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setSrcDoc(null);
    setError(null);
    void loadMiniAppSourceWithRoots(payload.appId)
      .then((loaded) => {
        if (cancelled) return;
        setSrcDoc(loaded.source);
        setRoots({ appDataDir: loaded.appDataDir, workspaceDir: loaded.workspaceDir });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the appId changes — see the note above the effect.
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