#!/usr/bin/env node
// HYSSOP FINANCE — disposable local PostgreSQL workflow.
//
// Purpose: create, start, stop, and reset a project-scoped PostgreSQL cluster for
// development and database tests, plus apply least-privilege grants to the runtime
// role. Authority: `docs/05-DATABASE-SPEC.md` (disposable instance, real-PostgreSQL
// tests, append-only audit) and `docs/02-ARCHITECTURE.md` (PostgreSQL as system of
// record). Docker/Compose is the documented alternative and lives in
// `docker-compose.yml`; this script exists because Docker is not installed on every
// developer machine.
//
// Safety properties:
//   * the cluster is created inside the repository at `tmp/pgdata` (git-ignored),
//     binds only to 127.0.0.1 on a non-default port, and never touches any
//     PostgreSQL service, data directory, or database outside this project;
//   * `reset-test` refuses to run unless the database name ends with `_test`;
//   * credentials are not stored: the cluster uses local trust authentication and the
//     URLs contain no password.
//
// Usage: node scripts/local-postgres.mjs <start|stop|status|grant|reset|reset-test|urls>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsPostgresBin = 'C:\\Program Files\\PostgreSQL\\16\\bin';

const config = {
  port: Number.parseInt(process.env['HYSSOP_PG_PORT'] ?? '55432', 10),
  dataDir: resolve(process.env['HYSSOP_PG_DATA_DIR'] ?? join(repositoryRoot, 'tmp', 'pgdata')),
  superuser: process.env['HYSSOP_PG_SUPERUSER'] ?? 'hyssop_pg_admin',
  migratorRole: process.env['HYSSOP_PG_MIGRATOR_ROLE'] ?? 'hyssop_migrator',
  appRole: process.env['HYSSOP_PG_APP_ROLE'] ?? 'hyssop_app',
  developmentDatabase: process.env['HYSSOP_PG_DEV_DATABASE'] ?? 'hyssop_finance_dev',
  testDatabase: process.env['HYSSOP_PG_TEST_DATABASE'] ?? 'hyssop_finance_test',
};

const APP_DATABASES = [config.developmentDatabase, config.testDatabase];

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

