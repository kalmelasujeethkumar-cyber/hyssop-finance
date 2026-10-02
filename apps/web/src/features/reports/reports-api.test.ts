import { describe, expect, it } from 'vitest';
import { REPORT_IDS, SEARCH_TYPES, TRANSACTION_PAGE_SIZE_MAX } from '@hyssop/contracts';
import {
  AUDIT_FILTER_DEFAULTS,
  DEFAULT_REPORT_ID,
  SEARCH_DEFAULTS,
  TRANSACTION_FILTER_DEFAULTS,
  auditInstant,
  clampReportPageSize,
  isPagedReport,
  reportCsvPath,
  reportIdFromSearch,
  reportPath,
  searchPath,
  usesPeriod,
  type ReportSelection,
} from './reports-api';

/**
 * The pure rules of report and search URL construction.
 *
 * These assert the *request* the screens would send, never a figure they produced: `docs/02-ARCHITECTURE.md`
 * makes the API the only place a financial figure may be decided, so a report test that computed a
 * total would be testing the wrong thing.
 */

const AUDIT_SELECTION: ReportSelection = {
  reportId: 'audit',
  filters: { ...AUDIT_FILTER_DEFAULTS, from: '2026-09-01', to: '2026-09-30' },
};

describe('reportPath', () => {
  it('builds the documented period query for every period-bounded report', () => {
    for (const reportId of REPORT_IDS) {
      if (reportId === 'audit') {
        continue;
      }

      // The Complete Transaction report is the one period-bounded report that also carries its
      // own filters, which is exactly why `ReportSelection` is a discriminated union: it is
      // impossible to build its request without them.
      const selection: ReportSelection =
        reportId === 'transactions'
          ? { reportId, period: { kind: 'thisMonth' }, filters: TRANSACTION_FILTER_DEFAULTS }
          : { reportId, period: { kind: 'thisMonth' } };

      expect(reportPath(selection)).toBe(`/reports/${reportId}?period=thisMonth`);
    }
  });

  it('sends a custom range as dates and omits the preset, so the two can never conflict', () => {
    // `?period=lastMonth&from=…&to=…` is the ambiguous request `docs/06-API-SPEC.md` forbids:
    // the screen would then be showing figures for a period the Admin did not choose.
    expect(
      reportPath({
        reportId: 'income',
        period: { kind: 'custom', from: '2026-01-01', to: '2026-03-31' },
      }),
    ).toBe('/reports/income?from=2026-01-01&to=2026-03-31');
  });

  it('widens each audit bound to the whole Asia/Kolkata day as an ISO instant', () => {
    // The audit window is a `TIMESTAMPTZ` range, so a bare date is not enough: read as UTC,
    // `2026-09-01` would be 05:30 in Kolkata and would silently drop the first five and a half
    // hours of the window the Admin asked for.
    expect(reportPath(AUDIT_SELECTION)).toBe(
      '/reports/audit?from=2026-09-01T00%3A00%3A00%2B05%3A30&to=2026-09-30T23%3A59%3A59.999%2B05%3A30',
    );
  });

  it('omits an absent audit bound rather than sending an empty instant', () => {
    // "No lower bound" and "the lower bound is the empty instant" are different queries, and the
    // contract returns `null` for the former, so the client must be able to tell them apart.
    expect(
      reportPath({
        reportId: 'audit',
        filters: { ...AUDIT_FILTER_DEFAULTS, action: 'TRANSACTION_VOIDED' },
      }),
    ).toBe('/reports/audit?action=TRANSACTION_VOIDED');
  });

  it('adds the audit action filter and paging only when they are set', () => {
    expect(
      reportPath({
        reportId: 'audit',
        filters: { from: '', to: '', action: 'DOCUMENT_REMOVED', page: 3, pageSize: 50 },
      }),
    ).toBe('/reports/audit?action=DOCUMENT_REMOVED&page=3&pageSize=50');
  });

  it('adds the Complete Transaction type and status filters on top of the period', () => {
    expect(
      reportPath({
        reportId: 'transactions',
        period: { kind: 'thisYear' },
        filters: { type: 'EXPENSE', status: 'VOIDED', page: 1, pageSize: 20 },
      }),
    ).toBe('/reports/transactions?period=thisYear&type=EXPENSE&status=VOIDED');
  });
});

describe('reportCsvPath', () => {
  it('always carries a period query, including for the Audit report', () => {
    // The export route is period-bounded for every report, so an audit export reads the whole
    // chosen period as instants. The JSON route and the export route are deliberately different
    // reads, and the browser does not merge them.
    expect(reportCsvPath('audit', { kind: 'custom', from: '2026-09-01', to: '2026-09-30' })).toBe(
      '/reports/audit/export.csv?from=2026-09-01&to=2026-09-30',
    );
    expect(reportCsvPath('offerings', { kind: 'thisMonth' })).toBe(
      '/reports/offerings/export.csv?period=thisMonth',
    );
  });

  it('builds an export path for all eleven documented reports', () => {
    for (const reportId of REPORT_IDS) {
      expect(reportCsvPath(reportId, { kind: 'thisMonth' })).toBe(
        `/reports/${reportId}/export.csv?period=thisMonth`,
      );
    }
  });
});

