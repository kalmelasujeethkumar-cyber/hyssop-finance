import { DASHBOARD_PERIOD_PRESETS } from '@hyssop/contracts';
import { DomainError } from '../src/common/errors/domain.errors';
import { parseBusinessDate } from '../src/common/time/business-date';
import {
  assertSpanWithinLimit,
  calendarMonthsOf,
  currentBusinessDate,
  monthKeyRangeOf,
  monthSpanOf,
  periodLabel,
  resolveCustomPeriod,
  resolvePeriod,
  resolvePresetPeriod,
  type CalendarMonth,
  type ResolvedPeriod,
} from '../src/dashboard/period.resolver';

/**
 * Period boundary tests.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-DASH-015` to `REQ-DASH-017`, which fix the exact
 * inclusive definition of every preset, and `docs/10-TEST-PLAN.md`, whose financial scenarios
 * require deterministic period fixtures.
 *
 * The resolver takes `today` as an argument precisely so these assertions can be written against
 * fixed dates. Each preset is tested at its boundary cases rather than on the current day: the
 * first of the month, a leap day, the last day of a 31-day month, and the first day of a year,
 * because those are exactly the inputs where "this month" and "last month" differ by an off-by-one.
 */

function today(value: string): Date {
  return parseBusinessDate(value);
}

function bounds(period: ResolvedPeriod): { from: string; to: string } {
  return {
    from: period.from.toISOString().slice(0, 10),
    to: period.to.toISOString().slice(0, 10),
  };
}

