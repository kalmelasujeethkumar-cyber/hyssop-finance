/**
 * Shared dashboard contract.
 *
 * Owned by `docs/06-API-SPEC.md` "Dashboard and reports" and shaped by
 * `docs/01-REQUIREMENTS.md` (`REQ-DASH-001` to `REQ-DASH-018`, `REQ-FIN-004` to
 * `REQ-FIN-014`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`) and `docs/02-ARCHITECTURE.md` (the
 * canonical calculation layer). Both applications depend on this module so a dashboard payload
 * cannot drift between the API that computes it and the browser that renders it.
 *
 * Four rules are load-bearing here, and they are the reason this file exists rather than a set
 * of interfaces sprinkled through the dashboard module:
 *
 * - **Money crosses the boundary as an exact decimal string.** Every amount is `"16500.00"`,
 *   never a JSON number, because `REQ-FIN-021` and `docs/05-DATABASE-SPEC.md` require paise to
 *   be exact and a double cannot represent every paise value. The browser formats these strings
 *   for display and never converts one to a `number`.
 * - **Period movement and ending balance are separate projections, and both are labelled.**
 *   `REQ-FIN-009` makes selected-period income and expense *movements*, while `REQ-FIN-010`
 *   and `REQ-FIN-013` make Cash, UPI, Bank, and the total *ending balances through the period
 *   end*. `REQ-FIN-014` requires the two to be labelled so they cannot be read as one figure.
 *   That is why `movement` and `availableBalance` are two fields with their own `label`, rather
 *   than two cards that happen to sit near each other.
 * - **A balance may be negative and is never clamped.** `REQ-FIN-012` requires a method balance
 *   to go negative when recorded expenses exceed recorded income for that method, and requires
 *   the UI not to conceal it. `formatPaise` renders a signed value, so nothing in this contract
 *   has an "always positive" assumption to violate.
 * - **"Not configured" is a first-class contribution state.** `REQ-CONTRIB-006` requires a
 *   member-month with no expected-period record to be counted and displayed separately rather
 *   than being silently classified as `PAID`, `PARTIALLY PAID`, or `NOT PAID`. It is therefore
 *   its own bucket key here, not a status inside `ContributionStatus`.
 */

import type { CURRENCY, IncomeType, PaymentMethod, TRANSACTION_TYPES } from './transactions';

/**
 * The period presets, exactly as `docs/06-API-SPEC.md` spells them on the wire.
 *
 * A custom range is deliberately *not* one of these: it is expressed by an explicit `from` and
 * `to` instead of a preset name, so `period=custom` could never be a preset whose boundaries
 * were decided somewhere else. `resolveDashboardPeriod` derives the `preset` of a custom range
 * as `'custom'`, which is a real value of {@link DashboardPeriodKind}.
 */
export const DASHBOARD_PERIOD_PRESETS = [
  'today',
  'thisMonth',
  'lastMonth',
  'last3Months',
  'last6Months',
  'thisYear',
  'lastYear',
] as const;

/** A named preset, as sent in the `period` query parameter. */
export type DashboardPeriodPreset = (typeof DASHBOARD_PERIOD_PRESETS)[number];

/**
 * Every kind of resolved period, including an explicit range.
 *
 * `custom` is not accepted as a `period` value from a client; it is only ever *returned*, so a
 * dashboard that was filtered by `from` and `to` still reports honestly that the boundaries
 * were not one of the named presets.
 */
export const DASHBOARD_PERIOD_KINDS = [...DASHBOARD_PERIOD_PRESETS, 'custom'] as const;

export type DashboardPeriodKind = (typeof DASHBOARD_PERIOD_KINDS)[number];

/**
 * `REQ-DASH-015`: the eight period controls the dashboard must offer.
 *
 * Exported so the period selector and its tests read the same list the API validates against,
 * rather than a second hand-written array that could offer a control the API rejects or omit
 * one it accepts.
 */
export const DASHBOARD_PERIOD_LABELS: Readonly<Record<DashboardPeriodPreset, string>> = {
  today: 'Today',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  last3Months: 'Last 3 Months',
  last6Months: 'Last 6 Months',
  thisYear: 'This Year',
  lastYear: 'Last Year',
};

/**
 * The `REQ-FIN-009` label for a period movement.
 *
 * Locked here because `REQ-FIN-014` requires the movement and the balance to be separately
 * labelled, and two screens that each wrote "the wording" would eventually disagree about what
 * the label actually says.
 */
export const PERIOD_MOVEMENT_LABEL = 'Period movement';

/**
 * The `REQ-FIN-014` / `REQ-DASH-008` label for the ledger-derived total.
 */
export const AVAILABLE_BALANCE_LABEL = 'Available balance as of period end';

