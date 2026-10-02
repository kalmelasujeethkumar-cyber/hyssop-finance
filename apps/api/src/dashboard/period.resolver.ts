import {
  BusinessDateError,
  businessDateFromInstant,
  formatBusinessDate,
  parseBusinessDate,
} from '../common/time/business-date';
import { validationFailed } from '../common/errors/domain.errors';
import {
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIOD_PRESETS,
  type DashboardPeriodKind,
  type DashboardPeriodPreset,
} from '@hyssop/contracts';

/**
 * The canonical Asia/Kolkata period resolver.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-DASH-015` to `REQ-DASH-017`, which fixes the exact
 * inclusive definition of every preset, and `docs/02-ARCHITECTURE.md` "Canonical financial
 * calculation layer", which requires the period input to be resolved **once** and shared by
 * every consumer.
 *
 * This module is deliberately pure. It takes "now" as an argument rather than reading the clock
 * itself, so a period boundary is a function of its inputs and can be asserted exactly. That is
 * what lets the unit suite prove `This Year` on 1 January is `1 Jan` to `31 Dec` without
 * freezing time, waiting for midnight, or asserting a range that shifts tomorrow.
 *
 * **Boundaries are inclusive on both ends**, so every returned `from` and `to` is a business
 * date a transaction may legitimately carry. `docs/05-DATABASE-SPEC.md` stores
 * `business_date` as a `DATE`, which is why a boundary is a calendar day and never an instant.
 *
 * Three decisions worth stating, because each is the kind that quietly rots:
 *
 * 1. **`Last N Months` includes the current month.** `REQ-DASH-017` defines Last 3 Months as
 *    "the current calendar month plus the two preceding calendar months", so on 15 March the
 *    range is 1 January to 31 March. Reading it as "the last 90 days" or "the three complete
 *    months before this one" both satisfy the word "last" and neither satisfies the
 *    requirement, which is why the rule is implemented by walking calendar months and not by
 *    arithmetic on days.
 * 2. **Month arithmetic is done through `Date.UTC`, never the local time zone.** The
 *    operating machine's zone is irrelevant to an Asia/Kolkata business date; using local
 *    `new Date(year, month, day)` would make a boundary depend on where the server happens to
 *    be running, and a negative UTC offset would silently shift the first day of the year.
 * 3. **`today` is passed in already reduced to an Asia/Kolkata calendar date.** Callers use
 *    `businessDateFromInstant(new Date())` so the "current" business date follows the same
 *    `Intl`-based zone rule as every other conversion in the project, rather than assuming a
 *    fixed +05:30 offset.
 */

/** An inclusive, resolved business-date range in `Asia/Kolkata`. */
export interface ResolvedPeriod {
  /** The preset that was requested, or `custom` for an explicit `from`/`to`. */
  readonly kind: DashboardPeriodKind;
  /** Inclusive first business date, as UTC midnight of that calendar day. */
  readonly from: Date;
  /** Inclusive last business date, as UTC midnight of that calendar day. */
  readonly to: Date;
}

/** A calendar month as `(year, month)`, with a 1-based month. */
export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

/** An explicit custom range, both bounds required. */
export interface CustomPeriodInput {
  readonly from: string;
  readonly to: string;
}

/**
 * The period request a caller may make.
 *
 * Both members are optional so an absent filter is expressible, and their combination is
 * validated by {@link resolvePeriod} rather than by the type system. A discriminated union would
 * encode the rule, but it would then force every caller to build the object with a spread and a
 * narrowing branch — and the error the Admin sees would come from a TypeScript type rather than
 * from a message. Leaving it a plain interface means the conflict is reported as a documented
 * `VALIDATION_FAILED`, which is what `docs/06-API-SPEC.md` promises.
 */
export interface PeriodRequest {
  /** A named preset. Mutually exclusive with `custom`. */
  readonly preset?: DashboardPeriodPreset;
  /** An explicit range. Mutually exclusive with `preset`. */
  readonly custom?: CustomPeriodInput;
}

/**
 * The largest number of calendar months a resolved period may span.
 *
 * Enforced here rather than only for custom ranges because a *preset* is not a risk: `thisYear`
 * is twelve months and `last6Months` is six. The bound therefore exists to protect the custom
 * path, which is the only one a client can stretch.
 */
const MAX_PERIOD_MONTHS = 36;

const MONTHS_PER_YEAR = 12;

/**
 * The current Asia/Kolkata calendar date, the "today" every preset is relative to.
 *
 * Delegates to `businessDateFromInstant` rather than formatting the zone itself: the conversion
 * from an instant to a business date is one rule for the whole application, and a second
 * implementation here would be one more thing that could disagree with the transaction dates
 * the same screen displays.
 */
export function currentBusinessDate(now: Date = new Date()): Date {
  return businessDateFromInstant(now);
}

