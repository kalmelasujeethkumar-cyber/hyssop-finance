import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  AUDIT_REPORT_ACTIONS,
  INCOME_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  REPORT_EXCLUDES_VOIDED,
  REPORT_TITLES,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_TYPES,
  type AnyReport,
  type BreakdownReport,
  type CompleteTransactionReport,
  type DocumentReport,
  type FinancialSummaryReport,
  type MemberContributionReport,
  type PaymentMethodReport,
  type ReportDocumentState,
  type ReportId,
  type TransactionListReport,
  type TransactionSummary,
} from '@hyssop/contracts';
import {
  Banner,
  ContributionStatusBadge,
  EmptyState,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  TransactionStatusBadge,
  controlClassName,
} from '../components/ui';
import { DashboardPeriodFilter } from '../features/dashboard/DashboardPeriodFilter';
import {
  dashboardPeriodFromSearch,
  dashboardSearchFromPeriod,
  type DashboardPeriodSelection,
} from '../features/dashboard/dashboard-api';
import {
  AUDIT_FILTER_DEFAULTS,
  REPORT_CHOICES,
  clampReportPageSize,
  readAuditAction,
  readPage,
  readTransactionStatus,
  readTransactionType,
  reportIdFromSearch,
  useReport,
  useReportCsvDownload,
  type AuditReportFilters,
  type ReportSelection,
  type TransactionReportFilters,
} from '../features/reports/reports-api';
import { formatBusinessDate, formatInr, formatIstTimestamp, formatMonthYear } from '../lib/money';

/**
 * The reports screen.
 *
 * Authority: `docs/phases/PHASE-09-REPORTS.md`, `docs/01-REQUIREMENTS.md` (`REQ-REPORT-001` to
 * `REQ-REPORT-004`, `REQ-EXPORT-001`, `REQ-EXPORT-002`), and `docs/03-UI-UX-RULES.md` (every
 * control works, states are distinguishable, nothing is implied that the API did not send).
 *
 * What this screen deliberately does **not** do:
 *
 * - **It computes nothing financial.** Totals, shares, counts, balances, and remaining amounts are
 *   rendered exactly as the API sent them. The browser does not sum rows, does not derive a
 *   percentage, and does not add period income to an earlier balance, because
 *   `docs/02-ARCHITECTURE.md` makes the server the only place a financial figure may be decided.
 * - **It hides nothing.** Voided rows stay visible on the Complete Transaction and Audit reports
 *   and stay excluded from the arithmetic reports, and the screen says which is which using
 *   `REPORT_EXCLUDES_VOIDED` rather than a hand-written sentence per report.
 * - **It states a truncated result.** A bounded row list beside a period total that does not say so
 *   is the one figure combination `REQ-EXPORT-001` calls wrong, so `rowsTruncated` is surfaced in
 *   words, with the narrower-period remedy named.
 * - **It keeps every criterion in the URL.** A shared link reproduces the same figures, which is
 *   what makes a printed report traceable back to the period it came from.
 */

const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;

/** Every URL criterion this screen owns, read in one place so validity is decided once. */
interface ReportsViewState {
  readonly reportId: ReportId;
  readonly period: DashboardPeriodSelection;
  readonly audit: AuditReportFilters;
  readonly transactions: TransactionReportFilters;
  readonly wholeAuditHistory: boolean;
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo<ReportsViewState>(() => readState(searchParams), [searchParams]);
  const selection = toSelection(state);
  const report = useReport(selection);
  const download = useReportCsvDownload();

  /**
   * Changing a criterion returns to page 1.
   *
   * Staying on page 7 of a result set that now has one page would render an empty table, and an
   * empty table after narrowing a filter reads as "this report has no rows" rather than "you are
   * past the end".
   *
   * The new filters are merged *over* the ones already in the URL and only then reset to page 1.
   * Writing `transactions: { ...state.transactions, page: 1 }` after the spread would discard the
   * very change that was just made, so the control would silently do nothing.
   */
  function applyCriteria(next: Partial<ReportsViewState>): void {
    setSearchParams(
      toSearchParams({
        ...state,
        ...next,
        audit: { ...state.audit, ...next.audit, page: 1 },
        transactions: { ...state.transactions, ...next.transactions, page: 1 },
      }),
    );
  }

  function applyPageSize(pageSize: number): void {
    setSearchParams(
      toSearchParams({
        ...state,
        audit: { ...state.audit, pageSize, page: 1 },
        transactions: { ...state.transactions, pageSize, page: 1 },
      }),
    );
  }

