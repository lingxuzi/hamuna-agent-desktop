/**
 * 运营面板 bento 布局契约。
 *
 * 故障模式：卡片在网格里的位置由 ops.css 的 grid-template-areas 决定，组件
 * 增删卡片时位置表忘了同步 —— 多出来的卡被浏览器自动排位（挤掉别人的格子或
 * 掉到网格外），少掉的卡留出一个空洞；右栏两张卡若不在同一列，主区跟右栏就
 * 对不齐。这些都是纯视觉故障，jsdom 排不了版，只能把「位置表覆盖每一张实际
 * 渲染的卡」当成契约钉住。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { emptyOpsState } from '../../../shared/ops';
import type { OpsState } from '../../../shared/ops';
import OpsPanel from './OpsPanel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

// 同 Markdown.typography.test.tsx：jsdom 下 import.meta.url 会被改写成 http URL。
const css = readFileSync(join(process.cwd(), 'src/renderer/components/ops/ops.css'), 'utf8');

/** 位置表里的空格 = 那一格没有卡。 */
const EMPTY = '.';

/** 卡片 class → 网格区域名。位置表里的名字必须跟 CSS 里声明的一致。 */
function areaByClass(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/\.(ops-[a-z-]+)\s*\{[^}]*grid-area:\s*([a-z]+);/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

/** 每个域的位置表：域 → 行 → 格（格内是区域名）。 */
function areaTables(): Map<string, string[][]> {
  const tables = new Map<string, string[][]>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*grid-template-areas[^{}]*)\}/g)) {
    const domains = [...match[1].matchAll(/data-ops-domain='([a-z]+)'/g)].map((m) => m[1]);
    const body = match[2].match(/grid-template-areas:\s*([\s\S]*?);/);
    if (domains.length === 0 || !body) continue;
    const rows = body[1]
      .trim()
      .split('\n')
      .map((line) => line.trim().replace(/^'|'$/g, '').split(/\s+/));
    for (const domain of domains) tables.set(domain, rows);
  }
  return tables;
}

/** 位置表里区域名占的格子：[行, 列][]。 */
function cellsOf(rows: string[][], name: string): [number, number][] {
  return rows.flatMap((row, r) =>
    row.map((cell, c) => (cell === name ? ([r, c] as [number, number]) : null)).filter(Boolean) as [
      number,
      number,
    ][],
  );
}

/**
 * 一份**有内容**的台账。
 *
 * 空台账下每张卡都走空态分支，测不出「有数据却渲染成空白」这种故障 —— 那种
 * 故障只在有内容时出现（某个域忘了渲染列表 / 某个过滤条件把所有条目滤光）。
 */
