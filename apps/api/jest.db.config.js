/**
 * Database test configuration.
 *
 * Runs the real PostgreSQL integration tests in `test/database`. It is deliberately
 * separate from `jest.config.js`: those tests need a live disposable database, and the
 * ordinary unit and foundation suites must stay runnable without one.
 *
 * Authority: `docs/10-TEST-PLAN.md` and `docs/05-DATABASE-SPEC.md` (PostgreSQL is the
 * system of record, so persistence is proven against real PostgreSQL rather than an
 * in-memory substitute).
 */

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/database'],
  testRegex: '.*\\.db-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/database/global-setup.ts',
  globalTeardown: '<rootDir>/test/database/global-teardown.ts',
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 120000,
  maxWorkers: 1,
};
