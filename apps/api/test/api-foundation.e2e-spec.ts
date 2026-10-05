import type { INestApplication } from '@nestjs/common';
import {
  CSRF_TOKEN_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  isApiErrorBody,
  isHealthReport,
  REQUEST_ID_HEADER,
} from '@hyssop/contracts';
import type { Server } from 'node:http';
import request from 'supertest';
import { IF_MATCH_HEADER } from '../src/bootstrap/configure-app';
import type { AppEnvironment } from '../src/config/environment';
import {
  applyTestProcessEnvironment,
  createTestApplication,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
} from './support/test-application';

const CLIENT_REQUEST_ID = '11111111-2222-4333-8444-555555555555';

/**
 * The deployed demo frontend, as distinct from the local development origin.
 *
 * The production topology puts the web build on a static host and the API on a separate
 * service, so the two are different origins and every write is preflighted. Proving the
 * allowlist against this origin is what makes the suite cover the deployed case rather than
 * only the same-origin development proxy.
 */
const DEPLOYED_FRONTEND_ORIGIN = 'https://hyssop-2026.netlify.app';

/**
 * The shared test environment with the deployed origin allowed instead of the local one.
 *
 * `configureApp` reads `corsAllowedOrigins` from the environment object it is given rather
 * than from `process.env` at request time, so the deployed case is exercised by handing
 * `createTestApplication` this environment. Every other setting is the documented test
 * default, unchanged, so this proves the origin allowlist and nothing else.
 */
