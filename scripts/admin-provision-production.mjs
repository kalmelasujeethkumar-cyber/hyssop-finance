#!/usr/bin/env node
// HYSSOP FINANCE — Production Admin provisioning.
//
// Purpose: create the production Admin credential on an already-migrated production
// database. Authority: `docs/05-DATABASE-SPEC.md` ("The Admin bootstrap replaces the
// sentinel with a real Argon2id hash and is the only supported way to provision the
// password") and `docs/07-SECURITY-RULES.md` ("Never log passwords").
//
// This command is the production counterpart of `scripts/admin-bootstrap.mjs`, and it is the
// exact mirror image of that command's restriction. The bootstrap refuses any database whose
// name is not `_dev` or `_test`; this command refuses any database whose name *is* `_dev` or
// `_test`. Neither guard is relaxed: the two commands are mutually exclusive, so neither can
// be used to reach the other's database, and changing this file cannot weaken
// `assertProjectDatabase` in the bootstrap.
//
// Safety properties:
//   * production must be confirmed with an exact opt-in token, so it can never run by
//     accident, by a deploy, or by a stray shell command;
//   * the password is read from the environment only. This command never reads the
//     git-ignored `.env`, so a development value can never be provisioned by accident;
//   * the password is never echoed, never passed as a command-line argument, never written
//     to a log, an audit row, or a document;
//   * it is create-only: an identifier that already exists is reported and left untouched,
//     so an existing credential is never silently overwritten;
//   * Argon2id parameters are identical to the ones the API verifies with;
//   * the create and the revocation of any live session for that identifier commit in one
//     transaction;
//   * the connection uses the schema-owner role, because the least-privilege runtime role
//     has no write access to `admin_user` by design.
//
// Usage: npm run admin:provision:production
// Required environment: HYSSOP_ADMIN_PROVISION_CONFIRM (exact value below),
//                       HYSSOP_ADMIN_PASSWORD (12-128 characters),
//                       HYSSOP_ADMIN_IDENTIFIER (1-64 characters, lower-case),
//                       DIRECT_DATABASE_URL (production schema-owner URL, direct or pooler)
// Optional environment: HYSSOP_ADMIN_DISPLAY_NAME (default "Demo Admin")

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must match `apps/api/src/config/environment.ts` and `.env.example`. */
const ARGON2 = { memoryKib: 19456, iterations: 2, parallelism: 1 };

const CONFIRM_TOKEN = 'provision-production-admin';
const LOGIN_IDENTIFIER_MAX_LENGTH = 64;
const DEFAULT_DISPLAY_NAME = 'Demo Admin';

/** Mirrors the bootstrap: a production URL never ends in `_dev` or `_test`. */
const PROJECT_DATABASE_NAME = /_(test|dev)$/;

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
  const confirm = process.env['HYSSOP_ADMIN_PROVISION_CONFIRM'];
  const password = process.env['HYSSOP_ADMIN_PASSWORD'];
  const identifier = process.env['HYSSOP_ADMIN_IDENTIFIER']?.trim();
  const displayName = (process.env['HYSSOP_ADMIN_DISPLAY_NAME'] ?? DEFAULT_DISPLAY_NAME).trim();
  const databaseUrl = process.env['DIRECT_DATABASE_URL']?.trim();

  if (confirm !== CONFIRM_TOKEN) {
    fail(
      'Production provisioning is not confirmed.\n' +
        `Set HYSSOP_ADMIN_PROVISION_CONFIRM to the exact value "${CONFIRM_TOKEN}" to proceed.\n` +
        'No database connection was opened and nothing was written.',
    );
  }

  if (databaseUrl === undefined || databaseUrl === '') {
    fail(
      'DIRECT_DATABASE_URL is not set.\n' +
        'Production provisioning needs the schema-owner connection, because the runtime role has\n' +
        'no write access to admin_user. A direct or session-pooler URL is preferred; a\n' +
        'transaction pooler is acceptable for this single write, though never for migrations.\n' +
        'The value is never printed.',
    );
  }

  assertProductionDatabase(databaseUrl);

  if (password === undefined || password === '') {
    fail(
      'HYSSOP_ADMIN_PASSWORD is not set.\n' +
        'No database connection was opened and nothing was written.\n' +
        'The value is never printed, logged, or passed to another process.',
    );
  }

  if (password.length < contract.ADMIN_PASSWORD_MIN_LENGTH) {
    fail(`The password must be at least ${contract.ADMIN_PASSWORD_MIN_LENGTH} characters.`);
  }

  if (password.length > contract.ADMIN_PASSWORD_MAX_LENGTH) {
    fail(`The password must be at most ${contract.ADMIN_PASSWORD_MAX_LENGTH} characters.`);
  }

  if (identifier === undefined || identifier === '') {
    fail(
      'HYSSOP_ADMIN_IDENTIFIER is not set.\n' +
        'This command never defaults the identifier, so the intended account is explicit.',
    );
  }

  if (identifier.length > LOGIN_IDENTIFIER_MAX_LENGTH) {
    fail(`The identifier must be at most ${LOGIN_IDENTIFIER_MAX_LENGTH} characters.`);
  }

  if (identifier !== identifier.toLowerCase()) {
    fail(
      'The identifier must be lower-case; the API always normalizes it to lower case.\n' +
        'The sign-in form still accepts the upper-case form the Admin types.',
    );
  }

  if (displayName.length === 0) {
    fail('The display name must not be empty.');
  }

  process.stdout.write(runProvision(databaseUrl, identifier, displayName, password));
}