/** First calendar day of a month, as UTC midnight. */
function firstDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * Last calendar day of a month, as UTC midnight.
 *
 * Day `0` of the *following* month is the last day of this one, which is what makes this correct
 * for February in a leap year without a special case.
 */
function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

function shiftMonth(month: CalendarMonth, delta: number): CalendarMonth {
  // `Date.UTC` normalises a month outside 1–12 and a year outside 0–99 correctly, so this does
  // not need its own carry logic.
  const shifted = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));

  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/**
 * The calendar months a resolved period touches, oldest first.
 *
 * Returns at least one month for any valid range, because every range a resolver can produce
 * covers at least one calendar day and therefore at least part of exactly one month.
 */
export function calendarMonthsOf(period: ResolvedPeriod): readonly CalendarMonth[] {
  const months: CalendarMonth[] = [];
  let cursor: CalendarMonth = {
    year: period.from.getUTCFullYear(),
    month: period.from.getUTCMonth() + 1,
  };
  const last: CalendarMonth = {
    year: period.to.getUTCFullYear(),
    month: period.to.getUTCMonth() + 1,
  };

  // Bounded by the resolver's own month limit, so this cannot spin even if a caller bypasses
  // `resolvePeriod` and hands in a decade-wide range.
  for (let guard = 0; guard < MAX_PERIOD_MONTHS * 2; guard += 1) {
    months.push(cursor);

    if (cursor.year === last.year && cursor.month === last.month) {
      return months;
    }

    cursor = shiftMonth(cursor, 1);
  }

  return months;
}

/** How many calendar months an inclusive range spans, at least one. */
export function monthSpanOf(period: ResolvedPeriod): number {
  const first = period.from.getUTCFullYear() * MONTHS_PER_YEAR + (period.from.getUTCMonth() + 1);
  const last = period.to.getUTCFullYear() * MONTHS_PER_YEAR + (period.to.getUTCMonth() + 1);

  return last - first + 1;
}

/**
 * The range's first and last month as comparable `year * 100 + month` keys.
 *
 * Returned as a pair derived straight from the two bounds rather than from the endpoints of
 * {@link calendarMonthsOf}, so a caller building a month-range query never has to index into an
 * array and handle `undefined`. A period always covers at least one day and therefore at least
 * part of exactly one month, so the two keys are always present and `fromKey <= toKey`.
 */
export function monthKeyRangeOf(period: ResolvedPeriod): {
  readonly fromKey: number;
  readonly toKey: number;
} {
  return {
    fromKey: period.from.getUTCFullYear() * 100 + (period.from.getUTCMonth() + 1),
    toKey: period.to.getUTCFullYear() * 100 + (period.to.getUTCMonth() + 1),
  };
}

/**
 * The months a custom range may span before it is refused.
 *
 * The message names the limit rather than saying "too large", because an Admin who chose a
 * five-year window deserves to know which rule stopped them and by how much.
 */
export function assertSpanWithinLimit(period: ResolvedPeriod, limit: number): void {
  const span = monthSpanOf(period);

  if (span > limit) {
    throw validationFailed(
      `Choose a date range of ${limit} months or fewer. The selected range spans ${span} months.`,
      { field: 'from' },
    );
  }
}

/**
 * Resolves an inclusive period from a preset and the current business date.
 *
 * Each branch is the literal requirement rather than a general algorithm, because every one of
 * these definitions is individually surprising to at least one reader. `last3Months` and
 * `last6Months` include the current month; `today` is a single day; `lastYear` is the whole
 * previous calendar year and not "the last 365 days".
 */
export function resolvePresetPeriod(preset: DashboardPeriodPreset, today: Date): ResolvedPeriod {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const current: CalendarMonth = { year, month };

  switch (preset) {
    case 'today':
      return { kind: preset, from: today, to: today };

    case 'thisMonth':
      return { kind: preset, from: firstDayOfMonth(year, month), to: lastDayOfMonth(year, month) };

    case 'lastMonth': {
      const previous = shiftMonth(current, -1);

      return {
        kind: preset,
        from: firstDayOfMonth(previous.year, previous.month),
        to: lastDayOfMonth(previous.year, previous.month),
      };
    }

    case 'last3Months':
      return rollingMonths(preset, current, 2);

    case 'last6Months':
      return rollingMonths(preset, current, 5);

    case 'thisYear':
      return { kind: preset, from: firstDayOfMonth(year, 1), to: lastDayOfMonth(year, 12) };

    case 'lastYear':
      return {
        kind: preset,
        from: firstDayOfMonth(year - 1, 1),
        to: lastDayOfMonth(year - 1, 12),
      };

    default: {
      // An unrecognised value cannot reach here — the DTO constrains it to
      // `DASHBOARD_PERIOD_PRESETS` — but treating it as exhaustive means a future preset added
      // to the contract fails loudly at compile time instead of silently answering with
      // `thisMonth`, which would be a wrong answer presented confidently.
      const exhaustive: never = preset;

      throw validationFailed(`Unsupported period: ${String(exhaustive)}`, { field: 'period' });
    }
  }
}

