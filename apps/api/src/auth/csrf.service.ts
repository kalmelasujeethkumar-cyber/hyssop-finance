import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CsrfTokenResult } from '@hyssop/contracts';
import { csrfFailed } from '../common/errors/api-error';
import { getAppEnvironment } from '../config/environment';
import { AuthCsrfTokenRepository } from '../database/auth/auth-csrf-token.repository';
import { generateToken, hashToken, safeEqual, safeEqualHex } from './token.util';

const MINUTE_IN_MS = 60 * 1000;

export interface RequestOrigin {
  readonly origin: string;
}

/**
 * Two-token CSRF defence.
 *
 * Authority: `docs/07-SECURITY-RULES.md`:
 * - "Before login, the API issues a short-lived CSRF cookie and matching token bound to
 *   the trusted origin; login presents the token and the server rotates it after session
 *   creation."
 * - "Every state-changing request must carry the CSRF token in the `X-CSRF-Token`
 *   header, matched against the server-stored value for the session."
 *
 * The cookie is intentionally readable by JavaScript: the browser must copy it into the
 * header, and the header is what the server checks. The session cookie is the opposite —
 * HTTP-only, never readable by script. Double-submit alone is not trusted here: the
 * pre-auth token is a database row that expires and is consumed once, and the post-auth
 * secret is a hash stored on the session row, so a forged value cannot match.
 */
@Injectable()
export class CsrfService {
  public constructor(
    private readonly config: ConfigService,
    private readonly tokens: AuthCsrfTokenRepository,
  ) {}

  public ttlMs(): number {
    return getAppEnvironment(this.config).auth.csrfTtlMinutes * MINUTE_IN_MS;
  }

  /** Issues the pre-authentication token that `POST /auth/login` must present. */
  public async issuePreAuthToken(requestOrigin: RequestOrigin): Promise<CsrfTokenResult> {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs());

    await this.tokens.create({
      tokenHash: hashToken(token),
      origin: requestOrigin.origin,
      expiresAt,
    });

    return { csrfToken: token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Consumes the pre-authentication token pair for the trusted origin.
   *
   * The cookie and the header value must be present and equal, which is the "matching
   * token" the specification requires, and the header value must additionally resolve to a
   * live, unconsumed, unexpired `auth_csrf_token` row for this exact origin. Every failure —
   * missing, mismatched, unknown, already used, expired, or another origin — is the same
   * generic `CSRF_FAILED` error, so the response cannot be used to probe token state.
   */
  public async consumePreAuthToken(
    headerToken: string | undefined,
    cookieToken: string | undefined,
    requestOrigin: RequestOrigin,
  ): Promise<void> {
    if (
      headerToken === undefined ||
      cookieToken === undefined ||
      headerToken.length < 20 ||
      !safeEqual(headerToken, cookieToken)
    ) {
      throw csrfFailed();
    }

    const result = await this.tokens.consume(
      hashToken(headerToken),
      requestOrigin.origin,
      this.now(),
    );

    if (!result.consumed) {
      throw csrfFailed();
    }
  }

  /**
   * Validates the `X-CSRF-Token` header of a state-changing request against the hash
   * stored on the live session. Constant-time comparison, so a wrong value cannot be
   * discovered one character at a time.
   */
  public validateSessionToken(headerValue: string | undefined, storedCsrfTokenHash: string): void {
    if (headerValue === undefined || !safeEqualHex(hashToken(headerValue), storedCsrfTokenHash)) {
      throw csrfFailed();
    }
  }

  private now(): Date {
    return new Date();
  }
}
