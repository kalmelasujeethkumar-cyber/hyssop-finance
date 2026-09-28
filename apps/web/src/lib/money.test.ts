import { describe, expect, it } from 'vitest';
import {
  compareDecimalAmounts,
  formatBusinessDate,
  formatInr,
  formatInrBare,
  formatIstTimestamp,
  formatMonthYear,
  groupIndianDigits,
  parseDecimalAmount,
} from './money';

/**
 * The exact-INR presentation rules.
 *
 * Authority: `docs/03-UI-UX-RULES.md` — Indian digit grouping with the rupee symbol
 * (`₹12,50,000`), familiar Indian dates always in `Asia/Kolkata`, 12-hour times, and no
 * raw ISO timestamp or unformatted number shown as a financial value.
 */
describe('Indian digit grouping', () => {
  it('leaves values below one thousand unseparated', () => {
    expect(groupIndianDigits('0')).toBe('0');
    expect(groupIndianDigits('7')).toBe('7');
    expect(groupIndianDigits('500')).toBe('500');
  });

  it('splits the last three digits, then groups earlier digits in pairs', () => {
    expect(groupIndianDigits('1000')).toBe('1,000');
    expect(groupIndianDigits('10000')).toBe('10,000');
    expect(groupIndianDigits('100000')).toBe('1,00,000');
  });

  it('matches the worked example in the UI rules', () => {
    expect(groupIndianDigits('1250000')).toBe('12,50,000');
  });

  it('handles a real church-scale total', () => {
    expect(groupIndianDigits('12345678')).toBe('1,23,45,678');
  });
});

describe('parseDecimalAmount', () => {
  it('reads a plain decimal into exact parts', () => {
    expect(parseDecimalAmount('500')).toEqual({ rupees: '500', fraction: '00' });
    expect(parseDecimalAmount('500.5')).toEqual({ rupees: '500', fraction: '50' });
    expect(parseDecimalAmount('500.05')).toEqual({ rupees: '500', fraction: '05' });
    expect(parseDecimalAmount('0.00')).toEqual({ rupees: '0', fraction: '00' });
  });

  it('rejects anything that is not an exact amount rather than rounding it', () => {
    // A value that reaches the screen through this function is an amount the API sent or
    // the Admin typed. Guessing at either would risk showing a wrong figure.
    for (const malformed of ['', 'abc', '5.005', '-500', '1,000', '500.', '.50', '5 00', 'NaN']) {
      expect(parseDecimalAmount(malformed)).toBeNull();
    }
  });
});

describe('formatInr', () => {
  it('shows the rupee symbol and Indian grouping with two decimal places', () => {
    expect(formatInr('500.00')).toBe('₹500.00');
    expect(formatInr('1250000.00')).toBe('₹12,50,000.00');
    expect(formatInr('0.00')).toBe('₹0.00');
  });

  it('keeps both paise digits, including a leading zero', () => {
    expect(formatInr('0.05')).toBe('₹0.05');
    expect(formatInr('150.50')).toBe('₹150.50');
  });

  it('shows an em dash rather than a wrong amount for an unparseable value', () => {
    // `₹NaN` or a silently rounded figure would both be worse than an obvious gap.
    expect(formatInr('not-a-number')).toBe('—');
    expect(formatInr('')).toBe('—');
  });

  it('never exposes a floating-point artefact on a large amount', () => {
    // 0.1 + 0.2 style drift would show up here if the string were routed through a number:
    // this value is not exactly representable as a double, so a float route would render a
    // rounded or exponent-formatted figure. Fourteen integer digits group as one leading
    // digit then six pairs, then the final three.
    expect(formatInr('99999999999999.99')).toBe('₹9,99,99,99,99,99,999.99');
  });

  it('omits the symbol on request, for a column with its own header', () => {
    expect(formatInrBare('1250000.00')).toBe('12,50,000.00');
    expect(formatInrBare('bad')).toBe('—');
  });
});

describe('compareDecimalAmounts', () => {
  it('orders amounts exactly, without floating-point conversion', () => {
    expect(compareDecimalAmounts('500.00', '500.01')).toBe(-1);
    expect(compareDecimalAmounts('500.01', '500.00')).toBe(1);
    expect(compareDecimalAmounts('500.00', '500.00')).toBe(0);
  });

  it('orders by magnitude, not by string length, across digit counts', () => {
    expect(compareDecimalAmounts('9.99', '10.00')).toBe(-1);
    expect(compareDecimalAmounts('99.00', '100.00')).toBe(-1);
    expect(compareDecimalAmounts('1000000.00', '999999.99')).toBe(1);
  });

  it('treats a missing fraction as zero', () => {
    expect(compareDecimalAmounts('500', '500.00')).toBe(0);
  });

  it('refuses to compare a malformed value', () => {
    expect(() => compareDecimalAmounts('500.00', 'oops')).toThrow(RangeError);
  });
});

describe('business dates in Asia/Kolkata', () => {
  it('formats a business date as day, month name, and year', () => {
    expect(formatBusinessDate('2026-09-25')).toBe('25 Sep 2026');
    expect(formatBusinessDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatBusinessDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('does not shift the day, which a UTC parse of a midnight date would do', () => {
    // `new Date('2026-09-25')` is 2026-09-25T00:00Z, which is 05:30 on the 25th in IST and
    // would render as the 25th — but a negative offset would render as the 24th. Parsing as
    // plain text is what makes the day independent of any time zone.
    expect(formatBusinessDate('2026-09-01')).toBe('1 Sep 2026');
  });

  it('returns an unrecognised value unchanged instead of inventing a date', () => {
    expect(formatBusinessDate('2026-13-01')).toBe('2026-13-01');
    expect(formatBusinessDate('not-a-date')).toBe('not-a-date');
  });
});

describe('month labels', () => {
  it('labels a contribution month for a 1-based month number', () => {
    expect(formatMonthYear(2026, 3)).toBe('Mar 2026');
    expect(formatMonthYear(2026, 12)).toBe('Dec 2026');
  });

  it('falls back for an out-of-range month rather than showing undefined', () => {
    expect(formatMonthYear(2026, 13)).toBe('13 2026');
  });
});

describe('timestamps in Asia/Kolkata', () => {
  it('shows a 12-hour IST time and an Indian date', () => {
    // 09:15 UTC is 14:45 IST the same day.
    expect(formatIstTimestamp('2026-09-26T09:15:00.000Z')).toBe('2:45 PM on 26 Sep 2026');
  });

  it('uses AM before midday and folds midnight to 12', () => {
    // 18:30 UTC is 00:00 IST the next day.
    expect(formatIstTimestamp('2026-09-26T18:30:00.000Z')).toBe('12:00 AM on 27 Sep 2026');
    // 03:00 UTC is 08:30 IST the same day.
    expect(formatIstTimestamp('2026-09-26T03:00:00.000Z')).toBe('8:30 AM on 26 Sep 2026');
  });

  it('returns an unparseable value unchanged rather than an invalid date', () => {
    expect(formatIstTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
  });
});
