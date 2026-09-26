import {
  businessDateFromInstant,
  businessMonthRange,
  BusinessDateError,
  endOfBusinessDay,
  formatBusinessDate,
  parseBusinessDate,
  startOfBusinessDay,
} from './business-date';

describe('Asia/Kolkata business dates (REQ-FIN-004)', () => {
  it('parses a business date as a calendar date, not an instant', () => {
    expect(formatBusinessDate(parseBusinessDate('2026-09-26'))).toBe('2026-09-26');
  });

  it('rejects a malformed or impossible date', () => {
    expect(() => parseBusinessDate('26-09-2026')).toThrow(BusinessDateError);
    expect(() => parseBusinessDate('2026-02-30')).toThrow(BusinessDateError);
    expect(() => parseBusinessDate('2026-13-01')).toThrow(BusinessDateError);
  });

  it('derives the Asia/Kolkata calendar date of an instant', () => {
    // 18:30 UTC is already the next day in Asia/Kolkata (UTC+05:30).
    expect(formatBusinessDate(businessDateFromInstant(new Date('2026-09-26T18:30:00.000Z')))).toBe(
      '2026-09-27',
    );
    // 17:00 UTC is still the same day in Asia/Kolkata.
    expect(formatBusinessDate(businessDateFromInstant(new Date('2026-09-26T17:00:00.000Z')))).toBe(
      '2026-09-26',
    );
  });

  it('starts the business day at 00:00 Asia/Kolkata', () => {
    const start = startOfBusinessDay(parseBusinessDate('2026-09-26'));
    expect(start.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    expect(endOfBusinessDay(parseBusinessDate('2026-09-26')).toISOString()).toBe(
      '2026-09-26T18:29:59.999Z',
    );
  });

  it('covers a full calendar month', () => {
    const range = businessMonthRange(2026, 2);
    expect(formatBusinessDate(range.from)).toBe('2026-02-01');
    expect(formatBusinessDate(range.to)).toBe('2026-02-28');

    const leap = businessMonthRange(2028, 2);
    expect(formatBusinessDate(leap.to)).toBe('2028-02-29');
  });
});
