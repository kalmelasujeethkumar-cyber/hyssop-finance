import type { INestApplication } from '@nestjs/common';
import { isApiErrorBody, isHealthReport, REQUEST_ID_HEADER } from '@hyssop/contracts';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  applyTestProcessEnvironment,
  createTestApplication,
  TEST_ORIGIN,
} from './support/test-application';

const CLIENT_REQUEST_ID = '11111111-2222-4333-8444-555555555555';

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
