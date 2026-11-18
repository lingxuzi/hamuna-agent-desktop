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
        commentSample: '这个折叠桌多少钱？',
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
        basis: 'verified',
        sampledCount: 12,
        gaps: ['评论只读到前 20 条，共 87 条'],
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

/**
 * 让深墨卡的定位行看起来被截断了。
 *
 * jsdom 不做布局，`scrollHeight` / `clientHeight` 恒为 0，所以「被截断了
 * 吗」这个判断永远答否 —— 展开按钮就永远不出现，测不到。只能把这两个值
 * 造出来。造完必须还原，否则后面所有测试都以为内容被截断。
 */
function simulateClippedLead() {
  const define = (key: 'scrollHeight' | 'clientHeight', value: number) =>
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('name') ? value : 0;
      },
    });
  define('scrollHeight', 120);
  define('clientHeight', 60);
  return () => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  };
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

  it('marks each rule with the kind of evidence it rests on', async () => {
    mocks.invoke.mockResolvedValue(stateWithData());
    renderPanel();

    screen.getByRole('tab', { name: '复盘' }).click();
    await screen.findByText('标题里写清数字');

    // 强度（0.8）在数字上，性质得看得见：「核实过的 0.5」和「推出来的 0.9」
    // 不是一回事，只给强度的话人分不出哪条更该当依据。
    const badge = screen.getByText('已核实');
    expect(badge).toHaveAttribute('data-basis', 'verified');
  });

  it('shows how many samples a rule rests on and what it is still missing', async () => {
    mocks.invoke.mockResolvedValue(stateWithData());
    renderPanel();

    screen.getByRole('tab', { name: '复盘' }).click();
    await screen.findByText('标题里写清数字');

    // 0.8 本身说不出这条结论看了多少东西 —— 分母得看得见。
    expect(screen.getByText('样本 12')).toBeInTheDocument();
    // 缺口是「我没看到什么」的落盘位置：下一轮才知道还欠什么。
    expect(screen.getByText('还缺')).toBeInTheDocument();
    expect(screen.getByText('评论只读到前 20 条，共 87 条')).toBeInTheDocument();
  });

  it('drops a rule whose evidence has expired and says how many are stale', async () => {
    const staleAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const base = stateWithData().rules[0];
    mocks.invoke.mockResolvedValue({
      ...stateWithData(),
      rules: [
        { ...base, id: 'rule-old', name: '两个月前的结论', sampledAt: staleAt },
        { ...base, id: 'rule-new', name: '这周的结论', sampledAt: new Date().toISOString() },
      ],
    });
    renderPanel();

    screen.getByRole('tab', { name: '复盘' }).click();
    await screen.findByText('这周的结论');

    // 依据过期的结论不能继续当建议：它说的是那批数据，不是现在这批。
    expect(screen.queryByText('两个月前的结论')).not.toBeInTheDocument();
    // 但也不能静默消失 —— 人得知道有结论过期了，该去复盘重新验证。
    expect(screen.getByText('1 条结论的依据已过期，不再作为依据。')).toBeInTheDocument();
  });

  it('shows the audience quote that the review rests on', async () => {
    mocks.invoke.mockResolvedValue(stateWithData());
    renderPanel();

    screen.getByRole('tab', { name: '复盘' }).click();

    // 光有「120 条评论」这个数字，谁也没法复核「有多少人问价」——得有原话。
    expect(await screen.findByText('「这个折叠桌多少钱？」')).toBeInTheDocument();
  });

  it('offers the full lead text only while it is actually clipped', async () => {
    const user = userEvent.setup();
    const restore = simulateClippedLead();
    try {
      const state = {
        ...stateWithData(),
        directions: [
          {
            id: 'dir1',
            platform: 'xiaohongshu' as const,
            brief: '想让人记住我们懂露营装备',
            positioning: '出租屋露营装备实测：一个人住也能体面的户外装备清单',
            audience: '独居上班族',
            pillars: ['装备实测'],
            goal: '涨粉',
            cadence: '每周两条',
            status: 'active' as const,
            proposal: null,
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      };
      mocks.invoke.mockResolvedValue(state);
      renderPanel();

      // 定位原文被三行截断时，「展开全文」必须在那儿 —— 原文只存在于这行，
      // 截断了就等于没给。
      const more = await screen.findByRole('button', { name: '展开全文' });
      await user.click(more);

      expect(await screen.findByRole('button', { name: '收起' })).toBeInTheDocument();
      // 展开态把行数限制摘掉。
      expect(document.querySelector('.ops-next .name.open')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('shows no expand button when the lead text fits', async () => {
    mocks.invoke.mockResolvedValue(stateWithData());
    renderPanel();

    // 没得展开还摆个按钮，就是个坏掉的功能。
    expect(screen.queryByRole('button', { name: '展开全文' })).not.toBeInTheDocument();
  });
});
