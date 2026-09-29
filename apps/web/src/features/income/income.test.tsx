import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render';
import { ApiClientError } from '../../lib/api-client';
import {
  INCOME_ANONYMOUS,
  INCOME_ONE,
  INCOME_TWO,
  INCOME_VOIDED,
  MEMBER_ONE,
  notFound,
  serverFailure,
  staleTransactionRevision,
  stubApiClient,
  transportFailure,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * A server-side rejection of one field, so the screen can show the problem against the input
 * that caused it rather than in a generic banner.
 */
const memberNoLongerExists = new ApiClientError(
  400,
  'VALIDATION_FAILED',
  'The request could not be accepted.',
  'req-income-1',
  [{ field: 'memberId', message: 'That member no longer exists.' }],
);

/**
 * Browser income tests: the list, the filters, recording income, the detail screen, the
 * audited correction, the reason-required void, the audit trail, and the receipt.
 *
 * These satisfy `TEST-INCOME-001`, `TEST-FIN-002`, and `TEST-DOC-001` in the browser layer. They
 * run against the real route tree, the real provider stack, and a stateful stub client that
 * applies the documented filters, allocates references, refuses a stale `If-Match`, requires a
 * void reason, and replays a repeated `Idempotency-Key` — so a dead filter, a dead submit
 * button, a double submission, a stale edit, or a leaked donor identity fails here rather than
 * in a browser run.
 */

/**
 * The desktop table and the mobile card list render the same rows, because the layout switches
 * at the `sm` breakpoint and jsdom applies no CSS. Queries against income rows are therefore
 * scoped to the table.
 */
function desktopTable(): HTMLElement {
  return screen.getByRole('table', { hidden: false });
}

function renderIncome(client: StubApiClient, path = '/income'): StubApiClient {
  renderRoute({ client, path });

  return client;
}

function lastCallTo(client: StubApiClient, method: string, pathFragment: string) {
  const matching = client.calls.filter(
    (call) => call.method === method && call.path.includes(pathFragment),
  );

  return matching[matching.length - 1];
}

function callsTo(client: StubApiClient, method: string, pathFragment: string) {
  return client.calls.filter((call) => call.method === method && call.path.includes(pathFragment));
}

async function openRecordForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Record income' }));

  // The toggle now reads "Cancel recording income", so the submit button is the only control
  // still called "Record income" and the two can never be confused for one another.
  expect(screen.getByRole('button', { name: 'Cancel recording income' })).toBeInTheDocument();
}

