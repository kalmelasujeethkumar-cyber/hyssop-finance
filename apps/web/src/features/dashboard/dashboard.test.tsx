import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONTRIBUTION_NOT_CONFIGURED, PERIOD_MOVEMENT_LABEL } from '@hyssop/contracts';
import { renderRoute } from '../../test/render';
import {
  DASHBOARD_VIEW,
  EMPTY_DASHBOARD_VIEW,
  MEMBER_ONE,
  stubApiClient,
  transportFailure,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * Browser dashboard tests.
 *
 * These satisfy the `TEST-DASH-*` browser cases in `docs/10-TEST-PLAN.md`: the required metrics,
 * the movement/balance distinction, a negative method balance, exact INR formatting, the charts and
 * their text summaries, `Not configured` as its own bucket, the recent list, the quick actions, and
 * every state the screen can be in.
 *
 * They run against the real route tree and the real query cache against a recording stub, so a dead
 * control, a stale figure after a mutation, or a missing label fails here rather than only in a
 * browser run against a real API.
 *
 * The page heading is static, so it renders before the figures arrive. Every assertion that
 * depends on the projection therefore waits for it rather than asserting immediately: a synchronous
 * query would have tested the loading state and passed or failed by timing alone.
 */

/** The figure the `Members` card must show. It is a count, never a rupee amount. */
const MEMBER_COUNT = String(DASHBOARD_VIEW.memberCount);

/** The dashboard requests the client was actually asked to make, in order. */
function dashboardPaths(client: StubApiClient): readonly string[] {
  return client.calls.filter((call) => call.path.startsWith('/dashboard')).map((call) => call.path);
}

/** A promise the test resolves by hand, so a pending response can be observed rather than raced. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, resolve: release };
}

/**
 * Renders the dashboard and waits for the projection to arrive.
 *
 * One figure is waited on because it is the one every panel depends on, so the helper returns only
 * when the screen is in its populated state rather than its loading state.
 */
async function renderPopulatedDashboard(
  client: StubApiClient = stubApiClient(),
): Promise<StubApiClient> {
  renderRoute({ client });

  expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  await screen.findAllByText('₹16,500.00');

  return client;
}

describe('the required metrics', () => {
  it('shows the period movement, the ending balance, and the member count', async () => {
    await renderPopulatedDashboard();

    // `REQ-DASH-001` and `REQ-DASH-002`: the period's income and expense movements.
    expect(screen.getAllByText('₹16,500.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹4,200.00').length).toBeGreaterThan(0);
    // `REQ-DASH-005` to `REQ-DASH-008`: the balance through the period end.
    expect(screen.getAllByText('₹1,00,750.00').length).toBeGreaterThan(0);
    // `REQ-DASH-004`: a count, not an amount. Rendering this through the money formatter would
    // have produced `₹12.00`, which is a wrong financial claim rather than a cosmetic slip.
    expect(screen.getByText(MEMBER_COUNT)).toBeVisible();
    expect(screen.queryByText(`₹${MEMBER_COUNT}.00`)).not.toBeInTheDocument();
  });

  it('labels the movement and the balance separately so they cannot be read as one figure', async () => {
    await renderPopulatedDashboard();

    // `REQ-FIN-014` requires the two projections to be distinguishable. The screen must therefore
    // state both labels, not just show two numbers that happen to differ.
    expect(screen.getAllByText(new RegExp(PERIOD_MOVEMENT_LABEL, 'i')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/available balance as of period end/i).length).toBeGreaterThan(0);
  });

  it('shows a negative method balance with its sign instead of hiding it', async () => {
    await renderPopulatedDashboard();

    // `REQ-FIN-012` requires the figure to stay visible. Clamping it to zero or replacing it with
    // a dash would conceal an overdrawn method.
    expect(screen.getByText('-₹750.00')).toBeVisible();
  });

  it('reports the inclusive bounds and the timezone the API actually used', async () => {
    await renderPopulatedDashboard();

    // `REQ-DASH-016` requires the active period to be visible in Asia/Kolkata. The dates shown are
    // the response's own, so the screen cannot disagree with the query that produced the figures.
    const banner = screen.getByText(/1 Sep 2026 to 30 Sep 2026/);

    expect(banner).toBeVisible();
    expect(banner).toHaveTextContent('This Month');
    expect(banner).toHaveTextContent('Asia/Kolkata');
  });
});

describe('the charts', () => {
  it('draws each chart and gives it an accessible name', async () => {
    await renderPopulatedDashboard();

    // A chart that is only reachable by looking is not reachable at all for many users, so each one
    // carries an accessible name.
    expect(
      screen.getByRole('img', { name: /income and expenses for each month/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /income by type/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /expenses by category/i })).toBeInTheDocument();
  });

  it('writes every trend month out as a readable table rather than only drawing bars', async () => {
    await renderPopulatedDashboard();

    // The bars encode six numbers per period; the table states them, so the summary is readable
    // without interpreting any geometry and can be copied or printed.
    const table = screen.getByRole('table', {
      name: 'Income, expenses, and movement for each month',
    });
    const augustRow = within(table)
      .getAllByRole('row')
      .find((row) => (row.textContent ?? '').includes('August 2026')) as HTMLElement;

    expect(within(augustRow).getByText('₹14,000.00')).toBeVisible();
    expect(within(augustRow).getByText('₹3,800.00')).toBeVisible();
    expect(within(augustRow).getByText('₹10,200.00')).toBeVisible();

    const septemberRow = within(table)
      .getAllByRole('row')
      .find((row) => (row.textContent ?? '').includes('September 2026')) as HTMLElement;

    expect(within(septemberRow).getByText('₹16,500.00')).toBeVisible();
    expect(within(septemberRow).getByText('₹4,200.00')).toBeVisible();
  });

  it('lists each breakdown slice with its exact amount and the API-supplied share', async () => {
    await renderPopulatedDashboard();

    // The percentages arrive as exact strings. A browser that recomputed them could round
    // differently and contradict the figure the server calculated.
    expect(screen.getByText('Member contribution')).toBeVisible();
    expect(screen.getByText('₹10,000.00')).toBeVisible();
    expect(screen.getByText('60.61%')).toBeVisible();
  });

  it('renders an Admin-entered category name as plain text', async () => {
    await renderPopulatedDashboard();

    const category = screen.getByText('Electricity');

    // A category name is Admin-entered, so it must be text and never markup.
    expect(category).toBeVisible();
    expect(category.querySelector('script, style, iframe')).toBeNull();
  });

  it('draws the monthly trend exactly once', async () => {
    await renderPopulatedDashboard();

    // Two identical charts would be decoration rather than information, and a duplicated
    // accessible name would also make the screen ambiguous for a screen reader.
    expect(
      screen.getAllByRole('img', { name: /income and expenses for each month/i }),
    ).toHaveLength(1);
  });
});

describe('contribution status', () => {
  it('counts Not configured as its own state rather than as unpaid', async () => {
    await renderPopulatedDashboard();

    // `REQ-CONTRIB-006`: a member-month nobody configured is neither paid nor unpaid.
    expect(
      screen.getAllByText(new RegExp(CONTRIBUTION_NOT_CONFIGURED, 'i')).length,
    ).toBeGreaterThan(0);
    // The bucket is stated both in the per-month bars and in the period total, so the count is
    // asserted where the summary line states it.
    expect(
      screen.getByText(/Across the period: 7 paid, 2 part paid, 1 not paid, 2 not configured/i),
    ).toBeVisible();
  });

  it('states the three payment buckets separately from Not configured', async () => {
    await renderPopulatedDashboard();

    expect(screen.getByText(/7 paid/)).toBeVisible();
    expect(screen.getByText(/2 part paid/)).toBeVisible();
    expect(screen.getByText(/1 not paid/)).toBeVisible();
  });
});

describe('recent transactions and quick actions', () => {
  it('lists the recent rows with their dates, references, and amounts', async () => {
    await renderPopulatedDashboard();

    expect(screen.getByText('Sunday offering')).toBeVisible();
    expect(screen.getByText(/6 Apr 2026 · HY-INC-000002/)).toBeVisible();
    expect(screen.getByText('September electricity bill')).toBeVisible();
    // The sign tells the reader which way money moved, and the formatter supplies the grouping.
    expect(screen.getByText('+₹1,250.50')).toBeVisible();
    expect(screen.getByText('−₹2,450.75')).toBeVisible();
  });

  it('links each recent row to the detail screen that can open it', async () => {
    await renderPopulatedDashboard();

    const links = screen.getAllByRole('link', { name: 'View details' });
    const [firstIncome, firstExpense] = DASHBOARD_VIEW.recentTransactions;

    expect(links).toHaveLength(DASHBOARD_VIEW.recentTransactionCount);
    expect(links[0]).toHaveAttribute('href', `/income/${firstIncome?.id ?? ''}`);
    expect(links[1]).toHaveAttribute('href', `/expenses/${firstExpense?.id ?? ''}`);
  });

  it('says how many rows are shown so the preview is not read as the whole ledger', async () => {
    await renderPopulatedDashboard();

    expect(screen.getByText('Showing the 2 most recent transactions')).toBeVisible();
  });

  it('offers only quick actions that lead to screens that exist', async () => {
    await renderPopulatedDashboard();

    const panel = screen.getByRole('region', { name: 'Quick actions' });

    // `docs/phases/PHASE-08-DASHBOARD.md` forbids a decorative control, so every action here is a
    // route that resolves. A report link would be a dead control until Phase 09 exists.
    expect(
      within(panel)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/income', '/expenses', '/members']);
  });
});

describe('the period control', () => {
  it('requests the default period when the URL says nothing', async () => {
    const client = await renderPopulatedDashboard();

    expect(dashboardPaths(client)).toEqual(['/dashboard?period=thisMonth']);
  });

  it('offers every documented period and nothing else', async () => {
    await renderPopulatedDashboard();

    // A second hand-written list could offer a control the API rejects, so the control is checked
    // against the documented set exactly.
    expect(
      within(screen.getByLabelText('Period'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Today',
      'This Month',
      'Last Month',
      'Last 3 Months',
      'Last 6 Months',
      'This Year',
      'Last Year',
      'Custom range',
    ]);
  });

  it('sends the chosen preset as a new request and shows it as selected', async () => {
    const user = userEvent.setup();
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findAllByText('₹16,500.00');

    await user.selectOptions(screen.getByLabelText('Period'), 'last3Months');

    await waitFor(() => {
      expect(dashboardPaths(client)).toContain('/dashboard?period=last3Months');
    });
    // The control keeps showing what was requested, so a reader can tell which period produced
    // the figures currently on screen.
    expect(screen.getByLabelText('Period')).toHaveValue('last3Months');
  });

  it('applies a valid custom range only when Apply is pressed', async () => {
    const user = userEvent.setup();
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findAllByText('₹16,500.00');

    await user.selectOptions(screen.getByLabelText('Period'), 'custom');

    await user.type(screen.getByLabelText('From'), '2026-01-01');
    await user.type(screen.getByLabelText('To'), '2026-03-31');

    // A half-typed range must not become the reported period, so nothing else is requested until
    // Apply is pressed.
    expect(dashboardPaths(client)).toEqual(['/dashboard?period=thisMonth']);

    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    await waitFor(() => {
      expect(dashboardPaths(client)).toContain('/dashboard?from=2026-01-01&to=2026-03-31');
    });
  });

  it('refuses an inverted range and explains why, without sending a request', async () => {
    const user = userEvent.setup();
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findAllByText('₹16,500.00');

    await user.selectOptions(screen.getByLabelText('Period'), 'custom');

    await user.type(screen.getByLabelText('From'), '2026-03-31');
    await user.type(screen.getByLabelText('To'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    expect(await screen.findByText('The start date must not be after the end date.')).toBeVisible();
    expect(dashboardPaths(client)).toEqual(['/dashboard?period=thisMonth']);
  });

  it('refuses a range wider than the documented month limit', async () => {
    const user = userEvent.setup();
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findAllByText('₹16,500.00');

    await user.selectOptions(screen.getByLabelText('Period'), 'custom');

    await user.type(screen.getByLabelText('From'), '2020-01-01');
    await user.type(screen.getByLabelText('To'), '2026-03-31');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    expect(await screen.findByText('Choose a range of 36 months or fewer.')).toBeVisible();
    expect(dashboardPaths(client)).toEqual(['/dashboard?period=thisMonth']);
  });
});

describe('the states the screen can be in', () => {
  it('announces that it is loading before the figures arrive', async () => {
    // The response is held open, because the stub otherwise resolves before any assertion could
    // observe the wait. `docs/03-UI-UX-RULES.md` requires the wait to be announced rather than being
    // conveyed only by a spinner, which is invisible to a screen reader.
    const release = deferred();
    const client = stubApiClient({ dashboard: { dashboardGate: release.promise } });

    renderRoute({ client });

    await screen.findByText('Loading the dashboard…');

    // Located through its text rather than an accessible name: `role="status"` announces its
    // contents, so the text is the accessible name only once a name is not also set. What matters
    // for a screen reader is that the wait is inside a live region and marked busy.
    const loading = screen.getByRole('status');

    expect(loading).toHaveTextContent('Loading the dashboard…');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    // Nothing is shown as a figure while the answer is unknown.
    expect(screen.queryByText('₹16,500.00')).not.toBeInTheDocument();

    release.resolve();

    await screen.findAllByText('₹16,500.00');
    expect(screen.queryByText('Loading the dashboard…')).not.toBeInTheDocument();
  });

  it('shows a failure with a retry that really sends a second request', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({ dashboard: { firstDashboardFails: transportFailure } });

    renderRoute({ client });

    expect(await screen.findByText('The API could not be reached.')).toBeInTheDocument();
    // The failure state must not present figures, because a reader would take them as real.
    expect(screen.queryByText('₹16,500.00')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // The recovery has to actually re-request; a button that only hid the message would be dead.
    await waitFor(() => {
      expect(dashboardPaths(client)).toHaveLength(2);
    });
    expect((await screen.findAllByText('₹16,500.00')).length).toBeGreaterThan(0);
  });

  it('renders a zero-filled dashboard instead of treating it as broken', async () => {
    renderRoute({
      client: stubApiClient({ dashboard: { dashboard: EMPTY_DASHBOARD_VIEW } }),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();

    // `docs/03-UI-UX-RULES.md` requires an empty result to be distinguishable from a failure. Zero
    // is a real total, and "nothing recorded yet" is a different sentence from an error.
    expect((await screen.findAllByText('₹0.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing recorded yet')).toBeVisible();
    expect(screen.getByText('No income in this period')).toBeVisible();
    expect(screen.getByText('No expenses in this period')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refreshes the dashboard after a write so the figures cannot be stale', async () => {
    const user = userEvent.setup({ delay: null });
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findAllByText('₹16,500.00');
    expect(dashboardPaths(client)).toHaveLength(1);

    await user.click(
      within(screen.getByRole('region', { name: 'Quick actions' })).getByRole('link', {
        name: 'Record income',
      }),
    );

    await screen.findByRole('heading', { level: 1, name: 'Income' });

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    // A successful write has to invalidate the cached dashboard, or a quick action would be a
    // round trip to a screen still showing the totals from *before* the contribution.
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    // The member is chosen by searching for their member ID, because the income screen's member
    // control is a search rather than a list: the previous version offered the first page of
    // members by name and left everyone past that page unselectable.
    await user.type(screen.getByLabelText('Search members'), MEMBER_ONE.referenceId);
    await user.selectOptions(
      await screen.findByLabelText('Member (required)'),
      // The option is awaited, not the select: while the search is in flight the previous
      // search's members are withheld rather than offered under the new term, so the control is
      // momentarily empty and then shows only what actually matched.
      await screen.findByRole('option', { name: new RegExp(MEMBER_ONE.referenceId) }),
    );
    await user.click(screen.getByRole('button', { name: 'Record income' }));

    await waitFor(() => {
      expect(client.calls.some((call) => call.method === 'POST' && call.path === '/income')).toBe(
        true,
      );
    });

    // Returning to the dashboard must re-request rather than reuse the invalidated cache entry.
    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Dashboard',
      }),
    );

    await waitFor(() => {
      expect(dashboardPaths(client).length).toBeGreaterThan(1);
    });
  });
});
