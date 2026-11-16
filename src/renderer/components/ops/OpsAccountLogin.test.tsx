import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { getSocialPlatform } from '../../../shared/socialPlatforms';
import { OpsAccountLogin } from './OpsAccounts';

// 登录接管的回归护栏。
//
// 这条线上的事故是「抖音扫码成功了，运营台却一直停在创作者中心，台账里
// `accounts: []`」。根因不是没拿到 cookie —— cookie 早就写进 jar 了
// （`sessionid`，HttpOnly，域 `.douyin.com`）——而是**判定没认出来**：
//
// 1. 抖音扫码前后 URL 一模一样，URL 判定对它无意义；
// 2. 登录成功那刻页面导航（`/` → `/creator-micro/home`），DOM 探针在正被
//    销毁的 JS 上下文里会抛，读回来的 `false` 与「确实没登录」分不开；
// 3. `sessionid` 是 HttpOnly 的，`document.cookie` 根本读不到。
//
// 所以：**cookie 是权威判据，DOM 只是兜底**。下面第一条测试钉的就是这条
// 优先级 —— cookie 命中就收工，哪怕 DOM 探针会说「没登录」。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

// 原生 webview 在 dom 里不存在。替身只要在挂载后告诉组件「浏览器建好了」，
// 让登录探针开跑。
vi.mock('@/components/BrowserPanel', async () => {
  const React = await import('react');
  function BrowserPanelMock(props: Record<string, unknown>) {
    const onBrowserCreated = props.onBrowserCreated as (() => void) | undefined;
    React.useEffect(() => {
      onBrowserCreated?.();
    }, [onBrowserCreated]);
    return React.createElement('div', { 'data-testid': 'browser-panel' });
  }
  return { default: BrowserPanelMock };
});

const WORKSPACE = '/ws/sino';
const douyin = getSocialPlatform('douyin');

/** 写台账的那次 invoke。 */
function upsertCall() {
  return mocks.invoke.mock.calls.find((call) => call[0] === 'cmd_ops_upsert');
}

/** 查 cookie 的那次 invoke。 */
function cookieCall() {
  return mocks.invoke.mock.calls.find((call) => call[0] === 'cmd_browser_cookie_names');
}

function renderLogin(onClose = vi.fn()) {
  render(
    <OpsAccountLogin workspace={WORKSPACE} platform={douyin} onClose={onClose} />,
  );
  return onClose;
}

describe('OpsAccountLogin 登录接管', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'cmd_browser_cookie_names':
          return [];
        case 'cmd_browser_query_visible':
          return false;
        case 'cmd_ops_upsert':
          return { state: {}, id: 'acc-douyin' };
        default:
          return null;
      }
    });
    await i18n.changeLanguage('zh-CN');
  });

  it('cookie 命中就是登录成功：退出浏览器页并把登录态写回台账', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'cmd_browser_cookie_names') return ['sessionid'];
      if (cmd === 'cmd_ops_upsert') return { state: {}, id: 'acc-douyin' };
      return null;
    });
    const onClose = renderLogin();

    await screen.findByTestId('browser-panel');

    // cookie 判定走的是平台声明的判据（抖音 = sessionid），查的是平台登录域。
    await waitFor(() => expect(cookieCall()).toBeTruthy());
    expect(cookieCall()?.[1]).toMatchObject({
      url: douyin.loginUrl,
      names: ['sessionid'],
    });

    // 命中即成功：关掉接管视图 + 写回台账。
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => {
      const call = upsertCall();
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toMatchObject({
        kind: 'account',
        platform: 'douyin',
        loginState: 'success',
      });
    });
  });

  it('cookie 没命中才轮到 DOM 探针，DOM 说登录了也算成功', async () => {
    // DOM 兜底要的是「登录后元素可见 + 登录墙不可见」这对手性信号：
    // 第一次问的是 loggedInSelector（可见），第二次是 loggedOutSelector（不可见）。
    let domProbe = 0;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'cmd_browser_cookie_names') return [];
      if (cmd === 'cmd_browser_query_visible') {
        domProbe += 1;
        return domProbe === 1;
      }
      if (cmd === 'cmd_ops_upsert') return { state: {}, id: 'acc-douyin' };
      return null;
    });
    const onClose = renderLogin();

    await screen.findByTestId('browser-panel');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => {
      const call = upsertCall();
      expect(call?.[1]?.item).toMatchObject({
        platform: 'douyin',
        loginState: 'success',
      });
    });
  });

  it('cookie 与 DOM 都没命中时不下结论（用户还没扫码）', async () => {
    const onClose = renderLogin();

    await screen.findByTestId('browser-panel');
    await waitFor(() => expect(cookieCall()).toBeTruthy());

    // 探针在跑，但没判定成功 → 不关页面、不写台账。
    expect(onClose).not.toHaveBeenCalled();
    expect(upsertCall()).toBeFalsy();
  });
});
