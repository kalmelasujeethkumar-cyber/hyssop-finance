import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVAILABLE_BALANCE_LABEL,
  PERIOD_MOVEMENT_LABEL,
  REPORT_IDS,
  REPORT_TITLES,
} from '@hyssop/contracts';
import { renderRoute } from '../../test/render';
import {
  DEFAULT_REPORT_CSV,
  EXPENSE_BREAKDOWN_REPORT,
  INCOME_BREAKDOWN_REPORT,
  MEMBER_ONE,
  MEMBER_THREE,
  MEMBER_TWO,
  stubApiClient,
  transportFailure,
  type ReportStubOptions,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * Browser tests for the Reports and Search screens.
 *
 * They satisfy the `TEST-REPORT-*` and `TEST-SEARCH-*` browser cases in `docs/10-TEST-PLAN.md`:
 * all eleven projections, the voided-visibility statement, the truncated-row warning, the audit
 * window's instant bounds, CSV download, print, and every state a screen can be in.
 *
 * They run against the real route tree and the real query cache against a recording stub. Every
 * assertion here is about *what the screen says* and *what it asked for*. None of them assert a
 * total the browser computed: `docs/02-ARCHITECTURE.md` makes the API the only place a financial
 * figure may be decided, so a test that added two rows together would be testing the wrong thing.
 */

/** The report paths the stub was actually asked for, in order. */
function reportPaths(client: StubApiClient): readonly string[] {
  return client.calls.filter((call) => call.path.startsWith('/reports')).map((call) => call.path);
}

/** Waits for the report panel the heading belongs to. */
async function reportPanelFor(title: string): Promise<HTMLElement> {
  const panel = await screen.findByRole('region', { name: title });

  return panel;
}

async function renderReports(
  path: string,
  options: ReportStubOptions = {},
  client: StubApiClient = stubApiClient({ reports: options }),
): Promise<StubApiClient> {
  renderRoute({ path, client });

  await screen.findByRole('heading', { level: 1, name: 'Reports' });

  return client;
}

describe('the eleven report projections', () => {
  it('renders a populated body for every documented report', async () => {
    // A report added to the contract without a projection would otherwise render as a blank panel,
    // which is the "dead control presented as complete" outcome the UI rules forbid. Rendering
    // all eleven here makes a new report fail loudly instead of quietly.
    for (const reportId of REPORT_IDS) {
      const { unmount } = renderRoute({
        path: `/reports?report=${reportId}`,
        client: stubApiClient(),
      });

      const panel = await screen.findByRole(
        'region',
        { name: REPORT_TITLES[reportId] },
        { timeout: 5_000 },
      );

      expect(within(panel).getByTestId('voided-visibility')).toHaveTextContent(
        /Voided transactions/,
      );
      // The loading block must be gone: a panel that still says "Loading" after the projection
      // arrived would be reporting a state that is not true. Waiting for it to disappear is also
      // what proves the projection arrived, because the panel itself exists while it is in flight.
      await waitFor(() => {
        expect(within(panel).queryByText('Loading the report…')).not.toBeInTheDocument();
      });

      unmount();
    }
  });

  it('keeps the period movement and the available balance apart on the Financial Summary', async () => {
    await renderReports('/reports?report=financial-summary');
    await screen.findByRole('region', { name: 'Financial Summary' });

    const panel = await reportPanelFor('Financial Summary');

    // `REQ-FIN-014`: movement inside the period and money held on the period end are different
    // figures. The fixture makes them differ (12300.00 against 100750.00) so a screen that printed
    // one number for both would fail here. The figures repeat in the small-screen list, so the
    // assertion is that the panel states them, not how many times it does.
    expect(within(panel).getAllByText('Movement in period').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('₹12,300.00').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Total available').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('₹1,00,750.00').length).toBeGreaterThan(0);
    expect(within(panel).getByText(`${PERIOD_MOVEMENT_LABEL} for This Month`)).toBeVisible();
    expect(within(panel).getByText(`${AVAILABLE_BALANCE_LABEL} as on 30 Sep 2026`)).toBeVisible();
  });

  it('shows a negative method balance rather than clamping it', async () => {
    await renderReports('/reports?report=payment-methods');
    await screen.findByRole('region', { name: 'Payment Method' });

    const panel = await reportPanelFor('Payment Method');

    // `REQ-FIN-012`: a method balance may be negative and stays visible as one. The fixture's UPI
    // balance is `-750.00`, so a screen that clamped it, hid it behind a dash, or dropped the sign
    // fails here. Both renderings state the figure, so the count is what is asserted.
    expect(within(panel).getAllByText('-₹750.00').length).toBeGreaterThan(0);
    // Movement and balance are separate labelled columns, so the labels the server sent are used
    // rather than a hand-written caption that could contradict them.
    expect(within(panel).getByRole('columnheader', { name: PERIOD_MOVEMENT_LABEL })).toBeVisible();
    expect(
      within(panel).getByRole('columnheader', { name: AVAILABLE_BALANCE_LABEL }),
    ).toBeVisible();
  });

  it('renders all three contribution states on the Member Contribution report', async () => {
    await renderReports('/reports?report=member-contributions');
    await screen.findByRole('region', { name: 'Member Contribution' });

    const panel = await reportPanelFor('Member Contribution');

    // `REQ-CONTRIB-002` defines three states, so all three words appear. Each state appears once in
    // the totals and again on the row that has it, so presence is asserted rather than uniqueness.
    expect(within(panel).getAllByText('Paid').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Partially paid').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Not paid').length).toBeGreaterThan(0);
    // Expected/received/remaining are the report's own figures, shown per member-month.
    expect(within(panel).getAllByText('Still to be received').length).toBeGreaterThan(0);
    // Each row names its member with their reference, so a row that dropped one of the two would
    // not be traceable back to a member record.
    expect(
      within(panel).getAllByText(`${MEMBER_ONE.name} (${MEMBER_ONE.referenceId})`).length,
    ).toBeGreaterThan(0);
    expect(
      within(panel).getAllByText(`${MEMBER_TWO.name} (${MEMBER_TWO.referenceId})`).length,
    ).toBeGreaterThan(0);
    expect(
      within(panel).getAllByText(`${MEMBER_THREE.name} (${MEMBER_THREE.referenceId})`).length,
    ).toBeGreaterThan(0);
  });

  it('states that a bounded row list does not cover the whole total', async () => {
    await renderReports('/reports?report=offerings');

    const panel = await reportPanelFor('Offering');

    // `rowsTruncated` is `true` with 6 transactions and 1 row in the fixture. A total beside a
    // partial list, with nothing saying so, is the wrong-figure outcome `REQ-EXPORT-001` names.
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      /Only the first 1 of 6 transactions are shown/,
    );
    expect(within(panel).getByTestId('report-total')).toHaveTextContent('₹5,000.00');
  });

  it('says nothing about truncation when the whole list is shown', async () => {
    await renderReports('/reports?report=donations');

    const panel = await reportPanelFor('Donation');

    expect(await within(panel).findByTestId('report-total')).toHaveTextContent('₹1,500.00');
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an anonymous donation with no member and no describing text', async () => {
    await renderReports('/reports?report=donations');

    const panel = await reportPanelFor('Donation');

    // `REQ-INCOME-006`: the donation counts in the total, and nothing on the screen may identify
    // the giver. The row carries a null member and a null description precisely so that a screen
    // printing either would be caught. The row states this in both the table and the small-screen
    // list, so each phrase is asserted as present rather than as unique.
    expect(
      within(panel).getAllByText('Anonymous donation — no donor details').length,
    ).toBeGreaterThan(0);
    expect(within(panel).getAllByText('No member recorded').length).toBeGreaterThan(0);
  });

  it('offers a document link only while the bytes are reachable', async () => {
    await renderReports('/reports?report=documents');

    const panel = await reportPanelFor('Receipt / Document');

    // The counts the API sent are reported as the Admin's own states, not as raw enum values.
    const counts = within(panel).getByRole('table', { name: /How many receipts and documents/ });
    expect(within(counts).getByRole('rowheader', { name: 'Available now' })).toBeVisible();
    expect(within(counts).getByRole('rowheader', { name: 'Removed, file gone' })).toBeVisible();

    // One available document, so exactly one open control. The removed one offers its reason
    // instead, because a link to a file that is gone is a dead control. The assertions are scoped
    // to the table because the small-screen list states the same cells again.
    const documents = within(panel).getByRole('table', { name: /Attached documents/ });
    expect(within(documents).getAllByRole('link', { name: /Open file/ })).toHaveLength(1);
    expect(within(documents).getByText(/Not available/)).toBeVisible();
  });

  it('keeps a voided transaction visible and labelled on the Complete Transaction report', async () => {
    await renderReports('/reports?report=transactions');

    const panel = await reportPanelFor('Complete Transaction');

    expect(await within(panel).findAllByText('HY-INC-000003')).not.toHaveLength(0);
    // The history report retains voided rows, so the badge must be present and must not be
    // replaced by a hidden row or a zero amount.
    expect(within(panel).getAllByText('Voided').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Active').length).toBeGreaterThan(0);
    expect(within(panel).getByTestId('report-total')).toHaveTextContent('₹20,700.00');
  });

  it('states which reports exclude voided rows, in words', async () => {
    await renderReports('/reports?report=income');

    const visibility = screen.getAllByTestId('voided-visibility')[0];

    expect(visibility).toHaveTextContent(
      'Voided transactions are left out of these figures. They are still shown on the Complete Transaction and Audit reports.',
    );
  });

  it('states the opposite for the history reports', async () => {
    await renderReports('/reports?report=audit');

    const visibility = screen.getAllByTestId('voided-visibility')[0];

    expect(visibility).toHaveTextContent(
      'Voided transactions are kept in this report, because it is a history report.',
    );
  });

  it('renders Admin-entered category labels as text', async () => {
    await renderReports('/reports?report=expenses');

    const panel = await reportPanelFor('Expense');

    // `customLabel` is `true` for expense categories, so a screen that trusted the label as
    // markup would be caught by any label at all. Both renderings are asserted because the table
    // and the small-screen list each state it.
    const label = EXPENSE_BREAKDOWN_REPORT.rows[0]?.label as string;
    expect(within(panel).getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe('the audit window', () => {
  it('asks for no window at all for the whole history', async () => {
    const client = await renderReports('/reports?report=audit&auditAll=1');
    await screen.findByRole('region', { name: 'Audit' });

    // The window is decided by the controls, so the request proves the choice reached the API as
    // the absence of both bounds rather than as an empty string the server would have to guess at.
    expect(await screen.findByText(/Showing events from the first record to now/)).toBeVisible();
    expect(reportPaths(client)).toEqual(['/reports/audit']);
  });

  it('sends each date as a whole Asia/Kolkata day as an ISO instant', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=audit');

    await user.type(await screen.findByLabelText(/From date/), '2026-09-01');
    await user.type(screen.getByLabelText(/To date/), '2026-09-30');

    await waitFor(() => {
      expect(reportPaths(client)).toContain(
        '/reports/audit?from=2026-09-01T00%3A00%3A00%2B05%3A30&to=2026-09-30T23%3A59%3A59.999%2B05%3A30',
      );
    });
  });

  it('disables the date fields while the whole history is selected', async () => {
    const user = userEvent.setup();

    await renderReports('/reports?report=audit');
    await screen.findByLabelText(/From date/);

    await user.click(screen.getByLabelText('Whole history, from the first record to now'));

    expect(screen.getByLabelText(/From date/)).toBeDisabled();
    expect(screen.getByLabelText(/To date/)).toBeDisabled();
  });

  it('describes an open-ended range rather than printing an empty instant', async () => {
    await renderReports('/reports?report=audit');

    expect(await screen.findByText(/Showing events from the first record to now/)).toBeVisible();
  });

  it('filters by an action', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=audit');

    await user.selectOptions(await screen.findByLabelText(/Action/), 'TRANSACTION_VOIDED');

    await waitFor(() => {
      expect(reportPaths(client)).toContain('/reports/audit?action=TRANSACTION_VOIDED');
    });
  });
});

describe('the Complete Transaction filters', () => {
  it('adds the type filter on top of the period', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=transactions');

    await user.selectOptions(await screen.findByLabelText(/Transaction type/), 'EXPENSE');

    await waitFor(() => {
      expect(reportPaths(client)).toContain('/reports/transactions?period=thisMonth&type=EXPENSE');
    });
  });

  it('adds the voided status filter, which is legal only on the history report', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=transactions');

    await user.selectOptions(await screen.findByLabelText(/^Status/), 'VOIDED');

    await waitFor(() => {
      expect(reportPaths(client)).toContain('/reports/transactions?period=thisMonth&status=VOIDED');
    });
  });

  it('returns to page 1 when a filter narrows the list', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=transactions&page=3&pageSize=50');

    await screen.findByTestId('result-count');
    await user.selectOptions(screen.getByLabelText(/Transaction type/), 'EXPENSE');

    // Page 3 of a narrowed result set renders an empty table, which reads as "there is nothing".
    await waitFor(() => {
      expect(reportPaths(client)).toContain(
        '/reports/transactions?period=thisMonth&type=EXPENSE&pageSize=50',
      );
    });
  });

  it('pages with the next control', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=transactions', {
      reports: {
        transactions: {
          ...TRANSACTION_REPORT_STUB,
          pagination: { page: 1, pageSize: 20, totalItems: 60, totalPages: 3 },
        },
      },
    });

    await screen.findByTestId('result-count');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(reportPaths(client)).toContain('/reports/transactions?period=thisMonth&page=2');
    });
  });
});

