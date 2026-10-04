/**
 * The production Admin recovery command, exercised as a real child process.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (the Admin credential is the only supported way to
 * provision a password) and `docs/07-SECURITY-RULES.md` ("Never log passwords"). This is an
 * operator command, not an API route, so the only honest way to prove it is to run it.
 *
 * Every case here is a refusal, and every refusal happens before any connection is opened,
 * so this suite needs no database and can never write to one. The `.invalid` host is
 * reserved by RFC 2606 and can never resolve, so even a hypothetical ordering mistake could
 * not reach a real server.
 *
 * The password is generated at run time. No real or intended production password is written
 * to the repository, printed by the test, or compared in a failure message.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const CONFIRM_TOKEN = 'recover-production-admin';
const IDENTIFIER = 'hyssop@2026';

/** RFC 2606 reserved: guaranteed never to resolve. */
const PRODUCTION_URL = 'postgresql://schema_owner:secret@db.example.invalid:5432/postgres';
const DEVELOPMENT_URL =
  'postgresql://schema_owner:secret@db.example.invalid:5432/hyssop_finance_dev';
const TEST_URL = 'postgresql://schema_owner:secret@db.example.invalid:5432/hyssop_finance_test';

const repositoryRoot = resolve(process.cwd(), '..', '..');
const scriptPath = resolve(repositoryRoot, 'scripts', 'admin-recover-production.mjs');

interface RecoveryResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runRecovery(environment: Record<string, string | undefined>): RecoveryResult {
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

/** A complete, valid environment; each test removes or replaces exactly one variable. */
function validEnvironment(): Record<string, string | undefined> {
  return {
    HYSSOP_ADMIN_RECOVER_CONFIRM: CONFIRM_TOKEN,
    HYSSOP_ADMIN_PASSWORD: throwawayPassword(),
    HYSSOP_ADMIN_IDENTIFIER: IDENTIFIER,
    DIRECT_DATABASE_URL: PRODUCTION_URL,
  };
}

function combined(result: RecoveryResult): string {
  return `${result.stdout}${result.stderr}`;
}

describe('production Admin recovery command', () => {
  it('refuses to run without the exact recovery confirmation token', () => {
    const environment = validEnvironment();
    delete environment['HYSSOP_ADMIN_RECOVER_CONFIRM'];

    const result = runRecovery(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Production recovery is not confirmed.');
    expect(result.stderr).toContain('nothing was written');
  });

  it('refuses to run when the confirmation token is wrong', () => {
    const result = runRecovery({ ...validEnvironment(), HYSSOP_ADMIN_RECOVER_CONFIRM: 'recover' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Production recovery is not confirmed.');
  });

  it('refuses to run without a schema-owner connection', () => {
    const environment = validEnvironment();
    delete environment['DIRECT_DATABASE_URL'];

    const result = runRecovery(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DIRECT_DATABASE_URL is not set.');
  });

  it.each([
    ['development', DEVELOPMENT_URL],
    ['test', TEST_URL],
  ])('refuses a project %s database, leaving that job to the bootstrap command', (_label, url) => {
    const result = runRecovery({ ...validEnvironment(), DIRECT_DATABASE_URL: url });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('this command accepts production databases only');
    expect(result.stderr).toContain('admin:bootstrap');
  });

  it('refuses to run without a password', () => {
    const environment = validEnvironment();
    delete environment['HYSSOP_ADMIN_PASSWORD'];

    const result = runRecovery(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HYSSOP_ADMIN_PASSWORD is not set.');
  });

  it('refuses a password shorter than the shared policy minimum', () => {
    const result = runRecovery({ ...validEnvironment(), HYSSOP_ADMIN_PASSWORD: 'Sh0rt-Pass' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at least 12 characters');
  });

  it('refuses to guess the account identifier', () => {
    const environment = validEnvironment();
    delete environment['HYSSOP_ADMIN_IDENTIFIER'];

    const result = runRecovery(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HYSSOP_ADMIN_IDENTIFIER is not set.');
    expect(result.stderr).toContain('never guesses the account');
  });

  it('refuses an upper-case identifier and points at the sign-in convention', () => {
    const result = runRecovery({
      ...validEnvironment(),
      HYSSOP_ADMIN_IDENTIFIER: 'HYSSOP@2026',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The identifier must be lower-case');
    expect(result.stderr).toContain('still accepts the upper-case form');
  });

  it('never echoes the password on any refusal', () => {
    const password = throwawayPassword();

    const refusals: ReadonlyArray<Record<string, string | undefined>> = [
      { ...validEnvironment(), HYSSOP_ADMIN_PASSWORD: password, HYSSOP_ADMIN_IDENTIFIER: 'ADMIN' },
      { ...validEnvironment(), HYSSOP_ADMIN_PASSWORD: password, DIRECT_DATABASE_URL: TEST_URL },
      { ...validEnvironment(), HYSSOP_ADMIN_PASSWORD: password.slice(0, 4) },
    ];

    for (const environment of refusals) {
      const result = runRecovery(environment);

      expect(result.status).toBe(1);
      expect(combined(result)).not.toContain(password);
      expect(result.stdout).toBe('');
    }
  });

  it('never prints the connection string or its credentials on any refusal', () => {
    const result = runRecovery({ ...validEnvironment(), DIRECT_DATABASE_URL: DEVELOPMENT_URL });

    expect(result.status).toBe(1);
    expect(combined(result)).not.toContain('schema_owner');
    expect(combined(result)).not.toContain('secret');
  });

  it('never prints an Argon2id hash on any refusal', () => {
    const result = runRecovery({ ...validEnvironment(), HYSSOP_ADMIN_PASSWORD: 'short' });

    expect(result.status).toBe(1);
    expect(combined(result)).not.toContain('$argon2id$');
  });
});