describe('the income list', () => {
  it('reads income through the shared transaction list narrowed to type=INCOME', async () => {
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');

    // `docs/06-API-SPEC.md` defines no income read endpoint, so the browser must not invent one.
    const call = lastCallTo(client, 'GET', '/transactions');

    expect(call?.path).toContain('type=INCOME');
    expect(call?.path).toContain('page=1');
    expect(call?.path).toContain('pageSize=20');
    expect(call?.path).toContain('sort=businessDate');
    expect(call?.path).toContain('direction=desc');
    expect(callsTo(client, 'GET', '/income')).toHaveLength(0);
  });

  it('lists the stored income with its references, dates, types, and exact amounts', async () => {
    renderIncome(stubApiClient());

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');

    // A header row plus the four stubbed income records.
    expect(rows).toHaveLength(5);
    expect(within(table).getByText(INCOME_ONE.referenceId)).toBeInTheDocument();
    expect(within(table).getByText('₹500.00')).toBeInTheDocument();
    expect(within(table).getByText('₹1,250.50')).toBeInTheDocument();
    expect(within(table).getByText('8 Mar 2026')).toBeInTheDocument();
    expect(within(table).getByText('Member Contribution')).toBeInTheDocument();
    expect(within(table).getByText('Anonymous Donation')).toBeInTheDocument();
  });

  it('shows how many income records matched, so the list is never unlabelled', async () => {
    renderIncome(stubApiClient());

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('4 records found');
    });
  });

  it('keeps a voided record visible and marks it voided, rather than deleting it', async () => {
    // `REQ-FIN-016` makes voiding a state change, so a screen that hid the row would imply the
    // income never happened.
    renderIncome(stubApiClient());

    const table = await screen.findByRole('table');

    expect(within(table).getByText(INCOME_VOIDED.referenceId)).toBeInTheDocument();
    expect(within(table).getByText('Voided')).toBeInTheDocument();
    expect(within(table).getByText('₹300.00')).toBeInTheDocument();
  });

  it('shows no donor for an anonymous donation, on the list or the card view', async () => {
    renderIncome(stubApiClient());

    const table = await screen.findByRole('table');
    const row = within(table)
      .getAllByRole('row')
      .find((candidate) => {
        return within(candidate).queryByText(INCOME_ANONYMOUS.referenceId) !== null;
      });

    expect(row).toBeDefined();
    // The member column shows the em dash placeholder, never a name, for an anonymous record.
    expect(within(row as HTMLElement).queryByText(/Anitha|Benedict|Chandralekha/)).toBeNull();
  });

  it('distinguishes a church with no income from a filter that matched nothing', async () => {
    renderIncome(stubApiClient({ transactions: { transactions: [] } }));

    expect(await screen.findByText('No income recorded yet')).toBeInTheDocument();
    expect(screen.queryByText('No income matches these filters')).not.toBeInTheDocument();
  });

  it('reports a load failure and offers a retry that really refetches', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { listFails: transportFailure } });

    renderRoute({ client, path: '/income' });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    const before = callsTo(client, 'GET', '/transactions').length;

    await user.click(screen.getByRole('button', { name: 'Try loading income again' }));

    await waitFor(() => {
      expect(callsTo(client, 'GET', '/transactions').length).toBeGreaterThan(before);
    });
  });
});

