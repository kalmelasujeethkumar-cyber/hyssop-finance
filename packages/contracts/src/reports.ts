/**
 * Shared reports, search, and export contract.
 *
 * Owned by `docs/06-API-SPEC.md` "Dashboard and reports" and "Search", and shaped by
 * `docs/01-REQUIREMENTS.md` (`REQ-REPORT-001` to `REQ-REPORT-004`, `REQ-SEARCH-001`,
 * `REQ-SEARCH-002`, `REQ-EXPORT-001`, `REQ-EXPORT-002`) and `docs/02-ARCHITECTURE.md`
 * (the canonical server-side calculation layer). Both applications depend on this module so a
 * report payload cannot drift between the API that computes it and the browser that renders it.
 *
 * Five rules are load-bearing here, and they are the reason this file exists rather than a set
 * of interfaces sprinkled through the reports module:
 *
 * - **Money crosses the boundary as an exact decimal string.** Every amount is `"16500.00"`,
 *   never a JSON number, for the same reason as the dashboard contract: `REQ-FIN-021` and
 *   `docs/05-DATABASE-SPEC.md` require paise to be exact and a double cannot represent every
 *   paise value. Nothing here is ever converted to a JavaScript `number` by either application.
 * - **Every report is a projection, never a client-computed figure.** `docs/02-ARCHITECTURE.md`
 *   makes the canonical calculation layer server-side, so totals, shares, counts, and remaining
 *   amounts are all decided by the API. A `sharePercent` is an exact two-decimal string for the
 *   same reason `DashboardBreakdownSlice.sharePercent` is: the browser cannot re-derive it and
 *   disagree with the server about a label.
 * - **Report visibility is deterministic and stated per report.** `docs/06-API-SPEC.md` requires
 *   active financial reports to exclude `VOIDED` records, Complete Transaction and Audit to retain
 *   history, and Receipt / Document to distinguish `AVAILABLE`, `REMOVED`, and authorized
 *   historical `VOIDED`. That is a per-report fact, so it is encoded as a per-report constant
 *   below rather than left to each screen to remember.
 * - **Period movement and ending ledger balance stay separately labelled.** `REQ-FIN-009` makes a
 *   selected period's income and expense *movements*, while `REQ-FIN-010` and `REQ-FIN-013` make
 *   the per-method figures *ending balances through the period end*. `REQ-FIN-014` requires the
 *   distinction to be visible, so a balance field always carries the shared balance label and a
 *   movement field always carries the shared movement label.
 * - **A local document link is not a permanent URL.** `REQ-EXPORT-002` requires an exported local
 *   document reference to be identified as valid only while the local application is reachable.
 *   {@link ReportDocumentLink} therefore reports the reachable state as data rather than implying
 *   an internet-resolvable address, and the CSV columns say the same thing in words.
 */

import type {
  CURRENCY,
  IncomeType,
  PaymentMethod,
  TransactionStatus,
  TransactionSummary,
  TransactionType,
} from './transactions';
import type { ContributionStatus } from './members';
import type {
  AVAILABLE_BALANCE_LABEL,
  PERIOD_MOVEMENT_LABEL,
  DashboardPeriodView,
} from './dashboard';
import type { ApiPagination } from './api-envelope';

/**
 * The eleven report identifiers of `REQ-REPORT-001`, spelled exactly as the
 * `docs/06-API-SPEC.md` route segments.
 *
 * A closed list rather than a free string, so `GET /reports/:reportId/export.csv` can reject an
 * unknown report with a documented `VALIDATION_FAILED` instead of building a filename from
 * arbitrary path text. The order is the order `REQ-REPORT-001` lists them.
 */
