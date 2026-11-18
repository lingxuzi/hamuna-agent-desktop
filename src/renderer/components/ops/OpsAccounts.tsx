import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

import {
  SOCIAL_PLATFORMS,
  needsSelectorProbe,
  resolveLoginState,
  type SocialPlatformDefinition,
  type SocialPlatformId,
} from '../../../shared/socialPlatforms';
import type { OpsAccount, OpsLoginState } from '../../../shared/ops';
import { platformLabel, shortDate } from './opsFormat';
import { opsErrorMessage, opsUpsert } from './opsWrite';
import { useToastOptional } from '@/components/Toast';

// 与设置页同一套懒加载切分：这个面板拖着整套原生浏览器控制面，而运营台
// 本身不是应用启动的理由。
const LazyBrowserPanel = lazy(() => import('@/components/BrowserPanel'));

/** 一次登录最多等这么久：够走完短信 / 密码 + 验证码。 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 多久问一次页面「登录元素在不在」。只有设了 `loggedInSelector` 的平台需要
 * （抖音：登录前后 URL 一模一样）。2s 远小于人扫码的节奏，不觉得卡；一次
 * `querySelector` 往返只有几百微秒。
 */
const LOGIN_POLL_MS = 2000;

/* ── 账号清单 ─────────────────────────────────────────── */

export interface OpsAccountsProps {
  /** 工作区路径。账号台账就落在这个工作区里。 */
  workspace: string;
  /** 台账里的账号记录（可能一个都没有 —— 还没起过名、没登录过）。 */
  accounts: OpsAccount[];
  /** 点「去登录」：父组件切到登录接管视图。 */
  onLogin: (platform: SocialPlatformId) => void;
}

/**
 * 工作区账号清单。
 *
 * **一个平台一张卡**，七个平台永远都在 —— 没账号不等于没这个平台，卡本身就是
 * 「这个工作区要不要管这个平台」的入口。
 *
 * 登录态是**缓存的确认**，不是实时状态：真正的权威是浏览器 cookie（每个工作区
 * 一套 profile，见 `src-tauri/src/browser_profile.rs`）。所以这里写的是
 * 「上次确认已登录」，不是一个保证。
 */
