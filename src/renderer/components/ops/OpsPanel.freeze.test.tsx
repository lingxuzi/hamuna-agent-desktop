import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { OpsState } from '../../../shared/ops';
import { emptyOpsState, type OpsTopic } from '../../../shared/ops';
import { ToastProvider } from '@/components/Toast';
import { TabUnifiedLogsPanel } from '@/components/UnifiedLogsPanel';
import { appendUnifiedLog, clearUnifiedLogs } from '@/utils/unifiedLogStore';
import OpsPanel from './OpsPanel';

// 「点方向整个 app 卡死」的回归护栏（v0.2.35）。
//
// 死循环是这么长出来的：
//  1. 方向域把「有内容但没立方向的平台」也排进列表，这些行没有记录 id，
//     列表却用它当 React key → 同一份数据里出现多个 `key="null"`；
//  2. React 19 DEV 每次 reconcile 都打一条重复 key 的 `console.error`；
//  3. `console.error` 被前端日志接管，**同步**推给订阅者；
//  4. 订阅者是包住整个聊天界面的 TabProvider，它 setState → 界面重渲染
//     → 又一遍第 2 步 → 主线程钉死。
//
// 这条测试盯住修复的两个环节：重复 key 不能再出现；日志列表搬进叶子面板后，
// 新日志只能重渲染日志面板，碰不到产生它的界面。

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

const WORKSPACE = '/ws/sino';

function topic(id: string, platform: OpsTopic['platform']): OpsTopic {
  return {
    id,
    title: id,
    note: '',
    angle: '',
    platform,
    tags: [],
    status: 'idea',
    source: 'hotspot',
    sourceRefs: [],
    hotness: 1000,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
  };
}

/** 两个平台有内容但没立方向 —— 只有一个的话重复 key 还可能侥幸对上号。 */
function stateWithDirections(): OpsState {
  return {
    ...emptyOpsState(),
    topics: [topic('t1', 'xiaohongshu'), topic('t2', 'bilibili')],
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={vi.fn()} />
    </ToastProvider>,
  );
}

describe('方向域不能把界面拖进日志回灌循环', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.isTauri = true;
    clearUnifiedLogs();
    await i18n.changeLanguage('zh-CN');
  });

  it('没立方向的平台不再共用同一个 null key，React 不报重复子节点', async () => {
    const consoleError = vi.spyOn(console, 'error');
    mocks.invoke.mockResolvedValue(stateWithDirections());

    renderPanel();
    (await screen.findByRole('tab', { name: '方向' })).click();

    await waitFor(() => {
      expect(document.querySelectorAll('.ops-dirs > li')).toHaveLength(2);
    });

    const duplicateKeyWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('新日志只重渲染日志面板，碰不到产生它的界面', async () => {
    // 用 mock 数渲染次数：在渲染期自增 ref / state / 外部对象都会被
    // react-hooks 规则拦，而这里要的就是「渲染发生了多少次」这个事实本身。
    const onSiblingRender = vi.fn();
    function Sibling() {
      onSiblingRender();
      return <div data-testid="sibling" />;
    }

    mocks.invoke.mockResolvedValue(stateWithDirections());
    render(
      <ToastProvider>
        <OpsPanel workspace={WORKSPACE} onClose={vi.fn()} onSendToAgent={vi.fn()} />
        <Sibling />
        <TabUnifiedLogsPanel isVisible onClose={vi.fn()} />
      </ToastProvider>,
    );

    (await screen.findByRole('tab', { name: '方向' })).click();
    await waitFor(() => {
      expect(document.querySelectorAll('.ops-dirs > li')).toHaveLength(2);
    });

    const before = onSiblingRender.mock.calls.length;

    appendUnifiedLog({
      source: 'react',
      level: 'error',
      message: 'Encountered two children with the same key',
      timestamp: '2026-11-15T10:00:00',
    });
    // 面板自己必须收到（否则「日志面板不更新」），邻座不能收到。
    await screen.findByText(/Encountered two children/);
    expect(onSiblingRender).toHaveBeenCalledTimes(before);
  });
});
