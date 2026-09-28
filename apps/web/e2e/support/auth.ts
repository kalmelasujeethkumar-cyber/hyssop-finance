import { expect, type Page } from '@playwright/test';
import { E2E_ADMIN_IDENTIFIER, E2E_ADMIN_PASSWORD_VARIABLE } from './credentials';

/**
 * Signs in with the credential the global setup provisioned.
 *
 * The password is read from the environment that the setup hook set; it is never a literal in
 * this file, so no credential can be committed or replayed from the repository.
 */
export async function signIn(page: Page): Promise<void> {
  const password = process.env[E2E_ADMIN_PASSWORD_VARIABLE];

  if (password === undefined || password === '') {
    throw new Error(
      `${E2E_ADMIN_PASSWORD_VARIABLE} is missing. The browser acceptance run must go through ` +
        'the Playwright global setup.',
    );
  }

  await page.getByLabel(/Admin identifier/i).fill(E2E_ADMIN_IDENTIFIER);
  await page.getByLabel(/^Password/i).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Foundation' })).toBeVisible();
}
/** The session probe path, which is the one route that legitimately answers 401. */
const SESSION_PROBE_PATH = '/api/v1/auth/me';

/**
 * Collects browser errors so a silently broken page fails the test instead of passing.
 *
 * Chromium logs every failed network response as a console error but does not include the URL in
 * the message, and the session probe (`GET /api/v1/auth/me`) is *documented* to answer
 * `401 UNAUTHENTICATED` for a visitor with no session. That response is correct, intended
 * behavior, so each real session-probe 401 earns exactly one allowance to absorb its console
 * message. Any extra 401, any other console error, any uncaught exception, and any failed request
 * still fails the test, so this cannot hide a real defect.
 */
export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  let unusedProbeAllowances = 0;

  page.on('response', (response) => {
    if (response.status() === 401 && response.url().includes(SESSION_PROBE_PATH)) {
      unusedProbeAllowances += 1;
    }
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();

    if (unusedProbeAllowances > 0 && isUnauthorizedResourceMessage(text)) {
      unusedProbeAllowances -= 1;
      return;
    }

    errors.push(text);
  });
  page.on('pageerror', (error: Error) => {
    errors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    errors.push(`${request.method()} ${request.url()} failed: ${request.failure()?.errorText}`);
  });

  return errors;
}

/** The generic Chromium message for any 4xx/5xx response; the URL is not included. */
function isUnauthorizedResourceMessage(text: string): boolean {
  return /failed to load resource/i.test(text) && /\b401\b|unauthorized/i.test(text);
}