  const exportBlockReason = exportBlockReasonOf(state);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Every figure below is calculated by the application from the stored records. Nothing on this screen is worked out in your browser."
      />

      <nav aria-label="Reports" className="print-hidden">
        <ul className="flex flex-wrap gap-2">
          {REPORT_CHOICES.map((reportId) => (
            <li key={reportId}>
              <Link
                to={`/reports?${toSearchParams({ ...state, reportId })}`}
                aria-current={reportId === state.reportId ? 'page' : undefined}
                className={`inline-block rounded-md border px-3 py-1 text-supporting font-semibold ${
                  reportId === state.reportId
                    ? 'border-blue-600 bg-blue-100 text-blue-700 underline'
                    : 'border-border-strong bg-surface text-text-primary hover:bg-surface-subtle'
                }`}
              >
                {REPORT_TITLES[reportId]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <PrintedHeader
        generatedAt={report.data?.generatedAt}
        title={REPORT_TITLES[state.reportId]}
        scope={printedScopeOf(report.data)}
      />

      {/*
        The whole options panel is hidden in print, not just its buttons. A printed page whose
        header is a half-filled date filter and a "Print this report" button is chrome pretending to
        be content, and it would make the printed figures look filtered by controls that no longer
        apply. The criteria are not lost: they are in the URL the page was printed from, and the
        report body states its own period or window.
      */}
      <div className="print-hidden">
        <Panel title={`${REPORT_TITLES[state.reportId]} options`}>
          <div className="space-y-4">
            {state.reportId === 'audit' ? (
              <AuditWindowControls
                filters={state.audit}
                wholeHistory={state.wholeAuditHistory}
                onChange={(next) => {
                  applyCriteria({ audit: { ...state.audit, ...next } });
                }}
                onWholeHistoryChange={(wholeAuditHistory) => {
                  applyCriteria({ wholeAuditHistory });
                }}
              />
            ) : (
              <DashboardPeriodFilter
                period={state.period}
                onChange={(period) => {
                  applyCriteria({ period });
                }}
              />
            )}

            {state.reportId === 'transactions' ? (
              <TransactionReportControls
                filters={state.transactions}
                onChange={(next) => {
                  applyCriteria({ transactions: { ...state.transactions, ...next } });
                }}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => {
                  window.print();
                }}
              >
                Print this report
              </button>

              {/*
                The export route widens the Audit report's window to a whole period, so an audit
                window without both bounds has no period to export. The control is replaced by the
                reason rather than left enabled and quietly exporting something else.
              */}
              {exportBlockReason === null ? (
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS}
                  disabled={download.isPending}
                  onClick={() => {
                    download.mutate({ reportId: state.reportId, period: exportPeriodOf(state) });
                  }}
                >
                  {download.isPending ? 'Preparing CSV…' : 'Download CSV'}
                </button>
              ) : (
                <p className="text-supporting text-text-secondary">{exportBlockReason}</p>
              )}
            </div>

            {download.isError ? (
              <Banner
                tone="danger"
                action={
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    onClick={() => {
                      download.reset();
                    }}
                  >
                    Dismiss
                  </button>
                }
              >
                {messageFor(download.error)}
              </Banner>
            ) : null}

            {download.isSuccess ? (
              <Banner tone="success">Saved {download.data} to your downloads.</Banner>
            ) : null}
          </div>
        </Panel>
      </div>

      <ReportBody
        report={report}
        reportId={state.reportId}
        onRetry={() => {
          void report.refetch();
        }}
        onPageChange={(page) => {
          const next: ReportsViewState =
            state.reportId === 'audit'
              ? { ...state, audit: { ...state.audit, page } }
              : { ...state, transactions: { ...state.transactions, page } };

          setSearchParams(toSearchParams(next));
        }}
        onPageSizeChange={applyPageSize}
      />
    </div>
  );
}

/** The report body, which distinguishes loading, failed, empty, and populated. */
function ReportBody({
  report,
  reportId,
  onRetry,
  onPageChange,
  onPageSizeChange,
}: {
  readonly report: UseQueryResult<AnyReport, Error>;
  readonly reportId: ReportId;
  readonly onRetry: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}) {
  const visibility = (
    <p data-testid="voided-visibility" className="text-supporting text-text-secondary">
      {REPORT_EXCLUDES_VOIDED[reportId]
        ? 'Voided transactions are left out of these figures. They are still shown on the Complete Transaction and Audit reports.'
        : 'Voided transactions are kept in this report, because it is a history report.'}
    </p>
  );

  if (report.isPending) {
    return (
      <Panel title={REPORT_TITLES[reportId]}>
        <div className="space-y-4">
          {visibility}
          <LoadingBlock label="Loading the report…" />
        </div>
      </Panel>
    );
  }

  if (report.isError) {
    return (
      <Panel title={REPORT_TITLES[reportId]}>
        <div className="space-y-4">
          {visibility}
          <Banner tone="danger">{messageFor(report.error)}</Banner>
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onRetry}>
            Load the report again
          </button>
        </div>
      </Panel>
    );
  }

  const data = report.data;

  if (data === undefined) {
    return null;
  }

  return (
    <Panel title={REPORT_TITLES[data.reportId]}>
      <div className="space-y-4">
        {visibility}
        <ReportProjection report={data} />
        {data.reportId === 'audit' || data.reportId === 'transactions' ? (
          <Pagination
            pagination={data.pagination}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Renders one report projection.
 *
 * The switch is exhaustive over `reportId`, so adding a report to the contract without teaching
 * this screen to show it becomes a type error rather than a silently blank panel — the failure the
 * UI-UX rules forbid.
 */
function ReportProjection({ report }: { readonly report: AnyReport }) {
  switch (report.reportId) {
    case 'financial-summary':
      return <FinancialSummaryProjection report={report} />;
    case 'income':
    case 'expenses':
    case 'expense-categories':
      return <BreakdownProjection report={report} />;
    case 'member-contributions':
      return <MemberContributionProjection report={report} />;
    case 'offerings':
    case 'donations':
      return <TransactionListProjection report={report} />;
    case 'payment-methods':
      return <PaymentMethodProjection report={report} />;
    case 'documents':
      return <DocumentProjection report={report} />;
    case 'audit':
      return <AuditProjection report={report} />;
    case 'transactions':
      return <CompleteTransactionProjection report={report} />;
    default: {
      const unreachable: never = report;

      return (
        <p>Unsupported report: {String((unreachable as { readonly reportId: string }).reportId)}</p>
      );
    }
  }
}

function FinancialSummaryProjection({ report }: { readonly report: FinancialSummaryReport }) {
  return (
    <div className="space-y-5">
      <DefinitionGrid
        caption={`${report.movement.label} for ${report.period.label}`}
        rows={[
          ['Income in period', formatInr(report.movement.income)],
          ['Expenses in period', formatInr(report.movement.expenses)],
          ['Movement in period', formatInr(report.movement.net)],
        ]}
      />

      <DefinitionGrid
        caption={`${report.balances.label} as on ${formatBusinessDate(report.balances.asOf)}`}
        rows={[
          ['Cash', formatInr(report.balances.cash)],
          ['UPI', formatInr(report.balances.upi)],
          ['Bank', formatInr(report.balances.bank)],
          ['Total available', formatInr(report.balances.total)],
          ['Total income recorded', formatInr(report.balances.cumulativeIncome)],
          ['Total expenses recorded', formatInr(report.balances.cumulativeExpenses)],
        ]}
      />

      <p className="text-supporting text-text-secondary">
        {report.balances.label} is the money actually held on{' '}
        {formatBusinessDate(report.balances.asOf)}, which is not the same figure as the movement
        inside this period.
      </p>

      {report.trend.length === 0 ? (
        <EmptyState
          title="No months in this period"
          description="This period does not contain any whole month, so there is no month-by-month trend to show."
        />
      ) : (
        <DataTable
          caption="Month by month income, expenses, and movement"
          head={['Month', 'Income', 'Expenses', 'Movement']}
          rows={report.trend.map((point) => [
            formatMonthYear(point.year, point.monthNumber),
            formatInr(point.income),
            formatInr(point.expenses),
            formatInr(point.movement),
          ])}
          numericFrom={1}
        />
      )}
    </div>
  );
}

function BreakdownProjection({ report }: { readonly report: BreakdownReport }) {
  const groupName = report.reportId === 'income' ? 'income type' : 'expense category';

  return (
    <div className="space-y-4">
      <p data-testid="report-total" className="text-supporting font-semibold text-text-primary">
        {REPORT_TITLES[report.reportId]} total for {report.period.label}: {formatInr(report.total)}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          title={`No ${REPORT_TITLES[report.reportId].toLowerCase()} recorded in this period`}
          description="Nothing was recorded in this period. Choose a wider period to see earlier records."
        />
      ) : (
        <DataTable
          caption={`${REPORT_TITLES[report.reportId]} by ${groupName}, with the amount, the number of transactions, and the share of the total`}
          head={['Group', 'Amount', 'Transactions', 'Share']}
          rows={report.rows.map((row) => [
            row.label,
            formatInr(row.amount),
            String(row.transactionCount),
            `${row.sharePercent}%`,
          ])}
          numericFrom={1}
        />
      )}
    </div>
  );
}

function MemberContributionProjection({ report }: { readonly report: MemberContributionReport }) {
  const totals = report.totals;

  return (
    <div className="space-y-4">
      <DefinitionGrid
        caption="Expected, received, and still to be received for this period"
        rows={[
          ['Member months', String(totals.memberMonths)],
          ['Expected in total', formatInr(totals.expected)],
          ['Received in total', formatInr(totals.received)],
          ['Still to be received', formatInr(totals.remaining)],
          ['Paid in full', String(totals.paid)],
          ['Part paid', String(totals.partiallyPaid)],
          ['Not paid', String(totals.notPaid)],
        ]}
      />

      {report.rows.length === 0 ? (
        <EmptyState
          title="No member contributions are set up for this period"
          description="No member has an expected amount configured for this period. Set one from a member record to see it here."
        />
      ) : (
        <DataTable
          caption="Expected, received, remaining, and status for each member and month"
          head={['Member', 'Month', 'Expected', 'Received', 'Remaining', 'Status']}
          rows={report.rows.map((row) => [
            `${row.memberName} (${row.memberReferenceId})`,
            formatMonthYear(row.year, row.monthNumber),
            formatInr(row.expected),
            formatInr(row.received),
            formatInr(row.remaining),
            <ContributionStatusBadge key={`${row.memberId}-${row.month}`} status={row.status} />,
          ])}
          numericFrom={2}
        />
      )}
    </div>
  );
}

function TransactionListProjection({ report }: { readonly report: TransactionListReport }) {
  return (
    <div className="space-y-4">
      <p data-testid="report-total" className="text-supporting font-semibold text-text-primary">
        {REPORT_TITLES[report.reportId]} total for {report.period.label}: {formatInr(report.total)}{' '}
        across {report.transactionCount}{' '}
        {report.transactionCount === 1 ? 'transaction' : 'transactions'}
      </p>

      {/* `rowsTruncated` is a server decision about a bounded row list. Saying nothing about it
          would leave a period total beside a partial list, which reads as if the total described
          the whole list. */}
      {report.rowsTruncated ? (
        <Banner tone="warning">
          Only the first {report.rows.length} of {report.transactionCount} transactions are shown.
          The total above covers all {report.transactionCount}. Choose a narrower period to see
          every transaction.
        </Banner>
      ) : null}

      {report.rows.length === 0 ? (
        <EmptyState
          title={`No ${REPORT_TITLES[report.reportId].toLowerCase()} recorded in this period`}
          description="Nothing was recorded in this period. Choose a wider period to see earlier records."
        />
      ) : (
        <DataTable
          caption={`${REPORT_TITLES[report.reportId]} transactions with reference, date, amount, method, member, description, and receipts`}
          head={['Reference', 'Date', 'Amount', 'Method', 'Member', 'Description', 'Receipts']}
          rows={report.rows.map((row) => [
            row.referenceId,
            formatBusinessDate(row.businessDate),
            formatInr(row.amount),
            PAYMENT_METHOD_LABELS[row.paymentMethod],
            row.memberName === null
              ? 'No member recorded'
              : `${row.memberName} (${row.memberReferenceId ?? '—'})`,
            row.description === null
              ? row.incomeType === 'ANONYMOUS_DONATION'
                ? 'Anonymous donation — no donor details'
                : '—'
              : row.description,
            row.hasAvailableDocument
              ? `${row.documentCount} available`
              : row.documentCount === 0
                ? 'None'
                : `${row.documentCount} removed`,
          ])}
          numericFrom={2}
        />
      )}
    </div>
  );
}

function PaymentMethodProjection({ report }: { readonly report: PaymentMethodReport }) {
  return (
    <div className="space-y-4">
      <p className="text-supporting text-text-secondary">
        {report.movementLabel} counts only what happened inside this period. {report.balanceLabel}{' '}
        is the money held through the end of the period, so it also includes earlier months.
      </p>

      <DataTable
        caption={`${report.movementLabel} and ${report.balanceLabel} for each payment method`}
        head={['Method', 'Income', 'Expenses', report.movementLabel, report.balanceLabel]}
        rows={report.rows.map((row) => [
          row.label,
          formatInr(row.income),
          formatInr(row.expenses),
          formatInr(row.movement),
          formatInr(row.balance),
        ])}
        numericFrom={1}
      />

      <p data-testid="report-total" className="text-supporting font-semibold text-text-primary">
        Total {report.movementLabel.toLowerCase()}: {formatInr(report.totalMovement)} · Total{' '}
        {report.balanceLabel.toLowerCase()}: {formatInr(report.totalBalance)}
      </p>
    </div>
  );
}

function DocumentProjection({ report }: { readonly report: DocumentReport }) {
  return (
    <div className="space-y-4">
      <DefinitionGrid
        caption="How many receipts and documents there are, by state"
        rows={[
          ['Available now', String(report.counts.AVAILABLE)],
          ['Removed, file gone', String(report.counts.REMOVED)],
          ['Kept for a voided transaction', String(report.counts.VOIDED)],
        ]}
      />

      <p className="text-supporting text-text-secondary">
        A document link opens the file only while this local application is running. It is not an
        internet address, so a printed copy of this report cannot be used to open the file later.
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          title="No receipts attached in this period"
          description="No receipt or document was attached to a transaction in this period."
        />
      ) : (
        <DataTable
          caption="Attached documents with state, transaction, amount, and a local link"
          head={['Document', 'State', 'Transaction', 'Amount', 'Date', 'File', 'Open']}
          rows={report.rows.map((row) => [
            `${row.referenceId} · ${row.originalFilename}`,
            documentStateLabel(row.state),
            row.transactionReferenceId,
            formatInr(row.amount),
            formatBusinessDate(row.businessDate),
            `${row.mimeType} · ${formatByteSize(row.byteSize)}`,
            row.link.locallyReachable ? (
              <a
                key={`link-${row.documentId}`}
                href={row.link.storagePath ?? '#'}
                className="font-semibold text-blue-700 underline"
              >
                Open file
                <span className="sr-only"> {row.originalFilename}</span>
              </a>
            ) : (
              `Not available — ${row.link.accessNote}`
            ),
          ])}
          numericFrom={3}
        />
      )}
    </div>
  );
}

function AuditProjection({
  report,
}: {
  readonly report: AnyReport & { readonly reportId: 'audit' };
}) {
  return (
    <div className="space-y-4">
      <p className="text-supporting text-text-secondary">
        Showing events from {describeInstantRange(report.range.from, report.range.to)}.{' '}
        {report.action === null ? 'Every action.' : `Filtered to ${humanise(report.action)}.`}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          title="No audit events in this window"
          description="Nothing was recorded in this window. Widen the dates or switch to the whole history to see everything."
        />
      ) : (
        <DataTable
          caption="Audit history with action, record, actor, time, and reason"
          head={['When', 'Action', 'Record', 'Actor', 'Reason', 'Event']}
          rows={report.rows.map((row) => [
            formatIstTimestamp(row.occurredAt),
            humanise(row.action),
            row.entityReference === null ? row.entityType : row.entityReference,
            row.actorDisplayName ?? 'System',
            row.reason ?? '—',
            row.id,
          ])}
        />
      )}
    </div>
  );
}

