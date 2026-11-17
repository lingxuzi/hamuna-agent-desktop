import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 对标账号卡的回归护栏。
//
// 这条线最要紧的一条不变量：**对标账号必须长在方向域里**。它是方向的参照系，
// 脱离方向单独列一张「我关注了谁」的清单，下一步选题时没人会去看它 —— 上一个
// 坑正是「ops-topic 的输入源表写着『对标账号的公开内容』，但全仓没有任何地方
// 告诉 agent 该对标哪些账号」。
//
// 第二条：**主页链接是天然键的一半**。没它这条记录下次认不回来（重复采集会
// 变成两条），所以表单不给提交。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

function stateWithBenchmark(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    directions: [
      {
        id: 'dir-douyin',
        platform: 'douyin',
        brief: '想让人记住我们懂露营装备',
        positioning: '白天露营装备实测',
        audience: '刚买第一套装备的入门者',
        pillars: ['装备实测', '避坑'],
        goal: '涨粉',
        cadence: '每周 3 条',
        status: 'active',
        proposal: null,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
        finalizedAt: '2026-11-10T00:00:00.000Z',
      },
    ],
    benchmarks: [
      {
        id: 'bm-1',
        platform: 'xiaohongshu',
        name: '露营老张',
        profileUrl: 'https://www.xiaohongshu.com/user/profile/lzycamp',
        why: '同样做入门装备实测，受众重合',
        evidence: '2026-11-16 公开页读到 38.2w 粉',
        source: 'agent',
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
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

function upsertCall() {
  return mocks.invoke.mock.calls.find((call) => call[0] === 'cmd_ops_upsert');
}

async function openDirection() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByRole('tab', { name: '方向' }));
  return user;
}

describe('OpsPanel 对标账号卡', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    mocks.invoke.mockResolvedValue(stateWithBenchmark());
    await i18n.changeLanguage('zh-CN');
  });

  it('方向域里画出对标账号：名字、主页、为什么、证据与来源', async () => {
    await openDirection();

    expect(await screen.findByText('对标账号')).toBeInTheDocument();
    expect(screen.getByText('露营老张')).toBeInTheDocument();
    expect(
      screen.getByText('https://www.xiaohongshu.com/user/profile/lzycamp'),
    ).toBeInTheDocument();
    expect(screen.getByText('同样做入门装备实测，受众重合')).toBeInTheDocument();
    expect(screen.getByText('2026-11-16 公开页读到 38.2w 粉')).toBeInTheDocument();
    // 来源要分得清：用户给的对标 = 用户的话本身是授权；Agent 找的 = 还要人点头。
    expect(screen.getByText('Agent 找的')).toBeInTheDocument();
  });

  it('加对标账号写回台账，主页链接是天然键', async () => {
    const user = await openDirection();

    await user.click(await screen.findByRole('button', { name: '加对标账号' }));
    await screen.findByRole('dialog');

    await user.type(screen.getByPlaceholderText('对方的昵称'), '露营小李');
    await user.type(screen.getByPlaceholderText('https://…'), 'https://www.douyin.com/user/MS4wLj');
    await user.type(screen.getByPlaceholderText('定位上的相似点，不是「内容好」'), '同样讲新手避坑');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const call = upsertCall();
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toMatchObject({
        kind: 'benchmark',
        platform: 'xiaohongshu',
        name: '露营小李',
        profileUrl: 'https://www.douyin.com/user/MS4wLj',
        why: '同样讲新手避坑',
        source: 'user',
      });
    });
  });

  it('没填主页链接不给提交：没它这条记录下次认不回来', async () => {
    const user = await openDirection();

    await user.click(await screen.findByRole('button', { name: '加对标账号' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByPlaceholderText('对方的昵称'), '露营小李');

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
  });
});
