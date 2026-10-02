import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { formatBusinessDate } from '../../common/time/business-date';
import { PrismaService } from '../prisma/prisma.service';

export interface PeriodTotals {
  readonly incomePaise: bigint;
  readonly expensePaise: bigint;
  /** Signed movement for the period: income minus expense. */
  readonly movementPaise: bigint;
}

export interface EndingBalances extends PeriodTotals {
  /** Income minus expense over all business dates up to the filter date. */
  readonly availablePaise: bigint;
  readonly byMethod: Readonly<Record<PaymentMethod, bigint>>;
}

export interface MethodBreakdownRow {
  readonly paymentMethod: PaymentMethod;
  readonly amountPaise: bigint;
}

export interface CategoryBreakdownRow {
  readonly categoryId: string;
  readonly amountPaise: bigint;
}

export interface IncomeTypeBreakdownRow {
  readonly incomeType: string;
  readonly amountPaise: bigint;
}

/** One calendar month of the `REQ-DASH-012` trend. */
export interface MonthlyTrendRow {
  readonly year: number;
  readonly month: number;
  readonly incomePaise: bigint;
  readonly expensePaise: bigint;
}

/** An expense category's active total, with the label to show for it. */
export interface NamedCategoryBreakdownRow extends CategoryBreakdownRow {
  readonly categoryName: string | null;
}

/** One recent active transaction, already joined to the labels the dashboard shows. */
export interface RecentTransactionRow {
  readonly id: string;
  readonly referenceId: string;
  readonly transactionType: string;
  readonly amountPaise: bigint;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: Date;
  readonly description: string | null;
  readonly incomeType: string | null;
  readonly categoryName: string | null;
  readonly memberName: string | null;
  readonly hasReceipt: boolean;
}

const ALL_METHODS: readonly PaymentMethod[] = ['CASH', 'UPI', 'BANK_TRANSFER'];

/**
 * Binds a business date to a SQL parameter.
 *
 * `business_date` is a PostgreSQL `DATE` and a business date is a calendar day, never an
 * instant. Prisma sends a JavaScript `Date` as a timestamp, and comparing a `DATE` column
 * with a timestamp makes the result depend on the database session time zone, which can
 * silently drop rows from a period. The value is therefore sent as a `YYYY-MM-DD` string
 * and cast with `::date`, so the comparison is exact in every session time zone.
 */
function sqlDate(value: Date): Prisma.Sql {
  return Prisma.sql`${formatBusinessDate(value)}::date`;
}

/** The payment methods a method-balance report can report, in stable display order. */
export function reportablePaymentMethods(): readonly PaymentMethod[] {
  return ALL_METHODS;
}

/**
 * Database-derived financial aggregates.
 *
 * Authority: `docs/02-ARCHITECTURE.md`: the canonical calculation layer is
 * server-side, integer-based, and built from persisted data, never from hard-coded
 * totals or client arithmetic. Authority: `docs/01-REQUIREMENTS.md` `REQ-FIN-001`:
 * totals include only active, valid transactions, so every query filters
 * `status = 'ACTIVE'`; voided rows stay queryable for audit and history.
 *
 * All arithmetic is `SUM(bigint)` in PostgreSQL and returned as `bigint`, so no
 * amount passes through a floating-point value.
 */
@Injectable()
export class ReconciliationService {
  public constructor(private readonly prisma: PrismaService) {}

  /** Income and expense movement within an inclusive business-date range. */
  public async periodTotals(from: Date, to: Date): Promise<PeriodTotals> {
    const row = await this.prisma.$queryRaw<
      readonly [
        {
          readonly income_paise: bigint;
          readonly expense_paise: bigint;
          readonly movement_paise: bigint;
        },
      ]
    >`
      SELECT
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'INCOME'), 0)::bigint AS income_paise,
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'EXPENSE'), 0)::bigint AS expense_paise,
        COALESCE(SUM(CASE WHEN "transaction_type" = 'INCOME' THEN "amount_paise" ELSE -"amount_paise" END), 0)::bigint AS movement_paise
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE' AND "business_date" >= ${sqlDate(from)} AND "business_date" <= ${sqlDate(to)}
    `;

    const totals = row[0];

    if (totals === undefined) {
      return { incomePaise: 0n, expensePaise: 0n, movementPaise: 0n };
    }

    return {
      incomePaise: totals.income_paise,
      expensePaise: totals.expense_paise,
      movementPaise: totals.movement_paise,
    };
  }

