#!/usr/bin/env node
// HYSSOP FINANCE — Production Admin credential recovery.
//
// Purpose: replace the credential of the existing production Admin when its password has
// been forgotten. Authority: `docs/05-DATABASE-SPEC.md` (the Admin credential is the only
// supported way to provision a password, and no plaintext is ever stored) and
// `docs/07-SECURITY-RULES.md` ("Never log passwords").
//
// Relationship to `scripts/admin-bootstrap.mjs`, which refuses every database that is not
// `_dev` or `_test`. This command is the production counterpart: it accepts production
// databases only and refuses any `_dev` or `_test` database. It differs in one respect — it
// is the only command that may change the credential of an Admin that already exists,
// whereas the bootstrap provisions a project credential. Neither guard is relaxed here.
//
// Safety properties:
//   * recovery must be confirmed with an exact opt-in token, so it can never run by accident;
//   * the password is read from the environment only. This command never reads the
//     git-ignored `.env`, so a development value cannot reach production by accident;
//   * the password is never echoed, never passed as a command-line argument, never written
//     to a log, an audit row, or a document, and the stored hash is never printed;
//   * it targets exactly one Admin. If the requested identifier does not exist and the
//     table does not hold exactly one Admin, it fails and changes nothing, because a
//     forgotten credential is not a reason to guess which account to overwrite;
//   * Argon2id parameters are identical to the ones the API verifies with, so the
//     application can verify the new hash and `needsRehash` stays false;
//   * the credential change and the revocation of every live session for that Admin commit
//     in one transaction, so no session created under the old credential survives;
//   * it writes with Prisma model operations only: one UPDATE of the Admin row and one
//     bounded UPDATE of that Admin's sessions. There is no DELETE, DROP, TRUNCATE, or
//     reset anywhere in this file, and no financial, member, transaction, or document table
//     is read or written. Renaming the identifier leaves the row's `id` untouched, so every
//     foreign key that references it, including audit events and financial records, is
//     unaffected;
//   * the connection uses the schema-owner role, because the least-privilege runtime role
//     has no write access to `admin_user` by design.
//
// Usage: npm run admin:recover:production
// Required environment: HYSSOP_ADMIN_RECOVER_CONFIRM (exact value below),
//                       HYSSOP_ADMIN_PASSWORD (12-128 characters),
//                       HYSSOP_ADMIN_IDENTIFIER (1-64 characters, lower-case),
//                       DIRECT_DATABASE_URL (production schema-owner URL, direct or pooler)
// Optional environment: HYSSOP_ADMIN_DISPLAY_NAME (keeps the stored name when unset)

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must match `apps/api/src/config/environment.ts` and `.env.example`. */
const ARGON2 = { memoryKib: 19456, iterations: 2, parallelism: 1 };

