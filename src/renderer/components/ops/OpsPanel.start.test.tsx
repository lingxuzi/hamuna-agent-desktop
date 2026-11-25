/**
 * 「开工」这条链：人选形态 → 一次写全台账 → 派工生成。
 *
 * 三件事各自会独立地坏：
 *
 *  1. **写两遍**。状态、形态、画幅分三次写，中间崩掉就留下「已开工但没形态」
 *     的记录——那种记录既不能再开工，也不能做稿。所以必须一次写入。
 *  2. **先派工后记账**。派工先走、记账后失败 = 钱已经花了，台账里却查不到
 *     这一轮做过什么。顺序必须反过来。
 *  3. **写失败还派工**。台账没写成功，Agent 却开始生成，成品没有归属。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

function stateWithIdeaTopic(platform: 'xiaohongshu' | 'douyin' = 'xiaohongshu'): OpsState {
  return {
    ...emptyOpsState(),
    topics: [
      {
        id: 't1',
        title: '出租屋灯光改造',
        note: '',
        angle: '同角度上一篇跑到 8,412',
        platform,
        tags: [],
        status: 'idea',
        source: 'hotspot',
        sourceRefs: [],
        hotness: 86000,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    ],
  };
}

function renderPanel(onSendToAgent: (text: string) => void = vi.fn()) {
  return render(
    <ToastProvider>
      <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={onSendToAgent} />
    </ToastProvider>,
  );
}

/** 取出这次写台账的载荷。 */
function upsertCalls(): { workspace: string; item: Record<string, unknown> }[] {
  return mocks.invoke.mock.calls
    .filter(([cmd]) => cmd === 'cmd_ops_upsert')
    .map(([, args]) => args as { workspace: string; item: Record<string, unknown> });
}

beforeEach(async () => {
  mocks.invoke.mockReset();
  mocks.listenWithCleanup.mockReset();
  mocks.isTauri = true;
  await i18n.changeLanguage('zh-CN');
});

describe('选题开工', () => {
  it('一次写全状态 / 形态 / 画幅，然后才派工', async () => {
    const user = userEvent.setup();
    const onSendToAgent = vi.fn();
    // 抖音：视频是它独有的通道，xiaohongshu 收不了 video。
    const base = stateWithIdeaTopic('douyin');
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === 'cmd_ops_upsert'
        ? Promise.resolve({ state: base, id: 'asset-1a2b3c4d' })
        : Promise.resolve(base),
    );
    renderPanel(onSendToAgent);

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: /视频 · 按产品生成/ }));
    await user.click(screen.getByRole('radio', { name: '9:16' }));
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    // 两次写：选题（状态 / 形态 / 画幅）+ 素材（id 的落点）。
    await waitFor(() => expect(upsertCalls()).toHaveLength(2));
    const [call, assetCall] = upsertCalls();
    expect(call.workspace).toBe(WORKSPACE);
    expect(call.item.kind).toBe('topic');
    expect(call.item.id).toBe('t1');
    expect(call.item.status).toBe('planned');
    expect(call.item.form).toBe('video_aigc');
    expect(call.item.formAspect).toBe('9:16');

    // 素材记录跟着建出来，挂回这条选题 —— 没有它 Agent 拿到派工也没有落点。
    expect(assetCall.item.kind).toBe('asset');
    expect(assetCall.item.topicId).toBe('t1');
    expect(assetCall.item.platform).toBe('douyin');
    expect(assetCall.item.title).toBe('出租屋灯光改造');

    // 派工在记账之后发生，而且带上形态和素材 id——Agent 才知道做视频、往哪写。
    await waitFor(() => expect(onSendToAgent).toHaveBeenCalledTimes(1));
    const brief = onSendToAgent.mock.calls[0][0] as string;
    expect(brief).toContain('出租屋灯光改造');
    expect(brief).toContain('9:16');
    expect(brief).toContain('asset-1a2b3c4d');
    expect(brief).toContain('produced');
  });

  it('重试开工复用已有素材，不建第二条', async () => {
    // 同一条选题开工两次（换形态 / 上一轮崩了）如果各建一条素材，面板上会挂着
    // 两条同一选题的成品，发布时不知道发哪条，且两条各自推进度。
    const user = userEvent.setup();
    const onSendToAgent = vi.fn();
    const base = stateWithIdeaTopic('douyin');
    mocks.invoke.mockResolvedValue({
      ...base,
      // 上一轮已经开过工：选题停在 planned、素材已建。这正是要复用的那种现场。
      topics: [{ ...base.topics[0], status: 'planned' as const }],
      assets: [
        {
          id: 'asset-existing',
          topicId: 't1',
          title: base.topics[0].title,
          platform: 'douyin' as const,
          body: '',
          product: '',
          cta: '',
          sourceRef: null,
          cover: null,
          images: [],
          video: null,
          shots: [],
          note: '',
          noteSource: null,
          downgradeNote: '',
          status: 'draft' as const,
          progress: 0,
          scheduledAt: null,
          publishedAt: null,
          platformWorkId: null,
          createdAt: '2026-11-10T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
    });
    renderPanel(onSendToAgent);

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: /视频 · 按产品生成/ }));
    await user.click(screen.getByRole('radio', { name: '9:16' }));
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(onSendToAgent).toHaveBeenCalledTimes(1));
    // 只有选题那一次写；素材沿用旧的。
    expect(upsertCalls()).toHaveLength(1);
    expect(upsertCalls()[0].item.kind).toBe('topic');
    expect(onSendToAgent.mock.calls[0][0]).toContain('asset-existing');
  });

  it('纯文字不问画幅', async () => {
    const user = userEvent.setup();
    mocks.invoke.mockResolvedValue(stateWithIdeaTopic());
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: /纯文字/ }));

    // 纯文字没有画面，问画幅就是废动作。
    expect(screen.queryByRole('radio', { name: '9:16' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(upsertCalls()).toHaveLength(2));
    const [call] = upsertCalls();
    expect(call.item.form).toBe('text_only');
    expect(call.item.formAspect).toBeNull();
  });

  it('平台收不了的形态标成不可用，也不让开工', async () => {
    const user = userEvent.setup();
    const onSendToAgent = vi.fn();
    // 小红书只收图文。选视频等于做一批发不出去的素材。
    mocks.invoke.mockResolvedValue(stateWithIdeaTopic('xiaohongshu'));
    renderPanel(onSendToAgent);

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');

    const video = screen.getByRole('radio', { name: /视频 · 按产品生成/ });
    expect(video).toHaveAttribute('aria-disabled', 'true');
    // 两个视频形态都不支持 —— 各占一条提示。
    expect(screen.getAllByText('小红书发不了这种形态')).toHaveLength(2);
    expect(
      screen.getByRole('radio', { name: /图文/ }),
    ).toHaveAttribute('aria-disabled', 'false');

    await user.click(video);
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    // 点了也不派工：这条形态在这个平台上没有发布通道。
    expect(upsertCalls()).toHaveLength(0);
    expect(onSendToAgent).not.toHaveBeenCalled();
  });

  it('写失败就不派工，对话框留着输入', async () => {
    const user = userEvent.setup();
    const onSendToAgent = vi.fn();
    mocks.invoke.mockResolvedValueOnce(stateWithIdeaTopic('douyin')).mockRejectedValueOnce(
      new Error('file lock busy'),
    );
    renderPanel(onSendToAgent);

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: /视频 · 按产品生成/ }));
    await user.click(screen.getByRole('radio', { name: '9:16' }));
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findByText('file lock busy')).toBeInTheDocument();
    // 没记账就不派工：否则钱花了、台账里查不到。
    expect(onSendToAgent).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
