import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CONTRIBUTION_NOT_CONFIGURED,
  type DashboardBreakdownSlice,
  type DashboardView,
} from '@hyssop/contracts';
import { ApiClientError, ApiTransportError } from '../lib/api-client';
import { formatBusinessDate, formatInr } from '../lib/money';
import {
  Banner,
  EmptyState,
  LoadingBlock,
  PageHeader,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../components/ui';
import {
  BreakdownDonutChart,
  ContributionStatusBars,
  IncomeExpenseBarChart,
} from '../features/dashboard/DashboardCharts';
import { DashboardPeriodFilter } from '../features/dashboard/DashboardPeriodFilter';
import {
  dashboardPeriodFromSearch,
  dashboardSearchFromPeriod,
  useDashboard,
  type DashboardPeriodSelection,
} from '../features/dashboard/dashboard-api';

/**
 * The dashboard screen.
 *
 * Authority: `docs/phases/PHASE-08-DASHBOARD.md` — required metrics, balances, charts,
 * contribution status, monthly trend, recent transactions, and working quick actions.
 *
 * Everything visible is either an amount the API sent or a label this file holds. The screen adds
 * no totals of its own: the two balance projections are rendered as two separate, labelled cards
 * because `REQ-FIN-014` requires the distinction to be visible, and the single `₹` figure a
 * reader takes away is the cumulative balance rather than the period movement.
 *
 * The period lives in the URL, so a bookmark or a shared link reproduces the same figures and the
 * browser's back button steps through the periods the Admin looked at.
 */

/**
 * Turns a thrown value into the one line shown in the error state.
 *
 * An unrecognised failure gets a generic message rather than its own text, because
 * `docs/07-SECURITY-RULES.md` forbids exposing internals and an exception message is exactly the
 * kind of thing that leaks a query or a path.
 */
function describeFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof ApiTransportError) {
    return error.message;
  }

  return 'Something went wrong while loading the dashboard. Please try again.';
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = useMemo(() => dashboardPeriodFromSearch(searchParams), [searchParams]);

  const dashboard = useDashboard(period);

  function selectPeriod(next: DashboardPeriodSelection) {
    setSearchParams(dashboardSearchFromPeriod(next));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every figure below is calculated by the API from the transactions that exist. Voided transactions stay in the history but are left out of these totals."
      />

      <DashboardPeriodFilter period={period} onChange={selectPeriod} />

      {dashboard.isPending ? <LoadingBlock label="Loading the dashboard…" /> : null}

      {dashboard.isError ? (
        <Banner
          tone="danger"
          action={
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => {
                void dashboard.refetch();
              }}
            >
              Try again
            </button>
          }
        >
          {describeFailure(dashboard.error)}
        </Banner>
      ) : null}

      {dashboard.isSuccess ? (
        <>
          {dashboard.isFetching ? (
            <p role="status" className="text-supporting text-text-secondary">
              Updating the figures…
            </p>
          ) : null}

          <PeriodBanner dashboard={dashboard.data} />
          <MetricCards dashboard={dashboard.data} />
          <div className="grid gap-6 xl:grid-cols-2">
            <IncomeExpenseComparison dashboard={dashboard.data} />
            <ContributionStatusPanel dashboard={dashboard.data} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <IncomeBreakdownPanel dashboard={dashboard.data} />
            <ExpenseBreakdownPanel dashboard={dashboard.data} />
          </div>
          <Panel title="Monthly trend">
            {dashboard.data.trend.length === 0 ? (
              <EmptyState
                title="No months in this period"
                description="Choose a wider period to see the monthly trend."
              />
            ) : (
              <IncomeExpenseBarChart points={dashboard.data.trend} />
            )}
          </Panel>
          <RecentTransactionsPanel dashboard={dashboard.data} />
          <QuickActions />
        </>
      ) : null}
    </div>
  );
}

/**
 * The bounds and timezone actually used.
 *
 * The dates are the response's, not recomputed from the preset, so the Admin is told which
 * inclusive days were counted even when the preset name alone would not make that clear. The
 * timezone is shown because a figure labelled "as of 30 Sep" means something different to a
 * reader in another zone.
 */
function PeriodBanner({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <p className="text-supporting text-text-secondary">
      Showing <strong className="font-semibold text-text-primary">{dashboard.period.label}</strong>
      {' · '}
      {formatBusinessDate(dashboard.period.from)} to {formatBusinessDate(dashboard.period.to)}{' '}
      <span className="whitespace-nowrap">({dashboard.period.timezone})</span>
    </p>
  );
}

interface MetricCardProps {
  readonly label: string;
  /**
   * The pre-formatted value.
   *
   * Formatting happens where each value is known rather than in one shared branch, because the
   * member count is a plain integer: running it through `formatInr` would have rendered a member
   * roll of 12 as `₹12.00`, which is a wrong financial claim rather than a cosmetic slip.
   */
  readonly value: string;
  readonly hint: string;
  readonly emphasis?: boolean;
}

