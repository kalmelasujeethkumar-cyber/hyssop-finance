import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const webPort = 4173;
const apiPort = 3300;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const devBaseUrl = `http://localhost:${webPort}`;
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/v1/health`;
const isContinuousIntegration = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isContinuousIntegration,
  retries: isContinuousIntegration ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
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
