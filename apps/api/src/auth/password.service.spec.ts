import { ConfigService } from '@nestjs/config';
import { UNPROVISIONED_PASSWORD_HASH } from '@hyssop/contracts';
import { testAppEnvironment } from '../../test/database/support/test-database';
import { PasswordService } from './password.service';

function serviceWith(overrides: Parameters<typeof testAppEnvironment>[0] = {}): PasswordService {
  return new PasswordService(new ConfigService({ environment: testAppEnvironment(overrides) }));
}

describe('PasswordService', () => {
  const password = 'correct-horse-battery-staple';

  it('produces an Argon2id hash that verifies against the original password', async () => {
    const passwords = serviceWith();

    const hash = await passwords.hash(password);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(password);
    await expect(passwords.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects a wrong password and never throws for a malformed stored hash', async () => {
    const passwords = serviceWith();
    const hash = await passwords.hash(password);

    await expect(passwords.verify(hash, `${password}-wrong`)).resolves.toBe(false);
    await expect(passwords.verify('not-a-hash', password)).resolves.toBe(false);
    await expect(passwords.verify('', password)).resolves.toBe(false);
  });

  it('never accepts a password against the unusable-credential sentinel', async () => {
    const passwords = serviceWith();

    await expect(passwords.verify(UNPROVISIONED_PASSWORD_HASH, password)).resolves.toBe(false);
    await expect(passwords.verify(UNPROVISIONED_PASSWORD_HASH, '')).resolves.toBe(false);
  });

  it('uses the configured Argon2id cost', async () => {
    const passwords = serviceWith({
      auth: {
        ...testAppEnvironment().auth,
        argon2: { memoryKib: 19456, iterations: 2, parallelism: 1 },
      },
    });

    const hash = await passwords.hash(password);

    // The PHC string records the parameters, so the configured cost is provable.
    expect(hash).toContain('m=19456,t=2,p=1');
    expect(passwords.needsRehash(hash)).toBe(false);
  });

  it('reports a stored hash that is weaker than the configured cost', async () => {
    const weak = serviceWith({
      auth: {
        ...testAppEnvironment().auth,
        argon2: { memoryKib: 8192, iterations: 1, parallelism: 1 },
      },
    });
    const hashAtWeakCost = await weak.hash(password);

    const strong = serviceWith({
      auth: {
        ...testAppEnvironment().auth,
        argon2: { memoryKib: 19456, iterations: 2, parallelism: 1 },
      },
    });

    expect(strong.needsRehash(hashAtWeakCost)).toBe(true);
  });

  it('never reports the sentinel or a malformed hash as needing a rehash', () => {
    const passwords = serviceWith();

    expect(passwords.needsRehash(UNPROVISIONED_PASSWORD_HASH)).toBe(false);
    expect(passwords.needsRehash('not-a-hash')).toBe(false);
  });

  it('performs real verification work for an unknown identifier and still returns false', async () => {
    const passwords = serviceWith();

    const first = Date.now();
    await expect(passwords.verifyAgainstDummyHash(password)).resolves.toBe(false);
    const elapsed = Date.now() - first;

    // A dummy verification that skipped the KDF would return instantly; the assertion
    // only has to rule out a no-op, so it uses a deliberately low bar.
    expect(elapsed).toBeGreaterThan(0);
  });

  it('salts every hash, so the same password never produces the same stored value', async () => {
    const passwords = serviceWith();

    const first = await passwords.hash(password);
    const second = await passwords.hash(password);

    expect(first).not.toBe(second);
    await expect(passwords.verify(first, password)).resolves.toBe(true);
    await expect(passwords.verify(second, password)).resolves.toBe(true);
  });
});
