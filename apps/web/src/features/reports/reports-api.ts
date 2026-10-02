import { useMutation, useQuery } from '@tanstack/react-query';
import {
  BUSINESS_DATE_PATTERN,
  CSV_CONTENT_TYPE,
  REPORT_IDS,
  REPORT_TITLES,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  isAuditReportAction,
  isReportId,
  isSearchType,
  isTransactionStatus,
  isTransactionType,
  type AnyReport,
  type AuditReportAction,
  type GlobalSearchResponse,
  type ReportId,
  type SearchType,
  type TransactionStatus,
  type TransactionType,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import type { DashboardPeriodSelection } from '../dashboard/dashboard-api';

/**
 * Report, export, and global-search data access.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the browser holds an API client, typed contracts, and
 * presentation, and never computes authoritative state. Every figure on a report screen arrives
 * from the API's own projection: totals, shares, counts, balances, and remaining amounts are read,
 * never re-derived, and `REQ-FIN-014`'s movement-versus-balance distinction is presented using the
 * labels the server sent rather than words chosen here.
 *
 * Four rules shape this module:
 *
 * - **The period is decided by the canonical dashboard selection.** `DashboardPeriodSelection` and
 *   the `dashboardPath` query construction are reused rather than reimplemented, because a report
 *   that resolved "this month" differently from the dashboard would be the exact disagreement
 *   `REQ-FIN-009` exists to prevent.
 * - **Exports are fetched, not linked.** The session lives in an HTTP-only cookie the browser must
 *   send with `credentials: 'include'`. A plain `<a href>` cannot guarantee that for a non-JSON
 *   response, so the CSV is fetched and handed to the browser as an object URL, which the caller
 *   revokes.
 * - **The filename comes from the server.** `docs/06-API-SPEC.md` bakes the report's resolved
 *   period into the export filename, and the browser has no way to know the bounds the API resolved
 *   for a preset. A fallback name is used only when the API declared none, and it is an openly
 *   generic one rather than an invented date range.
 * - **An unknown identifier never becomes a URL.** {@link reportIdFromSearch} falls back to the
 *   documented default, so a stale bookmark cannot make the browser request a route the API will
 *   reject — or worse, treat path text as a filename.
 */

export const REPORTS_QUERY_KEY = ['reports'] as const;

/** The eleven documented reports, in the order `REQ-REPORT-001` lists them. */
export const REPORT_CHOICES: readonly ReportId[] = REPORT_IDS;

/** The report shown when no valid `report` is in the URL: the one a pastor asks for first. */
export const DEFAULT_REPORT_ID: ReportId = 'financial-summary';

/** The paged reports, whose rows are read a page at a time rather than as one bounded block. */
export const PAGED_REPORT_IDS: readonly ReportId[] = ['audit', 'transactions'];

export function isPagedReport(reportId: ReportId): boolean {
  return PAGED_REPORT_IDS.includes(reportId);
}

/**
 * Which reports are answered by a period rather than by an instant window.
 *
 * `REPORT_IS_PERIOD_BOUNDED` is the contract's own answer and is not re-derived here: the Audit
 * report is the one report whose window is ISO instants, so it is the one report that must not be
 * given a `DashboardPeriodFilter`.
 */
export function usesPeriod(reportId: ReportId): boolean {
  return reportId !== 'audit';
}

export function isSearchTypeValue(value: string): value is SearchType {
  return isSearchType(value);
}

/** The Asia/Kolkata offset. India has observed no daylight saving, so it is a constant. */
const BUSINESS_UTC_OFFSET = '+05:30';

/**
 * Widens one business date to the ISO instant that bounds it.
 *
 * `docs/05-DATABASE-SPEC.md` reads `occurred_at` as a `TIMESTAMPTZ` and `docs/06-API-SPEC.md` asks
 * for ISO instants on the audit window, so the browser must state both the day and the clock time
 * in an unambiguous zone. A value that is not a business date is passed through unchanged, because
 * inventing a time for unrecognised text would be worse than letting the API reject it.
 */
export function auditInstant(date: string, bound: 'from' | 'to'): string {
  const trimmed = date.trim();

  if (!BUSINESS_DATE_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return bound === 'from'
    ? `${trimmed}T00:00:00${BUSINESS_UTC_OFFSET}`
    : `${trimmed}T23:59:59.999${BUSINESS_UTC_OFFSET}`;
}

/** Filters the Audit report accepts, all optional because an open-ended history read is legal. */
export interface AuditReportFilters {
  readonly from: string;
  readonly to: string;
  readonly action: AuditReportAction | '';
  readonly page: number;
  readonly pageSize: number;
}

export const AUDIT_FILTER_DEFAULTS: AuditReportFilters = {
  from: '',
  to: '',
  action: '',
  page: 1,
  pageSize: 20,
};

/** Filters the Complete Transaction report accepts on top of its period. */
export interface TransactionReportFilters {
  readonly type: TransactionType | '';
  readonly status: TransactionStatus | '';
  readonly page: number;
  readonly pageSize: number;
}

export const TRANSACTION_FILTER_DEFAULTS: TransactionReportFilters = {
  type: '',
  status: '',
  page: 1,
  pageSize: 20,
};

/** Filters global search accepts. */
export interface SearchFilters {
  readonly term: string;
  readonly type: SearchType;
  readonly page: number;
  readonly pageSize: number;
}

export const SEARCH_DEFAULTS: SearchFilters = {
  term: '',
  type: 'all',
  page: 1,
  pageSize: 20,
};

export const SEARCH_TYPE_LABELS: Readonly<Record<SearchType, string>> = {
  all: 'Members and transactions',
  member: 'Members only',
  transaction: 'Transactions only',
};

/**
 * The report selection a screen holds.
 *
 * A discriminated union rather than one object with every optional field, so it is impossible to
 * ask for the Audit report *with a period preset* or for a period report *with an instant window* —
 * a combination the API rejects. The screens therefore cannot express an invalid request even by
 * accident.
 */
export type ReportSelection =
  | {
      readonly reportId: Exclude<ReportId, 'audit' | 'transactions'>;
      readonly period: DashboardPeriodSelection;
    }
  | {
      readonly reportId: 'audit';
      readonly filters: AuditReportFilters;
    }
  | {
      readonly reportId: 'transactions';
      readonly period: DashboardPeriodSelection;
      readonly filters: TransactionReportFilters;
    };

/**
 * The shared period query for a period-bounded report.
 *
 * Exactly one of the two forms is sent, for the reason `dashboardPath` gives: the request states
 * the whole intent, so a stale custom range in the URL cannot be applied on top of a named period.
 */
export function reportPeriodQuery(period: DashboardPeriodSelection): URLSearchParams {
  if (period.kind !== 'custom') {
    return new URLSearchParams({ period: period.kind });
  }

  return new URLSearchParams({ from: period.from.trim(), to: period.to.trim() });
}

/**
 * The JSON report path.
 *
 * The literal segment is the report id from the shared closed list, so this cannot be used to build
 * an arbitrary URL: an unrecognised id never reaches this function.
 */
export function reportPath(selection: ReportSelection): string {
  const params = selectionParams(selection);

  return `/reports/${selection.reportId}${params.size === 0 ? '' : `?${params.toString()}`}`;
}

/**
 * The CSV export path.
 *
 * `docs/06-API-SPEC.md` widens the audit export's window to the whole period as instants, so an
 * export always carries a period query even for the Audit report, whose own screen filters by
 * instant. The two are deliberately different reads and the browser does not merge them.
 */
export function reportCsvPath(reportId: ReportId, period: DashboardPeriodSelection): string {
  const params = reportPeriodQuery(period);

  return `/reports/${reportId}/export.csv?${params.toString()}`;
}

function selectionParams(selection: ReportSelection): URLSearchParams {
  if (selection.reportId === 'audit') {
    const params = new URLSearchParams();

    // An absent bound is omitted rather than sent as an empty string: "no lower bound" and "the
    // lower bound is the empty instant" are different queries, and the API distinguishes them.
    //
    // A present bound is widened to the whole Asia/Kolkata day *here*, at the transport boundary,
    // because the screen holds business dates. `docs/06-API-SPEC.md` requires ISO instants on this
    // route, and a bare `YYYY-MM-DD` would be read by the browser and the API as UTC midnight —
    // 05:30 in Kolkata — which would quietly drop the early hours of the first day and most of the
    // last one. The offset is written literally because India observes no daylight saving.
    if (selection.filters.from !== '') {
      params.set('from', auditInstant(selection.filters.from, 'from'));
    }
    if (selection.filters.to !== '') {
      params.set('to', auditInstant(selection.filters.to, 'to'));
    }
    if (selection.filters.action !== '') {
      params.set('action', selection.filters.action);
    }

    return withPaging(params, selection.filters);
  }

  const params = reportPeriodQuery(selection.period);

  if (selection.reportId === 'transactions') {
    if (selection.filters.type !== '') {
      params.set('type', selection.filters.type);
    }
    if (selection.filters.status !== '') {
      params.set('status', selection.filters.status);
    }

    return withPaging(params, selection.filters);
  }

  return params;
}

function withPaging(
  params: URLSearchParams,
  filters: { readonly page: number; readonly pageSize: number },
): URLSearchParams {
  if (filters.page !== 1) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== TRANSACTION_PAGE_SIZE_DEFAULT) {
    params.set('pageSize', String(filters.pageSize));
  }

  return params;
}

/** The cache key for one selection, so each report and period is cached separately. */
export function reportQueryKey(selection: ReportSelection): readonly unknown[] {
  return [...REPORTS_QUERY_KEY, selection];
}

/**
 * The one report read.
 *
 * `retry` is off for the same reason the dashboard's is: a failure is shown as an error state with
 * a real "Try again" control, and silently retrying a `400` for an invalid window would leave the
 * Admin waiting on a request that can never succeed.
 */
export function useReport(selection: ReportSelection) {
  const client = useApiClient();

  return useQuery({
    queryKey: reportQueryKey(selection),
    queryFn: ({ signal }) => client.get<AnyReport>(reportPath(selection), { signal }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Saves a CSV the browser already holds.
 *
 * Exported separately from the fetch so a screen, a test, and a future "reuse the last export"
 * action all perform the identical save step, and so the browser-only concerns — creating the
 * blob, clicking, revoking — live in one place.
 *
 * `filename` falls back to the report id. A filename stating only which report it is is honest even
 * without the API's date range; inventing the range would be a claim the browser cannot verify.
 */
export function saveCsvFile(text: string, filename: string | undefined, reportId: ReportId): void {
  const blob = new Blob([text], { type: CSV_CONTENT_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = filename ?? `hyssop-${reportId}.csv`;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Revoked immediately after the click: the browser has already taken a reference to the blob,
    // and holding it longer would keep the whole export alive for nothing.
    URL.revokeObjectURL(url);
  }
}

/**
 * The CSV export.
 *
 * It is a mutation rather than a query because it produces a file, not cached state: refetching a
 * report must not silently re-download a spreadsheet, and two exports of the same report in the
 * same session should each ask the server for the current projection.
 */
export function useReportCsvDownload() {
  const client = useApiClient();

  return useMutation({
    mutationFn: async (input: {
      readonly reportId: ReportId;
      readonly period: DashboardPeriodSelection;
    }) => {
      const download = await client.getText(reportCsvPath(input.reportId, input.period));

      saveCsvFile(download.text, download.filename, input.reportId);

      return download.filename ?? `hyssop-${input.reportId}.csv`;
    },
  });
}

/**
 * The search path.
 *
 * `q` and `type` are always sent because they are the search itself, and paging is sent only when
 * it differs from the API's default for the reason {@link withPaging} gives. Omitting the defaults
 * keeps the shared-bookmark URL short and identical to what `docs/06-API-SPEC.md` documents for a
 * first-page search, while a later page states the page it actually means.
 */
export function searchPath(filters: SearchFilters): string {
  const params = new URLSearchParams({ q: filters.term.trim(), type: filters.type });

  return `/search?${withPaging(params, filters).toString()}`;
}

export function searchQueryKey(filters: SearchFilters): readonly unknown[] {
  return ['search', filters];
}

/**
 * The one global search.
 *
 * `enabled` is off for an empty term because `docs/06-API-SPEC.md` requires `q`, and a request for
 * an empty term is a request the API rejects rather than a search that matches nothing. The
 * controlled input is therefore what enables the search, not an initial request on mount.
 */
export function useGlobalSearch(filters: SearchFilters, enabled: boolean) {
  const client = useApiClient();

  return useQuery({
    queryKey: searchQueryKey(filters),
    queryFn: ({ signal }) => client.get<GlobalSearchResponse>(searchPath(filters), { signal }),
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Reads a report id out of a URL, falling back to the documented default.
 *
 * A stale or mistyped bookmark is not the Admin's mistake, and the report picker is one control
 * away from anywhere, so an unrecognised value renders the default rather than an error page.
 */
export function reportIdFromSearch(search: string | URLSearchParams): ReportId {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;

  return isReportId(params.get('report')) ? (params.get('report') as ReportId) : DEFAULT_REPORT_ID;
}

/** Clamps a page size to what the API accepts, so the control cannot request a rejected value. */
export function clampReportPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return TRANSACTION_PAGE_SIZE_DEFAULT;
  }

  return Math.min(pageSize, TRANSACTION_PAGE_SIZE_MAX);
}

/** Reads a positive page number, defaulting rather than trusting the URL. */
export function readPage(search: string | URLSearchParams, key: string): number {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = Number(params.get(key));

  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/** Normalises an audit action read from a URL against the closed action list. */
export function readAuditAction(value: string | null): AuditReportAction | '' {
  return isAuditReportAction(value) ? value : '';
}

/** Normalises a transaction type read from a URL against the closed type list. */
export function readTransactionType(value: string | null): TransactionType | '' {
  return isTransactionType(value) ? value : '';
}

/** Normalises a transaction status read from a URL against the closed status list. */
export function readTransactionStatus(value: string | null): TransactionStatus | '' {
  return isTransactionStatus(value) ? value : '';
}

/** The Admin-facing report titles, re-exported so a screen never hand-writes one. */
export { REPORT_TITLES };