function runProvision(databaseUrl, identifier, displayName, password) {
  // The password reaches the child through the environment rather than an argument, so it
  // never appears in a process listing. The helper prints only non-secret confirmations.
  const helper = `
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const password = process.env.HYSSOP_PROVISION_PASSWORD;
const identifier = process.env.HYSSOP_PROVISION_IDENTIFIER;
const displayName = process.env.HYSSOP_PROVISION_DISPLAY_NAME;

delete process.env.HYSSOP_PROVISION_PASSWORD;

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.HYSSOP_PROVISION_URL } } });
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: ${ARGON2.memoryKib},
    timeCost: ${ARGON2.iterations},
    parallelism: ${ARGON2.parallelism},
    outputLen: 32,
  });

  // Create-only. An existing identifier is reported and left exactly as it is, so this
  // command can never overwrite an unrelated or already-provisioned credential.
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.adminUser.findUnique({ where: { identifier }, select: { id: true } });

    if (existing !== null) {
      throw new Error(
        'An Admin with this identifier already exists. Nothing was changed. ' +
          'Use scripts/admin-bootstrap.mjs for a project _dev or _test database.',
      );
    }

    const admin = await tx.adminUser.create({
      data: { identifier, displayName, passwordHash },
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
    'Production Admin identifier ' + identifier + ' created with an Argon2id hash.\\n' +
      'Live sessions revoked for that identifier: ' + result.revoked + '.\\n' +
      'No existing Admin record was modified.\\n' +
      'The password was not printed and is not stored in plain text.\\n',
  );
}

main().catch((error) => {
  process.stderr.write((error && error.message ? error.message : String(error)) + '\\n');
  process.exitCode = 1;
});
`;

  // The parent value is removed from the child environment: the child needs only the value
  // under its own name, so a helper that failed for an unrelated reason can never print a
  // variable it did not need.
  const childEnvironment = { ...process.env };
  delete childEnvironment['HYSSOP_ADMIN_PASSWORD'];

  const result = spawnSync(process.execPath, ['-e', helper], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: {
      ...childEnvironment,
      HYSSOP_PROVISION_PASSWORD: password,
      HYSSOP_PROVISION_IDENTIFIER: identifier,
      HYSSOP_PROVISION_DISPLAY_NAME: displayName,
      HYSSOP_PROVISION_URL: databaseUrl,
    },
  });

  if (result.error !== undefined) {
    fail(`Could not start the provisioning helper: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    fail('The production Admin was not provisioned. Nothing was written.');
  }

  return result.stdout ?? '';
}

/**
 * Refuses a project development or test database, so this command cannot be used as a way
 * to provision a throwaway credential in a development database, and so it cannot be aimed
 * at any database by accident: the exact confirmation token is also required.
 */
function assertProductionDatabase(url) {
  const name = /\/([^/?#]+)(\?|$)/.exec(url)?.[1] ?? '';

  if (name === '') {
    fail('DIRECT_DATABASE_URL does not contain a database name. The value is never printed.');
  }

  if (PROJECT_DATABASE_NAME.test(name)) {
    fail(
      `Refusing to provision a production credential in database "${name}": ` +
        'this command accepts production databases only. ' +
        'Use `npm run admin:bootstrap` for a project _dev or _test database.',
    );
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
