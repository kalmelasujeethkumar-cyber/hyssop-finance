import {
  formatPaise,
  MAX_PAISES,
  MoneyFormatError,
  parsePaise,
  parsePositivePaise,
  remainingPaise,
  sumPaise,
} from './paise';

describe('exact INR money (REQ-FIN-003, REQ-FIN-021)', () => {
  describe('parsePaise', () => {
    it('converts whole rupees and one or two fraction digits to exact paise', () => {
      expect(parsePaise('1000')).toBe(100_000n);
      expect(parsePaise('1000.5')).toBe(100_050n);
      expect(parsePaise('1000.50')).toBe(100_050n);
      expect(parsePaise('0.01')).toBe(1n);
      expect(parsePaise('0.1')).toBe(10n);
    });

    it('trims surrounding whitespace without accepting internal spacing', () => {
      expect(parsePaise('  125000.00  ')).toBe(12_500_000n);
      expect(() => parsePaise('125 000.00')).toThrow(MoneyFormatError);
    });

    it('keeps full precision for large amounts that a float could not represent', () => {
      expect(parsePaise('92233720368547758.07')).toBe(MAX_PAISES);
      expect(formatPaise(parsePaise('92233720368547758.07'))).toBe('92233720368547758.07');
    });

    it.each([
      ['negative', '-100.00'],
      ['signed', '+100.00'],
      ['exponent', '1e3'],
      ['grouped', '1,000.00'],
      ['three fraction digits', '100.005'],
      ['empty', '   '],
      ['leading dot', '.50'],
      ['letters', '100.00abc'],
      ['currency symbol', '₹100.00'],
    ])('rejects %s input instead of coercing it', (_label, value) => {
      expect(() => parsePaise(value)).toThrow(MoneyFormatError);
    });

    it('rejects an amount above the storage maximum', () => {
      expect(() => parsePaise('92233720368547758.08')).toThrow(MoneyFormatError);
    });
  });

  describe('parsePositivePaise', () => {
    it('rejects zero because a stored amount must be greater than zero', () => {
      expect(() => parsePositivePaise('0')).toThrow(MoneyFormatError);
      expect(() => parsePositivePaise('0.00')).toThrow(MoneyFormatError);
      expect(parsePositivePaise('0.01')).toBe(1n);
    });
  });

  describe('formatPaise', () => {
    it('always renders two fraction digits, as the API contract requires', () => {
      expect(formatPaise(0n)).toBe('0.00');
      expect(formatPaise(1n)).toBe('0.01');
      expect(formatPaise(100_000n)).toBe('1000.00');
      expect(formatPaise(12_500_000n)).toBe('125000.00');
    });

    it('renders a negative balance honestly instead of clamping it', () => {
      expect(formatPaise(-250_050n)).toBe('-2500.50');
    });
  });

  describe('sumPaise and remainingPaise', () => {
    it('adds without floating-point drift', () => {
      const values = [10n, 20n, 100n, 1_234_567_891n];
      expect(sumPaise(values)).toBe(values.reduce((total, value) => total + value, 0n));
      expect(formatPaise(sumPaise([1n, 2n, 3n]))).toBe('0.06');
      expect(sumPaise([])).toBe(0n);
    });

    it('clamps a remaining contribution at zero when it is overpaid', () => {
      expect(remainingPaise(50_000n, 20_000n)).toBe(30_000n);
      expect(remainingPaise(50_000n, 50_000n)).toBe(0n);
      expect(remainingPaise(50_000n, 60_000n)).toBe(0n);
    });
  });
});
