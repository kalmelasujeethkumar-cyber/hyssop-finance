import { normalizePhone, PhoneFormatError } from './normalize-phone';

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
});
