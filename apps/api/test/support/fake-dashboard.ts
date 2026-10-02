import type {
  CategoryBreakdownRow,
  DocumentReportRow,
  ExpenseCategoryReportRow,
  IncomeTypeBreakdownRow,
  IncomeTypeReportRow,
  MethodBreakdownRow,
  MethodMovementRow,
  MonthlyTrendRow,
  NamedCategoryBreakdownRow,
  PeriodTotals,
  RecentTransactionRow,
  ReportDocumentState,
} from '../../src/database/reconciliation/reconciliation.service';
import type { FakeMember, FakeTransactionRow } from './fake-ledger';

/**
 * The aggregate double for the dashboard's HTTP suite.
 *
 * The HTTP layer's job is to prove transport — routing, the session guard, DTO validation, and
 * the documented error envelopes. The *financial* correctness of these same aggregates is proved
 * against real PostgreSQL by `test/database/dashboard-projection.db-spec.ts`, where the actual
 * `SUM`, `FILTER`, `EXTRACT`, `LEFT JOIN`, and `AT TIME ZONE` behaviour runs. Reimplementing that
 * SQL semantics here would only prove the double agrees with itself, so this one instead derives
 * its answers from the shared ledger the transaction double writes to.
 *
 * What it does reproduce faithfully is everything that is *contract* rather than SQL, and each of
 * these is a rule a transport bug would break:
 *
 * - `status = 'ACTIVE'` filtering, so a voided row is excluded from every figure.
 * - `business_date` as an inclusive calendar `DATE` range, never an instant comparison.
 * - Signed method balances, so an expense recorded before its income stays negative.
 * - Cumulative-through-date balances, computed over a different range than the period movement.
 * - Document presence, using the fixture's own `documentCount` rather than a second definition.
 * - Newest-first, bounded recent ordering by business date, then occurrence, then id.
 *
 * Arithmetic is `bigint` throughout, mirroring the repositories.
 */

/** The payment methods the database enum allows. */
type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER';

function atOrBefore(value: Date, boundary: Date): boolean {
  return value.getTime() <= boundary.getTime();
}

function inRange(value: Date, from: Date, to: Date): boolean {
  return atOrBefore(value, to) && value.getTime() >= from.getTime();
}

/** `2026` + 9 → `202609`, matching the repositories' comparable month key. */
function monthKeyOf(year: number, month: number): number {
  return year * 100 + month;
}