export const REPORT_IDS = [
  'financial-summary',
  'income',
  'expenses',
  'member-contributions',
  'offerings',
  'donations',
  'payment-methods',
  'expense-categories',
  'documents',
  'audit',
  'transactions',
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

/** Admin-facing titles, so the report picker and the print header read the same text. */
export const REPORT_TITLES: Readonly<Record<ReportId, string>> = {
  'financial-summary': 'Financial Summary',
  income: 'Income',
  expenses: 'Expense',
  'member-contributions': 'Member Contribution',
  offerings: 'Offering',
  donations: 'Donation',
  'payment-methods': 'Payment Method',
  'expense-categories': 'Expense Category',
  documents: 'Receipt / Document',
  audit: 'Audit',
  transactions: 'Complete Transaction',
};

export function isReportId(value: unknown): value is ReportId {
  return typeof value === 'string' && (REPORT_IDS as readonly string[]).includes(value);
}

/**
 * Whether a report excludes voided rows from its figures.
 *
 * `docs/06-API-SPEC.md`: "active financial reports exclude `VOIDED` records; Complete Transaction
 * and Audit retain history". Encoded once here so a report screen, its CSV export, and its print
 * header cannot disagree about what a number counts.
 *
 * The value answers exactly one question — "are voided rows left out of this report?" — so a
 * `false` means the rows are present and any further visibility rule lives in a field.
 *
 * `transactions` and `audit` are `false` because they are the history reports.
 *
 * `documents` is `false` for the same reason and is worth stating plainly, because the arithmetic
 * reports above it are all `true`. A document attached to a voided transaction is still an
 * authorized part of that transaction's audit history, so the Receipt / Document report *returns*
 * it and labels it `VOIDED` through {@link ReportDocumentRow.state}. It does not quietly drop those
 * rows, and it does not fold them into any available-document count. A `true` here would have been
 * the convenient lie, claiming a filter the report never applies.
 */
export const REPORT_EXCLUDES_VOIDED: Readonly<Record<ReportId, boolean>> = {
  'financial-summary': true,
  income: true,
  expenses: true,
  'member-contributions': true,
  offerings: true,
  donations: true,
  'payment-methods': true,
  'expense-categories': true,
  documents: false,
  audit: false,
  transactions: false,
};

/** Whether a report's window is a resolved period rather than an open-ended history read. */
export const REPORT_IS_PERIOD_BOUNDED: Readonly<Record<ReportId, boolean>> = {
  'financial-summary': true,
  income: true,
  expenses: true,
  'member-contributions': true,
  offerings: true,
  donations: true,
  'payment-methods': true,
  'expense-categories': true,
  documents: true,
  audit: false,
  transactions: true,
};

/**
 * The audit actions a report or an audit list may filter by.
 *
 * Mirrors the database's `audit_event.action` enum (`prisma/schema.prisma` `AuditAction`) exactly,
 * rather than inventing a parallel vocabulary, so a filter value the API accepts is always an
 * action the database can actually hold. A value outside this list is rejected as a
 * `VALIDATION_FAILED` filter rather than silently matching nothing.
 */
export const AUDIT_REPORT_ACTIONS = [
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_VOIDED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REMOVED',
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'SETTING_UPDATED',
  'CONTRIBUTION_PERIOD_SET',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
] as const;

export type AuditReportAction = (typeof AUDIT_REPORT_ACTIONS)[number];

export function isAuditReportAction(value: unknown): value is AuditReportAction {
  return typeof value === 'string' && (AUDIT_REPORT_ACTIONS as readonly string[]).includes(value);
}

/**
 * The labelled movement and balance projections reused from the dashboard.
 *
 * Re-exported rather than redeclared so a financial-summary report and the dashboard render the
 * identical `label` strings. `REQ-FIN-014` requires the two to be distinguishable, and two
 * independently written labels would eventually drift.
 */
export interface ReportMovementProjection {
  readonly label: typeof PERIOD_MOVEMENT_LABEL;
  readonly income: string;
  readonly expenses: string;
  readonly net: string;
}

export interface ReportBalanceProjection {
  readonly label: typeof AVAILABLE_BALANCE_LABEL;
  readonly asOf: string;
  readonly cash: string;
  readonly upi: string;
  readonly bank: string;
  readonly total: string;
  readonly cumulativeIncome: string;
  readonly cumulativeExpenses: string;
}

/** One calendar month of movement, reused so a report trend matches the dashboard trend. */
export interface ReportTrendPoint {
  readonly month: string;
  readonly year: number;
  readonly monthNumber: number;
  readonly income: string;
  readonly expenses: string;
  readonly movement: string;
}

/**
 * `REQ-REPORT-001` Financial Summary.
 *
 * The same period movement, ending balances, and monthly trend the dashboard shows, exposed under
 * the report route so a printed summary can be produced without the dashboard chrome.
 */
export interface FinancialSummaryReport {
  readonly reportId: 'financial-summary';
  readonly period: DashboardPeriodView;
  readonly movement: ReportMovementProjection;
  readonly availableBalanceForPeriod: string;
  readonly balances: ReportBalanceProjection;
  readonly trend: readonly ReportTrendPoint[];
  readonly currency: typeof CURRENCY;
  readonly generatedAt: string;
}

/** One income-type slice. `transactionCount` is decided by the API, never by the browser. */
export interface ReportBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly amount: string;
  readonly transactionCount: number;
  /** Exact two-decimal share of the report total, so the browser cannot re-derive it. */
  readonly sharePercent: string;
  /** True when `label` is Admin-entered text and must be rendered as plain text. */
  readonly customLabel: boolean;
}

