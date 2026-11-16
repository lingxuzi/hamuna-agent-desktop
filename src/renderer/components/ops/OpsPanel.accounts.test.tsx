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

async function openAccounts() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByRole('button', { name: '账号' }));
  return user;
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

    await user.click((await screen.findAllByRole('button', { name: '重新登录' }))[0] as HTMLElement);
    await waitFor(() => expect(mocks.browserProps).toBeTruthy());

    // 登录页导航到工作台 = 登录成功（小红书是 URL 判定的平台）。
    act(() => {
      (mocks.browserProps?.onUrlChange as (url: string) => void)(
        'https://creator.xiaohongshu.com/new/home',
      );
    });

    await waitFor(() => {
      const call = upsertCall();
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toMatchObject({
        kind: 'account',
        platform: 'xiaohongshu',
        loginState: 'success',
      });
    });
  });

  it('接管浏览器用的是这个工作区的浏览器 profile，且不挂到聊天会话上', async () => {
    const user = await openAccounts();
    await user.click((await screen.findAllByRole('button', { name: '重新登录' }))[0] as HTMLElement);
    await waitFor(() => expect(mocks.browserProps).toBeTruthy());

    expect(mocks.browserProps?.workspace).toBe(WORKSPACE);
    // 不带 sessionId：这个浏览器不归任何聊天会话，Agent 的 hamuna browser
    // 摸不到它 —— 登录页不该被 Agent 拿去打字。
    expect(mocks.browserProps?.sessionId).toBeUndefined();
  });
});
