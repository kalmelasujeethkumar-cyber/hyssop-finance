import { expect, test, type Page } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-E2E-001` for members.
 *
 * Authority: `docs/10-TEST-PLAN.md` (the E2E layer proves the required member journeys in a
 * real browser against the real API) and `docs/phases/PHASE-04-MEMBERS.md`. Nothing here is
 * stubbed: the API runs against the `_test` database and every assertion observes what the
 * server actually persisted.
 *
 * The test database is intentionally not cleared between runs, so the member list contains
 * rows from earlier runs. Each run therefore uses a unique name and phone number, and every
 * lookup is scoped to that unique value rather than assuming an empty list.
 */
function uniqueDigits(length: number): string {
  let digits = '';
  while (digits.length < length) {
    digits += String(Math.floor(Math.random() * 10));
  }
  return digits;
}

function uniqueMemberName(prefix: string): string {
  return `E2E ${prefix} ${Date.now().toString(36)}${uniqueDigits(4)}`;
}

/**
 * A unique phone number that survives storage unchanged.
 *
 * `REQ-MEM-005` stores national digits only and strips an optional `91` prefix, so a number
 * beginning `91` is persisted two digits shorter than it was typed. Starting with `7` keeps the
 * stored value equal to the typed one, which is what lets a journey assert the phone the member
 * screen shows is the phone that was entered.
 */
function uniquePhone(): string {
  return `7${uniqueDigits(9)}`;
}

const E2E_NOTES = 'Created by the browser acceptance run.';

const MONTH_ABBREVIATIONS = [
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

const MONTH_NAMES = [
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

/**
 * The current business month in `Asia/Kolkata` — the zone the application uses for dates.
 *
 * The contributions panel shows the member's configured periods for the current business
 * year, so the acceptance journey must configure a period in that same year to observe the
 * status row that the server derives.
 */
function currentBusinessMonth(): { year: number; month: number; name: string; label: string } {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth();

  return {
    year,
    month: month + 1,
    name: MONTH_NAMES[month] ?? 'January',
    label: MONTH_ABBREVIATIONS[month] ?? 'Jan',
  };
}

test.describe('member management', () => {
  test('the Members screen loads and its controls are live', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    await page.getByRole('link', { name: 'Members', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByTestId('result-count')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a member' })).toBeVisible();

    await page.getByRole('button', { name: 'Add a member' }).click();
    await expect(page.getByRole('heading', { name: 'Add a member' })).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('a member can be created, opened, and given an expected monthly amount', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Alpha');
    const phone = uniquePhone();
    const currentMonth = currentBusinessMonth();

    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByRole('button', { name: 'Add a member' }).click();

    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Phone number').fill(phone);
    await page.getByLabel('Notes').fill(E2E_NOTES);
    await page.getByRole('button', { name: 'Add member' }).click();

    const banner = page.getByText(/was added as member HY-MEM-\d+/);
    await expect(banner).toBeVisible();
    const referenceId = /HY-MEM-\d+/.exec((await banner.textContent()) ?? '')?.[0];

    expect(referenceId).toMatch(/^HY-MEM-\d+$/);

    await page.getByRole('search').getByLabel('Search members').fill(name);
    await page.getByRole('search').getByLabel('Search members').press('Enter');

    const view = page
      .getByRole('table')
      .getByRole('link', { name: new RegExp(`View ${escapeRegExp(name)}`) });
    await expect(view).toBeVisible();
    await view.click();

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(escapeRegExp(name), 'i') }),
    ).toBeVisible();

    if (referenceId !== undefined) {
      await expect(page.getByText(referenceId, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText('No contribution months configured', { exact: true }),
    ).toBeVisible();

    await page.getByLabel('Month', { exact: true }).selectOption(currentMonth.name);
    await page.getByLabel('Year').fill(String(currentMonth.year));
    await page.getByLabel(/^Expected amount/).fill('500.00');
    await page.getByRole('button', { name: 'Save expected amount' }).click();

    await expect(
      page.getByText(
        new RegExp(
          `${escapeRegExp(currentMonth.label)} ${currentMonth.year} is set to ₹\\s*500\\.00`,
        ),
      ),
    ).toBeVisible();

    const table = page.getByRole('table');
    const row = table
      .getByRole('row')
      .filter({ hasText: new RegExp(`${escapeRegExp(currentMonth.label)} ${currentMonth.year}`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(
      new RegExp(`${escapeRegExp(currentMonth.label)} ${currentMonth.year}`),
    );

    const cells = row.getByRole('cell');
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(0)).toHaveText(/₹\s*500\.00/);
    await expect(cells.nth(1)).toHaveText(/₹\s*0\.00/);
    await expect(cells.nth(2)).toHaveText(/₹\s*500\.00/);
    await expect(cells.nth(3)).toHaveText(/not paid/i);

    expect(browserErrors).toEqual([]);
  });

  test('an edit applies with the optimistic lock and records the change', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Bravo');

    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByRole('button', { name: 'Add a member' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByRole('button', { name: 'Add member' }).click();

    const banner = page.getByText(/was added as member HY-MEM-\d+/);
    await expect(banner).toBeVisible();

    await page.getByRole('search').getByLabel('Search members').fill(name);
    await page.getByRole('search').getByLabel('Search members').press('Enter');

    const view = page
      .getByRole('table')
      .getByRole('link', { name: new RegExp(`View ${escapeRegExp(name)}`) });
    await expect(view).toBeVisible();
    await view.click();

    await page.getByRole('button', { name: 'Edit member' }).click();
    const edited = `${name} edited`;
    await page.getByLabel('Full name').fill(edited);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      page.getByText(/was saved\. The change was recorded in the audit history\./),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(escapeRegExp(edited), 'i') }),
    ).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('members can be found by name, member ID, and phone number', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Charlie');
    const phone = uniquePhone();

    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByRole('button', { name: 'Add a member' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Add member' }).click();

    const banner = page.getByText(/was added as member HY-MEM-\d+/);
    await expect(banner).toBeVisible();
    const referenceId = /HY-MEM-\d+/.exec((await banner.textContent()) ?? '')?.[0];

    expect(referenceId).toMatch(/^HY-MEM-\d+$/);

    const searchBox = page.getByRole('search').getByLabel('Search members');

    await searchBox.fill(name);
    await searchBox.press('Enter');
    await expect(page.getByRole('table')).toContainText(name);

    await searchBox.fill(phone);
    await searchBox.press('Enter');
    await expect(page.getByRole('table')).toContainText(name);

    if (referenceId !== undefined) {
      await searchBox.fill(referenceId);
      await searchBox.press('Enter');
      await expect(page.getByRole('table')).toContainText(referenceId);
    }

    expect(browserErrors).toEqual([]);
  });

  test('pagination controls let the Admin page through the records', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    await page.getByRole('link', { name: 'Members', exact: true }).click();

    await expect(page.getByTestId('result-count')).toBeVisible();

    const pageSize = page.getByLabel('Per page');
    if ((await pageSize.count()) > 0) {
      await pageSize.selectOption('20');

      const next = page.getByRole('button', { name: 'Next', exact: true });
      if (await next.isEnabled()) {
        await next.click();
      }

      await expect(page.getByTestId('result-count')).toBeVisible();
    }

    expect(browserErrors).toEqual([]);
  });

  test('sort and order controls stay live and never mix reference IDs into the path', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    await page.getByRole('link', { name: 'Members', exact: true }).click();

    await page.getByLabel('Sort by').selectOption('name');
    await page.getByLabel('Order').selectOption('desc');

    await expect(page.getByTestId('result-count')).toBeVisible();

    const table = page.getByRole('table');
    const href = await table
      .getByRole('link', { name: /^View / })
      .first()
      .getAttribute('href');

    expect(href).toMatch(/^\/members\/[0-9a-fA-F-]{36}$/);

    expect(browserErrors).toEqual([]);
  });
});

/** Escapes a user-provided name before it is interpolated into a regex. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recording a payment from the member screen.
 *
 * Reaching the member who is paying was the step that stopped contributions being recorded: the
 * income screen listed only the first page of members by name while its own hint promised a
 * search, so a member past that page could not be named at all. These journeys remove the lookup
 * entirely and prove that a payment recorded here is a real `MEMBER_CONTRIBUTION` against the
 * member's own UUID, credited to the month its business date falls in.
 *
 * The member and the payment stay two separate writes. Nothing here creates a member as a side
 * effect of recording money and nothing records money as a side effect of adding a member, so a
 * second payment for the same person must leave exactly one member behind.
 */
test.describe('recording a payment from a member', () => {
  /**
   * Adds one uniquely named member through the real create form and returns its reference.
   *
   * The create form continues straight into the payment form, so the caller stays on the Members
   * screen with the new member already locked above the amount.
   */
  async function addMember(page: Page, name: string, phone: string): Promise<string> {
    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByRole('button', { name: 'Add a member' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Add member' }).click();

    const banner = page.getByText(/was added as member HY-MEM-\d+/);
    await expect(banner).toBeVisible();

    return /HY-MEM-\d+/.exec((await banner.textContent()) ?? '')?.[0] ?? '';
  }

  test('records a contribution for the member just added, with that member locked', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Doorstep');
    const phone = uniquePhone();
    const referenceId = await addMember(page, name, phone);
    const month = currentBusinessMonth();

    // The member is named read-only above the amount, using the create response's own reference.
    // There is no lookup here, because there is no question about who is being paid.
    const locked = page.getByTestId('locked-member');

    await expect(locked.getByText(name)).toBeVisible();
    await expect(locked.getByText(referenceId)).toBeVisible();
    await expect(locked.getByText(phone)).toBeVisible();

    // The credited month is stated in words before the payment is recorded, and it follows the
    // business date rather than a separately chosen month.
    await expect(page.getByTestId('credited-month')).toHaveText(
      `Credited to the ${MONTH_NAMES[month.month - 1]} ${month.year} contribution period.`,
    );

    await page.getByLabel('Amount (required)').fill('750.50');
    await page.getByLabel('Payment method (required)').selectOption('UPI');
    await page.getByRole('button', { name: 'Record payment' }).click();

    // The confirmation names the member and the credited month in words, so a payment recorded
    // for the wrong person or the wrong month is visible in the sentence itself.
    const confirmation = page.getByText(
      new RegExp(`₹750\\.50 was recorded for ${escapeRegExp(name)} as HY-INC-\\d{6}`),
    );

    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(
      `credited to ${MONTH_NAMES[month.month - 1]} ${month.year}`,
    );

    // Still exactly one member: recording money did not create a person.
    await page.getByRole('link', { name: 'Members', exact: true }).click();
    const search = page.getByRole('search').getByLabel('Search members');

    await search.fill(name);
    await search.press('Enter');
    await expect(page.getByTestId('result-count')).toHaveText('1 member found');

    await page
      .getByRole('table')
      .getByRole('link', { name: new RegExp(`View ${escapeRegExp(name)}`) })
      .click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // The API derived the status from the ledger, so the member's own month row is now paid in
    // full. This is the server's arithmetic over persisted transactions, not a browser prediction.
    const monthRow = page
      .getByRole('table')
      .first()
      .getByRole('row')
      .filter({ hasText: new RegExp(`${month.label} ${month.year}`) });

    await expect(monthRow.getByText('Paid')).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('records a second payment for the same member without duplicating them', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Twice');
    const phone = uniquePhone();
    await addMember(page, name, phone);

    await page.getByLabel('Amount (required)').fill('500');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText(/was recorded for .* as HY-INC-\d{6}/)).toBeVisible();

    // The form clears itself for the next payment and the member is still the one being paid, so
    // a second contribution is a second payment rather than a second person.
    const locked = page.getByTestId('locked-member');

    await expect(locked.getByText(name)).toBeVisible();
    await expect(page.getByLabel('Amount (required)')).toHaveValue('');

    await page.getByLabel('Amount (required)').fill('500');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText(/was recorded for .* as HY-INC-\d{6}/)).toBeVisible();

    await page.getByRole('link', { name: 'Members', exact: true }).click();
    const search = page.getByRole('search').getByLabel('Search members');

    await search.fill(name);
    await search.press('Enter');
    await expect(page.getByTestId('result-count')).toHaveText('1 member found');
    await expect(
      page.getByRole('link', { name: new RegExp(`View ${escapeRegExp(name)}`) }),
    ).toHaveCount(1);

    expect(browserErrors).toEqual([]);
  });

  test('reaches a member past the first page of the list, by permanent ID', async ({ page }) => {
    // The defect this replaces: the member picker offered the first page ordered by name, so a
    // member later in the alphabet could not be paid at all. Searching by the permanent ID reaches
    // them no matter how many members an earlier run left in the database.
    const browserErrors = collectBrowserErrors(page);

    await page.goto('/login');
    await signIn(page);

    const name = uniqueMemberName('Late Alphabet');
    const phone = uniquePhone();
    const referenceId = await addMember(page, name, phone);

    await page.getByRole('link', { name: 'Income', exact: true }).click();
    await page.getByRole('button', { name: 'Record income', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Record income' })).toBeVisible();

    await page.getByLabel('Search members').fill(referenceId);

    const select = page.getByLabel('Member (required)');

    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: referenceId })).toHaveCount(1);
    await expect(page.getByTestId('member-picker-count')).toHaveText('1 member matches.');

    await page.getByLabel('Income type (required)').selectOption('MEMBER_CONTRIBUTION');
    // The label is matched in full because the phone is part of it, and the phone is what tells
    // two members with similar names apart.
    await select.selectOption({ label: `${name} (${referenceId}) · ${phone}` });
    await page.getByLabel('Amount (required)').fill('500');
    await page.getByRole('button', { name: 'Record income', exact: true }).click();

    await expect(page.getByText(/was recorded as HY-INC-\d{6}\./)).toBeVisible();

    expect(browserErrors).toEqual([]);
  });
});
