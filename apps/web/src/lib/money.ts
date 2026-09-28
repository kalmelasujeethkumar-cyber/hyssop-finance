/**
 * Exact INR presentation for the browser.
 *
 * Authority: `docs/03-UI-UX-RULES.md`: "Amounts use Indian grouping and the rupee symbol,
 * for example `₹12,50,000`. Raw paise or unformatted numbers must not be shown as
 * financial values."
 *
 * The API sends money as an exact decimal string such as `"500.00"`
 * (`REQ-FIN-021` and `docs/05-DATABASE-SPEC.md` require paise to be exact, and a JSON
 * number cannot represent every paise value). That string is formatted here by digit
 * manipulation and never converted to a JavaScript `number`, so no rounding or exponent
 * can occur on the way to the screen. Formatting for display is the one place a float
 * would be acceptable, and it is still avoided so the rendered value is provably the
 * stored value.
 */

/** The rupee sign, from the token set rather than a platform font's availability. */
const RUPEE = '₹';

/**
 * Formats an exact decimal amount with Indian digit grouping.
 *
 * The grouping is the Indian convention: the last three digits form one group and every
 * earlier group has two, so 1250000 reads `12,50,000` rather than `1,250,000`. A malformed
 * value is returned as a visible placeholder rather than silently rendered as `NaN` or
 * `₹0.00`, because a wrong amount on a financial screen is worse than an obvious
 * "unavailable" label.
 */
export function formatInr(amount: string): string {
  const parsed = parseDecimalAmount(amount);

  if (parsed === null) {
    return '—';
  }

  return `${RUPEE}${groupIndianDigits(parsed.rupees)}.${parsed.fraction}`;
}

/** The same grouping without the symbol, for a table cell that has its own column header. */
export function formatInrBare(amount: string): string {
  const formatted = formatInr(amount);

  return formatted === '—' ? formatted : formatted.slice(RUPEE.length);
}

/**
 * Indian digit grouping for a non-negative integer string.
 *
 * Handles a leading zero string without producing an empty group, and leaves a string
 * shorter than four digits untouched because it needs no separator.
 */
export function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }

  const lastThree = digits.slice(-3);
  const remaining = digits.slice(0, -3);
  const groups: string[] = [];

  // Counted from the right in pairs, which is what makes the first group able to be one or
  // two digits wide (`12,50,000` has a two-digit leading group).
  for (let end = remaining.length; end > 0; end -= 2) {
    groups.unshift(remaining.slice(Math.max(0, end - 2), end));
  }

  return `${groups.join(',')},${lastThree}`;
}

/**
 * Splits an exact decimal amount into its integer and two-digit fraction parts.
 *
 * Returns `null` for anything that is not a plain non-negative decimal with at most two
 * decimal places, which is exactly what the API guarantees for `expectedPaise` and the
 * derived money strings. A malformed value therefore fails loudly here instead of being
 * rounded into a plausible-looking number.
 */
export function parseDecimalAmount(amount: string): { rupees: string; fraction: string } | null {
  const trimmed = amount.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);

  if (match === null) {
    return null;
  }

  const [, rupees = '', fraction = ''] = match;

  return { rupees, fraction: fraction.padEnd(2, '0') };
}

/**
 * Compares two exact decimal amounts without converting either to a `number`.
 *
 * Used to decide whether a typed amount differs from the stored one before a write, and by
 * any display that must order amounts. Integer and fraction are compared as fixed-width
 * digit strings, which is exact for every value the API can produce.
 */
export function compareDecimalAmounts(left: string, right: string): number {
  const a = parseDecimalAmount(left);
  const b = parseDecimalAmount(right);

  if (a === null || b === null) {
    throw new RangeError('Only exact decimal amounts can be compared.');
  }

  const leftDigits = `${a.rupees}${a.fraction}`;
  const rightDigits = `${b.rupees}${b.fraction}`;

  if (leftDigits.length !== rightDigits.length) {
    return leftDigits.length - rightDigits.length;
  }

  return leftDigits === rightDigits ? 0 : leftDigits < rightDigits ? -1 : 1;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Formats a `YYYY-MM-DD` business date as `25 Sep 2026`.
 *
 * Authority: `docs/03-UI-UX-RULES.md` requires familiar Indian dates, always in
 * `Asia/Kolkata`, and forbids showing a raw ISO timestamp as a user-facing business date.
 * A business date is a calendar date with no time component, so it is parsed as plain
 * `YYYY-MM-DD` text and never run through `Date`: a UTC parse of a midnight date shifts
 * the day backwards for an IST reader, which is precisely the off-by-one business-date bug
 * this avoids.
 */
export function formatBusinessDate(businessDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate.trim());

  if (match === null) {
    return businessDate;
  }

  const [, year = '', month = '', day = ''] = match;
  const monthIndex = Number(month) - 1;
  const name = MONTHS[monthIndex];

  if (name === undefined) {
    return businessDate;
  }

  return `${Number(day)} ${name} ${year}`;
}

/** The month name for a 1-based month number, for a period label such as `Mar 2026`. */
export function formatMonthYear(year: number, month: number): string {
  const name = MONTHS[month - 1];

  return name === undefined ? `${month} ${year}` : `${name} ${year}`;
}

/**
 * Formats an API timestamp as an IST 12-hour timestamp, such as `02:45 PM`.
 *
 * Authority: `docs/03-UI-UX-RULES.md` ("Show times in 12-hour format", "never display a
 * raw ISO timestamp"). This is used for audit-style "when was this record touched" values,
 * not for a business date. `Asia/Kolkata` is a fixed +05:30 offset with no daylight
 * saving, so the shift is exact arithmetic and needs no time-zone database.
 */
const IST_OFFSET_MINUTES = 330;

export function formatIstTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  const ist = new Date(parsed.getTime() + IST_OFFSET_MINUTES * 60_000);
  const hours24 = ist.getUTCHours();
  const suffix = hours24 < 12 ? 'AM' : 'PM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');

  return `${hours12}:${minutes} ${suffix} on ${formatBusinessDate(ist.toISOString().slice(0, 10))}`;
}
