/**
 * Phone normalization for member records.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` and `docs/01-REQUIREMENTS.md`
 * (`REQ-MEM-005`). The stored value is national digits only; presentation formatting
 * belongs to the API/UI boundary. The same rule is enforced here, in the API, and by
 * the `member_phone_digits` database CHECK constraint.
 */

export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

const COUNTRY_CODE_PREFIX = '91';

export class PhoneFormatError extends Error {
  public constructor(reason: string) {
    super(`Invalid phone value: ${reason}`);
    this.name = 'PhoneFormatError';
  }
}

/**
 * Normalizes a member phone value, or returns `null` when no phone was supplied.
 *
 * Removes spaces, hyphens, and parentheses, then an optional leading `+91`, and
 * requires 7 to 15 remaining digits.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed === '') {
    return null;
  }

  const digits = trimmed.replace(/[\s()-]/g, '');

  if (!/^\+?\d+$/.test(digits)) {
    throw new PhoneFormatError(
      'only digits, spaces, hyphens, parentheses, and an optional +91 are allowed',
    );
  }

  const national = digits.startsWith('+')
    ? stripCountryCode(digits.slice(1))
    : stripCountryCode(digits);

  if (national === null) {
    throw new PhoneFormatError('the country code is not allowed without a national number');
  }

  if (national.length < PHONE_MIN_DIGITS || national.length > PHONE_MAX_DIGITS) {
    throw new PhoneFormatError(
      `expected ${PHONE_MIN_DIGITS} to ${PHONE_MAX_DIGITS} national digits`,
    );
  }

  return national;
}

function stripCountryCode(digits: string): string | null {
  if (!digits.startsWith(COUNTRY_CODE_PREFIX)) {
    return digits;
  }

  const remainder = digits.slice(COUNTRY_CODE_PREFIX.length);
  return remainder === '' ? null : remainder;
}