function CompleteTransactionProjection({ report }: { readonly report: CompleteTransactionReport }) {
  return (
    <div className="space-y-4">
      <p data-testid="report-total" className="text-supporting font-semibold text-text-primary">
        {REPORT_TITLES.transactions} total for {report.period.label}: {formatInr(report.total)}{' '}
        across {report.transactionCount}{' '}
        {report.transactionCount === 1 ? 'transaction' : 'transactions'}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          title="No transactions in this period"
          description="Nothing was recorded in this period. Choose a wider period to see earlier records."
        />
      ) : (
        <DataTable
          caption="Every transaction in the period, including voided ones"
          head={['Reference', 'Date', 'Type', 'Amount', 'Method', 'Member or category', 'Status']}
          rows={report.rows.map((row) => [
            row.referenceId,
            formatBusinessDate(row.businessDate),
            transactionKindOf(row),
            formatInr(row.amount),
            PAYMENT_METHOD_LABELS[row.paymentMethod],
            row.member === null
              ? (row.category?.name ?? 'No member recorded')
              : `${row.member.name} (${row.member.referenceId})`,
            <TransactionStatusBadge key={`status-${row.id}`} status={row.status} />,
          ])}
          numericFrom={3}
        />
      )}
    </div>
  );
}

/** `TRANSACTION_VOIDED` reads as "Transaction voided" rather than as a database enum. */
function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function transactionKindOf(row: TransactionSummary): string {
  if (row.type === 'EXPENSE') {
    return 'Expense';
  }

  return row.incomeType === null ? 'Income' : INCOME_TYPE_LABELS[row.incomeType];
}

