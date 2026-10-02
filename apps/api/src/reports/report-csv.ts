import {
  REPORT_CSV_COLUMNS,
  type AuditReport,
  type BreakdownReport,
  type CompleteTransactionReport,
  type DocumentReport,
  type FinancialSummaryReport,
  type MemberContributionReport,
  type PaymentMethodReport,
  type ReportId,
  type TransactionListReport,
} from '@hyssop/contracts';
import { AVAILABLE_BALANCE_LABEL, PERIOD_MOVEMENT_LABEL } from '@hyssop/contracts';
import { buildCsv, type CsvCell } from './csv';

/**
 * Projects each report into its documented CSV rows.
 *
 * Authority: `docs/06-API-SPEC.md` requires the export to use the same projections the report
 * screen consumes, and `docs/01-REQUIREMENTS.md` `REQ-EXPORT-001` requires useful financial fields
 * plus a useful document reference or link where applicable.
 *
 * This module only *reshapes* an already-projected report. It performs no arithmetic and no
 * re-querying: the money strings, statuses, and document states it writes are exactly the ones the
 * service returned, so a CSV can never disagree with the screen it was exported from.
 *
 * The text/number distinction is preserved per column because the CSV writer's formula-injection
 * guard only applies to text. Amounts and dates are written as generated values — a negative
 * method balance must keep its sign — while Admin-entered names, categories, descriptions,
 * filenames, and reasons are written as guarded text.
 */
type Cell = CsvCell;

export function reportToCsv(report: ReportId, data: unknown): string {
  switch (report) {
    case 'financial-summary':
      return buildCsv(
        REPORT_CSV_COLUMNS['financial-summary'],
        financialSummaryRows(data as FinancialSummaryReport),
      );
    case 'income':
      return buildCsv(REPORT_CSV_COLUMNS.income, breakdownRows(data as BreakdownReport));
    case 'expenses':
      return buildCsv(REPORT_CSV_COLUMNS.expenses, breakdownRows(data as BreakdownReport));
    case 'expense-categories':
      return buildCsv(
        REPORT_CSV_COLUMNS['expense-categories'],
        breakdownRows(data as BreakdownReport),
      );
    case 'offerings':
      return buildCsv(REPORT_CSV_COLUMNS.offerings, transactionRows(data as TransactionListReport));
    case 'donations':
      return buildCsv(REPORT_CSV_COLUMNS.donations, transactionRows(data as TransactionListReport));
    case 'member-contributions':
      return buildCsv(
        REPORT_CSV_COLUMNS['member-contributions'],
        contributionRows(data as MemberContributionReport),
      );
    case 'payment-methods':
      return buildCsv(
        REPORT_CSV_COLUMNS['payment-methods'],
        paymentMethodRows(data as PaymentMethodReport),
      );
    case 'documents':
      return buildCsv(REPORT_CSV_COLUMNS.documents, documentRows(data as DocumentReport));
    case 'audit':
      return buildCsv(REPORT_CSV_COLUMNS.audit, auditRows(data as AuditReport));
    case 'transactions':
      return buildCsv(
        REPORT_CSV_COLUMNS.transactions,
        completeTransactionRows(data as CompleteTransactionReport),
      );
    default: {
      const exhaustive: never = report;

      throw new Error(`Unsupported report: ${String(exhaustive)}`);
    }
  }
}

/** The blank value for a genuinely absent field, distinct from an empty Admin-entered string. */
const ABSENT = '';

/**
 * The document-link cell, stating reachability in words.
 *
 * `REQ-EXPORT-002`: a local document link is valid only while the local application is reachable.
 * An exported sheet leaves this application, so a bare path would outlive its meaning. The cell
 * therefore carries the accessibility note and never a bare path on its own — an unavailable
 * document says so instead of offering a link that cannot open.
 */
function documentLinkCell(row: DocumentReport['rows'][number]): string {
  return row.link.locallyReachable ? row.link.accessNote : `Unavailable — ${row.link.accessNote}`;
}

function financialSummaryRows(report: FinancialSummaryReport): Cell[][] {
  return [
    [`${PERIOD_MOVEMENT_LABEL} — Income`, report.movement.income],
    [`${PERIOD_MOVEMENT_LABEL} — Expenses`, report.movement.expenses],
    [`${PERIOD_MOVEMENT_LABEL} — Net`, report.movement.net],
    [`${AVAILABLE_BALANCE_LABEL} — Cash`, report.balances.cash],
    [`${AVAILABLE_BALANCE_LABEL} — UPI`, report.balances.upi],
    [`${AVAILABLE_BALANCE_LABEL} — Bank`, report.balances.bank],
    [`${AVAILABLE_BALANCE_LABEL} — Total`, report.balances.total],
    ['Cumulative income', report.balances.cumulativeIncome],
    ['Cumulative expenses', report.balances.cumulativeExpenses],
    ...report.trend.map((point) => [`Movement — ${point.month}`, point.movement]),
  ];
}

function breakdownRows(report: BreakdownReport): Cell[][] {
  return report.rows.map((row) => [
    { value: row.label, text: true },
    row.amount,
    row.transactionCount,
    `${row.sharePercent}%`,
  ]);
}

function transactionRows(report: TransactionListReport): Cell[][] {
  return report.rows.map((row) => [
    row.referenceId,
    row.businessDate,
    row.amount,
    row.paymentMethod,
    { value: row.memberName ?? ABSENT, text: true },
    { value: row.description ?? ABSENT, text: true },
  ]);
}

function contributionRows(report: MemberContributionReport): Cell[][] {
  return report.rows.map((row) => [
    row.memberReferenceId,
    { value: row.memberName, text: true },
    row.month,
    row.expected,
    row.received,
    row.remaining,
    row.status,
  ]);
}

function paymentMethodRows(report: PaymentMethodReport): Cell[][] {
  return report.rows.map((row) => [row.label, row.income, row.expenses, row.movement, row.balance]);
}

function documentRows(report: DocumentReport): Cell[][] {
  return report.rows.map((row) => [
    row.referenceId,
    { value: row.originalFilename, text: true },
    row.state,
    row.byteSize,
    row.mimeType,
    row.uploadedAt,
    row.transactionReferenceId,
    row.amount,
    row.businessDate,
    { value: row.memberName ?? ABSENT, text: true },
    { value: documentLinkCell(row), text: true },
  ]);
}

function auditRows(report: AuditReport): Cell[][] {
  return report.rows.map((row) => [
    row.id,
    row.action,
    row.entityType,
    { value: row.entityReference ?? ABSENT, text: true },
    { value: row.actorDisplayName ?? ABSENT, text: true },
    row.occurredAt,
    { value: row.reason ?? ABSENT, text: true },
    { value: row.requestId ?? ABSENT, text: true },
  ]);
}

function completeTransactionRows(report: CompleteTransactionReport): Cell[][] {
  return report.rows.map((row) => [
    row.referenceId,
    row.type,
    row.incomeType ?? ABSENT,
    row.amount,
    row.paymentMethod,
    row.status,
    row.businessDate,
    { value: row.member?.name ?? ABSENT, text: true },
    { value: row.category?.name ?? ABSENT, text: true },
    { value: row.description ?? ABSENT, text: true },
    { value: row.voidReason ?? ABSENT, text: true },
  ]);
}
