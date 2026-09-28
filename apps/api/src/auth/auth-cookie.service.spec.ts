import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AuthCookieService } from './auth-cookie.service';
import { TEST_AUTH_ENVIRONMENT, TEST_ENVIRONMENT } from '../../test/support/test-application';
import { hashToken } from './token.util';

const EXPIRES_AT = new Date('2026-09-26T20:00:00.000Z');

interface RecordedCookie {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
}

function createCookieService(overrides: Partial<typeof TEST_AUTH_ENVIRONMENT> = {}): {
  service: AuthCookieService;
  cookies: RecordedCookie[];
  response: Response;
} {
  const cookies: RecordedCookie[] = [];
  const response = {
    cookie: (name: string, value: string, options: CookieOptions): Response => {
      cookies.push({ name, value, options });

      return response;
    },
    clearCookie: (name: string, options: CookieOptions): Response => {
      cookies.push({ name, value: '', options });

      return response;
    },
  } as unknown as Response;

  const service = new AuthCookieService(
    new ConfigService({
      environment: {
        ...TEST_ENVIRONMENT,
        auth: { ...TEST_AUTH_ENVIRONMENT, ...overrides },
      },
    }),
  );

  return { service, cookies, response };
}

describe('AuthCookieService', () => {
  it('sets the session cookie as HttpOnly, so script can never read the session', () => {
    const { service, cookies, response } = createCookieService();

    service.setSessionCookie(response, 'session-token', EXPIRES_AT);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe(TEST_AUTH_ENVIRONMENT.sessionCookieName);
    expect(cookies[0]?.value).toBe('session-token');
    expect(cookies[0]?.options.httpOnly).toBe(true);
    expect(cookies[0]?.options.expires).toBe(EXPIRES_AT);
    expect(cookies[0]?.options.path).toBe('/');
  });

  it('sets the CSRF cookie readable by script, because the browser copies it into a header', () => {
    const { service, cookies, response } = createCookieService();

    service.setCsrfCookie(response, 'csrf-token', EXPIRES_AT);

    expect(cookies[0]?.name).toBe(TEST_AUTH_ENVIRONMENT.csrfCookieName);
    expect(cookies[0]?.options.httpOnly).toBe(false);
    expect(cookies[0]?.options.expires).toBe(EXPIRES_AT);
  });

  it('uses the documented names instead of hard-coded ones', () => {
    const { service, cookies, response } = createCookieService({
      sessionCookieName: 'custom_session',
      csrfCookieName: 'custom_csrf',
    });

    service.setSessionCookie(response, 'a', EXPIRES_AT);
    service.setCsrfCookie(response, 'b', EXPIRES_AT);

    expect(cookies.map((cookie) => cookie.name)).toStrictEqual(['custom_session', 'custom_csrf']);
  });

  it('marks cookies Secure and SameSite=None when the deployment requires it', () => {
    const { service, cookies, response } = createCookieService({
      cookieSecure: true,
      cookieSameSite: 'none',
    });

    service.setSessionCookie(response, 'session-token', EXPIRES_AT);

    expect(cookies[0]?.options.secure).toBe(true);
    expect(cookies[0]?.options.sameSite).toBe('none');
  });

  it('leaves Secure off for a loopback HTTP deployment', () => {
    const { service, cookies, response } = createCookieService({ cookieSecure: false });

    service.setSessionCookie(response, 'session-token', EXPIRES_AT);

    expect(cookies[0]?.options.secure).toBe(false);
    expect(cookies[0]?.options.sameSite).toBe('lax');
  });

  it('never sets Max-Age, which would silently outlast the session expiry', () => {
    const { service, cookies, response } = createCookieService();

    service.setSessionCookie(response, 'session-token', EXPIRES_AT);
    service.setCsrfCookie(response, 'csrf-token', EXPIRES_AT);

    for (const cookie of cookies) {
      expect(cookie.options.maxAge).toBeUndefined();
    }
  });

  it('clears both cookies in the past and repeats the attributes they were set with', () => {
    const { service, cookies, response } = createCookieService();

    service.clearAuthCookies(response);

    expect(cookies.map((cookie) => cookie.name)).toStrictEqual([
      TEST_AUTH_ENVIRONMENT.sessionCookieName,
      TEST_AUTH_ENVIRONMENT.csrfCookieName,
    ]);
    for (const cookie of cookies) {
      expect(cookie.options.expires).toEqual(new Date(0));
      expect(cookie.options.path).toBe('/');
    }
    // A clear must match the set attributes or the browser keeps the original cookie.
    expect(cookies[0]?.options.httpOnly).toBe(true);
    expect(cookies[1]?.options.httpOnly).toBe(false);
  });

  it('never writes a token hash into a cookie', () => {
    const { service, cookies, response } = createCookieService();

    service.setSessionCookie(response, 'session-token', EXPIRES_AT);
    service.setCsrfCookie(response, 'csrf-token', EXPIRES_AT);

    const serialized = cookies.map((cookie) => cookie.value).join(' ');

    expect(serialized).not.toContain(hashToken('session-token'));
    expect(serialized).not.toContain(hashToken('csrf-token'));
  });
});
