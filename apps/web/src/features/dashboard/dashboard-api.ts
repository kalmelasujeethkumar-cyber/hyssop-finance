import { useQuery } from '@tanstack/react-query';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  DASHBOARD_PERIOD_KINDS,
  DASHBOARD_PERIOD_PRESETS,
  isDashboardPeriodPreset,
  type DashboardPeriodKind,
  type DashboardPeriodPreset,
  type DashboardView,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';

/**
 * Dashboard data access.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the browser may hold an API client, typed contracts, a
 * query cache, and presentation formatting, and must not calculate authoritative financial
 * totals. Every figure on this screen arrives from `GET /api/v1/dashboard`; there is no local
 * ledger, no derived balance, and no share percentage computed here. `sharePercent` is sent by
 * the API as an exact two-decimal string precisely so the browser cannot re-derive it and
 * disagree with the server about a chart label.
 *
 * The only values this module decides are *which period to ask for*, and it decides them by
 * forwarding the selection verbatim to the API. The bounds shown on screen are the ones the
 * response reports, not ones recomputed here, because `today` depends on the current instant in
 * `Asia/Kolkata` and a browser-local copy of that rule could disagree with the server's.
 */

export const DASHBOARD_QUERY_KEY = ['dashboard'] as const;

/**
 * The period selection as the filter control holds it.
 *
 * `preset` and `custom` are mutually exclusive by construction rather than by convention: a
 * selection is either one of the eight named kinds, or it is a custom range. There is no
 * representation of "a preset *and* a range", which is what made
 * `?period=thisMonth&from=…&to=…` possible in the first place.
 */
export type DashboardPeriodSelection =
  | { readonly kind: Exclude<DashboardPeriodKind, 'custom'> }
  | { readonly kind: 'custom'; readonly from: string; readonly to: string };

/** The filter control's initial state, matching the API's own default. */
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodSelection = { kind: 'thisMonth' };

/** The named periods offered, in the order `docs/03-UI-UX-RULES.md` documents. */
export const DASHBOARD_PERIOD_CHOICES: readonly DashboardPeriodKind[] = DASHBOARD_PERIOD_KINDS;

export interface DashboardCustomRangeErrors {
  readonly from?: string;
  readonly to?: string;
  readonly range?: string;
}

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a custom range in the browser.
 *
 * Mirrors the API's rules using the shared pattern rather than a second copy of the format, and
 * it reports *which* bound is at fault so the message lands next to the field that caused it.
 *
 * The two cross-field rules — `from` must not be after `to`, and the span must stay within the
 * documented month limit — are checked here as well as by the API. Both need the other bound, so
 * they belong to the range rather than to either input; reporting them as a field error on the
 * pair keeps the message next to the pair of controls that produced it.
 */
export function validateDashboardCustomRange(from: string, to: string): DashboardCustomRangeErrors {
  const errors: {
    from?: string;
    to?: string;
    range?: string;
  } = {};

  const fromTrimmed = from.trim();
  const toTrimmed = to.trim();

  if (!BUSINESS_DATE.test(fromTrimmed)) {
    errors.from = BUSINESS_DATE_FORMAT_MESSAGE;
  }

  if (!BUSINESS_DATE.test(toTrimmed)) {
    errors.to = BUSINESS_DATE_FORMAT_MESSAGE;
  }

  // Ordering and span can only be judged once both bounds parse, so an unparseable bound is not
  // also reported as an inverted range: two messages for one typo is noise, not help.
  if (errors.from === undefined && errors.to === undefined) {
    if (fromTrimmed > toTrimmed) {
      errors.range = 'The start date must not be after the end date.';
    } else if (monthSpanOf(fromTrimmed, toTrimmed) > 36) {
      errors.range = 'Choose a range of 36 months or fewer.';
    }
  }

  return errors;
}

export function hasDashboardCustomRangeErrors(errors: DashboardCustomRangeErrors): boolean {
  return errors.from !== undefined || errors.to !== undefined || errors.range !== undefined;
}

/**
 * The inclusive number of calendar months a range spans.
 *
 * A one-day range inside a single month is 1, not 0, and `YYYY-MM` compares correctly as plain
 * text, so no `Date` is constructed and no time zone can shift a boundary by a month.
 */
function monthSpanOf(from: string, to: string): number {
  const fromKey = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const toKey = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));

  return toKey - fromKey + 1;
}

/**
 * Builds the documented dashboard query string.
 *
 * Exactly one of the two forms is sent. The `from`/`to` pair is omitted entirely for a preset, so
 * the request states the whole intent and a stale custom range left in the URL cannot be applied
 * on top of a named period.
 */
export function dashboardPath(period: DashboardPeriodSelection): string {
  if (period.kind !== 'custom') {
    return `/dashboard?period=${period.kind}`;
  }

  const query = new URLSearchParams({ from: period.from.trim(), to: period.to.trim() });

  return `/dashboard?${query.toString()}`;
}

/** The cache key for one selection, so each period is cached separately. */
export function dashboardQueryKey(period: DashboardPeriodSelection): readonly unknown[] {
  return [...DASHBOARD_QUERY_KEY, period];
}

/**
 * The one dashboard request.
 *
 * `retry` is off because a failure here is shown as an error state with a real "Try again"
 * button rather than being retried invisibly; silently retrying a 400 for an invalid range would
 * leave the Admin waiting on a request that can never succeed.
 */
export function useDashboard(period: DashboardPeriodSelection) {
  const client = useApiClient();

  return useQuery({
    queryKey: dashboardQueryKey(period),
    queryFn: ({ signal }) => client.get<DashboardView>(dashboardPath(period), { signal }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Reads the period out of a URL search string.
 *
 * The selection is part of the URL so a shared link produces the same figures, which
 * `docs/03-UI-UX-RULES.md` requires. An unknown or unparseable value falls back to the API's own
 * default rather than rendering an error: a stale bookmark is not the Admin's mistake, and the
 * control can be changed from there.
 *
 * A `from`/`to` pair is only honoured when it is completely valid — both bounds present and both
 * well-formed. A pair with one bound missing, or one that is not a `YYYY-MM-DD` date, is treated as
 * no pair at all and the `period` parameter decides, because forwarding a half-typed range would
 * send a request the API rejects and surface a validation message the Admin did not cause.
 */
export function dashboardPeriodFromSearch(
  search: string | URLSearchParams,
): DashboardPeriodSelection {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const from = params.get('from');
  const to = params.get('to');

  if (
    from !== null &&
    to !== null &&
    !hasDashboardCustomRangeErrors(validateDashboardCustomRange(from, to))
  ) {
    return { kind: 'custom', from, to };
  }

  const period = params.get('period');

  if (isDashboardPeriodPreset(period)) {
    return { kind: period };
  }

  return DEFAULT_DASHBOARD_PERIOD;
}

/** The search string a selection produces, for the shareable URL. */
export function dashboardSearchFromPeriod(period: DashboardPeriodSelection): string {
  return dashboardPath(period).slice('/dashboard'.length);
}

export { DASHBOARD_PERIOD_PRESETS, isDashboardPeriodPreset };
export type { DashboardPeriodPreset, DashboardPeriodKind };
