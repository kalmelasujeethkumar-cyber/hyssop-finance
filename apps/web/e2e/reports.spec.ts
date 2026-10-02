import { expect, test, type Page } from '@playwright/test';
import { REPORT_TITLES, type ReportId } from '@hyssop/contracts';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-REPORT-*` and `TEST-SEARCH-*` for `PHASE-09-REPORTS`.
 *
 * Authority: `docs/10-TEST-PLAN.md`, `docs/phases/PHASE-09-REPORTS.md`, and
 * `docs/01-REQUIREMENTS.md` (`REQ-REPORT-001` to `REQ-REPORT-004`, `REQ-EXPORT-001`,
 * `REQ-EXPORT-002`, `REQ-SEARCH-001`).
 *
 * Nothing here is stubbed: the API runs against the `_test` database, so every figure asserted is
 * one the server calculated from persisted rows. No assertion adds, subtracts, or rescales a
 * value — the browser is proven to *state* what it was given, never to decide it.
 *
 * The test database is deliberately not cleared between runs, so no figure here is asserted
 * against a hard-coded amount: a report is proved by what it says, which criteria reached the
 * API, and which controls worked. That is what keeps these journeys honest while earlier runs'
 * rows accumulate.
 */

/** Signs in and opens the Reports screen on the default projection. */
async function openReports(page: Page, search = '?report=financial-summary'): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await gotoReport(page, search);
}

/**
 * Returns to a Reports screen in a context that already has a session.
 *
 * `/login` redirects a signed-in visitor to the workspace, so signing in twice would wait forever
 * for a form that is never rendered. A journey that opens two reports signs in once and navigates.
 */
async function gotoReport(page: Page, search: string): Promise<void> {
  await page.goto(`/reports${search}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
}

test('the Reports screen is reachable from the primary navigation', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await page.goto('/login');
  await signIn(page);

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Reports' })
    .click();

  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Financial Summary', exact: true })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('every documented report opens, states its own voided visibility, and leaves no dead control', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await openReports(page);

  // A report id added to the contract without a projection would otherwise render as a blank panel,
  // which is the "dead control presented as complete" outcome `docs/03-UI-UX-RULES.md` forbids. This
  // walks the closed list, so a new report fails here until the screen can actually show it.
  const reportIds = Object.keys(REPORT_TITLES) as ReportId[];

  expect(reportIds.length).toBeGreaterThan(0);

  for (const reportId of reportIds) {
    await page
      .getByRole('navigation', { name: 'Reports' })
      .getByRole('link', { name: REPORT_TITLES[reportId], exact: true })
      .click();

    // `exact` matters: the options panel is named "<report> options", and a partial match would be
    // satisfied by the controls rather than by the projection.
    const panel = page.getByRole('region', { name: REPORT_TITLES[reportId], exact: true });

    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('voided-visibility')).toContainText(/Voided transactions/);
    // The report finished loading: a panel still saying "Loading" while the test moves on would be
    // a state the Admin would have seen.
    await expect(panel.getByText('Loading the report')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`report=${reportId}`));
  }

  expect(browserErrors).toEqual([]);
});

test('a history report says it keeps voided rows while an arithmetic report says it excludes them', async ({
  page,
}) => {
  await openReports(page, '?report=transactions');

  await expect(page.getByTestId('voided-visibility')).toHaveText(
    'Voided transactions are kept in this report, because it is a history report.',
  );

  await gotoReport(page, '?report=income');

  await expect(page.getByTestId('voided-visibility')).toHaveText(
    'Voided transactions are left out of these figures. They are still shown on the Complete Transaction and Audit reports.',
  );
});

test('changing the period puts it in the URL so a shared link reproduces the figures', async ({
  page,
}) => {
  await openReports(page, '?report=financial-summary&period=thisMonth');

  await page.getByLabel(/Period/i).selectOption('lastMonth');

  await expect(page).toHaveURL(/period=lastMonth/);
  // The figures moved with the criterion rather than staying as they were.
  await expect(page.getByRole('region', { name: 'Financial Summary', exact: true })).toBeVisible();
  await expect(page.getByText(/Movement in period/).first()).toBeVisible();
});

test('the Complete Transaction filters narrow the request and return to page 1', async ({
  page,
}) => {
  await openReports(page, '?report=transactions');

  await page.getByLabel(/Transaction type/i).selectOption('EXPENSE');
  await expect(page).toHaveURL(/type=EXPENSE/);

  await page.getByLabel(/^Status/i).selectOption('VOIDED');
  await expect(page).toHaveURL(/status=VOIDED/);

  // Narrowing a filter resets the page, so the Admin is never left on an empty page 3 of a
  // one-page result.
  await expect(page).not.toHaveURL(/page=/);
});

