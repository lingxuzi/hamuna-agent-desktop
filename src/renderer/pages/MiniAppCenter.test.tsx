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
});