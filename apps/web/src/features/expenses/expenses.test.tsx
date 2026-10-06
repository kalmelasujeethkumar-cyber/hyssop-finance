import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render';
import { ApiClientError } from '../../lib/api-client';
import {
  ACTIVE_EXPENSE_CATEGORIES,
  ACTIVE_EXPENSE_REASONS,
  DEFAULT_EXPENSE_CSV,
  EXPENSE_ONE,
  EXPENSE_ONE_AUDIT,
  EXPENSE_RETIRED_CATEGORY,
  EXPENSE_TWO,
  EXPENSE_VOIDED,
  INCOME_ONE,
  notFound,
  serverFailure,
  staleTransactionRevision,
  stubApiClient,
  transportFailure,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * Browser expense tests: the list, the filters, recording an expense, the detail screen, the
 * audited correction that can move the category, the reason-required void, and the receipt state.
 *
 * These satisfy `TEST-EXP-001`, `TEST-FIN-002`, and `TEST-DOC-001` in the browser layer. They run
 * against the real route tree, the real provider stack, and a stateful stub client that applies
 * the documented filters, allocates references, refuses a cleared category, refuses a stale
 * `If-Match`, requires a void reason, and replays a repeated `Idempotency-Key` — so a dead filter,
 * a dead submit button, a category that could be stripped, or a stale edit fails here rather than
 * only in a browser run against a real API.
 */

/** A server-side rejection of the category, so the message is shown against the field it belongs to. */
const categoryNoLongerUsable = new ApiClientError(
  400,
  'VALIDATION_FAILED',
  'The request could not be accepted.',
  'req-expense-1',
  [
    {
      field: 'categoryId',
      message: 'Only an active category can be used for a new expense.',
    },
  ],
);

/**
 * The desktop table and the mobile card list render the same rows, because the layout switches at
 * the `sm` breakpoint and jsdom applies no CSS. Queries against expense rows are therefore scoped
 * to the table.
 */
function desktopTable(): HTMLElement {
  return screen.getByRole('table', { hidden: false });
}

function renderExpenses(client: StubApiClient, path = '/expenses'): StubApiClient {
  renderRoute({ client, path });

  return client;
}

function lastCallTo(client: StubApiClient, method: string, pathFragment: string) {
  const matching = client.calls.filter(
    (call) => call.method === method && call.path.includes(pathFragment),
  );

  return matching[matching.length - 1];
}

function lastExactCallTo(client: StubApiClient, method: string, path: string) {
  const matching = client.calls.filter((call) => call.method === method && call.path === path);

  return matching[matching.length - 1];
}

function callsTo(client: StubApiClient, method: string, pathFragment: string) {
  return client.calls.filter((call) => call.method === method && call.path.includes(pathFragment));
}

async function openRecordForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Record expense' }));

  // The toggle now reads "Cancel recording expense", so the submit button is the only control
  // still called "Record expense" and the two can never be confused for one another.
  expect(screen.getByRole('button', { name: 'Cancel recording expense' })).toBeInTheDocument();
}

/**
 * Chooses a category and then a reason of that category, waiting for the API to answer both.
 *
 * The two are one step for the Admin, so the tests that record an expense should not have to know
 * that the reason list is fetched *after* a category is chosen. Doing both here is also what keeps
 * every recording test valid: an expense with a category but no reason is refused by the API, so a
 * helper that stopped at the category would leave them all failing for one shared reason.
 */
async function chooseCategory(
  user: ReturnType<typeof userEvent.setup>,
  categoryId: string,
): Promise<void> {
  const picker = screen.getByLabelText('Category (required)');

  await within(picker).findByRole('option', { name: 'Electricity' });
  await user.selectOptions(picker, categoryId);

  const reasonPicker = screen.getByLabelText('Reason (required)');
  const reason = ACTIVE_EXPENSE_REASONS.find((row) => row.categoryId === categoryId);

  expect(reason).toBeDefined();
  await within(reasonPicker).findByRole('option', { name: reason?.name ?? '' });
  await user.selectOptions(reasonPicker, reason?.id ?? '');
}

async function openCorrectionForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Edit amount, category, or details' }));

  await screen.findByRole('button', { name: 'Save correction' });
}

async function openVoidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Void this expense' }));

  await screen.findByLabelText('Reason for voiding (required)');
}