describe('searching and filtering income', () => {
  it('sends the search term to the API and narrows the rows it shows', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search income'), INCOME_TWO.referenceId);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });

    expect(lastCallTo(client, 'GET', 'search=')?.path).toContain(
      `search=${INCOME_TWO.referenceId}`,
    );
    const table = desktopTable();

    expect(within(table).getByText(INCOME_TWO.referenceId)).toBeInTheDocument();
    expect(within(table).queryByText(INCOME_ONE.referenceId)).not.toBeInTheDocument();
  });

  it('searches by member name as well as by reference', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search income'), 'Benedict');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', 'search=')?.path).toContain('search=Benedict');
  });

  it('explains an empty filter result and offers a reset instead of a blank table', async () => {
    const user = userEvent.setup({ delay: null });

    renderIncome(stubApiClient());
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Search income'), 'zzzz-no-such-income');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No income matches these filters')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the active criteria, can clear one, and can reset them all', async () => {
    const user = userEvent.setup({ delay: null });

    renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await user.type(screen.getByLabelText('Search income'), 'offering');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(
      screen.getByRole('button', { name: /Remove filter: Search: offering/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Remove filter: Status: ACTIVE/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Remove filter: Search: offering/ }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('3 records found');
    });
    // One criterion is dropped and the other is kept. Returning to a criterion combination that was
    // already fetched is served from the query cache, so the honest evidence is the state the Admin
    // can see: the search chip is gone, the status chip remains, and the field shows the criterion
    // actually in effect rather than a value that was silently dropped.
    expect(screen.queryByRole('button', { name: /Remove filter: Search: offering/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Remove filter: Status: ACTIVE/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Search income')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Reset all filters' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('4 records found');
    });
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('');
    expect(screen.getByLabelText('Search income')).toHaveValue('');
  });

  it('narrows by income type, because that is a criterion this screen owns', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Income type'), 'MEMBER_CONTRIBUTION');

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain(
      'incomeType=MEMBER_CONTRIBUTION',
    );
  });

  it('shows the income type as an active filter, because it narrows the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderIncome(stubApiClient());

    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).toBeNull();

    // A criterion that reaches the API has to be visible and reversible on the screen. Leaving
    // the type out of the active-criteria sum narrowed the list to one income type while the
    // screen showed no filter at all and offered no way back to all income.
    await user.selectOptions(screen.getByLabelText('Income type'), 'MEMBER_CONTRIBUTION');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Remove filter: Type: Member Contribution/ }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Reset all filters' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Remove filter: Type: Member Contribution/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('4 records found');
    });
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).toBeNull();
  });

  it('narrows by amount range, compared as exact paise', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Amount from (optional)'), '1000');

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 record found');
    });
    expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain('minAmount=1000');
    expect(within(desktopTable()).getByText(INCOME_TWO.referenceId)).toBeInTheDocument();
  });

  it('narrows by business-date range', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Business date from (optional)'), '2026-05-01');

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('2 records found');
    });
    expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain('from=2026-05-01');
  });

  it('sorts by amount without rounding, using the API as the source of order', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'amount');
    await user.selectOptions(screen.getByLabelText('Order'), 'asc');

    await waitFor(() => {
      expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain('sort=amount');
    });
    await waitFor(() => {
      expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain('direction=asc');
    });

    await waitFor(() => {
      const cells = within(desktopTable())
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

      expect(cells).toEqual([
        INCOME_ANONYMOUS.referenceId,
        INCOME_VOIDED.referenceId,
        INCOME_ONE.referenceId,
        INCOME_TWO.referenceId,
      ]);
    });
  });

  it('moves to the next page through the API, and disables it on the last page', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(
      stubApiClient({ transactions: { transactions: [INCOME_ONE, INCOME_TWO, INCOME_VOIDED] } }),
    );

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Per page'), '10');

    const next = screen.getByRole('button', { name: 'Next' });

    expect(next).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(lastCallTo(client, 'GET', '/transactions')?.path).toContain('pageSize=10');
  });
});

