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

// react-i18next: return the key so we can grep for stable strings in tests.
// `hostLocale` is mutable so a test can pin the host language the page
// resolves `meta.i18n` against.
const { hostLocale } = vi.hoisted(() => ({ hostLocale: { current: 'zh-CN' } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: hostLocale.current } }),
}));

describe('Marketplace page', () => {
  afterEach(() => {
    apiGetJson.mockReset();
    apiPostJson.mockReset();
    vi.restoreAllMocks();
    window.location.hash = '';
    hostLocale.current = 'zh-CN';
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

    // ConfirmDialog opens → confirm by clicking the dialog's own confirm
    // button. Scope the lookup to the dialog: the page's Install button is
    // also a primary button, so an unscoped class match would find that one
    // first and just re-open the dialog.
    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
      const dialogConfirm = Array.from(dialog!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('marketplace.install'),
      );
      expect(dialogConfirm).toBeTruthy();
      fireEvent.click(dialogConfirm!);
    });

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/install', { appId: 'git-graph' });
    });
  });

  // `meta.i18n` is pass-through all the way from Rust to this card; if any
  // link in that chain drops it, the card silently shows the default language
  // and nothing else fails.
  const I18N_ITEM = {
    id: 'gomoku',
    name: '五子棋',
    description: '经典棋盘',
    version: 1,
    path: '/a',
    source: 'bundled',
    i18n: {
      locales: { 'en-US': { name: 'Gomoku', description: 'Classic board' } },
    },
  };

  it('renders the host-locale translation when one exists', async () => {
    hostLocale.current = 'en-US';
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [I18N_ITEM] });

    const { getByTestId } = render(<Marketplace isActive={true} />);
    await waitFor(() => expect(getByTestId('miniapp-card-gomoku')).toBeTruthy());

    const card = getByTestId('miniapp-card-gomoku').textContent ?? '';
    expect(card).toContain('Gomoku');
    expect(card).not.toContain('五子棋');
  });

  it('falls back to the top-level strings for an app with no i18n table', async () => {
    const { i18n: _dropped, ...noI18n } = I18N_ITEM;
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [noI18n] });

    const { getByTestId } = render(<Marketplace isActive={true} />);
    await waitFor(() => expect(getByTestId('miniapp-card-gomoku')).toBeTruthy());

    const card = getByTestId('miniapp-card-gomoku').textContent ?? '';
    expect(card).toContain('五子棋');
    expect(card).toContain('经典棋盘');
  });
});
