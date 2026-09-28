import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH } from '@hyssop/contracts';
import { checkPasswordPolicy, isValidIdentifier, normalizeIdentifier } from './credential-policy';

describe('credential policy', () => {
  it('normalizes an identifier to the form the database constraint requires', () => {
    expect(normalizeIdentifier('  Admin  ')).toBe('admin');
    expect(normalizeIdentifier('ADMIN')).toBe('admin');
    expect(normalizeIdentifier('admin')).toBe('admin');
  });

  it('accepts a password that meets the documented length rule', () => {
    expect(checkPasswordPolicy('a'.repeat(ADMIN_PASSWORD_MIN_LENGTH))).toEqual([]);
    expect(checkPasswordPolicy('a'.repeat(ADMIN_PASSWORD_MAX_LENGTH))).toEqual([]);
  });

  it('rejects a password that is too short or too long, naming only the rule', () => {
    const short = checkPasswordPolicy('a'.repeat(ADMIN_PASSWORD_MIN_LENGTH - 1));
    const long = checkPasswordPolicy('a'.repeat(ADMIN_PASSWORD_MAX_LENGTH + 1));

    expect(short).toHaveLength(1);
    expect(short[0]?.field).toBe('password');
    expect(short[0]?.message).toContain(String(ADMIN_PASSWORD_MIN_LENGTH));
    expect(long).toHaveLength(1);
    expect(long[0]?.message).toContain(String(ADMIN_PASSWORD_MAX_LENGTH));
  });

  it('judges a password only by length, so a long passphrase is accepted', () => {
    const passphrase = 'a sentence with spaces and 123 numbers';

    expect(checkPasswordPolicy(passphrase)).toEqual([]);
  });

  it('accepts identifiers only inside the documented bounds', () => {
    expect(isValidIdentifier('admin')).toBe(true);
    expect(isValidIdentifier('ab')).toBe(false);
    expect(isValidIdentifier('a'.repeat(64))).toBe(true);
    expect(isValidIdentifier('a'.repeat(65))).toBe(false);
  });
});
