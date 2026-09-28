/**
 * Phone normalization for member records.
 *
 * Authority: `docs/01-REQUIREMENTS.md` (`REQ-MEM-005`) and `docs/05-DATABASE-SPEC.md`:
 * when a phone number is present it must contain 7 to 15 digits after removing spaces,
 * hyphens, parentheses, and an optional `+91` prefix, and "the same rule is enforced in
 * the UI, API, and database".
 *
 * This module is the single implementation of that rule. It lives in the shared contract
 * package precisely because the requirement is about *one* rule, and both applications
 * already depend on this package: a browser-side copy could drift from the server copy,
 * and the browser is not the enforcement point in any case, so a divergence would show up
 * as a form that rejects a number the API would have accepted.
 *
 * The stored value is national digits only. Presentation formatting belongs to the
 * API/UI boundary. The same normalized value is what the `member_phone_digits` database
 * CHECK constraint allows.
 */

export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

const COUNTRY_CODE_PREFIX = '91';

/**
 * A phone value that does not satisfy `REQ-MEM-005`.
 *
 * A plain `Error` subclass rather than a framework error, because the rule is
 * transport-agnostic: the API turns it into a field-level `VALIDATION_FAILED` at its own
 * boundary, and the browser turns it into an inline message.
 */
export class PhoneFormatError extends Error {
  public constructor(reason: string) {
    super(`Invalid phone value: ${reason}`);
    this.name = 'PhoneFormatError';
  }
}

/**
 * Normalizes a member phone value, or returns `null` when no phone was supplied.
 *
 * Removes spaces, hyphens, and parentheses, then an optional leading `+91`, and requires
 * 7 to 15 remaining digits.
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

/**
 * Validates without throwing, for form input where an error is expected and must be
 * reported inline rather than raised.
 */
export function phoneFormatMessage(raw: string | null | undefined): string | undefined {
  try {
    normalizePhone(raw);

    return undefined;
  } catch (error: unknown) {
    if (error instanceof PhoneFormatError) {
      return error.message;
    }

    throw error;
  }
}

function stripCountryCode(digits: string): string | null {
  if (!digits.startsWith(COUNTRY_CODE_PREFIX)) {
    return digits;
  }

  const remainder = digits.slice(COUNTRY_CODE_PREFIX.length);
  return remainder === '' ? null : remainder;
}
