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

function stateWithIdeaTopic(): OpsState {
  return {
    ...emptyOpsState(),
    topics: [
      {
        id: 't1',
        title: '出租屋灯光改造',
        note: '',
        angle: '同角度上一篇跑到 8,412',
        platform: 'xiaohongshu',
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
    mocks.invoke.mockResolvedValue(stateWithIdeaTopic());
    renderPanel(onSendToAgent);

    await user.click(await screen.findByRole('button', { name: '开工' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: /视频 · 按产品生成/ }));
    await user.click(screen.getByRole('radio', { name: '9:16' }));
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    const [call] = upsertCalls();
    expect(call.workspace).toBe(WORKSPACE);
    expect(call.item.kind).toBe('topic');
    expect(call.item.id).toBe('t1');
    expect(call.item.status).toBe('planned');
    expect(call.item.form).toBe('video_aigc');
    expect(call.item.formAspect).toBe('9:16');

    // 派工在记账之后发生，而且带上形态——Agent 才知道要做视频还是图文。
    await waitFor(() => expect(onSendToAgent).toHaveBeenCalledTimes(1));
    const brief = onSendToAgent.mock.calls[0][0] as string;
    expect(brief).toContain('出租屋灯光改造');
    expect(brief).toContain('9:16');
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
    await waitFor(() => expect(upsertCalls()).toHaveLength(1));
    const [call] = upsertCalls();
    expect(call.item.form).toBe('text_only');
    expect(call.item.formAspect).toBeNull();
  });

  it('写失败就不派工，对话框留着输入', async () => {
    const user = userEvent.setup();
    const onSendToAgent = vi.fn();
    mocks.invoke.mockResolvedValueOnce(stateWithIdeaTopic()).mockRejectedValueOnce(
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
