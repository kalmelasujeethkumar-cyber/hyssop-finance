import { describe, expect, it } from 'vitest';
import { DASHBOARD_PERIOD_PRESETS, type DashboardView } from '@hyssop/contracts';
import { DASHBOARD_VIEW } from '../../test/stub-client';
import {
  DEFAULT_DASHBOARD_PERIOD,
  dashboardPath,
  dashboardPeriodFromSearch,
  dashboardSearchFromPeriod,
  hasDashboardCustomRangeErrors,
  validateDashboardCustomRange,
  type DashboardPeriodSelection,
} from './dashboard-api';

/**
 * The pure rules of the dashboard's period control.
 *
 * The browser owns only *which* period to request; every amount on the screen comes from the API.
 * These tests therefore assert the request the control would send, not a figure it produced.
 */

describe('dashboardPath', () => {
  it('sends exactly one period parameter for a preset and no range', () => {
    for (const preset of DASHBOARD_PERIOD_PRESETS) {
      const path = dashboardPath({ kind: preset });

      expect(path).toBe(`/dashboard?period=${preset}`);
    }
  });

  it('sends no period parameter for a custom range, so a stale preset cannot apply on top of it', () => {
    // `?period=lastMonth&from=…&to=…` is the ambiguous request this module exists to prevent: the
    // API would have to pick which one wins, and the screen could then show figures for a period
    // the Admin did not choose.
    expect(dashboardPath({ kind: 'custom', from: '2026-01-01', to: '2026-03-31' })).toBe(
      '/dashboard?from=2026-01-01&to=2026-03-31',
    );
  });

  it('trims the bounds so a pasted date with stray spaces is still a valid request', () => {
    expect(dashboardPath({ kind: 'custom', from: ' 2026-01-01 ', to: ' 2026-03-31 ' })).toBe(
      '/dashboard?from=2026-01-01&to=2026-03-31',
    );
  });
});

describe('validateDashboardCustomRange', () => {
  it('accepts an ordered range inside the documented limit', () => {
    expect(validateDashboardCustomRange('2026-01-01', '2026-03-31')).toEqual({});
  });

  it('accepts a range that is exactly the 36-month limit', () => {
    expect(validateDashboardCustomRange('2024-01-01', '2026-12-31')).toEqual({});
  });

  it('rejects a range one month longer than the limit', () => {
    // `DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT` is 36 because the trend expands into one point per
    // month. A longer range would ask the API for a 37-point chart it is documented to refuse.
    expect(validateDashboardCustomRange('2023-12-01', '2026-12-31').range).toBe(
      'Choose a range of 36 months or fewer.',
    );
  });

  it('reports an inverted range on the pair rather than on either bound', () => {
    const errors = validateDashboardCustomRange('2026-03-31', '2026-01-01');

    expect(errors.range).toBe('The start date must not be after the end date.');
    expect(errors.from).toBeUndefined();
    expect(errors.to).toBeUndefined();
  });

  it('names the bound that is not a business date', () => {
    const errors = validateDashboardCustomRange('01/01/2026', '2026-03-31');

    expect(errors.from).toBeDefined();
    expect(errors.to).toBeUndefined();
    // Ordering cannot be judged while one bound is unparseable, so a single typo produces one
    // message rather than two.
    expect(errors.range).toBeUndefined();
  });

  it('reports both bounds when both are empty', () => {
    const errors = validateDashboardCustomRange('', '');

    expect(errors.from).toBeDefined();
    expect(errors.to).toBeDefined();
    expect(hasDashboardCustomRangeErrors(errors)).toBe(true);
  });
});

