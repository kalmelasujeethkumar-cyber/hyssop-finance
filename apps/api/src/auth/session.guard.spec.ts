import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_TOKEN_HEADER } from '@hyssop/contracts';
import type { Request } from 'express';
import { Public } from './auth.decorators';
import { csrfFailed } from '../common/errors/api-error';
import { CsrfService } from './csrf.service';
import { SessionService, type AuthenticatedSession } from './session.service';
import { SessionGuard } from './session.guard';
import { hashToken } from './token.util';
import {
  TEST_AUTH_ENVIRONMENT,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
} from '../../test/support/test-application';

const SESSION_TOKEN = 'a'.repeat(43);
const CSRF_TOKEN = 'b'.repeat(43);
const UNTRUSTED_ORIGIN = 'https://evil.example';

const LIVE_SESSION: AuthenticatedSession = {
  sessionId: 'session-id',
  admin: { id: 'admin-id', identifier: 'admin', displayName: 'Admin' },
  csrfTokenHash: hashToken(CSRF_TOKEN),
  context: { issuedAt: '2026-09-26T12:00:00.000Z', expiresAt: '2026-09-26T20:00:00.000Z' },
};

/**
 * The opt-out is declared on the class here. Handler-level `@Public()` is what the real
 * authentication routes use, and it is covered end to end by
 * `test/database/auth-http.db-spec.ts`; the guard only cares that the metadata is found on
 * the handler or its class.
 */
@Public()
class PublicController {}

class ProtectedController {}

interface RouteFixture {
  readonly handler: () => void;
  readonly controller: unknown;
}

const PUBLIC_ROUTE: RouteFixture = {
  handler: () => undefined,
  controller: PublicController,
};

const PROTECTED_ROUTE: RouteFixture = {
  handler: () => undefined,
  controller: ProtectedController,
};

interface Harness {
  readonly guard: SessionGuard;
  readonly sessions: { authenticate: jest.Mock };
  readonly csrf: { validateSessionToken: jest.Mock };
}

function createGuard(session: AuthenticatedSession | null): Harness {
  const sessions = { authenticate: jest.fn().mockResolvedValue(session) };
  // The real comparison is used, so the guard is tested against the behaviour it depends
  // on rather than against a mock that can never fail.
  const csrf = {
    validateSessionToken: jest.fn((token: string | undefined, storedHash: string) => {
      if (token === undefined || hashToken(token) !== storedHash) {
        throw csrfFailed();
      }
    }),
  };

  return {
    guard: new SessionGuard(
      new Reflector(),
      new ConfigService({ environment: TEST_ENVIRONMENT }),
      sessions as unknown as SessionService,
      csrf as unknown as CsrfService,
    ),
    sessions,
    csrf,
  };
}

function contextFor(
  request: Partial<Request>,
  route: RouteFixture = PROTECTED_ROUTE,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => route.handler,
    getClass: () => route.controller,
  } as unknown as ExecutionContext;
}

function requestWith(
  method: string,
  options: { origin?: string; session?: string; csrf?: string } = {},
): Partial<Request> {
  const cookies: Record<string, string> = {};

  if (options.session !== undefined) {
    cookies[TEST_AUTH_ENVIRONMENT.sessionCookieName] = options.session;
  }
  if (options.csrf !== undefined) {
    cookies[TEST_AUTH_ENVIRONMENT.csrfCookieName] = options.csrf;
  }

  const headers: Record<string, string> = {};
  if (options.origin !== undefined) {
    headers['origin'] = options.origin;
  }
  if (options.csrf !== undefined) {
    headers[CSRF_TOKEN_HEADER] = options.csrf;
  }

  return { method, cookies, headers };
}