/** The Audit report's window, which is an instant range rather than a business period. */
function AuditWindowControls({
  filters,
  wholeHistory,
  onChange,
  onWholeHistoryChange,
}: {
  readonly filters: AuditReportFilters;
  readonly wholeHistory: boolean;
  readonly onChange: (next: Partial<AuditReportFilters>) => void;
  readonly onWholeHistoryChange: (wholeHistory: boolean) => void;
}) {
  const fieldId = 'audit-window';

  return (
    <fieldset className="rounded-xl border border-border-default bg-surface p-4">
      <legend className="px-1 text-supporting font-semibold text-text-primary">Audit window</legend>

      <p className="mb-4 text-supporting text-text-secondary">
        An audit event happened at a moment in time, so this window is read as exact instants. Each
        date is taken as that whole day in Asia/Kolkata.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`${fieldId}-from`} label="From date" optional={wholeHistory}>
          <input
            id={`${fieldId}-from`}
            type="date"
            className={controlClassName()}
            value={filters.from}
            disabled={wholeHistory}
            onChange={(event) => {
              onChange({ from: event.target.value });
            }}
          />
        </FormField>

        <FormField id={`${fieldId}-to`} label="To date" optional={wholeHistory}>
          <input
            id={`${fieldId}-to`}
            type="date"
            className={controlClassName()}
            value={filters.to}
            disabled={wholeHistory}
            onChange={(event) => {
              onChange({ to: event.target.value });
            }}
          />
        </FormField>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          id={`${fieldId}-whole`}
          type="checkbox"
          checked={wholeHistory}
          onChange={(event) => {
            onWholeHistoryChange(event.target.checked);
          }}
        />
        <label htmlFor={`${fieldId}-whole`} className="text-supporting text-text-primary">
          Whole history, from the first record to now
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField id={`${fieldId}-action`} label="Action" optional>
          <select
            id={`${fieldId}-action`}
            className={controlClassName()}
            value={filters.action}
            onChange={(event) => {
              onChange({
                action: readAuditAction(event.target.value === '' ? null : event.target.value),
              });
            }}
          >
            <option value="">Every action</option>
            {AUDIT_REPORT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {humanise(action)}
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </fieldset>
  );
}

