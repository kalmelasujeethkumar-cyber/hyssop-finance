import { expect, test } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-AUTH-001` and `TEST-E2E-001`.
 *
 * Authority: `docs/10-TEST-PLAN.md` (the E2E layer proves the required user journeys in a real
 * browser) and `docs/06-API-SPEC.md` (the four authentication routes). Every assertion here is
 * about what the real API actually returned; nothing is stubbed.
 */
test.describe('admin authentication', () => {
  test('an unauthenticated visitor is shown the sign-in screen and no product screen', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
  });

  test('the Admin signs in and reaches the product screen', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    await expect(page.getByText('Demo Admin')).toBeVisible();
    // Dashboard is the signed-in landing screen. `health-status` belongs to the Status
    // screen, which `foundation.spec.ts` covers on its own navigation.
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test('a wrong password is reported without revealing which value was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Admin identifier/i).fill('admin');
    await page.getByLabel(/^Password/i).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The identifier or password is incorrect.');
    await expect(alert).not.toContainText(/password is wrong|unknown identifier/i);
    await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
  });

  test('every product address requires a session, including an unknown one', async ({ page }) => {
    await page.goto('/no-such-screen');

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCount(0);
  });

  test('the session is kept in an HTTP-only cookie and never in browser storage', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page);

    const stored = await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }));

    expect(stored).toEqual({ local: 0, session: 0 });

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === 'hyssop_session');

    expect(sessionCookie).toBeDefined();
    // If the cookie were script-readable, the page itself could read the session secret.
    expect(sessionCookie?.httpOnly).toBe(true);
  });

  test('the CSRF cookie is script-readable by design while the session cookie is not', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page);

    const cookies = await page.context().cookies();
    const csrfCookie = cookies.find((cookie) => cookie.name === 'hyssop_csrf');

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie?.httpOnly).toBeFalsy();
  });

  test('a session the API no longer accepts returns the Admin to the sign-in screen', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page);

    // The real API is asked to reject this session: the cookie value is replaced with one it
    // has never issued, which is exactly what an expired or revoked session looks like to it.
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === 'hyssop_session');

    await page.context().addCookies([
      {
        name: 'hyssop_session',
        value: 'this-session-was-never-issued-by-the-api',
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
      },
    ]);

    await page.reload();

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
    expect(sessionCookie?.value).not.toBe('this-session-was-never-issued-by-the-api');
  });

  test('signing out ends the session and returns the Admin to the sign-in screen', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    // The revocation must be real: going back must not restore the product screen.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });
});
