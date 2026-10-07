// MiniAppCenter.test.tsx — Phase 4 entry (PRD v0.4 §B.5).
//
// Confirms: grid renders installed MiniApps; empty state when none installed;
// clicking a card dispatches OPEN_MINIAPP_SCENE with the right payload.
//
// NOTE on the react-i18next mock below: `t: (k) => k` returns the key, so any
// assertion on user-facing copy in THIS file passes whether or not the key
// exists in the locale files — which is how this page shipped with 20 missing
// keys and rendered nothing but `miniappCenter.title`. Do not assert on copy
// here; the real guard is `i18n/resourceParity.test.ts`, which resolves every
// `t()` literal against the actual resources.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CUSTOM_EVENTS } from '../../shared/constants';
import MiniAppCenter from './MiniAppCenter';

const apiGetJson = vi.fn();
const apiPostJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
}));

// The page now reports uninstall results through the toast. `useToast` throws
// without a provider, so stub it the way Marketplace.test.tsx does.
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
}));

describe('MiniAppCenter page', () => {
  afterEach(() => {
    apiGetJson.mockReset();
    apiPostJson.mockReset();
    vi.restoreAllMocks();
  });

  it('renders installed grid and filters out bundled entries', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [
        { id: 'git-graph', name: 'Git Graph', version: 1, path: '/a', source: 'bundled' },
        {
          id: 'icon-generator',
          name: 'Icon Generator',
          version: 3,
          path: '/b',
          source: 'installed',
          icon: 'palette',
          kind: 'iframe',
        },
      ],
    });

    const { getByTestId, queryByTestId } = render(<MiniAppCenter isActive={true} />);

    await waitFor(() => {
      expect(getByTestId('miniapp-center-card-icon-generator')).toBeTruthy();
      expect(queryByTestId('miniapp-center-card-git-graph')).toBeNull();
    });
  });

  it('shows empty state when no MiniApps are installed', async () => {
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [] });

    const { getByTestId } = render(<MiniAppCenter isActive={true} />);

    await waitFor(() => {
      expect(getByTestId('miniapp-center-empty')).toBeTruthy();
      expect(getByTestId('miniapp-center-browse-marketplace')).toBeTruthy();
    });
  });

  it('dispatches OPEN_MINIAPP_SCENE with kind/workerKind when a card is clicked', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'git-graph',
          name: 'Git Graph',
          version: 1,
          path: '/a',
          source: 'installed',
          icon: 'git-branch',
          kind: 'worker',
          worker_kind: 'git-graph',
        },
      ],
    });

    const listener = vi.fn();
    window.addEventListener(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, listener);

    const { getByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-card-git-graph')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-card-git-graph'));

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    const event = listener.mock.calls[0][0] as CustomEvent<{
      appId: string;
      kind?: string;
      workerKind?: string;
      icon?: string;
    }>;
    expect(event.detail.appId).toBe('git-graph');
    expect(event.detail.kind).toBe('worker');
    expect(event.detail.workerKind).toBe('git-graph');
    expect(event.detail.icon).toBe('git-branch');

    window.removeEventListener(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, listener);
  });

  // ── 失败态 ────────────────────────────────────────────────────────────────
  // 下面三条打的是 `load()` 的 catch 分支与 `LoadError`。此前这一整块没有覆盖，
  // 于是"sidecar 挂了"这个最常见的失败形态，在界面上与"你没装任何 MiniApp"完全
  // 同形（都是空态），用户会去 marketplace 里反复找一个不存在的问题。

  it('a failed catalog load renders the error instead of the empty state', async () => {
    apiGetJson.mockResolvedValueOnce({ ok: false, error: 'sidecar is not running' });

    const { findByText, queryByTestId } = render(<MiniAppCenter isActive={true} />);

    expect(await findByText('sidecar is not running')).toBeTruthy();
    // 反向护栏：失败态绝不能退回空态，否则两种故障在界面上无从区分。
    expect(queryByTestId('miniapp-center-empty')).toBeNull();
  });

  it('a non-Error rejection is stringified rather than rendering as undefined', async () => {
    // `e instanceof Error ? e.message : String(e)` 的右半支。少了 String(e)，代理层
    // 抛出的字符串会让作者在界面上看到字面量 "undefined"。
    apiGetJson.mockRejectedValueOnce('socket hang up');

    const { findByText } = render(<MiniAppCenter isActive={true} />);

    expect(await findByText('socket hang up')).toBeTruthy();
  });

  it('retry re-requests the catalog and recovers into the grid', async () => {
    apiGetJson
      .mockResolvedValueOnce({ ok: false, error: 'transient' })
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            id: 'icon-generator',
            name: 'Icon Generator',
            version: 1,
            path: '/b',
            source: 'installed',
            icon: 'palette',
            kind: 'iframe',
          },
        ],
      });

    const { getByText, queryByText, getByTestId } = render(<MiniAppCenter isActive={true} />);

    await waitFor(() => {
      expect(getByText('transient')).toBeTruthy();
    });

    // 查询串是本文件 react-i18next mock 的输出（`t: k => k`），不是真实文案，
    // 因此不构成文案存在性断言 —— 那由 i18n/resourceParity.test.ts 负责。
    fireEvent.click(getByText('miniappCenter.retry'));

    await waitFor(() => {
      expect(getByTestId('miniapp-center-card-icon-generator')).toBeTruthy();
    });
    // 旧错误必须被清掉：`load()` 开头就 setError(null)，否则重试成功后横幅会留下来。
    expect(queryByText('transient')).toBeNull();
    expect(apiGetJson).toHaveBeenCalledTimes(2);
  });

  it('browse-marketplace in the empty state dispatches OPEN_MARKETPLACE', async () => {
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [] });

    const listener = vi.fn();
    window.addEventListener(CUSTOM_EVENTS.OPEN_MARKETPLACE, listener);

    const { getByTestId, queryByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-browse-marketplace')).toBeTruthy();
    });

    // 空态只有一个市场入口：空态那块自带一个按钮，头部再放一个就是同一个
    // 动作出现两次。比"缺少入口"更糟的重复，用户会以为是两个不同的功能。
    expect(queryByTestId('miniapp-center-browse-marketplace-header')).toBeNull();

    fireEvent.click(getByTestId('miniapp-center-browse-marketplace'));

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    window.removeEventListener(CUSTOM_EVENTS.OPEN_MARKETPLACE, listener);
  });

  it('the header keeps a Marketplace entry once apps are installed', async () => {
    // 这条打的是「非空状态没有市场入口」这个缺口。此前唯一的入口在空态里，
    // 装上第一个小程序后整个空态就不渲染了，于是列表页再也无法回到市场 ——
    // 而市场是唯一能装第二个的地方。装得越多，越回不去。
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'icon-generator',
          name: 'Icon Generator',
          version: 1,
          path: '/b',
          source: 'installed',
          icon: 'palette',
          kind: 'iframe',
        },
      ],
    });

    const listener = vi.fn();
    window.addEventListener(CUSTOM_EVENTS.OPEN_MARKETPLACE, listener);

    const { getByTestId, queryByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-card-icon-generator')).toBeTruthy();
    });

    // 空态按钮此刻必须已经消失 —— 正是它的消失让头部入口成为唯一路径。
    expect(queryByTestId('miniapp-center-browse-marketplace')).toBeNull();
    expect(getByTestId('miniapp-center-browse-marketplace-header')).toBeTruthy();

    fireEvent.click(getByTestId('miniapp-center-browse-marketplace-header'));

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    window.removeEventListener(CUSTOM_EVENTS.OPEN_MARKETPLACE, listener);
  });

  it('hides the header Marketplace entry while loading and on a failed load', async () => {
    // items 为 null（加载中）或 []（加载失败，`load()` 的 catch 就是 setItems([])）
    // 时都不该冒出这个按钮：加载中它会闪现一下；失败时它指向的正是刚刚拉取
    // 失败的那份目录。
    //
    // 这里断言的是错误文案本身，不是某个 testid 的消失 —— 后者在没有装任何
    // 应用时恒为空，删掉整个按钮照样能过。
    apiGetJson.mockResolvedValueOnce({ ok: false, error: 'sidecar is not running' });

    const { findByText, queryByTestId } = render(<MiniAppCenter isActive={true} />);

    // 加载中：items 仍是 null。
    expect(queryByTestId('miniapp-center-browse-marketplace-header')).toBeNull();

    // 加载失败：items 变成 []，错误横幅出现，入口依然不该在。
    expect(await findByText('sidecar is not running')).toBeTruthy();
    expect(queryByTestId('miniapp-center-browse-marketplace-header')).toBeNull();
  });

  // ── 卸载 ──────────────────────────────────────────────────────────────────
  // 此前整个「卸载」链路只有 Marketplace 详情页一个入口。用户在自己的小程序
  // 列表页（MiniAppCenter）想删掉一个装错的应用时，只能先知道它的名字、去市场、
  // 搜到它、点进详情 —— 于是列表页看上去根本不支持删除。
  //
  // 下面四条锁住的是「危险操作必须先确认」这条不变量：单击删除按钮绝不能直接
  // 发出请求（Rust 那边是 remove_dir_all，不可逆），必须过 ConfirmDialog。

  const oneInstalled = [
    {
      id: 'icon-generator',
      name: 'Icon Generator',
      version: 3,
      path: '/b',
      source: 'installed',
      icon: 'palette',
      kind: 'iframe',
    },
  ];

  it('does NOT uninstall on a single click — it asks for confirmation first', async () => {
    // 反向护栏。这条如果哪天变红，说明有人把 ConfirmDialog 删了换成了直接调用：
    // 那意味着误点一次就永久删掉了用户的小程序和它的 storage.json。
    apiGetJson.mockResolvedValueOnce({ ok: true, items: oneInstalled });

    const { getByTestId, getByText } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-uninstall-icon-generator')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-uninstall-icon-generator'));

    // 确认框出现，且请求尚未发出。
    expect(getByText('miniappCenter.uninstallConfirmMessage')).toBeTruthy();
    expect(apiPostJson).not.toHaveBeenCalled();
  });

  it('confirming the dialog uninstalls the app and reloads the catalog', async () => {
    // 第二次列表返回空 —— 真实的 /api/miniapp/list 在卸载后当然不再有这个 app。
    // 用 mockResolvedValue 会让重拉拿到同一份列表，卡片当然还在，那种断言测不到
    // 「卸载后列表会更新」这件事。
    apiGetJson
      .mockResolvedValueOnce({ ok: true, items: oneInstalled })
      .mockResolvedValue({ ok: true, items: [] });
    apiPostJson.mockResolvedValue({ ok: true });

    const { getByTestId, getByText, queryByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-uninstall-icon-generator')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-uninstall-icon-generator'));
    // ConfirmDialog 的确认键文案走 common 命名空间，本文件的 t mock 会把它
    // 原样返回成 key，所以按 key 找。
    fireEvent.click(getByText('miniappCenter.uninstall'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith(
        '/api/miniapp/uninstall',
        expect.objectContaining({ appId: 'icon-generator' }),
      );
    });
    // 卸载后必须重拉列表，否则被删的应用会一直留在屏幕上。
    await waitFor(() => {
      expect(apiGetJson).toHaveBeenCalledTimes(2);
    });
    // 第二次列表返回空 → 卡片消失。
    expect(queryByTestId('miniapp-center-card-icon-generator')).toBeNull();
  });

  it('cancelling the dialog leaves the app installed and makes no request', async () => {
    apiGetJson.mockResolvedValue({ ok: true, items: oneInstalled });

    const { getByTestId, getByText, queryByText } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-uninstall-icon-generator')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-uninstall-icon-generator'));
    fireEvent.click(getByText('actions.cancel'));

    await waitFor(() => {
      expect(queryByText('miniappCenter.uninstallConfirmMessage')).toBeNull();
    });
    expect(apiPostJson).not.toHaveBeenCalled();
    expect(getByTestId('miniapp-center-card-icon-generator')).toBeTruthy();
  });

  it('a failed uninstall keeps the card and does not reload the catalog', async () => {
    // 后端拒绝（例如文件被占用）时页面必须留在原样：卡片还在，错误交给 toast。
    // 少了这条，一次失败的删除会把用户正在看的小程序从列表里弄丢。
    apiGetJson.mockResolvedValue({ ok: true, items: oneInstalled });
    apiPostJson.mockResolvedValue({ ok: false, error: 'remove_dir_all failed: EPERM' });

    const { getByTestId, getByText } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-uninstall-icon-generator')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-uninstall-icon-generator'));
    fireEvent.click(getByText('miniappCenter.uninstall'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalled();
    });
    expect(getByTestId('miniapp-center-card-icon-generator')).toBeTruthy();
    expect(apiGetJson).toHaveBeenCalledTimes(1);
  });

  it('clicking delete does not launch the MiniApp', async () => {
    // 删除按钮是启动按钮的兄弟节点而非子节点：早期把它放在 <button> 里，点击
    // 会同时冒泡到启动处理器，删掉应用的同一个手势还会把它打开。
    apiGetJson.mockResolvedValue({ ok: true, items: oneInstalled });

    const listener = vi.fn();
    window.addEventListener(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, listener);

    const { getByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-uninstall-icon-generator')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-uninstall-icon-generator'));

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(CUSTOM_EVENTS.OPEN_MINIAPP_SCENE, listener);
  });
});