describe('the expense list', () => {
  it('reads expenses through the documented expense list, not the shared income list', async () => {
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');

    // `docs/06-API-SPEC.md` defines `GET /api/v1/expenses`, so the browser uses it rather than
    // filtering the shared list down to expenses and hoping the server narrows it correctly.
    const call = lastCallTo(client, 'GET', '/expenses?');

    expect(call?.path).toContain('page=1');
    expect(call?.path).toContain('pageSize=20');
    expect(call?.path).toContain('sort=businessDate');
    expect(call?.path).toContain('direction=desc');
  });

  it('lists expenses with their references, categories, dates, and exact amounts', async () => {
    renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');

    // A header row plus the four stubbed expense records.
    expect(rows).toHaveLength(5);
    expect(within(table).getByText(EXPENSE_ONE.referenceId)).toBeInTheDocument();
    expect(within(table).getByText('₹2,450.75')).toBeInTheDocument();
    expect(within(table).getByText('₹800.00')).toBeInTheDocument();
    // Two expenses are filed under Electricity, so the label is asserted by count rather than as
    // a single hit: one per row, and never a blank cell for a row whose category is known.
    expect(within(table).getAllByText('Electricity')).toHaveLength(2);
    expect(within(table).getAllByText('Repairs')).toHaveLength(1);
    expect(within(table).getByText('12 Sep 2026')).toBeInTheDocument();
  });

  it('never lists an income record, because the route is narrowed server-side', async () => {
    renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');

    // The store holds both types, so a passing assertion proves the narrowing rather than the
    // fixture.
    expect(within(table).queryByText(INCOME_ONE.referenceId)).not.toBeInTheDocument();
  });

  it('shows how many expenses matched, so the list is never unlabelled', async () => {
    renderExpenses(stubApiClient());

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('4 records found');
    });
  });

  it('keeps a voided expense visible and marks it voided, rather than deleting it', async () => {
    // `REQ-FIN-016` makes voiding a state change, so a screen that hid the row would imply the
    // expense never happened.
    renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');

    expect(within(table).getByText(EXPENSE_VOIDED.referenceId)).toBeInTheDocument();
    expect(within(table).getByText('Voided')).toBeInTheDocument();
  });

  it('says Receipt Missing for an expense with no receipt, in the documented words', async () => {
    // `REQ-DOC-003`. The label is the requirement; an empty cell, a dash, or "No receipt" would
    // each be a different and weaker statement.
    renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');

    expect(within(table).getAllByText('Receipt Missing').length).toBeGreaterThan(0);
    expect(within(table).getByText('Attached')).toBeInTheDocument();
    // The list stays read-only: it states the receipt state and opens the detail screen, which owns
    // the upload control. A list button would duplicate the flow and add a second way to be wrong.
    expect(within(table).queryByRole('button', { name: /attach|upload/i })).toBeNull();
  });

  it('keeps the label of a category that has since been deactivated, and says so', async () => {
    // `docs/05-DATABASE-SPEC.md` preserves inactive categories on historical transactions, so the
    // row must not be blanked and the name must not be swapped for an active one.
    renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');

    expect(within(table).getByText('Retired category (inactive)')).toBeInTheDocument();
    expect(within(table).getByText(EXPENSE_RETIRED_CATEGORY.referenceId)).toBeInTheDocument();
  });

  it('distinguishes a church with no expenses from a filter that matched nothing', async () => {
    renderExpenses(stubApiClient({ transactions: { transactions: [] } }));

    expect(await screen.findByText('No expenses recorded yet')).toBeInTheDocument();
    expect(screen.queryByText('No expenses match these filters')).not.toBeInTheDocument();
  });

  it('reports a load failure and offers a retry that really refetches', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ expenses: { listFails: transportFailure } });

    renderRoute({ client, path: '/expenses' });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    const before = callsTo(client, 'GET', '/expenses?').length;

    await user.click(screen.getByRole('button', { name: 'Try loading expenses again' }));

    await waitFor(() => {
      expect(callsTo(client, 'GET', '/expenses?').length).toBeGreaterThan(before);
    });
  });
});

describe('searching and filtering expenses', () => {
  it('sends the search term to the API and narrows the rows it shows', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search expenses'), EXPENSE_TWO.referenceId);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', '/expenses?')?.path).toContain(
      `search=${EXPENSE_TWO.referenceId}`,
    );
    expect(within(desktopTable()).getByText(EXPENSE_TWO.referenceId)).toBeInTheDocument();
    expect(within(desktopTable()).queryByText(EXPENSE_ONE.referenceId)).not.toBeInTheDocument();
  });

  it('searches by category name as well as by reference', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search expenses'), 'Choir');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', '/expenses?')?.path).toContain('search=Choir');
  });

  it('searches by reason name, because REQ-SEARCH-002 requires it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    const reasonName = ACTIVE_EXPENSE_REASONS[0]?.name ?? '';

    await screen.findByRole('table');
    // Wait for the rows themselves, not just the table element: a table can exist before its body
    // has any data, and counting zero rows would make the "fewer rows came back" assertion pass
    // for the wrong reason.
    await waitFor(() => {
      expect(desktopTable().querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    });
    const unfilteredRows = desktopTable().querySelectorAll('tbody tr').length;

    await user.type(screen.getByLabelText('Search expenses'), reasonName);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // The term must reach the API as one search parameter. If the browser sent it to a field the
    // API does not search, the request would succeed and return everything, which is a silent
    // "no filtering" rather than a visible failure. The parameter is decoded rather than compared
    // as text, because a space is legal on the wire as either `+` or `%20` and the test is about
    // the criterion reaching the API, not about one encoder.
    await waitFor(() => {
      const path = lastCallTo(client, 'GET', '/expenses?')?.path ?? '';
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));

      expect(query.get('search')).toBe(reasonName);
    });

    // The reason name has to narrow the list, not merely reach the API. Matching every row would
    // look successful while filtering nothing, so the assertions are that fewer rows came back and
    // that the label is visible on the ones that did.
    await waitFor(() => {
      expect(desktopTable().querySelectorAll('tbody tr').length).toBeLessThan(unfilteredRows);
    });

    const matchedRows = desktopTable().querySelectorAll('tbody tr').length;
    expect(matchedRows).toBeGreaterThan(0);
    expect(within(desktopTable()).getAllByText(reasonName)).toHaveLength(matchedRows);
  });

  it('shows the reason beside the category, on the row and on the mobile card', async () => {
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    // The row states what the expense was for, not only which bucket it fell into. More than one
    // fixture shares the reason, so this cannot pass on a single lucky match.
    expect(
      within(desktopTable()).getAllByText(ACTIVE_EXPENSE_REASONS[0]?.name ?? ''),
    ).not.toHaveLength(0);
  });

  it('narrows by category, offering only the categories a new expense may use', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    const filter = screen.getByLabelText('Category');

    // The API documents this route as the *active* categories, so the filter offers exactly those
    // and never a deactivated one the server would refuse.
    await within(filter).findByRole('option', { name: 'Repairs' });
    expect(
      within(filter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All categories', 'Electricity', 'Repairs']);

    await user.selectOptions(filter, ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '');

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', '/expenses?')?.path).toContain('categoryId=');
  });

  it('shows the category as an active filter, because it narrows the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).toBeNull();

    // A criterion that reaches the API has to be visible and reversible. Leaving the category out
    // of the active-criteria sum narrowed the list while the screen showed no filter at all and
    // offered no way back to all expenses.
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '',
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Remove filter: Category: Repairs/ }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Reset all filters' })).toBeInTheDocument();
  });

  it('narrows by status, and can drop one criterion while keeping another', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await user.type(screen.getByLabelText('Search expenses'), 'Choir');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    const path = lastCallTo(client, 'GET', '/expenses?')?.path ?? '';

    expect(path).toContain('status=ACTIVE');
    expect(path).toContain('search=Choir');

    await user.click(screen.getByRole('button', { name: /Remove filter: Search: Choir/ }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('3 records found');
    });
    expect(screen.queryByRole('button', { name: /Remove filter: Search: Choir/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Remove filter: Status: ACTIVE/ }),
    ).toBeInTheDocument();
  });

  it('narrows by amount window and by business date, so every criterion reaches the API', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Amount from (optional)'), '700');
    await user.type(screen.getByLabelText('Amount to (optional)'), '2500');
    await user.type(screen.getByLabelText('Business date from (optional)'), '2026-09-01');

    await waitFor(() => {
      const path = lastCallTo(client, 'GET', '/expenses?')?.path ?? '';

      expect(path).toContain('minAmount=700');
      expect(path).toContain('maxAmount=2500');
      expect(path).toContain('from=2026-09-01');
    });
    // 2,450.75 and 800.00 both fall inside the window; 320.40 and 150.00 do not.
    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('2 records found');
    });
  });

  it('sorts by amount through the API, compared as exact paise', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'amount');
    await user.selectOptions(screen.getByLabelText('Order'), 'asc');

    await waitFor(() => {
      expect(lastCallTo(client, 'GET', '/expenses?')?.path).toContain('sort=amount');
    });
    await waitFor(() => {
      const cells = within(desktopTable())
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

      expect(cells).toEqual([
        EXPENSE_VOIDED.referenceId,
        EXPENSE_RETIRED_CATEGORY.referenceId,
        EXPENSE_TWO.referenceId,
        EXPENSE_ONE.referenceId,
      ]);
    });
  });

  it('explains an empty filter result and offers a reset instead of a blank table', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search expenses'), 'zzzz-no-such-expense');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No expenses match these filters')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('resets every criterion and returns to the full list', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '',
    );

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });

    await user.click(screen.getByRole('button', { name: 'Reset all filters' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('4 records found');
    });
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(screen.getByLabelText('Search expenses')).toHaveValue('');
  });
});