describe('auditInstant', () => {
  it('starts a lower bound at midnight and ends an upper bound at the last millisecond of the day', () => {
    expect(auditInstant('2026-09-01', 'from')).toBe('2026-09-01T00:00:00+05:30');
    expect(auditInstant('2026-09-30', 'to')).toBe('2026-09-30T23:59:59.999+05:30');
  });

  it('passes unrecognised text through so the API can reject it rather than the browser guessing', () => {
    expect(auditInstant('not-a-date', 'from')).toBe('not-a-date');
    expect(auditInstant('   ', 'to')).toBe('');
  });
});

describe('searchPath', () => {
  it('sends the trimmed term and the scope', () => {
    expect(searchPath({ ...SEARCH_DEFAULTS, term: '  anand  ' })).toBe('/search?q=anand&type=all');
  });

  it('keeps the first page out of the URL so a shared link matches the documented default', () => {
    expect(searchPath({ term: 'anand', type: 'member', page: 1, pageSize: 20 })).toBe(
      '/search?q=anand&type=member',
    );
  });

  it('states a later page explicitly, because a different page is a different request', () => {
    expect(searchPath({ term: 'anand', type: 'all', page: 4, pageSize: 50 })).toBe(
      '/search?q=anand&type=all&page=4&pageSize=50',
    );
  });

  it('accepts only the three documented scopes', () => {
    for (const type of SEARCH_TYPES) {
      expect(searchPath({ ...SEARCH_DEFAULTS, term: 'a', type })).toContain(`type=${type}`);
    }
  });
});

describe('report classification', () => {
  it('reserves the instant-window treatment for the Audit report alone', () => {
    // `REPORT_IS_PERIOD_BOUNDED` in the contract is the authority; this only checks the screen does
    // not contradict it by giving the Audit report a `DashboardPeriodFilter`, which would request a
    // period the audit route rejects.
    expect(usesPeriod('audit')).toBe(false);
    expect(REPORT_IDS.filter((reportId) => usesPeriod(reportId))).toHaveLength(
      REPORT_IDS.length - 1,
    );
  });

  it('paginates only the two reports that list history', () => {
    expect(isPagedReport('audit')).toBe(true);
    expect(isPagedReport('transactions')).toBe(true);
    expect(isPagedReport('financial-summary')).toBe(false);
    expect(isPagedReport('documents')).toBe(false);
  });
});

describe('reportIdFromSearch', () => {
  it('reads a documented report id', () => {
    expect(reportIdFromSearch('report=donations')).toBe('donations');
  });

  it('falls back to the documented default for a missing or unrecognised value', () => {
    // A stale bookmark is not the Admin's mistake, and a mistyped id must never become a URL: the
    // report path takes its segment from this closed list, so path text can never be a report id.
    expect(reportIdFromSearch('')).toBe(DEFAULT_REPORT_ID);
    expect(reportIdFromSearch('report=../../etc/passwd')).toBe(DEFAULT_REPORT_ID);
    expect(reportIdFromSearch('report=export.csv')).toBe(DEFAULT_REPORT_ID);
  });

  it('accepts a URLSearchParams as well as a raw query string', () => {
    expect(reportIdFromSearch(new URLSearchParams({ report: 'audit' }))).toBe('audit');
  });
});

describe('clampReportPageSize', () => {
  it('keeps a size the API accepts and refuses one it does not', () => {
    expect(clampReportPageSize(50)).toBe(50);
    expect(clampReportPageSize(TRANSACTION_PAGE_SIZE_MAX)).toBe(TRANSACTION_PAGE_SIZE_MAX);
    expect(clampReportPageSize(TRANSACTION_PAGE_SIZE_MAX + 1)).toBe(TRANSACTION_PAGE_SIZE_MAX);
  });

  it('falls back to the documented default for a value that is not a positive integer', () => {
    expect(clampReportPageSize(0)).toBe(20);
    expect(clampReportPageSize(-5)).toBe(20);
    expect(clampReportPageSize(12.5)).toBe(20);
    expect(clampReportPageSize(Number.NaN)).toBe(20);
  });
});

describe('defaults', () => {
  it('defaults to the first page so a stale page number cannot strand the Admin on an empty table', () => {
    expect({
      ...AUDIT_FILTER_DEFAULTS,
      ...TRANSACTION_FILTER_DEFAULTS,
      ...SEARCH_DEFAULTS,
    }).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('has no report id default that is outside the closed list', () => {
    expect(REPORT_IDS).toContain(DEFAULT_REPORT_ID);
  });
});
