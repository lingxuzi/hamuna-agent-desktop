import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, Loader2 } from 'lucide-react';

import {
  SOCIAL_PLATFORMS,
  needsSelectorProbe,
  resolveLoginState,
  withSocialAccount,
  type SocialAccount,
  type SocialPlatformDefinition,
  type SocialPlatformId,
} from '../../../../shared/socialPlatforms';
import { atomicModifyConfig } from '@/config/configService';
import { useConfigData } from '@/config/useConfigData';
import { useToast } from '@/components/Toast';

// Same lazy split as Chat.tsx — the panel pulls in the whole native-browser
// control surface, and Settings is not the usual reason the app starts.
const LazyBrowserPanel = lazy(() => import('@/components/BrowserPanel'));

/** Login attempt gives up after this long — enough for SMS / 密码 + 验证码. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How often to ask the page for its login elements. Only platforms whose
 * `loggedInSelector` is set need this (Douyin: the URL does not change on
 * login). 2s is well under the time it takes a human to scan and for the
 * console to boot, so it never feels laggy, and a `querySelector` round trip
 * is a few hundred microseconds.
 */
const LOGIN_POLL_MS = 2000;

interface ActiveLogin {
  platform: SocialPlatformDefinition;
  tabId: string;
}

interface SocialAccountsSectionProps {
  /** Settings tab is the active tab. Forwarded to the webview: tab contents
   *  stay mounted (App.tsx hides them with `contentVisibility`), and the native
   *  browser is an OS-level overlay that ignores CSS — without this it would
   *  float over whichever tab the user switched to. */
  isActive?: boolean;
}

