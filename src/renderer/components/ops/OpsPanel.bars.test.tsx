/**
 * 分布条这把尺子：条长是份额，条是细的，卡头写出分母。
 *
 * 三条都是**看得见的故障**，分别发生在三个地方：
 *
 *  1. **条长编码错**。条长是「这一项占全部的百分之多少」，不是「它是最多的
 *     百分之多少」。相对最大值编码的是排名，却长在叫「分布」的卡上：四个来源
 *     各 1 条时四根全满，读者读成「四个来源都是大头」，实际每个只占四分之
 *     一。这是**假象**，数字没错，看法错了。
 *  2. **条太粗**。条是量级计，不是发廊转灯。粗条让一根短条看起来像一根满条，
 *     两根满条和一粗一细在余光里分不开。
 *  3. **分母悬空**。份额的 58% 是相对于什么？卡头不写总数，百分比就没有
 *     参照系，读者只能把 58% 当「比较多」而不是「占全部的 58%」。
 *
 * 前两条分别在 CSS 与派生层，渲染层只负责把它们接上；这条测试三处都钉，
 * 因为它们是**同一个承诺**的三半：条长说份额 → 条要细到能看出比例 → 分母
 * 要写在明面上。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
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

// 同 OpsPanel.layout.test.tsx：jsdom 下 import.meta.url 会被改写成 http URL。
const css = readFileSync(join(process.cwd(), 'src/renderer/components/ops/ops.css'), 'utf8');

/** 条的粗细上限。粗条把比例糊掉 —— 见文件头的「条太粗」。 */
const MAX_TRACK_PX = 6;
const MAX_MINI_TRACK_PX = 4;

/** 每根条的 track 高度声明：选择器 → height 的值。 */
function trackHeights(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/(\.ops-bars(?:\.mini)?)\s+\.track\s*\{([^}]*)\}/g)) {
    const height = match[2].match(/(?:^|;)\s*height:\s*([^;]+);/);
    map.set(match[1], height ? height[1].trim() : '');
  }
  return map;
}

function asset(id: string, patch: Partial<OpsState['assets'][number]> = {}) {
  return {
    id,
    topicId: 't1',
    title: id,
    body: '',
    product: '',
    cta: '',
    sourceRef: null,
    cover: null,
    images: [],
    shots: [],
    platform: 'douyin' as const,
    scheduledAt: null,
    status: 'draft' as const,
    publishedAt: null,
    platformWorkId: null,
    progress: 0,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...patch,
  };
}

function topic(id: string, patch: Partial<OpsState['topics'][number]> = {}) {
  return {
    id,
    title: id,
    note: '',
    angle: '',
    platform: 'douyin' as const,
    tags: [],
    status: 'idea' as const,
    source: 'manual' as const,
    sourceRefs: [],
    hotness: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...patch,
  };
}

function renderPanel(state: OpsState) {
  mocks.invoke.mockResolvedValue(state);
  return render(
    <ToastProvider>
      <OpsPanel workspace="/ws/sino" onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
}

/** 切到某个域，等它的分布卡画出来。 */
async function openDomain(name: string): Promise<void> {
  (await screen.findByRole('tab', { name })).click();
  await waitFor(() => {
    expect(document.querySelector('.ops-c-bars')).toBeTruthy();
  });
}

/** 分布卡里每根条的填充宽度（百分比）。 */
function barWidths(): number[] {
  return [...document.querySelectorAll('.ops-c-bars .track > i')].map((el) =>
    Number.parseFloat((el as HTMLElement).style.width),
  );
}

describe('分布条的粗细', () => {
  it('条是常数像素，且不超过上限', () => {
    const heights = trackHeights();
    const regular = heights.get('.ops-bars');
    const mini = heights.get('.ops-bars.mini');

    expect(regular, 'ops.css 里找不到 .ops-bars .track 的高度声明').toBeTruthy();
    expect(mini, 'ops.css 里找不到 .ops-bars.mini .track 的高度声明').toBeTruthy();

    // 必须是 px 常量。用 % / em / rem / vh 的条会随字号或容器缩放 —— 同一份
    // 数据在两台机器上粗细不同，「条长多少」就失去了可比性。
    for (const [selector, value] of [
      ['.ops-bars .track', regular as string],
      ['.ops-bars.mini .track', mini as string],
    ]) {
      expect(value, `${selector} 的高度不是 px 常量`).toMatch(/^\d+(\.\d+)?px$/);
    }

    expect(Number.parseFloat(regular as string)).toBeLessThanOrEqual(MAX_TRACK_PX);
    expect(Number.parseFloat(mini as string)).toBeLessThanOrEqual(MAX_MINI_TRACK_PX);
    // 小条比大条更细：同一种控件的两种密度，不能同粗。
    expect(Number.parseFloat(mini as string)).toBeLessThanOrEqual(
      Number.parseFloat(regular as string),
    );
  });
});

describe('分布条的长度是占总数的份额', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    await i18n.changeLanguage('zh-CN');
  });

  it('四个来源各一条时没有一根是满条', async () => {
    // 旧编码（相对最大值）下这四条都是满条：读者看到四个满条，读成「四个来源
    // 都是大头」，实际每个只占四分之一。份额编码下它们各占 25%。
    renderPanel({
      ...emptyOpsState(),
      topics: [
        topic('t1', { source: 'hotspot' }),
        topic('t2', { source: 'benchmark' }),
        topic('t3', { source: 'reflection' }),
        topic('t4', { source: 'manual' }),
      ],
    });

    await openDomain('选题');

    const widths = barWidths();
    expect(widths).toHaveLength(4);
    expect(widths.every((w) => w < 100)).toBe(true);
    // 加起来是全部（取整差 1 以内）。
    const sum = widths.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });

  it('卡头写出分母：份额得有个数在旁', async () => {
    renderPanel({
      ...emptyOpsState(),
      assets: [
        asset('a1'),
        asset('a2'),
        asset('a3'),
        asset('a4', { status: 'published' }),
      ],
    });

    await openDomain('素材');

    const meta = document.querySelector('.ops-c-bars .ops-meta')?.textContent ?? '';
    expect(meta).toContain('共 4 条');
  });
});
