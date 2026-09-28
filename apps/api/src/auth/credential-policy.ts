import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  LOGIN_IDENTIFIER_MAX_LENGTH,
  LOGIN_IDENTIFIER_MIN_LENGTH,
} from '@hyssop/contracts';

/**
 * Credential normalization and policy.
 *
 * Authority: `docs/07-SECURITY-RULES.md` (validate on the server, no plaintext
 * anywhere) and `docs/05-DATABASE-SPEC.md` (the identifier is stored lower-cased and
 * constrained to equal its own lower-case form). Password policy is length-only, which
 * is the modern guidance: composition rules push people toward predictable substitutions
 * without improving resistance to guessing. Rate limiting, not composition, is what
 * limits guessing here.
 */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface PasswordPolicyViolation {
  readonly field: 'password';
  readonly message: string;
}

/** Returns the violations for a candidate password, empty when it satisfies policy. */
export function checkPasswordPolicy(password: string): readonly PasswordPolicyViolation[] {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return [
      {
        field: 'password',
        message: `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`,
      },
    ];
  }

  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return [
      {
        field: 'password',
        message: `Password must be at most ${ADMIN_PASSWORD_MAX_LENGTH} characters.`,
      },
    ];
  }

  return [];
}

export function isValidIdentifier(identifier: string): boolean {
  return (
    identifier.length >= LOGIN_IDENTIFIER_MIN_LENGTH &&
    identifier.length <= LOGIN_IDENTIFIER_MAX_LENGTH
  );
}