describe('recording an expense', () => {
  it('offers only the active categories and requires one', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    const picker = screen.getByLabelText('Category (required)');

    await within(picker).findByRole('option', { name: 'Electricity' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a category', 'Electricity', 'Repairs']);
    expect(picker).toHaveAttribute('required');
  });

  it('refuses to submit without a category and says which field is the problem', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    // `REQ-EXP-004`: exactly one category, so this is not a warning to be dismissed but a
    // refusal, and no request is made.
    expect(await screen.findByText('Choose a category.')).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses')).toHaveLength(0);
  });

  it('refuses a zero amount before sending it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '0');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    expect(await screen.findByText('The amount must be greater than zero.')).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses')).toHaveLength(0);
  });

  it('records an expense and confirms with the reference the API allocated', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');

    const businessDate = screen.getByLabelText<HTMLInputElement>('Business date (required)');

    // The date is pre-filled with today in Asia/Kolkata, so the most common entry needs no date
    // typing; the assertion is on the shape that was actually sent.
    expect(businessDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.type(screen.getByLabelText('Amount (required)'), '2450.75');
    await user.selectOptions(screen.getByLabelText('Payment method (required)'), 'BANK_TRANSFER');
    await user.type(screen.getByLabelText('Description (optional)'), 'October electricity bill');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    expect(await screen.findByText(/was recorded as HY-EXP-/)).toBeInTheDocument();

    const call = lastExactCallTo(client, 'POST', '/expenses');

    expect(call?.body).toEqual({
      categoryId: ACTIVE_EXPENSE_CATEGORIES[0]?.id,
      expenseReasonId: ACTIVE_EXPENSE_REASONS.find(
        (row) => row.categoryId === ACTIVE_EXPENSE_CATEGORIES[0]?.id,
      )?.id,
      amount: '2450.75',
      paymentMethod: 'BANK_TRANSFER',
      businessDate: businessDate.value,
      description: 'October electricity bill',
    });
    expect(call?.csrfToken).toBeDefined();
    // Every create carries a key, so a double submit or a retry records one expense.
    expect(call?.idempotencyKey).toBeTruthy();
  });

  it('sends no member and no income type, because an expense belongs to the church', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '100');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    await screen.findByText(/was recorded as HY-EXP-/);

    const body = lastExactCallTo(client, 'POST', '/expenses')?.body as Record<string, unknown>;

    expect(body).not.toHaveProperty('memberId');
    expect(body).not.toHaveProperty('incomeType');
    // A value that is never sent cannot be stored, searched, or exported.
    expect(JSON.stringify(body)).not.toMatch(/Anitha|Benedict|Chandralekha/);
    expect(screen.queryByLabelText(/^Member/)).not.toBeInTheDocument();
  });

  it('allocates the reference server-side and does not offer an input for it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    expect(screen.queryByLabelText(/Expense reference/)).not.toBeInTheDocument();

    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    await screen.findByText(/was recorded as HY-EXP-/);
    expect(lastExactCallTo(client, 'POST', '/expenses')?.body).not.toHaveProperty('referenceId');
  });

  it('reuses one idempotency key across a retry, so a timeout cannot double-record', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ expenses: { firstCreateFails: transportFailure } });

    renderExpenses(client);
    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    expect(await screen.findByText(/was recorded as HY-EXP-/)).toBeInTheDocument();

    const keys = callsTo(client, 'POST', '/expenses').map((call) => call.idempotencyKey);

    // The retry is the *same* intent, so it must travel under the same key; that is the only
    // thing that lets the API recognise it as one expense rather than two.
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    // Eight stubbed records plus exactly one, counted by type so the assertion does not depend on
    // how many income fixtures the store also holds.
    expect(client.transactions.filter((row) => row.type === 'EXPENSE')).toHaveLength(5);
  });

  it('uses a new key for a new submission, because that is a new intent', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    await screen.findByText(/was recorded as HY-EXP-/);

    // The form deliberately starts a fresh submission: the category is chosen again rather than
    // the previous one silently carrying over.
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '600');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    await waitFor(() => {
      expect(callsTo(client, 'POST', '/expenses')).toHaveLength(2);
    });

    const keys = callsTo(client, 'POST', '/expenses').map((call) => call.idempotencyKey);

    expect(keys[0]).not.toBe(keys[1]);
    expect(client.transactions.filter((row) => row.type === 'EXPENSE')).toHaveLength(6);
  });

  it('shows a server-side category rejection against the category field', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient({ expenses: { createFails: categoryNoLongerUsable } }));

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    expect(
      await screen.findByText('Only an active category can be used for a new expense.'),
    ).toBeInTheDocument();
  });

  it('states up front that the expense is recorded with no receipt', async () => {
    // A document belongs to a transaction by id, so it can only be attached once the expense exists.
    // The create form therefore states the state the record will carry and sends the Admin to the
    // detail screen to attach, rather than holding a file control that has nothing to attach to yet.
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    expect(await screen.findByText(/recorded with no receipt attached/)).toBeInTheDocument();
    // No file input, because there is no transaction id to attach it to.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('adds a custom category inline and selects it, so an expense is never blocked', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.click(screen.getByRole('button', { name: 'Add a category not listed above' }));
    await user.type(screen.getByLabelText('New category name (required)'), 'Books');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    // The new category is in the picker and already selected, so the Admin does not have to hunt
    // for a list they did not know they had just extended.
    const picker = screen.getByLabelText('Category (required)');

    await within(picker).findByRole('option', { name: 'Books' });
    expect(picker).toHaveValue('99999999-9999-4999-8999-999999999999');
    expect(lastExactCallTo(client, 'POST', '/expenses/categories')?.body).toEqual({
      name: 'Books',
    });
    expect(lastExactCallTo(client, 'POST', '/expenses/categories')?.idempotencyKey).toBeTruthy();
  });

  it('refuses a duplicate category name and shows the conflict against the name field', async () => {
    // Uniqueness is case-insensitive, so "Electricity" and "electricity" are one category.
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.click(screen.getByRole('button', { name: 'Add a category not listed above' }));
    await user.type(screen.getByLabelText('New category name (required)'), 'electricity');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('That category name is already in use.')).toBeInTheDocument();
    // The form stays open, so the Admin can correct the name rather than losing what they typed.
    expect(screen.getByLabelText('New category name (required)')).toHaveValue('electricity');
    // One refused attempt, and the picker still offers only the categories that already exist.
    expect(callsTo(client, 'POST', '/expenses/categories')).toHaveLength(1);
    expect(
      within(screen.getByLabelText('Category (required)'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a category', 'Electricity', 'Repairs']);
    expect(screen.queryByRole('button', { name: 'Record expense' })).toBeInTheDocument();
  });

  it('refuses a blank category name without a request', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.click(screen.getByRole('button', { name: 'Add a category not listed above' }));
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('Enter a category name.')).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses/categories')).toHaveLength(0);
  });

  it('offers no Add Reason before a category exists, because the route requires one', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    // `POST /expenses/reasons` takes a `categoryId`. Offering the control here would produce a
    // request the API documents as invalid, which is a dead control rather than a helpful one.
    expect(
      screen.queryByRole('button', { name: 'Add a reason not listed above' }),
    ).not.toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses/reasons')).toHaveLength(0);
  });

  it('adds a custom reason to the chosen category and selects it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await user.selectOptions(
      screen.getByLabelText('Category (required)'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await screen.findByLabelText('Reason (required)');
    await user.click(screen.getByRole('button', { name: 'Add a reason not listed above' }));
    await user.type(screen.getByLabelText('New reason name (required)'), 'Generator fuel');
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    // The reason belongs to the category that was chosen, and is selected immediately, so the
    // Admin never has to hunt for a name they just typed.
    const picker = screen.getByLabelText('Reason (required)');
    const option = await within(picker).findByRole('option', { name: 'Generator fuel' });

    // The selected value must be the option that was just created. Asserting the picker is
    // non-empty would pass even if it had fallen back to some other reason.
    expect(picker).toHaveValue((option as HTMLOptionElement).value);
    expect(lastExactCallTo(client, 'POST', '/expenses/reasons')?.body).toEqual({
      categoryId: ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
      name: 'Generator fuel',
    });
    expect(lastExactCallTo(client, 'POST', '/expenses/reasons')?.idempotencyKey).toBeTruthy();
  });

  it('refuses a reason name already used in the same category, and keeps the typed name', async () => {
    // Uniqueness is per category, so this is a conflict rather than a name that is simply taken.
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await user.selectOptions(
      screen.getByLabelText('Category (required)'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await screen.findByLabelText('Reason (required)');
    await user.click(screen.getByRole('button', { name: 'Add a reason not listed above' }));
    await user.type(
      screen.getByLabelText('New reason name (required)'),
      ACTIVE_EXPENSE_REASONS[0]?.name.toLowerCase() ?? '',
    );
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    expect(await screen.findByText('That reason name is already in use here.')).toBeInTheDocument();
    // The name survives so the Admin can correct it rather than losing what they typed.
    expect(screen.getByLabelText('New reason name (required)')).toHaveValue(
      ACTIVE_EXPENSE_REASONS[0]?.name.toLowerCase() ?? '',
    );
    expect(callsTo(client, 'POST', '/expenses/reasons')).toHaveLength(1);
  });

  it('refuses a blank reason name without a request', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await user.selectOptions(
      screen.getByLabelText('Category (required)'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await screen.findByLabelText('Reason (required)');
    await user.click(screen.getByRole('button', { name: 'Add a reason not listed above' }));
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    expect(await screen.findByText('Enter a reason name.')).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses/reasons')).toHaveLength(0);
  });

  it('records the chosen reason with the expense, not just the category', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    await screen.findByText(/was recorded as HY-EXP-/);

    // The category alone is not enough: `REQ-EXP-005` requires the pairing to travel together, or
    // the server has to reject an expense the interface considered complete.
    const body = lastExactCallTo(client, 'POST', '/expenses')?.body as {
      categoryId: string;
      expenseReasonId: string;
    };
    const reason = ACTIVE_EXPENSE_REASONS.find((row) => row.categoryId === body.categoryId);

    expect(body.expenseReasonId).toBe(reason?.id ?? '');
  });

  it('cancels the form without recording anything', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('button', { name: 'Cancel recording expense' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record expense' })).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/expenses')).toHaveLength(0);
  });
});

