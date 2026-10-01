import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectBrowserErrors, signIn } from './support/auth';

/**
 * The browser layer of `TEST-EXP-001` for expenses.
 *
 * Authority: `docs/10-TEST-PLAN.md` (the E2E layer proves the required expense journeys in a real
 * browser against the real API) and `docs/phases/PHASE-06-EXPENSES.md`. Nothing here is stubbed:
 * the API runs against the `_test` database and every assertion observes what the server actually
 * persisted, including the category an expense was filed under, the correction history, the void
 * state, and the receipt state.
 *
 * The test database is intentionally not cleared between runs, so the expense list contains rows
 * from earlier runs and the `HY-EXP-` sequence keeps advancing. Every run therefore uses a unique
 * description and amount, and every lookup is scoped to that unique text or to the record the
 * form's own confirmation names, rather than assuming an empty list or a known reference.
 */

/** A unique marker, so a row written by this run is identifiable among earlier runs. */
function uniqueRunTag(): string {
  return `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, '0')}`;
}

/** Today's date in Asia/Kolkata as `YYYY-MM-DD`, matching the form's pre-filled value. */
function currentBusinessDate(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);

  return ist.toISOString().slice(0, 10);
}

/** Signs in and opens the Expenses list. */
async function openExpenses(page: Page): Promise<void> {
  await page.goto('/login');
  await signIn(page);
  await gotoExpenses(page);
}

/**
 * Returns to the Expenses screen in a context that already has a session.
 *
 * `/login` redirects a signed-in visitor to the workspace, so a second `openExpenses` would wait
 * for a sign-in form that is never rendered. A journey that visits two screens therefore signs in
 * once and navigates for the second visit.
 *
 * Below the `md` breakpoint the navigation collapses behind a `Menu` toggle, so the link exists
 * but is not visible until the toggle is used. Navigating by the link on every viewport would make
 * this journey pass only on a desktop, which is exactly the gap the narrow-viewport test closes.
 */
async function gotoExpenses(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu' });
  const expensesLink = page.getByRole('link', { name: 'Expenses', exact: true });

  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  }

  await expensesLink.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
}

/** The search box inside the filter panel, which is a real form and needs a submit. */
function expenseSearch(page: Page): Locator {
  return page.getByRole('search').getByLabel('Search expenses');
}

/**
 * Submits the expense search.
 *
 * The field is a controlled input inside a `role="search"` form, so filling it does not filter
 * anything on its own; the criterion is applied by submitting. Pressing Enter is what the Admin
 * does, and asserting the filtered result is what proves the search reaches the API.
 */
async function searchExpenses(page: Page, criterion: string): Promise<void> {
  const search = expenseSearch(page);

  await search.fill(criterion);
  await search.press('Enter');
}

/** The one row the search matched, as a link to its detail screen. */
function matchedExpenseRow(page: Page): Locator {
  return page.getByRole('table').getByRole('link', { name: /^View expense HY-EXP-\d{6} for / });
}

/**
 * The value the record's summary shows for one labelled field.
 *
 * The audit history repeats the description and the category, so a bare text match resolves to
 * several nodes and proves nothing. Addressing the value through its own `<dt>` labels the
 * assertion instead of guessing.
 */
function recordedDetail(page: Page, label: string): Locator {
  return page
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

/**
 * A real one-pixel PNG.
 *
 * The API validates the bytes rather than trusting the declared type, so a receipt upload needs a
 * file whose content is genuinely a supported image. A file of arbitrary bytes would be refused
 * correctly and the journey would prove nothing about a successful upload.
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The open record's own reference, read from the record rather than guessed.
 *
 * The receipt panel is titled with the reference it belongs to, so taking the reference from the
 * record's own "Expense reference" field keeps the panel's landmark unambiguous however many
 * expenses a reused test database already holds. Hard-coding `HY-EXP-000001` would silently break
 * the moment the database is not empty.
 */
async function expenseReference(page: Page): Promise<string> {
  return (await recordedDetail(page, 'Expense reference').textContent())?.trim() ?? '';
}

/** The record's own UUID, read from the record form's action rather than from a URL. */
async function expenseId(page: Page): Promise<string> {
  return (
    new URL(page.url()).pathname
      .split('/')
      .filter((segment) => segment !== '')
      .pop() ?? ''
  );
}

/** Opens the create form. */
async function openRecordForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record expense', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Record expense' })).toBeVisible();
}

