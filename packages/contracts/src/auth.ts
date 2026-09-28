/**
 * Authentication contract for the single Admin role.
 *
 * Owned by `docs/06-API-SPEC.md` and shaped by `docs/07-SECURITY-RULES.md`. Both
 * applications depend on this module, so a change to a login payload, an Admin
 * profile, or a session context cannot drift between the API and the browser.
 *
 * No secret ever crosses this boundary: a session token stays in an HTTP-only cookie,
 * and the CSRF token is the only value the browser is allowed to read back.
 */

export const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * The documented unusable-credential sentinel. It marks an `admin_user` row that exists
 * as a financial actor but has no provisioned password, so verification can never
 * succeed against it. `prisma/seed.ts` uses the same literal; the seed and the API
 * must agree, and neither may substitute a real hash.
 */
export const UNPROVISIONED_PASSWORD_HASH = '!unprovisioned';

export const LOGIN_IDENTIFIER_MIN_LENGTH = 3;
export const LOGIN_IDENTIFIER_MAX_LENGTH = 64;

/** Documented password policy. Length is the only composition rule. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

export interface AdminProfile {
  readonly id: string;
  readonly identifier: string;
  readonly displayName: string;
}

export interface SessionContext {
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface LoginResult {
  readonly admin: AdminProfile;
  readonly session: SessionContext;
  readonly csrfToken: string;
}

export interface CurrentSessionResult {
  readonly admin: AdminProfile;
  readonly session: SessionContext;
}

export interface CsrfTokenResult {
  readonly csrfToken: string;
  readonly expiresAt: string;
}

/**
 * The result of `POST /auth/logout`.
 *
 * Logout is a normal enveloped response, not a bodyless status, because
 * `docs/06-API-SPEC.md` requires every successful response to carry the standard `data`
 * property. `revoked` distinguishes the two honest outcomes: a live session was revoked, or
 * there was nothing to revoke because the caller was already signed out. It is never
 * reported as `true` when server-side revocation did not happen, because a failed
 * revocation is returned as an error instead.
 */
export interface LogoutResult {
  readonly revoked: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isAdminProfile(value: unknown): value is AdminProfile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['identifier'] === 'string' &&
    typeof value['displayName'] === 'string' &&
    value['displayName'].length > 0
  );
}

export function isSessionContext(value: unknown): value is SessionContext {
  if (!isRecord(value)) {
    return false;
  }

  return isIsoInstant(value['issuedAt']) && isIsoInstant(value['expiresAt']);
}

export function isLoginResult(value: unknown): value is LoginResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isAdminProfile(value['admin']) &&
    isSessionContext(value['session']) &&
    typeof value['csrfToken'] === 'string' &&
    value['csrfToken'].length > 0
  );
}

export function isCurrentSessionResult(value: unknown): value is CurrentSessionResult {
  if (!isRecord(value)) {
    return false;
  }

  return isAdminProfile(value['admin']) && isSessionContext(value['session']);
}

export function isCsrfTokenResult(value: unknown): value is CsrfTokenResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['csrfToken'] === 'string' &&
    value['csrfToken'].length > 0 &&
    isIsoInstant(value['expiresAt'])
  );
}

export function isLogoutResult(value: unknown): value is LogoutResult {
  return isRecord(value) && typeof value['revoked'] === 'boolean';
}
