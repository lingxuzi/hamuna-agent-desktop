// 资产库入口的回归护栏：顶栏那个按钮必须真的把一个视图接出来。
//
// 单独一条是因为 `pane: 'materials'` 曾经只活在小面板的类型里 —— 类型成立、
// 按钮没有、分支没有，整个视图在 UI 上不存在。类型系统拦不住这种。

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { emptyOpsState } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import OpsPanel from './OpsPanel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  dirExpand: vi.fn(),
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));
// 稳定引用（同 OpsMaterials.test.tsx）：每次渲染返回新对象会打转。
const fileService = {
  dirExpand: mocks.dirExpand,
  copyPaths: vi.fn(),
  readFileAsBlobUrl: vi.fn(),
};
vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => fileService,
}));

const WORKSPACE = '/ws/sino';

describe('OpsPanel 资产库入口', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.dirExpand.mockReset();
    mocks.invoke.mockResolvedValue(emptyOpsState());
    mocks.dirExpand.mockResolvedValue({ children: [], loaded: true });
    await i18n.changeLanguage('zh-CN');
  });

  it('顶栏的「物料库」切到 materials 视图，返回按钮退回台账', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={vi.fn()} />
      </ToastProvider>,
    );

    await user.click(await screen.findByRole('button', { name: '物料库' }));

    expect(await screen.findByText('物料库')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-pane="materials"]')).not.toBeNull();
    expect(mocks.dirExpand).toHaveBeenCalledWith({ path: 'ops/materials' });

    await user.click(screen.getByRole('button', { name: /返回物料库/ }));

    expect(document.querySelector('[data-ops-pane="domains"]')).not.toBeNull();
  });
});