/**
 * The report ids whose projection is a set of labelled slices summing to a period total.
 *
 * Declared as its own union rather than reusing {@link ReportId} because `reportId` is this
 * union's discriminant. Widening it to all eleven ids would make {@link AnyReport} no longer a
 * discriminated union: the browser could not narrow an unknown response to the projection it
 * actually received, so the report screen would have to cast — and a cast in the view is exactly
 * how a report ends up reading one report's fields as another's.
 */
export type BreakdownReportId = 'income' | 'expenses' | 'expense-categories';

/** The report ids whose projection is a bounded list of transactions. Discriminant; see above. */
export type TransactionListReportId = 'offerings' | 'donations';

export interface BreakdownReport {
  readonly reportId: BreakdownReportId;
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  /** The period total the rows sum to, stated so the report can be checked at a glance. */
  readonly total: string;
  readonly rows: readonly ReportBreakdownRow[];
  readonly generatedAt: string;
}

/**
 * `REQ-REPORT-002` Member Contribution.
 *
 * Expected, received, remaining, and status are all present per member-month because the
 * requirement asks for all four. `received` and `remaining` are ledger-derived server-side; the
 * browser never recomputes them.
 */
export interface MemberContributionReportRow {
  readonly memberId: string;
  readonly memberReferenceId: string;
  readonly memberName: string;
  /** `YYYY-MM` for the member-month. */
  readonly month: string;
  readonly year: number;
  readonly monthNumber: number;
  readonly expected: string;
  readonly received: string;
  readonly remaining: string;
  readonly status: ContributionStatus;
}

export interface MemberContributionTotals {
  readonly memberMonths: number;
  readonly paid: number;
  readonly partiallyPaid: number;
  readonly notPaid: number;
  readonly expected: string;
  readonly received: string;
  readonly remaining: string;
}

export interface MemberContributionReport {
  readonly reportId: 'member-contributions';
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  readonly rows: readonly MemberContributionReportRow[];
  readonly totals: MemberContributionTotals;
  readonly generatedAt: string;
}

/**
 * Offering and Donation reports.
 *
 * Both are transaction-list reports over an income type, so they share
 * {@link ReportTransactionRow}. Offering is `OFFERING`; Donation is `DONATION` together with
 * `ANONYMOUS_DONATION`, because `REQ-INCOME-006`'s anonymous donation is a donation and hiding it
 * from the donation report would understate the total.
 */
export interface ReportTransactionRow {
  readonly id: string;
  readonly referenceId: string;
  readonly amount: string;
  readonly currency: typeof CURRENCY;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  readonly description: string | null;
  readonly memberName: string | null;
  readonly memberReferenceId: string | null;
  readonly categoryName: string | null;
  readonly incomeType: IncomeType | null;
  readonly documentCount: number;
  readonly hasAvailableDocument: boolean;
  /**
   * The oldest currently available document, or `null` when none is attached.
   *
   * `REQ-EXPORT-001` asks an export for a useful document reference, so the row carries the same
   * {@link ReportDocumentLink} the Receipt / Document report uses rather than leaving the
   * documented reference columns to be invented downstream. `documentCount` stays the full history,
   * including removed records; this is only what the Admin can open today.
   */
  readonly document: ReportDocumentLink | null;
}

export interface TransactionListReport {
  readonly reportId: TransactionListReportId;
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  readonly total: string;
  readonly transactionCount: number;
  readonly rows: readonly ReportTransactionRow[];
  /**
   * Whether `rows` holds only the first slice of a larger match set.
   *
   * `transactionCount` is always the true count in the period, while `rows` is bounded so a wide
   * period cannot return an unbounded document to the Admin's browser or an unbounded CSV. When
   * this is `true` the screen must say so, and the CSV must say so in its filename or a note —
   * `REQ-EXPORT-001` treats a quietly shortened export as a wrong figure, because a total beside
   * a partial list reads as if it described the whole list.
   *
   * A truncated report offers a narrower period rather than a "download everything" path, so the
   * Admin gets a complete document by choosing a period, not by trusting a partial one.
   */
  readonly rowsTruncated: boolean;
  readonly generatedAt: string;
}

/**
 * `REQ-FIN-012` Payment Method report.
 *
 * `movement` is the signed income-minus-expense within the period; `balance` is the ending
 * balance through the period end and therefore includes earlier months. They are separate labelled
 * fields because conflating them is exactly the confusion `REQ-FIN-014` forbids.
 */
