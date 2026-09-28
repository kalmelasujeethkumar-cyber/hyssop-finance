#!/usr/bin/env node
// HYSSOP FINANCE — Admin credential bootstrap.
//
// Purpose: provision the single Admin's password. It replaces the documented
// unusable-credential sentinel (`!unprovisioned`) that `prisma/seed.ts` writes with a real
// Argon2id hash. Authority: `docs/05-DATABASE-SPEC.md` ("The Admin bootstrap replaces the
// sentinel with a real Argon2id hash and is the only supported way to provision the
// password") and `docs/07-SECURITY-RULES.md` ("Never log passwords").
//
// This is a developer command, never an application feature and never an API route. The
// running API deliberately does not read `HYSSOP_ADMIN_PASSWORD`.
//
// Safety properties:
//   * the password is read from the environment or the git-ignored `.env`, and is never
//     echoed, never passed as a command-line argument, and never written to a log, an
//     audit row, or a document;
//   * the value is hashed with the same Argon2id parameters the API verifies with;
//   * every live session is revoked afterwards, because changing a credential must
//     invalidate the sessions created under the previous one;
//   * the connection uses the schema-owner role, since the least-privilege runtime role
//     has no write access to `admin_user` by design;
//   * it refuses to run against any database whose name is not a project _dev or _test
//     database, so a misconfigured URL cannot rewrite a credential elsewhere.
//
// Usage: npm run admin:bootstrap
// Required environment: HYSSOP_ADMIN_PASSWORD (12-128 characters)
// Optional environment: HYSSOP_ADMIN_IDENTIFIER (default "admin"),
//                       HYSSOP_ADMIN_DISPLAY_NAME (default "Demo Admin"),
//                       DIRECT_DATABASE_URL (default: the local migrator URL)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must match `apps/api/src/config/environment.ts` and `.env.example`. */
const ARGON2 = { memoryKib: 19456, iterations: 2, parallelism: 1 };

const LOGIN_IDENTIFIER_MAX_LENGTH = 64;
const DEFAULT_IDENTIFIER = 'admin';
const DEFAULT_DISPLAY_NAME = 'Demo Admin';

const config = {
  port: Number.parseInt(process.env['HYSSOP_PG_PORT'] ?? '55432', 10),
  migratorRole: process.env['HYSSOP_PG_MIGRATOR_ROLE'] ?? 'hyssop_migrator',
  developmentDatabase: process.env['HYSSOP_PG_DEV_DATABASE'] ?? 'hyssop_finance_dev',
};

const contract = await loadContract();

main();

