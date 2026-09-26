/**
 * Asia/Kolkata business dates.
 *
 * Authority: `docs/03-UI-UX-RULES.md` and `docs/05-DATABASE-SPEC.md`: `business_date` is
 * the Asia/Kolkata accounting date, and `occurred_at` is the recorded instant. The
 * conversion uses the IANA time zone through `Intl` rather than a hard-coded offset so
 * the result stays correct if the zone rules ever change.
 *
 * `business_date` is a PostgreSQL `DATE`, so a business date is always carried as a
 * `Date` at UTC midnight of that calendar day. Every period filter compares
 * `business_date`, never `occurred_at`.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class BusinessDateError extends Error {
  public constructor(reason: string) {
    super(`Invalid business date: ${reason}`);
    this.name = 'BusinessDateError';
  }
}

/** Parses a `YYYY-MM-DD` business date into a UTC-midnight `Date`. */
export function parseBusinessDate(value: string): Date {
  const trimmed = value.trim();

  if (!BUSINESS_DATE_PATTERN.test(trimmed)) {
    throw new BusinessDateError('expected the YYYY-MM-DD format');
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
    throw new BusinessDateError('the calendar date does not exist');
  }

  return utcMidnight;
}

/** Renders a business date as `YYYY-MM-DD`. */
export function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the Asia/Kolkata calendar date of an instant as a UTC-midnight `Date`. */
export function businessDateFromInstant(instant: Date): Date {
  return parseBusinessDate(dateTimeFormatter.format(instant));
}

/** Returns the first instant of the Asia/Kolkata day that contains `date`. */
export function startOfBusinessDay(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // Asia/Kolkata has observed UTC+05:30 without daylight saving since 1945, so the
  // day boundary is exact for every date this application can store.
  return new Date(Date.UTC(year, month, day, -5, -30, 0));
}

/** Returns the last instant of the Asia/Kolkata day that contains `date`. */
export function endOfBusinessDay(date: Date): Date {
  const start = startOfBusinessDay(date);
  return new Date(start.getTime() + 86_400_000 - 1);
}

/** First and last instants of a business month, used for monthly contribution queries. */
export function businessMonthRange(
  year: number,
  month: number,
): { readonly from: Date; readonly to: Date } {
  const from = parseBusinessDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`,
  );
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = parseBusinessDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  );

  return { from, to };
}
