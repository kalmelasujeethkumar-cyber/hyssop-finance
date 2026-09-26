/**
 * Self-contained Asia/Kolkata date helpers for the demo seed.
 *
 * The seed runs as plain Node through `prisma db seed`, so it cannot import
 * framework code from `apps/api`. These helpers are deliberately small and duplicate
 * the API's `common/time/business-date` contract rather than reaching across build
 * boundaries; the database CHECK constraint on `business_date` remains the authority.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function parseBusinessDate(value: string): Date {
  const trimmed = value.trim();

  if (!BUSINESS_DATE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid business date "${trimmed}": expected YYYY-MM-DD.`);
  }

  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  const month = Number.parseInt(trimmed.slice(5, 7), 10);
  const day = Number.parseInt(trimmed.slice(8, 10), 10);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));

  if (
    utcMidnight.getUTCFullYear() !== year ||
    utcMidnight.getUTCMonth() !== month - 1 ||
    utcMidnight.getUTCDate() !== day
  ) {
    throw new Error(`Invalid business date "${trimmed}": the calendar date does not exist.`);
  }

  return utcMidnight;
}

export function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function businessDateFromInstant(instant: Date): Date {
  return parseBusinessDate(dateTimeFormatter.format(instant));
}

/**
 * First instant of the Asia/Kolkata day. The zone has observed UTC+05:30 without
 * daylight saving since 1945, so the boundary is exact for every date this demo uses.
 */
export function startOfBusinessDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), -5, -30, 0),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export interface YearMonth {
  readonly year: number;
  readonly month: number;
}

export function yearMonthOf(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function shiftMonth(year: number, month: number, offset: number): YearMonth {
  const index = year * 12 + (month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Builds a business date inside a month, clamped to that month's real length. */
export function businessDateInMonth(year: number, month: number, day: number): Date {
  const clamped = Math.min(Math.max(day, 1), lastDayOfMonth(year, month));
  return parseBusinessDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`,
  );
}
