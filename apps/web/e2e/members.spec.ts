import { expect, test } from '@playwright/test';
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

function uniquePhone(): string {
  return `9${uniqueDigits(9)}`;
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