  /**
   * Cumulative balances through a business date, overall and per payment method.
   *
   * A method balance may legitimately be negative, for example when an expense is
   * recorded against a method before its income is entered. The value is returned
   * honestly instead of being clamped.
   */
  public async endingBalancesThrough(to: Date): Promise<EndingBalances> {
    const [overall, methods] = await Promise.all([
      this.overallTotalsThrough(to),
      this.methodBalancesThrough(to),
    ]);

    const byMethod = emptyMethodMap();
    for (const method of methods) {
      byMethod[method.paymentMethod] = method.amountPaise;
    }

    const availablePaise = overall.incomePaise - overall.expensePaise;

    return {
      incomePaise: overall.incomePaise,
      expensePaise: overall.expensePaise,
      movementPaise: availablePaise,
      availablePaise,
      byMethod,
    };
  }

  /** Active income and expense sums for all business dates up to and including `to`. */
  public async overallTotalsThrough(to: Date): Promise<PeriodTotals> {
    const row = await this.prisma.$queryRaw<
      readonly [{ readonly income_paise: bigint; readonly expense_paise: bigint }]
    >`
      SELECT
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'INCOME'), 0)::bigint AS income_paise,
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'EXPENSE'), 0)::bigint AS expense_paise
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE' AND "business_date" <= ${sqlDate(to)}
    `;

    const totals = row[0];

    if (totals === undefined) {
      return { incomePaise: 0n, expensePaise: 0n, movementPaise: 0n };
    }

    return {
      incomePaise: totals.income_paise,
      expensePaise: totals.expense_paise,
      movementPaise: totals.income_paise - totals.expense_paise,
    };
  }

  /** Signed balance per payment method through a business date. */
  public async methodBalancesThrough(to: Date): Promise<readonly MethodBreakdownRow[]> {
    return this.prisma.$queryRaw<readonly MethodBreakdownRow[]>`
      SELECT
        "payment_method" AS "paymentMethod",
        COALESCE(SUM(CASE WHEN "transaction_type" = 'INCOME' THEN "amount_paise" ELSE -"amount_paise" END), 0)::bigint AS "amountPaise"
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE' AND "business_date" <= ${sqlDate(to)}
      GROUP BY "payment_method"
      ORDER BY "payment_method" ASC
    `;
  }

  /** Active expense totals per category within an inclusive range. */
  public async expenseByCategory(from: Date, to: Date): Promise<readonly CategoryBreakdownRow[]> {
    return this.prisma.$queryRaw<readonly CategoryBreakdownRow[]>`
      SELECT "category_id" AS "categoryId", COALESCE(SUM("amount_paise"), 0)::bigint AS "amountPaise"
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE' AND "transaction_type" = 'EXPENSE'
        AND "business_date" >= ${sqlDate(from)} AND "business_date" <= ${sqlDate(to)}
      GROUP BY "category_id"
      ORDER BY SUM("amount_paise") DESC, "category_id" ASC
    `;
  }

  /** Active income totals per income type within an inclusive range. */
  public async incomeByType(from: Date, to: Date): Promise<readonly IncomeTypeBreakdownRow[]> {
    return this.prisma.$queryRaw<readonly IncomeTypeBreakdownRow[]>`
      SELECT "income_type" AS "incomeType", COALESCE(SUM("amount_paise"), 0)::bigint AS "amountPaise"
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE' AND "transaction_type" = 'INCOME'
        AND "business_date" >= ${sqlDate(from)} AND "business_date" <= ${sqlDate(to)}
      GROUP BY "income_type"
      ORDER BY "income_type" ASC
    `;
  }

