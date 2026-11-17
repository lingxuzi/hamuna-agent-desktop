import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsDirection, OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { deriveDirectionView } from '../../../shared/ops-derive';
import { OpsDirectionCard } from './OpsDirectionCard';

// 方向域的回归护栏。
//
// 这条线上出过两件事，都得在这儿挡住：
//
// 1. **没修订也显示「采纳修订」**。台账里没有 proposal 键时前端拿到的是
//    `undefined`，而 `undefined !== null` 为真 —— 每一条方向都挂上采纳 / 驳回，
//    人一点就撞上后端那句「没有待确认的修订」。
// 2. **有修订却看不到改了什么**。让人只凭一句理由点头，等于让人替 Agent 在
//    自己看不见的地方拍板。

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
  return render(
    <OpsDirectionCard
      view={view}
      busy={false}
      onWriteBrief={() => {}}
      onAskAgent={() => {}}
      onAcceptProposal={() => {}}
      onRejectProposal={() => {}}
    />,
  );
}

describe('方向卡：修订', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('没有修订时不显示采纳 / 驳回', () => {
    renderCard([direction({ id: 'dir-douyin', platform: 'douyin', brief: '露营装备' })]);

    expect(screen.queryByRole('button', { name: /采纳修订/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /驳回/ })).toBeNull();
    // 没有修订就只剩「改原话 / 交给 Agent」两个动作。
    expect(screen.getByRole('button', { name: /改方向原话/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /交给 Agent 整理/ })).toBeInTheDocument();
  });

  it('台账里没有 proposal 键时同样不显示采纳 / 驳回', () => {
    // 老文件 / 手改过的文件可能压根没有这个键。
    const withoutKey = direction({ id: 'dir-douyin', platform: 'douyin', brief: '露营装备' });
    delete (withoutKey as Partial<OpsDirection>).proposal;

    renderCard([withoutKey]);

    expect(screen.queryByRole('button', { name: /采纳修订/ })).toBeNull();
    expect(screen.getByRole('button', { name: /改方向原话/ })).toBeInTheDocument();
  });

  it('有修订时把「改成这样」摊开，并给出采纳 / 驳回', () => {
    renderCard([
      direction({
        id: 'dir-douyin',
        platform: 'douyin',
        status: 'active',
        positioning: '白天露营装备测评',
        proposal: {
          positioning: '夜间露营装备测评',
          audience: '入门露营者',
          pillars: ['夜钓', '便携炉'],
          rationale: '近两周晚间发布的内容完播率高 40%',
        },
      }),
    ]);

    expect(screen.getByText('待确认的修订')).toBeInTheDocument();
    expect(screen.getByText('夜间露营装备测评')).toBeInTheDocument();
    expect(screen.getByText('入门露营者')).toBeInTheDocument();
    expect(screen.getByText('夜钓')).toBeInTheDocument();
    expect(screen.getByText('便携炉')).toBeInTheDocument();
    expect(screen.getByText('近两周晚间发布的内容完播率高 40%')).toBeInTheDocument();
    // 采纳前主字段不变 —— 修订还没生效。
    expect(screen.getByText('白天露营装备测评')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /采纳修订/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /驳回/ })).toBeInTheDocument();
  });
});