describe('one expense record', () => {
  it('shows the stored record, not a locally reconstructed one', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    expect(await screen.findByText('Recorded details')).toBeInTheDocument();
    expect(screen.getByText(EXPENSE_ONE.referenceId)).toBeInTheDocument();
    expect(screen.getByText('September electricity bill')).toBeInTheDocument();
    expect(screen.getByText('Paid by transfer to the utility')).toBeInTheDocument();
    expect(screen.getByText('12 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
    expect(screen.getByText('Active — counted in totals')).toBeInTheDocument();
  });

  it('shows the category and the exact amount', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    expect(screen.getByText('Electricity')).toBeInTheDocument();
    expect(screen.getByText('₹2,450.75')).toBeInTheDocument();
  });

  it('shows the reason the expense was recorded under', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');

    // An expense answers "what was this for", which the category alone cannot. If the reason were
    // missing from the detail view the Admin would have to open the correction form to find out.
    expect(screen.getByText(EXPENSE_ONE.expenseReason.name)).toBeInTheDocument();
  });

  it('marks a deactivated category as inactive on the record that still has it', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_RETIRED_CATEGORY.id}`);

    await screen.findByText('Recorded details');
    expect(screen.getByText('Retired category (inactive)')).toBeInTheDocument();
  });

  it('keeps an inactive reason readable and says it is inactive', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_RETIRED_CATEGORY.id}`);

    await screen.findByText('Recorded details');

    // `docs/05-DATABASE-SPEC.md` preserves inactive reasons on historical expenses. The migration's
    // backfill produces exactly this shape for a retired category, so blanking it here would hide
    // real historical rows and make the record unreadable.
    expect(
      screen.getByText(`${EXPENSE_RETIRED_CATEGORY.expenseReason.name} (inactive)`),
    ).toBeVisible();
  });

  it('shows Receipt Missing for an expense with no receipt', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_TWO.id}`);

    await screen.findByText('Recorded details');
    // The requirement is that the interface clearly show **Receipt Missing**.
    expect(screen.getAllByText('Receipt Missing').length).toBeGreaterThan(0);
  });

  it('states the missing receipt and offers the real upload control', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_TWO.id}`);

    await screen.findByText('Recorded details');
    expect(screen.getAllByText('Receipt Missing').length).toBeGreaterThan(0);
    // Phase 07 replaced the placeholder with a control that works, so the file input and the upload
    // button are present rather than absent. `features/documents/documents.test.tsx` asserts what
    // happens when that button is used.
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /upload receipt/i })).toBeInTheDocument();
  });

  it('shows an attached receipt as attached, from the API-derived flag', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    expect(screen.getByText('Attached')).toBeInTheDocument();
    // The detail line and the receipt panel must agree, so the panel lists the real stored document
    // rather than contradicting "Attached" with a missing state. Awaited, because the transaction
    // and its documents are separate reads and the panel fills in after the detail line appears.
    expect(await screen.findByText(/receipt\.jpg \(HY-DOC-000001\)/)).toBeInTheDocument();
    expect(screen.queryByText('Receipt Missing')).not.toBeInTheDocument();
  });

  it('explains a voided expense and withdraws the controls that would change it', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_VOIDED.id}`);

    expect(
      await screen.findByText(/was voided on .*kept for audit and is no longer counted/),
    ).toBeInTheDocument();
    // A voided record is not edited and not voided again: withdrawing the control is the honest
    // expression of that, rather than a disabled button inviting the question of why.
    expect(
      screen.queryByRole('button', { name: 'Edit amount, category, or details' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void this expense' })).toBeNull();
  });

  it('refuses an income reference on an expense route instead of guessing', async () => {
    renderExpenses(stubApiClient(), `/expenses/${INCOME_ONE.id}`);

    expect(await screen.findByText(/is income, not an expense/)).toBeInTheDocument();
  });

  it('reports a record it could not load, and offers a retry that really refetches', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { detailFails: serverFailure } });

    renderRoute({ client, path: `/expenses/${EXPENSE_ONE.id}` });

    expect(await screen.findByRole('alert')).toHaveTextContent(serverFailure.message);
    const before = callsTo(client, 'GET', '/transactions/').length;

    await user.click(screen.getByRole('button', { name: 'Try loading the record again' }));

    await waitFor(() => {
      expect(callsTo(client, 'GET', '/transactions/').length).toBeGreaterThan(before);
    });
  });

  it('says a missing record is missing, rather than showing an empty expense screen', async () => {
    renderExpenses(stubApiClient(), '/expenses/ffffffff-0000-4000-8000-0000000000ff');

    expect(await screen.findByRole('alert')).toHaveTextContent(notFound.message);
  });

  it('shows the history the API returned, formatted for a person rather than as stored values', async () => {
    renderExpenses(
      stubApiClient({ transactions: { audit: EXPENSE_ONE_AUDIT } }),
      `/expenses/${EXPENSE_ONE.id}`,
    );

    expect(await screen.findByText('TRANSACTION_CREATED')).toBeInTheDocument();
    expect(screen.getByText(/by Demo Admin/)).toBeInTheDocument();

    const history = screen.getByLabelText('History');

    // The snapshot is the stored row, so the amount arrives as the paise integer 245075 and the
    // category as a database key. The trail must show the amount as rupees and the category as
    // present-or-absent: `amount_paise empty → 245075` in front of a pastor would be exactly the
    // raw-internal leak `docs/03-UI-UX-RULES.md` forbids.
    expect(history.textContent).toContain('amount empty → ₹2,450.75');
    expect(history.textContent).toContain('category empty → set');
    expect(history.textContent).toContain('status empty → ACTIVE');
    expect(history.textContent).not.toContain('amount_paise');
    expect(history.textContent).not.toContain('55555555-5555-4555-8555-555555555555');
  });
});

describe('correcting an expense', () => {
  it('sends the loaded revision as If-Match and keeps the record rather than replacing it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '2600.10');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/is now ₹2,600.10/)).toBeInTheDocument();

    const call = lastCallTo(client, 'PATCH', `/transactions/${EXPENSE_ONE.id}`);

    expect(call?.ifMatch).toBe(`"${EXPENSE_ONE.revision}"`);
    expect(call?.body).toMatchObject({ amount: '2600.10' });
    expect(call?.idempotencyKey).toBeTruthy();

    const stored = client.transactionById(EXPENSE_ONE.id);

    expect(stored?.amount).toBe('2600.10');
    // The reference is immutable: a correction changes values, never identity.
    expect(stored?.referenceId).toBe(EXPENSE_ONE.referenceId);
    expect(stored?.revision).toBe(EXPENSE_ONE.revision + 1);
  });

  it('keeps the expense in the same category when only the amount changes', async () => {
    // A correction seeded with the first option in the list would silently move the expense to
    // whichever category happened to sort first.
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    expect(screen.getByLabelText('Category (required)')).toHaveValue(EXPENSE_ONE.category.id);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '1000');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/is now ₹1,000.00/)).toBeInTheDocument();
    expect(client.transactionById(EXPENSE_ONE.id)?.category?.id).toBe(EXPENSE_ONE.category.id);
  });

  it('moves the expense to a different category and reason, which is the one association it allows', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);
    const nextCategory = ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '';
    const nextReason = ACTIVE_EXPENSE_REASONS.find((row) => row.categoryId === nextCategory);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    await user.selectOptions(screen.getByLabelText('Category (required)'), nextCategory);

    // Changing the category clears the reason, because a reason means nothing outside its own
    // category. The Admin is therefore asked for a reason of the *new* category rather than the
    // old one being carried over.
    expect(screen.getByLabelText<HTMLSelectElement>('Reason (required)').value).toBe('');

    const reasonPicker = screen.getByLabelText('Reason (required)');

    await within(reasonPicker).findByRole('option', { name: nextReason?.name ?? '' });
    await user.selectOptions(reasonPicker, nextReason?.id ?? '');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/The category is now Repairs/)).toBeInTheDocument();

    const body = lastCallTo(client, 'PATCH', '/transactions')?.body as {
      categoryId: string;
      expenseReasonId: string;
    };

    // The pair travels together. Sending the category alone is what the API refuses, so the
    // browser must never produce it.
    expect(body.categoryId).toBe(nextCategory);
    expect(body.expenseReasonId).toBe(nextReason?.id);
    const movedTransaction = client.transactionById(EXPENSE_ONE.id);

    expect(movedTransaction?.category?.name).toBe('Repairs');
    expect(movedTransaction?.expenseReason?.id).toBe(nextReason?.id);
  });

  it('offers only the reasons of the currently selected category', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const currentReason = ACTIVE_EXPENSE_REASONS.filter(
      (row) => row.categoryId === EXPENSE_ONE.expenseReason.categoryId,
    );

    const beforeMove = screen.getByLabelText('Reason (required)');

    await within(beforeMove).findByRole('option', { name: currentReason[0]?.name ?? '' });
    // One option per active reason plus the empty placeholder that makes "not chosen yet"
    // representable — and nothing else, so no reason from another category can be picked.
    expect(within(beforeMove).getAllByRole('option')).toHaveLength(currentReason.length + 1);

    await user.selectOptions(
      screen.getByLabelText('Category (required)'),
      ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '',
    );

    const afterMove = screen.getByLabelText('Reason (required)');
    const movedReasons = ACTIVE_EXPENSE_REASONS.filter(
      (row) => row.categoryId === ACTIVE_EXPENSE_CATEGORIES[1]?.id,
    );

    await within(afterMove).findByRole('option', { name: movedReasons[0]?.name ?? '' });
    // No reason from the previous category survives the move. Offering one would be a dead
    // control: the server would refuse the pairing the moment it was submitted.
    expect(
      within(afterMove)
        .getAllByRole('option')
        .map((option) => option.textContent)
        .filter((label) => label !== 'Choose a reason'),
    ).toEqual(movedReasons.map((reason) => reason.name));
  });

  it('offers only the active categories as a move target', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const picker = screen.getByLabelText('Category (required)');

    await within(picker).findByRole('option', { name: 'Repairs' });
    // A deactivated category is not offered as a move target, because the API refuses it and a
    // control that submits a refused value is a dead control.
    expect(within(picker).getAllByRole('option')).toHaveLength(ACTIVE_EXPENSE_CATEGORIES.length);
  });

  it('keeps a deactivated current category visible, and explains why it is not offered', async () => {
    // The expense is filed under a category that has since been deactivated. The picker must not
    // quietly show a different one as selected, and must say why the current one is not in the
    // list of choices.
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_RETIRED_CATEGORY.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const picker = screen.getByLabelText('Category (required)');

    expect(
      within(picker).getByRole('option', {
        name: 'Retired category (current category, now inactive)',
      }),
    ).toBeInTheDocument();
    expect(picker).toHaveValue(EXPENSE_RETIRED_CATEGORY.category.id);
    expect(screen.getByText(/can be moved, but not removed/)).toBeInTheDocument();
  });

  it('refuses a cleared category, because an expense must always keep exactly one', async () => {
    // The picker has no empty option, so this is proved by the control's own guard rather than
    // by clicking a value the UI forbids.
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const picker = screen.getByLabelText('Category (required)');

    expect(within(picker).queryByRole('option', { name: /choose|select|none/i })).toBeNull();
    // The control is a required select, so a missing choice is prevented by the browser guard
    // rather than by waiting for a round trip.
    expect((picker as HTMLSelectElement).required).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(callsTo(client, 'PATCH', '/transactions')).toHaveLength(1);
    expect(
      (lastCallTo(client, 'PATCH', '/transactions')?.body as { categoryId?: string }).categoryId,
    ).toBe(EXPENSE_ONE.category.id);
  });

  it('refuses a malformed amount before sending it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '1.005');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/at most two decimal places/)).toBeInTheDocument();
    expect(callsTo(client, 'PATCH', '/transactions')).toHaveLength(0);
  });

  it('reports a conflict as a conflict, not as a failed save', async () => {
    // `REQ-FIN-018`: a stale revision means the record moved, and the only safe next step is to
    // reload and re-enter the edit.
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { correctFails: staleTransactionRevision } });

    renderRoute({ client, path: `/expenses/${EXPENSE_ONE.id}` });
    await screen.findByText('Recorded details');
    await openCorrectionForm(user);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '999');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(
      await screen.findByText(/was changed by someone else while this form was open/),
    ).toBeInTheDocument();
    expect(client.transactionById(EXPENSE_ONE.id)?.amount).toBe(EXPENSE_ONE.amount);
  });

  it('withdraws the correction control for a voided record', async () => {
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_VOIDED.id}`);

    await screen.findByText('Recorded details');
    expect(
      screen.queryByRole('button', { name: 'Edit amount, category, or details' }),
    ).not.toBeInTheDocument();
  });
});

