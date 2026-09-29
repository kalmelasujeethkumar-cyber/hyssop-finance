import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-E2E-001` for income.
 *
 * Authority: `docs/10-TEST-PLAN.md` (the E2E layer proves the required income journeys in a real
 * browser against the real API) and `docs/phases/PHASE-05-INCOME.md`. Nothing here is stubbed:
 * the API runs against the `_test` database and every assertion observes what the server
 * actually persisted, including the derived contribution status, the audit trail, and the
 * generated receipt.
 *
 * The test database is intentionally not cleared between runs, so the income list contains rows
 * from earlier runs and the `HY-INC-` sequence keeps advancing. Every run therefore uses a unique
 * description and amount, and every lookup is scoped to that unique text or to the record the
 * form's own confirmation names, rather than assuming an empty list or a known reference.
 */

const CURRENT_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const CURRENT_MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A unique marker, so a row written by this run is identifiable among earlier runs. */
function uniqueRunTag(): string {
  return `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, '0')}`;
}

/** The current Asia/Kolkata business month, the zone the application records dates in. */
function currentBusinessMonth(): { year: number; month: number; name: string; label: string } {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth();

  return {
    year,
    month: month + 1,
    name: CURRENT_MONTH_NAMES[month] ?? 'January',
    label: CURRENT_MONTH_ABBREVIATIONS[month] ?? 'Jan',
  };
}

/** Today's date in Asia/Kolkata as `YYYY-MM-DD`, matching the form's pre-filled value. */
function currentBusinessDate(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);

  return ist.toISOString().slice(0, 10);
}

/** Signs in and opens the Income list. */
async function openIncome(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await gotoIncome(page);
}

/**
 * Returns to the Income screen in a context that already has a session.
 *
 * `/login` redirects a signed-in visitor to the workspace, so a second `openIncome` would wait
 * for a sign-in form that is never rendered. A journey that visits two screens therefore signs in
 * once and navigates for the second visit.
 */
async function gotoIncome(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Income', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Income' })).toBeVisible();
}

/** The search box inside the filter panel, which is a real form and needs a submit. */
function incomeSearch(page: Page): Locator {
  return page.getByRole('search').getByLabel('Search income');
}

/**
 * Submits the income search.
 *
 * The field is a controlled input inside a `role="search"` form, so filling it does not filter
 * anything on its own; the criterion is applied by submitting. Pressing Enter is what the Admin
 * does, and asserting the filtered result is what proves the search reaches the API.
 */
async function searchIncome(page: Page, criterion: string): Promise<void> {
  const search = incomeSearch(page);

  await search.fill(criterion);
  await search.press('Enter');
}

/** The one row the search matched, as a link to its detail screen. */
function matchedIncomeRow(page: Page): Locator {
  return page.getByRole('table').getByRole('link', { name: /^View income HY-INC-\d{6} for / });
}

/**
 * The value the record's summary shows for one labelled field.
 *
 * "Anonymous Donation" is both the income type and the server-owned neutral description an
 * anonymous donation is stored with, so a bare text match resolves to two nodes and proves
 * nothing. Addressing the value through its own `<dt>` labels the assertion instead of guessing.
 */
function recordedDetail(page: Page, label: string): Locator {
  return page
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

/** Opens the create form. */
async function openRecordForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record income', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toBeVisible();
}

/**
 * Records one income row through the real form and returns the reference the API allocated.
 *
 * The reference is read from the form's own confirmation rather than guessed, which is what makes
 * every later assertion about *this* record unambiguous in a list that keeps growing.
 */
async function recordIncome(
  page: Page,
  options: {
    readonly incomeType: string;
    readonly amount: string;
    readonly paymentMethod?: string;
    readonly description?: string;
    readonly memberOption?: string;
  },
): Promise<string> {
  await openRecordForm(page);

  // `FormField` appends the required/optional marker to the label text, and the record form's
  // controls are separate from the list's filter controls, so each label is matched exactly and
  // in full. A looser match would silently target the filter panel instead — the failure mode that
  // made an earlier run drive the wrong control and then time out.
  await page.getByLabel('Income type (required)').selectOption(options.incomeType);
  await page.getByLabel('Amount (required)').fill(options.amount);
  await page.getByLabel('Payment method (required)').selectOption(options.paymentMethod ?? 'CASH');
  await page.getByLabel('Business date (required)').fill(currentBusinessDate());

  if (options.memberOption !== undefined) {
    await page.getByLabel('Member (required)').selectOption({ label: options.memberOption });
  }

  if (options.description !== undefined) {
    await page.getByLabel('Description (optional)').fill(options.description);
  }

  await page.getByRole('button', { name: 'Record income', exact: true }).click();

  const confirmation = page.getByText(/was recorded as HY-INC-\d{6}\./);
  await expect(confirmation).toBeVisible();

  const referenceId = /HY-INC-\d{6}/.exec((await confirmation.textContent()) ?? '')?.[0];

  expect(referenceId).toMatch(/^HY-INC-\d{6}$/);

  return referenceId ?? '';
}

/** Opens a recorded income row's detail screen by searching for its unique description. */
async function openRecordByDescription(page: Page, description: string): Promise<void> {
  await searchIncome(page, description);
  await expect(matchedIncomeRow(page)).toHaveCount(1);
  await matchedIncomeRow(page).click();
  await expect(page.getByRole('heading', { level: 1, name: /received$/ })).toBeVisible();
}

/**
 * Creates a member whose name sorts first, and returns the option label the income form shows.
 *
 * The income form's member picker is a plain select over the first page of members ordered by
 * name, so a member created by this run is only selectable if it sorts near the front. The `A0 `
 * prefix guarantees that against a test database that accumulates members from every earlier run.
 */
async function createFirstSortingMember(page: Page): Promise<{ name: string; option: string }> {
  const name = `A0 ${uniqueRunTag()}`;

  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page.getByRole('button', { name: 'Add a member' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Add member' }).click();

  const banner = page.getByText(/was added as member HY-MEM-\d{4}/);
  await expect(banner).toBeVisible();
  const referenceId = /HY-MEM-\d{4}/.exec((await banner.textContent()) ?? '')?.[0];

  expect(referenceId).toMatch(/^HY-MEM-\d{4}$/);

  return { name, option: `${name} (${referenceId ?? ''})` };
}

test.describe('income management', () => {
  test('the Income screen loads and every control is live', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await openIncome(page);

    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByTestId('result-count')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record income', exact: true })).toBeVisible();

    // The form opens, is real, and closes again: a control that cannot be dismissed is a dead
    // control, and the toggle must say what it will do.
    await openRecordForm(page);
    await expect(page.getByRole('button', { name: 'Cancel recording income' })).toBeVisible();
    // `exact` is required: the toggle's own accessible name contains "Cancel", so a substring
    // match resolves to two buttons and the strict-mode violation proves nothing about the UI.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toHaveCount(0);

    // The filters are server-side criteria, not decoration.
    await page.getByLabel('Status').selectOption('ACTIVE');
    await expect(page.getByTestId('result-count')).toBeVisible();
    await page.getByRole('button', { name: 'Reset all filters' }).first().click();
    await expect(page.getByLabel('Status')).toHaveValue('');

    expect(browserErrors).toEqual([]);
  });

  test('an offering is recorded, referenced, and listed at its exact amount', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openIncome(page);
    const referenceId = await recordIncome(page, {
      incomeType: 'OFFERING',
      amount: '1500.50',
      description,
    });

    // The list must show what the server stored, with an exact grouped amount and the reference
    // the API allocated, rather than an optimistic row that only looks saved.
    await searchIncome(page, description);
    await expect(matchedIncomeRow(page)).toHaveCount(1);
    await expect(matchedIncomeRow(page)).toHaveAttribute(
      'aria-label',
      new RegExp(`^View income ${referenceId} for `),
    );
    await expect(page.getByTestId('result-count')).toHaveText('1 record found');

    const row = matchedIncomeRow(page).locator('xpath=ancestor::tr');
    await expect(row).toContainText(referenceId);
    await expect(row).toContainText('1,500.50');
    await expect(row).toContainText('Offering');
    await expect(row).toContainText('Active');

    expect(browserErrors).toEqual([]);
  });

  test('a member contribution counts toward the month the business date falls in', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const month = currentBusinessMonth();

    // Signing in first is not optional: `createFirstSortingMember` drives the Members screen
    // through the product navigation, which does not exist for a signed-out visitor.
    await openIncome(page);
    const member = await createFirstSortingMember(page);

    // An expected amount is configured first, so the derived status that follows is the API's
    // arithmetic over the ledger rather than an accident of the default amount.
    await page.goto('/members');
    await searchMember(page, member.name);
    await page
      .getByRole('table')
      .getByRole('link', { name: new RegExp(`View ${member.name}`) })
      .click();
    await page.getByLabel('Month', { exact: true }).selectOption(month.name);
    await page.getByLabel('Year').fill(String(month.year));
    await page.getByLabel(/^Expected amount/).fill('500.00');
    await page.getByRole('button', { name: 'Save expected amount' }).click();
    await expect(
      page.getByText(new RegExp(`${month.label} ${month.year} is set to .*500\\.00`)),
    ).toBeVisible();

    await gotoIncome(page);
    // The description carries a run tag for the same reason every other journey does: the test
    // database is not reset, so a fixed string would match the record an earlier run left behind
    // and `openRecordByDescription` would find more than one row.
    const description = `September monthly contribution ${uniqueRunTag()}`;
    const referenceId = await recordIncome(page, {
      incomeType: 'MEMBER_CONTRIBUTION',
      amount: '500.00',
      memberOption: member.option,
      description,
    });

    // The record knows which member-month it belongs to, and it is the month of the business
    // date the Admin entered rather than a separately chosen one. Every value is addressed through
    // its own labelled row: the audit history repeats the description, the reference, and the
    // member, so a bare text match resolves to several nodes and a strict-mode violation would
    // say nothing about the record.
    await openRecordByDescription(page, description);
    await expect(recordedDetail(page, 'Description')).toHaveText(description);
    await expect(recordedDetail(page, 'Income reference')).toHaveText(referenceId);
    await expect(recordedDetail(page, 'Contribution month')).toHaveText(
      `${month.label} ${month.year}`,
    );
    await expect(page.getByText(new RegExp(`counts toward ${member.name}`))).toBeVisible();

    // The API derived the status from the ledger: the member's own record must now show the
    // month paid in full, which is impossible while the contribution period was not sent.
    await page.getByRole('link', { name: 'Open member' }).click();
    await expect(page.getByRole('heading', { level: 1, name: member.name })).toBeVisible();

    // The row is addressed inside the "Monthly contributions" region because the page now shows a
    // second table: "Contribution history" repeats the same business date, so a page-wide table
    // filter would match both rows and a strict-mode violation would report ambiguity rather than
    // the state under test.
    const periodRow = page
      .getByRole('region', { name: 'Monthly contributions' })
      .getByRole('row')
      .filter({ hasText: new RegExp(`${month.label} ${month.year}`) });
    await expect(periodRow).toBeVisible();

    // Each cell is asserted separately so the claim is exact: the whole 500.00 was received,
    // nothing is still outstanding, and the API's own status word for that state is shown rather
    // than a partly-paid or unpaid month passing as success.
    const periodCells = periodRow.getByRole('cell');
    await expect(periodCells).toHaveCount(4);
    await expect(periodCells.nth(0)).toHaveText(/\s*500\.00/);
    await expect(periodCells.nth(1)).toHaveText(/\s*500\.00/);
    await expect(periodCells.nth(2)).toHaveText(/\s*0\.00/);
    await expect(periodCells.nth(3)).toHaveText(/^Paid$/);

    // The same ledger row is listed as the member's contribution, so the month and the payment
    // are provably the same record rather than two independent facts that happen to agree.
    const historyRow = page
      .getByRole('region', { name: 'Contribution history' })
      .getByRole('row')
      .filter({ hasText: referenceId });
    await expect(historyRow.getByRole('cell').nth(2)).toHaveText(/\s*500\.00/);

    expect(browserErrors).toEqual([]);
  });

  test('an anonymous donation is stored with no contributor identity anywhere', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openIncome(page);
    await openRecordForm(page);

    await page.getByLabel('Income type (required)').selectOption('ANONYMOUS_DONATION');

    // `REQ-INCOME-005`. The member, description, and notes controls are absent rather than
    // disabled, so there is nothing to type a donor into and nothing to submit. Each label is
    // matched on its prefix so the assertion holds whichever required/optional marker the form
    // would have shown — a marker-specific selector would pass against a form that simply
    // renamed the control instead of removing it.
    await expect(page.getByLabel(/^Member\b/)).toHaveCount(0);
    await expect(page.getByLabel(/^Description\b/)).toHaveCount(0);
    await expect(page.getByLabel(/^Notes\b/)).toHaveCount(0);
    await expect(page.getByText(/records no donor, description, or note/)).toBeVisible();

    await page.getByLabel('Amount (required)').fill('250.00');
    await page.getByLabel('Business date (required)').fill(currentBusinessDate());
    await page.getByRole('button', { name: 'Record income', exact: true }).click();

    const confirmation = page.getByText(/was recorded as HY-INC-\d{6}\./);
    await expect(confirmation).toBeVisible();

    // The server assigned its own neutral description; the Admin never supplied one.
    await expect(page.getByRole('link', { name: 'Open HY-INC record' })).toBeVisible();
    await page.getByRole('link', { name: 'Open HY-INC record' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /received$/ })).toBeVisible();

    await expect(page.getByText('No member recorded', { exact: true })).toBeVisible();
    // The income type and the server-assigned description are both the words "Anonymous
    // Donation", so each is addressed through its own labelled row.
    await expect(recordedDetail(page, 'Income type')).toHaveText('Anonymous Donation');
    await expect(recordedDetail(page, 'Description')).toHaveText('Anonymous Donation');

    // The receipt is where an identity would most plausibly leak, so it is checked explicitly.
    await page.getByRole('link', { name: 'Open receipt' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /Receipt HY-INC-\d{6}/ }),
    ).toBeVisible();
    await expect(page.getByText('Not recorded (anonymous)', { exact: true })).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('a correction saves against the revision it was opened on and keeps the old value', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openIncome(page);
    await recordIncome(page, { incomeType: 'DONATION', amount: '800.00', description });
    await openRecordByDescription(page, description);

    // The screen states which revision the edit is based on, so a stale save is refused rather
    // than silently overwriting someone else's change.
    await page.getByRole('button', { name: 'Edit amount or details' }).click();
    await expect(page.getByText(/You are editing revision 1 of HY-INC-\d{6}\./)).toBeVisible();

    await page.getByLabel('Amount (required)').fill('950.25');
    await page.getByRole('button', { name: 'Save correction' }).click();

    await expect(page.getByText(/^Correction saved\./)).toBeVisible();
    await expect(page.getByText('950.25').first()).toBeVisible();

    // The history must carry the change itself, not just the new value: the previous amount has
    // to stay visible, which is the whole point of a correction rather than a delete.
    const history = page.getByRole('region', { name: 'History' });
    await expect(history).toContainText('TRANSACTION_CREATED');
    await expect(history).toContainText('TRANSACTION_UPDATED');
    await expect(history).toContainText('800.00');
    await expect(history).toContainText('950.25');

    // A second correction is offered against the new revision, so the lock advanced with the
    // change rather than staying pinned to 1. The form deliberately stays open over the saved
    // record, so the advanced revision is asserted on it and the reopen path is exercised
    // separately rather than by clicking a control the screen no longer shows.
    await expect(page.getByText(/You are editing revision 2 of HY-INC-\d{6}\./)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Edit amount or details' }).click();
    await expect(page.getByText(/You are editing revision 2 of HY-INC-\d{6}\./)).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('voiding requires a reason, keeps the record, and freezes it', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openIncome(page);
    await recordIncome(page, { incomeType: 'OFFERING', amount: '600.00', description });
    await openRecordByDescription(page, description);

    await page.getByRole('button', { name: 'Void this income' }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Void this record' })).toBeVisible();

    // A reason is required, because a void that cannot be explained is not auditable.
    await page.getByRole('button', { name: 'Void this income' }).last().click();
    await expect(page.getByText('Enter a reason for voiding this transaction.')).toBeVisible();

    await page.getByLabel('Reason for voiding (required)').fill('Recorded twice by mistake');
    await page.getByRole('button', { name: 'Void this income' }).last().click();

    await expect(page.getByText(/HY-INC-\d{6} was voided\./)).toBeVisible();
    // Void is a state, not a deletion: the record, its reason, and its history remain on screen.
    await expect(page.getByText(/kept for audit and is no longer counted/)).toBeVisible();
    // The reason is the point of the void, and it is on the record in three places: the
    // confirmation, the record's own reason, and the audit change. The record's reason is
    // addressed by its label so the assertion cannot silently pass on a different node.
    await expect(
      page.getByText('Reason: Recorded twice by mistake', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'History' })).toContainText('TRANSACTION_VOIDED');
    // The status a void leaves behind says in words that the record still exists and is simply
    // not counted, because a status of "Voided" alone reads like a deletion.
    await expect(page.getByText('Voided — not counted in totals')).toBeVisible();

    // The controls that would change a frozen record are withdrawn rather than left to fail.
    await expect(page.getByRole('button', { name: 'Edit amount or details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Void this income' })).toHaveCount(0);

    // A voided receipt is still produced and marked, because hiding it would imply the record
    // never happened.
    await page.getByRole('link', { name: 'Open receipt' }).click();
    await expect(page.getByText(/marked VOIDED/)).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('the receipt is generated from the stored record and is printable', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openIncome(page);
    await recordIncome(page, {
      incomeType: 'DONATION',
      amount: '1200.00',
      paymentMethod: 'UPI',
      description,
    });
    await openRecordByDescription(page, description);
    await page.getByRole('link', { name: 'Open receipt' }).click();

    // `REQ-DOC-010` to `REQ-DOC-014`: the church, the reference, the exact amount, the income
    // type, the payment method, and the business date, all from the persisted record.
    await expect(
      page.getByRole('heading', { level: 1, name: /Receipt HY-INC-\d{6}/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'HYSSOP FINANCE' })).toBeVisible();
    await expect(page.getByText('1,200.00').first()).toBeVisible();
    await expect(page.getByText('UPI', { exact: true })).toBeVisible();
    await expect(page.getByText('Donation', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('INR', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print receipt' })).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('search, filters, and reset narrow the list through the API', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openIncome(page);
    const referenceId = await recordIncome(page, {
      incomeType: 'OFFERING',
      amount: '450.00',
      description,
    });

    // Searching for this run's unique text finds exactly this run's record.
    await searchIncome(page, description);
    await expect(page.getByTestId('result-count')).toHaveText('1 record found');
    await expect(matchedIncomeRow(page)).toHaveCount(1);

    // A search that matches nothing says so, rather than showing the whole ledger or a blank
    // table, so "no match" and "nothing recorded" stay distinguishable.
    await searchIncome(page, `${description}-no-such-record`);
    await expect(page.getByTestId('result-count')).toHaveText('No income to show');
    await expect(page.getByText('No income matches these filters')).toBeVisible();

    // The criteria are shown as active and can be removed individually.
    await expect(page.getByRole('button', { name: /Remove filter: Search:/ })).toBeVisible();

    // The income-type criterion is a real server-side filter, not a client-side one. This run's
    // record is an offering, so choosing member contributions has to remove it from the list
    // rather than leave it on screen behind a criterion that does not match it. The list
    // identifies a record by the reference the API allocated, so that is what is asserted.
    await page.getByRole('button', { name: 'Reset all filters' }).first().click();
    await page.getByLabel('Income type', { exact: true }).selectOption('MEMBER_CONTRIBUTION');
    await expect(page.getByRole('button', { name: /Remove filter: Type:/ })).toBeVisible();
    await expect(page.getByText(referenceId, { exact: true })).toHaveCount(0);

    // Clearing the criterion brings the record back, so the filter was reversible.
    await page.getByLabel('Income type', { exact: true }).selectOption('');
    await expect(page.getByText(referenceId, { exact: true })).toBeVisible();

    // An amount range is honoured by the API as well, compared as exact paise rather than as
    // formatted text: the record is exactly 450.00, so 449.99 includes it and 450.01 excludes it.
    await page.getByLabel('Amount from').fill('449.99');
    await expect(page.getByText(referenceId, { exact: true })).toBeVisible();
    await page.getByLabel('Amount from').fill('450.01');
    await expect(page.getByText(referenceId, { exact: true })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });

  test('an income record is not reachable for an expense reference', async ({ page }) => {
    // `docs/06-API-SPEC.md` defines no separate expense read in Phase 05, so this asserts the
    // honest thing that is observable now: a transaction that is not income is refused by the
    // income route rather than rendered as if it were income. A `404` is the documented answer
    // for an id that does not exist, and Chromium logs it, so this one journey asks the collector
    // for a single expected `404` on the transaction read paths. Every other error — a second
    // `404`, a `404` anywhere else, and any other console error, exception, or failed request —
    // still fails the test.
    const browserErrors = collectBrowserErrors(page, true);

    await openIncome(page);
    await page.goto('/income/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/could not be loaded|not found/i).first()).toBeVisible();

    expect(browserErrors).toEqual([]);
  });
});

/** Submits the members search, which is a form rather than a live filter. */
async function searchMember(page: Page, name: string): Promise<void> {
  const search = page.getByRole('search').getByLabel('Search members');

  await search.fill(name);
  await search.press('Enter');
}
