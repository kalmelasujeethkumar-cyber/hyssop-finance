import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token generation and hashing.
 *
 * Authority: `docs/02-ARCHITECTURE.md` ("an opaque, revocable server-side session
 * stored as a hash in PostgreSQL") and `docs/05-DATABASE-SPEC.md` (only the SHA-256
 * hash is persisted). Tokens are 256 bits from the platform CSPRNG, encoded base64url
 * so they are cookie-safe, and are never logged: every function here returns either a
 * fresh secret or a hash, and no caller has a reason to log either.
 */
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The only representation of a token that is ever persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests of equal length. A session or CSRF
 * secret must not be discoverable by measuring how long a comparison takes.
 */
export function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[0-9a-f]+$/.test(left) || !/^[0-9a-f]+$/.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/**
 * Constant-time comparison of two raw token strings, used to require that the CSRF
 * cookie and the `X-CSRF-Token` header present the same value. The digests are compared
 * rather than the raw strings so the comparison always operates on equal-length input and
 * no early return can leak the secret it is checking.
 */
export function safeEqual(left: string, right: string): boolean {
  return safeEqualHex(hashToken(left), hashToken(right));
}

/**
 * A stable, non-reversible fingerprint of a network address, so audit rows and rate
 * limits can correlate requests without storing the address itself. The salt is a
 * documented constant rather than a secret: the goal is to avoid retaining a personal
 * identifier in the audit trail, not to resist an attacker who already holds the whole
 * table, and a per-process random salt would make `ip_hash` values incomparable between
 * restarts, which is exactly what an investigation needs them to be.
 */
const FINGERPRINT_SALT = 'hyssop-finance-fingerprint-v1';

export function fingerprint(value: string): string {
  return createHash('sha256').update(`${FINGERPRINT_SALT}:${value}`, 'utf8').digest('hex');
}
