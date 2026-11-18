import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 运营台「向导模式」的护栏。
//
// 最要紧的一条：**向导派工后面板要关**。Agent 的提问卡在对话区，而面板浮在
// 对话区上面 —— 留着它，人就看不见提问、答不了，而那正是派工之后唯一要做
// 的事。所以向导的交接走的就是普通交接，没有第二条路径。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  readPreview: vi.fn(),
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({ readPreview: mocks.readPreview }),
}));

const WORKSPACE = '/ws/sino';
const NOW = '2026-11-17T08:00:00.000Z';

/**
 * 一个「已经登录 + 写过方向」的台账。
 *
 * 三步走完会自动派工，而派工的前提是有方向 —— 没有方向，向导会退回第 ② 步，
 * 派工那条路根本走不到。
 */
function stateFixture(): OpsState {
  return {
    ...emptyOpsState(),
    accounts: [
      {
        id: 'acc-xhs',
        platform: 'xiaohongshu',
        displayName: '露营装备小王',
        loginState: 'success',
        lastCheckedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    directions: [
      {
        id: 'dir-xiaohongshu',
        platform: 'xiaohongshu',
        brief: '想让人记住我们是懂露营装备的',
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
      },
    ],
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof OpsPanel>> = {}) {
  const onClose = vi.fn();
  const onSendToAgent = vi.fn();
  const onWizardStep = vi.fn();
  const onWizardDone = vi.fn();
  render(
    <ToastProvider>
      <OpsPanel
        workspace={WORKSPACE}
        onClose={onClose}
        onSendToAgent={onSendToAgent}
        onWizardStep={onWizardStep}
        onWizardDone={onWizardDone}
        {...props}
      />
    </ToastProvider>,
  );
  return { onClose, onSendToAgent, onWizardStep, onWizardDone };
}

describe('运营台向导模式', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.readPreview.mockReset();
    mocks.invoke.mockResolvedValue(stateFixture());
    mocks.readPreview.mockRejectedValue(new Error('这一步没读画像'));
    await i18n.changeLanguage('zh-CN');
  });

  it('普通模式的顶栏有「冷启动引导」入口', async () => {
    renderPanel();

    expect(await screen.findByRole('button', { name: '冷启动引导' })).toBeInTheDocument();
    expect(document.querySelector('.ops-steps')).toBeNull();
  });

  it('向导模式的顶栏是三步的步骤条', async () => {
    renderPanel({ wizardStep: 'login' });

    const steps = document.querySelectorAll('.ops-steps button');
    expect(steps).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /登录账号/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('向导派工走普通交接 —— 面板先关，Agent 的提问卡才看得见', async () => {
    const user = userEvent.setup();
    const { onSendToAgent } = renderPanel({ wizardStep: 'material' });

    // 走完第 ③ 步 = 自动派工，人不再点一次「开工」。
    await user.click(await screen.findByRole('button', { name: '完成，交给 Sino' }));

    await waitFor(() => expect(onSendToAgent).toHaveBeenCalled());
    // 只有一条交接路径：向导不另开一个「不关面板」的分支。
    expect(String(onSendToAgent.mock.calls[0]?.[0])).toContain('03-USER.md');
  });

  it('顶栏的「回到台账」退出向导模式', async () => {
    const user = userEvent.setup();
    const { onWizardStep } = renderPanel({ wizardStep: 'login' });

    await user.click(await screen.findByRole('button', { name: '回到台账' }));

    expect(onWizardStep).toHaveBeenCalledWith(undefined);
  });
});