/** The `(year, month)` of a UTC-midnight business date. */
function monthKeyOfBusinessDate(date: Date): number {
  return monthKeyOf(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * The reconciler's read side, over shared in-memory rows.
 *
 * Constructed per suite from the same `FakeLedger` the transaction double mutates, so a
 * transaction recorded through an HTTP route is visible here without a second copy of the data.
 */
export class FakeReconciliation {
  public constructor(
    private readonly rows: readonly FakeTransactionRow[],
    private readonly lookups: {
      categoryNameFor: (categoryId: string) => string | null;
      memberNameFor: (memberId: string) => string | null;
    },
  ) {}

  /**
   * Every active row, which is the only set any financial figure may be built from.
   *
   * Voided rows stay in the ledger for the audit trail and are excluded here, which is what
   * `REQ-FIN-002` requires of every dashboard figure.
   */
  private active(): readonly FakeTransactionRow[] {
    return this.rows.filter((row) => row.status === 'ACTIVE');
  }

  public async periodTotals(from: Date, to: Date): Promise<PeriodTotals> {
    let incomePaise = 0n;
    let expensePaise = 0n;

    for (const row of this.active()) {
      if (!inRange(row.businessDate, from, to)) {
        continue;
      }

      if (row.transactionType === 'INCOME') {
        incomePaise += row.amountPaise;
      } else {
        expensePaise += row.amountPaise;
      }
    }

    return { incomePaise, expensePaise, movementPaise: incomePaise - expensePaise };
  }

  /**
   * Income and expense totals through a date, ignoring any lower bound.
   *
   * This is deliberately a *different* range from {@link periodTotals}: the ending balance is
   * cumulative (`REQ-FIN-010`), the period movement is not. Having both on one double is what lets
   * a test assert that the two projections genuinely differ instead of agreeing by accident.
   */
  public async overallTotalsThrough(to: Date): Promise<PeriodTotals> {
    let incomePaise = 0n;
    let expensePaise = 0n;

    for (const row of this.active()) {
      if (!atOrBefore(row.businessDate, to)) {
        continue;
      }

      if (row.transactionType === 'INCOME') {
        incomePaise += row.amountPaise;
      } else {
        expensePaise += row.amountPaise;
      }
    }

    return { incomePaise, expensePaise, movementPaise: incomePaise - expensePaise };
  }

  public async methodBalancesThrough(to: Date): Promise<readonly MethodBreakdownRow[]> {
    const totals = new Map<string, bigint>();

    for (const row of this.active()) {
      if (!atOrBefore(row.businessDate, to)) {
        continue;
      }

      const sign = row.transactionType === 'INCOME' ? 1n : -1n;
      totals.set(row.paymentMethod, (totals.get(row.paymentMethod) ?? 0n) + sign * row.amountPaise);
    }

    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([paymentMethod, amountPaise]) => ({
        paymentMethod: paymentMethod as PaymentMethod,
        amountPaise,
      }));
  }

  public async endingBalancesThrough(to: Date) {
    const overall = await this.overallTotalsThrough(to);
    const methods = await this.methodBalancesThrough(to);

    // A method with no activity is a real answer — zero, not a missing card. The dashboard renders
    // all three methods unconditionally, so the double has to supply all three.
    const byMethod: Record<PaymentMethod, bigint> = { CASH: 0n, UPI: 0n, BANK_TRANSFER: 0n };

    for (const method of methods) {
      byMethod[method.paymentMethod] = method.amountPaise;
    }

    return {
      incomePaise: overall.incomePaise,
      expensePaise: overall.expensePaise,
      movementPaise: overall.movementPaise,
      // `REQ-FIN-013`: the total is the sum of the three method balances.
      availablePaise: Object.values(byMethod).reduce((sum, amount) => sum + amount, 0n),
      byMethod,
    };
  }

  public async expenseByCategory(from: Date, to: Date): Promise<readonly CategoryBreakdownRow[]> {
    const named = await this.expenseByCategoryWithNames(from, to);

    return named.map((row) => ({ categoryId: row.categoryId, amountPaise: row.amountPaise }));
  }

  public async expenseByCategoryWithNames(
    from: Date,
    to: Date,
  ): Promise<readonly NamedCategoryBreakdownRow[]> {
    const totals = new Map<string, bigint>();
    const names = new Map<string, string | null>();

    for (const row of this.active()) {
      if (row.transactionType !== 'EXPENSE' || !inRange(row.businessDate, from, to)) {
        continue;
      }

      // The database requires an expense to name a category, so the `uncategorised` bucket is
      // unreachable in practice. It is kept only so a malformed fixture cannot silently drop a
      // real expense out of the chart while the total still counted it.
      const key = row.categoryId ?? 'uncategorised';
      totals.set(key, (totals.get(key) ?? 0n) + row.amountPaise);
      names.set(key, row.categoryId === null ? null : this.lookups.categoryNameFor(row.categoryId));
    }

    return [...totals.entries()]
      .sort(([leftKey, leftAmount], [rightKey, rightAmount]) => {
        if (leftAmount !== rightAmount) {
          return leftAmount > rightAmount ? -1 : 1;
        }

        return leftKey.localeCompare(rightKey);
      })
      .map(([categoryId, amountPaise]) => ({
        categoryId,
        categoryName: names.get(categoryId) ?? null,
        amountPaise,
      }));
  }

  public async incomeByType(from: Date, to: Date): Promise<readonly IncomeTypeBreakdownRow[]> {
    const totals = new Map<string, bigint>();

    for (const row of this.active()) {
      if (row.transactionType !== 'INCOME' || !inRange(row.businessDate, from, to)) {
        continue;
      }

      // `income_type` is a required enum member for an income row.
      const key = row.incomeType ?? 'UNSPECIFIED';
      totals.set(key, (totals.get(key) ?? 0n) + row.amountPaise);
    }

    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([incomeType, amountPaise]) => ({ incomeType, amountPaise }));
  }

  /**
   * Only the months that have activity.
   *
   * The *zero-filling* of a continuous series is `DashboardService`'s job, not the query's, which
   * is why this returns a sparse set exactly as `EXTRACT ... GROUP BY` does and the service
   * expands it against the resolved period.
   */
  public async monthlyTrend(from: Date, to: Date): Promise<readonly MonthlyTrendRow[]> {
    const totals = new Map<number, { incomePaise: bigint; expensePaise: bigint }>();

    for (const row of this.active()) {
      if (!inRange(row.businessDate, from, to)) {
        continue;
      }

      const key = monthKeyOfBusinessDate(row.businessDate);
      const found = totals.get(key) ?? { incomePaise: 0n, expensePaise: 0n };

      if (row.transactionType === 'INCOME') {
        found.incomePaise += row.amountPaise;
      } else {
        found.expensePaise += row.amountPaise;
      }

      totals.set(key, found);
    }

    return [...totals.entries()]
      .sort(([left], [right]) => left - right)
      .map(([key, found]) => ({
        year: Math.floor(key / 100),
        month: key % 100,
        ...found,
      }));
  }

  /**
   * The Income report: active income per income type, with the transaction count behind each total.
   *
   * The count is a real `bigint`-free `number` here and a `COUNT(*)` in the database, but it is part
   * of the *report contract*, so the double supplies it: a total without its count would let a
   * transport bug drop the column without any assertion noticing.
   */
  public async incomeReport(from: Date, to: Date): Promise<readonly IncomeTypeReportRow[]> {
    const totals = new Map<string, { amountPaise: bigint; transactionCount: number }>();

    for (const row of this.active()) {
      if (row.transactionType !== 'INCOME' || !inRange(row.businessDate, from, to)) {
        continue;
      }

      const key = row.incomeType ?? 'UNSPECIFIED';
      const found = totals.get(key) ?? { amountPaise: 0n, transactionCount: 0 };

      found.amountPaise += row.amountPaise;
      found.transactionCount += 1;
      totals.set(key, found);
    }

    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([incomeType, found]) => ({
        incomeType,
        amountPaise: found.amountPaise,
        transactionCount: found.transactionCount,
      }));
  }

  /** The Expense report: active expenses per category, with the transaction count behind each total. */
  public async expenseReport(from: Date, to: Date): Promise<readonly ExpenseCategoryReportRow[]> {
    const totals = new Map<
      string,
      { categoryName: string | null; amountPaise: bigint; transactionCount: number }
    >();

    for (const row of this.active()) {
      if (row.transactionType !== 'EXPENSE' || !inRange(row.businessDate, from, to)) {
        continue;
      }

      const key = row.categoryId ?? 'uncategorised';
      const found = totals.get(key) ?? {
        categoryName: row.categoryId === null ? null : this.lookups.categoryNameFor(row.categoryId),
        amountPaise: 0n,
        transactionCount: 0,
      };

      found.amountPaise += row.amountPaise;
      found.transactionCount += 1;
      totals.set(key, found);
    }

    return [...totals.entries()]
      .sort(([leftKey, leftFound], [rightKey, rightFound]) => {
        if (leftFound.amountPaise !== rightFound.amountPaise) {
          return leftFound.amountPaise > rightFound.amountPaise ? -1 : 1;
        }

        return leftKey.localeCompare(rightKey);
      })
      .map(([categoryId, found]) => ({
        categoryId,
        categoryName: found.categoryName,
        amountPaise: found.amountPaise,
        transactionCount: found.transactionCount,
      }));
  }

  /**
   * The Payment Method report's *period movement*, as distinct from its ending balance.
   *
   * `methodBalancesThrough` is cumulative through a date; this one is bounded by the period. Keeping
   * them as separate methods on the double is what lets a test prove the report labels and sources
   * them differently (`REQ-FIN-014`).
   */
  public async methodMovement(from: Date, to: Date): Promise<readonly MethodMovementRow[]> {
    const totals = new Map<string, { incomePaise: bigint; expensePaise: bigint }>();

    for (const row of this.active()) {
      if (!inRange(row.businessDate, from, to)) {
        continue;
      }

      const found = totals.get(row.paymentMethod) ?? { incomePaise: 0n, expensePaise: 0n };

      if (row.transactionType === 'INCOME') {
        found.incomePaise += row.amountPaise;
      } else {
        found.expensePaise += row.amountPaise;
      }

      totals.set(row.paymentMethod, found);
    }

    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([paymentMethod, found]) => ({
        paymentMethod: paymentMethod as PaymentMethod,
        ...found,
        movementPaise: found.incomePaise - found.expensePaise,
      }));
  }

  /**
   * The Receipt / Document report.
   *
   * Built from the document rows a fixture explicitly supplied. A transaction with `documentCount`
   * but no supplied rows contributes nothing here, because inventing a document would let this
   * report's state logic be asserted against data the database cannot produce. The `VOIDED` state
   * is derived from the owning transaction rather than trusted from the fixture, so a suite cannot
   * declare a document `VOIDED` on an active transaction.
   */
  public async documentsReport(from: Date, to: Date): Promise<readonly DocumentReportRow[]> {
    const rows: DocumentReportRow[] = [];

    for (const row of this.rows) {
      if (!inRange(row.businessDate, from, to)) {
        continue;
      }

      for (const document of row.documents ?? []) {
        const state: ReportDocumentState =
          row.status === 'VOIDED'
            ? 'VOIDED'
            : document.state === 'REMOVED'
              ? 'REMOVED'
              : 'AVAILABLE';

        rows.push({
          documentId: document.id,
          documentReferenceId: document.referenceId,
          state,
          originalFilename: document.originalFilename,
          byteSize: document.byteSize,
          detectedMimeType: document.detectedMimeType,
          uploadedAt: document.uploadedAt,
          transactionId: row.id,
          transactionReferenceId: row.referenceId,
          transactionType: row.transactionType,
          transactionStatus: row.status,
          amountPaise: row.amountPaise,
          businessDate: row.businessDate,
          memberName: row.memberId === null ? null : this.lookups.memberNameFor(row.memberId),
          storageKey: document.storageKey,
        });
      }
    }

    return rows.sort((left, right) => left.documentId.localeCompare(right.documentId));
  }

  public async recentTransactions(limit: number): Promise<readonly RecentTransactionRow[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      return [];
    }

    return this.active()
      .slice()
      .sort((left, right) => {
        // The documented order: newest business date, then newest occurrence, then id as the
        // final tie-break so the list is stable rather than dependent on insertion order.
        const byDate = right.businessDate.getTime() - left.businessDate.getTime();

        if (byDate !== 0) {
          return byDate;
        }

        const byOccurred = right.occurredAt.getTime() - left.occurredAt.getTime();

        if (byOccurred !== 0) {
          return byOccurred;
        }

        return right.id.localeCompare(left.id);
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        referenceId: row.referenceId,
        transactionType: row.transactionType,
        amountPaise: row.amountPaise,
        paymentMethod: row.paymentMethod as PaymentMethod,
        businessDate: row.businessDate,
        description: row.description,
        incomeType: row.incomeType,
        categoryName: row.categoryId === null ? null : this.lookups.categoryNameFor(row.categoryId),
        memberName: row.memberId === null ? null : this.lookups.memberNameFor(row.memberId),
        // The shared ledger models no removals, so every counted document is available; reusing
        // its own field keeps "has a receipt" meaning the same thing here as in the transaction
        // routes. Phase 07's removed-document case is proved by the document suites.
        hasReceipt: row.documentCount > 0,
      }));
  }
}

/** The member creation instant an Asia/Kolkata fixture wants, given its business date. */
export function memberCreatedAt(businessDate: string): Date {
  return new Date(`${businessDate}T04:00:00.000Z`);
}

/**
 * Wires {@link FakeReconciliation} to the shared fixture arrays.
 *
 * The arrays are captured by reference, so the ledger's write methods keep mutating one shared
 * list and the double reads what the transaction double wrote. Resolving names through callbacks
 * rather than snapshots means a category or member renamed through the API is reflected here.
 */
export function reconciliationLookups(options: {
  readonly members: readonly FakeMember[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}): ConstructorParameters<typeof FakeReconciliation>[1] {
  return {
    categoryNameFor: (categoryId) =>
      options.categories.find((category) => category.id === categoryId)?.name ?? null,
    memberNameFor: (memberId) =>
      options.members.find((member) => member.id === memberId)?.name ?? null,
  };
}

export { monthKeyOf };
