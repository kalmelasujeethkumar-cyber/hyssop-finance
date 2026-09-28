import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { getAppEnvironment, type CookieSameSite } from '../config/environment';

/**
 * Session and CSRF cookie policy.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Set session cookies with HttpOnly, Secure in
 * production, SameSite, and a bounded expiry" and "Do not use localStorage for session
 * tokens") and `docs/06-API-SPEC.md` (login "sets the session cookie and returns the
 * rotated CSRF token").
 *
 * Every attribute comes from validated configuration, so the policy is inspectable and
 * testable instead of being scattered through controllers. Two rules are encoded here and
 * nowhere else:
 *
 * - The session cookie is always `HttpOnly`; script must never read the session.
 * - The CSRF cookie is deliberately **not** `HttpOnly`, because the browser has to copy
 *   its value into the `X-CSRF-Token` header. It is not a credential on its own: it is
 *   worthless without a matching server-side session or a live pre-auth row.
 */
@Injectable()
export class AuthCookieService {
  public constructor(private readonly config: ConfigService) {}

  /** Sets the session cookie. `expiresAt` is the session's absolute expiry. */
  public setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.names.session, token, {
      ...this.baseOptions(),
      httpOnly: true,
      expires: expiresAt,
    });
  }

  /**
   * Sets the CSRF cookie. The value is readable by script by design; the session cookie
   * is what proves authorization.
   */
  public setCsrfCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.names.csrf, token, {
      ...this.baseOptions(),
      httpOnly: false,
      expires: expiresAt,
    });
  }

  /** Removes both cookies. Used by logout and whenever a session is rejected. */
  public clearAuthCookies(response: Response): void {
    const options = { ...this.baseOptions(), httpOnly: true, expires: new Date(0) };

    response.clearCookie(this.names.session, options);
    // A cleared cookie must match the attributes it was set with or the browser keeps it.
    response.clearCookie(this.names.csrf, { ...options, httpOnly: false });
  }

  private get names(): { session: string; csrf: string } {
    const auth = getAppEnvironment(this.config).auth;

    return { session: auth.sessionCookieName, csrf: auth.csrfCookieName };
  }

  private baseOptions(): CookieOptions {
    const auth = getAppEnvironment(this.config).auth;

    // No `maxAge` here on purpose: a browser gives `Max-Age` precedence over `Expires`,
    // so a shared default would silently outlast the session's absolute expiry. Every
    // caller passes `expires` from the session or token lifetime instead.
    return {
      secure: auth.cookieSecure,
      sameSite: toExpressSameSite(auth.cookieSameSite),
      path: '/',
    };
  }
}

function toExpressSameSite(value: CookieSameSite): 'lax' | 'strict' | 'none' {
  return value;
}