describe('CSV export', () => {
  beforeEach(() => {
    // jsdom has no object-URL implementation, and the export's browser steps are what the test is
    // about, so they are observed through the same API the real browser provides.
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('fetches the export with the session and saves the bytes the server sent', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({ reports: { csvFilename: 'income-2026-09.csv' } });

    renderRoute({ path: '/reports?report=income', client });
    await screen.findByTestId('report-total');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    // The filename is the server's: `docs/06-API-SPEC.md` bakes the resolved period into the
    // export name, and the browser cannot know the bounds the API resolved for a preset.
    expect(await screen.findByText('Saved income-2026-09.csv to your downloads.')).toBeVisible();
    // The export is a period read, so it asks for the period rather than the JSON report path.
    expect(reportPaths(client)).toContain('/reports/income/export.csv?period=thisMonth');
    // The exact string must survive the trip: `1250.50` proves paise are not rounded in transit.
    expect(client.textCalls[0]?.text).toBe(DEFAULT_REPORT_CSV);
  });

  it('falls back to a generic filename when the API declares none, rather than inventing a range', async () => {
    const user = userEvent.setup();

    renderRoute({ path: '/reports?report=income', client: stubApiClient() });
    await screen.findByTestId('report-total');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    // A filename stating only which report it is is honest; a made-up date range would be a claim
    // the browser cannot verify.
    expect(await screen.findByText('Saved hyssop-income.csv to your downloads.')).toBeVisible();
  });

  it('replaces the control with its reason when the audit window has no period to export', async () => {
    // An export is always for a defined period, and a whole-history audit has none. The control is
    // replaced by the reason rather than left enabled to quietly export something else.
    renderRoute({ path: '/reports?report=audit&auditAll=1', client: stubApiClient() });

    await screen.findByLabelText(/From date/);

    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a date range to export the audit history. A whole-history audit has no period to export.',
      ),
    ).toBeVisible();
  });

  it('offers the export once both audit dates are chosen', async () => {
    renderRoute({
      path: '/reports?report=audit&auditFrom=2026-09-01&auditTo=2026-09-30',
      client: stubApiClient(),
    });

    await screen.findByRole('button', { name: 'Download CSV' });

    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });

  it('reports a failed export and offers a way to dismiss it', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/reports?report=income',
      client: stubApiClient({ reports: { csvFails: transportFailure } }),
    });
    await screen.findByTestId('report-total');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');

    // A failure the Admin cannot clear is a dead end, so the banner carries a dismissal control.
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('The API could not be reached.')).not.toBeInTheDocument();
    });
  });
});

