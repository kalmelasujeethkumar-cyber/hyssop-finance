import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-E2E-001` for the dashboard.
 *
 * Authority: `docs/phases/PHASE-08-DASHBOARD.md` requires real period-aware figures, working
 * filters, real charts with accessible summaries, recent activity, and working quick actions, and
 * forbids hard-coded totals, static data, or decorative controls.
 *
 * Nothing here is stubbed. The API runs against the `_test` database, so every figure asserted is
 * one the server calculated from persisted `ACTIVE` transactions. Where the test cannot know an
 * exact amount - because earlier runs also wrote into the same database - it asserts the *relationship*
 * the contract guarantees instead of inventing a number: that a filter sends a real request and
 * changes the reported period, that a row recorded in this run appears in the recent list at its
 * exact amount, and that the movement and balance projections stay separately labelled.
 */

/** A unique marker, so a row written by this run is identifiable among earlier runs. */
function uniqueRunTag(): string {
  return `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, '0')}`;
}

/** Today's date in Asia/Kolkata as `YYYY-MM-DD`, the zone every business date is recorded in. */
function currentBusinessDate(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);

  return ist.toISOString().slice(0, 10);
}

/**
 * The line that states which period produced the figures.
 *
 * Addressed by its own shape rather than by a bare text match: the shell footer also names
 * `Asia/Kolkata`, and the recent list says "Showing the N most recent", so a loose locator would
 * either resolve to two nodes or assert about the wrong sentence.
 */
function periodLine(page: Page): Locator {
  return page.locator('p').filter({ hasText: /Showing .+ to .+ \(Asia\/Kolkata\)/ });
}

/** Signs in, which lands on the dashboard because that is the signed-in landing screen. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  // The heading is static, so it appears before the figures. The period line is rendered only when
  // the projection has arrived, so waiting for it is what makes the assertions below about real
  // server output rather than about the loading screen.
  await expect(periodLine(page)).toBeVisible();
}

/** The recent-transactions row for one unique description, and the amount shown on it. */
function recentRow(page: Page, description: string): Locator {
  return page.getByRole('listitem').filter({ hasText: description });
}

/** Records one income row through the real form and returns the reference the API allocated. */
async function recordIncome(
  page: Page,
  options: { readonly incomeType: string; readonly amount: string; readonly description: string },
): Promise<string> {
  await page.getByRole('link', { name: 'Record income', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Income' })).toBeVisible();
  await page.getByRole('button', { name: 'Record income', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toBeVisible();

  await page.getByLabel('Income type (required)').selectOption(options.incomeType);
  await page.getByLabel('Amount (required)').fill(options.amount);
  await page.getByLabel('Payment method (required)').selectOption('CASH');
  await page.getByLabel('Business date (required)').fill(currentBusinessDate());
  await page.getByLabel('Description (optional)').fill(options.description);
  await page.getByRole('button', { name: 'Record income', exact: true }).click();

  const confirmation = page.getByText(/was recorded as HY-INC-\d{6}\./);
  await expect(confirmation).toBeVisible();

  const referenceId = /HY-INC-\d{6}/.exec((await confirmation.textContent()) ?? '')?.[0];

  expect(referenceId).toMatch(/^HY-INC-\d{6}$/);

  return referenceId ?? '';
}

test('the dashboard reports real figures with the movement and balance kept apart', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  // The period is stated with the inclusive business dates and the timezone, because "as of
  // 30 Sep" means something different to a reader in another zone.
  await expect(periodLine(page)).toContainText('Asia/Kolkata');
  await expect(periodLine(page)).toContainText(/Showing \S+ .+ to .+ \(Asia\/Kolkata\)/);

  // Every required metric is present. Scoped to the main region because the shell navigation
  // carries the same word "Members" and a bare text match would assert about the nav item. The
  // amounts are the server's own, so this asserts that an exact INR string is on screen rather
  // than asserting a number that an earlier run into the same database may have changed.
  const main = page.getByRole('main');

  for (const label of ['Total income', 'Total expenses', 'Total available', 'Members']) {
    await expect(main.getByText(label, { exact: true })).toBeVisible();
  }

  await expect(main.getByText(/^[-−]?₹[\d,]+\.\d{2}$/).first()).toBeVisible();

  // The member count is a count, not a rupee amount: a card that ran it through currency
  // formatting would be making a wrong financial claim rather than a cosmetic slip.
  await expect(main.getByText(/On the roll by/)).toBeVisible();

  // `REQ-FIN-014` requires the two projections to stay separately labelled rather than being
  // collapsed into one balance number.
  // Panel titles are headings, so they are addressed as headings rather than as text: the trend
  // chart's own accessible name also begins "Income and expenses", and a bare text match would
  // resolve to both and assert about neither.
  for (const panel of [
    'Income and expenses',
    'Monthly trend',
    'Member contributions',
    'Income breakdown',
    'Expense breakdown',
    'Recent transactions',
    'Quick actions',
  ]) {
    await expect(main.getByRole('heading', { name: panel, exact: true })).toBeVisible();
  }

  expect(browserErrors).toEqual([]);
});

test('every period preset sends a real request and states the period it used', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  const periodSelect = page.getByLabel('Period', { exact: true });

  // Each documented preset is exercised and the screen has to name the period it is now showing.
  // The presets are walked in an order that never returns to a period already visited, because
  // the projection for a period the browser has already fetched is served from the query cache -
  // which is correct behaviour, but would make a network assertion depend on visit order.
  const presets = [
    { value: 'today', label: 'Today' },
    { value: 'thisMonth', label: 'This Month' },
    { value: 'lastMonth', label: 'Last Month' },
    { value: 'last3Months', label: 'Last 3 Months' },
    { value: 'last6Months', label: 'Last 6 Months' },
    { value: 'thisYear', label: 'This Year' },
    { value: 'lastYear', label: 'Last Year' },
  ] as const;

  for (const preset of presets) {
    await periodSelect.selectOption(preset.value);

    // Asserted on the period line rather than on the `<option>`, because a selected option exists
    // before it has been chosen and a hidden one is still in the document - neither would show
    // that anything was actually applied.
    await expect(periodLine(page)).toContainText(preset.label);
    // The period lives in the URL, so a bookmark or a shared link reproduces the same figures.
    await expect(page).toHaveURL(new RegExp(`period=${preset.value}`));
  }

  // Separately, a cold load of a period URL proves the screen is driven by a real projection
  // request rather than by anything already in memory. Watching only the selections above would
  // pass even against a filter that redrew cached figures without ever asking the API.
  const requestedSearches: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/dashboard')) {
      requestedSearches.push(new URL(request.url()).search);
    }
  });

  await page.goto('/?period=lastYear');
  await expect(periodLine(page)).toContainText('Last Year');
  expect(requestedSearches.filter((search) => search.includes('period=lastYear'))).not.toHaveLength(
    0,
  );

  expect(browserErrors).toEqual([]);
});

test('a custom range is applied only on Apply and an inverted range is refused', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  const requestedPaths: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/dashboard')) {
      requestedPaths.push(new URL(request.url()).search);
    }
  });

  await page.getByLabel('Period', { exact: true }).selectOption('custom');

  // The bounds appear only after Custom range is chosen, so the common case is not a wall of
  // inputs, and a half-typed date is not sent as a period.
  await page.getByLabel('From', { exact: true }).fill('2026-03-31');
  await page.getByLabel('To', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Apply range' }).click();

  await expect(page.getByText('The start date must not be after the end date.')).toBeVisible();
  expect(requestedPaths.filter((search) => search.includes('from='))).toHaveLength(0);

  await page.getByLabel('From', { exact: true }).fill('2026-01-01');
  await page.getByLabel('To', { exact: true }).fill('2026-03-31');
  await page.getByRole('button', { name: 'Apply range' }).click();

  await expect(page).toHaveURL(/from=2026-01-01/);
  await expect(page).toHaveURL(/to=2026-03-31/);
  await expect(page.getByText(/1 Jan 2026 to 31 Mar 2026/)).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('a transaction recorded in this run appears in recent activity at its exact amount', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);
  const description = uniqueRunTag();

  await openDashboard(page);
  const referenceId = await recordIncome(page, {
    incomeType: 'OFFERING',
    amount: '1234.56',
    description,
  });

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  const row = recentRow(page, description);

  // The row is the server's own row: the reference the API allocated and the exact grouped
  // amount, not an optimistic placeholder.
  await expect(row).toContainText(referenceId);
  await expect(row).toContainText('1,234.56');
  // The row states which side of the ledger it came from, so a reader is not left inferring it
  // from the sign or the colour.
  await expect(row).toContainText('Income');

  // The row links to the real detail screen rather than being inert text.
  await row.getByRole('link', { name: 'View details' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /received$/ })).toBeVisible();
  await expect(page.getByText(referenceId).first()).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('the quick actions lead to working screens', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  const quickActions = page.getByRole('region', { name: 'Quick actions' });

  await quickActions.getByRole('link', { name: 'Manage members' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Expenses' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
  await page.getByRole('button', { name: 'Record expense', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record expense' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  await quickActions.getByRole('link', { name: 'Record income' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Income' })).toBeVisible();
  await page.getByRole('button', { name: 'Record income', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('the charts state the same numbers in text rather than only drawing them', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  // Each chart carries an accessible name and a text equivalent, because a hue-only distinction
  // fails both a colour-blind reader and a printed page.
  await expect(
    page.getByRole('img', { name: /Income and expenses for each month in the selected period/i }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /Income by type/i })).toBeVisible();

  // A breakdown renders as an arc only when the period actually has slices. Whether the shared
  // test database holds an expense in the default period is not something this journey can assume,
  // so what it asserts is the documented rule either way: an arc with a text legend, or an
  // explicit empty state - never a blank panel and never a chart with no data behind it.
  const expenseDonut = page.getByRole('img', { name: /Expenses by category/i });
  const expenseEmpty = page.getByText('No expenses in this period');

  await expect(expenseDonut.or(expenseEmpty)).toBeVisible();

  // The trend table is the readable form of the bars, so the same figures can be read, copied,
  // and printed.
  const trendTable = page.getByRole('table', {
    name: 'Income, expenses, and movement for each month',
  });

  await expect(trendTable).toBeVisible();
  await expect(trendTable.getByRole('row').first()).toContainText('Month');

  expect(browserErrors).toEqual([]);
});

test('the dashboard figures refresh after a write rather than staying stale', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const description = uniqueRunTag();

  await openDashboard(page);
  await recordIncome(page, { incomeType: 'OFFERING', amount: '2500.00', description });

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // The write is reflected because the projection was re-requested after the mutation, not
  // because the browser edited a number: the new row is present and its amount is the API's.
  const row = recentRow(page, description);
  await expect(row).toContainText('2,500.00');

  expect(browserErrors).toEqual([]);
});

test('an empty period reads as empty rather than as a failure', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await openDashboard(page);

  // A range in which nothing was recorded must be distinguishable from an error: zero is a real
  // total, and "nothing recorded" is a different sentence from a failure.
  await page.getByLabel('Period', { exact: true }).selectOption('custom');
  await page.getByLabel('From', { exact: true }).fill('1990-01-01');
  await page.getByLabel('To', { exact: true }).fill('1990-01-31');
  await page.getByRole('button', { name: 'Apply range' }).click();

  await expect(periodLine(page)).toContainText('1 Jan 1990 to 31 Jan 1990');

  // A zero total is still shown, because that is the real answer rather than a missing one, and
  // the breakdown panels say the period is empty instead of drawing an empty chart. Nothing here
  // is a failure: a period with no records is a valid projection, not a broken request.
  await expect(page.getByRole('main').getByText('₹0.00').first()).toBeVisible();
  await expect(page.getByText('No income in this period')).toBeVisible();
  await expect(page.getByText('No expenses in this period')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});