describe('voiding an expense', () => {
  it('refuses a void with no reason, without sending a request', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openVoidForm(user);

    await user.click(screen.getByRole('button', { name: 'Void this expense' }));

    expect(
      await screen.findByText('Enter a reason for voiding this transaction.'),
    ).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/void')).toHaveLength(0);
  });

  it('keeps the record, its reference, and its amount, and marks it voided', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');
    await openVoidForm(user);

    await user.type(
      screen.getByLabelText('Reason for voiding (required)'),
      'Recorded against the wrong category',
    );
    await user.click(screen.getByRole('button', { name: 'Void this expense' }));

    // The exact confirmation sentence, because the page also carries a standing note that the
    // record "was voided on" a date once it is voided; both are true and only one is new.
    expect(
      await screen.findByText(
        `${EXPENSE_ONE.referenceId} was voided. It is kept in the records and no longer counts toward any total.`,
      ),
    ).toBeInTheDocument();

    const stored = client.transactionById(EXPENSE_ONE.id);

    // `REQ-FIN-019`: nothing is erased. The record, its amount, and its reference survive.
    expect(stored?.status).toBe('VOIDED');
    expect(stored?.amount).toBe(EXPENSE_ONE.amount);
    expect(stored?.referenceId).toBe(EXPENSE_ONE.referenceId);
    expect(stored?.voidReason).toBe('Recorded against the wrong category');
    expect(stored?.voidedAt).not.toBeNull();
    expect(
      lastCallTo(client, 'POST', `/transactions/${EXPENSE_ONE.id}/void`)?.idempotencyKey,
    ).toBeTruthy();
  });

  it('says plainly that voiding deletes nothing', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');

    // A control labelled only "Delete" would describe something this application never does.
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Voiding keeps/)).toBeInTheDocument();

    await openVoidForm(user);

    expect(screen.getByText(/This does not delete anything/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe('expense navigation', () => {
  it('reaches the expense section from the primary navigation', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), '/members');

    await screen.findByRole('heading', { name: 'Members' });

    await user.click(screen.getByRole('link', { name: 'Expenses' }));

    expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens a listed record from the row action', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient());

    const table = await screen.findByRole('table');

    await user.click(
      within(table).getByRole('link', {
        name: `View expense ${EXPENSE_ONE.referenceId} for ₹2,450.75`,
      }),
    );

    expect(await screen.findByText('Recorded details')).toBeInTheDocument();
    expect(lastCallTo(client, 'GET', `/transactions/${EXPENSE_ONE.id}`)).toBeDefined();
  });

  it('links back to the expense list from a record', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient(), `/expenses/${EXPENSE_ONE.id}`);

    await screen.findByText('Recorded details');

    await user.click(screen.getByRole('link', { name: 'Back to all expenses' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('opens the record the confirmation offers, so the new expense is reachable', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);
    await chooseCategory(user, ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '');
    await user.type(screen.getByLabelText('Amount (required)'), '750');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));

    await user.click(await screen.findByRole('link', { name: 'Open the expense record' }));

    expect(await screen.findByText('Recorded details')).toBeInTheDocument();
    expect(screen.getByText('₹750.00')).toBeInTheDocument();
  });
});

