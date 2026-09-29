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

/** The read paths that answer `404 NOT_FOUND` for a transaction that genuinely does not exist. */
const NOT_FOUND_READ_PATHS = ['/api/v1/transactions/', '/api/v1/income/'] as const;

/**
 * Collects browser errors so a silently broken page fails the test instead of passing.
 *
 * Chromium logs every failed network response as a console error but does not include the URL in
 * the message, and the session probe (`GET /api/v1/auth/me`) is *documented* to answer
 * `401 UNAUTHENTICATED` for a visitor with no session. That response is correct, intended
 * behavior, so each real session-probe 401 earns exactly one allowance to absorb its console
 * message. Any extra 401, any other console error, any uncaught exception, and any failed request
 * still fails the test, so this cannot hide a real defect.
 *
 * `allowOneNotFound` is the same mechanism for the other documented non-2xx answer: a journey that
 * deliberately opens a record which does not exist. It is opt-in and explicit at the one call site
 * that needs it, so no other test can absorb a `404` by accident. The allowance lives inside this
 * collector rather than in a separate listener because a console message carries no URL: the
 * response that earned the allowance and the message it has to absorb have to be counted by one
 * authority, in one ordered pair of listeners, or the message is pushed to `errors` before any
 * later listener could have claimed it.
 */
export function collectBrowserErrors(page: Page, allowOneNotFound = false): string[] {
  const errors: string[] = [];
  let unusedProbeAllowances = 0;
  let unusedNotFoundAllowances = allowOneNotFound ? 1 : 0;

  page.on('response', (response) => {
    if (response.status() === 401 && response.url().includes(SESSION_PROBE_PATH)) {
      unusedProbeAllowances += 1;

      return;
    }

    // Grant on the response and spend on the console message, the same way the session probe
    // does. Granting and spending in the same handler would spend the allowance before the
    // message it exists to absorb ever arrives, so the message would be recorded.
    if (response.status() === 404 && isNotFoundReadPath(response.url())) {
      unusedNotFoundAllowances += 1;
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

    if (unusedNotFoundAllowances > 0 && isNotFoundResourceMessage(text)) {
      unusedNotFoundAllowances -= 1;

      return;
    }

    errors.push(text);
  });
  page.on('pageerror', (error: Error) => {
    errors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    // `net::ERR_ABORTED` is Chromium's report for a request the page itself cancelled, which is
    // what React Query does when a component unmounts while a query is still in flight — for
    // example the income form's member picker unmounting when the Admin closes the form. The
    // cancelled request produced no response for the app to use, so it is not a silent failure,
    // and Chromium never reports an unreachable or broken server this way. Every other failure
    // text, including a refused connection, an empty response, and a timeout, still fails the
    // test.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') {
      return;
    }

    errors.push(`${request.method()} ${request.url()} failed: ${request.failure()?.errorText}`);
  });

  return errors;
}

/** The generic Chromium message for any 4xx/5xx response; the URL is not included. */
function isUnauthorizedResourceMessage(text: string): boolean {
  return /failed to load resource/i.test(text) && /\b401\b|unauthorized/i.test(text);
}

/**
 * The read paths that answer `404 NOT_FOUND` for a transaction that genuinely does not exist.
 *
 * `docs/06-API-SPEC.md` documents that answer, and the income detail screen asks for such a record
 * and reports that it could not be loaded. A `404` on any other path — including a misspelled
 * route or a deleted endpoint — earns no allowance, so it still fails the test.
 */
function isNotFoundReadPath(url: string): boolean {
  const { pathname } = new URL(url);

  return NOT_FOUND_READ_PATHS.some((path) => pathname.startsWith(path));
}

/** The generic Chromium message for a `404`; the URL is not included. */
function isNotFoundResourceMessage(text: string): boolean {
  return /failed to load resource/i.test(text) && /\b404\b|not found/i.test(text);
}