function MetricCard({ label, value, hint, emphasis = false }: MetricCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasis ? 'border-blue-600 bg-blue-100' : 'border-border-default bg-surface'
      }`}
    >
      <p className="text-supporting font-semibold text-text-secondary">{label}</p>
      <p
        className={`mt-1 text-page-title font-bold ${
          emphasis ? 'text-blue-700' : 'text-text-primary'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-supporting text-text-secondary">{hint}</p>
    </div>
  );
}

/**
 * The required metrics.
 *
 * The card order follows the question the Admin actually asks: what came in, what went out, what
 * is left. `Total available` is emphasised because it is the headline figure, and its hint spells
 * out that it is a balance through the period end so it cannot be read as the period's movement.
 */
function MetricCards({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Total income"
        value={formatInr(dashboard.movement.income)}
        hint={dashboard.movement.label}
      />
      <MetricCard
        label="Total expenses"
        value={formatInr(dashboard.movement.expenses)}
        hint={dashboard.movement.label}
      />
      <MetricCard
        label="Total available"
        value={formatInr(dashboard.balances.total)}
        hint={dashboard.balances.label}
        emphasis
      />
      <MetricCard
        label="Members"
        value={String(dashboard.memberCount)}
        hint={`On the roll by ${formatBusinessDate(dashboard.balances.asOf)}`}
      />
    </div>
  );
}

/**
 * The four method balances.
 *
 * A negative figure is shown as the API sent it. `REQ-FIN-012` requires it to stay visible, so
 * nothing here clamps it to zero or swaps it for "overdrawn" — the number the ledger produces is
 * the number the Admin reads.
 */