const DEPLOYED_ENVIRONMENT: AppEnvironment = {
  ...TEST_ENVIRONMENT,
  corsAllowedOrigins: [DEPLOYED_FRONTEND_ORIGIN],
};

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('API foundation (integration)', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;

  beforeAll(async () => {
    restoreEnvironment = applyTestProcessEnvironment();
    ({ app } = await createTestApplication());
  });

  afterAll(async () => {
    await app.close();
    restoreEnvironment();
  });

  it('serves the documented health envelope at GET /api/v1/health', async () => {
    const response = await request(httpServer(app)).get('/api/v1/health').expect(200);
    const body: unknown = response.body;

    expect(response.headers['content-type']).toContain('application/json');
    expect(isHealthReport(readData(body))).toBe(true);
    expect(response.headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  it('returns a request ID header and echoes a valid client request ID', async () => {
    const generated = await request(httpServer(app)).get('/api/v1/health').expect(200);
    expect(generated.headers[REQUEST_ID_HEADER]).toMatch(UUID_PATTERN);

    const echoed = await request(httpServer(app))
      .get('/api/v1/health')
      .set(REQUEST_ID_HEADER, CLIENT_REQUEST_ID)
      .expect(200);

    expect(echoed.headers[REQUEST_ID_HEADER]).toBe(CLIENT_REQUEST_ID);
  });

  it('replaces an unsafe request ID header value instead of reflecting it', async () => {
    const response = await request(httpServer(app))
      .get('/api/v1/health')
      .set(REQUEST_ID_HEADER, '<script>alert(1)</script>')
      .expect(200);

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(UUID_PATTERN);
    expect(response.headers[REQUEST_ID_HEADER]).not.toContain('<script>');
  });

  it('returns the documented error envelope with the request ID for an unknown route', async () => {
    const response = await request(httpServer(app))
      .get('/api/v1/does-not-exist')
      .set(REQUEST_ID_HEADER, CLIENT_REQUEST_ID)
      .expect(404);

    const body: unknown = response.body;

    expect(isApiErrorBody(body)).toBe(true);
    if (!isApiErrorBody(body)) {
      throw new Error('expected a documented error envelope');
    }

    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('The requested resource was not found.');
    expect(body.error.requestId).toBe(CLIENT_REQUEST_ID);
  });

  it('never leaks a stack trace or internal path in an error response', async () => {
    const response = await request(httpServer(app)).get('/api/v1/does-not-exist').expect(404);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('at ');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toContain('.ts');
  });

  it('allows every header the browser client sends on a cross-origin write', async () => {
    // The deployed frontend and API are on different origins, so every write the browser makes
    // is preceded by a preflight, and the browser drops the whole request unless each header
    // it intends to send is named in `Access-Control-Allow-Headers`. A header the client sends
    // but the API does not advertise therefore fails *before* any controller runs, and
    // `apps/web` reports that rejected `fetch` as `The API could not be reached.` — which
    // reads like an outage while the API is healthy.
    //
    // These are the headers `apps/web` puts on a member payment: the JSON body, the request
    // ID, the CSRF token, and the idempotency key that `docs/06-API-SPEC.md` requires on
    // every create. `If-Match` is included because a correction sends it in the same
    // preflight shape. Local runs cannot catch this: they are same-origin through the Vite
    // proxy, so no preflight is ever issued.
    const response = await request(httpServer(app))
      .options('/api/v1/income')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        [
          'content-type',
          REQUEST_ID_HEADER,
          CSRF_TOKEN_HEADER,
          IF_MATCH_HEADER,
          IDEMPOTENCY_KEY_HEADER,
        ].join(','),
      )
      .expect(204);

    const allowed = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();

    expect(allowed).toContain('content-type');
    expect(allowed).toContain(CSRF_TOKEN_HEADER);
    expect(allowed).toContain(IF_MATCH_HEADER.toLowerCase());
    // The header whose absence broke recording a member payment on the live site.
    expect(allowed).toContain(IDEMPOTENCY_KEY_HEADER);
    // Never a wildcard: `*` is invalid alongside credentials and would allow any origin.
    expect(allowed).not.toContain('*');
    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers a CORS preflight only for a configured origin', async () => {
    const allowed = await request(httpServer(app))
      .options('/api/v1/health')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(allowed.status).toBeLessThan(300);
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-expose-headers']).toContain(REQUEST_ID_HEADER);

    const rejected = await request(httpServer(app))
      .options('/api/v1/health')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a cross-origin write preflight for the deployed Netlify frontend', async () => {
    // The live demo frontend is `https://hyssop-2026.netlify.app` and the API is on a different
    // origin, so this is the exact origin whose preflight has to succeed in production, and the
    // exact failure the deployed site reported as `The API could not be reached.` It gets its
    // own application instance because `configureApp` builds the allowlist from the environment
    // it is handed: a suite reusing the shared instance could only ever prove `TEST_ORIGIN`
    // works, which is exactly the gap that let the deployed site break.
    const { app: deployedApp } = await createTestApplication(DEPLOYED_ENVIRONMENT);

    try {
      const response = await request(httpServer(deployedApp))
        .options('/api/v1/income')
        .set('Origin', DEPLOYED_FRONTEND_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          ['content-type', CSRF_TOKEN_HEADER, IF_MATCH_HEADER, IDEMPOTENCY_KEY_HEADER].join(','),
        )
        .expect(204);

      const allowed = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();

      // The header whose absence stopped a member payment being recorded on the live site.
      expect(allowed).toContain(IDEMPOTENCY_KEY_HEADER);
      expect(allowed).toContain(IF_MATCH_HEADER.toLowerCase());
      expect(response.headers['access-control-allow-origin']).toBe(DEPLOYED_FRONTEND_ORIGIN);
      // The session is an HTTP-only cookie, so a session-bearing write cannot work without it.
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await deployedApp.close();
    }
  });

  it('sets baseline security headers and no HSTS outside production', async () => {
    const response = await request(httpServer(app)).get('/api/v1/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('refuses to start when required configuration is missing', async () => {
    const restore = applyTestProcessEnvironment({ CORS_ALLOWED_ORIGINS: undefined });

    try {
      await expect(createTestApplication()).rejects.toThrow(/CORS_ALLOWED_ORIGINS is required/);
    } finally {
      restore();
    }
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readData(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return undefined;
  }
  return body.data;
}
