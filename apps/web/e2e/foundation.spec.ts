import { expect, test } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * Application shell checks, run as a signed-in Admin because the whole product area now sits
 * behind the session guard.
 */
test('the dashboard is the landing screen and the shell is keyboard reachable', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await page.goto('/login');
  await signIn(page);

  await expect(page.getByText('HYSSOP FINANCE', { exact: true })).toBeVisible();
  // `docs/03-UI-UX-RULES.md` makes the dashboard the signed-in landing screen, so signing in must
  // arrive on the financial summary rather than on a status page.
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  expect(browserErrors).toEqual([]);
});

test('the status screen reports API connectivity and states what is not built', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page);

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Status' })
    .click();

  await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toBeVisible();

  const healthStatus = page.getByTestId('health-status');
  await expect(healthStatus).toHaveAttribute('data-state', 'connected');
  await expect(healthStatus).toContainText('hyssop-finance-api');

  // Honesty is part of the shell: the screen says which sections do not exist rather than
  // implying a finished product.
  await expect(
    page.getByRole('heading', { level: 2, name: 'What is not in this build yet' }),
  ).toBeVisible();
});

test('an unknown address renders the not-found screen with a working way back', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page);

  await page.goto('/no-such-screen');

  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