/**
 * `REQ-CONTRIB-006`: a member-month with no expected-period record.
 *
 * Not a {@link ContributionStatus}, because that type is the exhaustive three-value payment
 * vocabulary of `REQ-CONTRIB-002` and adding a fourth member to it would let a caller treat a
 * month nobody configured as a month somebody did not pay.
 */
export const CONTRIBUTION_NOT_CONFIGURED = 'Not configured' as const;

/** The four buckets the multi-month contribution visualization counts. */
export const CONTRIBUTION_DASHBOARD_BUCKETS = [
  'PAID',
  'PARTIALLY PAID',
  'NOT PAID',
  'NOT_CONFIGURED',
] as const;

export type ContributionDashboardBucket = (typeof CONTRIBUTION_DASHBOARD_BUCKETS)[number];

/** Counts for one month's member-period buckets, over the selected period's months. */
export interface ContributionBucketCounts {
  /** Configured and fully received. */
  readonly paid: number;
  /** Configured and partially received. */
  readonly partiallyPaid: number;
  /** Configured and not received. */
  readonly notPaid: number;
  /**
   * `REQ-CONTRIB-006`: members who existed by the end of this month but have no expected-period
   * record for it. Counted separately so an unconfigured month is never read as an unpaid one.
   */
  readonly notConfigured: number;
  /** Configured member-period records for this month; the sum of the three payment buckets. */
  readonly configured: number;
  /** Members created on or before the end of this month, the denominator for `notConfigured`. */
  readonly membersByMonthEnd: number;
}

/** One month's contribution position, as counted for `REQ-CONTRIB-005`. */
export interface ContributionMonthBucket {
  /** `YYYY-MM`, matching `contribution_period`'s `(year, month)` columns. */
  readonly month: string;
  readonly year: number;
  readonly monthNumber: number;
  readonly counts: ContributionBucketCounts;
}

/**
 * `REQ-CONTRIB-005`: the whole selected period's contribution buckets.
 *
 * One entry per calendar month the period spans, oldest first, so the visualization counts each
 * configured member-period bucket rather than counting each member once.
 */
export interface ContributionStatusSummary {
  readonly months: readonly ContributionMonthBucket[];
  /** Sum across every month in the period. */
  readonly totals: ContributionBucketCounts;
}

/** One labelled slice of a breakdown chart. */
export interface DashboardBreakdownSlice {
  /** A stable key: an `IncomeType`, `'CASH' | 'UPI' | 'BANK_TRANSFER'`, or a category id. */
  readonly key: string;
  readonly label: string;
  /** Exact INR decimal string. */
  readonly amount: string;
  /** Share of the breakdown total as a whole percentage, 0–100. Exact, not float-derived. */
  readonly sharePercent: string;
  /**
   * Whether the label came from the record itself rather than a fixed vocabulary.
   *
   * An expense category is Admin-entered text, so the browser renders it as plain text and
   * never as markup. `REQ-DOC-*` and the security rules treat untrusted text as untrusted, and
   * this flag is what lets the chart distinguish the two without inspecting the string.
   */
  readonly customLabel: boolean;
}

/** Active income by income type for the selected period. */
export interface IncomeBreakdown {
  readonly total: string;
  readonly slices: readonly DashboardBreakdownSlice[];
}

/** Active expenses by category for the selected period. */
export interface ExpenseBreakdown {
  readonly total: string;
  readonly slices: readonly DashboardBreakdownSlice[];
}

/** `REQ-DASH-009`: income versus expense for the selected period. */
export interface IncomeExpenseComparison {
  readonly income: string;
  readonly expenses: string;
  /** Income minus expenses for the period. Signed. */
  readonly movement: string;
}

/** `REQ-FIN-009`: the selected period's movements, as its own labelled projection. */
export interface DashboardMovementProjection {
  /** The locked `REQ-FIN-009` label, returned so every consumer shows the same words. */
  readonly label: typeof PERIOD_MOVEMENT_LABEL;
  readonly income: string;
  readonly expenses: string;
  /** Income minus expenses for the period. Signed; may be negative. */
  readonly net: string;
}

/**
 * `REQ-FIN-010` to `REQ-FIN-013`: ending balances through the selected period end.
 *
 * Every figure here is `active income through period end − active expenses through period end`,
 * never restricted to the selected period, which is exactly what makes the total reconcile with
 * the active ledger rather than with the period. A method balance can be negative.
 */
export interface DashboardBalanceProjection {
  /** The locked `REQ-FIN-014` label. */
  readonly label: typeof AVAILABLE_BALANCE_LABEL;
  /** The period end these balances are taken through, as `YYYY-MM-DD`. */
  readonly asOf: string;
  readonly cash: string;
  readonly upi: string;
  readonly bank: string;
  /** `REQ-FIN-013`: the sum of the three method balances. */
  readonly total: string;
  /** Active income through the period end, the numerator the balances are derived from. */
  readonly cumulativeIncome: string;
  /** Active expenses through the period end. */
  readonly cumulativeExpenses: string;
}