  /**
   * Active income and expense movement for each calendar month touched by a range.
   *
   * `REQ-DASH-012` requires the trend to be a real monthly series, so this groups in the
   * database rather than fetching rows and folding them in the application. Months with no
   * activity produce no row here; the caller fills the gaps so the chart has a continuous axis.
   *
   * Grouping is on `business_date`, which is already a calendar `DATE`, so no zone conversion
   * is needed and a transaction recorded at 23:50 IST on the 30th belongs to the 30th's month.
   */
  public async monthlyTrend(from: Date, to: Date): Promise<readonly MonthlyTrendRow[]> {
    return this.prisma.$queryRaw<readonly MonthlyTrendRow[]>`
      SELECT
        EXTRACT(YEAR FROM "business_date")::int AS "year",
        EXTRACT(MONTH FROM "business_date")::int AS "month",
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'INCOME'), 0)::bigint AS "incomePaise",
        COALESCE(SUM("amount_paise") FILTER (WHERE "transaction_type" = 'EXPENSE'), 0)::bigint AS "expensePaise"
      FROM "financial_transaction"
      WHERE "status" = 'ACTIVE'
        AND "business_date" >= ${sqlDate(from)} AND "business_date" <= ${sqlDate(to)}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;
  }

  /**
   * Active expenses per category with the category's name.
   *
   * A separate query from `expenseByCategory` rather than a widened one, because the existing
   * shape is already relied on by the reconciliation screens and its tests. Adding a column
   * would have been the smaller change but would have changed a contract other callers had
   * already been built against.
   *
   * The join is a `LEFT JOIN` so a category row that is somehow missing cannot silently drop
   * its expenses out of the breakdown total. A breakdown whose parts do not sum to the total
   * would be worse than one slice labelled as uncategorised.
   */
  public async expenseByCategoryWithNames(
    from: Date,
    to: Date,
  ): Promise<readonly NamedCategoryBreakdownRow[]> {
    return this.prisma.$queryRaw<readonly NamedCategoryBreakdownRow[]>`
      SELECT
        transaction."category_id" AS "categoryId",
        category."name" AS "categoryName",
        COALESCE(SUM(transaction."amount_paise"), 0)::bigint AS "amountPaise"
      FROM "financial_transaction" AS transaction
      LEFT JOIN "expense_category" AS category ON category."id" = transaction."category_id"
      WHERE transaction."status" = 'ACTIVE' AND transaction."transaction_type" = 'EXPENSE'
        AND transaction."business_date" >= ${sqlDate(from)} AND transaction."business_date" <= ${sqlDate(to)}
      GROUP BY transaction."category_id", category."name"
      ORDER BY SUM(transaction."amount_paise") DESC, transaction."category_id" ASC
    `;
  }

  /**
   * The most recently dated active transactions, for the dashboard's recent-activity list.
   *
   * `REQ-FIN-001` means voided rows are excluded: this is the live ledger, and the voided
   * history is reachable through the transaction screens. Ordering by `business_date` first
   * matches what "recent" means to a bookkeeper entering a back-dated receipt.
   *
   * `occurred_at` cannot order rows within one business date because the application derives it
   * as the start of that business day, so it is identical for every row sharing the date.
   * `created_at` is the immutable recorded instant and therefore orders the ties so that the
   * entry written last appears first; `id` then only breaks an exact `created_at` collision.
   *
   * `has_receipt` counts only `AVAILABLE` documents, so a removed receipt is reported as absent
   * rather than as a link that answers `410`.
   */
  public async recentTransactions(limit: number): Promise<readonly RecentTransactionRow[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      return [];
    }

    return this.prisma.$queryRaw<readonly RecentTransactionRow[]>`
      SELECT
        transaction."id" AS "id",
        transaction."reference_id" AS "referenceId",
        transaction."transaction_type" AS "transactionType",
        transaction."amount_paise" AS "amountPaise",
        transaction."payment_method" AS "paymentMethod",
        transaction."business_date" AS "businessDate",
        transaction."description" AS "description",
        transaction."income_type" AS "incomeType",
        category."name" AS "categoryName",
        member."name" AS "memberName",
        EXISTS (
          SELECT 1 FROM "transaction_document" AS document
          WHERE document."transaction_id" = transaction."id" AND document."status" = 'AVAILABLE'
        ) AS "hasReceipt"
      FROM "financial_transaction" AS transaction
      LEFT JOIN "expense_category" AS category ON category."id" = transaction."category_id"
      LEFT JOIN "member" AS member ON member."id" = transaction."member_id"
      WHERE transaction."status" = 'ACTIVE'
      ORDER BY
        transaction."business_date" DESC,
        transaction."created_at" DESC,
        transaction."id" DESC
      LIMIT ${limit}
    `;
  }
}

function emptyMethodMap(): Record<PaymentMethod, bigint> {
  return { CASH: 0n, UPI: 0n, BANK_TRANSFER: 0n };
}
