import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  Version,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CSRF_TOKEN_HEADER,
  success,
  type CsrfTokenResult,
  type CurrentSessionResult,
  type LoginResult,
  type LogoutResult,
} from '@hyssop/contracts';
import type { Request, Response } from 'express';
import { getAppEnvironment } from '../config/environment';
import { CurrentSession, Public } from './auth.decorators';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { readCookie, readHeader, requestFingerprint, requestIdOf } from './request-context.util';
import { SessionService, type AuthenticatedSession } from './session.service';
import { TrustedOriginService } from './trusted-origin.service';

/**
 * The four authentication routes of `docs/06-API-SPEC.md`.
 *
 * `login`, `logout`, and `csrf` are public because a caller without a session has to be
 * able to obtain a token, sign in, and sign out. Each of them still enforces the trusted
 * origin, and `login` additionally consumes the pre-authentication CSRF token, so being
 * public does not mean being unguarded. `me` is deliberately **not** public: it is
 * protected by `SessionGuard` like every other route.
 */
@Controller('auth')
export class AuthController {
  public constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
    private readonly cookies: AuthCookieService,
    private readonly origins: TrustedOriginService,
  ) {}

  @Post('login')
  @Version('1')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body() body: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: LoginResult }> {
    const origin = this.origins.resolve(request);

    // The pre-authentication token is presented twice, as the specification requires: as
    // the `X-CSRF-Token` header and as the matching CSRF cookie. Both must agree and the
    // header value must resolve to a live, unconsumed, origin-bound token.
    await this.csrf.consumePreAuthToken(
      readHeader(request, CSRF_TOKEN_HEADER),
      readCookie(request, this.csrfCookieName),
      { origin },
    );

    const outcome = await this.auth.login({
      identifier: body.identifier,
      password: body.password,
      rateLimitKey: requestFingerprint(request),
      requestId: requestIdOf(request),
      ipHash: requestFingerprint(request),
    });

    const expiresAt = new Date(outcome.result.session.expiresAt);

    this.cookies.setSessionCookie(response, outcome.sessionToken, expiresAt);
    this.cookies.setCsrfCookie(response, outcome.result.csrfToken, expiresAt);

    return success(outcome.result);
  }

  /**
   * Server-side invalidation plus cookie clearing, returned as the canonical success
   * envelope. Idempotent by design: a browser that still holds a stale cookie must be able
   * to sign out, and the CSRF check is therefore applied only when a live session is
   * actually present. `revoked` reports honestly whether a live session was actually
   * revoked, and a failure to revoke is returned as an error, never as a success.
   */
  @Post('logout')
  @Version('1')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: LogoutResult }> {
    this.origins.assertTrusted(request);

    const session = await this.sessions.authenticate(readCookie(request, this.sessionCookieName));

    if (session === null) {
      this.cookies.clearAuthCookies(response);

      return success({ revoked: false });
    }

    this.csrf.validateSessionToken(readHeader(request, CSRF_TOKEN_HEADER), session.csrfTokenHash);

    await this.sessions.revoke(session.sessionId, 'LOGOUT', session.admin.id, {
      requestId: requestIdOf(request),
      ipHash: requestFingerprint(request),
    });

    this.cookies.clearAuthCookies(response);

    return success({ revoked: true });
  }

  @Get('me')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public me(@CurrentSession() session: AuthenticatedSession): { data: CurrentSessionResult } {
    return success({ admin: session.admin, session: session.context });
  }

  /**
   * Issues a CSRF secret. Before sign-in it is the short-lived, origin-bound
   * pre-authentication token that `login` requires, delivered as a matching cookie and
   * response token; with a live session it rotates the session's secret and refreshes the
   * readable cookie.
   */
  @Get('csrf')
  @Version('1')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async issueCsrfToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: CsrfTokenResult }> {
    const origin = this.origins.resolve(request);
    const session = await this.sessions.authenticate(readCookie(request, this.sessionCookieName));

    if (session === null) {
      const preAuth = await this.csrf.issuePreAuthToken({ origin });

      // The cookie carries the same short lifetime as the token, so an abandoned
      // pre-authentication cookie cannot outlive the row it must match.
      this.cookies.setCsrfCookie(response, preAuth.csrfToken, new Date(preAuth.expiresAt));

      return success(preAuth);
    }

    const csrfToken = await this.sessions.rotateCsrfToken(session.sessionId);
    const expiresAt = new Date(session.context.expiresAt);

    this.cookies.setCsrfCookie(response, csrfToken, expiresAt);

    return success({ csrfToken, expiresAt: expiresAt.toISOString() });
  }

  private get sessionCookieName(): string {
    return getAppEnvironment(this.config).auth.sessionCookieName;
  }

  private get csrfCookieName(): string {
    return getAppEnvironment(this.config).auth.csrfCookieName;
  }
}
