import { Injectable } from '@nestjs/common';
import {
  AVAILABLE_BALANCE_LABEL,
  CURRENCY,
  DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT,
  DASHBOARD_RECENT_TRANSACTION_LIMIT,
  PERIOD_MOVEMENT_LABEL,
  type ContributionMonthBucket,
  type ContributionStatusSummary,
  type DashboardBalanceProjection,
  type DashboardBreakdownSlice,
  type DashboardMovementProjection,
  type DashboardPeriodView,
  type DashboardRecentTransaction,
  type DashboardTrendPoint,
  type DashboardView,
  type ExpenseBreakdown,
  type IncomeBreakdown,
} from '@hyssop/contracts';
import { formatPaise } from '../common/money/paise';
import { BUSINESS_TIMEZONE, formatBusinessDate } from '../common/time/business-date';
import { validationFailed } from '../common/errors/domain.errors';
import {
  CONTRIBUTION_BUCKET_MAX_ROWS,
  ContributionPeriodRepository,
} from '../database/contributions/contribution-period.repository';
import { deriveContributionStatus } from '../database/contributions/contribution-status';
import { MemberRepository } from '../database/members/member.repository';
import { ReconciliationService } from '../database/reconciliation/reconciliation.service';
import {
  assertSpanWithinLimit,
  calendarMonthsOf,
  monthKeyRangeOf,
  periodLabel,
  type CalendarMonth,
  type ResolvedPeriod,
} from './period.resolver';

/**
 * The dashboard projection.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the canonical financial calculation layer is
 * server-side, integer-based, and derived from persisted data. Authority:
 * `docs/01-REQUIREMENTS.md` `REQ-DASH-001` to `REQ-DASH-018`.
 *
 * Every figure on the dashboard is produced here, in one place, from one resolved period. The
 * service never returns a hard-coded total and never leaves arithmetic to the browser: the only
 * conversions it performs are `bigint` to the API's exact decimal string, which is a formatting
 * step rather than a calculation.
 *
 * **One period, one snapshot.** The cards, the trend, the breakdowns, the contribution buckets,
 * and the recent list are all resolved from the same `from`/`to` before any query runs, and the
 * independent queries are issued together with `Promise.all`. The alternative — one endpoint per
 * widget — would let the cards and the trend be computed from different moments and disagree on
 * screen for reasons the Admin cannot see.
 *
 * **Two different balances, deliberately.** `REQ-FIN-009` makes the selected period's income and
 * expense a *movement*; `REQ-FIN-010` to `REQ-FIN-013` make the per-method figures *ending
 * balances through the period end*, which include every earlier month. They are computed by
 * different queries against different ranges and are returned as separately labelled
 * projections, because `REQ-FIN-014` requires the distinction to be visible. Collapsing them
 * into one "balance" number would quietly turn a three-month movement into something that looks
 * like the church's total money.
 *
 * **Nothing is clamped.** A method balance can be negative when expenses were recorded before
 * the matching income (`REQ-FIN-012`), and the contribution "not configured" count is reported
 * beside the unpaid count rather than folded into it (`REQ-CONTRIB-006`).
 */
