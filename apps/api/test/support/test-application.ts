import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { StructuredLogger } from '../../src/common/logging/structured-logger';
import {
  DEFAULT_ARGON2_ITERATIONS,
  DEFAULT_ARGON2_MEMORY_KIB,
  DEFAULT_ARGON2_PARALLELISM,
  DEFAULT_CSRF_TTL_MINUTES,
  DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
  DEFAULT_SESSION_TTL_HOURS,
  type AppEnvironment,
} from '../../src/config/environment';

export const TEST_ORIGIN = 'http://localhost:5173';

/**
 * A syntactically valid loopback database connection. The foundation tests never run a
 * query, so no database has to be running; `jest.db.config.js` supplies the real test
 * database for the tests that do.
 */
export const TEST_DATABASE_URL =
  'postgresql://hyssop_app@127.0.0.1:55432/hyssop_finance_test?schema=public';
export const TEST_DIRECT_DATABASE_URL =
  'postgresql://hyssop_migrator@127.0.0.1:55432/hyssop_finance_test?schema=public';

export const TEST_SESSION_COOKIE = 'hyssop_session';
export const TEST_CSRF_COOKIE = 'hyssop_csrf';

/**
 * Cookie policy for HTTP-level tests. The names are stable so a test can assert on them,
 * and the CSRF cookie is expected to be readable by script, unlike the session cookie.
 */
export const TEST_AUTH_ENVIRONMENT: AppEnvironment['auth'] = {
  sessionCookieName: TEST_SESSION_COOKIE,
  csrfCookieName: TEST_CSRF_COOKIE,
  cookieSameSite: 'lax',
  cookieSecure: false,
  sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
  csrfTtlMinutes: DEFAULT_CSRF_TTL_MINUTES,
  argon2: {
    memoryKib: DEFAULT_ARGON2_MEMORY_KIB,
    iterations: DEFAULT_ARGON2_ITERATIONS,
    parallelism: DEFAULT_ARGON2_PARALLELISM,
  },
  loginRateLimitMaxAttempts: DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  loginRateLimitWindowMinutes: DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
};

export const TEST_ENVIRONMENT: AppEnvironment = {
  nodeEnv: 'test',
  port: 3000,
  corsAllowedOrigins: [TEST_ORIGIN],
  logLevel: 'info',
  databaseUrl: TEST_DATABASE_URL,
  directDatabaseUrl: TEST_DIRECT_DATABASE_URL,
  auth: TEST_AUTH_ENVIRONMENT,
};

/** Every authentication variable, so a test can assert on the process environment. */
export const TEST_AUTH_ENVIRONMENT_KEYS = [
  'SESSION_COOKIE_NAME',
  'CSRF_COOKIE_NAME',
  'SESSION_COOKIE_SAME_SITE',
  'COOKIE_SECURE',
  'SESSION_TTL_HOURS',
  'CSRF_TTL_MINUTES',
  'ARGON2_MEMORY_KIB',
  'ARGON2_ITERATIONS',
  'ARGON2_PARALLELISM',
  'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
  'LOGIN_RATE_LIMIT_WINDOW_MINUTES',
] as const;

export function authEnvironmentProcessVariables(
  auth: AppEnvironment['auth'] = TEST_AUTH_ENVIRONMENT,
): Record<string, string> {
  return {
    SESSION_COOKIE_NAME: auth.sessionCookieName,
    CSRF_COOKIE_NAME: auth.csrfCookieName,
    SESSION_COOKIE_SAME_SITE: auth.cookieSameSite,
    COOKIE_SECURE: String(auth.cookieSecure),
    SESSION_TTL_HOURS: String(auth.sessionTtlHours),
    CSRF_TTL_MINUTES: String(auth.csrfTtlMinutes),
    ARGON2_MEMORY_KIB: String(auth.argon2.memoryKib),
    ARGON2_ITERATIONS: String(auth.argon2.iterations),
    ARGON2_PARALLELISM: String(auth.argon2.parallelism),
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: String(auth.loginRateLimitMaxAttempts),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: String(auth.loginRateLimitWindowMinutes),
  };
}

/**
 * `ConfigModule` reads `process.env` while the module initializes, so the test
 * environment is applied and then restored around the module lifecycle.
 */
export function applyTestProcessEnvironment(overrides: Record<string, string | undefined> = {}) {
  const previous = new Map<string, string | undefined>();
  const keys = [
    'NODE_ENV',
    'PORT',
    'CORS_ALLOWED_ORIGINS',
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    ...Object.keys(authEnvironmentProcessVariables()),
    ...Object.keys(overrides),
  ];

  for (const key of keys) {
    previous.set(key, process.env[key]);
  }

  process.env['NODE_ENV'] = 'test';
  process.env['PORT'] = String(TEST_ENVIRONMENT.port);
  process.env['CORS_ALLOWED_ORIGINS'] = TEST_ENVIRONMENT.corsAllowedOrigins.join(',');
  process.env['DATABASE_URL'] = TEST_DATABASE_URL;
  process.env['DIRECT_DATABASE_URL'] = TEST_DIRECT_DATABASE_URL;

  for (const [key, value] of Object.entries(authEnvironmentProcessVariables())) {
    process.env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export async function createTestApplication(
  environment: AppEnvironment = TEST_ENVIRONMENT,
): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StructuredLogger)
    .useValue(new StructuredLogger('error'))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, environment);
  await app.init();

  return { app, moduleRef };
}
