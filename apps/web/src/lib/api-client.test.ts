import {
  CSRF_TOKEN_HEADER,
  HEALTH_SERVICE_NAME,
  REQUEST_ID_HEADER,
  type LogoutResult,
} from '@hyssop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, ApiTransportError, createApiClient } from './api-client';

const BASE_URL = 'http://api.test/api/v1';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers({ 'Content-Type': 'application/json', ...(init.headers ?? {}) }),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('createApiClient', () => {
  it('unwraps the success envelope and sends an accept header and request ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          status: 'ok',
          service: HEALTH_SERVICE_NAME,
          version: '0.1.0',
          uptimeSeconds: 1,
          timestamp: '2026-09-26T09:15:00.000Z',
        },
      }),
    );

    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      createRequestId: () => 'client-request-id',
    });

    const report = await client.get<{ status: string }>('/health');

    expect(report.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE_URL}/health`,
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json', [REQUEST_ID_HEADER]: 'client-request-id' },
      }),
    );
  });

  it('raises a typed error for the documented error envelope', async () => {
    const requestId = '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60';
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'The requested resource was not found.',
            requestId,
          },
        },
        { status: 404 },
      ),
    );

    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    const failure = await client.get('/health').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      requestId,
    });
  });

  it('reports a transport failure when the API cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    await expect(client.get('/health')).rejects.toBeInstanceOf(ApiTransportError);
  });

  it('rejects a success response that does not use the success envelope', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'ok', service: HEALTH_SERVICE_NAME }));

    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    await expect(client.get('/health')).rejects.toThrow(
      'The API returned an unexpected response shape.',
    );
  });

  it('does not leak an HTML error page into an error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: () => Promise.reject(new Error('Unexpected token < in JSON at position 0')),
    });

    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    const failure = await client.get('/health').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).message).toBe('The API returned an unexpected error.');
  });

  it('normalizes a base URL with a trailing slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));

    const client = createApiClient({ baseUrl: `${BASE_URL}/`, fetchImpl });

    await client.get('health');

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/health`, expect.anything());
  });
});

describe('session-carrying requests', () => {
  it('sends cookies on every request and never reads or writes browser storage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    await client.get('/auth/me');

    // The session lives in an HTTP-only cookie, so the browser must be told to include it
    // even when the API is on another origin during local development.
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE_URL}/auth/me`,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('sends a JSON body and the CSRF header for a state-changing request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchImpl,
      createRequestId: () => 'client-request-id',
    });

    await client.post(
      '/auth/login',
      { identifier: 'admin', password: 'not-a-real-secret' },
      {
        csrfToken: 'pre-auth-token',
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        // A concrete request ID is supplied so the header value can be compared exactly
        // instead of through an `any`-typed matcher.
        [REQUEST_ID_HEADER]: 'client-request-id',
        [CSRF_TOKEN_HEADER]: 'pre-auth-token',
      },
      credentials: 'include',
      body: JSON.stringify({ identifier: 'admin', password: 'not-a-real-secret' }),
    });
  });

  it('sends a bodyless request with no content type when there is no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    await client.post('/auth/logout', undefined, { csrfToken: 'session-token' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.headers).toMatchObject({ [CSRF_TOKEN_HEADER]: 'session-token' });
  });

  it('omits the CSRF header when none is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

    await client.post('/auth/logout');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty(CSRF_TOKEN_HEADER);
  });

  describe('logout contract', () => {
    it('unwraps the canonical success envelope returned by POST /auth/logout', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse({ data: { revoked: true } }, { status: 200 }));
      const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

      const result = await client.post<LogoutResult>('/auth/logout', undefined, {
        csrfToken: 'session-csrf-token',
      });

      // A successful sign-out must report honestly whether a session was actually revoked,
      // which is only possible if the server answered with the documented envelope.
      expect(result.revoked).toBe(true);
    });

    it('rejects a bodyless 204 logout instead of reporting a false success', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      });
      const client = createApiClient({ baseUrl: BASE_URL, fetchImpl });

      // The stub client and the API must agree; if the API ever reverts to a bare 204 this
      // test fails instead of letting the sign-out look successful while nothing was read.
      const failure = await client.post('/auth/logout').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiTransportError);
    });
  });
});
