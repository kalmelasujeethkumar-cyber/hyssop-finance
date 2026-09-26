import { expect, test } from '@playwright/test';

test('foundation shell loads, is keyboard reachable, and reports API connectivity', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
  page.on('pageerror', (error: Error) => {
    browserErrors.push(error.message);
  });

  await page.goto('/');

  await expect(page.getByText('HYSSOP FINANCE')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toBeVisible();

  const healthStatus = page.getByTestId('health-status');
  await expect(healthStatus).toHaveAttribute('data-state', 'connected');
  await expect(healthStatus).toContainText('hyssop-finance-api');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  expect(browserErrors).toEqual([]);
});

test('an unknown address renders the not-found screen with a working way back', async ({
  page,
}) => {
  await page.goto('/no-such-screen');

  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to foundation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toBeVisible();
});