describe('printing', () => {
  it('offers a print control that calls the browser print dialog', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);

    renderRoute({ path: '/reports?report=income', client: stubApiClient() });
    await screen.findByTestId('report-total');

    await user.click(screen.getByRole('button', { name: 'Print this report' }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('keeps the controls out of print and the printed identification in', async () => {
    await renderReports('/reports?report=income');
    await screen.findByTestId('report-total');

    // The classes are the contract with the print stylesheet: chrome is `print-hidden`, and the
    // printed header — which is the only place a printed page states its period — is `print-only`.
    expect(
      screen.getByRole('button', { name: 'Print this report' }).closest('.print-hidden'),
    ).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Reports' })).toHaveClass('print-hidden');
    expect(document.querySelector('.print-only')).not.toBeNull();
  });
});

describe('screen states', () => {
  it('shows a loading state before the projection arrives', async () => {
    // The stub resolves in a microtask, which is faster than any assertion, so the response is held
    // open on purpose: without the gate there is no moment in which the loading state is on screen
    // long enough to observe, and the assertion below would pass by accident.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderRoute({
      path: '/reports?report=income',
      client: stubApiClient({ reports: { reportGate: gate } }),
    });

    expect(await screen.findByText('Loading the report…')).toBeVisible();

    release();
    expect(await screen.findByTestId('report-total')).toHaveTextContent('₹16,500.00');
  });

  it('shows the API message and a working retry when the report cannot be loaded', async () => {
    const user = userEvent.setup();
    const client = await renderReports('/reports?report=income', { reportFails: transportFailure });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    expect(client.calls.some((call) => call.path.startsWith('/reports/income'))).toBe(true);

    // The failure is recoverable, so the screen must offer the retry rather than only the failure.
    await user.click(screen.getByRole('button', { name: 'Load the report again' }));

    await waitFor(() => {
      expect(
        client.calls.filter((call) => call.path.startsWith('/reports/income')).length,
      ).toBeGreaterThan(1);
    });
  });

  it('says an empty report is empty instead of showing a blank table', async () => {
    await renderReports('/reports?report=income', {
      reports: { income: { ...INCOME_BREAKDOWN_REPORT, rows: [] } },
    });

    expect(
      await screen.findByText(`No ${REPORT_TITLES.income.toLowerCase()} recorded in this period`),
    ).toBeVisible();
    expect(screen.queryByRole('table', { name: /Income by income type/ })).not.toBeInTheDocument();
  });

  it('falls back to the default report for an unrecognised report in the URL', async () => {
    const client = await renderReports('/reports?report=../../etc/passwd');

    await screen.findByRole('region', { name: 'Financial Summary' });

    // Path text must never become a request segment; the closed list decides the id.
    expect(reportPaths(client)).toEqual(['/reports/financial-summary?period=thisMonth']);
  });
});

/** The Complete Transaction fixture, re-exported locally so the paging case can vary it. */
const TRANSACTION_REPORT_STUB = {
  reportId: 'transactions',
  period: {
    preset: 'thisMonth',
    label: 'This Month',
    from: '2026-09-01',
    to: '2026-09-30',
    timezone: 'Asia/Kolkata',
  },
  currency: 'INR',
  type: null,
  status: null,
  total: '20700.00',
  transactionCount: 4,
  rows: [],
  pagination: { page: 1, pageSize: 20, totalItems: 4, totalPages: 1 },
  generatedAt: '2026-09-30T10:30:00.000Z',
} as const;
