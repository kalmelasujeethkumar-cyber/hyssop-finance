import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render';
import { stubApiClient } from '../../test/stub-client';

/**
 * Shell interaction checks for `REQ-RESP-002`, `REQ-RESP-003`, and `REQ-RESP-006`.
 *
 * These read the collapsed-sidebar preference, prove the mobile drawer announces its state and
 * returns focus, and keep the primary navigation a single labelled landmark. They render the real
 * route tree, so a future change that duplicated the navigation or dropped the label would fail
 * here rather than only in the browser suite.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'hyssop.navigation.sidebar-collapsed';

async function renderShell(): Promise<void> {
  renderRoute({ client: stubApiClient() });
  await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
}

describe('application shell navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps one labelled primary navigation landmark listing every implemented section', async () => {
    await renderShell();

    const navigation = screen.getByRole('navigation', { name: 'Primary' });

    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Dashboard',
      'Members',
      'Income',
      'Expenses',
      'Reports',
      'Search',
      'Audit History',
      'Settings',
      'Status',
    ]);
  });

  it('collapses the sidebar through a stateful control and remembers the choice', async () => {
    const user = userEvent.setup();
    await renderShell();

    const collapse = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(collapse).toHaveAttribute('aria-pressed', 'false');

    await user.click(collapse);

    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true');
  });

  it('restores a previously collapsed sidebar from storage', async () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, 'true');
    await renderShell();

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens the mobile drawer, moves focus into it, and closes on Escape returning focus', async () => {
    const user = userEvent.setup();
    await renderShell();

    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'primary-navigation');

    await user.click(menu);

    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');

    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
          name: 'Dashboard',
        }),
      );
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }));
    });
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
