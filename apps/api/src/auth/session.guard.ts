import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_TOKEN_HEADER } from '@hyssop/contracts';
import type { Request } from 'express';
import { unauthenticated } from '../common/errors/api-error';
import { getAppEnvironment } from '../config/environment';
import { IS_PUBLIC_ROUTE } from './auth.decorators';
import { CsrfService } from './csrf.service';
import { resolveTrustedOrigin } from './request-origin';
import { SessionService, type AuthenticatedSession } from './session.service';

declare module 'express-serve-static-core' {
  interface Request {
    session?: AuthenticatedSession;
    trustedOrigin?: string;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session and CSRF enforcement for every route that is not explicitly public.
 *
 * Authority: `docs/06-API-SPEC.md` ("All routes except `GET /api/v1/health` and the
 * authentication routes require a valid session") and `docs/07-SECURITY-RULES.md`
 * ("Reject unauthenticated access to non-public routes", "Every state-changing request
 * must carry the CSRF token in the `X-CSRF-Token` header", "Deny cross-origin
 * state-changing requests").
 *
 * Order matters and is deliberate:
 *
 * 1. **Session first.** A request without a live session is rejected before any CSRF
 *    work, so an unauthenticated caller cannot make the server verify tokens.
 * 2. **Trusted origin for state-changing methods.** Refused even when the session is
 *    valid, because a valid session does not make a cross-site request legitimate.
 * 3. **CSRF header last.** Read only for methods that change state, matched in constant
 *    time against the hash stored on the session row.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const environment = getAppEnvironment(this.config);
    const token = readCookie(request, environment.auth.sessionCookieName);
    const session = await this.sessions.authenticate(token);

    if (session === null) {
      throw unauthenticated();
    }

    request.session = session;

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    request.trustedOrigin = resolveTrustedOrigin(request.headers, environment.corsAllowedOrigins);

    const headerValue = request.headers[CSRF_TOKEN_HEADER];
    this.csrf.validateSessionToken(
      typeof headerValue === 'string' ? headerValue : undefined,
      session.csrfTokenHash,
    );

    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}

function readCookie(request: Request, name: string): string | undefined {
  // `cookie-parser` populates `cookies`, which the Express types leave as `any`; the
  // assertion narrows it to the one shape this code accepts.
  const cookies = request.cookies as Record<string, string> | undefined;
  const value = cookies?.[name];

  return typeof value === 'string' ? value : undefined;
}
