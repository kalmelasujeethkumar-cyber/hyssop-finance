/**
 * Authentication over HTTP against a real PostgreSQL database.
 *
 * Authority: `docs/06-API-SPEC.md` (the four `/api/v1/auth` routes, their status codes and
 * envelopes), `docs/07-SECURITY-RULES.md` (cookie policy, CSRF on login, generic login
 * failure, rate limiting, trusted-origin enforcement), and `docs/10-TEST-PLAN.md`
 * `TEST-AUTH-001` and `TEST-SEC-001`.
 *
 * The suite drives real HTTP through the assembled Nest application, so the status codes,
 * cookies, and headers asserted here are the ones a browser would actually observe. The
 * Admin credential is generated inside the test process, so no real password and no
 * reusable secret ever reaches the repository.
 *
 * The rate-limit test gets its own application instance with the documented limit. The
 * limiter is in-memory per process and every test shares one loopback address, so reusing a
 * single instance would let one test's failed attempts throttle an unrelated test.
 */

import type { INestApplication } from '@nestjs/common';
import {
  CSRF_TOKEN_HEADER,
  isApiErrorBody,
  isCurrentSessionResult,
  isCsrfTokenResult,
  isLoginResult,
  isLogoutResult,
  type AdminProfile,
  type CsrfTokenResult,
  type CurrentSessionResult,
  type LoginResult,
  type LogoutResult,
} from '@hyssop/contracts';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service';
import type { AppEnvironment } from '../../src/config/environment';
import { AdminUserRepository } from '../../src/database/auth/admin-user.repository';
import {
  TEST_CSRF_COOKIE,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
  TEST_SESSION_COOKIE,
  applyTestProcessEnvironment,
  authEnvironmentProcessVariables,
  createTestApplication,
} from '../support/test-application';
import { requireTestDatabaseUrls } from './support/database-connection';
import { TEST_ADMIN_IDENTIFIER, createHarness, type TestHarness } from './support/test-database';

const UNTRUSTED_ORIGIN = 'https://evil.example';

/** Tokens are 32 random bytes in base64url, so every secret in this suite is 43 chars. */
const TOKEN_LENGTH = 43;

/**
 * A credential that exists only for this process run. It satisfies the documented
 * 12-character minimum and is never written anywhere.
 */
const TEST_PASSWORD = `Hyssop-${randomBytes(18).toString('hex')}`;

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function setCookiesOf(response: request.Response): string[] {
  const cookies = response.headers['set-cookie'];

  return cookies === undefined ? [] : Array.isArray(cookies) ? cookies : [cookies];
}

function cookieValue(cookies: readonly string[], name: string): string {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  return match === undefined ? '' : (match.slice(name.length + 1).split(';')[0] ?? '');
}

function cookieHeaderOf(cookies: readonly string[], name: string): string {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
}

function readData(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'data' in body ? body.data : undefined;
}

function readErrorCode(body: unknown): string | undefined {
  return isApiErrorBody(body) ? body.error.code : undefined;
}

function readErrorMessage(body: unknown): string | undefined {
  return isApiErrorBody(body) ? body.error.message : undefined;
}

