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

    const { getByTestId } = render(<MiniAppCenter isActive={true} />);
    await waitFor(() => {
      expect(getByTestId('miniapp-center-browse-marketplace')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-center-browse-marketplace'));

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    window.removeEventListener(CUSTOM_EVENTS.OPEN_MARKETPLACE, listener);
  });
});
