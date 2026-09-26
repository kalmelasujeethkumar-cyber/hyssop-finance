import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { StructuredLogger } from '../../src/common/logging/structured-logger';
import type { AppEnvironment } from '../../src/config/environment';

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

export const TEST_ENVIRONMENT: AppEnvironment = {
  nodeEnv: 'test',
  port: 3000,
  corsAllowedOrigins: [TEST_ORIGIN],
  logLevel: 'info',
  databaseUrl: TEST_DATABASE_URL,
  directDatabaseUrl: TEST_DIRECT_DATABASE_URL,
};

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