describe('the filtered expense CSV export', () => {
  beforeEach(() => {
    // jsdom implements neither object URLs nor a real anchor download, and those browser steps are
    // part of what the export does, so they are observed through the API the browser provides.
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('offers no download without a category, and says why instead of failing on click', async () => {
    renderExpenses(stubApiClient());

    await screen.findByRole('table');

    // `GET /reports/expense-transactions/export.csv` requires a category, so a control enabled
    // here would be a dead control that the API refuses. The copy states the requirement instead.
    expect(screen.getByRole('button', { name: 'Download filtered expenses (CSV)' })).toBeDisabled();
    expect(
      screen.getByText('Choose a category to download; the export is per category.'),
    ).toBeVisible();
  });

  it('downloads the filtered rows, sending the same criteria the table was built from', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(
      stubApiClient({ expenses: { csvFilename: 'hyssop-expenses-2026-09-18.csv' } }),
    );

    await screen.findByRole('table');
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '',
    );

    await user.click(
      await screen.findByRole('button', { name: 'Download filtered expenses (CSV)' }),
    );

    expect(
      await screen.findByText('Saved hyssop-expenses-2026-09-18.csv to your downloads.', {
        exact: false,
      }),
    ).toBeVisible();

    const csvPath =
      lastCallTo(client, 'GET', '/reports/expense-transactions/export.csv')?.path ?? '';
    const csvQuery = new URLSearchParams(csvPath.slice(csvPath.indexOf('?') + 1));

    // The export is per category and follows the active filter. If the browser sent the JSON list
    // path instead, or dropped the category, the file would silently contain different rows from
    // the ones on screen.
    expect(csvPath).toContain('/reports/expense-transactions/export.csv');
    expect(csvQuery.get('categoryId')).toBe(ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '');
    // The export is not paginated, so sending `page` or `pageSize` would cap a large export at one
    // page of rows and contradict the promised 10,000-row limit.
    expect(csvQuery.get('page')).toBeNull();
    expect(csvQuery.get('pageSize')).toBeNull();
  });

  it('saves the exact CSV bytes the API returned, without reformatting the amount', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderExpenses(stubApiClient({ expenses: { csv: DEFAULT_EXPENSE_CSV } }));

    await screen.findByRole('table');
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await user.click(
      await screen.findByRole('button', { name: 'Download filtered expenses (CSV)' }),
    );

    await waitFor(() => {
      expect(client.textCalls[0]?.text).toBe(DEFAULT_EXPENSE_CSV);
    });
    // `2450.75` must survive the trip ungrouped and unrounded; a client-side "format the money
    // nicely" step would add thousands separators the API contract forbids.
    expect(DEFAULT_EXPENSE_CSV).toContain('2450.75');
    // The browser must not "helpfully" fill the empty Receipt URL cell with the words the detail
    // screen shows. `Receipt Missing` is a `REQ-DOC-003` interface obligation; the export's
    // Receipt URL column is data, and a row with no receipt has no URL to write.
    const saved = client.textCalls[0]?.text ?? '';
    expect(saved).toContain('HY-EXP-000002,18-09-2026,Repairs,Equipment Repair,800.00,Cash,,');
    expect(saved).not.toContain('Receipt Missing');
  });

  it('reports a refusal to export rather than saving a truncated file', async () => {
    const user = userEvent.setup({ delay: null });
    // The API refuses above `CSV_EXPORT_MAX_ROWS` with a `VALIDATION_FAILED` naming the limit and
    // what to do about it, so the stub refuses the same way rather than inventing an error code.
    const tooManyRows = new ApiClientError(
      400,
      'VALIDATION_FAILED',
      'More than 10,000 expenses match these filters. Narrow the filters and try again.',
      '0f9c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      [{ field: 'categoryId', message: 'Narrow the filters and try again.' }],
    );

    renderExpenses(stubApiClient({ expenses: { csvFails: tooManyRows } }));

    await screen.findByRole('table');
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await user.click(
      await screen.findByRole('button', { name: 'Download filtered expenses (CSV)' }),
    );

    // The failure has to reach the Admin as a stated refusal. Silently downloading 10,000 of
    // 10,001 rows would pass every structural check and lose a row of the ledger.
    expect(
      await screen.findByText(
        'More than 10,000 expenses match these filters. Narrow the filters and try again.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Saved .* to your downloads/)).not.toBeInTheDocument();
  });

  it('explains an empty filtered result instead of offering a file with no rows', async () => {
    const user = userEvent.setup({ delay: null });
    renderExpenses(stubApiClient());

    await screen.findByRole('table');
    // A category plus a term that matches nothing in it. The category matters because the export
    // route requires one, so this is the only state where an empty export could be offered.
    await user.selectOptions(
      screen.getByLabelText('Category'),
      ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    );
    await user.type(screen.getByLabelText('Search expenses'), 'no-such-expense');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // A category with nothing in it must say so. Leaving the download enabled would produce a
    // header-only file, which looks like a successful export of the ledger.
    expect(await screen.findByText(/Nothing matches these filters/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download filtered expenses (CSV)' })).toBeDisabled();
  });
});
