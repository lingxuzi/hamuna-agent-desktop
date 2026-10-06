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

/**
 * The half of the catalog journey the tests above never reached: removal,
 * failure recovery, and the two empty states.
 *
 * Real v8 coverage put `Marketplace.tsx` at 78.2% lines with 101 uncovered
 * statements, concentrated here — the uninstall ConfirmDialog, `LoadError`'s
 * retry button, and `PlainEmpty` never rendered at all. Those are not cosmetic
 * branches: uninstall is how a user gets an app off their machine, and the
 * retry button is the only recovery path when the list request fails.
 */
describe('Marketplace page / removal, failure and empty states', () => {
  // `description` is required by meta-schema.ts and Rust's `summary_for`
  // coerces a missing one to `""` (commands.rs:643), so every fixture here
  // carries one — a fixture without it is not a shape the renderer can see,
  // and the search test below would fail on its own bad input.
  const INSTALLED = {
    id: 'icon-generator',
    name: 'Icon Generator',
    description: 'Make an icon',
    version: 3,
    path: '/b',
    source: 'installed' as const,
  };

  afterEach(() => {
    apiGetJson.mockReset();
    apiPostJson.mockReset();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  /** Scope a click to the dialog's own button — the page button shares the label. */
  function confirmInDialog(text: string) {
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const button = Array.from(dialog!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    );
    expect(button).toBeTruthy();
    fireEvent.click(button!);
  }

  async function openInstalledDetail() {
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [INSTALLED] });
    const queries = render(<Marketplace isActive={true} />);
    await waitFor(() => expect(queries.getByTestId('miniapp-card-icon-generator')).toBeTruthy());
    fireEvent.click(queries.getByTestId('miniapp-card-icon-generator'));
    await waitFor(() => expect(queries.getByTestId('marketplace-uninstall')).toBeTruthy());
    return queries;
  }

  it('uninstalls through the confirm dialog and then reloads the catalog', async () => {
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [INSTALLED] });
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [INSTALLED] });
    apiPostJson.mockResolvedValueOnce({ ok: true, appId: 'icon-generator' });

    const { getByTestId } = render(<Marketplace isActive={true} />);
    await waitFor(() => expect(getByTestId('miniapp-card-icon-generator')).toBeTruthy());
    fireEvent.click(getByTestId('miniapp-card-icon-generator'));
    await waitFor(() => expect(getByTestId('marketplace-uninstall')).toBeTruthy());

    // Uninstall is destructive, so it must go through a confirm step first.
    fireEvent.click(getByTestId('marketplace-uninstall'));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    expect(apiPostJson).not.toHaveBeenCalled();

    await waitFor(() => confirmInDialog('marketplace.uninstall'));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith('/api/miniapp/uninstall', {
        appId: 'icon-generator',
      });
    });
  });

  it('does NOT uninstall when the confirm dialog is dismissed', async () => {
    const { getByTestId } = await openInstalledDetail();

    fireEvent.click(getByTestId('marketplace-uninstall'));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    // Cancel is the dialog's non-primary action.
    const dialog = document.querySelector('[role="dialog"]')!;
    const cancel = Array.from(dialog.querySelectorAll('button')).find(
      (b) => !b.textContent?.includes('marketplace.uninstall'),
    );
    expect(cancel).toBeTruthy();
    fireEvent.click(cancel!);

    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(apiPostJson).not.toHaveBeenCalled();
  });

  it('surfaces a load failure and recovers when the user hits retry', async () => {
    apiGetJson.mockRejectedValueOnce(new Error('sidecar is not running'));
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [INSTALLED] });

    const { getByTestId, getByText, queryByText } = render(<Marketplace isActive={true} />);

    await waitFor(() => expect(getByText('sidecar is not running')).toBeTruthy());
    // A failed list must not masquerade as an empty catalog.
    expect(queryByText('marketplace.empty')).toBeNull();

    fireEvent.click(getByText('miniappCenter.retry'));

    await waitFor(() => expect(getByTestId('miniapp-card-icon-generator')).toBeTruthy());
    expect(apiGetJson).toHaveBeenCalledTimes(2);
  });

  it('renders the empty state when the catalog itself is empty', async () => {
    apiGetJson.mockResolvedValueOnce({ ok: true, items: [] });

    const { getByText, queryByText } = render(<Marketplace isActive={true} />);

    await waitFor(() => expect(getByText('marketplace.empty')).toBeTruthy());
    // "Nothing installed yet" and "your filter matched nothing" are different
    // states; conflating them would tell the user to clear filters they never set.
    expect(queryByText('marketplace.noResults')).toBeNull();
  });

  it('offers a way back when a search matches nothing, and clearing restores the list', async () => {
    apiGetJson.mockResolvedValueOnce({
      ok: true,
      items: [
        INSTALLED,
        { ...INSTALLED, id: 'git-graph', name: 'Git Graph', description: 'Repo graph' },
      ],
    });

    const { getByLabelText, getByText, getByTestId, queryByTestId } = render(
      <Marketplace isActive={true} />,
    );
    await waitFor(() => expect(getByTestId('miniapp-card-icon-generator')).toBeTruthy());

    fireEvent.change(getByLabelText('marketplace.searchPlaceholder'), {
      target: { value: 'nothing-matches-this' },
    });

    await waitFor(() => expect(getByText('marketplace.noResults')).toBeTruthy());
    expect(queryByTestId('miniapp-card-icon-generator')).toBeNull();

    fireEvent.click(getByText('marketplace.clearFilters'));

    await waitFor(() => expect(getByTestId('miniapp-card-icon-generator')).toBeTruthy());
  });
});
