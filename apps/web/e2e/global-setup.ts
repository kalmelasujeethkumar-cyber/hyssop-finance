/**
 * Provisions the real environment the browser acceptance run needs.
 *
 * The run signs in against the real API with a real session cookie, so it needs a real Argon2id
 * credential in the test database, and it records expenses against real categories. The password
 * is generated here, held only in memory, and handed to the test workers through the environment.
 * It is never written to a file, a log, a fixture, or the repository, and
 * `scripts/admin-bootstrap.mjs` never echoes it. Authority: `docs/07-SECURITY-RULES.md`
 * ("Never log passwords") and `docs/05-DATABASE-SPEC.md` (the bootstrap command is the only
 * supported way to provision the password).
 *
 * Steps run in dependency order: the schema must exist, the credential must exist, and the
 * documented starting category set must be present before any journey records an expense.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { restoreInitialExpenseCategories } from '../../api/test/database/support/baseline-configuration';
import { E2E_ADMIN_IDENTIFIER, E2E_ADMIN_PASSWORD_VARIABLE } from './support/credentials';
import { resolveTestDatabaseUrls } from './support/test-database';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..');

export default async function globalSetup(): Promise<void> {
  const { runtimeUrl, migrationUrl } = resolveTestDatabaseUrls();
  const password = generatePassword();

  applyMigrations(runtimeUrl, migrationUrl);
  provisionCredential(runtimeUrl, migrationUrl, password);
  await ensureInitialExpenseCategories(migrationUrl);

  process.env[E2E_ADMIN_PASSWORD_VARIABLE] = password;
}

/**
 * A 32-byte random value in the URL-safe alphabet. It satisfies the documented 12-128
 * character policy with room to spare, and it is unique per run so a stale tab or a cached
 * session from an earlier run can never authenticate.
 */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

function applyMigrations(runtimeUrl: string, migrationUrl: string): void {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js', {
    paths: [REPOSITORY_ROOT],
  });

  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', join(REPOSITORY_ROOT, 'prisma', 'schema.prisma')],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: migrationUrl },
      stdio: 'inherit',
    },
  );
}

function provisionCredential(runtimeUrl: string, migrationUrl: string, password: string): void {
  // The password is passed through the environment only, never as a command-line argument,
  // so it cannot appear in a process listing.
  execFileSync(process.execPath, [join(REPOSITORY_ROOT, 'scripts', 'admin-bootstrap.mjs')], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: runtimeUrl,
      DIRECT_DATABASE_URL: migrationUrl,
      HYSSOP_ADMIN_PASSWORD: password,
      HYSSOP_ADMIN_IDENTIFIER: E2E_ADMIN_IDENTIFIER,
    },
    stdio: 'inherit',
  });
}

/**
 * Makes the documented starting category set present before the journeys run.
 *
 * Applying migrations is not enough on its own: `REQ-EXP-001`'s initial categories are product
 * configuration rather than schema, so a database built purely from migrations has an empty
 * category table and the expense form's category picker renders with no options. Nothing about
 * that is recoverable from the UI, so the run would fail on a correctly working application.
 *
 * The restore is shared with the database suite rather than reimplemented here, and it is
 * idempotent, so running this against a database a previous suite already prepared changes
 * nothing. The connection is the schema-owner URL because a category insert is migration-class
 * work; the journeys themselves only ever use the least-privilege runtime role.
 */
async function ensureInitialExpenseCategories(migrationUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: migrationUrl });

  try {
    await restoreInitialExpenseCategories(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