/** `REQ-DASH-012`: one calendar month of the trend. */
export interface DashboardTrendPoint {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly year: number;
  readonly monthNumber: number;
  readonly income: string;
  readonly expenses: string;
  /** Income minus expenses for that month. Signed. */
  readonly movement: string;
}

/**
 * `REQ-DASH-013`: a recent transaction, as a chart-free summary row.
 *
 * The fields are the shared transaction vocabulary rather than a dashboard-specific
 * `TransactionSummary`, because the recent list links to the same detail, receipt, and audit
 * screens the income and expense pages already use and must agree with them.
 */
export interface DashboardRecentTransaction {
  readonly id: string;
  readonly referenceId: string;
  readonly type: (typeof TRANSACTION_TYPES)[number];
  readonly amount: string;
  readonly paymentMethod: PaymentMethod;
  /** `YYYY-MM-DD`. */
  readonly businessDate: string;
  readonly description: string | null;
  readonly incomeType: IncomeType | null;
  readonly categoryName: string | null;
  readonly memberName: string | null;
  readonly hasReceipt: boolean;
  /** Always `true` here; recent activity is active ledger history, and the void path is Phase 09. */
  readonly active: true;
}

/**
 * The resolved period, returned so the browser can *show* the boundaries in effect.
 *
 * `REQ-DASH-016` requires the active period to be visible and to use `Asia/Kolkata`
 * consistently. The API therefore returns the exact inclusive `from` and `to` it used rather
 * than leaving the browser to re-derive them from a preset name — a browser that recomputed
 * "this month" in the Admin's own time zone would be able to disagree with the query that
 * produced the numbers next to it.
 */
export interface DashboardPeriodView {
  readonly preset: DashboardPeriodPreset | 'custom';
  /**
   * A label such as `This Month`, or the exact range for a custom filter.
   *
   * A custom range is labelled with `YYYY-MM-DD` bounds rather than a prose date, because the
   * browser owns presentation (`docs/03-UI-UX-RULES.md`) and the API's job is to state which
   * dates were used. The Admin still sees a human date, rendered from these strings.
   */
  readonly label: string;
  /** Inclusive first business date, `YYYY-MM-DD`. */
  readonly from: string;
  /** Inclusive last business date, `YYYY-MM-DD`. */
  readonly to: string;
  /** The locked timezone name, so the period context is never ambiguous. */
  readonly timezone: 'Asia/Kolkata';
}

/**
 * `GET /api/v1/dashboard` — the whole dashboard in one projection.
 *
 * One response rather than eight endpoints, because `docs/02-ARCHITECTURE.md` requires every
 * card, chart, and table on a screen to come from the *same* server calculation. If the cards
 * and the trend came from separate requests they could be computed against different snapshots
 * and the screen would show two figures that disagree with each other for reasons the Admin
 * cannot see.
 */
export interface DashboardView {
  readonly period: DashboardPeriodView;
  /** `REQ-DASH-001` and `REQ-DASH-002`. */
  readonly movement: DashboardMovementProjection;
  /** `REQ-DASH-003` — the *period* available balance, i.e. income minus expenses. */
  readonly availableBalanceForPeriod: string;
  /** `REQ-DASH-005` to `REQ-DASH-008`. */
  readonly balances: DashboardBalanceProjection;
  /**
   * `REQ-DASH-004` and `REQ-DASH-018`: members created on or before the period end.
   *
   * Not the total member table size. A member added in November must not appear in an October
   * dashboard, which is what makes this a `number` from the server rather than a client count.
   */
  readonly memberCount: number;
  readonly comparison: IncomeExpenseComparison;
  readonly incomeBreakdown: IncomeBreakdown;
  readonly expenseBreakdown: ExpenseBreakdown;
  readonly contributionStatus: ContributionStatusSummary;
  readonly trend: readonly DashboardTrendPoint[];
  readonly recentTransactions: readonly DashboardRecentTransaction[];
  /** How many rows `recentTransactions` holds, so the UI does not imply it is a full list. */
  readonly recentTransactionCount: number;
  /** Currency, always `INR` and never mutable. */
  readonly currency: typeof CURRENCY;
  /** When the API computed the projection. */
  readonly generatedAt: string;
}

/**
 * `docs/03-UI-UX-RULES.md` allows a page to show at most this many recent rows.
 *
 * Bounded rather than paginated because this is a "most recent" preview, not a ledger view;
 * the income and expense screens own the complete, paginated lists. The number is returned
 * rather than assumed so the browser cannot imply that it is showing everything.
 */