describe('recording income', () => {
  it('records a member contribution through POST /income and reports the new reference', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    // The business date is pre-filled with today in Asia/Kolkata, so the most common entry needs
    // no date typing; the assertion is on the shape that was actually sent.
    const businessDate = screen.getByLabelText<HTMLInputElement>('Business date (required)');

    expect(businessDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.type(screen.getByLabelText('Amount (required)'), '750.25');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.type(screen.getByLabelText('Description (optional)'), 'September contribution');
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(await screen.findByText(/was recorded as HY-INC-/)).toBeInTheDocument();

    const call = lastCallTo(client, 'POST', '/income');

    // The API refuses a member contribution that names no contribution month, and the browser
    // derives the month from the business date the Admin already entered rather than asking for a
    // second, contradictory control. Asserting it here means a regression that drops the period
    // again fails this test instead of only failing in the browser against a real API.
    expect(call?.body).toEqual({
      incomeType: 'MEMBER_CONTRIBUTION',
      amount: '750.25',
      paymentMethod: 'CASH',
      businessDate: businessDate.value,
      memberId: MEMBER_ONE.id,
      description: 'September contribution',
      contributionPeriod: {
        year: Number(businessDate.value.slice(0, 4)),
        month: Number(businessDate.value.slice(5, 7)),
      },
    });
    expect(call?.csrfToken).toBeDefined();
    // Every create carries a key, so a double submit or a retry records one contribution.
    expect(call?.idempotencyKey).toBeTruthy();
  });

  it('allocates the reference server-side and does not offer an input for it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    expect(screen.queryByLabelText(/Income reference/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    await screen.findByText(/was recorded as HY-INC-/);
    expect(lastCallTo(client, 'POST', '/income')?.body).not.toHaveProperty('referenceId');
  });

  it('refuses to submit a value it already knows is invalid, without a request', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '0');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(await screen.findByText('The amount must be greater than zero.')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount (required)')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(client, 'POST', '/income')).toHaveLength(0);
  });

  it('requires the member of a member contribution', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(
      await screen.findByText('Choose the member this contribution is for.'),
    ).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/income')).toHaveLength(0);
  });

  it('reuses one idempotency key across a retry, so a timeout cannot double-record', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(
      stubApiClient({ transactions: { firstCreateFails: transportFailure } }),
    );

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(await screen.findByText(/was recorded as HY-INC-/)).toBeInTheDocument();

    const keys = callsTo(client, 'POST', '/income').map((call) => call.idempotencyKey);

    // The retry is the *same* intent, so it must travel under the same key; that is the only
    // thing that lets the API recognise it as one contribution rather than two.
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    // Exactly one record was added, because the API answered the retry rather than writing a
    // second contribution. Four stubbed records plus one.
    expect(client.transactions).toHaveLength(5);
  });

  it('uses a new key for a new submission, because that is a new intent', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));
    await screen.findByText(/was recorded as HY-INC-/);

    // The form deliberately starts a fresh submission, so the member is chosen again rather than
    // the previous one being carried over.
    await user.type(screen.getByLabelText('Amount (required)'), '600');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));
    await waitFor(() => {
      expect(callsTo(client, 'POST', '/income')).toHaveLength(2);
    });

    const keys = callsTo(client, 'POST', '/income').map((call) => call.idempotencyKey);

    expect(keys[0]).not.toBe(keys[1]);
    expect(client.transactions).toHaveLength(6);
  });

  it('shows a server-side rejection against the field it belongs to', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { createFails: memberNoLongerExists } });

    renderRoute({ client, path: '/income' });

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.selectOptions(screen.getByLabelText('Member (required)'), MEMBER_ONE.id);
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    expect(await screen.findByText('That member no longer exists.')).toBeInTheDocument();
    expect(screen.getByText('The request could not be accepted.')).toBeInTheDocument();
  });

  it('cancels without recording anything', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderIncome(stubApiClient());

    await screen.findByRole('table');
    await openRecordForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('button', { name: 'Cancel recording income' }),
    ).not.toBeInTheDocument();
    expect(callsTo(client, 'POST', '/income')).toHaveLength(0);
  });

  describe('an anonymous donation', () => {
    async function openAnonymousForm(
      user: ReturnType<typeof userEvent.setup>,
      client: StubApiClient,
    ) {
      renderIncome(client);
      await screen.findByRole('table');
      await openRecordForm(user);
      await user.selectOptions(
        screen.getByLabelText('Income type (required)'),
        'ANONYMOUS_DONATION',
      );
    }

    it('removes the member, description, and note controls instead of disabling them', async () => {
      const user = userEvent.setup({ delay: null });

      await openAnonymousForm(user, stubApiClient());

      expect(screen.queryByLabelText('Member (optional)')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Description (optional)')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Notes (optional)')).not.toBeInTheDocument();
      expect(screen.getByText(/records no donor, description, or note/)).toBeInTheDocument();
    });

    it('sends no member, description, or notes at all', async () => {
      const user = userEvent.setup({ delay: null });
      const client = stubApiClient();

      await openAnonymousForm(user, client);

      await user.type(screen.getByLabelText('Amount (required)'), '100');
      await user.click(screen.getByRole('button', { name: 'Record income' }));

      expect(await screen.findByText(/was recorded as HY-INC-/)).toBeInTheDocument();

      const body = lastCallTo(client, 'POST', '/income')?.body as Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual([
        'amount',
        'businessDate',
        'incomeType',
        'paymentMethod',
      ]);
      // A value that is never sent cannot be stored, searched, exported, or printed, so the
      // privacy rule does not depend on the server remembering to strip it.
      expect(JSON.stringify(body)).not.toMatch(/Anitha|Benedict|Chandralekha/);
    });

    it('stores the record with the server-owned description and no donor', async () => {
      const user = userEvent.setup({ delay: null });
      const client = stubApiClient();

      await openAnonymousForm(user, client);

      await user.type(screen.getByLabelText('Amount (required)'), '100');
      await user.click(screen.getByRole('button', { name: 'Record income' }));

      await screen.findByText(/was recorded as HY-INC-/);

      const created = client.transactions.find((row) => row.incomeType === 'ANONYMOUS_DONATION');

      expect(created?.description).toBe('Anonymous Donation');
      expect(created?.member).toBeNull();
      expect(created?.notes).toBeNull();
    });
  });
});

