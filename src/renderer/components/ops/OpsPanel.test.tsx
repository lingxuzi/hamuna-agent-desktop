import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import OpsPanel from './OpsPanel';

// The panel's whole job is "read the ledger, derive four domains, render them".
// Two states matter and they fail differently:
//   · empty  — a fresh sino workspace. Every domain must still render (Hero,
//              cards, rail) instead of collapsing to nothing or to a spinner.
//   · filled — the real shape. The review domain is the only one with a chart
//              and an advice card; if those silently disappear the panel looks
//              fine while hiding the numbers the user came for.

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
        cover: null,
        images: [],
        shots: [],
        platform: 'xiaohongshu',
        scheduledAt: '2026-11-18T20:00:00',
        status: 'ready',
        publishedAt: null,
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

function renderPanel() {
  return render(<OpsPanel workspace={WORKSPACE} onClose={vi.fn()} />);
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
});