export interface PaymentMethodReportRow {
  readonly paymentMethod: PaymentMethod;
  readonly label: string;
  readonly income: string;
  readonly expenses: string;
  readonly movement: string;
  readonly balance: string;
}

export interface PaymentMethodReport {
  readonly reportId: 'payment-methods';
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  readonly movementLabel: typeof PERIOD_MOVEMENT_LABEL;
  readonly balanceLabel: typeof AVAILABLE_BALANCE_LABEL;
  readonly rows: readonly PaymentMethodReportRow[];
  readonly totalMovement: string;
  readonly totalBalance: string;
  readonly generatedAt: string;
}

/**
 * The document states a Receipt / Document report distinguishes.
 *
 * `AVAILABLE` and `REMOVED` are the `transaction_document.status` values. `VOIDED` is not a stored
 * document status — it is the report's word for a document whose transaction is voided — which is
 * why it is a derived report state rather than a database column. It is reported only for
 * authorized historical rows, so an active report never presents a voided transaction's receipt as
 * currently attached.
 */
export const REPORT_DOCUMENT_STATES = ['AVAILABLE', 'REMOVED', 'VOIDED'] as const;

export type ReportDocumentState = (typeof REPORT_DOCUMENT_STATES)[number];

/**
 * A local document reference whose reachability is reported as data.
 *
 * `REQ-EXPORT-002`: a local document link is valid only while the local application is reachable.
 * `locallyReachable` is sent as an explicit boolean rather than implied by the presence of a path,
 * and `accessNote` states the same in words for the CSV column, so neither the screen nor an
 * exported sheet can present a `file://`-style path as a permanent public link.
 */
export interface ReportDocumentLink {
  readonly documentId: string;
  readonly referenceId: string;
  readonly originalFilename: string;
  /** The project-local relative path the storage adapter wrote, or `null` once removed. */
  readonly storagePath: string | null;
  readonly locallyReachable: boolean;
  readonly accessNote: string;
}

export interface ReportDocumentRow {
  readonly documentId: string;
  readonly referenceId: string;
  readonly state: ReportDocumentState;
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly uploadedAt: string;
  readonly transactionId: string;
  readonly transactionReferenceId: string;
  readonly transactionType: TransactionType;
  readonly amount: string;
  readonly businessDate: string;
  readonly memberName: string | null;
  readonly link: ReportDocumentLink;
}

export interface DocumentReport {
  readonly reportId: 'documents';
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  readonly rows: readonly ReportDocumentRow[];
  readonly counts: Readonly<Record<ReportDocumentState, number>>;
  readonly generatedAt: string;
}

/** One audit history row for the Audit report. `before`/`after` are flattened snapshots. */
export interface AuditReportRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityReference: string | null;
  readonly actorDisplayName: string | null;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export interface AuditReport {
  readonly reportId: 'audit';
  /**
   * The audit report is history, so its window is explicit `from`/`to`, not a period preset.
   *
   * A bound that was not supplied is `null`, not an empty string. An open-ended history read is a
   * real, different query from "the empty instant", and a client rendering a filter must be able to
   * tell those apart.
   */
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly action: AuditReportAction | null;
  readonly rows: readonly AuditReportRow[];
  readonly pagination: ApiPagination;
  readonly generatedAt: string;
}

/**
 * One Complete Transaction row.
 *
 * The shared {@link TransactionSummary} plus the same {@link ReportDocumentLink} the Offering and
 * Donation rows carry, so `transactions` can fill its documented document columns from the read that
 * already loaded the documents instead of leaving them blank (`REQ-EXPORT-001`). It is a widening
 * rather than a new shape, so every consumer of `TransactionSummary` keeps reading this report.
 */
export interface CompleteTransactionReportRow extends TransactionSummary {
  readonly document: ReportDocumentLink | null;
}

/** `REQ-REPORT-001` Complete Transaction — the history report, so voided rows are retained. */
export interface CompleteTransactionReport {
  readonly reportId: 'transactions';
  readonly period: DashboardPeriodView;
  readonly currency: typeof CURRENCY;
  readonly type: TransactionType | null;
  readonly status: TransactionStatus | null;
  readonly total: string;
  readonly transactionCount: number;
  readonly rows: readonly CompleteTransactionReportRow[];
  readonly pagination: ApiPagination;
  readonly generatedAt: string;
}

/** The union every report route can return, used by the CSV exporter and the report picker. */
export type AnyReport =
  | FinancialSummaryReport
  | BreakdownReport
  | MemberContributionReport
  | TransactionListReport
  | PaymentMethodReport
  | DocumentReport
  | AuditReport
  | CompleteTransactionReport;

