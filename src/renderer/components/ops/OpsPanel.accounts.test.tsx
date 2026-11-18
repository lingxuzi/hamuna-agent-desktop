import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 账号视图的回归护栏。
//
// 这条线最要紧的一条不变量：**账号是工作区级的**。台账落在 `ops/state.json`
// 里，而那个文件在工作区目录下。写错工作区 = 把 A 账号体系的号写进 B 工作区
// 的台账 —— 表面上登录态没串（cookie 是分 profile 的），台账却串了：界面上
// 显示「已登录」，真正发布时那个工作区的浏览器根本不是这个号。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
  browserProps: null as Record<string, unknown> | null,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));
// 浏览器面板是原生 webview，dom 里没有。替换成一个只把 props 记下来的壳，
// 这样测试能直接驱动「页面报了个新 URL」这条登录成功路径。
vi.mock('@/components/BrowserPanel', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.browserProps = props;
    return <div data-testid="browser-panel" />;
  },
}));

const WORKSPACE = '/ws/sino';

function stateWithAccounts(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    accounts: [
      {
        id: 'acc-xiaohongshu',
        platform: 'xiaohongshu',
        displayName: '露营装备小王',
        loginState: 'success',
        lastCheckedAt: '2026-11-10T08:00:00.000Z',
        createdAt: '2026-11-10T08:00:00.000Z',
        updatedAt: '2026-11-10T08:00:00.000Z',
      },
      {
        id: 'acc-douyin',
        platform: 'douyin',
        displayName: '',
        loginState: 'expired',
        lastCheckedAt: null,
        createdAt: '2026-11-10T08:00:00.000Z',
        updatedAt: '2026-11-10T08:00:00.000Z',
      },
    ],
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
}

/** 找到写台账的那次 invoke。 */
function upsertCall() {
  return mocks.invoke.mock.calls.find((call) => call[0] === 'cmd_ops_upsert');
}

/** 把某次写台账的调用按平台取出来（重新登录会连写两条）。 */
function upsertCallsFor(platform: string) {
  return mocks.invoke.mock.calls
    .filter((call) => call[0] === 'cmd_ops_upsert')
    .map((call) => call[1]?.item as Record<string, unknown>)
    .filter((item) => item?.kind === 'account' && item?.platform === platform);
}

function invokeCall(command: string) {
  return mocks.invoke.mock.calls.find((call) => call[0] === command);
}

async function openAccounts() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByRole('button', { name: '账号' }));
  return user;
}

/**
 * 点「重新登录」，走过确认框，等接管视图挂上。
 *
 * 重新登录必须确认 —— 那一步会真的把人登出，且视频号 / 公众号共用的
 * cookie 会让兄弟平台一起掉线。
 */
async function relogin(user: ReturnType<typeof userEvent.setup>, index = 0) {
  await user.click((await screen.findAllByRole('button', { name: '重新登录' }))[index] as HTMLElement);
  await user.click(await screen.findByRole('button', { name: '退出并重新登录' }));
  await waitFor(() => expect(mocks.browserProps).toBeTruthy());
  // 接管视图要等原生 webview 建起来才开始清 cookie —— 真实面板在这一刻回调。
  // 清完还会重开登录页，那之后探针才允许判登录。
  await waitFor(() => {
    act(() => (mocks.browserProps?.onBrowserCreated as () => void)());
    expect(invokeCall('cmd_browser_navigate')).toBeTruthy();
  });
}

