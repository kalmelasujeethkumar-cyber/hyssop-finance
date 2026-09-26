/**
 * Exact INR money helpers.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (integer paise storage, strict decimal string
 * conversion at the API boundary) and `docs/01-REQUIREMENTS.md` (`REQ-FIN-003`,
 * `REQ-FIN-021`). Authoritative money is always a `bigint` count of paise; this
 * module never performs floating-point arithmetic and never uses `parseFloat`.
 */

/** PostgreSQL `BIGINT` upper bound, in paise. Amounts above it cannot be stored. */
export const MAX_PAISES = 9_223_372_036_854_775_807n;

export const PAISE_PER_RUPEE = 100n;

/** `1000`, `1000.5`, `1000.50` are accepted; exponent, sign, and grouping forms are not. */
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

export class MoneyFormatError extends Error {
  public constructor(reason: string) {
    super(`Invalid money value: ${reason}`);
    this.name = 'MoneyFormatError';
  }
}

/**
 * Strictly parses a decimal INR string into paise.
 *
 * Rejects negative, zero-signed, exponent, comma-grouped, and otherwise ambiguous
 * input instead of coercing it, as required by `REQ-FIN-021`.
 */
export function parsePaise(raw: string): bigint {
  const value = raw.trim();
  const match = DECIMAL_PATTERN.exec(value);

  if (match === null) {
    throw new MoneyFormatError(
      'expected a positive decimal amount with at most two fraction digits and no sign, exponent, or grouping',
    );
  }

  const whole = match[1];
  const fraction = match[2] ?? '0';

  if (whole === undefined) {
    throw new MoneyFormatError('the whole-rupee part is missing');
  }

  const paise = BigInt(whole) * PAISE_PER_RUPEE + BigInt(fraction.padEnd(2, '0'));

  if (paise > MAX_PAISES) {
    throw new MoneyFormatError('the amount exceeds the maximum supported value');
  }

  return paise;
}

/** Parses money and additionally rejects zero, matching the database `amount_paise > 0` rule. */
export function parsePositivePaise(raw: string): bigint {
  const paise = parsePaise(raw);

  if (paise === 0n) {
    throw new MoneyFormatError('the amount must be greater than zero');
  }

  return paise;
}

/**
 * Renders paise as the ungrouped decimal INR string used at the API boundary, for
 * example `1000` becomes `1000.00`. Presentation grouping and the rupee symbol are
 * owned by the web client, not by this layer.
 */
export function formatPaise(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const whole = absolute / PAISE_PER_RUPEE;
  const fraction = absolute % PAISE_PER_RUPEE;
  const sign = negative ? '-' : '';

  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

export function sumPaise(values: Iterable<bigint>): bigint {
  let total = 0n;

  for (const value of values) {
    total += value;
  }

  return total;
}

/** Derives the remaining amount of a contribution period, clamped at zero. */
export function remainingPaise(expectedPaise: bigint, receivedPaise: bigint): bigint {
  const remaining = expectedPaise - receivedPaise;
  return remaining > 0n ? remaining : 0n;
}