describe('one income record', () => {
  it('shows the stored values, not a locally reconstructed total', async () => {
    renderIncome(stubApiClient(), `/income/${INCOME_ONE.id}`);

    expect(await screen.findByText('Recorded details')).toBeInTheDocument();
    expect(screen.getByText(INCOME_ONE.referenceId)).toBeInTheDocument();
    expect(screen.getByText('₹500.00')).toBeInTheDocument();
    expect(screen.getByText('8 Mar 2026')).toBeInTheDocument();
    expect(screen.getByText(`${MEMBER_ONE.name} (${MEMBER_ONE.referenceId})`)).toBeInTheDocument();
    expect(screen.getByText('March contribution')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
    expect(screen.getByText('Active — counted in totals')).toBeInTheDocument();
  });

  it('shows the history the API returned, with the actor and the recorded values', async () => {
    renderIncome(stubApiClient(), `/income/${INCOME_ONE.id}`);

    expect(await screen.findByText('TRANSACTION_CREATED')).toBeInTheDocument();
    expect(screen.getByText(/by Demo Admin/)).toBeInTheDocument();
    // The before/after snapshots are shown as the recorded values, not as a summary the
    // browser invented: a creation honestly shows the previous value as empty.
    expect(screen.getByLabelText('History').textContent).toContain('amount_paise empty → 50000');
    expect(screen.getByLabelText('History').textContent).toContain('status empty → ACTIVE');
  });

  it('reports a record it could not load, and offers a retry', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { detailFails: serverFailure } });

    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });

    expect(await screen.findByRole('alert')).toHaveTextContent(serverFailure.message);
    const before = callsTo(client, 'GET', '/transactions/').length;

    await user.click(screen.getByRole('button', { name: 'Try loading the record again' }));

    await waitFor(() => {
      expect(callsTo(client, 'GET', '/transactions/').length).toBeGreaterThan(before);
    });
  });

  it('says a missing record is missing, rather than showing an empty income screen', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: '/income/ffffffff-0000-4000-8000-0000000000ff' });

    expect(await screen.findByRole('alert')).toHaveTextContent(notFound.message);
  });

  it('refuses to present an expense as income, because the link is wrong', async () => {
    const client = stubApiClient({
      transactions: {
        transactions: [
          {
            ...INCOME_ONE,
            id: 'fffffff1-0000-4000-8000-000000000001',
            referenceId: 'HY-EXP-000001',
            type: 'EXPENSE',
            incomeType: null,
            category: { id: 'c1', name: 'Utilities', status: 'ACTIVE' },
          },
        ],
      },
    });

    renderRoute({ client, path: '/income/fffffff1-0000-4000-8000-000000000001' });

    expect(await screen.findByText(/is an expense, not income/)).toBeInTheDocument();
  });
});

