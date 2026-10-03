import { expect, test, type Page } from '@playwright/test';
import { MONEY_FORMAT_MESSAGE } from '@hyssop/contracts';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-E2E-001`, `TEST-AUDIT-001`, and `TEST-AUDIT-002` for
 * `PHASE-10-AUDIT-SETTINGS`.
 *
 * Authority: `docs/10-TEST-PLAN.md`, `docs/phases/PHASE-10-AUDIT-SETTINGS.md`, and
 * `docs/01-REQUIREMENTS.md` (`REQ-AUDIT-001`, `REQ-AUDIT-002`, `REQ-SETTINGS-001` to
 * `REQ-SETTINGS-009`).
 *
 * Nothing here is stubbed: the API runs against the `_test` database, so every value asserted is
 * one the server calculated from persisted rows. The journeys prove the four browser behaviors the
 * phase names - audit filters, audit detail, void history, and settings changes - against the real
 * stack rather than against a fixture.
 *
 * The test database is deliberately not cleared between runs, so no figure here is asserted against
 * a hard-coded amount and no lookup assumes an empty trail. Each journey that needs a record makes
 * its own with a unique run tag, so the row it finds is provably the row it wrote among earlier
 * runs' rows.
 */

/** A unique marker, so a row written by this run is identifiable among earlier runs. */
function uniqueRunTag(): string {
  return `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, '0')}`;
}

/**
 * Today's date in Asia/Kolkata as `YYYY-MM-DD`, matching the income form's pre-filled value.
 *
 * The business date is an Asia/Kolkata accounting date, so reading the browser's local date would
 * put an income record in the wrong business day on a machine in another zone.
 */
function currentBusinessDate(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);

  return ist.toISOString().slice(0, 10);
}

/** Signs in and opens the Audit History screen. */
async function openAuditHistory(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await gotoAuditHistory(page);
}

/** Returns to Audit History in a context that already has a session. */
async function gotoAuditHistory(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Audit History' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit History' })).toBeVisible();
}

/** Signs in and opens the Settings screen. */
async function openSettings(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

/** Opens the Income list in a context that already has a session. */
async function gotoIncome(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Income', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Income' })).toBeVisible();
}

/** Submits the income search, which is a form rather than a live filter. */
async function searchIncome(page: Page, criterion: string): Promise<void> {
  const search = page.getByRole('search').getByLabel('Search income');

  await search.fill(criterion);
  await search.press('Enter');
}

/**
 * Records one offering and voids it through the real screens, returning the reference the API
 * allocated.
 *
 * A void is only auditable if it happened, so void history cannot be proven by reading whatever
 * rows an earlier run happened to leave: this journey creates the record it later looks for. The
 * description and the void reason carry the same unique tag but are distinct strings, so the void
 * event's reason cannot be confused with the creation event's description snapshot.
 */
async function recordAndVoidIncome(
  page: Page,
  options: { readonly description: string; readonly reason: string },
): Promise<string> {
  await gotoIncome(page);

  await page.getByRole('button', { name: 'Record income', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toBeVisible();

  await page.getByLabel('Income type (required)').selectOption('OFFERING');
  await page.getByLabel('Amount (required)').fill('321.00');
  await page.getByLabel('Payment method (required)').selectOption('CASH');
  await page.getByLabel('Business date (required)').fill(currentBusinessDate());
  await page.getByLabel('Description (optional)').fill(options.description);
  await page.getByRole('button', { name: 'Record income', exact: true }).click();

  const confirmation = page.getByText(/was recorded as HY-INC-\d{6}\./);

  await expect(confirmation).toBeVisible();

  const referenceId = /HY-INC-\d{6}/.exec((await confirmation.textContent()) ?? '')?.[0] ?? '';

  expect(referenceId).toMatch(/^HY-INC-\d{6}$/);

  await searchIncome(page, options.description);

  const row = page
    .getByRole('table')
    .getByRole('link', { name: new RegExp(`^View income ${referenceId} for `) });

  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: /received$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Void this income' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Void this record' })).toBeVisible();
  await page.getByLabel('Reason for voiding (required)').fill(options.reason);
  await page.getByRole('button', { name: 'Void this income' }).last().click();

  await expect(page.getByText(new RegExp(`${referenceId} was voided\\.`))).toBeVisible();

  return referenceId;
}

test.describe('audit history screen', () => {
  test('is reachable from the navigation and offers no control that could change it', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openAuditHistory(page);

    await expect(page.getByText('Showing every recorded change.')).toBeVisible();
    // `REQ-AUDIT-001` makes the trail append-only, so a button that offered to edit or remove an
    // entry would be a promise the API cannot keep.
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /void/i })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });

  test('every filter narrows the view and stays in the URL, and clearing restores it', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openAuditHistory(page);

    await page.getByLabel('What happened').selectOption('TRANSACTION_VOIDED');
    await expect(page).toHaveURL(/action=TRANSACTION_VOIDED/);
    await expect(
      page.getByText('Showing only the entries that match the filters above.'),
    ).toBeVisible();

    await page.getByLabel('What was changed').selectOption('financial_transaction');
    await expect(page).toHaveURL(/entityType=financial_transaction/);

    await page.getByLabel('From date').fill('2026-01-01');
    await expect(page).toHaveURL(/from=2026-01-01/);
    await page.getByLabel('To date').fill('2026-12-31');
    await expect(page).toHaveURL(/to=2026-12-31/);

    // Clearing is a real reset: the criteria leave the URL and the screen says it is showing the
    // whole trail again rather than an empty result left behind by a stale filter.
    await page.getByRole('button', { name: 'Clear all filters' }).first().click();
    await expect(page).not.toHaveURL(/action=|entityType=|from=|to=/);
    await expect(page.getByText('Showing every recorded change.')).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('a voided transaction is kept in the trail with the reason it was given', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const tag = uniqueRunTag();
    const description = `Audit journey offering ${tag}`;
    const reason = `Voided by the browser journey ${tag}`;

    await page.goto('/login');
    await signIn(page);
    await recordAndVoidIncome(page, { description, reason });

    await gotoAuditHistory(page);
    await page.getByLabel('What happened').selectOption('TRANSACTION_VOIDED');
    await expect(page).toHaveURL(/action=TRANSACTION_VOIDED/);

    // The reason is unique to this run, so exactly one entry in the filtered trail can carry it.
    const entry = page
      .getByRole('region', { name: 'Recorded changes' })
      .locator('li')
      .filter({ hasText: reason });

    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('Transaction voided');

    // The reason is shown without opening anything, because the reason is the point of a void.
    await expect(entry).toContainText(`Reason given: ${reason}`);

    await entry.getByRole('button', { name: 'Show the details' }).click();
    await expect(entry.getByRole('heading', { name: 'Before this change' })).toBeVisible();
    await expect(entry.getByRole('heading', { name: 'After this change' })).toBeVisible();

    expect(browserErrors).toEqual([]);
  });
});

test.describe('settings screen', () => {
  test('shows the fixed values as fixed and the editable amount as the API stored it', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openSettings(page);

    const amount = page.getByLabel(/Default monthly contribution/);

    await expect(amount).toBeVisible();
    await expect(amount).toBeEnabled();

    // `REQ-SETTINGS-003` and `REQ-SETTINGS-004` are honoured visibly: the currency and timezone are
    // shown, and there is no control for them because the API reports them as not editable.
    const main = page.getByRole('main');

    await expect(main.getByText(/INR \(rupees\)/)).toBeVisible();
    await expect(main.getByText(/Asia\/Kolkata/)).toBeVisible();
    await expect(page.getByLabel(/currency/i)).toHaveCount(0);
    await expect(page.getByLabel(/timezone/i)).toHaveCount(0);
    await expect(page.getByText(/cannot be changed here/)).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('a settings change is saved and recorded in the trail with the setting that changed', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openSettings(page);

    const amount = page.getByLabel(/Default monthly contribution/);

    await expect(amount).toBeVisible();

    // Alternate between two fixed amounts so the journey always submits a real change, however the
    // test database was left by an earlier run. The paise count is the exact integer the sanitised
    // amount is stored as, which is what the audit snapshot carries.
    const current = await amount.inputValue();
    const next =
      current === '500.00'
        ? { text: '600.00', paise: '60000' }
        : { text: '500.00', paise: '50000' };

    await amount.fill(next.text);
    await page.getByRole('button', { name: 'Save changes' }).click();

    // The confirmation names the amount the server stored, not the text that was typed into it.
    await expect(
      page.getByText(
        new RegExp(`The monthly expectation is now ₹${next.text.replace('.', '\\.')}`),
      ),
    ).toBeVisible();

    await gotoAuditHistory(page);
    await page.getByLabel('What was changed').selectOption('app_setting');
    await expect(page).toHaveURL(/entityType=app_setting/);

    // The setting's own key is the event's reference, so the trail says which setting changed
    // rather than only that "a setting" did.
    const newest = page.getByRole('region', { name: 'Recorded changes' }).locator('li').first();

    await expect(newest).toContainText('Setting changed');
    await expect(newest).toContainText('DEFAULT_MONTHLY_CONTRIBUTION_PAISE');

    await newest.getByRole('button', { name: 'Show the details' }).click();
    await expect(newest.getByRole('heading', { name: 'After this change' })).toBeVisible();
    await expect(newest).toContainText(next.paise);

    expect(browserErrors).toEqual([]);
  });

  test('a malformed amount is refused against the field before the API is asked', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await openSettings(page);

    const amount = page.getByLabel(/Default monthly contribution/);

    await expect(amount).toBeVisible();
    await amount.fill('1,200');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText(MONEY_FORMAT_MESSAGE)).toBeVisible();
    // The save never reached the server, so the success message cannot appear.
    await expect(page.getByText(/The monthly expectation is now/)).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });
});