const CONFIRM_TOKEN = 'recover-production-admin';
const LOGIN_IDENTIFIER_MAX_LENGTH = 64;
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
  const confirm = process.env['HYSSOP_ADMIN_RECOVER_CONFIRM'];
  const password = process.env['HYSSOP_ADMIN_PASSWORD'];
  const identifier = process.env['HYSSOP_ADMIN_IDENTIFIER']?.trim();
  const displayName = process.env['HYSSOP_ADMIN_DISPLAY_NAME']?.trim();
  const databaseUrl = process.env['DIRECT_DATABASE_URL']?.trim();

  if (confirm !== CONFIRM_TOKEN) {
    fail(
      'Production recovery is not confirmed.\n' +
        `Set HYSSOP_ADMIN_RECOVER_CONFIRM to the exact value "${CONFIRM_TOKEN}" to proceed.\n` +
        'No database connection was opened and nothing was written.',
    );
  }

  if (databaseUrl === undefined || databaseUrl === '') {
    fail(
      'DIRECT_DATABASE_URL is not set.\n' +
        'Recovery needs the schema-owner connection, because the runtime role has no write\n' +
        'access to admin_user. A direct or session-pooler URL is preferred; a transaction\n' +
        'pooler is acceptable for this single write, though never for migrations.\n' +
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
        'This command never guesses the account, so the intended identifier is explicit.',
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

  if (displayName !== undefined && displayName.length === 0) {
    fail('The display name must not be empty.');
  }

  process.stdout.write(runRecovery(databaseUrl, identifier, displayName, password));
}

function runRecovery(databaseUrl, identifier, displayName, password) {
  // The password reaches the child through the environment rather than an argument, so it
  // never appears in a process listing. The helper prints only non-secret confirmations.
  const helper = `
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const password = process.env.HYSSOP_RECOVER_PASSWORD;
const identifier = process.env.HYSSOP_RECOVER_IDENTIFIER;
const displayName = process.env.HYSSOP_RECOVER_DISPLAY_NAME;

delete process.env.HYSSOP_RECOVER_PASSWORD;

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.HYSSOP_RECOVER_URL } } });
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: ${ARGON2.memoryKib},
    timeCost: ${ARGON2.iterations},
    parallelism: ${ARGON2.parallelism},
    outputLen: 32,
  });

  // Resolve exactly one Admin, or change nothing. A forgotten credential is not a reason to
  // guess which account to overwrite.
  const requested = await prisma.adminUser.findUnique({
    where: { identifier },
    select: { id: true, identifier: true },
  });

  let targetId;
  let previousIdentifier;

  if (requested !== null) {
    targetId = requested.id;
    previousIdentifier = requested.identifier;
  } else {
    const all = await prisma.adminUser.findMany({ select: { id: true, identifier: true } });

    if (all.length === 0) {
      throw new Error(
        'No Admin exists yet, so there is nothing to recover. Create the production ' +
          'Admin first, then re-run this command only if its credential is later lost.',
      );
    }

    if (all.length > 1) {
      throw new Error(
        'More than one Admin exists and none has the requested identifier, so the target ' +
          'cannot be identified safely. Nothing was changed. Resolve the intended account ' +
          'manually, or delete the surplus accounts first.',
      );
    }

    targetId = all[0].id;
    previousIdentifier = all[0].identifier;
  }

  // One transaction: the new credential and the revocation of every session created under
  // the previous one. Without it, a failure between the two would leave a replaced password
  // with sessions that are still valid.
  const revoked = await prisma.$transaction(async (tx) => {
    const data = { identifier, passwordHash };
    if (displayName !== undefined) {
      data.displayName = displayName;
    }
    data.updatedAt = new Date();

    await tx.adminUser.update({ where: { id: targetId }, data });

    const sessions = await tx.adminSession.updateMany({
      where: { adminUserId: targetId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REPLACED' },
    });

    return sessions.count;
  });

  await prisma.$disconnect();
  process.stdout.write(
    'Admin credential recovered for identifier ' + identifier + ' with an Argon2id hash.\\n' +
      'Previous identifier: ' + previousIdentifier + '.\\n' +
      'Live sessions revoked: ' + revoked + '.\\n' +
      'No other Admin record and no financial data was read or changed.\\n' +
      'The password and the stored hash were not printed.\\n',
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
      HYSSOP_RECOVER_PASSWORD: password,
      HYSSOP_RECOVER_IDENTIFIER: identifier,
      HYSSOP_RECOVER_DISPLAY_NAME: displayName,
      HYSSOP_RECOVER_URL: databaseUrl,
    },
  });

  if (result.error !== undefined) {
    fail(`Could not start the recovery helper: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    fail('The production Admin credential was not changed. Nothing was written.');
  }

  return result.stdout ?? '';
}

/**
 * Refuses a project development or test database, so recovery cannot become a way to change
 * a throwaway credential in a development database, and so it cannot be aimed at any
 * database by accident: the exact confirmation token is also required.
 */
function assertProductionDatabase(url) {
  const name = /\/([^/?#]+)(\?|$)/.exec(url)?.[1] ?? '';

  if (name === '') {
    fail('DIRECT_DATABASE_URL does not contain a database name. The value is never printed.');
  }

  if (PROJECT_DATABASE_NAME.test(name)) {
    fail(
      `Refusing to recover a production credential in database "${name}": ` +
        'this command accepts production databases only. ' +
        'Use `npm run admin:bootstrap` for a project _dev or _test database.',
    );
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