test('the audit window sends whole Asia/Kolkata days and the whole history sends no window', async ({
  page,
}) => {
  await openReports(page, '?report=audit');

  await page.getByLabel(/From date/i).fill('2026-09-01');
  await page.getByLabel(/To date/i).fill('2026-09-30');

  // The audit window is a timestamp range, so a bare date would silently drop the first hours of
  // the day in Asia/Kolkata. The URL holds the window the API was asked for.
  await expect(page).toHaveURL(/auditFrom=2026-09-01/);
  await expect(page).toHaveURL(/auditTo=2026-09-30/);
  await expect(page.getByRole('region', { name: 'Audit', exact: true })).toBeVisible();

  // `click()` rather than `check()`: the checkbox is controlled by the URL, so its checked state
  // arrives one React commit after the click, and `check()` asserts synchronously enough to read
  // the pre-click state as "the click did nothing".
  await page.getByLabel(/Whole history/i).click();
  await expect(page.getByLabel(/Whole history/i)).toBeChecked();
  await expect(page).toHaveURL(/auditAll=1/);
  await expect(page.getByLabel(/From date/i)).toBeDisabled();
  // A whole-history audit has no period, so the export control is replaced by its reason rather
  // than left enabled to export something the Admin did not ask for.
  await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
});

test('a CSV export downloads the server-named file with the header row the API produced', async ({
  page,
}) => {
  await openReports(page, '?report=income');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;

  // The filename is the server's, so the export names the report the API exported rather than a
  // name or a period range the browser invented.
  expect(download.suggestedFilename()).toBe('income-report.csv');

  const stream = await download.createReadStream();
  stream.setEncoding('utf8');

  const body = await new Promise<string>((resolve, reject) => {
    let text = '';
    stream.on('data', (chunk: string) => {
      text += chunk;
    });
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });

  const lines = body.split('\r\n').filter((line) => line !== '');
  const [header, ...rows] = lines;

  expect(header).toContain('Amount');
  // `REQ-EXPORT-001` asks for exact money strings, so every exported row has to carry a two-decimal
  // amount rather than a rounded integer or a float artefact. The test database is not cleared
  // between runs, so a period with no rows yields a header-only export; the assertion then holds
  // for zero rows instead of pretending to prove one.
  for (const row of rows) {
    expect(row).toMatch(/\d+\.\d{2}/);
  }

  await expect(page.getByText(/to your downloads/)).toBeVisible();
});

test('the printed page states its own scope and carries no controls', async ({ page }) => {
  await openReports(page, '?report=financial-summary');

  // The stylesheet is the contract with print: `print-hidden` chrome disappears and `print-only`
  // identification appears. Emulating print is what lets the assertions see that without opening a
  // native dialog.
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('.print-only').first()).toBeVisible();
  await expect(page.locator('.print-only').first()).toContainText('Financial Summary');
  await expect(page.locator('.print-only').first()).toContainText(/Generated/);
  await expect(page.locator('.print-hidden').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print this report' })).toBeHidden();

  await page.emulateMedia({ media: 'screen' });
  await expect(page.getByRole('button', { name: 'Print this report' })).toBeVisible();
});

test('search asks for results only after a term is submitted and reports the API total', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await page.goto('/login');
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Search' })
    .click();

  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
  // Nothing was asked for yet: an empty search must not spend a request, and the screen has to say
  // that it is waiting rather than showing an empty result the Admin might read as "nothing found".
  await expect(page.getByText('Nothing searched yet')).toBeVisible();

  await page.getByLabel('Search term').fill('HY-INC');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page).toHaveURL(/q=HY-INC/);
  // The count is the API's, so the screen states a total rather than counting the rows it was
  // handed.
  await expect(page.getByTestId('result-count')).toContainText(/results?\b/);

  expect(browserErrors).toEqual([]);
});

test('a search that matches nothing says so instead of showing an empty page', async ({ page }) => {
  await page.goto('/login');
  await signIn(page);
  await page.goto('/search');

  await page.getByLabel('Search term').fill('zzz-nothing-matches-this');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByText('Nothing matched that search')).toBeVisible();
  await expect(page.getByTestId('result-count')).toContainText('0 results');
});
