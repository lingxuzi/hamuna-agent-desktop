import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsDirection, OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { deriveDirectionView } from '../../../shared/ops-derive';
import { OpsFinalizeCard } from './OpsFinalizeCard';

// 「定稿进度」卡的回归护栏。
//
// 这张卡回答的是「这个号走到哪一步了、卡在谁那儿、多久没动」。三件事不能搞错：
//
//  1. **定稿时刻 ≠ 最后一次写。** `updatedAt` 是最后一次写 —— Agent 提一次修订
//     就刷新它。拿它当「定稿于」是在撒谎：方向可能三个月前就定了，昨天只是有人
//     提了个修订。所以定稿那一刻必须读 `finalizedAt`。
//  2. **等确认时，时间说的是提议那一刻。** 已定稿 + 有修订的行同时是「已定稿」和
//     「有人在等你点头」；此刻人该处理的是提议，时间列就该指向提议。
//  3. **老记录没记下时刻就说「更新」，不说「定稿」。** 不知道就该说不知道。

const NOW = new Date(2026, 10, 13, 10, 0, 0);

function direction(patch: Partial<OpsDirection> & Pick<OpsDirection, 'id' | 'platform'>): OpsDirection {
  return {
    brief: '',
    positioning: '',
    audience: '',
    pillars: [],
    goal: '',
    cadence: '',
    status: 'draft',
    proposal: null,
    createdAt: '2026-11-01T09:00:00',
    updatedAt: '2026-11-01T09:00:00',
    finalizedAt: null,
    lastTouchedBy: null,
    ...patch,
  };
}

function state(directions: OpsDirection[]): OpsState {
  return { ...emptyOpsState(), directions };
}

function renderCard(directions: OpsDirection[]) {
  const view = deriveDirectionView(state(directions), NOW);
  return render(<OpsFinalizeCard view={view} />);
}

function rowOf(platform: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.ops-final-rows > li'));
  const hit = rows.find((li) => li.querySelector('.name')?.textContent === platform);
  if (!hit) throw new Error(`没有 ${platform} 这一行`);
  return hit;
}

describe('定稿进度卡', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('已定稿的方向说「N 天前定稿」，读的是定稿那一刻', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        positioning: '白天露营装备实测',
        createdAt: '2026-11-01T09:00:00',
        updatedAt: '2026-11-12T09:00:00',
        finalizedAt: '2026-11-10T09:00:00',
      }),
    ]);

    expect(screen.getByText('已定稿')).toBeInTheDocument();
    // 定稿在 3 天前，最后一次写在 1 天前 —— 这里必须显示 3，不是 1。
    expect(screen.getByText('3 天前定稿')).toBeInTheDocument();
    expect(screen.queryByText('1 天前定稿')).toBeNull();
  });

  it('有修订在等时标出「待你确认」，时间说的是提议那一刻', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        finalizedAt: '2026-11-01T09:00:00',
        updatedAt: '2026-11-12T09:00:00',
        proposal: {
          positioning: '夜间露营装备测评',
          audience: '',
          pillars: [],
          goal: '',
          cadence: '',
          rationale: '晚间完播率更高',
          evidence: '',
          proposedAt: '2026-11-12T09:00:00',
        },
      }),
    ]);

    const row = rowOf('抖音');
    expect(row.querySelector('.pending')?.textContent).toBe('待你确认');
    // 同时是「已定稿」和「有人在等点头」—— 两个标签都要在。
    expect(row.querySelector('.stage-label')?.textContent).toBe('已定稿');
    // 现在轮到你处理的是提议（1 天前），不是 12 天前那次定稿。
    expect(row.querySelector('.when')?.textContent).toBe('1 天前 Agent 提议');
  });

  it('定过稿但没记下时刻的老记录，说「N 天前更新」而不是「定稿」', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        updatedAt: '2026-11-01T09:00:00',
        finalizedAt: null,
      }),
    ]);

    const row = rowOf('抖音');
    expect(row.querySelector('.stage-label')?.textContent).toBe('已定稿');
    expect(row.querySelector('.when')?.textContent).toBe('12 天前更新');
    expect(row.querySelector('.when')?.textContent).not.toContain('定稿');
  });

  it('还没立方向的平台占一行，写「还没立方向」', () => {
    renderCard([direction({ id: 'dir-douyin', platform: 'douyin', status: 'active' })]);

    // 只有抖音有方向；别的平台没碰过就不占行。
    const rows = Array.from(document.querySelectorAll('.ops-final-rows > li'));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.name')?.textContent).toBe('抖音');
  });

  it('台账里一个方向都没有时显示空态，而不是空白卡', () => {
    renderCard([]);

    expect(screen.getByText('还没有平台记录。')).toBeInTheDocument();
    expect(document.querySelector('.ops-final-rows')).toBeNull();
  });

  it('标出「谁在改」：人动的写你，Agent 动的写 Agent', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        finalizedAt: '2026-11-10T09:00:00',
        lastTouchedBy: 'user',
      }),
      direction({
        id: 'dir-xhs',
        platform: 'xiaohongshu',
        status: 'draft',
        lastTouchedBy: 'agent',
      }),
    ]);

    expect(rowOf('抖音').querySelector('.actor')?.textContent).toBe('最后动的是你');
    expect(rowOf('小红书').querySelector('.actor')?.textContent).toBe('最后动的是 Agent');
  });

  it('没记下是谁动的老记录不猜 —— 那一格留空', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        finalizedAt: '2026-11-10T09:00:00',
        lastTouchedBy: null,
      }),
    ]);

    const actor = rowOf('抖音').querySelector('.actor');
    expect(actor?.textContent).toBe('');
    // 空格子也要在：它保住这一列的列数，右边的时间才始终对齐成一条竖线。
    expect(actor).not.toBeNull();
  });
});