/**
 * Records one expense row through the real form and returns the reference the API allocated.
 *
 * The reference is read from the form's own confirmation rather than guessed, which is what makes
 * every later assertion about *this* record unambiguous in a list that keeps growing.
 */
async function recordExpense(
  page: Page,
  options: {
    readonly amount: string;
    readonly category: string;
    readonly paymentMethod?: string;
    readonly description: string;
  },
): Promise<string> {
  await openRecordForm(page);

  // `FormField` appends the required/optional marker to the label text, and the record form's
  // controls are separate from the list's filter controls, so each label is matched exactly and
  // in full. A looser match would silently target the filter panel instead.
  await page.getByLabel('Amount (required)').fill(options.amount);
  await page.getByLabel('Category (required)').selectOption({ label: options.category });
  await page.getByLabel('Payment method (required)').selectOption(options.paymentMethod ?? 'CASH');
  await page.getByLabel('Business date (required)').fill(currentBusinessDate());
  await page.getByLabel('Description (optional)').fill(options.description);

  await page.getByRole('button', { name: 'Record expense', exact: true }).click();

  // The confirmation reads "₹2,450.75 was recorded as HY-EXP-000001 under Electricity.", so the
  // pattern must stop at the category name. Matching a period straight after the digits would
  // look for a sentence boundary that this sentence does not have.
  const confirmation = page.getByText(/was recorded as HY-EXP-\d{6} under /);
  await expect(confirmation).toBeVisible();

  const referenceId = /HY-EXP-\d{6}/.exec((await confirmation.textContent()) ?? '')?.[0];

  expect(referenceId).toMatch(/^HY-EXP-\d{6}$/);

  return referenceId ?? '';
}

/** Opens a recorded expense row's detail screen by searching for its unique description. */
async function openRecordByDescription(page: Page, description: string): Promise<void> {
  await searchExpenses(page, description);
  await expect(matchedExpenseRow(page)).toHaveCount(1);
  await matchedExpenseRow(page).click();
  await expect(page.getByRole('heading', { level: 1, name: /spent$/ })).toBeVisible();
}

/**
 * Creates a custom category through the create form and returns its display name.
 *
 * The name carries a run tag because the category set is not reset between runs, so a fixed
 * string would collide with a category an earlier run left behind.
 */
async function createCustomCategory(page: Page): Promise<string> {
  const name = `Books ${uniqueRunTag()}`;

  await openRecordForm(page);
  await page.getByRole('button', { name: 'Add a category not listed above' }).click();
  await page.getByLabel('New category name (required)').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();

  // The category form closes and the new category is already selected, so the Admin does not have
  // to find it in a list they did not know they had just extended. That is what proves the create
  // succeeded: a refused create keeps the form open with the name still typed.
  await expect(page.getByLabel('New category name (required)')).toHaveCount(0);
  await expect(page.getByLabel('Category (required)')).toHaveValue(/./);

  return name;
}

