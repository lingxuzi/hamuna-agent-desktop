import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// The panel's whole job is "read the ledger, derive four domains, render them".
// Two states matter and they fail differently:
//   · empty  — a fresh sino workspace. Every domain must still render (Hero,
//              cards, rail) instead of collapsing to nothing or to a spinner.
//   · filled — the real shape. The review domain is the only one with a chart
//              and an advice card; if those silently disappear the panel looks
//              fine while hiding the numbers the user came for.
//
// Write path (Phase 6): the two acceptance cases from the plan — a save that
// succeeds (payload goes to `cmd_ops_upsert`) and a save that fails (the form
// must stay open with the input intact and the error visible).

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

function stateWithData(): OpsState {
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
    assets: [
      {
        id: 'a1',
        topicId: 't1',
        title: '出租屋灯光改造 · 第二期',
        body: '',
        product: '',
        cta: '',
        sourceRef: null,
        cover: null,
        images: [],
        shots: [],
        platform: 'xiaohongshu',
        scheduledAt: '2026-11-18T20:00:00',
        status: 'ready',
        publishedAt: null,
        platformWorkId: null,
        progress: 80,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
      },
    ],
    reviews: [
      {
        id: 'r1',
        assetId: 'a1',
        platform: 'xiaohongshu',
        publishedAt: '2026-11-12T08:00:00.000Z',
        metrics: {
          views: 12847,
          likes: 900,
          comments: 120,
          shares: 60,
          saves: 300,
          completionRate: 0.41,
          followers: 62,
        },
        note: '',
        createdAt: '2026-11-12T08:00:00.000Z',
      },
    ],
    rules: [
      {
        id: 'rule1',
        name: '标题里写清数字',
        rule: '封面写清数字的笔记点击率是 1.8 倍。',
        source: 'reflection',
        status: 'active',
        confidence: 0.8,
        evidence: '',
        createdAt: '2026-11-12T00:00:00.000Z',
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

describe('OpsPanel', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    await i18n.changeLanguage('zh-CN');
  });

  it('renders all four domains against an empty ledger', async () => {
    mocks.invoke.mockResolvedValue(emptyOpsState());
    renderPanel();

    // Every domain keeps its shell — an empty ledger is a normal first-run
    // state, not an error, so the panel must not fall back to the spinner.
    for (const label of ['选题', '素材', '排期', '复盘']) {
      expect(await screen.findByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText(/正在读取运营台账/)).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith('cmd_ops_read', { workspace: WORKSPACE });
  });

  it('renders derived numbers, the trend chart and the advice card when filled', async () => {
    mocks.invoke.mockResolvedValue(stateWithData());
    renderPanel();

    // Hero sentence carries the topic count.
    await waitFor(() => expect(screen.getByRole('tab', { name: '选题' })).toHaveAttribute('aria-selected', 'true'));
    // The title legitimately shows up three times: hero sentence, pool row,
    // and the dark lead card. Asserting a single node would be wrong here.
    expect(screen.getAllByText('出租屋灯光改造').length).toBeGreaterThanOrEqual(2);

    // Review domain is the only one with a chart + advice card.
    screen.getByRole('tab', { name: '复盘' }).click();
    await waitFor(() => expect(screen.getByText('每日发布表现')).toBeInTheDocument());
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByText('标题里写清数字')).toBeInTheDocument();
    expect(screen.getAllByText(/12,847/).length).toBeGreaterThan(0);
  });

  it('saves a new topic through cmd_ops_upsert and shows the success toast', async () => {
    const user = userEvent.setup();
    mocks.invoke
      .mockResolvedValueOnce(emptyOpsState()) // initial read
      .mockResolvedValueOnce({ state: emptyOpsState(), id: 'topic-new' }); // upsert
    renderPanel();

    const add = await screen.findByRole('button', { name: '手动加选题' });
    await user.click(add);

    await screen.findByRole('dialog', { name: '新建选题' });
    await user.type(screen.getByLabelText('标题'), '出租屋灯光改造 · 第三期');
    await user.click(screen.getByRole('button', { name: '保存' }));

    // The upsert must be a patch with the typed fields, no fabricated ids.
    await waitFor(() => {
      const upsert = mocks.invoke.mock.calls.find(([cmd]) => cmd === 'cmd_ops_upsert');
      expect(upsert).toBeDefined();
      const [, args] = upsert as unknown as [string, { workspace: string; item: Record<string, unknown> }];
      expect(args.workspace).toBe(WORKSPACE);
      expect(args.item.kind).toBe('topic');
      expect(args.item.title).toBe('出租屋灯光改造 · 第三期');
      expect(args.item.id).toBeUndefined();
    });
    expect(await screen.findByText('已加入选题池')).toBeInTheDocument();
    // Success closes the form.
    expect(screen.queryByRole('dialog', { name: '新建选题' })).not.toBeInTheDocument();
  });

  it('keeps the form open with input intact when the save fails', async () => {
    const user = userEvent.setup();
    mocks.invoke
      .mockResolvedValueOnce(emptyOpsState()) // initial read
      .mockRejectedValueOnce(new Error('file lock busy')); // failing upsert
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '手动加选题' }));
    await screen.findByRole('dialog', { name: '新建选题' });
    await user.type(screen.getByLabelText('标题'), '早睡挑战 3.0');
    await user.click(screen.getByRole('button', { name: '保存' }));

    // Error is visible (raw reason inside the form), the dialog did NOT close,
    // the input survived.
    expect(await screen.findByText('file lock busy')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '新建选题' })).toBeInTheDocument();
    expect(screen.getByLabelText('标题')).toHaveValue('早睡挑战 3.0');
    // No success toast leaked out of a failed save.
    expect(screen.queryByText('已加入选题池')).not.toBeInTheDocument();
  });

  it('activates a proposed rule in place from the advice card', async () => {
    const user = userEvent.setup();
    const stateWithProposed = {
      ...stateWithData(),
      rules: [{ ...stateWithData().rules[0], status: 'proposed' as const }],
    };
    mocks.invoke
      .mockResolvedValueOnce(stateWithProposed) // initial read
      .mockResolvedValueOnce({ state: stateWithProposed, id: 'rule1' }); // rule upsert
    renderPanel();

    screen.getByRole('tab', { name: '复盘' }).click();
    await screen.findByText('标题里写清数字');

    await user.click(screen.getByRole('button', { name: '写进规则' }));
    await waitFor(() => {
      const upsert = mocks.invoke.mock.calls.find(([cmd]) => cmd === 'cmd_ops_upsert');
      expect(upsert).toBeDefined();
      const [, args] = upsert as unknown as [string, { item: Record<string, unknown> }];
      expect(args.item).toMatchObject({ kind: 'rule', id: 'rule1', status: 'active' });
    });
  });
});