@Injectable()
export class DashboardService {
  public constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly members: MemberRepository,
    private readonly contributions: ContributionPeriodRepository,
  ) {}

  public async dashboard(period: ResolvedPeriod, now: Date = new Date()): Promise<DashboardView> {
    // A custom range is the only client-controlled span, so it is the only one that needs a
    // bound. Presets are all fixed and short.
    assertSpanWithinLimit(period, DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT);

    const months = calendarMonthsOf(period);
    const monthKeys = monthKeyRangeOf(period);

    const [
      movementTotals,
      balances,
      memberCount,
      trendRows,
      expenseRows,
      incomeRows,
      contributionRows,
      membersBeforePeriod,
      memberCreatedByMonth,
      recentRows,
    ] = await Promise.all([
      this.reconciliation.periodTotals(period.from, period.to),
      this.reconciliation.endingBalancesThrough(period.to),
      this.members.countCreatedThrough(period.to),
      this.reconciliation.monthlyTrend(period.from, period.to),
      this.reconciliation.expenseByCategoryWithNames(period.from, period.to),
      this.reconciliation.incomeByType(period.from, period.to),
      this.contributions.aggregateAmountsByMonthRange(monthKeys.fromKey, monthKeys.toKey),
      this.members.countCreatedThrough(dayBefore(period.from)),
      this.members.countCreatedByMonth(period.from, period.to),
      this.reconciliation.recentTransactions(DASHBOARD_RECENT_TRANSACTION_LIMIT),
    ]);

    // The query reads one row past its cap so a truncated count can be detected here. Counting a
    // partial set would report some members' contributions as absent, which is a wrong number
    // rather than a missing one, so the request is refused instead.
    if (contributionRows.length > CONTRIBUTION_BUCKET_MAX_ROWS) {
      throw validationFailed(
        'Too many member contribution months cover this period. Choose a shorter date range.',
        { field: 'period' },
      );
    }

    return {
      period: periodView(period),
      movement: movementProjection(movementTotals.incomePaise, movementTotals.expensePaise),
      // `REQ-DASH-003`: the balance *for the period*, which is exactly the period movement.
      availableBalanceForPeriod: formatPaise(movementTotals.movementPaise),
      balances: balanceProjectionOf(balances, period),
      memberCount,
      comparison: {
        income: formatPaise(movementTotals.incomePaise),
        expenses: formatPaise(movementTotals.expensePaise),
        movement: formatPaise(movementTotals.movementPaise),
      },
      incomeBreakdown: incomeBreakdownOf(incomeRows),
      expenseBreakdown: expenseBreakdownOf(expenseRows),
      contributionStatus: contributionSummaryOf(
        months,
        contributionRows,
        memberCreatedByMonth,
        membersBeforePeriod,
      ),
      trend: trendPointsOf(trendRows, months),
      recentTransactions: recentTransactionsOf(recentRows),
      recentTransactionCount: recentRows.length,
      currency: CURRENCY,
      generatedAt: now.toISOString(),
    };
  }
}

/** Encodes a `(year, month)` pair as one comparable integer, `2026` + 9 → `202609`. */
function monthKeyOf(month: CalendarMonth): number {
  return month.year * 100 + month.month;
}

/**
 * The business day immediately before a date.
 *
 * Used to ask "how many members existed *before* this period started", which is a different
 * question from "how many exist by the period's end" and needs its own bound. Reading strictly
 * before the first day rather than on-or-before it keeps the two counts from overlapping: a
 * member created on the 1st belongs to the per-month accumulation, not to the baseline.
 *
 * Plain day arithmetic on a UTC-midnight calendar date is safe here: `business_date` is a
 * calendar day, so subtracting 86 400 000 ms moves exactly one day with no zone or leap-second
 * ambiguity.
 */
function dayBefore(date: Date): Date {
  return new Date(date.getTime() - 86_400_000);
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

function movementProjection(
  incomePaise: bigint,
  expensePaise: bigint,
): DashboardMovementProjection {
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
    readonly byMethod: Readonly<Record<'CASH' | 'UPI' | 'BANK_TRANSFER', bigint>>;
    readonly incomePaise: bigint;
    readonly expensePaise: bigint;
  },
  period: ResolvedPeriod,
): DashboardBalanceProjection {
  return {
    label: AVAILABLE_BALANCE_LABEL,
    asOf: formatBusinessDate(period.to),
    cash: formatPaise(balances.byMethod.CASH),
    upi: formatPaise(balances.byMethod.UPI),
    bank: formatPaise(balances.byMethod.BANK_TRANSFER),
    // `REQ-FIN-013`: the total is the sum of the method balances, not a separate query, so the
    // card can never disagree with the three cards above it.
    total: formatPaise(balances.availablePaise),
    cumulativeIncome: formatPaise(balances.incomePaise),
    cumulativeExpenses: formatPaise(balances.expensePaise),
  };
}

/**
 * Turns a breakdown's rows into labelled, exact shares.
 *
 * The share is computed in exact decimal arithmetic, not floating point. `sharePercent` is a
 * two-decimal string produced by integer division with an explicit remainder step, so two slices
 * whose shares are meant to total `100.00` total `100.00` and a `0.01` difference is never
 * introduced by a binary rounding artefact. When the total is zero, every share is `"0.00"`
 * rather than a division by zero.
 */
function toSlices(
  rows: readonly {
    readonly amountPaise: bigint;
    readonly label: string;
    readonly key: string;
    readonly customLabel: boolean;
  }[],
): readonly DashboardBreakdownSlice[] {
  const total = rows.reduce((sum, row) => sum + row.amountPaise, 0n);

  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    amount: formatPaise(row.amountPaise),
    sharePercent: sharePercentOf(row.amountPaise, total),
    customLabel: row.customLabel,
  }));
}

