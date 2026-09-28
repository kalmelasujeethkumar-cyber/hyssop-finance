/**
 * Test database resolution for the browser run.
 *
 * The browser acceptance run must exercise the real API against a real PostgreSQL database,
 * and it must never touch the development or demo database: the run provisions a credential
 * and writes sessions. So the same `_test` sibling rule the database suite enforces is
 * applied here, by reusing that suite's helper rather than restating it.
 *
 * Authority: `docs/10-TEST-PLAN.md` (the E2E layer runs against a real deployed-shaped
 * stack) and `docs/05-DATABASE-SPEC.md` (PostgreSQL is the system of record).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  databaseName,
  testDatabaseUrl,
} from '../../../api/test/database/support/database-connection';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

export interface TestDatabaseUrls {
  /** Least-privilege runtime URL, used by the API process under test. */
  readonly runtimeUrl: string;
  /** Schema-owner URL, used only to apply migrations and provision the credential. */
  readonly migrationUrl: string;
}

export function resolveTestDatabaseUrls(): TestDatabaseUrls {
  loadRepositoryEnvironment();

  const runtimeUrl = testDatabaseUrl(requireValue('TEST_DATABASE_URL', 'DATABASE_URL'));
  const migrationUrl = testDatabaseUrl(
    requireValue('TEST_DIRECT_DATABASE_URL', 'DIRECT_DATABASE_URL'),
  );

  for (const url of [runtimeUrl, migrationUrl]) {
    if (!databaseName(url).endsWith('_test')) {
      throw new Error(
        `Refusing to run the browser acceptance tests against "${databaseName(url)}": ` +
          'the database name must end in _test.',
      );
    }
  }

  return { runtimeUrl, migrationUrl };
}

function requireValue(primary: string, fallback: string): string {
  const value = process.env[primary] ?? process.env[fallback];

  if (value === undefined || value === '') {
    throw new Error(
      `${primary} or ${fallback} is required to run the browser acceptance tests. ` +
        'Start the project database with `npm run db:start` and apply migrations with ' +
        '`npm run db:migrate`.',
    );
  }

  return value;
}

/** Loads the git-ignored repository `.env` without overriding an exported value. */
function loadRepositoryEnvironment(): void {
  const envPath = join(REPOSITORY_ROOT, '.env');

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);

    if (match === null) {
      continue;
    }

    const key = match[1] ?? '';
    const value = (match[2] ?? '').trim();

    if (key !== '' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
