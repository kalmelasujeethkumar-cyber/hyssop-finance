/**
 * Connection helpers for the database test harness.
 *
 * The suite refuses to run against a database whose name does not end in `_test`, so a
 * test can never truncate a development or demo database.
 */

export function databaseName(url: string): string {
  const path = /^postgres(?:ql)?:\/\/[^/?#]*\/([^?#]*)/.exec(url)?.[1];
  return path === undefined ? '' : decodeURIComponent(path);
}

export function databaseNames(url: string): string {
  return databaseName(url);
}

/**
 * Returns the `_test` sibling of a connection URL, so `npm run test:db` needs no extra
 * configuration while the safety guard still holds. A URL that already points at a
 * `_test` database is returned unchanged.
 */
export function testDatabaseUrl(url: string): string {
  const parts = /^(postgres(?:ql)?:\/\/[^/?#]*\/)([^?#]*)(.*)$/.exec(url);

  if (parts === null) {
    throw new Error(`Cannot read a PostgreSQL connection URL from "${url}".`);
  }

  const prefix = parts[1] ?? '';
  const name = decodeURIComponent(parts[2] ?? '');
  const rest = parts[3] ?? '';

  if (name.endsWith('_test')) {
    return url;
  }

  const base = name.replace(/_(dev|test)$/, '');

  if (base === '') {
    throw new Error(`Cannot derive a test database name from "${url}".`);
  }

  return `${prefix}${encodeURIComponent(`${base}_test`)}${rest}`;
}

export function requireTestDatabaseUrls(): {
  runtimeUrl: string;
  migrationUrl: string;
} {
  const runtimeUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  const migrationUrl =
    process.env['TEST_DIRECT_DATABASE_URL'] ?? process.env['DIRECT_DATABASE_URL'];

  if (runtimeUrl === undefined || runtimeUrl === '') {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for the database tests.');
  }

  if (migrationUrl === undefined || migrationUrl === '') {
    throw new Error(
      'TEST_DIRECT_DATABASE_URL or DIRECT_DATABASE_URL is required for the database tests.',
    );
  }

  for (const url of [runtimeUrl, migrationUrl]) {
    const name = databaseName(url);

    if (!name.endsWith('_test')) {
      throw new Error(
        `Refusing to run against "${name}": the database name must end in _test. ` +
          'Start the project test database with `npm run db:start`.',
      );
    }
  }

  return { runtimeUrl, migrationUrl };
}