/** The Complete Transaction report's own type and status filters, on top of its period. */
function TransactionReportControls({
  filters,
  onChange,
}: {
  readonly filters: TransactionReportFilters;
  readonly onChange: (next: Partial<TransactionReportFilters>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FormField id="transactions-report-type" label="Transaction type" optional>
        <select
          id="transactions-report-type"
          className={controlClassName()}
          value={filters.type}
          onChange={(event) => {
            onChange({
              type: readTransactionType(event.target.value === '' ? null : event.target.value),
            });
          }}
        >
          <option value="">Income and expenses</option>
          {TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'INCOME' ? 'Income only' : 'Expenses only'}
            </option>
          ))}
        </select>
      </FormField>

      <FormField id="transactions-report-status" label="Status" optional>
        <select
          id="transactions-report-status"
          className={controlClassName()}
          value={filters.status}
          onChange={(event) => {
            onChange({
              status: readTransactionStatus(event.target.value === '' ? null : event.target.value),
            });
          }}
        >
          <option value="">Active and voided</option>
          <option value="ACTIVE">Active only</option>
          <option value="VOIDED">Voided only</option>
        </select>
      </FormField>
    </div>
  );
}

/**
 * A labelled two-column list of figures.
 *
 * Used instead of a one-row table because these are label/value pairs read as sentences, and
 * wrapping them in a table would imply a column relationship that does not exist.
 */