async function loadContract() {
  try {
    return await import('@hyssop/contracts');
  } catch (error) {
    fail(
      'The shared contract package is not built, so the password policy cannot be read.\n' +
        'Run `npm run build:contracts` and try again.\n' +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function main() {
  const settings = readDotEnv();
  const password = process.env['HYSSOP_ADMIN_PASSWORD'] ?? settings['HYSSOP_ADMIN_PASSWORD'];
  const identifier = (
    process.env['HYSSOP_ADMIN_IDENTIFIER'] ??
    settings['HYSSOP_ADMIN_IDENTIFIER'] ??
    DEFAULT_IDENTIFIER
  ).trim();
  const displayName = (
    process.env['HYSSOP_ADMIN_DISPLAY_NAME'] ??
    settings['HYSSOP_ADMIN_DISPLAY_NAME'] ??
    DEFAULT_DISPLAY_NAME
  ).trim();

  if (password === undefined || password === '') {
    fail(
      'HYSSOP_ADMIN_PASSWORD is not set.\n' +
        'Add it to your git-ignored .env file and run the command again.\n' +
        'The value is never printed, logged, or passed to another process.',
    );
  }

  // The same policy the API enforces, read from the shared contract so the two cannot
  // drift. The message names the rule and never the value.
  if (password.length < contract.ADMIN_PASSWORD_MIN_LENGTH) {
    fail(`The password must be at least ${contract.ADMIN_PASSWORD_MIN_LENGTH} characters.`);
  }

  if (password.length > contract.ADMIN_PASSWORD_MAX_LENGTH) {
    fail(`The password must be at most ${contract.ADMIN_PASSWORD_MAX_LENGTH} characters.`);
  }

  if (identifier.length < 1 || identifier.length > LOGIN_IDENTIFIER_MAX_LENGTH) {
    fail(`The identifier must be 1 to ${LOGIN_IDENTIFIER_MAX_LENGTH} characters.`);
  }

  if (identifier !== identifier.toLowerCase()) {
    fail('The identifier must be lower-case; the API always normalizes it to lower case.');
  }

  if (displayName.length === 0) {
    fail('The display name must not be empty.');
  }

  process.stdout.write(
    runBootstrap(resolveDatabaseUrl(settings), identifier, displayName, password),
  );
}

function runBootstrap(databaseUrl, identifier, displayName, password) {
  // The password reaches the child through the environment rather than an argument, so it
  // never appears in a process listing. The helper prints only non-secret confirmations.
  //
  // `HYSSOP_ADMIN_PASSWORD` is removed from the child environment: the child needs only the
  // value under its own name, and a helper that failed for an unrelated reason must not be
  // able to print a variable it never needed.
  const helper = `
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const password = process.env.HYSSOP_BOOTSTRAP_PASSWORD;
const identifier = process.env.HYSSOP_BOOTSTRAP_IDENTIFIER;
const displayName = process.env.HYSSOP_BOOTSTRAP_DISPLAY_NAME;

delete process.env.HYSSOP_BOOTSTRAP_PASSWORD;

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.HYSSOP_BOOTSTRAP_URL } } });
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: ${ARGON2.memoryKib},
    timeCost: ${ARGON2.iterations},
    parallelism: ${ARGON2.parallelism},
    outputLen: 32,
  });

  // The new credential and the revocation of the previous credential's sessions are one
  // unit of work. Without the transaction a failure between them would leave a changed
  // password with sessions that were created under the old one still usable.
  const result = await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.upsert({
      where: { identifier },
      create: { identifier, displayName, passwordHash },
      update: { displayName, passwordHash },
      select: { id: true },
    });
    const revoked = await tx.adminSession.updateMany({
      where: { adminUserId: admin.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REPLACED' },
    });

    return { revoked: revoked.count };
  });

  await prisma.$disconnect();
  process.stdout.write(
    'Admin identifier ' + identifier + ' provisioned with an Argon2id hash.\\n' +
      'Live sessions revoked: ' + result.revoked + '.\\n' +
      'The password was not printed and is not stored in plain text.\\n',
  );
}

main().catch((error) => {
  process.stderr.write((error && error.message ? error.message : String(error)) + '\\n');
  process.exitCode = 1;
});
`;

  const childEnvironment = { ...process.env };
  delete childEnvironment['HYSSOP_ADMIN_PASSWORD'];

  const result = spawnSync(process.execPath, ['-e', helper], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: {
      ...childEnvironment,
      HYSSOP_BOOTSTRAP_PASSWORD: password,
      HYSSOP_BOOTSTRAP_IDENTIFIER: identifier,
      HYSSOP_BOOTSTRAP_DISPLAY_NAME: displayName,
      HYSSOP_BOOTSTRAP_URL: databaseUrl,
    },
  });

  if (result.error !== undefined) {
    fail(`Could not start the bootstrap helper: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    fail(
      'The Admin credential was not provisioned. If the Admin row does not exist yet, run ' +
        '`npm run db:seed` first, then run this command again.',
    );
  }

  return result.stdout ?? '';
}

function resolveDatabaseUrl(settings) {
  const configured = process.env['DIRECT_DATABASE_URL'] ?? settings['DIRECT_DATABASE_URL'];

  if (configured !== undefined && configured !== '') {
    assertProjectDatabase(configured);
    return configured;
  }

  const url = `postgresql://${config.migratorRole}@127.0.0.1:${config.port}/${config.developmentDatabase}?schema=public`;
  assertProjectDatabase(url);

  return url;
}

/**
 * Refuses any database that is not a project development or test database, so a
 * misconfigured `DIRECT_DATABASE_URL` can never rewrite a credential somewhere else.
 */
function assertProjectDatabase(url) {
  const name = /\/([^/?#]+)(\?|$)/.exec(url)?.[1] ?? '';

  if (!/_(test|dev)$/.test(name)) {
    fail(
      `Refusing to provision a credential in database "${name}": a project database name must end with _dev or _test.`,
    );
  }
}

/** Reads the git-ignored `.env` so the password can be kept out of shell history. */
function readDotEnv() {
  const values = {};
  const path = join(repositoryRoot, '.env');

  if (!existsSync(path)) {
    return values;
  }

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');

    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    // A quoted value keeps its inner characters; nothing is unescaped or evaluated.
    values[key] = value.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  }

  return values;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