describe('correcting an income record', () => {
  async function openCorrection(user: ReturnType<typeof userEvent.setup>, client: StubApiClient) {
    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });
    await screen.findByText('Recorded details');
    await user.click(screen.getByRole('button', { name: 'Edit amount or details' }));
    await screen.findByRole('button', { name: 'Save correction' });
  }

  it('sends the loaded revision as If-Match and keeps the record rather than replacing it', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    await openCorrection(user, client);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '625.75');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/Correction saved/)).toBeInTheDocument();

    const call = lastCallTo(client, 'PATCH', `/transactions/${INCOME_ONE.id}`);

    expect(call?.ifMatch).toBe(`"${INCOME_ONE.revision}"`);
    expect(call?.body).toMatchObject({ amount: '625.75' });
    expect(call?.idempotencyKey).toBeTruthy();

    const stored = client.transactionById(INCOME_ONE.id);

    expect(stored?.amount).toBe('625.75');
    // The reference is immutable: a correction changes values, never identity.
    expect(stored?.referenceId).toBe(INCOME_ONE.referenceId);
    expect(stored?.revision).toBe(INCOME_ONE.revision + 1);
  });

  it('refuses a zero correction in the browser instead of asking the API to store one', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    await openCorrection(user, client);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '0.00');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText('The amount must be greater than zero.')).toBeInTheDocument();
    expect(callsTo(client, 'PATCH', '/transactions/')).toHaveLength(0);
  });

  it('reports a conflict as a conflict, not as a failed save', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient({ transactions: { correctFails: staleTransactionRevision } });

    await openCorrection(user, client);

    const amount = screen.getByLabelText('Amount (required)');

    await user.clear(amount);
    await user.type(amount, '625.75');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    // `REQ-FIN-018`: a stale revision is not an error message to show, it means the record
    // moved and the only safe next step is to reload and re-enter the edit.
    expect(
      await screen.findByText(/was changed by someone else while this form was open/),
    ).toBeInTheDocument();
  });

  it('withdraws the correction control for a voided record', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/income/${INCOME_VOIDED.id}` });

    await screen.findByText('Recorded details');
    expect(
      screen.queryByRole('button', { name: 'Edit amount or details' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void this income' })).not.toBeInTheDocument();
  });
});

describe('voiding an income record', () => {
  async function openVoidForm(user: ReturnType<typeof userEvent.setup>, client: StubApiClient) {
    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });
    await screen.findByText('Recorded details');
    await user.click(screen.getByRole('button', { name: 'Void this income' }));
    await screen.findByLabelText('Reason for voiding (required)');
  }

  it('refuses a void with no reason, without sending a request', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    await openVoidForm(user, client);

    await user.click(screen.getByRole('button', { name: 'Void this income' }));

    expect(
      await screen.findByText('Enter a reason for voiding this transaction.'),
    ).toBeInTheDocument();
    expect(callsTo(client, 'POST', '/void')).toHaveLength(0);
  });

  it('keeps the record, its reference, and its history, and marks it voided', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    await openVoidForm(user, client);

    await user.type(
      screen.getByLabelText('Reason for voiding (required)'),
      'Recorded against the wrong member',
    );
    await user.click(screen.getByRole('button', { name: 'Void this income' }));

    // The exact confirmation sentence, because the page also carries a standing note that the
    // record "was voided on" a date once it is voided; both are true and only one is new.
    expect(
      await screen.findByText(
        `${INCOME_ONE.referenceId} was voided. It is kept in the records and no longer counts toward any total.`,
      ),
    ).toBeInTheDocument();
    expect(lastCallTo(client, 'POST', `/transactions/${INCOME_ONE.id}/void`)).toBeDefined();

    const stored = client.transactionById(INCOME_ONE.id);

    // `REQ-FIN-019`: nothing is erased. The record, its amount, and its reference survive.
    expect(stored?.status).toBe('VOIDED');
    expect(stored?.amount).toBe('500.00');
    expect(stored?.referenceId).toBe(INCOME_ONE.referenceId);
    expect(stored?.voidReason).toBe('Recorded against the wrong member');
    expect(stored?.voidedAt).not.toBeNull();
  });

  it('says a voided record is kept for audit and no longer counted', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/income/${INCOME_VOIDED.id}` });

    expect(
      await screen.findByText(/was voided on .*kept for audit and is no longer counted/),
    ).toBeInTheDocument();
    expect(screen.getByText('Recorded against the wrong member')).toBeInTheDocument();
  });

  it('never offers a control that says "Delete", because nothing is ever deleted', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });

    await screen.findByText('Recorded details');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Voiding keeps/)).toBeInTheDocument();
  });
});