export function OpsAccounts({ workspace, accounts, onLogin }: OpsAccountsProps) {
  const { t, i18n } = useTranslation('chat');
  const toast = useToastOptional();

  const byPlatform = useMemo(() => {
    const map = new Map<SocialPlatformId, OpsAccount>();
    for (const account of accounts) map.set(account.platform, account);
    return map;
  }, [accounts]);

  const signedIn = useMemo(
    () => accounts.filter((account) => account.loginState === 'success').length,
    [accounts],
  );

  const writeDisplayName = useCallback(
    async (platform: SocialPlatformId, displayName: string) => {
      try {
        await opsUpsert(workspace, { kind: 'account', platform, displayName });
      } catch (err) {
        toast?.error(t('ops.account.saveFailed', { message: opsErrorMessage(err) }));
      }
    },
    [workspace, toast, t],
  );

  return (
    <section className="ops-card ops-c-acc">
      <div className="ops-card-head">
        <h2>{t('ops.account.title')}</h2>
        <span className="ops-sp" />
        <span className="ops-meta">
          {t('ops.account.summary', { logged: signedIn, total: SOCIAL_PLATFORMS.length })}
        </span>
      </div>
      <p className="ops-acc-scope">{t('ops.account.scopeHint')}</p>

      <div className="ops-acc-grid">
        {SOCIAL_PLATFORMS.map((platform) => {
          const account = byPlatform.get(platform.id);
          const state: OpsLoginState = account?.loginState ?? 'unknown';
          return (
            <article className="ops-acc-card" key={platform.id}>
              <div className="ops-acc-card-head">
                <span className="ops-thumb" data-platform={platform.id}>
                  {/* 首字 + 平台色点 = 双编码。角标是 2–3 个字（「公众号」），
                      塞进 26px 的方块会顶出来；平台名就在旁边，不靠角标认。 */}
                  {platform.badge.charAt(0)}
                </span>
                <span className="ops-acc-card-name">{platformLabel(t, platform.id)}</span>
              </div>

              <input
                className="ops-acc-input"
                placeholder={t('ops.account.namePlaceholder')}
                defaultValue={account?.displayName ?? ''}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === (account?.displayName ?? '')) return;
                  void writeDisplayName(platform.id, next);
                }}
              />

              <div className="ops-acc-foot">
                <span className="ops-acc-meta">
                  <span className={`ops-acc-state is-${state}`}>
                    {t(`ops.account.status.${state}`)}
                  </span>
                  {account?.lastCheckedAt && (
                    <span className="ops-acc-time">
                      {t('ops.account.lastChecked', {
                        date: shortDate(account.lastCheckedAt, i18n.language),
                      })}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="ops-acc-act"
                  onClick={() => onLogin(platform.id)}
                >
                  {state === 'unknown' ? t('ops.account.login') : t('ops.account.relogin')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ── 登录接管 ─────────────────────────────────────────── */

export interface OpsAccountLoginProps {
  workspace: string;
  platform: SocialPlatformDefinition;
  /**
   * 重新登录：要清空的 cookie 域。给了 = 这是「重新登录」，接管后先清登录态、
   * 再重新打开登录页；不给 = 第一次登录，页面原样打开。
   *
   * **为什么必须清**：cookie 还在 jar 里时，登录探针一个 tick 内就判成功 ——
   * 用户点了「重新登录」，面板立刻自己关掉，还把 `loginState: 'success'`
   * 写回台账。台账从此记录着一场没发生的登录，比什么都不做更坏。
   */
  reloginDomains?: string[];
  /**
   * cookie 清完了。父组件据此改台账：本人 + 受牵连的兄弟平台都变成「已失效」。
   *
   * 返回 Promise 时会被等待 —— 台账必须先落定，探测才能开始，否则「已退出」
   * 可能盖在「登录成功」上面。
   */
  onReloginCleared?: () => void | Promise<void>;
  /** 退出接管：回账号清单。 */
  onClose: () => void;
}

/**
 * 登录接管：整个运营台面板让给浏览器。
 *
 * **为什么是接管而不是内联小卡**：原生 webview 是 OS 级浮层，位置来自
 * `getBoundingClientRect`，CSS 的 `overflow: hidden` 裁不到它。内联小卡一旦
 * 比可视区高，webview 就会浮到面板外面去盖住别的东西。接管让浏览器容器正好
 * 填满面板，矩形就落在面板里。
 *
 * **为什么带 workspace 不带 sessionId**：带 workspace 走的是这个工作区自己的
 * 浏览器 profile（cookie 与该工作区的聊天浏览器面板通用，所以用户在那边登录
 * 过这里也是登录态）；不带 sessionId 意味着这个浏览器**不归任何聊天会话**，
 * Agent 的 `hamuna browser` 摸不到它 —— 登录页不该被 Agent 拿去打字。
 */
export function OpsAccountLogin({
  workspace,
  platform,
  reloginDomains,
  onReloginCleared,
  onClose,
}: OpsAccountLoginProps) {
  const { t } = useTranslation('chat');
  const toast = useToastOptional();
  const [browserAlive, setBrowserAlive] = useState(false);
  /**
   * 「可以开始判登录了」没？
   *
   * 重新登录时它要等 cookie 清完、登录页重开之后才为真。在那之前到达的
   * URL / DOM 读数都还带着**旧会话**的痕迹 —— 判出来的「已登录」是上一场
   * 会话的残留，正是「重新登录点了等于没点」的根因。
   *
   * 由 props 派生而不是 effect 里 set：第一次登录（没有 `reloginDomains`）
   * 从第一帧就该是就绪的，多绕一圈 effect 只会多一帧「未就绪」。
   */
  const needsRelogin = Boolean(reloginDomains?.length);
  const [reloginCleared, setReloginCleared] = useState(false);
  const ready = !needsRelogin || reloginCleared;
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  /** 清 cookie 只做一次：依赖里混着 `t` 之类的会变的值，靠它挡住重复执行。 */
  const reloginStartedRef = useRef(false);

  // 页面当前 URL。只给选择器判定的平台用（免得探针在非 http 页面上报成功），
  // 也不能进 state —— 每次导航都重渲染整个接管视图没必要。
  const currentUrlRef = useRef('');

  // 回调与入参放进 ref：父组件每次渲染都给出新函数，而下面的「清 cookie」
  // effect 只该跑一次。ref 让 effect 的依赖保持稳定。
  const reloginDomainsRef = useRef(reloginDomains);
  const onReloginClearedRef = useRef(onReloginCleared);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    reloginDomainsRef.current = reloginDomains;
    onReloginClearedRef.current = onReloginCleared;
    onCloseRef.current = onClose;
  });

  const writeLoginState = useCallback(
    async (loginState: OpsLoginState) => {
      try {
        await opsUpsert(workspace, {
          kind: 'account',
          platform: platform.id,
          loginState,
          // 与 Rust 的 `now_iso()` 同一个格式（ISO 8601，毫秒，Z）。
          lastCheckedAt: new Date().toISOString(),
        });
      } catch (err) {
        toast?.error(t('ops.account.saveFailed', { message: opsErrorMessage(err) }));
      }
    },
    [workspace, platform.id, toast, t],
  );

  const finishLogin = useCallback(() => {
    onClose();
    void writeLoginState('success');
    toast?.success(t('ops.account.loginSuccess', { platform: platformLabel(t, platform.id) }));
  }, [onClose, writeLoginState, toast, t, platform.id]);

  // URL 驱动的平台走这里。Rust 在 `on_navigation` 与 `on_page_load` 两处都发
  // `browser:url-changed`，所以登录后的跳转一提交就被抓到，不用等控制台加载
  // 完。抖音永远进不到这个分支 —— 见下面的轮询。
  const handleUrlChange = useCallback(
    (url: string) => {
      currentUrlRef.current = url;
      // 重新登录时，cookie 清完之前到达的 URL 一律不看：那时的页面还带着
      // 旧会话，判出来的「已登录」不是这一场登录的结果。
      if (!readyRef.current) return;
      if (needsSelectorProbe(platform)) return;
      if (!resolveLoginState(platform, { url })) return;
      finishLogin();
    },
    [platform, finishLogin],
  );

  /**
   * 重新登录：先清登录态，再重新打开登录页。
   *
   * **顺序不能反**。清 cookie 必须等 webview 建起来（jar 在那儿），探测必须
   * 等清完 —— 中间这段就是 `ready` 的职责。
   *
   * 清完还要**再导航一次登录页**：光清 cookie 不够，当前页面还是上一场会话
   * 渲染出来的创作者后台，用户看到的是「已经登录的后台」，没有二维码可扫。
   */
  useEffect(() => {
    if (!browserAlive || !needsRelogin || reloginCleared) return;
    if (reloginStartedRef.current) return;
    reloginStartedRef.current = true;

    const domains = reloginDomainsRef.current ?? [];
    const tabId = `ops-login-${platform.id}`;
    // 清掉之前记下的 URL：那是上一场会话的页面，拿它判登录就是判错。
    currentUrlRef.current = '';
    void (async () => {
      try {
        await invoke('cmd_browser_clear_login_cookies', { tabId, domains });
        await invoke('cmd_browser_navigate', { tabId, url: platform.loginUrl });
        // 台账先落定（「已退出」），探测才开始 —— 反过来的话，「已退出」可能
        // 盖在「登录成功」上面，台账最后记的是没发生过的那一场。
        await onReloginClearedRef.current?.();
        setReloginCleared(true);
      } catch (err) {
        // 清不掉就别让人白扫一次码：会话还在，退回账号清单，台账原样不动
        // （说「已退出」而其实没退出，比不说更糟）。
        console.error('[ops] 重新登录：清理登录态失败', err);
        toast?.error(t('ops.account.reloginFailed', { message: opsErrorMessage(err) }));
        onCloseRef.current();
      }
    })();
  }, [browserAlive, needsRelogin, reloginCleared, platform.id, platform.loginUrl, toast, t]);

  // 补一下 ready 之前被丢掉的那个 URL。清 cookie + 重开登录页 + 写台账这段
  // 里页面可能已经跳到了工作台，那条 `browser:url-changed` 被上面的门挡掉了；
  // 不回头看一次，这次登录就会永远等不到下一个事件。
  useEffect(() => {
    if (!ready) return;
    if (needsSelectorProbe(platform)) return;
    if (!currentUrlRef.current) return;
    if (resolveLoginState(platform, { url: currentUrlRef.current })) finishLogin();
  }, [ready, platform, finishLogin]);

  // 选择器驱动的平台：抖音扫码前后 URL 一模一样，没有事件可听。问两样东西：
  //
  // 1. **cookie**（权威）。登录态的权威是浏览器 cookie，登录成功那一刻 cookie
  //    已经写进 jar，而页面正在导航（`/` → `/creator-micro/home`）—— DOM 探针
  //    在被销毁的上下文里会抛，读回来的 `false` 与「没登录」分不开。抖音的
  //    `sessionid` 还是 HttpOnly 的，`document.cookie` 根本看不到它。
  // 2. **DOM**（兜底）。cookie 还没种下时用登录后元素 + 登录墙消失这对手性
  //    信号（Easel 的 `douyin_publish.py` 判的是同一对）。
  useEffect(() => {
    // `ready` 之前不开探针：重新登录时那会儿 jar 里还留着旧会话，
    // 探针会立刻读到上一场登录的 cookie。
    if (!ready) return;
    if (!needsSelectorProbe(platform)) return;

    const tabId = `ops-login-${platform.id}`;
    let stopped = false;
    let timer: number | undefined;

    const probe = async () => {
      try {
        // cookie 优先：命中就是登录成功，直接收工。
        if (platform.loggedInCookieNames?.length) {
          const found = await invoke<string[]>('cmd_browser_cookie_names', {
            tabId,
            url: platform.loginUrl,
            names: platform.loggedInCookieNames,
          });
          if (stopped) return;
          if (found.length > 0) {
            stopped = true;
            finishLogin();
            return;
          }
        }

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
          finishLogin();
          return;
        }
      } catch (err) {
        // webview 还在启动 / 正在导航：正在被替换的上下文里 `querySelectorAll`
        // 会抛。继续问。
        //
        // 但**不能把失败吞掉** —— 2026-11 那次「登录成功却一直停在创作者中心」
        // 就是被这里的空 `catch {}` 变成完全不可见的：判定永远不成立，界面上
        // 只表现为「用户没扫码成功」。日志走 renderer 的 console 通道，
        // 会落进统一日志。
        console.warn('[ops] 登录探针失败，继续重试', err);
      }
      if (!stopped) timer = window.setTimeout(probe, LOGIN_POLL_MS);
    };

    // 立刻问一次，而不是先等一个轮询周期：用户可能本来就是已登录态（重新
    // 接管一个已登录的平台），没必要让他对着创作者中心白等 2 秒。
    void probe();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [ready, platform, finishLogin]);

  // 超时作废：写「已失效」而不是留着「已登录」。留着的后果是 Agent 拿着一份
  // 过期的确认去发布，发布到一半才发现要重新登录。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onClose();
      void writeLoginState('expired');
      toast?.error(t('ops.account.loginTimeout'));
    }, LOGIN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onClose, writeLoginState, toast, t]);

  return (
    <div className="ops-takeover">
      <div className="ops-takeover-head">
        <span className="ops-takeover-title">
          {t('ops.account.loginTitle', { platform: platformLabel(t, platform.id) })}
        </span>
        <span className="ops-takeover-hint">{t('ops.account.loginHint')}</span>
      </div>

      <div className="ops-takeover-web">
        <Suspense fallback={null}>
          <LazyBrowserPanel
            // 按平台重挂：Rust 用 tabId 给原生 webview 建索引，同一个 id 还活着
            // 时再建一次会被拒。
            key={platform.id}
            tabId={`ops-login-${platform.id}`}
            url={platform.loginUrl}
            // 这个工作区自己的浏览器 profile：登录态因此只在本工作区有效。
            workspace={workspace}
            isVisible
            isDraggingSplit={false}
            // 一次只开一个页面：下面的探针问的是「这个属主选中的那个标签」，
            // 多开一个标签会把选择权从登录页上抢走，探针就永远看不到登录态。
            singleTab
            onBrowserCreated={() => setBrowserAlive(true)}
            onCreateFailed={onClose}
            onClose={onClose}
            onUrlChange={handleUrlChange}
          />
        </Suspense>
      </div>
    </div>
  );
}
