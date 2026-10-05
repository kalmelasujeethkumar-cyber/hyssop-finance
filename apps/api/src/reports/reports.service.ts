import { Injectable } from '@nestjs/common';
import {
  AVAILABLE_BALANCE_LABEL,
  ANONYMOUS_DONATION_DESCRIPTION,
  CURRENCY,
  isAnonymousIncomeType,
  PAYMENT_METHOD_LABELS,
  PERIOD_MOVEMENT_LABEL,
  SEARCH_QUERY_MAX_LENGTH,
  type AuditReportAction,
  type AuditReport,
  type AuditReportRow,
  type BreakdownReport,
  type CompleteTransactionReport,
  type CompleteTransactionReportRow,
  type DocumentReport,
  type FinancialSummaryReport,
  type GlobalSearchResponse,
  type MemberContributionReport,
  type MemberContributionReportRow,
  type PaymentMethodReport,
  type ReportBreakdownRow,
  type ReportDocumentLink,
  type ReportDocumentRow,
  type ReportDocumentState,
  type ReportTransactionRow,
  type SearchMemberResult,
  type SearchResult,
  type SearchTransactionResult,
  type SearchType,
  type TransactionListReport,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { formatPaise } from '../common/money/paise';
import { BUSINESS_TIMEZONE, formatBusinessDate } from '../common/time/business-date';
import {
  CONTRIBUTION_BUCKET_MAX_ROWS,
  ContributionPeriodRepository,
} from '../database/contributions/contribution-period.repository';
import { deriveContributionStatus } from '../database/contributions/contribution-status';
import { MemberRepository } from '../database/members/member.repository';
import {
  ReconciliationService,
  reportablePaymentMethods,
} from '../database/reconciliation/reconciliation.service';
import { TransactionRepository } from '../database/transactions/transaction.repository';
import { AuditEventRepository } from '../database/audit/audit-event.repository';
import { toTransactionSummary } from '../transactions/transaction-mapper';
import {
  assertSpanWithinLimit,
  calendarMonthsOf,
  monthKeyRangeOf,
  periodLabel,
  type CalendarMonth,
  type ResolvedPeriod,
} from '../dashboard/period.resolver';
import {
  DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT,
  list,
  type DashboardPeriodView,
  type ReportBalanceProjection,
  type ReportMovementProjection,
  type ReportTrendPoint,
} from '@hyssop/contracts';
import type { TransactionType, IncomeType, PaymentMethod } from '@prisma/client';

/** The page size used by report list views that are not separately paged. */
const REPORT_ROW_LIMIT = 1000;

export interface ReportPage {
  readonly page: number;
  readonly pageSize: number;
}

export interface TransactionReportFilters {
  readonly type?: TransactionType;
  readonly status?: 'ACTIVE' | 'VOIDED';
}

export interface AuditReportFilters {
  readonly from?: Date;
  readonly to?: Date;
  readonly action?: AuditReportAction;
  readonly page: ReportPage;
}

export interface SearchFilters {
  readonly term: string;
  readonly type: SearchType;
  readonly page: ReportPage;
}

const UNCATEGORIZED_LABEL = 'Uncategorised';
const DOCUMENT_ACCESS_NOTE =
  'Valid only while this local application is running at the same address.';

/**
 * The Phase 09 reports and global search.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the canonical calculation layer is server-side,
 * integer-based, and derived from persisted data; this service is a *projection* over it, never a
 * second implementation. Authority: `docs/01-REQUIREMENTS.md` `REQ-REPORT-001` to `REQ-REPORT-004`,
 * `REQ-SEARCH-001`, `REQ-SEARCH-002`, `REQ-EXPORT-001`, `REQ-EXPORT-002`.
 *
 * Every figure here is produced by `ReconciliationService` (the same SQL the dashboard uses) or by
 * a repository read that already exists. The service only formats those `bigint` results into the
 * exact decimal strings the contract requires. It never computes a financial total from rows it
 * fetched, and it never leaves arithmetic to the browser.
 *
 * **Voided handling is per report, not global.** Active financial reports filter `status =
 * 'ACTIVE'` in their underlying query; the Complete Transaction and Audit reports deliberately do
 * not. That decision is owned by `REPORT_EXCLUDES_VOIDED` in the shared contract so the report
 * screen, its CSV, and its print header cannot disagree about what a total counts.
 */
@Injectable()
export class ReportsService {
  public constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly transactionRepo: TransactionRepository,
    private readonly memberRepo: MemberRepository,
    private readonly contributionRepo: ContributionPeriodRepository,
    private readonly auditRepo: AuditEventRepository,
  ) {}

  /** The `Financial Summary` report: period movement, ending balances, and the monthly trend. */
  public async financialSummary(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<FinancialSummaryReport> {
    assertPeriodSpan(period);

    const months = calendarMonthsOf(period);

    const [movementTotals, balances, trendRows] = await Promise.all([
      this.reconciliation.periodTotals(period.from, period.to),
      this.reconciliation.endingBalancesThrough(period.to),
      this.reconciliation.monthlyTrend(period.from, period.to),
    ]);

    return {
      reportId: 'financial-summary',
      period: periodView(period),
      movement: movementProjection(movementTotals.incomePaise, movementTotals.expensePaise),
      availableBalanceForPeriod: formatPaise(movementTotals.movementPaise),
      balances: balanceProjectionOf(balances, period),
      trend: trendPointsOf(trendRows, months),
      currency: CURRENCY,
      generatedAt: now.toISOString(),
    };
  }

  /** The `Income` report: active income per income type with counts and exact shares. */
  public async income(period: ResolvedPeriod, now: Date = new Date()): Promise<BreakdownReport> {
    assertPeriodSpan(period);

    const rows = await this.reconciliation.incomeReport(period.from, period.to);

    return {
      reportId: 'income',
      period: periodView(period),
      currency: CURRENCY,
      total: formatPaise(rows.reduce((sum, row) => sum + row.amountPaise, 0n)),
      rows: toBreakdownRows(
        rows.map((row) => ({
          key: row.incomeType,
          label: row.incomeType,
          amountPaise: row.amountPaise,
          transactionCount: row.transactionCount,
          // `income_type` is a closed enum, so its label is not Admin-entered text.
          customLabel: false,
        })),
      ),
      generatedAt: now.toISOString(),
    };
  }

  /** The `Expense` report: active expenses per category with counts and exact shares. */
  public async expenses(period: ResolvedPeriod, now: Date = new Date()): Promise<BreakdownReport> {
    assertPeriodSpan(period);

    const rows = await this.reconciliation.expenseReport(period.from, period.to);

    return {
      reportId: 'expenses',
      period: periodView(period),
      currency: CURRENCY,
      total: formatPaise(rows.reduce((sum, row) => sum + row.amountPaise, 0n)),
      rows: toBreakdownRows(
        rows.map((row) => ({
          key: row.categoryId,
          label: row.categoryName ?? UNCATEGORIZED_LABEL,
          amountPaise: row.amountPaise,
          transactionCount: row.transactionCount,
          // An expense category is Admin-entered text, so the browser renders it as plain text.
          customLabel: true,
        })),
      ),
      generatedAt: now.toISOString(),
    };
  }

  /** The `Expense Category` report — the same category projection as the Expense report. */
  public async expenseCategories(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<BreakdownReport> {
    const report = await this.expenses(period, now);

    return { ...report, reportId: 'expense-categories' };
  }

  /** The `Offering` report: active `OFFERING` income rows in the period. */
  public async offerings(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<TransactionListReport> {
    return this.incomeTypeReport('offerings', ['OFFERING'], period, now);
  }

  /** The `Donation` report: active `DONATION` *and* `ANONYMOUS_DONATION` rows in the period. */
  public async donations(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<TransactionListReport> {
    return this.incomeTypeReport('donations', ['DONATION', 'ANONYMOUS_DONATION'], period, now);
  }

  /**
   * `REQ-REPORT-002` Member Contribution: expected, received, remaining, and status per member-month.
   *
   * `received` and `remaining` come from the derived `MEMBER_CONTRIBUTION` sum in the repository,
   * and `status` is applied by the single authority `deriveContributionStatus`, so this report and
   * the dashboard can never classify the same member-month differently.
   */
  public async memberContributions(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<MemberContributionReport> {
    assertPeriodSpan(period);

    const months = monthKeyRangeOf(period);
    const rows = await this.contributionRepo.reportRowsByMonthRange(months.fromKey, months.toKey);

    // The repository returns one row past its cap so a truncated read is detected here. Counting
    // a partial set would understate the report, which is a wrong number rather than a missing one.
    if (rows.length > CONTRIBUTION_BUCKET_MAX_ROWS) {
      throw validationFailed(
        'Too many member contribution months cover this period. Choose a shorter date range.',
        { field: 'period' },
      );
    }

    let paid = 0;
    let partiallyPaid = 0;
    let notPaid = 0;
    let expectedTotal = 0n;
    let receivedTotal = 0n;

    const projected: MemberContributionReportRow[] = rows.map((row) => {
      const status = deriveContributionStatus(row.expectedPaise, row.receivedPaise);
      expectedTotal += row.expectedPaise;
      receivedTotal += row.receivedPaise;

      if (status === 'PAID') {
        paid += 1;
      } else if (status === 'PARTIALLY PAID') {
        partiallyPaid += 1;
      } else {
        notPaid += 1;
      }

      return {
        memberId: row.memberId,
        memberReferenceId: row.memberReferenceId,
        memberName: row.memberName,
        month: `${String(row.year).padStart(4, '0')}-${String(row.month).padStart(2, '0')}`,
        year: row.year,
        monthNumber: row.month,
        expected: formatPaise(row.expectedPaise),
        received: formatPaise(row.receivedPaise),
        remaining: formatPaise(remainingOf(row.expectedPaise, row.receivedPaise)),
        status,
      };
    });

    return {
      reportId: 'member-contributions',
      period: periodView(period),
      currency: CURRENCY,
      rows: projected,
      totals: {
        memberMonths: projected.length,
        paid,
        partiallyPaid,
        notPaid,
        expected: formatPaise(expectedTotal),
        received: formatPaise(receivedTotal),
        remaining: formatPaise(remainingOf(expectedTotal, receivedTotal)),
      },
      generatedAt: now.toISOString(),
    };
  }

  /** The `Payment Method` report: period movement *and* ending balance per method, separately labelled. */
  public async paymentMethods(
    period: ResolvedPeriod,
    now: Date = new Date(),
  ): Promise<PaymentMethodReport> {
    assertPeriodSpan(period);

    const [movementRows, balanceRows] = await Promise.all([
      this.reconciliation.methodMovement(period.from, period.to),
      this.reconciliation.methodBalancesThrough(period.to),
    ]);

    const balanceByMethod = new Map(balanceRows.map((row) => [row.paymentMethod, row.amountPaise]));

    // Every method is reported, including one with no activity, so a pastor can see Cash, UPI,
    // and Bank every time rather than a method silently disappearing when it was unused.
    const rows = reportablePaymentMethods().map((method) => {
      const movement = movementRows.find((row) => row.paymentMethod === method);
      const incomePaise = movement?.incomePaise ?? 0n;
      const expensePaise = movement?.expensePaise ?? 0n;

      return {
        paymentMethod: method,
        label: PAYMENT_METHOD_LABELS[method],
        income: formatPaise(incomePaise),
        expenses: formatPaise(expensePaise),
        movement: formatPaise(incomePaise - expensePaise),
        balance: formatPaise(balanceByMethod.get(method) ?? 0n),
      };
    });

    return {
      reportId: 'payment-methods',
      period: periodView(period),
      currency: CURRENCY,
      movementLabel: PERIOD_MOVEMENT_LABEL,
      balanceLabel: AVAILABLE_BALANCE_LABEL,
      rows,
      totalMovement: formatPaise(movementRows.reduce((sum, row) => sum + row.movementPaise, 0n)),
      totalBalance: formatPaise(balanceRows.reduce((sum, row) => sum + row.amountPaise, 0n)),
      generatedAt: now.toISOString(),
    };
  }

  /** The `Receipt / Document` report, distinguishing `AVAILABLE`, `REMOVED`, and `VOIDED`. */
  public async documents(period: ResolvedPeriod, now: Date = new Date()): Promise<DocumentReport> {
    assertPeriodSpan(period);

    const rows = await this.reconciliation.documentsReport(period.from, period.to);

    const counts: Record<ReportDocumentState, number> = { AVAILABLE: 0, REMOVED: 0, VOIDED: 0 };
    for (const row of rows) {
      counts[row.state] += 1;
    }

    const projected: ReportDocumentRow[] = rows.map((row) => ({
      documentId: row.documentId,
      referenceId: row.documentReferenceId,
      state: row.state,
      originalFilename: row.originalFilename,
      byteSize: row.byteSize,
      mimeType: row.detectedMimeType,
      uploadedAt: row.uploadedAt.toISOString(),
      transactionId: row.transactionId,
      transactionReferenceId: row.transactionReferenceId,
      transactionType: row.transactionType as TransactionType,
      amount: formatPaise(row.amountPaise),
      businessDate: formatBusinessDate(row.businessDate),
      memberName: row.memberName,
      link: {
        documentId: row.documentId,
        referenceId: row.documentReferenceId,
        originalFilename: row.originalFilename,
        // The authenticated download route, not the storage key. The storage key is where bytes live
        // inside the local storage adapter, which is an internal detail the browser must never learn
        // — it would expose the on-disk layout and, if it were ever reused by a non-local adapter,
        // an object-store path. `DocumentsService` already guards these routes with the session and
        // the ownership rules, so pointing at them gives the link its own access control instead of
        // handing out a file path.
        storagePath: `/api/v1/documents/${row.documentId}/download`,
        // `REQ-EXPORT-002`: a local link is only usable while the bytes exist *and* the local app
        // is running. A removed or storage-deleted document reports `false`, so the screen and the
        // CSV never offer a link that cannot open.
        locallyReachable: row.state === 'AVAILABLE' && row.storageKey !== null,
        accessNote: DOCUMENT_ACCESS_NOTE,
      },
    }));

    return {
      reportId: 'documents',
      period: periodView(period),
      currency: CURRENCY,
      rows: projected,
      counts,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * The `Audit` report: the Admin-wide, newest-first history, optionally filtered.
   *
   * This is a history read, so it retains voided-era events by design. `occurred_at` is a real
   * instant, and the window is an explicit `from`/`to` rather than a period preset.
   */
  public async audit(filters: AuditReportFilters, now: Date = new Date()): Promise<AuditReport> {
    const filter = {
      ...(filters.from === undefined ? {} : { from: filters.from }),
      ...(filters.to === undefined ? {} : { to: filters.to }),
      ...(filters.action === undefined ? {} : { action: filters.action }),
    };

    const [records, totalItems] = await Promise.all([
      this.auditRepo.listHistory(filter, {
        limit: filters.page.pageSize,
        offset: (filters.page.page - 1) * filters.page.pageSize,
      }),
      this.auditRepo.countHistory(filter),
    ]);

    const rows: AuditReportRow[] = records.map((record) => ({
      id: record.id,
      action: record.action,
      entityType: record.entityType,
      entityReference: record.entityReference,
      actorDisplayName: record.actorDisplayName,
      occurredAt: record.occurredAt.toISOString(),
      reason: record.reason,
      requestId: record.requestId,
      before: record.before,
      after: record.after,
    }));

    const pagination = list([], {
      page: filters.page.page,
      pageSize: filters.page.pageSize,
      totalItems,
    }).pagination;

    return {
      reportId: 'audit',
      range: {
        from: filters.from === undefined ? null : filters.from.toISOString(),
        to: filters.to === undefined ? null : filters.to.toISOString(),
      },
      action: filters.action ?? null,
      rows,
      pagination,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * The `Complete Transaction` report: the history report, retaining voided rows.
   *
   * The rows are the canonical `TransactionSummary`, mapped through the same mapper the income and
   * expense screens use, so an anonymous donation is stripped of identity here exactly as it is
   * there (`REQ-INCOME-006`). Each row is widened with the attached document the same repository
   * read already loaded, because the export's documented document columns must name a document the
   * Admin can open rather than stay blank (`REQ-EXPORT-001`).
   */
  public async transactions(
    period: ResolvedPeriod,
    filters: TransactionReportFilters,
    page: ReportPage,
    now: Date = new Date(),
  ): Promise<CompleteTransactionReport> {
    assertPeriodSpan(period);

    const query = {
      ...(filters.type === undefined ? {} : { transactionType: filters.type }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      from: period.from,
      to: period.to,
    };

    const [rows, totalItems, totalPaise] = await Promise.all([
      this.transactionRepo.list(query, {
        limit: page.pageSize,
        offset: (page.page - 1) * page.pageSize,
        sort: 'businessDate',
        direction: 'desc',
      }),
      this.transactionRepo.countMatching(query),
      this.transactionRepo.sumMatching(query),
    ]);

    const summaries: CompleteTransactionReportRow[] = rows.map((row) => ({
      ...toTransactionSummary(row),
      document: toAttachedDocumentLink(row.documents[0]),
    }));

    const pagination = list([], {
      page: page.page,
      pageSize: page.pageSize,
      totalItems,
    }).pagination;

    return {
      reportId: 'transactions',
      period: periodView(period),
      currency: CURRENCY,
      type: filters.type ?? null,
      status: filters.status ?? null,
      total: formatPaise(totalPaise),
      transactionCount: totalItems,
      rows: summaries,
      pagination,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * `REQ-SEARCH-001` / `REQ-SEARCH-002` global search across members and transactions.
   *
   * Free text is bounded to names, IDs, references, categories, and types (the repository searches
   * exactly those fields and never `notes`). Results are paginated and deterministically ordered,
   * and every row comes from authorized server data.
   */
  public async search(filters: SearchFilters): Promise<GlobalSearchResponse> {
    const term = filters.term.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);

    if (term.length === 0) {
      throw validationFailed('Enter something to search for.', { field: 'q' });
    }

    const wantsMembers = filters.type === 'all' || filters.type === 'member';
    const wantsTransactions = filters.type === 'all' || filters.type === 'transaction';

    const memberTotal = wantsMembers ? await this.memberRepo.countMatching(term) : 0;
    const transactionTotal = wantsTransactions
      ? await this.transactionRepo.countSearchGlobally(term)
      : 0;
    const totalItems = memberTotal + transactionTotal;

    // Global search merges two independent result sets. The window is computed arithmetically
    // against a fixed order — every matching member, in member order, followed by every matching
    // transaction, in transaction order — rather than by asking each source for a full page and
    // concatenating.
    //
    // The alternative, fetching `pageSize` of each and appending, would return up to twice the
    // requested page size, would repeat or skip rows as the page advanced (page 2 asking each source
    // for rows 2..N+1 assumes each source is fully drained by page 1, which it is not), and would
    // make `totalItems` disagree with the rows on screen. A search result list is a page of a single
    // ordered list, so the arithmetic below is what makes it one.
    const { page, pageSize } = filters.page;
    const offset = (page - 1) * pageSize;
    const windowEnd = offset + pageSize;

    const memberFrom = Math.min(offset, memberTotal);
    const memberTo = Math.min(windowEnd, memberTotal);
    const memberLimit = Math.max(0, memberTo - memberFrom);

    // The transaction block begins at `memberTotal` in the merged order. Both ends are clamped to
    // `transactionTotal`: a page far past the end of the results must ask for zero rows rather than
    // for a full page starting beyond the last match.
    const transactionFrom = Math.min(Math.max(0, offset - memberTotal), transactionTotal);
    const transactionTo = Math.min(Math.max(0, windowEnd - memberTotal), transactionTotal);
    const transactionLimit = Math.max(0, transactionTo - transactionFrom);

    const [members, transactions] = await Promise.all([
      memberLimit === 0
        ? Promise.resolve([] as const)
        : this.memberRepo.search({ search: term, limit: memberLimit, offset: memberFrom }),
      transactionLimit === 0
        ? Promise.resolve([] as const)
        : this.transactionRepo.searchGlobally(term, {
            limit: transactionLimit,
            offset: transactionFrom,
          }),
    ]);

    const results: SearchResult[] = [
      ...members.map((member): SearchMemberResult => ({
        kind: 'member',
        id: member.id,
        referenceId: member.referenceId,
        name: member.name,
        phone: member.phone,
      })),
      ...transactions.map((row): SearchTransactionResult => ({
        kind: 'transaction',
        // The canonical mapper, so the anonymous-donation privacy rule applies here too.
        transaction: toTransactionSummary(row),
      })),
    ];

    return {
      query: term,
      type: filters.type,
      results,
      pagination: list([], { page, pageSize, totalItems }).pagination,
    };
  }

  /** Shared by the Offering and Donation reports. */
  private async incomeTypeReport(
    reportId: 'offerings' | 'donations',
    incomeTypes: readonly IncomeType[],
    period: ResolvedPeriod,
    now: Date,
  ): Promise<TransactionListReport> {
    assertPeriodSpan(period);

    const range = { from: period.from, to: period.to };

    const [rows, totalPaise, transactionCount] = await Promise.all([
      this.transactionRepo.listReportIncome(incomeTypes, range, {
        limit: REPORT_ROW_LIMIT,
        offset: 0,
      }),
      this.transactionRepo.sumReportIncome(incomeTypes, range),
      this.transactionRepo.countReportIncome(incomeTypes, range),
    ]);

    return {
      reportId,
      period: periodView(period),
      currency: CURRENCY,
      // `total` and `transactionCount` describe the whole period. `rows` is a bounded slice of it,
      // so when the two disagree the screen and the CSV must say so rather than present a partial
      // list beside a complete total as though they matched.
      total: formatPaise(totalPaise),
      transactionCount,
      rows: rows.map(toReportTransactionRow),
      rowsTruncated: transactionCount > rows.length,
      generatedAt: now.toISOString(),
    };
  }
}

/**
 * The one place a report period is checked against the canonical span limit.
 *
 * `DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT` belongs to the period resolver, and the dashboard already
 * refuses a wider range than that. A report must not be the one screen that accepts it: the same
 * period would then be readable on the dashboard and rejected here, and an unbounded range would
 * ask PostgreSQL to aggregate years of `financial_transaction` in a single request. Every
 * period-bounded report therefore calls this instead of repeating the check, so the limit cannot be
 * applied to some reports and forgotten on others.
 */
function assertPeriodSpan(period: ResolvedPeriod): void {
  assertSpanWithinLimit(period, DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT);
}

/**
 * The attached document a transaction row names, as a {@link ReportDocumentLink}.
 *
 * `REQ-EXPORT-002` makes reachability reported data rather than an implied permanent URL, and the
 * Offering and Donation exports carry this link in their documented document columns, so the same
 * wording and the same honest path are used there as in the Receipt / Document report.
 *
 * `status` is deliberately absent: `TRANSACTION_LIST_INCLUDE` already restricts `documents` to
 * `AVAILABLE` rows and orders them, so only the stored bytes decide whether the Admin can open the
 * file. The Receipt / Document report keeps its own `state === 'AVAILABLE'` test because it must
 * also project `REMOVED` and `VOIDED` documents.
 */
function toAttachedDocumentLink(
  document:
    | {
        readonly id: string;
        readonly referenceId: string;
        readonly originalFilename: string;
        readonly storageKey: string | null;
      }
    | undefined,
): ReportDocumentLink | null {
  if (document === undefined) {
    return null;
  }

  return {
    documentId: document.id,
    referenceId: document.referenceId,
    originalFilename: document.originalFilename,
    storagePath: `/api/v1/documents/${document.id}/download`,
    locallyReachable: document.storageKey !== null,
    accessNote: DOCUMENT_ACCESS_NOTE,
  };
}

function toReportTransactionRow(row: {
  readonly id: string;
  readonly referenceId: string;
  readonly amountPaise: bigint;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: Date;
  readonly description: string | null;
  readonly incomeType: IncomeType | null;
  readonly member: { readonly referenceId: string; readonly name: string } | null;
  readonly category: { readonly name: string } | null;
  readonly documents: readonly {
    readonly id: string;
    readonly referenceId: string;
    readonly originalFilename: string;
    readonly storageKey: string | null;
  }[];
  readonly _count: { readonly documents: number };
}): ReportTransactionRow {
  // The same predicate the canonical mapper and the income screen use, so this report cannot decide
  // independently which donations are anonymous.
  const anonymous = row.incomeType !== null && isAnonymousIncomeType(row.incomeType);

  return {
    id: row.id,
    referenceId: row.referenceId,
    amount: formatPaise(row.amountPaise),
    currency: CURRENCY,
    paymentMethod: row.paymentMethod,
    businessDate: formatBusinessDate(row.businessDate),
    // An anonymous donation is stripped of identity-bearing text on the way out.
    description: anonymous ? ANONYMOUS_DONATION_DESCRIPTION : row.description,
    memberName: anonymous || row.member === null ? null : row.member.name,
    memberReferenceId: anonymous || row.member === null ? null : row.member.referenceId,
    categoryName: row.category?.name ?? null,
    incomeType: row.incomeType,
    documentCount: row._count.documents,
    hasAvailableDocument: row.documents.length > 0,
    document: toAttachedDocumentLink(row.documents[0]),
  };
}

function remainingOf(expectedPaise: bigint, receivedPaise: bigint): bigint {
  const remaining = expectedPaise - receivedPaise;

  return remaining > 0n ? remaining : 0n;
}

function toBreakdownRows(
  rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly amountPaise: bigint;
    readonly transactionCount: number;
    readonly customLabel: boolean;
  }[],
): readonly ReportBreakdownRow[] {
  const total = rows.reduce((sum, row) => sum + row.amountPaise, 0n);

  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    amount: formatPaise(row.amountPaise),
    transactionCount: row.transactionCount,
    sharePercent: sharePercentOf(row.amountPaise, total),
    customLabel: row.customLabel,
  }));
}

/**
 * Exact `amount / total` as a two-decimal percentage string, in `bigint`.
 *
 * Reuses the dashboard's approach so a report share and a dashboard slice can never disagree.
 */
function sharePercentOf(amountPaise: bigint, totalPaise: bigint): string {
  if (totalPaise === 0n) {
    return '0.00';
  }

  const scaled = (amountPaise * 10_000n + totalPaise / 2n) / totalPaise;
  const whole = scaled / 100n;
  const fractional = scaled % 100n;

  return `${whole.toString()}.${fractional.toString().padStart(2, '0')}`;
}

function periodView(period: ResolvedPeriod): DashboardPeriodView {
  return {
    preset: period.kind,
    label: periodLabel(period),
    from: formatBusinessDate(period.from),
    to: formatBusinessDate(period.to),
    timezone: BUSINESS_TIMEZONE,
  };
}

function movementProjection(incomePaise: bigint, expensePaise: bigint): ReportMovementProjection {
  return {
    label: PERIOD_MOVEMENT_LABEL,
    income: formatPaise(incomePaise),
    expenses: formatPaise(expensePaise),
    net: formatPaise(incomePaise - expensePaise),
  };
}

function balanceProjectionOf(
  balances: {
    readonly availablePaise: bigint;
    readonly byMethod: Readonly<Record<PaymentMethod, bigint>>;
    readonly incomePaise: bigint;
    readonly expensePaise: bigint;
  },
  period: ResolvedPeriod,
): ReportBalanceProjection {
  return {
    label: AVAILABLE_BALANCE_LABEL,
    asOf: formatBusinessDate(period.to),
    cash: formatPaise(balances.byMethod.CASH),
    upi: formatPaise(balances.byMethod.UPI),
    bank: formatPaise(balances.byMethod.BANK_TRANSFER),
    total: formatPaise(balances.availablePaise),
    cumulativeIncome: formatPaise(balances.incomePaise),
    cumulativeExpenses: formatPaise(balances.expensePaise),
  };
}

function trendPointsOf(
  rows: readonly {
    readonly year: number;
    readonly month: number;
    readonly incomePaise: bigint;
    readonly expensePaise: bigint;
  }[],
  months: readonly CalendarMonth[],
): readonly ReportTrendPoint[] {
  const byMonth = new Map<number, { incomePaise: bigint; expensePaise: bigint }>();

  for (const row of rows) {
    byMonth.set(row.year * 100 + row.month, {
      incomePaise: row.incomePaise,
      expensePaise: row.expensePaise,
    });
  }

  return months.map((month) => {
    const found = byMonth.get(month.year * 100 + month.month);
    const incomePaise = found?.incomePaise ?? 0n;
    const expensePaise = found?.expensePaise ?? 0n;

    return {
      month: `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`,
      year: month.year,
      monthNumber: month.month,
      income: formatPaise(incomePaise),
      expenses: formatPaise(expensePaise),
      movement: formatPaise(incomePaise - expensePaise),
    };
  });
}