/**
 * `REQ-SEARCH-001` / `REQ-SEARCH-002` search scope.
 *
 * `all` searches both kinds; the two explicit values let the Admin restrict to members or to
 * transactions. These are the only three accepted values, so `type` cannot be used to smuggle an
 * arbitrary filter into a query.
 */
export const SEARCH_TYPES = ['all', 'member', 'transaction'] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export function isSearchType(value: unknown): value is SearchType {
  return typeof value === 'string' && (SEARCH_TYPES as readonly string[]).includes(value);
}

/** One member match. A member carries no money, so there is no amount to show. */
export interface SearchMemberResult {
  readonly kind: 'member';
  readonly id: string;
  readonly referenceId: string;
  readonly name: string;
  readonly phone: string | null;
}

/** One transaction match, reusing the canonical transaction summary shape. */
export interface SearchTransactionResult {
  readonly kind: 'transaction';
  readonly transaction: TransactionSummary;
}

export type SearchResult = SearchMemberResult | SearchTransactionResult;

export interface GlobalSearchResponse {
  /** The trimmed term the results correspond to, echoed so the screen shows what was searched. */
  readonly query: string;
  readonly type: SearchType;
  readonly results: readonly SearchResult[];
  readonly pagination: ApiPagination;
}

/** The CSV media type, including the charset so a spreadsheet reads the rupee values as UTF-8. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/** The header a CSV download is served with, so a browser saves rather than renders the file. */
export const CSV_CONTENT_DISPOSITION = 'attachment';

/**
 * The documented CSV columns per report, in order.
 *
 * `docs/06-API-SPEC.md` requires the export to use "documented columns", so the columns are part
 * of the shared contract rather than an inline array in the exporter. Amount columns are plain
 * exact decimal strings; `REQ-EXPORT-001` asks for useful financial fields, and this is the list
 * that satisfies it.
 *
 * `offerings`, `donations`, `transactions`, and `documents` end with the document-reference columns,
 * satisfying `REQ-EXPORT-001`'s "useful document reference or link where applicable". Each of those
 * columns is filled from the row's `document` link, so a declared column is never a permanently
 * blank one. The link column's header and values state the `REQ-EXPORT-002` reachability rule in
 * words so an exported sheet never implies a permanent public URL.
 */
export const REPORT_CSV_COLUMNS: Readonly<Record<ReportId, readonly string[]>> = {
  'financial-summary': ['Metric', 'Amount (INR)'],
  income: ['Income Type', 'Amount (INR)', 'Transactions', 'Share'],
  expenses: ['Expense Category', 'Amount (INR)', 'Transactions', 'Share'],
  'member-contributions': [
    'Member ID',
    'Member Name',
    'Month',
    'Expected (INR)',
    'Received (INR)',
    'Remaining (INR)',
    'Status',
  ],
  offerings: [
    'Reference',
    'Business Date',
    'Amount (INR)',
    'Payment Method',
    'Member',
    'Description',
    'Document Reference',
    'Document Link (local application only)',
  ],
  donations: [
    'Reference',
    'Business Date',
    'Amount (INR)',
    'Payment Method',
    'Member',
    'Description',
    'Document Reference',
    'Document Link (local application only)',
  ],
  'payment-methods': [
    'Payment Method',
    'Income (INR)',
    'Expenses (INR)',
    'Movement (INR)',
    'Balance (INR)',
  ],
  'expense-categories': ['Expense Category', 'Amount (INR)', 'Transactions', 'Share'],
  documents: [
    'Document Reference',
    'Filename',
    'State',
    'Bytes',
    'Type',
    'Uploaded At (IST)',
    'Transaction Reference',
    'Transaction Amount (INR)',
    'Business Date',
    'Member',
    'Document Link (local application only)',
  ],
  audit: [
    'Event ID',
    'Action',
    'Entity Type',
    'Entity Reference',
    'Actor',
    'Occurred At (IST)',
    'Reason',
    'Request ID',
  ],
  transactions: [
    'Reference',
    'Type',
    'Income Type',
    'Amount (INR)',
    'Payment Method',
    'Status',
    'Business Date',
    'Member',
    'Category',
    'Description',
    'Void Reason',
    'Document Reference',
    'Document Link (local application only)',
  ],
};

/** The largest number of rows one CSV export may contain. */
export const CSV_EXPORT_MAX_ROWS = 10_000;

/** The largest free-text search term the API accepts, in characters. */
export const SEARCH_QUERY_MAX_LENGTH = 120;
