import { normalizePhone, phoneFormatMessage, PhoneFormatError } from '@hyssop/contracts';

/**
 * The shared phone rule.
 *
 * The implementation now lives in `@hyssop/contracts` because `REQ-MEM-005` requires the
 * *same* rule in the UI, the API, and the database, and both applications depend on that
 * package. It is tested here, in the API workspace, because the contract package has no
 * test runner of its own; the API consumes the exported functions, so this exercises the
 * exact code the API applies to a submitted member phone.
 */
describe('phone normalization (REQ-MEM-005)', () => {
  it('stores national digits only', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone('  98765 43210 ')).toBe('9876543210');
  });

  it('removes spaces, hyphens, and parentheses', () => {
    expect(normalizePhone('98765 43210')).toBe('9876543210');
    expect(normalizePhone('98765-43210')).toBe('9876543210');
    expect(normalizePhone('(98765) 43210')).toBe('9876543210');
  });

  it('strips an optional +91 country code', () => {
    expect(normalizePhone('+919876543210')).toBe('9876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });

  it('treats an absent value as no phone instead of an error', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('rejects fewer than 7 or more than 15 national digits', () => {
    expect(() => normalizePhone('123456')).toThrow(PhoneFormatError);
    expect(() => normalizePhone('1234567890123456')).toThrow(PhoneFormatError);
    expect(normalizePhone('1234567')).toBe('1234567');
    expect(normalizePhone('123456789012345')).toBe('123456789012345');
  });

  it('rejects characters that are not part of a phone number', () => {
    expect(() => normalizePhone('98765abc10')).toThrow(PhoneFormatError);
    expect(() => normalizePhone('98765.43210')).toThrow(PhoneFormatError);
  });

  it('rejects a bare country code with no national number', () => {
    expect(() => normalizePhone('+91')).toThrow(PhoneFormatError);
    expect(() => normalizePhone('91')).toThrow(PhoneFormatError);
  });

  describe('phoneFormatMessage, the form-facing form of the same rule', () => {
    it('returns no message for an acceptable or absent value', () => {
      expect(phoneFormatMessage('98765 43210')).toBeUndefined();
      expect(phoneFormatMessage('')).toBeUndefined();
      expect(phoneFormatMessage(null)).toBeUndefined();
      expect(phoneFormatMessage(undefined)).toBeUndefined();
    });

    it('explains the violation instead of throwing, so a form can show it inline', () => {
      expect(phoneFormatMessage('123456')).toContain('7 to 15');
      expect(phoneFormatMessage('98765.43210')).toContain('only digits');
    });

    it('agrees with the throwing form on which values are acceptable', () => {
      // The browser validates with `phoneFormatMessage` and the API persists with
      // `normalizePhone`, so a divergence here would mean the UI accepts a phone the API
      // rejects. This asserts the two really are the same rule.
      const samples = [
        '9876543210',
        '  98765 43210 ',
        '+91 98765 43210',
        '123456',
        '98765.43210',
        '',
        '   ',
        '98765abc10',
        '+91',
      ];

      for (const sample of samples) {
        let threw = false;

        try {
          normalizePhone(sample);
        } catch (error: unknown) {
          threw = error instanceof PhoneFormatError;
        }

        expect(phoneFormatMessage(sample) === undefined).toBe(!threw);
      }
    });
  });
});
