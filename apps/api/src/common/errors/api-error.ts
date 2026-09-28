import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiFieldIssue } from '@hyssop/contracts';

export interface ApiErrorOptions {
  readonly fields?: readonly ApiFieldIssue[];
  /** Sent as `Retry-After` when present, so a client knows when to try again. */
  readonly retryAfterSeconds?: number;
}

/**
 * An error with an explicit, documented machine code and a safe client message.
 *
 * Authority: `docs/06-API-SPEC.md` ("Use stable machine codes and safe human messages")
 * and `docs/07-SECURITY-RULES.md` ("Login failures use a generic message"). The
 * exception filter only reflects the code and message of this type, so an internal
 * detail can never reach a browser even if a framework exception carries one.
 */
export class ApiError extends HttpException {
  public readonly code: ApiErrorCode;

  public readonly fields: readonly ApiFieldIssue[] | undefined;

  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    options: ApiErrorOptions = {},
  ) {
    super(
      { code, message, ...(options.fields === undefined ? {} : { fields: options.fields }) },
      status,
    );
    this.code = code;
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/**
 * The one response for every rejected credential. An unknown identifier, a wrong
 * password, and an unprovisioned account are indistinguishable from the outside, as
 * required by `docs/07-SECURITY-RULES.md`.
 */
export function invalidCredentials(): ApiError {
  return new ApiError(
    'INVALID_CREDENTIALS',
    'The identifier or password is incorrect.',
    HttpStatus.UNAUTHORIZED,
  );
}

export function unauthenticated(): ApiError {
  return new ApiError(
    'UNAUTHENTICATED',
    'Your session is missing or has expired. Please sign in again.',
    HttpStatus.UNAUTHORIZED,
  );
}

export function csrfFailed(): ApiError {
  return new ApiError(
    'CSRF_FAILED',
    'The security token for this request is missing or invalid. Please reload and try again.',
    HttpStatus.FORBIDDEN,
  );
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(
    'RATE_LIMITED',
    'Too many attempts. Please wait and try again.',
    HttpStatus.TOO_MANY_REQUESTS,
    { retryAfterSeconds },
  );
}

export function trustedOriginRequired(): ApiError {
  return new ApiError('FORBIDDEN', 'The request origin is not allowed.', HttpStatus.FORBIDDEN);
}