function populatedState(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    directions: [
      {
        id: 'dir-douyin',
        platform: 'douyin',
        brief: '想让人记住我们懂露营装备',
        positioning: '白天露营装备实测',
        audience: '入门露营的人',
        pillars: ['装备实测'],
        goal: '涨粉',
        cadence: '每周 3 条',
        status: 'active',
        proposal: null,
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-10T09:00:00.000Z',
        finalizedAt: '2026-11-10T09:00:00.000Z',
        lastTouchedBy: 'user',
      },
      {
        id: 'dir-xhs',
        platform: 'xiaohongshu',
        brief: '出租屋改造',
        positioning: '',
        audience: '',
        pillars: [],
        goal: '',
        cadence: '',
        status: 'draft',
        proposal: null,
        createdAt: '2026-11-05T09:00:00.000Z',
        updatedAt: '2026-11-12T09:00:00.000Z',
        finalizedAt: null,
        lastTouchedBy: 'agent',
      },
    ],
    topics: [
      {
        id: 't1',
        title: '出租屋灯光改造',
        note: '',
        angle: '预算 300 块',
        platform: 'xiaohongshu',
        tags: [],
        status: 'idea',
        source: 'hotspot',
        sourceRefs: [],
        hotness: 86000,
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-12T09:00:00.000Z',
      },
      {
        id: 't2',
        title: '早八人的早餐',
        note: '',
        angle: '',
        platform: 'douyin',
        tags: [],
        status: 'idea',
        source: 'manual',
        sourceRefs: [],
        hotness: null,
        createdAt: '2026-11-02T09:00:00.000Z',
        updatedAt: '2026-11-11T09:00:00.000Z',
      },
    ],
    assets: [
      {
        id: 'a1',
        topicId: 't1',
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
        status: 'draft',
        publishedAt: null,
        platformWorkId: null,
        progress: 80,
        createdAt: '2026-11-03T09:00:00.000Z',
        updatedAt: '2026-11-11T10:00:00.000Z',
      },
      {
        id: 'a2',
        topicId: 't2',
        title: '早八人的早餐',
        body: '',
        product: '',
        cta: '',
        sourceRef: null,
        cover: null,
        images: [],
        shots: [],
        platform: 'douyin',
        scheduledAt: '2026-11-14T08:00:00.000Z',
        status: 'ready',
        publishedAt: null,
        platformWorkId: null,
        progress: 100,
        createdAt: '2026-11-04T09:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ],
    reviews: [
      {
        id: 'rv1',
        assetId: 'a1',
        platform: 'douyin',
        publishedAt: '2026-11-10T10:00:00.000Z',
        metrics: {
          views: 12847,
          likes: 800,
          comments: 120,
          shares: 90,
          saves: 60,
          followers: 62,
          completionRate: 0.41,
        },
        note: '',
        createdAt: '2026-11-10T10:00:00.000Z',
      },
    ],
    rules: [
      {
        id: 'r1',
        name: '标题带具体数字',
        rule: '带数字的标题点击率高 18%',
        source: 'reflection',
        status: 'active',
        confidence: 0.62,
        basis: 'verified',
        evidence: '近 10 条内容里有数字的 4 条完播更高',
        createdAt: '2026-11-09T09:00:00.000Z',
      },
    ],
  };
}

describe('运营面板 bento 位置表', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.invoke.mockResolvedValue(emptyOpsState());
    await i18n.changeLanguage('zh-CN');
  });

  it('每个域的位置表都覆盖该域实际渲染的每一张卡，且没有多余格子', async () => {
    const classToArea = areaByClass();
    const tables = areaTables();
    expect(classToArea.size).toBeGreaterThan(0);

    render(
      <ToastProvider>
        <OpsPanel workspace="/ws/sino" onClose={vi.fn()} onSendToAgent={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('.ops-body')).toBeTruthy();
    });

    const user = userEvent.setup();
    for (const tab of ['方向', '选题', '素材', '排期', '复盘']) {
      await user.click(await screen.findByRole('tab', { name: tab }));
      const body = document.querySelector('.ops-body') as HTMLElement;
      const domain = body.dataset.opsDomain as string;
      const rows = tables.get(domain);
      expect(rows, `域 ${domain} 缺位置表`).toBeTruthy();
      if (!rows) continue;

      // 位置表本身：矩形网格 + 一个区域名只占一个连续矩形。
      const width = rows[0].length;
      expect(rows.every((row) => row.length === width), `${domain} 位置表行长不齐`).toBe(true);
      // '.' = 那一格没有卡（留给「要点」腾出的空位），不算区域名。
      const cells = rows.flat().filter((cell) => cell !== EMPTY);
      for (const name of new Set(cells)) {
        const hit = cellsOf(rows, name);
        const rs = hit.map(([r]) => r);
        const cs = hit.map(([, c]) => c);
        const box = (Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1);
        expect(box, `${domain} 的区域 ${name} 不是连续矩形`).toBe(hit.length);
      }

      // 位置表 ⊇ 实际渲染的卡：多一张卡会被自动排位，少一张卡会留空洞。
      const rendered = [...body.querySelectorAll('.ops-hero, .ops-next, .ops-c-top, .ops-c-bars, .ops-c-chart, .ops-c-adv, .ops-c-bench, .ops-c-note')]
        .map((el) => classToArea.get([...el.classList].find((c) => classToArea.has(c)) ?? ''))
        .filter((area): area is string => Boolean(area));
      expect(new Set(rendered).size, `${domain} 有两张卡落在同一个区域`).toBe(rendered.length);
      expect([...new Set(cells)].sort(), `${domain} 位置表与实际渲染的卡不一致`).toEqual(
        [...new Set(rendered)].sort(),
      );
    }
  });

  it('「要点」横跨全部列且独占一行，深墨卡留在右栏', () => {
    // 要点卡跟数据卡同行时，行高由最高的那张决定 —— 要点只有四条短句，
    // 会把同行的「定稿进度」之属垫高几十到上百像素（空白留在卡内）。
    // 它必须独占面板底部的通栏行：横跨全部列 + 同行没有别的卡。
    const tables = areaTables();
    for (const [domain, rows] of tables) {
      const width = rows[0].length;
      const notes = cellsOf(rows, 'notes');
      expect(notes.length, `${domain} 的要点没有排进位置表`).toBeGreaterThan(0);
      expect(new Set(notes.map(([, c]) => c)).size, `${domain} 的要点没有横跨全部列`).toBe(width);
      for (const [r] of notes) {
        const others = rows[r].filter((cell) => cell !== EMPTY && cell !== 'notes');
        expect(others, `${domain} 的要点跟别的卡同行`).toEqual([]);
      }

      // 深墨卡在最后一列（右栏）。它在第一行，横跨它会把整条右栏撑成一张
      // 几百像素高的深色空卡。
      for (const [, c] of cellsOf(rows, 'dark')) {
        expect(c, `${domain} 的深墨卡不在右栏`).toBe(width - 1);
      }
    }
  });

  it('每张卡都有内容：不允许只剩标题和一片留白', async () => {
    // 故障模式：一张卡渲染出来只有一个标题，body 是空的。界面上看就是一大块
    // 留白，读者以为数据没了 —— 其实是这个域没渲染出任何东西。跟「假指标」
    // 是同一类故障：版面在占位，内容没到。
    //
    // 契约：去掉标题壳之后，卡里必须还有字。空态必须是**明说的一句**
    // （「还没有平台记录。」），不能是空白 —— 空白分不清「没数据」和「渲染坏了」。
    //
    // 两种台账都测：空的（有内容就是空态句）与满的（有内容就是数据行）。
    // 只测空台账的话，「有数据却渲染成空白」这类故障根本不会暴露。
    for (const [label, state] of [
      ['空台账', emptyOpsState()],
      ['有内容的台账', populatedState()],
    ] as const) {
      await expectEveryCardHasContent(state, label);
    }
  });
});

/** 逐域逐卡检查：标题壳之外必须有字。 */
async function expectEveryCardHasContent(state: OpsState, label: string) {
  mocks.invoke.mockResolvedValue(state);
  const view = render(
    <ToastProvider>
      <OpsPanel workspace="/ws/sino" onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
  await waitFor(() => {
    expect(document.querySelector('.ops-body')).toBeTruthy();
  });

  const user = userEvent.setup();
  for (const tab of ['方向', '选题', '素材', '排期', '复盘']) {
    await user.click(await screen.findByRole('tab', { name: tab }));
    const body = document.querySelector('.ops-body') as HTMLElement;
    const cards = [...body.querySelectorAll('.ops-card, .ops-hero, .ops-next')];
    expect(cards.length, `${label} 的 ${tab} 域没有渲染任何卡`).toBeGreaterThan(0);

    for (const card of cards) {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.querySelector('.ops-card-head')?.remove();
      const text = (clone.textContent ?? '').trim();
      const name = card.querySelector('h2')?.textContent?.trim() || card.className;
      expect(text.length, `${label} 的 ${tab} 域：「${name}」只剩标题和留白`).toBeGreaterThan(0);
    }
  }
  view.unmount();
}
