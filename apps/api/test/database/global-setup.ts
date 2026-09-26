/**
 * Fails fast when the test database is unavailable or is not a `_test` database, and
 * applies the reviewed migrations so `npm run test:db` is a single command.
 *
 * The schema under test is therefore always exactly the reviewed migration, and the
 * suite can never truncate a development or demo database.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { databaseName, testDatabaseUrl } from './support/database-connection';

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

loadRepositoryEnvironment();

/**
 * The suite runs against the `_test` sibling of the configured development database, so a
 * single `.env` is enough and no test can ever reach a development or demo database. An
 * explicit `TEST_DATABASE_URL` still wins.
 */
const runtimeUrl = testDatabaseUrl(requireValue('TEST_DATABASE_URL', 'DATABASE_URL'));
const migrationUrl = testDatabaseUrl(
  requireValue('TEST_DIRECT_DATABASE_URL', 'DIRECT_DATABASE_URL'),
);

process.env['TEST_DATABASE_URL'] = runtimeUrl;
process.env['TEST_DIRECT_DATABASE_URL'] = migrationUrl;

for (const url of [runtimeUrl, migrationUrl]) {
  if (!databaseName(url).endsWith('_test')) {
    throw new Error(`Refusing to run the database suite against "${databaseName(url)}".`);
  }
}

export default function globalSetup(): void {
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [REPOSITORY_ROOT] });

  execFileSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'deploy',
      '--schema',
      path.join(REPOSITORY_ROOT, 'prisma', 'schema.prisma'),
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: migrationUrl },
      stdio: 'inherit',
    },
  );
}

function requireValue(primary: string, fallback: string): string {
  const value = process.env[primary] ?? process.env[fallback];

  if (value === undefined || value === '') {
    throw new Error(
      `${primary} or ${fallback} is required. Start the project database with ` +
        '`npm run db:start` and apply migrations with `npm run db:migrate`.',
    );
  }

  return value;
}

/**
 * Loads the git-ignored repository `.env` for the suite, without adding a dependency
 * or overriding a value the caller already exported.
 */
function loadRepositoryEnvironment(): void {
  const envPath = path.join(REPOSITORY_ROOT, '.env');

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