export function SocialAccountsSection({ isActive = true }: SocialAccountsSectionProps) {
  const { t } = useTranslation('settings');
  const { config } = useConfigData();
  const toast = useToast();

  const accounts = useMemo(() => config.socialAccounts ?? {}, [config.socialAccounts]);

  const [activeLogin, setActiveLogin] = useState<ActiveLogin | null>(null);
  const [browserAlive, setBrowserAlive] = useState(false);

  const writeAccount = useCallback(
    async (platformId: SocialPlatformId, patch: Partial<SocialAccount>) => {
      try {
        // MUST be atomicModifyConfig: `updateConfig({ socialAccounts })` shallow-
        // merges at the ROOT, so writing one platform drops every other platform.
        await atomicModifyConfig((latest) => ({
          ...latest,
          socialAccounts: withSocialAccount(latest.socialAccounts, platformId, patch),
        }));
      } catch (err) {
        toast.error(t('accounts.saveFailed', { message: String(err) }));
      }
    },
    [t, toast],
  );

  const closeLogin = useCallback(() => {
    setActiveLogin(null);
    setBrowserAlive(false);
  }, []);

  // Stable identities: BrowserPanel lists both in its create-effect deps, so a
  // fresh arrow per render re-runs that effect for no reason. It is guarded
  // against a second create now, but the churn also re-arms the rAF bounds
  // wait on every render.
  const handleBrowserCreated = useCallback(() => setBrowserAlive(true), []);

  // Latest URL seen by the url-changed subscription. Only the selector-probe
  // platforms need it (so a probe never reports success while the webview sits
  // on a non-http page), and it must not be state — a URL change would then
  // re-render the whole section on every navigation.
  const currentUrlRef = useRef('');

  const finishLogin = useCallback(
    (platformId: SocialPlatformId) => {
      closeLogin();
      void writeAccount(platformId, {
        lastLoginState: 'success',
        lastCheckedAt: Math.floor(Date.now() / 1000),
      });
      toast.success(t('accounts.loginSuccess', { platform: t(`accounts.platform.${platformId}`) }));
    },
    [closeLogin, toast, t, writeAccount],
  );

  // URL-driven platforms finish here. Rust emits `browser:url-changed` from
  // both `on_navigation` and `on_page_load`, so a post-login redirect is
  // caught the moment it commits rather than after the console finishes
  // booting. Douyin never reaches this branch — see the poll below.
  const handleUrlChange = useCallback(
    (url: string) => {
      currentUrlRef.current = url;
      if (!activeLogin) return;
      if (needsSelectorProbe(activeLogin.platform)) return;
      if (!resolveLoginState(activeLogin.platform, { url })) return;
      finishLogin(activeLogin.platform.id);
    },
    [activeLogin, finishLogin],
  );

  // Selector-driven platforms: Douyin's URL is identical before and after the
  // QR scan, so nothing pushes an event. Poll the page instead — the
  // post-login console button appearing IS the signal, paired with the QR
  // code being gone (Easel reads the same pair in `douyin_publish.py`).
  useEffect(() => {
    if (!activeLogin || !browserAlive) return;
    const platform = activeLogin.platform;
    if (!needsSelectorProbe(platform)) return;

    const tabId = activeLogin.tabId;
    let stopped = false;
    let timer: number | undefined;

    const probe = async () => {
      try {
        const loggedInVisible = await invoke<boolean>('cmd_browser_query_visible', {
          tabId,
          selector: platform.loggedInSelector,
        });
        if (stopped) return;
        let loggedOutVisible = false;
        if (platform.loggedOutSelector) {
          loggedOutVisible = await invoke<boolean>('cmd_browser_query_visible', {
            tabId,
            selector: platform.loggedOutSelector,
          });
          if (stopped) return;
        }
        if (
          resolveLoginState(platform, {
            url: currentUrlRef.current,
            loggedInVisible,
            loggedOutVisible,
          })
        ) {
          stopped = true;
          finishLogin(platform.id);
          return;
        }
      } catch {
        // Webview still booting / mid-navigation: `querySelectorAll` on a
        // context that is being replaced rejects. Keep polling.
      }
      if (!stopped) timer = window.setTimeout(probe, LOGIN_POLL_MS);
    };

    timer = window.setTimeout(probe, LOGIN_POLL_MS);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeLogin, browserAlive, finishLogin]);

  useEffect(() => {
    if (!activeLogin) return;
    const timer = window.setTimeout(() => {
      closeLogin();
      void writeAccount(activeLogin.platform.id, { lastLoginState: 'expired' });
      toast.error(t('accounts.loginTimeout'));
    }, LOGIN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [activeLogin, closeLogin, toast, t, writeAccount]);

  // ── Login view ──
  //
  // Rendered as a full-height takeover of the section rather than an inline
  // card under the list. The section lives in Settings' `overflow-y-auto`
  // container; an inline panel taller than the remaining viewport would let
  // the OS-level webview spill over the sidebar and titlebar, because its
  // position comes from `getBoundingClientRect` and nothing clips it to the
  // scroll viewport. Making the login view exactly fill that container keeps
  // the rect inside it — no clamping, no portal, no scroll juggling.
  if (activeLogin) {
    return (
      <div className="flex h-full flex-col px-8 py-6">
        <div className="mb-4 flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={closeLogin}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('accounts.back')}
          </button>
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
            {t('accounts.loginTitle', {
              platform: t(`accounts.platform.${activeLogin.platform.id}`),
            })}
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ink-muted)]" />
          </span>
          <span className="text-xs text-[var(--ink-faint)]">{t('accounts.loginHint')}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)]">
          <Suspense fallback={null}>
            <LazyBrowserPanel
              // Remount per platform: Rust keys the native webview by tabId and
              // rejects a second create for an id that is still alive.
              key={activeLogin.platform.id}
              tabId={activeLogin.tabId}
              url={activeLogin.platform.loginUrl}
              isVisible={isActive}
              isDraggingSplit={false}
              browserAlive={browserAlive}
              onBrowserCreated={handleBrowserCreated}
              onCreateFailed={closeLogin}
              onClose={closeLogin}
              onUrlChange={handleUrlChange}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-8 py-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t('accounts.title')}</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('accounts.description')}</p>
      </div>

      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map((platform) => {
          const account = accounts[platform.id] as SocialAccount | undefined;
          const state = account?.lastLoginState ?? 'unknown';
          return (
            <div
              key={platform.id}
              className="flex items-center gap-4 rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper-elevated)] px-5 py-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--paper-inset)] text-xs font-medium text-[var(--ink-secondary)]">
                {platform.badge}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {t(`accounts.platform.${platform.id}`)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      state === 'success'
                        ? 'bg-[var(--success-bg)] text-[var(--success)]'
                        : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'
                    }`}
                  >
                    {t(`accounts.status.${state}`)}
                  </span>
                  {state === 'success' && account?.lastCheckedAt && (
                    <span className="text-xs text-[var(--ink-faint)]">
                      {new Date(account.lastCheckedAt * 1000).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <input
                  className="mt-1 w-full max-w-xs rounded-[var(--radius-sm)] bg-transparent text-xs text-[var(--ink-secondary)] outline-none placeholder:text-[var(--ink-faint)]"
                  placeholder={t('accounts.displayNamePlaceholder')}
                  defaultValue={account?.displayName ?? ''}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next === (account?.displayName ?? '')) return;
                    void writeAccount(platform.id, { displayName: next || undefined });
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setBrowserAlive(false);
                  setActiveLogin({ platform, tabId: `social-login-${platform.id}` });
                }}
                className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
              >
                {state === 'success' ? t('accounts.relogin') : t('accounts.login')}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[var(--ink-faint)]">{t('accounts.sharedHint')}</p>
    </div>
  );
}