describe('authentication over HTTP (TEST-AUTH-001, TEST-SEC-001)', () => {
  let app: INestApplication;
  let harness: TestHarness;
  let passwordHash: string;
  let restoreEnvironment: () => void;

  beforeAll(async () => {
    const { runtimeUrl, migrationUrl } = requireTestDatabaseUrls();

    restoreEnvironment = applyTestProcessEnvironment({
      DATABASE_URL: runtimeUrl,
      DIRECT_DATABASE_URL: migrationUrl,
      // The limiter is exercised in a dedicated instance, so the shared one is opened wide
      // to keep the rate limit provable rather than accidental.
      LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '100',
    });

    harness = await createHarness();
    ({ app } = await createTestApplication());
    passwordHash = await app.get(PasswordService).hash(TEST_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await harness.close();
    restoreEnvironment();
  });

  beforeEach(async () => {
    // `reset` truncates every table, so the usable credential is re-provisioned each time.
    harness.admin = await harness.reset();
    await app.get(AdminUserRepository).provisionCredential({
      identifier: TEST_ADMIN_IDENTIFIER,
      displayName: harness.admin.displayName,
      passwordHash,
    });
  });

  /**
   * The pre-authentication CSRF *pair*, exactly as a browser receives it: the same value in
   * the response body and in the readable CSRF cookie. Every login call below presents both
   * halves, so a test cannot pass by sending only one of them.
   */
  interface PreAuthCsrf {
    readonly token: string;
    readonly cookie: string;
  }

  async function issuePreAuthCsrf(): Promise<PreAuthCsrf> {
    const response = await request(httpServer(app))
      .get('/api/v1/auth/csrf')
      .set('Origin', TEST_ORIGIN)
      .expect(200);
    const data = readData(response.body);

    if (!isCsrfTokenResult(data)) {
      throw new Error('expected a documented CSRF token envelope');
    }

    const cookie = cookieHeaderOf(setCookiesOf(response), TEST_CSRF_COOKIE);

    if (cookie === '') {
      throw new Error('expected a matching pre-authentication CSRF cookie');
    }

    return { token: data.csrfToken, cookie };
  }

  /**
   * Every builder below returns the supertest `Test` synchronously, so a call site can
   * chain `.expect(status)`. They must not be `async`: a supertest `Test` is thenable, so
   * returning one from an `async` function would fire the request and hand back a response
   * instead of a pending test.
   */
  function loginRequest(body: unknown, csrf: PreAuthCsrf, origin = TEST_ORIGIN) {
    return request(httpServer(app))
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set(CSRF_TOKEN_HEADER, csrf.token)
      .set('Cookie', csrf.cookie)
      .send(body as object);
  }

  function signInWith(
    csrf: PreAuthCsrf,
    identifier = TEST_ADMIN_IDENTIFIER,
    password = TEST_PASSWORD,
  ) {
    return loginRequest({ identifier, password }, csrf);
  }

  function meRequest(session: string) {
    return request(httpServer(app))
      .get('/api/v1/auth/me')
      .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`);
  }

  function logoutRequest(session: string, csrfToken: string, origin = TEST_ORIGIN) {
    return request(httpServer(app))
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`)
      .set(CSRF_TOKEN_HEADER, csrfToken);
  }

  describe('GET /api/v1/auth/csrf', () => {
    it('returns a pre-authentication token and sets the matching readable cookie', async () => {
      const response = await request(httpServer(app))
        .get('/api/v1/auth/csrf')
        .set('Origin', TEST_ORIGIN)
        .expect(200);
      const data = readData(response.body);

      if (!isCsrfTokenResult(data)) {
        throw new Error('expected a documented CSRF token envelope');
      }

      const result: CsrfTokenResult = data;
      const cookies = setCookiesOf(response);

      expect(result.csrfToken).toHaveLength(TOKEN_LENGTH);
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());

      // The specification requires login to receive the secret twice, as this cookie and as
      // the token the client echoes in its header, so both halves must be issued together.
      expect(cookieValue(cookies, TEST_CSRF_COOKIE)).toBe(result.csrfToken);
      // The cookie is not a session cookie, so it must stay readable by script and must not
      // outlive the short-lived row it stands in for.
      expect(cookieHeaderOf(cookies, TEST_CSRF_COOKIE)).not.toContain('HttpOnly');
      expect(cookieHeaderOf(cookies, TEST_CSRF_COOKIE)).toContain('SameSite=Lax');
      expect(cookieHeaderOf(cookies, TEST_CSRF_COOKIE)).toContain('Path=/');
      expect(cookieHeaderOf(cookies, TEST_CSRF_COOKIE)).toContain(
        'Expires=' + new Date(result.expiresAt).toUTCString(),
      );
    });

    it('refuses to issue a token to an untrusted origin', async () => {
      const response = await request(httpServer(app))
        .get('/api/v1/auth/csrf')
        .set('Origin', UNTRUSTED_ORIGIN)
        .expect(403);

      expect(readErrorCode(response.body)).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('signs in and returns the Admin, the session window, and the CSRF token', async () => {
      const response = await signInWith(await issuePreAuthCsrf()).expect(200);
      const data = readData(response.body);

      if (!isLoginResult(data)) {
        throw new Error('expected a documented login envelope');
      }

      const result: LoginResult = data;

      expect(result.admin.identifier).toBe(TEST_ADMIN_IDENTIFIER);
      expect(result.admin).not.toHaveProperty('passwordHash');
      expect(result.csrfToken).toHaveLength(TOKEN_LENGTH);
      expect(Date.parse(result.session.expiresAt)).toBeGreaterThan(Date.now());
      expect(Date.parse(result.session.expiresAt)).toBeLessThanOrEqual(
        Date.now() + 9 * 60 * 60 * 1000,
      );
    });

    it('delivers the session token only as an HTTP-only cookie, and a readable CSRF cookie', async () => {
      const response = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(response);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);

      expect(session).toHaveLength(TOKEN_LENGTH);
      expect(cookieHeaderOf(cookies, TEST_SESSION_COOKIE)).toContain('HttpOnly');
      expect(cookieHeaderOf(cookies, TEST_SESSION_COOKIE)).toContain('SameSite=Lax');
      expect(cookieHeaderOf(cookies, TEST_SESSION_COOKIE)).toContain('Path=/');
      expect(JSON.stringify(response.body)).not.toContain(session);

      // The CSRF cookie must be readable by script, because the browser copies its value
      // into the request header on every state-changing call.
      expect(cookieValue(cookies, TEST_CSRF_COOKIE)).toHaveLength(TOKEN_LENGTH);
      expect(cookieHeaderOf(cookies, TEST_CSRF_COOKIE)).not.toContain('HttpOnly');

      // `Secure` is asserted in the cookie unit test, where production is simulated; a
      // loopback test run must not produce a cookie the local browser would drop.
    });

    it('rejects a wrong password with a generic message and no cookie', async () => {
      const response = await signInWith(
        await issuePreAuthCsrf(),
        TEST_ADMIN_IDENTIFIER,
        `${TEST_PASSWORD}-wrong`,
      ).expect(401);

      expect(readErrorCode(response.body)).toBe('INVALID_CREDENTIALS');
      expect(readErrorMessage(response.body)).toBe('The identifier or password is incorrect.');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
    });

    it('answers an unknown identifier exactly like a wrong password', async () => {
      const unknown = await signInWith(await issuePreAuthCsrf(), 'no-such-admin').expect(401);
      const wrong = await signInWith(
        await issuePreAuthCsrf(),
        TEST_ADMIN_IDENTIFIER,
        `${TEST_PASSWORD}-wrong`,
      ).expect(401);

      // Only the per-request ID may differ; nothing else can reveal which case it was.
      expect(readErrorCode(unknown.body)).toBe(readErrorCode(wrong.body));
      expect(readErrorMessage(unknown.body)).toBe(readErrorMessage(wrong.body));
      expect(Object.keys((unknown.body as { error: object }).error).sort()).toStrictEqual(
        Object.keys((wrong.body as { error: object }).error).sort(),
      );
    });

    it('never accepts the documented unusable-credential sentinel account', async () => {
      await app.get(AdminUserRepository).provisionCredential({
        identifier: 'sentinel-only',
        displayName: 'Sentinel',
        passwordHash: '!unprovisioned',
      });

      const response = await signInWith(
        await issuePreAuthCsrf(),
        'sentinel-only',
        TEST_PASSWORD,
      ).expect(401);

      expect(readErrorCode(response.body)).toBe('INVALID_CREDENTIALS');
    });

    it('requires the pre-authentication CSRF token as a matching cookie and header pair', async () => {
      const credentials = { identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD };
      const missingBoth = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send(credentials)
        .expect(403);

      expect(readErrorCode(missingBoth.body)).toBe('CSRF_FAILED');

      // The token is worthless on its own: a header with no cookie is a forged request that
      // a cross-site caller could produce, since custom headers require a preflight.
      const issued = await issuePreAuthCsrf();
      const missingCookie = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, issued.token)
        .send(credentials)
        .expect(403);

      expect(readErrorCode(missingCookie.body)).toBe('CSRF_FAILED');

      // Two individually valid values that disagree are still a forgery attempt.
      const other = await issuePreAuthCsrf();
      const mismatched = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, issued.token)
        .set('Cookie', other.cookie)
        .send(credentials)
        .expect(403);

      expect(readErrorCode(mismatched.body)).toBe('CSRF_FAILED');

      // All three failures are reported identically, so a client cannot probe which part of
      // the pair was wrong, and none of them created a session.
      expect(readErrorCode(missingBoth.body)).toBe(readErrorCode(mismatched.body));
      expect(setCookiesOf(missingCookie)).toStrictEqual([]);
      expect(setCookiesOf(mismatched)).toStrictEqual([]);
    });

    it('refuses a header token that matches its cookie but was never issued', async () => {
      const forged = 'a'.repeat(TOKEN_LENGTH);
      const response = await loginRequest(
        { identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD },
        { token: forged, cookie: `${TEST_CSRF_COOKIE}=${forged}` },
      ).expect(403);

      expect(readErrorCode(response.body)).toBe('CSRF_FAILED');
      expect(setCookiesOf(response)).toStrictEqual([]);
    });

    it('refuses to replay a consumed login token', async () => {
      const csrf = await issuePreAuthCsrf();
      const credentials = { identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD };

      await loginRequest(credentials, csrf).expect(200);
      await loginRequest(credentials, csrf).expect(403);
    });

    it('refuses a login from an untrusted origin', async () => {
      const response = await loginRequest(
        { identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD },
        await issuePreAuthCsrf(),
        UNTRUSTED_ORIGIN,
      ).expect(403);

      expect(readErrorCode(response.body)).toBe('FORBIDDEN');
    });

    it('rejects a malformed body without recording a credential failure', async () => {
      await loginRequest({ identifier: TEST_ADMIN_IDENTIFIER }, await issuePreAuthCsrf()).expect(
        400,
      );

      await expect(
        harness.runtime.auditEvent.count({ where: { action: 'LOGIN_FAILED' } }),
      ).resolves.toBe(0);
    });

    it('audits a successful and a failed sign-in', async () => {
      await signInWith(await issuePreAuthCsrf()).expect(200);
      await signInWith(
        await issuePreAuthCsrf(),
        TEST_ADMIN_IDENTIFIER,
        'wrong-password-here',
      ).expect(401);

      const succeeded = await harness.runtime.auditEvent.findMany({
        where: { action: 'LOGIN_SUCCEEDED' },
      });
      const failed = await harness.runtime.auditEvent.findMany({
        where: { action: 'LOGIN_FAILED' },
      });

      expect(succeeded).toHaveLength(1);
      expect(succeeded[0]?.actorAdminId).toBe(harness.admin.id);
      expect(failed).toHaveLength(1);
      // A failed attempt must not name the account that was targeted.
      expect(JSON.stringify(failed)).not.toContain(TEST_ADMIN_IDENTIFIER);
      expect(JSON.stringify(failed)).not.toContain('wrong-password-here');
    });

    it('issues an independent session and CSRF secret for each sign-in', async () => {
      const first = await signInWith(await issuePreAuthCsrf()).expect(200);
      const second = await signInWith(await issuePreAuthCsrf()).expect(200);
      const firstSession = cookieValue(setCookiesOf(first), TEST_SESSION_COOKIE);
      const secondSession = cookieValue(setCookiesOf(second), TEST_SESSION_COOKIE);

      expect(secondSession).not.toBe(firstSession);
      expect(readData(second.body)).not.toStrictEqual(readData(first.body));

      // Both stay usable. Whether a new sign-in should replace an earlier session is not
      // decided by the locked specifications, so no behaviour is asserted here; see the
      // open question recorded in `docs/runtime/ISSUES.md`.
      await meRequest(firstSession).expect(200);
      await meRequest(secondSession).expect(200);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns the current Admin and session window for a live session', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const session = cookieValue(setCookiesOf(login), TEST_SESSION_COOKIE);

      const response = await meRequest(session).expect(200);
      const data = readData(response.body);

      if (!isCurrentSessionResult(data)) {
        throw new Error('expected a documented current-session envelope');
      }

      const result: CurrentSessionResult = data;
      const admin: AdminProfile = result.admin;

      expect(admin.identifier).toBe(TEST_ADMIN_IDENTIFIER);
      expect(Date.parse(result.session.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('refuses a request with no session', async () => {
      const response = await request(httpServer(app)).get('/api/v1/auth/me').expect(401);

      expect(readErrorCode(response.body)).toBe('UNAUTHENTICATED');
    });

    it('refuses an unknown or tampered session token', async () => {
      await meRequest('a'.repeat(TOKEN_LENGTH)).expect(401);

      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const session = cookieValue(setCookiesOf(login), TEST_SESSION_COOKIE);
      const tampered = `${session.slice(0, -1)}${session.endsWith('a') ? 'b' : 'a'}`;

      expect(tampered).not.toBe(session);
      await meRequest(tampered).expect(401);
      await meRequest(session).expect(200);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('invalidates the session server-side, clears both cookies, and audits once', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(login);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);
      const csrf = cookieValue(cookies, TEST_CSRF_COOKIE);

      const response = await logoutRequest(session, csrf).expect(200);
      const cleared = setCookiesOf(response);
      const data = readData(response.body);

      // Logout is an ordinary enveloped response, not a bare status: the client is told
      // honestly that a live session was revoked.
      if (!isLogoutResult(data)) {
        throw new Error('expected a documented logout envelope');
      }

      const result: LogoutResult = data;

      expect(result.revoked).toBe(true);
      expect(cookieHeaderOf(cleared, TEST_SESSION_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
      expect(cookieHeaderOf(cleared, TEST_CSRF_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
      await meRequest(session).expect(401);
      await expect(harness.runtime.auditEvent.count({ where: { action: 'LOGOUT' } })).resolves.toBe(
        1,
      );
    });

    it('is idempotent for a browser that still holds a stale cookie', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(login);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);
      const csrf = cookieValue(cookies, TEST_CSRF_COOKIE);

      await logoutRequest(session, csrf).expect(200);
      // The second call finds nothing to revoke, so it must still succeed and must not
      // record a second revocation.
      const repeated = await logoutRequest(session, csrf).expect(200);

      if (!isLogoutResult(readData(repeated.body))) {
        throw new Error('expected a documented logout envelope');
      }

      expect((readData(repeated.body) as LogoutResult).revoked).toBe(false);
      await expect(harness.runtime.auditEvent.count({ where: { action: 'LOGOUT' } })).resolves.toBe(
        1,
      );
    });

    it('clears cookies and succeeds without a session at all', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/auth/logout')
        .set('Origin', TEST_ORIGIN)
        .expect(200);
      const data = readData(response.body);

      if (!isLogoutResult(data)) {
        throw new Error('expected a documented logout envelope');
      }

      // Nothing was signed in, so nothing was revoked. Reporting success keeps sign-out
      // reachable for a browser whose cookies are already gone.
      expect(data.revoked).toBe(false);
      expect(setCookiesOf(response).length).toBe(2);
      await expect(harness.runtime.auditEvent.count({ where: { action: 'LOGOUT' } })).resolves.toBe(
        0,
      );
    });

    it('refuses a cross-site logout and keeps the session usable', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(login);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);

      const response = await logoutRequest(
        session,
        cookieValue(cookies, TEST_CSRF_COOKIE),
        UNTRUSTED_ORIGIN,
      ).expect(403);

      expect(readErrorCode(response.body)).toBe('FORBIDDEN');
      await meRequest(session).expect(200);
    });

    it('refuses a logout that presents the wrong CSRF token', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(login);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);

      const response = await logoutRequest(session, 'b'.repeat(TOKEN_LENGTH)).expect(403);

      expect(readErrorCode(response.body)).toBe('CSRF_FAILED');
      await meRequest(session).expect(200);
    });

    it('rotates the session CSRF secret on demand, invalidating the previous value', async () => {
      const login = await signInWith(await issuePreAuthCsrf()).expect(200);
      const cookies = setCookiesOf(login);
      const session = cookieValue(cookies, TEST_SESSION_COOKIE);
      const original = cookieValue(cookies, TEST_CSRF_COOKIE);

      const rotated = await request(httpServer(app))
        .get('/api/v1/auth/csrf')
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`)
        .expect(200);
      const data = readData(rotated.body);

      if (!isCsrfTokenResult(data)) {
        throw new Error('expected a documented CSRF token envelope');
      }

      const fresh: CsrfTokenResult = data;

      expect(fresh.csrfToken).toHaveLength(TOKEN_LENGTH);
      expect(fresh.csrfToken).not.toBe(original);
      expect(cookieValue(setCookiesOf(rotated), TEST_CSRF_COOKIE)).toBe(fresh.csrfToken);

      // The old value is now worthless and the new one works, which proves the rotation
      // reached the stored session and not just the response.
      await logoutRequest(session, original).expect(403);
      await logoutRequest(session, fresh.csrfToken).expect(200);
    });
  });

  describe('GET /api/v1/health', () => {
    it('stays reachable without a session', async () => {
      await request(httpServer(app)).get('/api/v1/health').expect(200);
    });
  });

  describe('rate limiting', () => {
    let limitedApp: INestApplication;
    let restoreLimitedEnvironment: () => void;

    beforeAll(async () => {
      const limitedEnvironment: AppEnvironment = {
        ...TEST_ENVIRONMENT,
        auth: { ...TEST_ENVIRONMENT.auth, loginRateLimitMaxAttempts: 5 },
      };

      restoreLimitedEnvironment = applyTestProcessEnvironment(
        authEnvironmentProcessVariables(limitedEnvironment.auth),
      );
      ({ app: limitedApp } = await createTestApplication(limitedEnvironment));
    });

    afterAll(async () => {
      await limitedApp.close();
      restoreLimitedEnvironment();
    });

    it('answers 429 with a retry hint once the documented attempts are used up', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const csrf = await issuePreAuthCsrf();

        await request(httpServer(limitedApp))
          .post('/api/v1/auth/login')
          .set('Origin', TEST_ORIGIN)
          .set(CSRF_TOKEN_HEADER, csrf.token)
          .set('Cookie', csrf.cookie)
          .send({ identifier: TEST_ADMIN_IDENTIFIER, password: `wrong-attempt-${attempt}` })
          .expect(401);
      }

      const blockedCsrf = await issuePreAuthCsrf();
      const blocked = await request(httpServer(limitedApp))
        .post('/api/v1/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, blockedCsrf.token)
        .set('Cookie', blockedCsrf.cookie)
        .send({ identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD })
        .expect(429);

      expect(readErrorCode(blocked.body)).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // A blocked request must not create a session.
      expect(cookieHeaderOf(setCookiesOf(blocked), TEST_SESSION_COOKIE)).toBe('');
    });
  });
});