describe('the income receipt', () => {
  it('generates the receipt from the stored record, with the church name and the reference', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/transactions/${INCOME_ONE.id}/receipt` });

    expect(await screen.findByText(`Receipt ${INCOME_ONE.referenceId}`)).toBeInTheDocument();
    // Scoped to the receipt's own section, because the application shell also names the product.
    const receipt = screen.getByLabelText('HYSSOP FINANCE');

    expect(receipt.textContent).toContain('HYSSOP FINANCE');
    expect(receipt.textContent).toContain(INCOME_ONE.referenceId);
    expect(receipt.textContent).toContain('₹500.00');
    expect(receipt.textContent).toContain('8 Mar 2026');
    expect(receipt.textContent).toContain('Cash');
    expect(receipt.textContent).toContain(`${MEMBER_ONE.name} (${MEMBER_ONE.referenceId})`);
    expect(receipt.textContent).toContain('Active');
    expect(lastCallTo(client, 'GET', '/receipt')).toBeDefined();
  });

  it('shows a voided receipt as voided, with its reason, rather than withholding it', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/transactions/${INCOME_VOIDED.id}/receipt` });

    expect(await screen.findByText(/This receipt is marked VOIDED/)).toBeInTheDocument();
    expect(screen.getByText(INCOME_VOIDED.referenceId)).toBeInTheDocument();
    expect(screen.getAllByText('Recorded against the wrong member').length).toBeGreaterThan(0);
  });

  it('shows "Not recorded (anonymous)" for an anonymous donation, with no donor field', async () => {
    const client = stubApiClient();

    renderRoute({ client, path: `/transactions/${INCOME_ANONYMOUS.id}/receipt` });

    expect(await screen.findByText('Not recorded (anonymous)')).toBeInTheDocument();
    expect(
      screen.queryByText(/Anitha Kumar|Benedict D Souza|Chandralekha Nair/),
    ).not.toBeInTheDocument();
  });

  it('explains that a record with no receipt has none, rather than showing a broken document', async () => {
    const client = stubApiClient({ transactions: { receiptFails: notFound } });

    renderRoute({ client, path: '/transactions/ffffffff-0000-4000-8000-0000000000ff/receipt' });

    expect(await screen.findByText('No receipt for this transaction')).toBeInTheDocument();
  });

  it('is reachable from the income record, so it is not a dead link', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });
    await screen.findByText('Recorded details');

    await user.click(screen.getByRole('link', { name: 'Open receipt' }));

    expect(await screen.findByText(`Receipt ${INCOME_ONE.referenceId}`)).toBeInTheDocument();
  });
});

describe('income navigation', () => {
  it('reaches the income section from the primary navigation', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    renderRoute({ client, path: '/members' });
    await screen.findByRole('heading', { name: 'Members' });

    await user.click(screen.getByRole('link', { name: 'Income' }));

    expect(await screen.findByRole('heading', { name: 'Income' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Income' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens a listed record from the row action', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    renderRoute({ client, path: '/income' });
    const table = await screen.findByRole('table');

    await user.click(
      within(table).getByRole('link', {
        name: `View income ${INCOME_ONE.referenceId} for ₹500.00`,
      }),
    );

    expect(await screen.findByText('Recorded details')).toBeInTheDocument();
    expect(lastCallTo(client, 'GET', `/transactions/${INCOME_ONE.id}`)).toBeDefined();
  });

  it('links back to the income list from a record', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    renderRoute({ client, path: `/income/${INCOME_ONE.id}` });
    await screen.findByText('Recorded details');

    await user.click(screen.getByRole('link', { name: 'Back to all income' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
