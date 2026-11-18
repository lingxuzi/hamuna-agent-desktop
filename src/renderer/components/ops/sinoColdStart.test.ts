// 冷启动判据的护栏。
//
// 两条不变量：
//  1. **三件一件没做才算冷启动** —— 缺一件的账号已经在经营了，再弹三步向导
//     是在打断人，不是在帮忙。
//  2. **后台 Tab 不消费那一次机会** —— 消费了就等于替用户按下一个他看不见的
//     按钮，而且切回来就再也弹不出来。

import { describe, expect, it } from 'vitest';

import type { OpsAccount, OpsDirection } from '../../../shared/ops';
import { isSinoColdStart, shouldAutoOpenSinoWizard } from './sinoColdStart';

const NOW = '2026-11-17T08:00:00.000Z';

function account(loginState: OpsAccount['loginState']): OpsAccount {
  return {
    id: `acc-${loginState}`,
    platform: 'xiaohongshu',
    displayName: '露营装备小王',
    loginState,
    lastCheckedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function direction(brief: string): OpsDirection {
  return {
    id: 'dir-xiaohongshu',
    platform: 'xiaohongshu',
    brief,
    positioning: '',
    audience: '',
    pillars: [],
    goal: '',
    cadence: '',
    status: 'draft',
    proposal: null,
    createdAt: NOW,
    updatedAt: NOW,
    finalizedAt: null,
    lastTouchedBy: null,
    dispatchedAt: null,
  };
}

describe('冷启动判据', () => {
  it('三件一件没做 = 冷启动', () => {
    expect(
      isSinoColdStart({ accounts: [], directions: [], profileFilled: false }),
    ).toBe(true);
  });

  it('登录过就不算冷启动', () => {
    expect(
      isSinoColdStart({
        accounts: [account('success')],
        directions: [],
        profileFilled: false,
      }),
    ).toBe(false);
  });

  it('登录态失效不算登录过', () => {
    expect(
      isSinoColdStart({
        accounts: [account('expired')],
        directions: [],
        profileFilled: false,
      }),
    ).toBe(true);
  });

  it('说过方向原话就不算冷启动', () => {
    expect(
      isSinoColdStart({
        accounts: [],
        directions: [direction('想让人记住我们是懂露营装备的')],
        profileFilled: false,
      }),
    ).toBe(false);
  });

  it('方向原话只有空白还是没说过', () => {
    expect(
      isSinoColdStart({
        accounts: [],
        directions: [direction('   ')],
        profileFilled: false,
      }),
    ).toBe(true);
  });

  it('画像填过就不算冷启动', () => {
    expect(
      isSinoColdStart({ accounts: [], directions: [], profileFilled: true }),
    ).toBe(false);
  });
});

describe('要不要自动弹向导', () => {
  const ready = {
    isActive: true,
    isSinoWorkspace: true,
    onboarded: false,
    coldStart: true as boolean | null,
    alreadyOpened: false,
  };

  it('前台 + 冷启动 + 没引导过 = 弹', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready })).toBe(true);
  });

  it('后台 Tab 不弹 —— 那次机会必须留给切回来的那一刻', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, isActive: false })).toBe(false);
  });

  it('用户说过「以后再说」就不弹', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, onboarded: true })).toBe(false);
  });

  it('判据还没读到时不弹 —— 读不出来不等于冷启动', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, coldStart: null })).toBe(false);
  });

  it('不是冷启动就不弹', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, coldStart: false })).toBe(false);
  });

  it('本次运行已经弹过就不再弹', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, alreadyOpened: true })).toBe(false);
  });

  it('不是 sino 工作区就不弹', () => {
    expect(shouldAutoOpenSinoWizard({ ...ready, isSinoWorkspace: false })).toBe(false);
  });
});