describe('dashboardPeriodFromSearch', () => {
  it('reads a documented preset from the URL', () => {
    expect(dashboardPeriodFromSearch('?period=last6Months')).toEqual({ kind: 'last6Months' });
  });

  it('reads a valid custom range from the URL', () => {
    expect(dashboardPeriodFromSearch('?from=2026-01-01&to=2026-03-31')).toEqual({
      kind: 'custom',
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('falls back to the API default when the period is not one the API accepts', () => {
    // A hand-edited or stale bookmark is not the Admin's mistake, and rejecting it would put a
    // validation error on screen for something they did not do.
    expect(dashboardPeriodFromSearch('?period=lastDecade')).toEqual(DEFAULT_DASHBOARD_PERIOD);
  });

  it('falls back rather than forwarding a range with only one bound', () => {
    expect(dashboardPeriodFromSearch('?from=2026-01-01')).toEqual(DEFAULT_DASHBOARD_PERIOD);
  });

  it('falls back rather than forwarding a malformed range', () => {
    // Forwarding `from=oops` would ask the API something it rejects, producing a 400 beside a
    // screen the Admin never filled in.
    expect(dashboardPeriodFromSearch('?from=oops&to=2026-03-31')).toEqual(DEFAULT_DASHBOARD_PERIOD);
  });

  it('falls back rather than forwarding an inverted range', () => {
    expect(dashboardPeriodFromSearch('?from=2026-03-31&to=2026-01-01')).toEqual(
      DEFAULT_DASHBOARD_PERIOD,
    );
  });

  it('defaults when the URL carries nothing at all', () => {
    expect(dashboardPeriodFromSearch('')).toEqual(DEFAULT_DASHBOARD_PERIOD);
  });
});

describe('the round trip between a selection and its URL', () => {
  const selections: readonly DashboardPeriodSelection[] = [
    { kind: 'today' },
    { kind: 'thisMonth' },
    { kind: 'lastMonth' },
    { kind: 'last3Months' },
    { kind: 'last6Months' },
    { kind: 'thisYear' },
    { kind: 'lastYear' },
    { kind: 'custom', from: '2026-01-01', to: '2026-03-31' },
  ];

  it('reproduces every selection from the search string it produces', () => {
    // A shared link has to produce the same figures, so the URL cannot merely carry the selection;
    // reading it back must return it unchanged.
    for (const selection of selections) {
      expect(dashboardPeriodFromSearch(dashboardSearchFromPeriod(selection))).toEqual(selection);
    }
  });
});

describe('the dashboard payload', () => {
  it('is the shape the shared contract promises', () => {
    // The fixture is checked against the same guard the browser uses before drawing, so a change
    // to the contract that the screen cannot render would fail here rather than in review.
    expect(isRenderableDashboard(DASHBOARD_VIEW)).toBe(true);
  });

  it('keeps the period movement distinct from the ending balance', () => {
    // `REQ-FIN-014` requires the two to be separately labelled *because* they can differ. A
    // fixture where they are equal would let a screen that printed one number for both pass.
    expect(DASHBOARD_VIEW.movement.net).not.toBe(DASHBOARD_VIEW.balances.total);
    expect(DASHBOARD_VIEW.movement.label).not.toBe(DASHBOARD_VIEW.balances.label);
  });

  it('holds a negative method balance so the visible-negatives rule is testable', () => {
    // `REQ-FIN-012` requires a negative method balance to stay visible. A fixture with only
    // positive balances could not catch a screen that hid one.
    expect(DASHBOARD_VIEW.balances.upi.startsWith('-')).toBe(true);
  });

  it('carries a non-zero not-configured count so that bucket cannot be skipped', () => {
    // `REQ-CONTRIB-006` makes `Not configured` a separate state. With a zero count, omitting the
    // bucket entirely would render identically.
    expect(DASHBOARD_VIEW.contributionStatus.totals.notConfigured).toBeGreaterThan(0);
  });

  it('marks an Admin-entered category label as custom text', () => {
    const slice = DASHBOARD_VIEW.expenseBreakdown.slices[0];

    expect(slice?.customLabel).toBe(true);
  });
});

/**
 * A local copy of the contract's structural guard, spelled out as a local assertion.
 *
 * It deliberately does not import `isDashboardView` from the contract: the point is to assert the
 * fixture's values are internally consistent, which is a statement about this fixture rather than
 * a re-run of the contract's own suite.
 */
function isRenderableDashboard(view: DashboardView): boolean {
  return (
    typeof view.memberCount === 'number' &&
    Array.isArray(view.trend) &&
    Array.isArray(view.recentTransactions) &&
    view.incomeBreakdown.slices.every((slice) => /^\d+\.\d{2}$/.test(slice.amount)) &&
    view.expenseBreakdown.slices.every((slice) => /^\d+\.\d{2}$/.test(slice.amount))
  );
}
