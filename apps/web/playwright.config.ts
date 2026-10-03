import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolveTestDatabaseUrls } from './e2e/support/test-database';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const webPort = 4173;
const apiPort = 3300;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const devBaseUrl = `http://localhost:${webPort}`;
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/v1/health`;
const isContinuousIntegration = process.env['CI'] !== undefined;

/**
 * Resolved here, while the config is loaded, rather than in the global setup hook, so the API
 * process is started against the test database on every run. The browser run signs in and
 * writes sessions, so it must never be pointed at a development or demo database.
 */
const testDatabase = resolveTestDatabaseUrls();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isContinuousIntegration,
  retries: isContinuousIntegration ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start --workspace @hyssop/api',
      cwd: repositoryRoot,
      url: apiHealthUrl,
      reuseExistingServer: !isContinuousIntegration,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        CORS_ALLOWED_ORIGINS: [webBaseUrl, devBaseUrl].join(','),
        DATABASE_URL: testDatabase.runtimeUrl,
        DIRECT_DATABASE_URL: testDatabase.migrationUrl,
        // The suite signs in from one address several times, and the limiter is per process and
        // per client fingerprint, so the documented 5-attempt default would block the *later*
        // journeys and make unrelated tests fail. The limit stays enforced and configurable; only
        // this throwaway test process gets a higher ceiling. The real threshold and the generic
        // rate-limit message are verified against the documented values in
        // `apps/api/test/database/auth-http.db-spec.ts`.
        LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '100',
        // The same reasoning applies to the general abuse ceilings: the suite drives one
        // Admin through several journeys from one address, and one shared in-memory limiter.
        // Only this throwaway test process is opened wider; the documented defaults and the
        // generic 429 envelope are verified for every category in
        // `apps/api/test/database/rate-limit-http.db-spec.ts`.
        MUTATION_RATE_LIMIT_MAX_REQUESTS: '5000',
        SEARCH_RATE_LIMIT_MAX_REQUESTS: '5000',
        UPLOAD_RATE_LIMIT_MAX_REQUESTS: '500',
        EXPORT_RATE_LIMIT_MAX_REQUESTS: '500',
      },
    },
    {
      command: 'npm run preview --workspace @hyssop/web',
      cwd: repositoryRoot,
      url: webBaseUrl,
      reuseExistingServer: !isContinuousIntegration,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
