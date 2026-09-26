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
}

function emptyMethodMap(): Record<PaymentMethod, bigint> {
  return { CASH: 0n, UPI: 0n, BANK_TRANSFER: 0n };
}
