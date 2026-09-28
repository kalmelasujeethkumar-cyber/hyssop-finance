/**
 * The Admin bootstrap command, exercised as a real child process.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` ("The Admin bootstrap replaces the sentinel with a
 * real Argon2id hash and is the only supported way to provision the password") and
 * `docs/07-SECURITY-RULES.md` ("Never log passwords"). This is a developer command, not an
 * API route, so the only honest way to prove it is to run it.
 *
 * Everything happens inside the disposable `_test` database with a password generated at
 * run time. The password is never written to the repository, never printed by the test, and
 * never compared in a failure message.
 *
 * The command reads the shared contract package, so `@hyssop/contracts` must be built. The
 * documented gate order builds it as part of `npm run typecheck` before any test runs; if it
 * is missing, the command's own error message says so.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../src/auth/password.service';
import { requireTestDatabaseUrls } from './support/database-connection';
import { createHarness, testAppEnvironment, type TestHarness } from './support/test-database';

const HOUR_IN_MS = 60 * 60 * 1000;
const IDENTIFIER = 'admin';

const repositoryRoot = resolve(process.cwd(), '..', '..');
const scriptPath = resolve(repositoryRoot, 'scripts', 'admin-bootstrap.mjs');

interface BootstrapResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runBootstrap(environment: Record<string, string | undefined>): BootstrapResult {
  const childEnvironment: Record<string, string> = {};

  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      childEnvironment[key] = value;
    }
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: childEnvironment,
  });

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function throwawayPassword(): string {
  return `Hyssop-${randomBytes(18).toString('hex')}`;
}

describe('the Admin bootstrap command', () => {
  let harness: TestHarness;
  let migrationUrl: string;
  let passwords: PasswordService;

  beforeAll(() => {
    if (!existsSync(scriptPath)) {
      throw new Error(`expected the bootstrap script at ${scriptPath}`);
    }

    ({ migrationUrl } = requireTestDatabaseUrls());
    passwords = new PasswordService(new ConfigService({ environment: testAppEnvironment() }));
  });

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('refuses to run without a password, and names the variable it needs', () => {
    const result = runBootstrap({ DIRECT_DATABASE_URL: migrationUrl });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HYSSOP_ADMIN_PASSWORD');
    expect(result.stdout).toBe('');
  });

  it('refuses a password shorter than the documented minimum', () => {
    const result = runBootstrap({
      DIRECT_DATABASE_URL: migrationUrl,
      HYSSOP_ADMIN_PASSWORD: 'short',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/at least 12 characters/);
  });

  it('refuses to write a credential into a database that is not a project database', () => {
    const result = runBootstrap({
      DIRECT_DATABASE_URL:
        'postgresql://hyssop_migrator@127.0.0.1:55432/hyssop_production?schema=public',
      HYSSOP_ADMIN_PASSWORD: throwawayPassword(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hyssop_production');
    expect(result.stdout).toBe('');
  });

  it('writes a hash the API itself accepts, and never prints the password', async () => {
    const password = throwawayPassword();

    const result = runBootstrap({
      DIRECT_DATABASE_URL: migrationUrl,
      HYSSOP_ADMIN_IDENTIFIER: IDENTIFIER,
      HYSSOP_ADMIN_DISPLAY_NAME: 'Demo Admin',
      HYSSOP_ADMIN_PASSWORD: password,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Admin identifier admin provisioned with an Argon2id hash.');
    expect(result.stdout).not.toContain(password);

    const stored = await harness.migration.adminUser.findUniqueOrThrow({
      where: { identifier: IDENTIFIER },
    });

    // The documented sentinel is gone, and what replaced it is a real Argon2id hash that
    // the API's own verifier accepts: the bootstrap and the login path cannot disagree.
    expect(stored.passwordHash).not.toBe('!unprovisioned');
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(passwords.verify(stored.passwordHash, password)).resolves.toBe(true);
    await expect(passwords.verify(stored.passwordHash, `${password}-wrong`)).resolves.toBe(false);

    // Nothing anywhere may hold the plaintext.
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain(password);
    expect(JSON.stringify(await harness.migration.adminSession.findMany())).not.toContain(password);
    expect(JSON.stringify(await harness.migration.auditEvent.findMany())).not.toContain(password);
  });

  it('replaces a previous credential and revokes the sessions it created', async () => {
    const first = throwawayPassword();

    runBootstrap({
      DIRECT_DATABASE_URL: migrationUrl,
      HYSSOP_ADMIN_IDENTIFIER: IDENTIFIER,
      HYSSOP_ADMIN_PASSWORD: first,
    });

    const admin = await harness.migration.adminUser.findUniqueOrThrow({
      where: { identifier: IDENTIFIER },
    });
    const issued = await harness.sessions.issue({
      adminUserId: admin.id,
      tokenHash: 'c'.repeat(64),
      csrfTokenHash: 'd'.repeat(64),
      ipHash: null,
      expiresAt: new Date(Date.now() + HOUR_IN_MS),
      audit: { requestId: null, ipHash: null },
    });

    const second = throwawayPassword();
    const result = runBootstrap({
      DIRECT_DATABASE_URL: migrationUrl,
      HYSSOP_ADMIN_IDENTIFIER: IDENTIFIER,
      HYSSOP_ADMIN_PASSWORD: second,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Live sessions revoked: 1.');

    const session = await harness.migration.adminSession.findUniqueOrThrow({
      where: { id: issued.id },
    });

    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('REPLACED');

    // The previous token must no longer resolve to a usable session, which is asserted
    // directly instead of through `expect.any`, so the check also pins the revocation reason.
    const replaced = await harness.sessions.findByTokenHash('c'.repeat(64));

    expect(replaced).not.toBeNull();
    expect(replaced?.revokedAt).toBeInstanceOf(Date);
    expect(replaced?.revokedReason).toBe('REPLACED');

    const stored = await harness.migration.adminUser.findUniqueOrThrow({
      where: { identifier: IDENTIFIER },
    });

    await expect(passwords.verify(stored.passwordHash, first)).resolves.toBe(false);
    await expect(passwords.verify(stored.passwordHash, second)).resolves.toBe(true);
  });
});
