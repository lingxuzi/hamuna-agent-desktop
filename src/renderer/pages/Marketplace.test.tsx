// Marketplace.test.tsx — List + Detail + Install flow.
//
// Confirms: list renders cards from `listMarketplace()`; clicking a card
// routes to detail; install button triggers `installMarketplace()` and
// reloads. Mounted in `dom` pool because it uses real React + jsdom.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Marketplace from './Marketplace';

const apiGetJson = vi.fn();
const apiPostJson = vi.fn();
vi.mock('@/api/apiFetch', () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiPostJson: (...args: unknown[]) => apiPostJson(...args),
}));

// Toast hook returns no-op stubs
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

// react-i18next: return the key so we can grep for stable strings in tests
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('Marketplace page', () => {
  afterEach(() => {
    apiGetJson.mockReset();
    apiPostJson.mockReset();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('renders list of MiniApps from listMarketplace()', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [
        { id: 'git-graph', name: 'Git Graph', version: 1, path: '/a', source: 'bundled' },
        { id: 'icon-generator', name: 'Icon Generator', version: 3, path: '/b', source: 'installed' },
      ],
    });

    const { getByTestId } = render(<Marketplace isActive={true} />);

    await waitFor(() => {
      expect(getByTestId('miniapp-card-git-graph')).toBeTruthy();
      expect(getByTestId('miniapp-card-icon-generator')).toBeTruthy();
    });
  });

  it('routes to detail on card click', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'git-graph', name: 'Git Graph', version: 1, path: '/a', source: 'bundled' }],
    });

    const { getByTestId, queryByTestId } = render(<Marketplace isActive={true} />);

    await waitFor(() => {
      expect(getByTestId('miniapp-card-git-graph')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-card-git-graph'));

    await waitFor(() => {
      // Detail page shows the back button
      expect(getByTestId('marketplace-back')).toBeTruthy();
      // Install button (bundled → installable)
      expect(getByTestId('marketplace-install')).toBeTruthy();
    });

    // The card list should be gone
    expect(queryByTestId('miniapp-card-git-graph')).toBeNull();
  });

  it('triggers installMarketplace when the install button is clicked', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'git-graph', name: 'Git Graph', version: 1, path: '/a', source: 'bundled' }],
    });
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'git-graph', name: 'Git Graph', version: 1, path: '/a', source: 'installed' }],
    });
    apiPostJson.mockResolvedValueOnce({ ok: true, appId: 'git-graph', version: 2, path: '/x' });

    const { getByTestId } = render(<Marketplace isActive={true} />);

    await waitFor(() => {
      expect(getByTestId('miniapp-card-git-graph')).toBeTruthy();
    });

    fireEvent.click(getByTestId('miniapp-card-git-graph'));

    await waitFor(() => {
      expect(getByTestId('marketplace-install')).toBeTruthy();
    });

    fireEvent.click(getByTestId('marketplace-install'));

    // ConfirmDialog opens → confirm by clicking the dialog's confirm button
    // (it has bg-[var(--button-primary-bg)] distinguishing it from the page
    // Install button which uses bg-[var(--accent)])
    await waitFor(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const dialogConfirm = buttons.find(
        (b) =>
          b.className.includes('bg-[var(--button-primary-bg)]') &&
          b.textContent?.includes('marketplace.install'),
      );
      expect(dialogConfirm).toBeTruthy();
      fireEvent.click(dialogConfirm!);
    });

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/install', { appId: 'git-graph' });
    });
  });
});