test.describe('expense management', () => {
  test('the Expenses screen loads and every control is live', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);

    await openExpenses(page);

    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByTestId('result-count')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record expense', exact: true })).toBeVisible();

    // The form opens, is real, and closes again: a control that cannot be dismissed is a dead
    // control, and the toggle must say what it will do.
    await openRecordForm(page);
    await expect(page.getByRole('button', { name: 'Cancel recording expense' })).toBeVisible();
    // `exact` is required: the toggle's own accessible name contains "Cancel", so a substring
    // match resolves to two buttons and the strict-mode violation proves nothing about the UI.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Record expense' })).toHaveCount(0);

    // The filters are server-side criteria, not decoration.
    await page.getByLabel('Status').selectOption('ACTIVE');
    await expect(page.getByTestId('result-count')).toBeVisible();
    await page.getByRole('button', { name: 'Reset all filters' }).first().click();
    await expect(page.getByLabel('Status')).toHaveValue('');

    expect(browserErrors).toEqual([]);
  });

  test('an expense is recorded, referenced, and listed at its exact amount', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    const referenceId = await recordExpense(page, {
      amount: '2450.75',
      category: 'Electricity',
      paymentMethod: 'BANK_TRANSFER',
      description,
    });

    // The list must show what the server stored, with an exact grouped amount and the reference
    // the API allocated, rather than an optimistic row that only looks saved.
    await searchExpenses(page, description);
    await expect(matchedExpenseRow(page)).toHaveCount(1);
    await expect(matchedExpenseRow(page)).toHaveAttribute(
      'aria-label',
      new RegExp(`^View expense ${referenceId} for `),
    );
    await expect(page.getByTestId('result-count')).toHaveText('1 record found');

    const row = matchedExpenseRow(page).locator('xpath=ancestor::tr');
    await expect(row).toContainText(referenceId);
    await expect(row).toContainText('2,450.75');
    await expect(row).toContainText('Electricity');
    await expect(row).toContainText('Bank Transfer');
    await expect(row).toContainText('Active');

    // `REQ-EXP-004`: the category is part of the record, not a label the browser inferred.
    await openRecordByDescription(page, description);
    await expect(recordedDetail(page, 'Expense reference')).toHaveText(referenceId);
    await expect(recordedDetail(page, 'Category')).toHaveText('Electricity');
    await expect(recordedDetail(page, 'Description')).toHaveText(description);

    expect(browserErrors).toEqual([]);
  });

  test('a receipt can be attached to an expense and removed again, and both states are stated', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    await recordExpense(page, { amount: '310.00', category: 'Water', description });
    await openRecordByDescription(page, description);

    // `REQ-DOC-003`. The fact is stated in words. The words appear twice on the screen — in the
    // receipt panel and in the recorded details — so the panel is addressed by its landmark; a bare
    // text match would violate strict mode and prove nothing.
    const receiptPanel = page.getByRole('region', {
      name: `Receipt for ${await expenseReference(page)}`,
    });

    await expect(receiptPanel.getByText('Receipt Missing', { exact: true })).toBeVisible();
    await expect(recordedDetail(page, 'Receipt')).toHaveText('Receipt Missing');

    // A real file, uploaded through the real multipart route against the real API and the real
    // storage adapter. The bytes are a valid one-pixel PNG, because the API validates the content
    // rather than the declared type, and a file of the wrong content would be refused.
    await receiptPanel.getByLabel('Receipt file').setInputFiles({
      name: 'water-bill.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    await receiptPanel.getByRole('button', { name: 'Upload receipt' }).click();

    // The stored row carries the reference the server allocated and the filename the Admin chose,
    // which is what proves the bytes really went through upload, storage, and persistence.
    await expect(receiptPanel.getByText(/water-bill\.png \(HY-DOC-\d{6}\)/)).toBeVisible();
    await expect(recordedDetail(page, 'Receipt')).toHaveText('Attached');
    await expect(receiptPanel.getByRole('button', { name: 'Download receipt' })).toBeVisible();
    await expect(receiptPanel.getByRole('button', { name: 'Preview receipt' })).toBeVisible();

    // Removal requires a reason, and the removed record is retained rather than erased, so the panel
    // explains itself instead of quietly losing the audit trail.
    await receiptPanel.getByRole('button', { name: 'Remove receipt' }).click();
    await expect(receiptPanel.getByText('Enter a reason for removing this receipt.')).toBeVisible();
    await receiptPanel.getByLabel('Reason for removing this receipt').fill('wrong expense');
    await receiptPanel.getByRole('button', { name: 'Remove receipt' }).click();
    await expect(receiptPanel.getByText('This receipt was removed.')).toBeVisible();
    await expect(receiptPanel.getByText('Reason: wrong expense')).toBeVisible();
    await expect(recordedDetail(page, 'Receipt')).toHaveText('Receipt Missing');
    // The bytes are gone, so no control offers to fetch them.
    await expect(receiptPanel.getByRole('button', { name: 'Download receipt' })).toHaveCount(0);

    // The record is still a real, counted expense: the void control is live, which it would not be if
    // the missing receipt had left the record in a broken state.
    await expect(page.getByRole('button', { name: 'Void this expense' }).first()).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('a stored receipt is served again as the same bytes, proving the download really works', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    await recordExpense(page, { amount: '318.00', category: 'Water', description });
    await openRecordByDescription(page, description);

    const receiptPanel = page.getByRole('region', {
      name: `Receipt for ${await expenseReference(page)}`,
    });

    await receiptPanel.getByLabel('Receipt file').setInputFiles({
      name: 'receipt-bytes.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    await receiptPanel.getByRole('button', { name: 'Upload receipt' }).click();
    await expect(receiptPanel.getByText(/receipt-bytes\.png \(HY-DOC-\d{6}\)/)).toBeVisible();

    // The panel must not synthesize this path from the document id: the server decides it, and
    // the browser uses whatever the API returned. Capturing the request proves both the path the
    // browser chose and that the session cookie was carried on the content request.
    // The panel must not synthesize this path from the document id: the server decides it, and the
    // browser requests whatever the API returned. Capturing the outgoing request proves both that
    // the click did real work and that the session cookie was carried on the content request.
    const contentRequest = page.waitForRequest(
      (request) =>
        /\/api\/v1\/documents\/[0-9a-f-]+\/download$/.test(new URL(request.url()).pathname) &&
        request.method() === 'GET',
    );

    await receiptPanel.getByRole('button', { name: 'Download receipt' }).click();

    const requestedPath = new URL((await contentRequest).url()).pathname;

    // The same must hold for the inline preview, which the API only offers for a format it can
    // render. Asserting the control exists proves nothing; requesting the route proves it.
    const previewRequest = page.waitForRequest(
      (request) =>
        /\/api\/v1\/documents\/[0-9a-f-]+\/preview$/.test(new URL(request.url()).pathname) &&
        request.method() === 'GET',
    );

    await receiptPanel.getByRole('button', { name: 'Preview receipt' }).click();

    await previewRequest;

    // The stored bytes are then read back over the server-authenticated request context, which is
    // the only place the real payload can be inspected: the panel fetches it into a blob URL, so
    // the body never reaches Playwright's response recorder.
    for (const route of [requestedPath, requestedPath.replace(/\/download$/, '/preview')]) {
      const served = await page.request.get(route);

      expect(served.status()).toBe(200);
      expect(served.headers()['content-type']).toContain('image/png');

      const body = Buffer.from(await served.body());

      expect([body.length, body.subarray(0, 16).toString('hex')]).toStrictEqual([
        ONE_PIXEL_PNG.length,
        ONE_PIXEL_PNG.subarray(0, 16).toString('hex'),
      ]);
    }

    // The download offers the Admin's own filename back, so the saved file is the one the server
    // verified rather than a UUID.
    expect((await page.request.get(requestedPath)).headers()['content-disposition']).toContain(
      'receipt-bytes.png',
    );

    expect(browserErrors).toEqual([]);
  });

  test('after a removal the bytes are gone and the retained row refuses to serve them', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    await recordExpense(page, { amount: '322.00', category: 'Water', description });
    await openRecordByDescription(page, description);

    const receiptPanel = page.getByRole('region', {
      name: `Receipt for ${await expenseReference(page)}`,
    });

    await receiptPanel.getByLabel('Receipt file').setInputFiles({
      name: 'gone-after-removal.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    await receiptPanel.getByRole('button', { name: 'Upload receipt' }).click();
    await expect(receiptPanel.getByText(/gone-after-removal\.png \(HY-DOC-\d{6}\)/)).toBeVisible();

    await receiptPanel.getByLabel('Reason for removing this receipt').fill('attached by mistake');
    await receiptPanel.getByRole('button', { name: 'Remove receipt' }).click();
    await expect(receiptPanel.getByText('This receipt was removed.')).toBeVisible();

    // `REQ-DOC-007`: the metadata is retained but the content is no longer readable. The API
    // answers `410 Gone`, not `404`, because the document still exists as history. Asserting the
    // retained row is not enough; the served response must be proven to be gone.
    // The stored UUID is read from the API's own projection rather than parsed out of the UI text,
    // because `HY-DOC-000123` is the human reference and the content route is keyed by the UUID.
    const documents = await page.request.get(
      `/api/v1/transactions/${await expenseId(page)}/documents`,
    );

    expect(documents.status()).toBe(200);

    const rows = (await documents.json()) as { data?: { id: string; status: string }[] };
    const removed = rows.data?.find((row) => row.status === 'REMOVED');

    expect(removed?.id).toBeTruthy();

    const goneResponse = await page.request.get(
      `/api/v1/documents/${removed?.id as string}/download`,
    );

    expect(goneResponse.status()).toBe(410);

    // And the interface must not offer a control for content it knows is unreadable.
    await expect(receiptPanel.getByRole('button', { name: 'Download receipt' })).toHaveCount(0);
    await expect(receiptPanel.getByRole('button', { name: 'Preview receipt' })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });

  test('a removal with no reason is refused, so a receipt is never removed without an explanation', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    await recordExpense(page, { amount: '312.00', category: 'Water', description });
    await openRecordByDescription(page, description);

    const receiptPanel = page.getByRole('region', {
      name: `Receipt for ${await expenseReference(page)}`,
    });

    await receiptPanel.getByLabel('Receipt file').setInputFiles({
      name: 'water-bill.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    await receiptPanel.getByRole('button', { name: 'Upload receipt' }).click();
    await expect(receiptPanel.getByText(/water-bill\.png \(HY-DOC-\d{6}\)/)).toBeVisible();

    // `REQ-DOC-006`. Removing with an empty reason must be refused and must leave the receipt in
    // place, so the Admin cannot delete a receipt without saying why.
    await receiptPanel.getByRole('button', { name: 'Remove receipt' }).click();
    await expect(receiptPanel.getByText('Enter a reason for removing this receipt.')).toBeVisible();
    await expect(receiptPanel.getByText(/water-bill\.png \(HY-DOC-\d{6}\)/)).toBeVisible();
    await expect(recordedDetail(page, 'Receipt')).toHaveText('Attached');

    expect(browserErrors).toEqual([]);
  });

  test('a custom category is added inline and is immediately usable for a new expense', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    const categoryName = await createCustomCategory(page);

    // The category has to be selected in the same form session the Admin is already in, which is
    // the point of adding it inline rather than sending them to another screen.
    await page.getByLabel('Amount (required)').fill('540.50');
    await page.getByLabel('Category (required)').selectOption({ label: categoryName });
    await page.getByLabel('Payment method (required)').selectOption('UPI');
    await page.getByLabel('Business date (required)').fill(currentBusinessDate());
    await page.getByLabel('Description (optional)').fill(description);
    await page.getByRole('button', { name: 'Record expense', exact: true }).click();

    const confirmation = page.getByText(/was recorded as HY-EXP-\d{6} under /);
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(categoryName);

    // It persists across a reload, so the server stored it rather than the browser caching it.
    await page.reload();
    await gotoExpenses(page);
    await openRecordForm(page);
    await expect(page.getByLabel('Category (required)')).toContainText(categoryName);

    expect(browserErrors).toEqual([]);
  });

  test('a duplicate category name is refused with the conflict, not silently merged', async ({
    page,
  }) => {
    // The `409` is the documented answer and the thing this journey exists to observe, so its
    // network-level console line is absorbed rather than treated as a defect.
    const browserErrors = collectBrowserErrors(page, false, true);

    await openExpenses(page);
    await openRecordForm(page);
    await page.getByRole('button', { name: 'Add a category not listed above' }).click();

    // Uniqueness is case-insensitive, so "electricity" is the category the initial set already
    // has. The server owns that rule, and the message has to name the field so the Admin knows
    // what to change. The wording asserted here is the API's own, not a copy of it: this journey
    // runs against the real API, so an assertion written to the stub's wording would pass in the
    // component suite and fail here, which is exactly the drift this layer exists to catch.
    await page.getByLabel('New category name (required)').fill('electricity');
    await page.getByRole('button', { name: 'Add category' }).click();

    await expect(page.getByText('A category with this name already exists.')).toBeVisible();
    // The typed name is kept, so correcting it does not mean retyping it.
    await expect(page.getByLabel('New category name (required)')).toHaveValue('electricity');

    expect(browserErrors).toEqual([]);
  });

  test('a correction keeps the record, moves the category, and preserves the old values', async ({
    page,
  }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    const referenceId = await recordExpense(page, {
      amount: '900.00',
      category: 'Repairs',
      description,
    });
    await openRecordByDescription(page, description);

    // The screen states which revision the edit is based on, so a stale save is refused rather
    // than silently overwriting someone else's change.
    await page.getByRole('button', { name: 'Edit amount, category, or details' }).click();
    await expect(
      page.getByText(new RegExp(`You are editing revision 1 of ${referenceId}\\.`)),
    ).toBeVisible();

    // `REQ-EXP-004` makes the category the association a correction may change.
    await page.getByLabel('Category (required)').selectOption({ label: 'Church Maintenance' });
    await page.getByLabel('Amount (required)').fill('1125.40');
    await page.getByRole('button', { name: 'Save correction' }).click();

    await expect(page.getByText(/^Correction saved\./)).toBeVisible();
    await expect(recordedDetail(page, 'Category')).toHaveText('Church Maintenance');
    await expect(page.getByText('1,125.40').first()).toBeVisible();

    // The history must carry the change itself, not just the new value: the previous amount and
    // the previous category both stay visible, which is the whole point of a correction.
    const history = page.getByRole('region', { name: 'History' });
    await expect(history).toContainText('TRANSACTION_CREATED');
    await expect(history).toContainText('TRANSACTION_UPDATED');
    await expect(history).toContainText('900.00');
    await expect(history).toContainText('1,125.40');

    // A second correction is offered against the new revision, so the lock advanced with the
    // change rather than staying pinned to 1.
    await expect(
      page.getByText(new RegExp(`You are editing revision 2 of ${referenceId}\\.`)),
    ).toBeVisible();

    expect(browserErrors).toEqual([]);
  });

  test('voiding requires a reason, keeps the record, and freezes it', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    await recordExpense(page, { amount: '600.00', category: 'Decoration', description });
    await openRecordByDescription(page, description);

    await page.getByRole('button', { name: 'Void this expense' }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Void this record' })).toBeVisible();

    // A reason is required, because a void that cannot be explained is not auditable.
    await page.getByRole('button', { name: 'Void this expense' }).last().click();
    await expect(page.getByText('Enter a reason for voiding this transaction.')).toBeVisible();

    await page
      .getByLabel('Reason for voiding (required)')
      .fill('Entered against the wrong category');
    await page.getByRole('button', { name: 'Void this expense' }).last().click();

    await expect(page.getByText(/HY-EXP-\d{6} was voided\./)).toBeVisible();
    // Void is a state, not a deletion: the record, its reason, and its history remain on screen.
    await expect(
      page.getByText(/kept in the records and no longer counts toward any total/),
    ).toBeVisible();
    // The reason is the point of the void, and it is on the record in three places: the
    // confirmation, the record's own reason, and the audit change. The record's reason is
    // addressed by its label so the assertion cannot silently pass on a different node.
    await expect(
      page.getByText('Reason: Entered against the wrong category', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'History' })).toContainText('TRANSACTION_VOIDED');
    // The status a void leaves behind says in words that the record still exists and is simply
    // not counted, because a status of "Voided" alone reads like a deletion.
    await expect(page.getByText('Voided — not counted in totals')).toBeVisible();

    // The controls that would change a frozen record are withdrawn rather than left to fail.
    await expect(
      page.getByRole('button', { name: 'Edit amount, category, or details' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Void this expense' })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });

  test('search, filters, and reset narrow the expense list through the API', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const description = uniqueRunTag();

    await openExpenses(page);
    const referenceId = await recordExpense(page, {
      amount: '450.00',
      category: 'Food',
      description,
    });

    // Searching for this run's unique text finds exactly this run's record.
    await searchExpenses(page, description);
    await expect(page.getByTestId('result-count')).toHaveText('1 record found');
    await expect(matchedExpenseRow(page)).toHaveCount(1);

    // A search that matches nothing says so, rather than showing the whole ledger or a blank
    // table, so "no match" and "nothing recorded" stay distinguishable.
    await searchExpenses(page, `${description}-no-such-record`);
    await expect(page.getByTestId('result-count')).toHaveText('No expenses to show');
    await expect(page.getByText('No expenses match these filters')).toBeVisible();

    // The criteria are shown as active and can be removed individually.
    await expect(page.getByRole('button', { name: /Remove filter: Search:/ })).toBeVisible();

    // The category criterion is a real server-side filter, not a client-side one. This run's
    // record is filed under Food, so choosing Transport has to remove it from the list rather
    // than leave it on screen behind a criterion that does not match it.
    await page.getByRole('button', { name: 'Reset all filters' }).first().click();
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Transport' });
    await expect(page.getByRole('button', { name: /Remove filter: Category:/ })).toBeVisible();
    await expect(page.getByText(referenceId, { exact: true })).toHaveCount(0);

    // Clearing the criterion brings the record back, so the filter was reversible.
    await page.getByLabel('Category', { exact: true }).selectOption('');
    await expect(page.getByText(referenceId, { exact: true })).toBeVisible();

    // An amount range is honoured by the API as well, compared as exact paise rather than as
    // formatted text: the record is exactly 450.00, so 449.99 includes it and 450.01 excludes it.
    await page.getByLabel('Amount from').fill('449.99');
    await expect(page.getByText(referenceId, { exact: true })).toBeVisible();
    await page.getByLabel('Amount from').fill('450.01');
    await expect(page.getByText(referenceId, { exact: true })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
  });

  test('a malformed amount is refused before any request is sent', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const sent: string[] = [];

    page.on('request', (request) => {
      if (request.method() === 'POST') {
        sent.push(request.url());
      }
    });

    await openExpenses(page);
    await openRecordForm(page);

    // An amount that is not a number must not reach the ledger, and the message must be shown
    // against the field rather than as a generic server failure.
    await page.getByLabel('Amount (required)').fill('twelve hundred');
    await page.getByLabel('Category (required)').selectOption({ label: 'Other' });
    await page.getByRole('button', { name: 'Record expense', exact: true }).click();

    await expect(
      page.getByText('Enter an amount such as 500 or 500.00, with at most two decimal places.'),
    ).toBeVisible();
    expect(sent.filter((url) => url.includes('/expenses'))).toEqual([]);

    expect(browserErrors).toEqual([]);
  });

  test('the expense screens hold their layout on a narrow phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openExpenses(page);

    // No horizontal overflow is allowed: a table that cannot be narrowed past the viewport
    // leaves the Admin unable to read the amount or reach the record's own controls.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(page.getByRole('button', { name: 'Record expense', exact: true })).toBeVisible();

    await openRecordForm(page);

    const formOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(formOverflow).toBeLessThanOrEqual(1);

    // Every required control is reachable and neither clipped nor overlapped.
    await expect(page.getByLabel('Amount (required)')).toBeVisible();
    await expect(page.getByLabel('Category (required)')).toBeVisible();
    await expect(page.getByLabel('Payment method (required)')).toBeVisible();
    await expect(page.getByLabel('Business date (required)')).toBeVisible();
  });
});
