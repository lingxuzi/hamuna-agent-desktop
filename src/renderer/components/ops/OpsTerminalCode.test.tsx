import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

// 终端口令的回归护栏。
//
// 这枚口令是「人手动跑 CLI 时把自己记成人，而不是 Agent」的唯一凭据。门在
// Rust 那边（src-tauri/src/ops_user_code.rs），界面这一侧只负责铸和展示。
// 两条契约：
// - 点一下才铸 —— 面板打开时不该凭空多一枚有效凭据；
// - 铸出来必须让人看见内容**和**失效时刻 —— 口令只活 10 分钟，看不见失效
//   时刻的人会拿着一枚已经作废的口令去终端里试。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const TERMINAL_CODE = 'K3M9XQ2P';

function codeCall() {
  return mocks.invoke.mock.calls.find((call) => call[0] === 'cmd_ops_user_code');
}

function renderPanel() {
  return render(
    <ToastProvider>
      <OpsPanel workspace="/ws/sino" onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
}

describe('运营台 终端口令', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_ops_user_code') {
        return Promise.resolve({
          code: TERMINAL_CODE,
          expiresAt: '2026-11-17T12:34:00.000Z',
          ttlSeconds: 600,
        });
      }
      return Promise.resolve(emptyOpsState());
    });
    await i18n.changeLanguage('zh-CN');
  });

  it('打开面板时不铸口令', () => {
    renderPanel();
    expect(codeCall()).toBeFalsy();
  });

  it('点一下铸一枚口令，并把内容和失效时刻都摆出来', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '终端口令' }));

    expect(await screen.findByText(TERMINAL_CODE)).toBeInTheDocument();
    expect(screen.getByText(/前有效/)).toBeInTheDocument();
    expect(codeCall()).toBeTruthy();
  });
});
