import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 评论线索视图的回归护栏。
//
// 线索是**观众在我们自己作品下面说的话**——台账里唯一还缺的输入信号。
// 人在这一页只有两个动作：标状态、删。所以这两条写入路径就是这页的全部契约：
// 标状态必须只发状态这一个字段（补丁语义：Rust 锁内合并，没发的键保留旧值），
// 删除必须带着正确的 kind 走同一个删除入口。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

function stateWithClues(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    assets: [
      {
        id: 'a1',
        topicId: null,
        title: '出租屋灯光改造',
        body: '',
        product: '',
        cta: '',
        sourceRef: null,
        cover: null,
        images: [],
        shots: [],
        platform: 'xiaohongshu',
        scheduledAt: null,
        status: 'published',
        publishedAt: '2026-11-10T00:00:00.000Z',
        platformWorkId: null,
        progress: 100,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    ],
    clues: [
      {
        id: 'clue-1',
        platform: 'xiaohongshu',
        assetId: 'a1',
        commentId: 'c-1',
        parentCommentId: null,
        authorUid: 'u-1',
        authorName: '露营小王',
        content: '这个折叠桌多少钱？',
        intent: 'price',
        status: 'new',
        note: '',
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

function callOf(command: string) {
  return mocks.invoke.mock.calls.find((call) => call[0] === command);
}

function upsertCall() {
  return callOf('cmd_ops_upsert');
}

function deleteCall() {
  return callOf('cmd_ops_delete');
}

async function openClues() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByRole('button', { name: '线索' }));
  return user;
}

describe('OpsPanel 线索视图', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    mocks.invoke.mockResolvedValue(stateWithClues());
    await i18n.changeLanguage('zh-CN');
  });

  it('线索页列出评论内容、作者、意图与关联的素材', async () => {
    await openClues();

    expect(await screen.findByText('评论线索')).toBeInTheDocument();
    expect(screen.getByText('这个折叠桌多少钱？')).toBeInTheDocument();
    // 副文本是「作者 · 平台 · 意图 · 关联素材」拼成的一行，用正则取片段。
    expect(screen.getByText(/露营小王/)).toBeInTheDocument();
    expect(screen.getByText(/问价格/)).toBeInTheDocument();
    // 线索挂在哪条作品下面，人不看到就不知道该去看哪条内容的评论。
    expect(screen.getByText(/关联：出租屋灯光改造/)).toBeInTheDocument();
    // 「刚采到」是状态机的起点：点一次推到「值得跟进」。
    expect(screen.getByRole('button', { name: '刚采到' })).toBeInTheDocument();
  });

  it('标状态只写状态这一个字段，别的字段由 Rust 侧保留', async () => {
    const user = await openClues();

    await user.click(await screen.findByRole('button', { name: '刚采到' }));

    await waitFor(() => {
      const call = upsertCall();
      expect(call).toBeTruthy();
      expect(call?.[1]?.workspace).toBe(WORKSPACE);
      expect(call?.[1]?.item).toEqual({
        kind: 'clue',
        id: 'clue-1',
        status: 'qualified',
      });
    });
  });

  it('删线索走确认框，确认后按 clue 这个 kind 删', async () => {
    const user = await openClues();

    await user.click(await screen.findByRole('button', { name: '删掉这条线索' }));
    // 没确认就不删：台账是唯一写者，误删没有撤销。
    expect(deleteCall()).toBeFalsy();
    await user.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(() => {
      const call = deleteCall();
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({
        workspace: WORKSPACE,
        kind: 'clue',
        id: 'clue-1',
      });
    });
  });
});