function MethodBalances({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border-default bg-surface-subtle p-3">
        <dt className="text-supporting font-semibold text-text-secondary">Cash</dt>
        <dd className="mt-1 text-section-title font-bold text-text-primary">
          {formatInr(dashboard.balances.cash)}
        </dd>
      </div>
      <div className="rounded-lg border border-border-default bg-surface-subtle p-3">
        <dt className="text-supporting font-semibold text-text-secondary">UPI</dt>
        <dd className="mt-1 text-section-title font-bold text-text-primary">
          {formatInr(dashboard.balances.upi)}
        </dd>
      </div>
      <div className="rounded-lg border border-border-default bg-surface-subtle p-3">
        <dt className="text-supporting font-semibold text-text-secondary">Bank</dt>
        <dd className="mt-1 text-section-title font-bold text-text-primary">
          {formatInr(dashboard.balances.bank)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Income against expenses, with the two balance projections kept apart.
 *
 * This panel carries the exact figures and the method balances; the per-month chart lives in its
 * own "Monthly trend" panel below. Drawing the same `trend` array twice would have been two
 * identical charts on one screen, which is decoration rather than information. The movement figure
 * is labelled as belonging to the period while the method cards are labelled as belonging to the
 * balance, because collapsing them into one "balance" number is what `REQ-FIN-014` forbids.
 */
function IncomeExpenseComparison({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <Panel title="Income and expenses">
      <div className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border-default bg-surface-subtle p-3">
            <dt className="text-supporting font-semibold text-text-secondary">
              Income · {dashboard.movement.label}
            </dt>
            <dd className="mt-1 text-section-title font-bold text-text-primary">
              {formatInr(dashboard.movement.income)}
            </dd>
          </div>
          <div className="rounded-lg border border-border-default bg-surface-subtle p-3">
            <dt className="text-supporting font-semibold text-text-secondary">
              Expenses · {dashboard.movement.label}
            </dt>
            <dd className="mt-1 text-section-title font-bold text-text-primary">
              {formatInr(dashboard.movement.expenses)}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-baseline gap-2 text-supporting">
          <span className="text-text-secondary">Net for the period</span>
          <span className="text-section-title font-bold text-text-primary">
            {formatInr(dashboard.movement.net)}
          </span>
        </div>

        <MethodBalances dashboard={dashboard} />

        <p className="text-supporting text-text-secondary">
          The method balances are {dashboard.balances.label.toLowerCase()} (
          {formatBusinessDate(dashboard.balances.asOf)}). Income and expenses above cover only the
          selected period, so the two can differ from these balances without either being wrong.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Contribution status per month.
 *
 * The panel explains what `notConfigured` means rather than only counting it, because a reader
 * seeing a member counted as "not configured" needs to know that nobody set an expectation for
 * them — not that a payment is outstanding.
 */
function ContributionStatusPanel({ dashboard }: { readonly dashboard: DashboardView }) {
  const { months, totals } = dashboard.contributionStatus;

  return (
    <Panel title="Member contributions">
      <div className="space-y-4">
        <p className="text-supporting text-text-secondary">
          Each month counts every member on the roll by that month's end.{' '}
          {CONTRIBUTION_NOT_CONFIGURED} means no expected amount was set for that member, so there
          is nothing to pay yet — it is not an unpaid contribution.
        </p>

        {months.length === 0 ? (
          <EmptyState
            title="No months in this period"
            description="Choose a wider period to see monthly contribution status."
          />
        ) : (
          <>
            <ContributionStatusBars buckets={months} />
            <p className="border-t border-border-default pt-3 text-supporting text-text-secondary">
              Across the period: {totals.paid} paid, {totals.partiallyPaid} part paid,{' '}
              {totals.notPaid} not paid, {totals.notConfigured}{' '}
              {CONTRIBUTION_NOT_CONFIGURED.toLowerCase()}.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function BreakdownPanel({
  title,
  breakdown,
  emptyTitle,
  emptyDescription,
  ariaLabel,
}: {
  readonly title: string;
  readonly breakdown: {
    readonly total: string;
    readonly slices: readonly DashboardBreakdownSlice[];
  };
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly ariaLabel: string;
}) {
  return (
    <Panel title={title}>
      <BreakdownDonutChart
        slices={breakdown.slices}
        total={breakdown.total}
        emptyLabel={emptyTitle}
        ariaLabel={ariaLabel}
      />
      {breakdown.slices.length === 0 ? (
        <p className="mt-2 text-supporting text-text-secondary">{emptyDescription}</p>
      ) : null}
    </Panel>
  );
}

function IncomeBreakdownPanel({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <BreakdownPanel
      title="Income breakdown"
      breakdown={dashboard.incomeBreakdown}
      emptyTitle="No income in this period"
      emptyDescription="Record an offering, a donation, or a member contribution to see the split."
      ariaLabel="Income by type for the selected period"
    />
  );
}

function ExpenseBreakdownPanel({ dashboard }: { readonly dashboard: DashboardView }) {
  return (
    <BreakdownPanel
      title="Expense breakdown"
      breakdown={dashboard.expenseBreakdown}
      emptyTitle="No expenses in this period"
      emptyDescription="Record an expense against a category to see the split."
      ariaLabel="Expenses by category for the selected period"
    />
  );
}

/**
 * The most recent transactions.
 *
 * Only the newest ten are sent, so the list is a "recent activity" affordance rather than a
 * ledger: a reader who wants to search, filter, or page goes to Income or Expenses, which can
 * actually do that. The count line states how many rows are shown rather than implying this is
 * the whole list.
 */
function RecentTransactionsPanel({ dashboard }: { readonly dashboard: DashboardView }) {
  const rows = dashboard.recentTransactions;

  return (
    <Panel
      title="Recent transactions"
      action={
        <p className="text-supporting text-text-secondary">
          Showing the {rows.length} most recent
          {rows.length === 1 ? ' transaction' : ' transactions'}
        </p>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Record income or an expense and it will appear here."
          action={<AddIncomeLink />}
        />
      ) : (
        <>
          <ul className="divide-y divide-border-default">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-supporting font-semibold text-text-primary">
                    {row.description ?? row.referenceId}
                  </p>
                  <p className="text-supporting text-text-secondary">
                    {formatBusinessDate(row.businessDate)} · {row.referenceId} ·{' '}
                    {row.type === 'INCOME' ? 'Income' : 'Expense'}
                    {row.memberName === null ? '' : ` · ${row.memberName}`}
                    {row.categoryName === null ? '' : ` · ${row.categoryName}`}
                  </p>
                </div>
                <p
                  className={`text-supporting font-bold ${
                    row.type === 'INCOME' ? 'text-success-700' : 'text-orange-700'
                  }`}
                >
                  {row.type === 'INCOME' ? '+' : '−'}
                  {formatInr(row.amount)}
                </p>
                <p className="text-supporting text-text-secondary sm:w-40 sm:text-right">
                  <Link
                    to={row.type === 'INCOME' ? `/income/${row.id}` : `/expenses/${row.id}`}
                    className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
                  >
                    View details
                  </Link>
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-3">
            <AddIncomeLink />
            <AddExpenseLink />
          </div>
        </>
      )}
    </Panel>
  );
}

function AddIncomeLink() {
  return (
    <Link
      to="/income"
      className="text-supporting font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
    >
      Record income
    </Link>
  );
}

function AddExpenseLink() {
  return (
    <Link
      to="/expenses"
      className="text-supporting font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
    >
      Record an expense
    </Link>
  );
}

/**
 * Quick actions.
 *
 * Every one of these leads to a screen that exists and works: the two forms, the member list, and
 * the transaction filters. `docs/phases/PHASE-08-DASHBOARD.md` forbids decorative controls, so
 * there is deliberately nothing here that would open a report or a chart the application cannot
 * produce yet — Phase 09 owns those.
 */
function QuickActions() {
  return (
    <Panel title="Quick actions">
      <div className="flex flex-wrap gap-3">
        <Link to="/income" className={PRIMARY_BUTTON_CLASS}>
          Record income
        </Link>
        <Link to="/expenses" className={SECONDARY_BUTTON_CLASS}>
          Record an expense
        </Link>
        <Link to="/members" className={SECONDARY_BUTTON_CLASS}>
          Manage members
        </Link>
      </div>
    </Panel>
  );
}
