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
// 最要紧的一条：**向导里的交接不能关面板**。⑤⑥ 的产出是台账里长出来的列表
// （对标候选 / 选题），面板一关，人就得自己记走到第几步、再从哪儿点回来。
// 面板的普通交接是关面板的（不关的话用户看不到自己的话发出去没有），所以
// 向导必须走另一个回调 —— 这条断言钉的就是「向导模式挑的是不关面板的那个」。

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

function stateFixture(): OpsState {
  return { ...emptyOpsState(), accounts: [] };
}

function renderPanel(props: Partial<React.ComponentProps<typeof OpsPanel>> = {}) {
  const onClose = vi.fn();
  const onSendToAgent = vi.fn();
  const onSendToAgentKeepOpen = vi.fn();
  const onWizardStep = vi.fn();
  const onWizardDone = vi.fn();
  render(
    <ToastProvider>
      <OpsPanel
        workspace={WORKSPACE}
        onClose={onClose}
        onSendToAgent={onSendToAgent}
        onSendToAgentKeepOpen={onSendToAgentKeepOpen}
        onWizardStep={onWizardStep}
        onWizardDone={onWizardDone}
        {...props}
      />
    </ToastProvider>,
  );
  return { onClose, onSendToAgent, onSendToAgentKeepOpen, onWizardStep, onWizardDone };
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

  it('向导模式的顶栏是六步的步骤条', async () => {
    renderPanel({ wizardStep: 'login' });

    const steps = document.querySelectorAll('.ops-steps button');
    expect(steps).toHaveLength(6);
    expect(screen.getByRole('tab', { name: /登录账号/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('向导里的交接走不关面板的那个回调', async () => {
    const user = userEvent.setup();
    const { onSendToAgent, onSendToAgentKeepOpen } = renderPanel({
      wizardStep: 'benchmark',
    });

    await user.click(await screen.findByRole('button', { name: '让 Agent 找候选' }));

    await waitFor(() => expect(onSendToAgentKeepOpen).toHaveBeenCalled());
    expect(onSendToAgent).not.toHaveBeenCalled();
  });

  it('顶栏的「回到台账」退出向导模式', async () => {
    const user = userEvent.setup();
    const { onWizardStep } = renderPanel({ wizardStep: 'login' });

    await user.click(await screen.findByRole('button', { name: '回到台账' }));

    expect(onWizardStep).toHaveBeenCalledWith(undefined);
  });
});