function DefinitionGrid({
  caption,
  rows,
}: {
  readonly caption: string;
  readonly rows: readonly (readonly [string, string])[];
}) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="print-block border-b border-border-default last:border-0">
            <th scope="row" className="py-2 pr-4 text-supporting font-semibold text-text-primary">
              {label}
            </th>
            <td className="py-2 text-right text-supporting font-semibold text-text-primary">
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A report table.
 *
 * The same narrow-viewport treatment as the transaction list: a horizontally scrollable table from
 * the `sm` breakpoint up, and stacked cards below it, because squeezing six financial columns into
 * a phone width is what produces an unreadable report.
 */
function DataTable({
  caption,
  head,
  rows,
  numericFrom,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly (string | ReactNode)[])[];
  readonly numericFrom?: number | undefined;
}) {
  const isNumericColumn = (index: number): boolean =>
    numericFrom !== undefined && index >= numericFrom;

  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border-default">
              {head.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={`px-3 py-2 text-supporting font-semibold text-text-primary ${
                    isNumericColumn(index) ? 'text-right' : ''
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`row-${rowIndex}`}
                className="print-block border-b border-border-default last:border-0"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${rowIndex}-${cellIndex}`}
                    className={`px-3 py-2 text-supporting text-text-primary ${
                      isNumericColumn(cellIndex) ? 'text-right font-semibold' : ''
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 sm:hidden">
        {rows.map((row, rowIndex) => (
          <li
            key={`card-${rowIndex}`}
            className="rounded-lg border border-border-default bg-surface-subtle p-4"
          >
            {row.map((cell, cellIndex) => (
              <p
                key={`card-${rowIndex}-${cellIndex}`}
                className="text-supporting text-text-secondary first:font-semibold first:text-text-primary"
              >
                <span className="font-semibold text-text-primary">{head[cellIndex] ?? ''}: </span>
                {cell}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function Pagination({
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  readonly pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}) {
  const lastPage = Math.max(1, pagination.totalPages);

  return (
    <div className="print-hidden flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p data-testid="result-count" className="text-supporting text-text-secondary">
        Page {pagination.page} of {lastPage} · {pagination.totalItems}{' '}
        {pagination.totalItems === 1 ? 'row' : 'rows'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="report-page-size" className="text-supporting text-text-secondary">
          Per page
        </label>
        <select
          id="report-page-size"
          className={controlClassName('w-auto')}
          value={pagination.pageSize}
          onChange={(event) => {
            onPageSizeChange(clampReportPageSize(Number(event.target.value)));
          }}
        >
          {PAGE_SIZE_CHOICES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={pagination.page <= 1}
          onClick={() => {
            onPageChange(pagination.page - 1);
          }}
        >
          Previous
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={pagination.page >= lastPage}
          onClick={() => {
            onPageChange(pagination.page + 1);
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * The printed header.
 *
 * It reads the report's own `generatedAt`, `period`/`range`, and title rather than repeating the
 * on-screen line, so a printed page states what the API decided rather than the browser's guess.
 * The scope line is not optional decoration: the options panel is hidden in print, so this is the
 * only place a printed page says *which* period or window its figures cover.
 */
function PrintedHeader({
  generatedAt,
  title,
  scope,
}: {
  readonly generatedAt: string | undefined;
  readonly title: string;
  readonly scope: string;
}) {
  if (generatedAt === undefined) {
    return null;
  }

  return (
    <div className="print-only">
      <p className="text-section-title font-bold text-text-primary">HYSSOP FINANCE</p>
      <p className="text-supporting font-semibold text-text-primary">{title}</p>
      <p className="text-supporting text-text-secondary">
        {scope === '' ? '' : `${scope} · `}
        Generated {formatIstTimestamp(generatedAt)} · Asia/Kolkata · INR
      </p>
    </div>
  );
}

/**
 * The printed scope line, read from the projection rather than from the URL.
 *
 * The screen's own period label is deliberately not reused, because it can describe a preset the
 * API resolved ("This month") while the printed page should state the bounds the API answered with.
 */
function printedScopeOf(report: AnyReport | undefined): string {
  if (report === undefined) {
    return '';
  }

  if (report.reportId === 'audit') {
    return `Audit window ${describeInstantRange(report.range.from, report.range.to)}`;
  }

  return report.period.label;
}

/**
 * The period the CSV export uses.
 *
 * Every report except Audit has one directly. For Audit it is the chosen window expressed as a
 * custom range, which is how the export route reads a report period — a bounded window only,
 * because a whole-history audit has no period and the screen says so instead of exporting one.
 */
function exportPeriodOf(state: ReportsViewState): DashboardPeriodSelection {
  if (state.reportId === 'audit') {
    return { kind: 'custom', from: state.audit.from, to: state.audit.to };
  }

  return state.period;
}

/**
 * Why the CSV control is unavailable, or `null` when it is available.
 *
 * A control that cannot work is either removed or replaced by its reason. Returning the reason here
 * keeps that decision in one place rather than spread across a `disabled` attribute and a separate
 * explanatory paragraph that could disagree with it.
 */
function exportBlockReasonOf(state: ReportsViewState): string | null {
  if (state.reportId !== 'audit') {
    return null;
  }

  if (state.wholeAuditHistory) {
    return 'Choose a date range to export the audit history. A whole-history audit has no period to export.';
  }

  if (state.audit.from === '' || state.audit.to === '') {
    return 'Choose both dates to export the audit history. An export is always for a defined period.';
  }

  return null;
}

/** Builds the one selection the report hook reads, so no screen state can produce a bad request. */
function toSelection(state: ReportsViewState): ReportSelection {
  if (state.reportId === 'audit') {
    // Named field by field: dropping keys by destructuring would silently ignore any filter added
    // to the contract later, and the report would then be requested with one less criterion than
    // the screen shows.
    const { from, to, action, page, pageSize } = state.audit;

    return {
      reportId: 'audit',
      // A whole-history audit covers every event, so it is asked for without a window instead of
      // with the dates that happen to be left in the controls.
      filters: state.wholeAuditHistory
        ? { from: '', to: '', action, page, pageSize }
        : { from, to, action, page, pageSize },
    };
  }

  if (state.reportId === 'transactions') {
    return { reportId: 'transactions', period: state.period, filters: state.transactions };
  }

  return { reportId: state.reportId, period: state.period };
}

/** Reads every URL criterion, falling back to the documented defaults rather than erroring. */
function readState(searchParams: URLSearchParams): ReportsViewState {
  const pageSize = readPageSize(searchParams);

  return {
    reportId: reportIdFromSearch(searchParams),
    period: dashboardPeriodFromSearch(searchParams),
    audit: {
      from: searchParams.get('auditFrom') ?? AUDIT_FILTER_DEFAULTS.from,
      to: searchParams.get('auditTo') ?? AUDIT_FILTER_DEFAULTS.to,
      action: readAuditAction(searchParams.get('action')),
      page: readPage(searchParams, 'page'),
      pageSize,
    },
    transactions: {
      type: readTransactionType(searchParams.get('type')),
      status: readTransactionStatus(searchParams.get('status')),
      page: readPage(searchParams, 'page'),
      pageSize,
    },
    wholeAuditHistory: searchParams.get('auditAll') === '1',
  };
}

/**
 * Writes only the criteria that differ from the defaults.
 *
 * A shared link stays short and readable, and the API's own documented defaults apply for anything
 * left out, so the URL never carries a value the request does not use.
 */
function toSearchParams(state: ReportsViewState): string {
  const params = new URLSearchParams();

  params.set('report', state.reportId);

  if (state.reportId === 'audit') {
    if (state.wholeAuditHistory) {
      params.set('auditAll', '1');
    } else {
      if (state.audit.from !== '') {
        params.set('auditFrom', state.audit.from);
      }
      if (state.audit.to !== '') {
        params.set('auditTo', state.audit.to);
      }
    }

    if (state.audit.action !== '') {
      params.set('action', state.audit.action);
    }

    appendPaging(params, state.audit);

    return params.toString();
  }

  appendPeriod(params, state.period);

  if (state.reportId === 'transactions') {
    if (state.transactions.type !== '') {
      params.set('type', state.transactions.type);
    }
    if (state.transactions.status !== '') {
      params.set('status', state.transactions.status);
    }

    appendPaging(params, state.transactions);
  }

  return params.toString();
}

function appendPeriod(params: URLSearchParams, period: DashboardPeriodSelection): void {
  for (const [key, value] of new URLSearchParams(dashboardSearchFromPeriod(period))) {
    params.set(key, value);
  }
}

function appendPaging(
  params: URLSearchParams,
  filters: { readonly page: number; readonly pageSize: number },
): void {
  if (filters.page !== 1) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== TRANSACTION_PAGE_SIZE_DEFAULT) {
    params.set('pageSize', String(filters.pageSize));
  }
}

function readPageSize(searchParams: URLSearchParams): number {
  const raw = Number(searchParams.get('pageSize'));

  return clampReportPageSize(
    Number.isInteger(raw) && raw > 0 ? raw : TRANSACTION_PAGE_SIZE_DEFAULT,
  );
}

function messageFor(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

/** The three document states, in the Admin's words rather than the enum's. */
function documentStateLabel(state: ReportDocumentState): string {
  if (state === 'AVAILABLE') {
    return 'Available';
  }

  return state === 'REMOVED' ? 'Removed, file gone' : 'Kept for a voided transaction';
}

function describeInstantRange(from: string | null, to: string | null): string {
  if (from === null) {
    return to === null ? 'the first record to now' : `up to ${formatIstTimestamp(to)}`;
  }

  return to === null
    ? `from ${formatIstTimestamp(from)}`
    : `${formatIstTimestamp(from)} to ${formatIstTimestamp(to)}`;
}

/** A byte count in the largest unit that stays readable. */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