describe('period.resolver', () => {
  describe('resolvePresetPeriod', () => {
    it('treats today as the single current business date', () => {
      expect(bounds(resolvePresetPeriod('today', today('2026-09-15')))).toEqual({
        from: '2026-09-15',
        to: '2026-09-15',
      });
    });

    it('spans the whole calendar month for thisMonth, including a 31-day month', () => {
      expect(bounds(resolvePresetPeriod('thisMonth', today('2026-09-01')))).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });

    it('ends thisMonth on the 31st of a 31-day month regardless of the reference day', () => {
      expect(bounds(resolvePresetPeriod('thisMonth', today('2026-01-31')))).toEqual({
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('spans February in a leap year without a special case', () => {
      expect(bounds(resolvePresetPeriod('thisMonth', today('2024-02-10')))).toEqual({
        from: '2024-02-01',
        to: '2024-02-29',
      });
    });

    it('spans February in a non-leap year', () => {
      expect(bounds(resolvePresetPeriod('thisMonth', today('2026-02-10')))).toEqual({
        from: '2026-02-01',
        to: '2026-02-28',
      });
    });

    it('resolves lastMonth across a year boundary', () => {
      expect(bounds(resolvePresetPeriod('lastMonth', today('2026-01-05')))).toEqual({
        from: '2025-12-01',
        to: '2025-12-31',
      });
    });

    it('resolves lastMonth from the middle of a month', () => {
      expect(bounds(resolvePresetPeriod('lastMonth', today('2026-09-15')))).toEqual({
        from: '2026-08-01',
        to: '2026-08-31',
      });
    });

    it('includes the current calendar month in last3Months, per REQ-DASH-017', () => {
      // The requirement defines Last 3 Months as the current month plus the two before it, so
      // this is three calendar months, not the last ninety days and not the three completed
      // months before this one.
      expect(bounds(resolvePresetPeriod('last3Months', today('2026-03-15')))).toEqual({
        from: '2026-01-01',
        to: '2026-03-31',
      });
    });

    it('includes the current calendar month in last6Months, per REQ-DASH-017', () => {
      expect(bounds(resolvePresetPeriod('last6Months', today('2026-09-15')))).toEqual({
        from: '2026-04-01',
        to: '2026-09-30',
      });
    });

    it('rolls last6Months back across a year boundary', () => {
      expect(bounds(resolvePresetPeriod('last6Months', today('2026-02-10')))).toEqual({
        from: '2025-09-01',
        to: '2026-02-28',
      });
    });

    it('spans the whole calendar year for thisYear', () => {
      expect(bounds(resolvePresetPeriod('thisYear', today('2026-01-01')))).toEqual({
        from: '2026-01-01',
        to: '2026-12-31',
      });
    });

    it('treats lastYear as the previous calendar year, not the last 365 days', () => {
      // 2024 is a leap year, so a "last 365 days" reading would end on 31 December 2024 only by
      // coincidence. This asserts the calendar-year definition explicitly.
      expect(bounds(resolvePresetPeriod('lastYear', today('2026-06-15')))).toEqual({
        from: '2025-01-01',
        to: '2025-12-31',
      });
    });

    it('treats lastYear on 1 January as the year before, not the year after', () => {
      expect(bounds(resolvePresetPeriod('lastYear', today('2026-01-01')))).toEqual({
        from: '2025-01-01',
        to: '2025-12-31',
      });
    });
  });

  describe('resolveCustomPeriod', () => {
    it('accepts an inclusive range and reports it as custom', () => {
      const period = resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' });

      expect(period.kind).toBe('custom');
      expect(bounds(period)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('accepts a single-day range', () => {
      expect(bounds(resolveCustomPeriod({ from: '2026-09-15', to: '2026-09-15' }))).toEqual({
        from: '2026-09-15',
        to: '2026-09-15',
      });
    });

    it('rejects a range whose start is after its end, naming the start field', () => {
      expect(() => resolveCustomPeriod({ from: '2026-09-30', to: '2026-09-01' })).toThrow(
        /start date must not be after the end date/i,
      );
    });

    it('rejects a calendar date that does not exist', () => {
      expect(() => resolveCustomPeriod({ from: '2026-02-30', to: '2026-03-01' })).toThrow(
        /start date as YYYY-MM-DD/i,
      );
    });

    it('rejects a month that does not exist', () => {
      expect(() => resolveCustomPeriod({ from: '2026-09-01', to: '2026-13-01' })).toThrow(
        /end date as YYYY-MM-DD/i,
      );
    });

    it('reports a missing start date against the start field', () => {
      expect(() => resolveCustomPeriod({ from: '  ', to: '2026-09-01' })).toThrow(
        /both a start date and an end date/i,
      );
    });

    it('reports a missing end date against the end field', () => {
      expect(() => resolveCustomPeriod({ from: '2026-09-01', to: '' })).toThrow(
        /both a start date and an end date/i,
      );
    });
  });

  describe('resolvePeriod', () => {
    it('defaults to thisMonth when nothing is requested', () => {
      // The documented default, so an unfiltered request and ?period=thisMonth are one query.
      expect(bounds(resolvePeriod({}, today('2026-09-15')))).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });

    it('resolves a preset by name', () => {
      expect(resolvePeriod({ preset: 'today' }, today('2026-09-15')).kind).toBe('today');
    });

    it('resolves a custom range', () => {
      expect(
        bounds(
          resolvePeriod({ custom: { from: '2026-01-01', to: '2026-06-30' } }, today('2026-09-15')),
        ),
      ).toEqual({ from: '2026-01-01', to: '2026-06-30' });
    });

    it('refuses a request that supplies both a preset and a custom range', () => {
      // Preferring one would mean a shared URL reading ?period=thisMonth&from=...&to=...
      // silently showing a different period than it says.
      expect(() =>
        resolvePeriod(
          { preset: 'thisMonth', custom: { from: '2026-01-01', to: '2026-06-30' } },
          today('2026-09-15'),
        ),
      ).toThrow(/either a named period or a custom date range/i);
    });

    it('refuses an unsupported preset name', () => {
      expect(() =>
        resolvePeriod({ preset: 'lastFortnight' as never }, today('2026-09-15')),
      ).toThrow(/named period is not supported/i);
    });
  });

  describe('month helpers', () => {
    it('lists every calendar month of a range, oldest first', () => {
      const months = calendarMonthsOf(
        resolveCustomPeriod({ from: '2025-11-15', to: '2026-02-03' }),
      );

      expect(months).toEqual<CalendarMonth[]>([
        { year: 2025, month: 11 },
        { year: 2025, month: 12 },
        { year: 2026, month: 1 },
        { year: 2026, month: 2 },
      ]);
    });

    it('lists exactly one month for a single-day range', () => {
      expect(
        calendarMonthsOf(resolveCustomPeriod({ from: '2026-09-15', to: '2026-09-15' })),
      ).toEqual([{ year: 2026, month: 9 }]);
    });

    it('produces twelve months for thisYear', () => {
      expect(calendarMonthsOf(resolvePresetPeriod('thisYear', today('2026-06-15')))).toHaveLength(
        12,
      );
    });

    it('counts the months a range spans inclusively', () => {
      expect(monthSpanOf(resolveCustomPeriod({ from: '2026-01-31', to: '2026-02-01' }))).toBe(2);
      expect(monthSpanOf(resolveCustomPeriod({ from: '2026-01-01', to: '2026-01-31' }))).toBe(1);
    });

    it('derives comparable month keys from the range bounds', () => {
      expect(
        monthKeyRangeOf(resolveCustomPeriod({ from: '2026-09-01', to: '2026-11-30' })),
      ).toEqual({
        fromKey: 202609,
        toKey: 202611,
      });
    });

    it('produces an ordered key range for every preset', () => {
      const reference = today('2026-09-15');

      for (const preset of DASHBOARD_PERIOD_PRESETS) {
        const keys = monthKeyRangeOf(resolvePresetPeriod(preset, reference));

        expect(keys.fromKey).toBeLessThanOrEqual(keys.toKey);
      }
    });
  });

  describe('assertSpanWithinLimit', () => {
    it('accepts a range at the limit', () => {
      expect(() =>
        assertSpanWithinLimit(resolveCustomPeriod({ from: '2023-10-01', to: '2026-09-30' }), 36),
      ).not.toThrow();
    });

    it('refuses a range over the limit and names both the limit and the actual span', () => {
      // The message has to be actionable: an Admin who chose five years should learn which rule
      // stopped them and by how much. January 2020 through September 2026 is 81 calendar months
      // inclusive: seven full years less the three months of 2026 before September.
      expect(() =>
        assertSpanWithinLimit(resolveCustomPeriod({ from: '2020-01-01', to: '2026-09-30' }), 36),
      ).toThrow(/36 months or fewer.*81 months/i);
    });
  });

  describe('periodLabel', () => {
    it('names a preset using its documented label', () => {
      expect(periodLabel(resolvePresetPeriod('thisMonth', today('2026-09-15')))).toBe('This Month');
      expect(periodLabel(resolvePresetPeriod('last6Months', today('2026-09-15')))).toBe(
        'Last 6 Months',
      );
    });

    it('shows the exact dates for a custom range so the active period is unambiguous', () => {
      expect(periodLabel(resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }))).toBe(
        '2026-09-01 to 2026-09-30',
      );
    });
  });

  describe('currentBusinessDate', () => {
    it('reduces an instant to the Asia/Kolkata calendar date', () => {
      // 18:45 UTC is 00:15 the next day in Asia/Kolkata. Reading the UTC date would answer
      // `today` as the previous day for the first five and a half hours of every IST day.
      const instant = new Date('2026-09-15T18:45:00.000Z');

      expect(currentBusinessDate(instant).toISOString().slice(0, 10)).toBe('2026-09-16');
    });

    it('keeps the same calendar date inside the IST day', () => {
      const instant = new Date('2026-09-15T10:00:00.000Z');

      expect(currentBusinessDate(instant).toISOString().slice(0, 10)).toBe('2026-09-15');
    });

    it('returns a UTC-midnight Date so period arithmetic is zone-free', () => {
      const reduced = currentBusinessDate(new Date('2026-09-15T10:00:00.000Z'));

      expect(reduced.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    });
  });

  describe('error type', () => {
    it('reports an invalid range as a documented domain validation error', () => {
      // A resolver failure must reach the global filter as VALIDATION_FAILED, not as a 500:
      // these are client mistakes, and `docs/07-SECURITY-RULES.md` requires input problems to be
      // reported as such.
      try {
        resolveCustomPeriod({ from: '2026-09-30', to: '2026-09-01' });
        throw new Error('the resolver should have refused an inverted range');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).kind).toBe('VALIDATION_FAILED');
      }
    });
  });
});
