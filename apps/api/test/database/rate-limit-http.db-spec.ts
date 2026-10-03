/**
 * General request-abuse ceilings over HTTP against a real PostgreSQL database.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Apply safe login, upload, search, export, and
 * mutation limits ... required, not optional, and final QA must test their threshold and
 * generic-error behavior") and `docs/06-API-SPEC.md` (`429 RATE_LIMITED`). Covers the four
 * categories the login limiter does not: `TEST-SEC-001`.
 *
 * Each test drives real HTTP through the assembled Nest application, so the `429`, the
 * `Retry-After` header, and the generic envelope are the ones a browser would observe. The
 * application is built with deliberately tiny ceilings so a handful of requests crosses the
 * threshold; the shared limiter is cleared between tests so one category cannot exhaust another.
 */

import type { INestApplication } from '@nestjs/common';
import { CSRF_TOKEN_HEADER, isApiErrorBody, isCsrfTokenResult } from '@hyssop/contracts';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service';
import type { AppEnvironment } from '../../src/config/environment';
import { RequestRateLimiter } from '../../src/common/rate-limit/request-rate-limiter.service';
import { AdminUserRepository } from '../../src/database/auth/admin-user.repository';
import {
  TEST_CSRF_COOKIE,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
  TEST_SESSION_COOKIE,
  applyTestProcessEnvironment,
  authEnvironmentProcessVariables,
  createTestApplication,
  rateLimitEnvironmentProcessVariables,
} from '../support/test-application';
import { requireTestDatabaseUrls } from './support/database-connection';
import {
  TEST_ADMIN_IDENTIFIER,
  createHarness,
  testRateLimitEnvironment,
  type TestHarness,
} from './support/test-database';

const TOKEN_LENGTH = 43;
const TEST_PASSWORD = `Hyssop-${randomBytes(18).toString('hex')}`;
const A_UUID = '00000000-0000-4000-8000-000000000000';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
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

function setCookiesOf(response: request.Response): string[] {
  const cookies = response.headers['set-cookie'];

  return cookies === undefined ? [] : Array.isArray(cookies) ? cookies : [cookies];
}

function cookieValue(cookies: readonly string[], name: string): string {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  return match === undefined ? '' : (match.slice(name.length + 1).split(';')[0] ?? '');
}

describe('general request-abuse ceilings over HTTP (TEST-SEC-001)', () => {
  const MAX_REQUESTS = 2;
  let app: INestApplication;
  let harness: TestHarness;
  let passwordHash: string;
  let restoreEnvironment: () => void;
  let session: string;
  let csrfToken: string;

  beforeAll(async () => {
    const { runtimeUrl, migrationUrl } = requireTestDatabaseUrls();
    const limitedEnvironment: AppEnvironment = {
      ...TEST_ENVIRONMENT,
      rateLimit: testRateLimitEnvironment({
        mutation: { maxRequests: MAX_REQUESTS, windowMinutes: 15 },
        search: { maxRequests: MAX_REQUESTS, windowMinutes: 15 },
        upload: { maxRequests: MAX_REQUESTS, windowMinutes: 15 },
        export: { maxRequests: MAX_REQUESTS, windowMinutes: 15 },
      }),
    };

    restoreEnvironment = applyTestProcessEnvironment({
      DATABASE_URL: runtimeUrl,
      DIRECT_DATABASE_URL: migrationUrl,
      // Login has its own limiter; widen it so sign-in in this suite is never the thing that
      // is refused, exactly as the shared HTTP suite does.
      ...authEnvironmentProcessVariables({
        ...TEST_ENVIRONMENT.auth,
        loginRateLimitMaxAttempts: 100,
      }),
      ...rateLimitEnvironmentProcessVariables(limitedEnvironment.rateLimit),
    });

    harness = await createHarness();
    ({ app } = await createTestApplication(limitedEnvironment));
    passwordHash = await app.get(PasswordService).hash(TEST_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await harness.close();
    restoreEnvironment();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    await app.get(AdminUserRepository).provisionCredential({
      identifier: TEST_ADMIN_IDENTIFIER,
      displayName: harness.admin.displayName,
      passwordHash,
    });
    app.get(RequestRateLimiter).resetAll();

    const csrfResponse = await request(httpServer(app))
      .get('/api/v1/auth/csrf')
      .set('Origin', TEST_ORIGIN)
      .expect(200);
    const data = readData(csrfResponse.body);

    if (!isCsrfTokenResult(data)) {
      throw new Error('expected a documented CSRF token envelope');
    }

    const csrfCookie =
      setCookiesOf(csrfResponse).find((cookie) => cookie.startsWith(`${TEST_CSRF_COOKIE}=`)) ?? '';
    const login = await request(httpServer(app))
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_TOKEN_HEADER, data.csrfToken)
      .set('Cookie', csrfCookie)
      .send({ identifier: TEST_ADMIN_IDENTIFIER, password: TEST_PASSWORD })
      .expect(200);

    const cookies = setCookiesOf(login);

    session = cookieValue(cookies, TEST_SESSION_COOKIE);
    csrfToken = cookieValue(cookies, TEST_CSRF_COOKIE);

    expect(session).toHaveLength(TOKEN_LENGTH);
    expect(csrfToken).toHaveLength(TOKEN_LENGTH);
  });

  /** Runs `count` requests through `send` and returns the responses, asserting the threshold. */
  async function expectLimited(
    count: number,
    send: (index: number) => request.Test,
  ): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const allowed = await send(index);

      expect(allowed.status).not.toBe(429);
    }

    const blocked = await send(count);

    expect(blocked.status).toBe(429);
    expect(readErrorCode(blocked.body)).toBe('RATE_LIMITED');
    expect(readErrorMessage(blocked.body)).toBe('Too many attempts. Please wait and try again.');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('limits mutations by default once the ceiling is reached', async () => {
    await expectLimited(MAX_REQUESTS, () =>
      request(httpServer(app))
        .post('/api/v1/members')
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`)
        .set(CSRF_TOKEN_HEADER, csrfToken)
        .send({ displayName: 'Rate Limited Member' }),
    );
  });

  it('limits the search route with its own bucket', async () => {
    await expectLimited(MAX_REQUESTS, () =>
      request(httpServer(app))
        .get('/api/v1/search')
        .query({ q: 'hyssop' })
        .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`),
    );
  });

  it('limits the export route with its own bucket', async () => {
    await expectLimited(MAX_REQUESTS, () =>
      request(httpServer(app))
        .get(`/api/v1/reports/financial-summary/export.csv`)
        .query({ from: '2026-01-01', to: '2026-01-31' })
        .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`),
    );
  });

  it('limits the upload route with its own bucket', async () => {
    await expectLimited(MAX_REQUESTS, () =>
      request(httpServer(app))
        .post(`/api/v1/transactions/${A_UUID}/documents`)
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', `${TEST_SESSION_COOKIE}=${session}`)
        .set(CSRF_TOKEN_HEADER, csrfToken)
        .attach('file', Buffer.from('rate-limit'), 'receipt.png'),
    );
  });
});