export const DASHBOARD_RECENT_TRANSACTION_LIMIT = 10;

/**
 * The maximum span a custom range may cover, in calendar months.
 *
 * A custom range is bounded because the trend expands into one point per month and the
 * contribution visualization into one bucket set per month. Without a bound, `from=1970-01-01`
 * would ask for a 672-point chart and a per-month aggregate query for each. `docs/07-
 * SECURITY-RULES.md` requires validated, bounded input, so the limit is enforced by the API
 * rather than by hoping the browser only offers a sensible picker.
 */
export const DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT = 36;

/** The maximum number of calendar months a trend may contain. */
export const DASHBOARD_TREND_MONTH_LIMIT = DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT;

export function isDashboardPeriodPreset(value: unknown): value is DashboardPeriodPreset {
  return (
    typeof value === 'string' && (DASHBOARD_PERIOD_PRESETS as readonly string[]).includes(value)
  );
}

export function isContributionDashboardBucket(
  value: unknown,
): value is ContributionDashboardBucket {
  return (
    typeof value === 'string' &&
    (CONTRIBUTION_DASHBOARD_BUCKETS as readonly string[]).includes(value)
  );
}

const MONEY_STRING_PATTERN = /^-?\d+\.\d{2}$/;

/**
 * Whether a value is one of the exact money strings this contract promises.
 *
 * The browser uses it to refuse a payload it cannot render exactly rather than formatting a
 * number it did not receive from the server, which is what the "no client-side authoritative
 * arithmetic" rule in `docs/02-ARCHITECTURE.md` ultimately protects.
 */
export function isExactMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_STRING_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBreakdownSlice(value: unknown): value is DashboardBreakdownSlice {
  return (
    isRecord(value) &&
    typeof value['key'] === 'string' &&
    typeof value['label'] === 'string' &&
    isExactMoneyString(value['amount']) &&
    typeof value['sharePercent'] === 'string' &&
    typeof value['customLabel'] === 'boolean'
  );
}

/**
 * Whether a breakdown's slices are all renderable.
 *
 * Checked so the browser refuses a chart whose parts it cannot label exactly, rather than
 * drawing a slice with a missing legend entry.
 */
export function areDashboardBreakdownSlices(
  value: unknown,
): value is readonly DashboardBreakdownSlice[] {
  return Array.isArray(value) && value.every(isBreakdownSlice);
}

/**
 * Narrows an unknown payload to a dashboard projection.
 *
 * A dashboard that renders `undefined` where an amount should be is worse than one that
 * refuses to render at all, so the browser validates the shape it depends on before it draws.
 * This is a structural check, not a semantic one: it proves the fields exist and have the right
 * primitive types. The *values* are the API's responsibility, which is exactly the split
 * `docs/02-ARCHITECTURE.md` wants — the browser never re-derives them.
 */
export function isDashboardView(value: unknown): value is DashboardView {
  if (!isRecord(value)) {
    return false;
  }

  const period = value['period'];
  const movement = value['movement'];
  const balances = value['balances'];
  const comparison = value['comparison'];
  const incomeBreakdown = value['incomeBreakdown'];
  const expenseBreakdown = value['expenseBreakdown'];
  const contributionStatus = value['contributionStatus'];

  if (
    !isRecord(period) ||
    typeof period['from'] !== 'string' ||
    typeof period['to'] !== 'string' ||
    typeof period['label'] !== 'string'
  ) {
    return false;
  }

  if (
    !isRecord(movement) ||
    !isExactMoneyString(movement['income']) ||
    !isExactMoneyString(movement['expenses']) ||
    !isExactMoneyString(movement['net'])
  ) {
    return false;
  }

  if (
    !isRecord(balances) ||
    !isExactMoneyString(balances['cash']) ||
    !isExactMoneyString(balances['upi']) ||
    !isExactMoneyString(balances['bank']) ||
    !isExactMoneyString(balances['total']) ||
    typeof balances['asOf'] !== 'string'
  ) {
    return false;
  }

  if (!isRecord(comparison) || !isExactMoneyString(comparison['income'])) {
    return false;
  }

  if (!isRecord(incomeBreakdown) || !areDashboardBreakdownSlices(incomeBreakdown['slices'])) {
    return false;
  }

  if (!isRecord(expenseBreakdown) || !areDashboardBreakdownSlices(expenseBreakdown['slices'])) {
    return false;
  }

  if (!isRecord(contributionStatus) || !Array.isArray(contributionStatus['months'])) {
    return false;
  }

  if (!Array.isArray(value['trend']) || !Array.isArray(value['recentTransactions'])) {
    return false;
  }

  return typeof value['memberCount'] === 'number' && Number.isInteger(value['memberCount']);
}

export type { ContributionStatus } from './members';
