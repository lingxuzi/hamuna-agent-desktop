import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 方向域的回归护栏。
//
// 这条线出过两个真事故：
//  1. **点「方向」整个 app 卡死。** 派生层把「有内容但没立方向的平台」也放进
//     池子，它的 `id` 是 `null`；列表用它当 React key，于是同一份数据里出现
//     多个 `key="null"`。重复 key 让 React 无法把旧子树对上号，重挂载与状态
//     复位叠在一起就把渲染循环拖死了。
//  2. 方向域是第五个域，但它是**第一个** tab —— 点它比点其余四个更容易撞上
//     上面那条路径。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

/** 一条已生效的方向。 */
function directionRecord(platform: 'douyin' | 'xiaohongshu') {
  return {
    id: `dir-${platform}`,
    platform,
    brief: '想让人记住我们懂露营装备',
    positioning: '白天露营装备实测',
    audience: '刚买第一套装备的入门者',
    pillars: ['装备实测', '避坑'],
    goal: '涨粉',
    cadence: '每周 3 条',
    status: 'active' as const,
    proposal: null,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    finalizedAt: '2026-11-10T00:00:00.000Z',
    lastTouchedBy: null,
  };
}

/**
 * 真实工作区会遇到的形状：**两个**平台有内容但没立方向。
 *
 * 只有一个的话，重复 key 只出现一次，React 还可能侥幸对上号；两个才会真正
 * 撞车。所以这里必须是两个。
 */
function stateWithDirections(): OpsState {
  const base = emptyOpsState();
  return {
    ...base,
    directions: [directionRecord('douyin')],
    topics: [
      {
        id: 't1',
        title: '出租屋灯光改造',
        note: '',
        angle: '',
        platform: 'xiaohongshu',
        tags: [],
        status: 'idea',
        source: 'hotspot',
        sourceRefs: [],
        hotness: 86000,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
      {
        id: 't2',
        title: '通勤穿搭',
        note: '',
        angle: '',
        platform: 'bilibili',
        tags: [],
        status: 'idea',
        source: 'hotspot',
        sourceRefs: [],
        hotness: 12000,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    ],
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
}

describe('OpsPanel 方向域', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    await i18n.changeLanguage('zh-CN');
  });

  it('切到方向域能画出每个平台一行，没有立过方向的平台也在', async () => {
    mocks.invoke.mockResolvedValue(stateWithDirections());
    renderPanel();

    const tab = await screen.findByRole('tab', { name: '方向' });
    tab.click();

    // 三行：抖音（有方向）+ 小红书、B 站（有内容没方向）。
    await waitFor(() => {
      expect(screen.getByText('白天露营装备实测')).toBeInTheDocument();
    });
    expect(screen.getByText('想让人记住我们懂露营装备')).toBeInTheDocument();
    // 没立方向的平台也要出现，否则「这个号没定义过」在界面上根本不可见。
    // 「定稿进度」卡现在也按平台列行（没定稿的平台占一行空值行），平台名在
    // 整页里不止出现一次，所以断言必须落在方向列表上，不能全文唯一匹配。
    const poolPlatforms = Array.from(document.querySelectorAll('.ops-dirs > li .n')).map(
      (el) => el.textContent,
    );
    expect(poolPlatforms).toContain('小红书');
    expect(poolPlatforms).toContain('B站');
  });

  it('列表里的行 key 唯一：没立方向的平台不能共用同一个 null key', async () => {
    mocks.invoke.mockResolvedValue(stateWithDirections());
    renderPanel();

    (await screen.findByRole('tab', { name: '方向' })).click();
    await waitFor(() => {
      expect(screen.getByText('白天露营装备实测')).toBeInTheDocument();
    });

    const rows = Array.from(document.querySelectorAll('.ops-dirs > li'));
    expect(rows).toHaveLength(3);

    // 行的身份是平台，不是标题：两行没写方向的平台标题都是「还没写方向」，
    // 拿标题去重会把它们当成同一行。要断言的是每个平台只出现一次。
    const platforms = rows.map((li) => li.querySelector('.n')?.textContent);
    expect(platforms).toEqual(['B站', '小红书', '抖音']);
  });

  it('点「写方向」打开原话表单，平台已存在时锁住平台', async () => {
    const user = userEvent.setup();
    mocks.invoke.mockResolvedValue(stateWithDirections());
    renderPanel();

    (await screen.findByRole('tab', { name: '方向' })).click();
    // 已有的方向按钮叫「改方向原话」，没写过的叫「写方向」——点已有的那条，
    // 才能验证表单把原话回填了。
    await user.click(await screen.findByRole('button', { name: '改方向原话' }));

    await screen.findByRole('dialog');
    expect(screen.getByLabelText('用一句话说清')).toHaveValue('想让人记住我们懂露营装备');
    // 平台已存在：平台名只作静态文本展示，不给切换控件 —— 在这里改平台
    // 等于换一条记录。未锁定时平台会走下拉，不会有这行静态提示。
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.ops-form-hint')?.textContent).toBe('抖音');
  });
});