describe('OpsPanel 账号视图', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    mocks.browserProps = null;
    mocks.invoke.mockResolvedValue(stateWithAccounts());
    await i18n.changeLanguage('zh-CN');
  });

  it('账号视图列出每个平台与它的登录态', async () => {
    await openAccounts();

    expect(await screen.findByText('账号')).toBeInTheDocument();
    // 七个平台永远都在 —— 没账号不等于没这个平台。
    // 角标与平台名都是平台名（「抖音」的角标就是「抖音」），按卡里的平台名取。
    const names = Array.from(document.querySelectorAll('.ops-acc-card-name')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['小红书', '抖音', '快手', '微信视频号', 'B站', '知乎', '微信公众号']);
    // 登录态按台账里的记录显示，不是一律「未登录」：小红书已登录、
    // 抖音已失效、其余五个还没记录过。
    const cards = Array.from(document.querySelectorAll('.ops-acc-card'));
    expect(cards).toHaveLength(7);
    expect(cards[0]?.querySelector('.ops-acc-state')?.className).toContain('is-success');
    expect(cards[1]?.querySelector('.ops-acc-state')?.className).toContain('is-expired');
    expect(cards[2]?.querySelector('.ops-acc-state')?.className).toContain('is-unknown');
    expect(screen.getByText('已登录')).toBeInTheDocument();
    expect(screen.getByText('已失效')).toBeInTheDocument();
    expect(screen.getAllByText('未登录')).toHaveLength(5);
  });

  it('账号卡的平台字牌用独立类名，不会掉回浏览器默认样式', async () => {
    await openAccounts();

    // 字牌曾经挂在 `.ops-list .thumb` 这条**后代**选择器下：列表里的字牌有样式，
    // 账号卡不在 .ops-list 里，于是平台色点掉回浏览器默认（透明方块 + 无边框），
    // 界面上就是一块灰底方块认不出平台。字牌因此改成独立的 `.ops-thumb`，
    // 样式不再依赖祖先容器 —— 这条断言就是钉住这个类名。
    const thumbs = Array.from(document.querySelectorAll('.ops-acc-card .ops-thumb'));
    expect(thumbs).toHaveLength(7);
    expect(thumbs.map((el) => el.getAttribute('data-platform'))).toEqual([
      'xiaohongshu',
      'douyin',
      'kuaishou',
      'weixin-channels',
      'bilibili',
      'zhihu',
      'wechat-mp',
    ]);
    // 角标是 2–3 个字（「公众号」），塞进 26px 的方块会顶出边框 —— 只取首字。
    expect(thumbs.map((el) => el.textContent)).toEqual(['小', '抖', '快', '视', 'B', '知', '公']);
  });

  it('改账号名写回这个工作区的台账', async () => {
    const user = await openAccounts();

    const inputs = screen.getAllByPlaceholderText('＋ 账号名');
    // 第一张卡是台账里已有名字的小红书，第二张是还没起名字的抖音。
    expect((inputs[0] as HTMLInputElement).value).toBe('露营装备小王');
    await user.clear(inputs[1] as HTMLElement);
    await user.type(inputs[1] as HTMLElement, '露营装备小李');
    await user.tab();

    await waitFor(() => {
      const call = upsertCall();
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toMatchObject({
        kind: 'account',
        platform: 'douyin',
        displayName: '露营装备小李',
      });
    });
  });

  it('登录成功把登录态写回这个工作区的台账', async () => {
    const user = await openAccounts();
    await relogin(user);

    // 登录页导航到工作台 = 登录成功（小红书是 URL 判定的平台）。
    act(() => {
      (mocks.browserProps?.onUrlChange as (url: string) => void)(
        'https://creator.xiaohongshu.com/new/home',
      );
    });

    await waitFor(() => {
      expect(
        upsertCallsFor('xiaohongshu').some((item) => item.loginState === 'success'),
      ).toBe(true);
    });
    const call = upsertCallsFor('xiaohongshu').find((item) => item.loginState === 'success');
    // 工作区级：写进的是当前工作区的台账。
    expect(mocks.invoke.mock.calls.some((c) => c[0] === 'cmd_ops_upsert' && c[1]?.workspace === WORKSPACE)).toBe(true);
    expect(call).toMatchObject({ kind: 'account', platform: 'xiaohongshu', loginState: 'success' });
  });

  it('接管浏览器用的是这个工作区的浏览器 profile，且不挂到聊天会话上', async () => {
    const user = await openAccounts();
    await relogin(user);

    expect(mocks.browserProps?.workspace).toBe(WORKSPACE);
    // 不带 sessionId：这个浏览器不归任何聊天会话，Agent 的 hamuna browser
    // 摸不到它 —— 登录页不该被 Agent 拿去打字。
    expect(mocks.browserProps?.sessionId).toBeUndefined();
  });

  it('重新登录先确认，不点确认就不清 cookie', async () => {
    const user = await openAccounts();

    await user.click((await screen.findAllByRole('button', { name: '重新登录' }))[0] as HTMLElement);
    // 风险要说在前头：两个平台共用 cookie 时还要点名受牵连的那个。
    expect(await screen.findByText(/已保存的登录状态/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    // 取消 = 什么都没发生：不接管、不清 cookie。
    expect(mocks.browserProps).toBeNull();
    expect(invokeCall('cmd_browser_clear_login_cookies')).toBeUndefined();
  });

  it('确认后清掉该平台的 cookie，再重新打开登录页', async () => {
    const user = await openAccounts();
    await relogin(user);

    const clear = invokeCall('cmd_browser_clear_login_cookies');
    expect(clear).toBeTruthy();
    expect(clear?.[1]?.tabId).toBe('ops-login-xiaohongshu');
    // 带父域：小红书的会话 cookie 挂在 `.xiaohongshu.com` 上，只清精确 host
    // 会留下它，重登立刻秒判成功 = 空操作。
    expect(clear?.[1]?.domains).toEqual(
      expect.arrayContaining(['creator.xiaohongshu.com', 'xiaohongshu.com']),
    );

    // 清完还要重开登录页：光清 cookie 不够，页面还停在上一场会话的后台。
    const nav = invokeCall('cmd_browser_navigate');
    expect(nav?.[1]?.url).toBe('https://creator.xiaohongshu.com/login');
  });

  it('清 cookie 之前到达的 URL 不算登录成功', async () => {
    const user = await openAccounts();
    await relogin(user);

    // 页面上还挂着旧会话的后台地址。清 cookie 还没跑完，这条读数不作数。
    act(() => {
      (mocks.browserProps?.onUrlChange as (url: string) => void)(
        'https://creator.xiaohongshu.com/new/home',
      );
    });

    expect(
      upsertCallsFor('xiaohongshu').some((item) => item.loginState === 'success'),
    ).toBe(false);
  });

  it('清掉共用 cookie 时，兄弟平台的台账一并标成已失效', async () => {
    // 视频号与公众号都在 weixin.qq.com 下，清一个另一个必然掉线。
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'cmd_ops_upsert') return { state: stateWithAccounts(), id: 'x' };
      return {
        ...stateWithAccounts(),
        accounts: [
          ...stateWithAccounts().accounts,
          {
            id: 'acc-channels',
            platform: 'weixin-channels',
            displayName: '',
            loginState: 'success',
            lastCheckedAt: null,
            createdAt: '2026-11-10T08:00:00.000Z',
            updatedAt: '2026-11-10T08:00:00.000Z',
          },
          {
            id: 'acc-mp',
            platform: 'wechat-mp',
            displayName: '',
            loginState: 'success',
            lastCheckedAt: null,
            createdAt: '2026-11-10T08:00:00.000Z',
            updatedAt: '2026-11-10T08:00:00.000Z',
          },
        ],
      };
    });

    const user = await openAccounts();
    // 第 4 张卡是视频号。
    await relogin(user, 3);

    await waitFor(() => {
      expect(upsertCallsFor('wechat-mp').some((item) => item.loginState === 'expired')).toBe(true);
    });
    expect(upsertCallsFor('weixin-channels').some((item) => item.loginState === 'expired')).toBe(true);
    // 不相干的平台不该被牵连。
    expect(upsertCallsFor('xiaohongshu')).toHaveLength(0);
  });
});
