import {
  formatReference,
  isReferenceScope,
  MAX_REFERENCE_VALUE,
  REFERENCE_FORMATS,
  referenceScopeForTransactionType,
} from './reference-formats';

describe('human-readable references (REQ-MEM-002, REQ-FIN-011, REQ-DOC-008)', () => {
  it('uses the documented prefix and width for every scope', () => {
    expect(formatReference('MEMBER', 1n)).toBe('HY-MEM-0001');
    expect(formatReference('MEMBER', 9_999n)).toBe('HY-MEM-9999');
    expect(formatReference('INCOME', 1n)).toBe('HY-INC-000001');
    expect(formatReference('EXPENSE', 1_234n)).toBe('HY-EXP-001234');
    expect(formatReference('DOCUMENT', 1n)).toBe('HY-DOC-000001');
  });

  it('keeps every formatted reference inside the 32 character column', () => {
    for (const [scope, format] of Object.entries(REFERENCE_FORMATS)) {
      const value = 10n ** BigInt(format.width - 1);
      expect(formatReference(scope as 'MEMBER', value).length).toBeLessThanOrEqual(32);
    }
  });

  it('refuses a sequence value that would widen the documented format', () => {
    expect(() => formatReference('MEMBER', 10_000n)).toThrow(RangeError);
    expect(() => formatReference('INCOME', 1_000_000n)).toThrow(RangeError);
    expect(() => formatReference('MEMBER', 0n)).toThrow(RangeError);
    expect(() => formatReference('MEMBER', -1n)).toThrow(RangeError);
    expect(() => formatReference('MEMBER', MAX_REFERENCE_VALUE + 1n)).toThrow(RangeError);
  });

  it('accepts only the four scopes the database constraint allows', () => {
    expect(isReferenceScope('MEMBER')).toBe(true);
    expect(isReferenceScope('INCOME')).toBe(true);
    expect(isReferenceScope('EXPENSE')).toBe(true);
    expect(isReferenceScope('DOCUMENT')).toBe(true);
    expect(isReferenceScope('SESSION')).toBe(false);
  });

  it('maps a transaction type to its own reference scope', () => {
    expect(referenceScopeForTransactionType('INCOME')).toBe('INCOME');
    expect(referenceScopeForTransactionType('EXPENSE')).toBe('EXPENSE');
  });
});
