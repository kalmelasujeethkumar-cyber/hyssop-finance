#!/usr/bin/env node
// HYSSOP FINANCE — migration drift verification.
//
// Purpose: prove that the committed Prisma migrations and `prisma/schema.prisma`
// describe the same database, and that the development database matches that schema.
// Authority: `docs/05-DATABASE-SPEC.md` (migrations are reviewed before application) and
// `docs/09-GIT-RULES.md` (verification must be repeatable and must not destroy data).
//
// Safety properties:
//   * the schema-history comparison runs against a DISPOSABLE shadow database that this
//     script creates and always drops, because `prisma migrate diff` resets the shadow
//     database before use. Pointing `--shadow-database-url` at a live database destroys
//     that database, so the shadow name is guarded to end with `_shadow` and the script
//     refuses to run when the guard fails;
//   * the development-database comparison uses `--from-url`, which only reads;
//   * no password or credential is passed on any command line.
//
// Usage: node scripts/migration-drift.mjs
// Exit codes: 0 no drift, 2 drift found, 1 verification could not run.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsPostgresBin = 'C:\\Program Files\\PostgreSQL\\16\\bin';

const config = {
  port: Number.parseInt(process.env['HYSSOP_PG_PORT'] ?? '55432', 10),
  superuser: process.env['HYSSOP_PG_SUPERUSER'] ?? 'hyssop_pg_admin',
  migratorRole: process.env['HYSSOP_PG_MIGRATOR_ROLE'] ?? 'hyssop_migrator',
  appRole: process.env['HYSSOP_PG_APP_ROLE'] ?? 'hyssop_app',
  developmentDatabase: process.env['HYSSOP_PG_DEV_DATABASE'] ?? 'hyssop_finance_dev',
  shadowDatabase: process.env['HYSSOP_PG_SHADOW_DATABASE'] ?? 'hyssop_finance_shadow',
};

function resolveBinary(name) {
  const configured = process.env['HYSSOP_PG_BIN'];

  if (configured !== undefined && configured !== '') {
    return join(configured, `${name}.exe`);
  }

  if (process.platform === 'win32' && existsSync(windowsPostgresBin)) {
    return join(windowsPostgresBin, `${name}.exe`);
  }

  return name;
}

function psql(database, sql) {
  const result = spawnSync(
    resolveBinary('psql'),
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(config.port),
      '-U',
      config.superuser,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-c',
      sql,
    ],
    { encoding: 'utf8', shell: false },
  );

  if (result.error !== undefined && result.error !== null) {
    throw new Error(`psql failed: ${result.error.message}`);
  }

  return result;
}

function databaseUrl(database, role) {
  return `postgresql://${role}@127.0.0.1:${config.port}/${database}?schema=public`;
}

function prismaCliEntry() {
  const entry = join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');

  if (!existsSync(entry)) {
    throw new Error('The pinned Prisma CLI is not installed. Run npm install first.');
  }

  return entry;
}

/**
 * The shadow database is destroyed by `prisma migrate diff` on every run, so it must
 * never be a database that holds data. The name guard is the only thing standing between
 * a mistyped environment variable and a destroyed development database, so it is checked
 * before anything else runs.
 */
function requireDisposableShadowDatabase() {
  if (!config.shadowDatabase.endsWith('_shadow')) {
    throw new Error(
      `Refusing to use "${config.shadowDatabase}" as a shadow database: the name must end with _shadow because prisma migrate diff resets it.`,
    );
  }

  if (config.shadowDatabase === config.developmentDatabase) {
    throw new Error('Refusing to use the development database as a shadow database.');
  }
}

function createShadowDatabase() {
  psql(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${config.shadowDatabase}' AND pid <> pg_backend_pid();`,
  );
  psql('postgres', `DROP DATABASE IF EXISTS ${config.shadowDatabase}`);
  // The shadow database is owned by the migration role because `prisma migrate diff`
  // applies the whole migration history into it while replaying it.
  psql('postgres', `CREATE DATABASE ${config.shadowDatabase} OWNER ${config.migratorRole}`);
}

function dropShadowDatabase() {
  psql(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${config.shadowDatabase}' AND pid <> pg_backend_pid();`,
  );
  psql('postgres', `DROP DATABASE IF EXISTS ${config.shadowDatabase}`);
}

function runPrismaDiff(args) {
  // The Prisma CLI is invoked through the current Node executable and the pinned local
  // CLI entry point. Spawning `npx`/`prisma.cmd` would need a shell on Windows, and a
  // shell would also be a place where a credential-bearing argument could be expanded.
  return spawnSync(process.execPath, [prismaCliEntry(), 'migrate', 'diff', ...args], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
  });
}

function reportStep(step, exitCode) {
  if (exitCode === 0) {
    console.log(`\n=== ${step}: no difference detected ===`);
    return 0;
  }

  if (exitCode === 2) {
    console.error(`\n=== ${step}: DRIFT DETECTED ===`);
    return 2;
  }

  console.error(`\n=== ${step}: verification could not run (exit ${exitCode}) ===`);
  return 1;
}

function main() {
  requireDisposableShadowDatabase();

  if (!existsSync(join(repositoryRoot, 'prisma', 'migrations', 'migration_lock.toml'))) {
    throw new Error(
      'prisma/migrations/migration_lock.toml is missing, so the migration directory is not a valid Prisma migrations directory.',
    );
  }

  console.log(`Disposable shadow database: ${config.shadowDatabase}`);
  createShadowDatabase();

  let status = 0;

  try {
    const history = runPrismaDiff([
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      databaseUrl(config.shadowDatabase, config.migratorRole),
      '--exit-code',
    ]);
    status = reportStep('migration history vs prisma/schema.prisma', history.status ?? 1);

    const live = runPrismaDiff([
      '--from-url',
      databaseUrl(config.developmentDatabase, config.appRole),
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    const liveStatus = reportStep(
      `${config.developmentDatabase} vs prisma/schema.prisma`,
      live.status ?? 1,
    );

    if (status === 0) {
      status = liveStatus;
    }
  } finally {
    dropShadowDatabase();
    console.log(`\nDropped the disposable shadow database ${config.shadowDatabase}.`);
  }

  process.exitCode = status;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