/**
 * Exact `amount / total` as a two-decimal percentage string.
 *
 * Uses `HUNDRED * amount / total` in `bigint` and rounds half-up, then formats the two halves.
 * `Number` is never involved: a floating-point percentage is how a chart ends up labelling a
 * slice `33.3%` next to a total that does not add up.
 */
function sharePercentOf(amountPaise: bigint, totalPaise: bigint): string {
  if (totalPaise === 0n) {
    return '0.00';
  }

  // Percentage to two decimals is `amount * 10000 / total`, kept in bigint. Half-up rounding is
  // `+ total / 2` before dividing, which rounds a trailing `.5` up rather than to even.
  const scaled = (amountPaise * 10_000n + totalPaise / 2n) / totalPaise;
  const whole = scaled / 100n;
  const fractional = scaled % 100n;

  return `${whole.toString()}.${fractional.toString().padStart(2, '0')}`;
}

function incomeBreakdownOf(
  rows: readonly { readonly incomeType: string; readonly amountPaise: bigint }[],
): IncomeBreakdown {
  const slices = toSlices(
    rows.map((row) => ({
      key: row.incomeType,
      label: row.incomeType,
      amountPaise: row.amountPaise,
      // `income_type` is a closed database enum, so its label is not Admin-entered text.
      customLabel: false,
    })),
  );

  return { total: formatPaise(rows.reduce((sum, row) => sum + row.amountPaise, 0n)), slices };
}

const UNCATEGORIZED_LABEL = 'Uncategorised';

function expenseBreakdownOf(
  rows: readonly {
    readonly categoryId: string;
    readonly categoryName: string | null;
    readonly amountPaise: bigint;
  }[],
): ExpenseBreakdown {
  const slices = toSlices(
    rows.map((row) => ({
      key: row.categoryId,
      // An expense category is Admin-entered text, so it is flagged as a custom label and the
      // browser renders it as plain text. A missing category row would otherwise drop real
      // expenses out of the chart while the total still included them.
      label: row.categoryName ?? UNCATEGORIZED_LABEL,
      amountPaise: row.amountPaise,
      customLabel: true,
    })),
  );

  return { total: formatPaise(rows.reduce((sum, row) => sum + row.amountPaise, 0n)), slices };
}

/**
 * Builds a continuous monthly trend, filling months with no activity as zero.
 *
 * A chart that skipped a quiet month would compress the axis and imply the month did not happen.
 * Filling with zeros keeps `thisYear` at twelve points and `last3Months` at three, so the shape
 * of the year is honest.
 */