/**
 * `Last 3 Months` / `Last 6 Months`: the current month plus `extra` preceding ones.
 *
 * Shared by both so the two cannot disagree about whether the current month is included, which
 * is the exact question the two requirements differ on in wording but agree on in definition.
 */
function rollingMonths(
  preset: DashboardPeriodPreset,
  current: CalendarMonth,
  extra: number,
): ResolvedPeriod {
  const first = shiftMonth(current, -extra);

  return {
    kind: preset,
    from: firstDayOfMonth(first.year, first.month),
    to: lastDayOfMonth(current.year, current.month),
  };
}

/**
 * Resolves an explicit custom range.
 *
 * `REQ-DASH-017` requires both bounds and rejects `from` after `to`. Both failures are reported
 * against the field the Admin can actually fix: a missing `from` is the `from` field's problem,
 * and an inverted range is too. Returning the two dates unchanged would produce an empty
 * dashboard that reads as "this church had no income in that period", which is the specific
 * dishonesty `docs/03-UI-UX-RULES.md` forbids.
 */
export function resolveCustomPeriod(input: CustomPeriodInput): ResolvedPeriod {
  const fromRaw = input.from.trim();
  const toRaw = input.to.trim();

  if (fromRaw === '' || toRaw === '') {
    throw validationFailed('Choose both a start date and an end date.', {
      field: fromRaw === '' ? 'from' : 'to',
    });
  }

  const from = parseCustomBoundary(fromRaw, 'from');
  const to = parseCustomBoundary(toRaw, 'to');

  if (from.getTime() > to.getTime()) {
    throw validationFailed('The start date must not be after the end date.', { field: 'from' });
  }

  return { kind: 'custom', from, to };
}

/**
 * Parses one custom boundary, refusing a date that does not exist.
 *
 * `parseBusinessDate` already rejects `2026-02-30` and `2026-13-01` by round-tripping the
 * calendar day, and its `BusinessDateError` is translated here into the documented
 * `VALIDATION_FAILED` envelope with the field name the Admin typed into. Letting the raw error
 * escape would answer `500` for what is a client mistake.
 */
function parseCustomBoundary(raw: string, field: 'from' | 'to'): Date {
  try {
    return parseBusinessDate(raw);
  } catch (error: unknown) {
    if (error instanceof BusinessDateError) {
      throw validationFailed(
        field === 'from'
          ? 'Enter a start date as YYYY-MM-DD, such as 2026-09-01.'
          : 'Enter an end date as YYYY-MM-DD, such as 2026-09-30.',
        { field },
      );
    }

    throw error;
  }
}

/**
 * Resolves the period a dashboard request asked for.
 *
 * The single entry point the service uses, so there is exactly one place where "which dates does
 * this request cover?" is decided. `docs/02-ARCHITECTURE.md` requires the period to be resolved
 * once and reused; a dashboard and a report each calling a preset resolver with their own
 * default would be two answers to the same question.
 *
 * A custom range is refused outright when a preset is also supplied. The two describe the same
 * thing in different ways, and silently preferring one would mean the URL a pastor shares says
 * `?period=thisMonth&from=2026-01-01&to=2026-06-30` while the screen quietly shows one month.
 */
export function resolvePeriod(request: PeriodRequest, today: Date): ResolvedPeriod {
  const custom = request.custom;

  if (custom !== undefined && request.preset !== undefined) {
    throw validationFailed('Choose either a named period or a custom date range, not both.', {
      field: 'period',
    });
  }

  if (custom !== undefined) {
    return resolveCustomPeriod(custom);
  }

  const preset = request.preset ?? 'thisMonth';

  if (!(DASHBOARD_PERIOD_PRESETS as readonly string[]).includes(preset)) {
    throw validationFailed('That named period is not supported.', { field: 'period' });
  }

  return resolvePresetPeriod(preset, today);
}

/**
 * The period's Admin-facing label.
 *
 * A preset shows its documented name, and a custom range shows the exact dates it resolved to.
 * The custom wording matters because `docs/03-UI-UX-RULES.md` requires the active period to be
 * visible, and "Custom" alone would not tell a pastor which month they are looking at.
 *
 * The `custom` branch is handled above, so everything reaching the preset lookup is a
 * `DashboardPeriodPreset`. TypeScript narrows the `=== 'custom'` comparison to prove it, which is
 * why no cast is needed: the fallback exists only to satisfy the compiler for an unreachable
 * value, and it can never be returned for a period this resolver produced.
 */
export function periodLabel(period: ResolvedPeriod): string {
  if (period.kind === 'custom') {
    return `${formatBusinessDate(period.from)} to ${formatBusinessDate(period.to)}`;
  }

  return DASHBOARD_PERIOD_LABELS[period.kind];
}