describe('SessionGuard', () => {
  describe('public routes', () => {
    it('lets a request through without a session and without checking CSRF', async () => {
      const harness = createGuard(null);
      const request = requestWith('POST', { origin: UNTRUSTED_ORIGIN });

      await expect(harness.guard.canActivate(contextFor(request, PUBLIC_ROUTE))).resolves.toBe(
        true,
      );
      expect(harness.sessions.authenticate).not.toHaveBeenCalled();
      expect(harness.csrf.validateSessionToken).not.toHaveBeenCalled();
    });
  });

  describe('protected read requests', () => {
    it('rejects a request with no session', async () => {
      const harness = createGuard(null);

      await expect(harness.guard.canActivate(contextFor(requestWith('GET')))).rejects.toMatchObject(
        { code: 'UNAUTHENTICATED' },
      );
    });

    it('resolves the session, publishes it on the request, and skips CSRF for a safe method', async () => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith('GET', { session: SESSION_TOKEN });

      await expect(harness.guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(request.session).toBe(LIVE_SESSION);
      expect(harness.csrf.validateSessionToken).not.toHaveBeenCalled();
    });

    it('does not require an origin for a safe method', async () => {
      const harness = createGuard(LIVE_SESSION);

      await expect(
        harness.guard.canActivate(contextFor(requestWith('GET', { session: SESSION_TOKEN }))),
      ).resolves.toBe(true);
    });
  });

  describe('protected state-changing requests', () => {
    it('accepts a trusted origin with the matching CSRF token', async () => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith('POST', {
        origin: TEST_ORIGIN,
        session: SESSION_TOKEN,
        csrf: CSRF_TOKEN,
      });

      await expect(harness.guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(harness.csrf.validateSessionToken).toHaveBeenCalledWith(
        CSRF_TOKEN,
        LIVE_SESSION.csrfTokenHash,
      );
      expect(request.trustedOrigin).toBe(TEST_ORIGIN);
    });

    it('refuses a cross-site mutation even with a valid session', async () => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith('POST', {
        origin: UNTRUSTED_ORIGIN,
        session: SESSION_TOKEN,
        csrf: CSRF_TOKEN,
      });

      await expect(harness.guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      // The origin is refused before any CSRF comparison happens.
      expect(harness.csrf.validateSessionToken).not.toHaveBeenCalled();
    });

    it('refuses a mutation with no CSRF header', async () => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith('POST', { origin: TEST_ORIGIN, session: SESSION_TOKEN });

      await expect(harness.guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'CSRF_FAILED',
      });
      expect(harness.csrf.validateSessionToken).toHaveBeenCalledWith(
        undefined,
        LIVE_SESSION.csrfTokenHash,
      );
    });

    it('refuses a mutation with a wrong CSRF token', async () => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith('POST', {
        origin: TEST_ORIGIN,
        session: SESSION_TOKEN,
        csrf: 'c'.repeat(43),
      });

      await expect(harness.guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'CSRF_FAILED',
      });
    });

    it('rejects an unauthenticated mutation before doing any CSRF work', async () => {
      const harness = createGuard(null);
      const request = requestWith('POST', { origin: TEST_ORIGIN, csrf: CSRF_TOKEN });

      await expect(harness.guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(harness.csrf.validateSessionToken).not.toHaveBeenCalled();
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('guards %s as state-changing', async (method) => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith(method, { origin: TEST_ORIGIN, session: SESSION_TOKEN });

      await expect(harness.guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'CSRF_FAILED',
      });
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])('treats %s as safe', async (method) => {
      const harness = createGuard(LIVE_SESSION);
      const request = requestWith(method, { session: SESSION_TOKEN });

      await expect(harness.guard.canActivate(contextFor(request))).resolves.toBe(true);
    });
  });

  it('rejects an expired or revoked session because the repository resolves nothing', async () => {
    const harness = createGuard(null);

    await expect(
      harness.guard.canActivate(contextFor(requestWith('GET', { session: SESSION_TOKEN }))),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(harness.sessions.authenticate).toHaveBeenCalledWith(SESSION_TOKEN);
  });

  it('passes an absent cookie to the session lookup as undefined', async () => {
    const harness = createGuard(null);

    await expect(
      harness.guard.canActivate(contextFor({ method: 'GET', headers: {} } as Partial<Request>)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(harness.sessions.authenticate).toHaveBeenCalledWith(undefined);
  });
});