function run(binary, args, options = {}) {
  const result = spawnSync(resolveBinary(binary), args, {
    stdio: options.quiet === true ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
  });

  if (result.error !== undefined && result.error !== null) {
    throw new Error(`Failed to run ${binary}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = options.quiet === true ? (result.stderr ?? '').trim() : '';
    throw new Error(
      `${binary} exited with status ${result.status}${detail === '' ? '' : `: ${detail}`}`,
    );
  }

  return result.stdout ?? '';
}

function psql(database, sql) {
  run('psql', [
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
  ]);
}

function databaseUrl(database, role) {
  return `postgresql://${role}@127.0.0.1:${config.port}/${database}?schema=public`;
}

function requireProjectDatabase(database) {
  if (!/_(test|dev)$/.test(database)) {
    throw new Error(
      `Refusing to reset "${database}": a project database name must end with _dev or _test.`,
    );
  }
}

function recreateDatabase(database) {
  requireProjectDatabase(database);
  psql(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${database}' AND pid <> pg_backend_pid();`,
  );
  psql('postgres', `DROP DATABASE IF EXISTS ${database}`);
  psql('postgres', `CREATE DATABASE ${database} OWNER ${config.migratorRole}`);
  console.log(`Recreated ${database}`);
}

function ensureRoles() {
  psql(
    'postgres',
    `DO $do$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${config.migratorRole}') THEN
         CREATE ROLE ${config.migratorRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${config.appRole}') THEN
         CREATE ROLE ${config.appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
       END IF;
     END
     $do$;`,
  );
}

function ensureDatabases() {
  const existing = run(
    'psql',
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(config.port),
      '-U',
      config.superuser,
      '-d',
      'postgres',
      '-tAc',
      "SELECT datname FROM pg_database WHERE datname IN ('" + APP_DATABASES.join("', '") + "')",
    ],
    { quiet: true },
  );

  for (const database of APP_DATABASES) {
    if (!existing.includes(database)) {
      psql('postgres', `CREATE DATABASE ${database} OWNER ${config.migratorRole}`);
    }
  }
}

/**
 * Instance-level provisioning for the runtime role: schema access, database
 * connectivity, and keeping the `public` schema away from `PUBLIC`.
 *
 * Object-level table privileges are deliberately NOT applied here. They are owned by
 * the reviewed migration `20260926140000_runtime_role_grants`, because anything applied
 * only here is silently lost by `prisma migrate reset`, a recreated database, or a fresh
 * CI database, which previously left the development database without runtime
 * privileges while every migration still reported success.
 */
function applyInstancePrivileges() {
  for (const database of APP_DATABASES) {
    psql(
      database,
      `REVOKE ALL ON SCHEMA public FROM PUBLIC;
       GRANT USAGE ON SCHEMA public TO ${config.appRole};
       GRANT CONNECT ON DATABASE ${database} TO ${config.appRole};`,
    );
  }
}

function initializeCluster() {
  if (existsSync(join(config.dataDir, 'PG_VERSION'))) {
    return;
  }

  mkdirSync(config.dataDir, { recursive: true });
  console.log(`Initializing a disposable cluster in ${config.dataDir}`);
  run('initdb', [
    '-D',
    config.dataDir,
    '-U',
    config.superuser,
    '--auth-local=trust',
    '--auth-host=trust',
    '-E',
    'UTF8',
    '--locale=C',
  ]);
}

function isRunning() {
  if (!existsSync(join(config.dataDir, 'PG_VERSION'))) {
    return false;
  }

  return (
    spawnSync(resolveBinary('pg_ctl'), ['-D', config.dataDir, 'status'], {
      stdio: 'pipe',
      encoding: 'utf8',
      shell: false,
    }).status === 0
  );
}

function start() {
  initializeCluster();

  if (isRunning()) {
    console.log('The project cluster is already running.');
  } else {
    run('pg_ctl', [
      '-D',
      config.dataDir,
      '-l',
      join(config.dataDir, 'server.log'),
      '-o',
      `-p ${config.port} -h 127.0.0.1 -c listen_addresses=127.0.0.1`,
      '-w',
      'start',
    ]);
  }

  ensureRoles();
  ensureDatabases();
  applyInstancePrivileges();
  reportUrls();
}

function stop() {
  if (!existsSync(join(config.dataDir, 'PG_VERSION'))) {
    console.log('No project cluster exists; nothing to stop.');
    return;
  }

  run('pg_ctl', ['-D', config.dataDir, '-m', 'fast', '-w', 'stop']);
}

function status() {
  if (!existsSync(join(config.dataDir, 'PG_VERSION'))) {
    console.log('No project cluster exists. Run `npm run db:start`.');
    process.exitCode = 1;
    return;
  }

  console.log(isRunning() ? 'The project cluster is running.' : 'The project cluster is stopped.');
  run('pg_isready', ['-h', '127.0.0.1', '-p', String(config.port), '-q']);
}

function resetTestDatabase() {
  recreateDatabase(config.testDatabase);
  applyInstancePrivileges();
}

function reportUrls() {
  console.log('');
  console.log('Database URLs (no credentials; local trust authentication):');
  for (const database of APP_DATABASES) {
    console.log(`  runtime  ${database} : ${databaseUrl(database, config.appRole)}`);
    console.log(`  migration ${database} : ${databaseUrl(database, config.migratorRole)}`);
  }
  console.log('');
  console.log('Add the runtime URL to DATABASE_URL and the migration URL to');
  console.log('DIRECT_DATABASE_URL in your git-ignored .env file.');
}

const command = process.argv[2];

try {
  switch (command) {
    case 'start': {
      start();
      break;
    }
    case 'stop': {
      stop();
      break;
    }
    case 'status': {
      status();
      break;
    }
    case 'grant': {
      ensureRoles();
      ensureDatabases();
      applyInstancePrivileges();
      console.log(
        'Instance-level privileges applied. Table privileges come from the reviewed migration.',
      );
      break;
    }
    case 'reset-test': {
      resetTestDatabase();
      break;
    }
    case 'reset': {
      for (const database of APP_DATABASES) {
        recreateDatabase(database);
      }
      applyInstancePrivileges();
      break;
    }
    case 'urls': {
      reportUrls();
      break;
    }
    default: {
      console.error(
        'Usage: node scripts/local-postgres.mjs <start|stop|status|grant|reset|reset-test|urls>',
      );
      process.exitCode = 1;
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