function trendPointsOf(
  rows: readonly {
    readonly year: number;
    readonly month: number;
    readonly incomePaise: bigint;
    readonly expensePaise: bigint;
  }[],
  months: readonly CalendarMonth[],
): readonly DashboardTrendPoint[] {
  const byMonth = new Map<number, { incomePaise: bigint; expensePaise: bigint }>();

  for (const row of rows) {
    byMonth.set(monthKeyOf({ year: row.year, month: row.month }), {
      incomePaise: row.incomePaise,
      expensePaise: row.expensePaise,
    });
  }

  return months.map((month) => {
    const found = byMonth.get(monthKeyOf(month));
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

/**
 * Counts each month's contribution buckets and the "not configured" remainder.
 *
 * `REQ-CONTRIB-005` counts member-period buckets across the period, and `REQ-CONTRIB-006`
 * requires the members who existed by each month's end but have no expected-period row to be
 * counted *separately* from the unpaid ones. That remainder is
 * `membersByMonthEnd − configured`: the number of people who were on the roll that month but
 * for whom no expectation was ever set.
 *
 * `configured` counts only real `contribution_period` rows, so a member added this month with
 * no period contributes to `notConfigured` rather than to `notPaid` — the whole point of the
 * distinction.
 *
 * The member denominator is seeded with `membersBeforePeriod` — the members who already existed
 * before the first day — and then accumulated month by month. Both halves are required. The
 * per-month counts alone would omit everyone who joined before the period, so a September
 * dashboard would report a church's long-standing members as not existing yet and would
 * misclassify their contributions; seeding from zero alone would be the same bug for the first
 * month only.
 *
 * The subtraction is clamped at zero because `configured` can legitimately exceed
 * `membersByMonthEnd`: an Admin may open a back-dated contribution period for a member who
 * joined later. A negative "not configured" count would be nonsense on screen, and the clamp
 * reports the honest state — everyone on the roll had a period — without inventing a shortfall.
 */
function contributionSummaryOf(
  months: readonly CalendarMonth[],
  rows: readonly {
    readonly year: number;
    readonly month: number;
    readonly expectedPaise: bigint;
    readonly receivedPaise: bigint;
  }[],
  memberCreatedByMonth: readonly {
    readonly year: number;
    readonly month: number;
    readonly count: number;
  }[],
  membersBeforePeriod: number,
): ContributionStatusSummary {
  const createdByKey = new Map<number, number>();
  for (const entry of memberCreatedByMonth) {
    createdByKey.set(monthKeyOf({ year: entry.year, month: entry.month }), entry.count);
  }

  const periodsByKey = new Map<
    number,
    {
      readonly year: number;
      readonly month: number;
      readonly expectedPaise: bigint;
      readonly receivedPaise: bigint;
    }[]
  >();
  for (const row of rows) {
    const key = monthKeyOf({ year: row.year, month: row.month });
    const existing = periodsByKey.get(key);

    if (existing === undefined) {
      periodsByKey.set(key, [row]);
    } else {
      existing.push(row);
    }
  }

  const buckets: ContributionMonthBucket[] = [];
  const totals = emptyBucketCounts();

  // The running member total starts at the members who already existed before the period began,
  // not at zero. A member who joined in June is part of September's denominator, and a
  // September-only dashboard that counted from zero would report them as not yet existing — and
  // would then also report every one of them as "not configured" for months they had already
  // been contributing to.
  let runningMembers = membersBeforePeriod;

  for (const month of months) {
    const key = monthKeyOf(month);
    runningMembers += createdByKey.get(key) ?? 0;

    const monthRows = periodsByKey.get(key) ?? [];
    const counts = emptyBucketCounts();
    counts.membersByMonthEnd = runningMembers;

    for (const row of monthRows) {
      const status = deriveContributionStatus(row.expectedPaise, row.receivedPaise);

      if (status === 'PAID') {
        counts.paid += 1;
      } else if (status === 'PARTIALLY PAID') {
        counts.partiallyPaid += 1;
      } else {
        counts.notPaid += 1;
      }
    }

    counts.configured = counts.paid + counts.partiallyPaid + counts.notPaid;
    counts.notConfigured = Math.max(0, runningMembers - counts.configured);

    buckets.push({
      month: `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`,
      year: month.year,
      monthNumber: month.month,
      counts,
    });

    totals.paid += counts.paid;
    totals.partiallyPaid += counts.partiallyPaid;
    totals.notPaid += counts.notPaid;
    totals.notConfigured += counts.notConfigured;
    totals.configured += counts.configured;
    totals.membersByMonthEnd += counts.membersByMonthEnd;
  }

  return { months: buckets, totals };
}

/**
 * A fresh mutable counter set.
 *
 * `ContributionBucketCounts` is `readonly` because it is a response shape, and the response must
 * not be mutated after it is returned. The accumulator here is built field by field and then
 * handed to the response, so it is a separate mutable type rather than the response type with
 * its modifiers cast off.
 */
interface MutableBucketCounts {
  paid: number;
  partiallyPaid: number;
  notPaid: number;
  notConfigured: number;
  configured: number;
  membersByMonthEnd: number;
}

function emptyBucketCounts(): MutableBucketCounts {
  return {
    paid: 0,
    partiallyPaid: 0,
    notPaid: 0,
    notConfigured: 0,
    configured: 0,
    membersByMonthEnd: 0,
  };
}

function recentTransactionsOf(
  rows: readonly {
    readonly id: string;
    readonly referenceId: string;
    readonly transactionType: string;
    readonly amountPaise: bigint;
    readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER';
    readonly businessDate: Date;
    readonly description: string | null;
    readonly incomeType: string | null;
    readonly categoryName: string | null;
    readonly memberName: string | null;
    readonly hasReceipt: boolean;
  }[],
): readonly DashboardRecentTransaction[] {
  return rows.map((row) => ({
    id: row.id,
    referenceId: row.referenceId,
    type: row.transactionType as DashboardRecentTransaction['type'],
    amount: formatPaise(row.amountPaise),
    paymentMethod: row.paymentMethod,
    businessDate: formatBusinessDate(row.businessDate),
    description: row.description,
    incomeType: row.incomeType as DashboardRecentTransaction['incomeType'],
    categoryName: row.categoryName,
    memberName: row.memberName,
    hasReceipt: row.hasReceipt,
    active: true,
  }));
}
