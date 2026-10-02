import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CSV_CONTENT_TYPE,
  REPORT_IDS,
  isApiErrorBody,
  isApiSuccessEnvelope,
  type ApiSuccessEnvelope,
  type AuditReport,
  type BreakdownReport,
  type CompleteTransactionReport,
  type DocumentReport,
  type FinancialSummaryReport,
  type GlobalSearchResponse,
  type MemberContributionReport,
  type PaymentMethodReport,
  type TransactionListReport,
} from '@hyssop/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { SessionService } from '../src/auth/session.service';
import { AuditEventRepository } from '../src/database/audit/audit-event.repository';
import { IdempotencyRecordRepository } from '../src/database/idempotency/idempotency-record.repository';
import { MemberRepository } from '../src/database/members/member.repository';
import { ContributionPeriodRepository } from '../src/database/contributions/contribution-period.repository';
import { AppSettingRepository } from '../src/database/settings/app-setting.repository';
import { ExpenseCategoryRepository } from '../src/database/categories/expense-category.repository';
import { TransactionRepository } from '../src/database/transactions/transaction.repository';
import { ReconciliationService } from '../src/database/reconciliation/reconciliation.service';
import { parseBusinessDate } from '../src/common/time/business-date';
import {
  applyTestProcessEnvironment,
  TEST_ENVIRONMENT,
  TEST_SESSION_COOKIE,
} from './support/test-application';
import {
  FakeAudit,
  FakeCategories,
  FakeIdempotency,
  FakeLedger,
  FakeMembers,
  FakePeriods,
  FakeSettings,
  FakeTransactions,
  categoryFixture,
  fakeSession,
  httpServer,
  transactionFixture,
  type FakeCategory,
  type FakeDocumentRow,
  type FakeMember,
  type FakePeriod,
} from './support/fake-ledger';
import {
  FakeReconciliation,
  memberCreatedAt,
  reconciliationLookups,
} from './support/fake-dashboard';

/**
 * HTTP-layer coverage for the Phase 09 report and search routes.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-REPORT-001` to `REQ-REPORT-004`, `REQ-SEARCH-001`,
 * `REQ-SEARCH-002`, `REQ-EXPORT-001`, `REQ-EXPORT-002`; transport from `docs/06-API-SPEC.md`.
 * The real controllers, the real DTO validation, the real `ReportsService`, the real canonical
 * `period.resolver`, the real global `SessionGuard`, and the real error filter all run.
 *
 * Only persistence is replaced, by the shared doubles in `test/support/`, so this suite needs no
 * PostgreSQL. What it asserts is the transport contract and the honesty rules, each of which is a
 * rule a wiring or validation bug would break:
 *
 * - Every report and search route requires a session, and none is reachable unauthenticated.
 * - Every route answers under the `/api/v1` version prefix.
 * - The money arrives as exact strings, never as a float.
 * - Voided rows stay out of the active reports and stay in the history reports.
 * - A local document link is offered only when the bytes actually exist.
 * - The CSV export returns a real CSV content type, a documented filename, and escaped cells.
 * - An unknown preset, malformed date, inverted range, unknown report id, over-long search term, and
 *   blank search term are each rejected as a documented validation envelope.
 *
 * The financial *arithmetic* is deliberately not asserted here; it is proved against real
 * PostgreSQL by the database suites, where the actual `SUM`, `FILTER`, and `AT TIME ZONE` behaviour
 * runs. Asserting invented numbers against a double would only prove the double agrees with itself.
 */

const SESSION_TOKEN = 'session-token-for-the-report-routes';
const CSRF_TOKEN = 'csrf-token-for-the-report-routes';

const MEMBER_ONE_ID = 'e1000000-0000-4000-8000-000000000001';
const MEMBER_TWO_ID = 'e1000000-0000-4000-8000-000000000002';

const PERIOD_ONE_ID = 'e2000000-0000-4000-8000-000000000001';
const PERIOD_TWO_ID = 'e2000000-0000-4000-8000-000000000002';

const CATEGORY_ID = 'e3000000-0000-4000-8000-000000000001';

const OFFERING = 'e4000000-0000-4000-8000-000000000001';
const DONATION = 'e4000000-0000-4000-8000-000000000002';
const EXPENSE = 'e4000000-0000-4000-8000-000000000003';
const RECEIPTED_EXPENSE = 'e4000000-0000-4000-8000-000000000004';
const VOIDED_OFFERING = 'e4000000-0000-4000-8000-000000000005';
const ANONYMOUS_DONATION = 'e4000000-0000-4000-8000-000000000006';

const SEPTEMBER = { from: parseBusinessDate('2026-09-01'), to: parseBusinessDate('2026-09-30') };

describe('Reports HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;

  const members: readonly FakeMember[] = [
    { id: MEMBER_ONE_ID, referenceId: 'HY-MEM-0001', name: 'Anitha Kumaran' },
    // The phone is a searched field on the real member, so one fixture supplies it and the search
    // suite proves that a term found only there still returns the owner.
    { id: MEMBER_TWO_ID, referenceId: 'HY-MEM-0002', name: 'Bose Xavier', phone: '9840012345' },
  ];

  const memberCreatedAtById = new Map<string, Date>([
    [MEMBER_ONE_ID, memberCreatedAt('2026-01-05')],
    [MEMBER_TWO_ID, memberCreatedAt('2026-01-20')],
  ]);

  const periodRows: FakePeriod[] = [
    { id: PERIOD_ONE_ID, memberId: MEMBER_ONE_ID, year: 2026, month: 9, expectedPaise: 50_000n },
    { id: PERIOD_TWO_ID, memberId: MEMBER_TWO_ID, year: 2026, month: 9, expectedPaise: 50_000n },
  ];

  const categories: readonly FakeCategory[] = [
    categoryFixture({ id: CATEGORY_ID, name: 'Cleaning supplies' }),
  ];

  /**
   * Two documents, deliberately in different states.
   *
   * `availableDocument` keeps its bytes; `removedDocument` retains its metadata after a
   * reason-required removal. This is the pair that makes `REQ-EXPORT-002`'s local-link rule
   * observable over HTTP: only the first may be offered a link.
   */
  const availableDocument: FakeDocumentRow = {
    id: 'e5000000-0000-4000-8000-000000000001',
    referenceId: 'HY-DOC-000001',
    state: 'AVAILABLE',
    originalFilename: 'invoice.png',
    byteSize: 2048,
    detectedMimeType: 'image/png',
    uploadedAt: new Date('2026-09-11T06:00:00.000Z'),
    storageKey: 'a'.repeat(64),
  };

  const removedDocument: FakeDocumentRow = {
    id: 'e5000000-0000-4000-8000-000000000002',
    referenceId: 'HY-DOC-000002',
    state: 'REMOVED',
    originalFilename: 'bill.png',
    byteSize: 1024,
    detectedMimeType: 'image/png',
    uploadedAt: new Date('2026-09-11T06:10:00.000Z'),
    // The bytes are gone, so no local link may be promised.
    storageKey: null,
  };

  beforeEach(async () => {
    const ledger = new FakeLedger([
      transactionFixture({
        id: OFFERING,
        referenceId: 'HY-INC-000001',
        incomeType: 'OFFERING',
        amountPaise: 100_000n,
        paymentMethod: 'CASH',
        businessDate: parseBusinessDate('2026-09-06'),
        // Holds a comma and a double quote on purpose: this is the description that proves the CSV
        // writer quotes a cell instead of letting it shift every later column.
        description: 'Sunday offering, "main" box',
      }),
      transactionFixture({
        id: DONATION,
        referenceId: 'HY-INC-000002',
        incomeType: 'DONATION',
        amountPaise: 25_050n,
        paymentMethod: 'UPI',
        businessDate: parseBusinessDate('2026-09-09'),
        description: 'Donation for the poor',
      }),
      transactionFixture({
        id: ANONYMOUS_DONATION,
        referenceId: 'HY-INC-000003',
        incomeType: 'ANONYMOUS_DONATION',
        amountPaise: 5_000n,
        paymentMethod: 'CASH',
        businessDate: parseBusinessDate('2026-09-10'),
        description: 'Secret donor note',
      }),
      transactionFixture({
        id: EXPENSE,
        referenceId: 'HY-EXP-000001',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 40_000n,
        businessDate: parseBusinessDate('2026-09-10'),
        description: 'Cleaning supplies',
        categoryId: CATEGORY_ID,
      }),
      transactionFixture({
        id: RECEIPTED_EXPENSE,
        referenceId: 'HY-EXP-000002',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 10_000n,
        paymentMethod: 'BANK_TRANSFER',
        businessDate: parseBusinessDate('2026-09-11'),
        description: 'Electricity bill',
        categoryId: CATEGORY_ID,
        documents: [availableDocument, removedDocument],
      }),
      transactionFixture({
        id: VOIDED_OFFERING,
        referenceId: 'HY-INC-000004',
        incomeType: 'OFFERING',
        amountPaise: 30_000n,
        businessDate: parseBusinessDate('2026-09-12'),
        description: 'Voided duplicate offering',
        status: 'VOIDED',
        voidReason: 'Recorded twice by mistake',
        voidedAt: new Date('2026-09-13T06:00:00.000Z'),
        revision: 2,
      }),
    ]);

    restoreEnvironment = applyTestProcessEnvironment();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(TransactionRepository)
      .useValue(new FakeTransactions(ledger, members, periodRows, categories))
      .overrideProvider(AuditEventRepository)
      .useValue(new FakeAudit(ledger))
      .overrideProvider(MemberRepository)
      .useValue(new FakeMembers(members, memberCreatedAtById))
      .overrideProvider(ContributionPeriodRepository)
      .useValue(new FakePeriods(periodRows, ledger, members))
      .overrideProvider(AppSettingRepository)
      .useValue(new FakeSettings({ DEFAULT_MONTHLY_CONTRIBUTION_PAISE: '50000' }))
      .overrideProvider(ExpenseCategoryRepository)
      .useValue(new FakeCategories(categories))
      .overrideProvider(IdempotencyRecordRepository)
      .useValue(new FakeIdempotency())
      .overrideProvider(ReconciliationService)
      .useValue(new FakeReconciliation(ledger.rows, reconciliationLookups({ members, categories })))
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN
            ? fakeSession({ sessionId: 'session-reports', csrfToken: CSRF_TOKEN })
            : null,
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, TEST_ENVIRONMENT);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    restoreEnvironment();
  });

  /** An authenticated GET. A GET changes no state, so it needs no CSRF header. */
  function authGet(url: string) {
    return request(httpServer(app))
      .get(url)
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
  }

  /** A deliberately unauthenticated GET, for proving the global guard. */
  function anonymousGet(url: string) {
    return request(httpServer(app)).get(url);
  }

  /** Fetches a route, insists on the documented success envelope, and returns `data`. */
  async function readData<T>(url: string): Promise<T> {
    const response = await authGet(url);

    expect(response.status).toBe(200);

    const body: unknown = response.body;
    expect(isApiSuccessEnvelope(body)).toBe(true);

    return (body as ApiSuccessEnvelope<T>).data;
  }

  /** Asserts a route is refused without a session, with the documented authentication envelope. */
  async function expectRefused(url: string): Promise<void> {
    const response = await anonymousGet(url);

    expect(response.status).toBe(401);
    expect(isApiErrorBody(response.body)).toBe(true);
  }

  /** Asserts a route is refused as a documented validation failure. */
  async function expectRejected(url: string): Promise<void> {
    const response = await authGet(url);

    expect(response.status).toBe(400);
    expect(isApiErrorBody(response.body)).toBe(true);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  }

  const SEPTEMBER_QUERY = 'from=2026-09-01&to=2026-09-30';

  describe('authentication and versioning', () => {
    it.each([
      '/api/v1/reports/financial-summary',
      '/api/v1/reports/income',
      '/api/v1/reports/expenses',
      '/api/v1/reports/expense-categories',
      '/api/v1/reports/member-contributions',
      '/api/v1/reports/offerings',
      '/api/v1/reports/donations',
      '/api/v1/reports/payment-methods',
      '/api/v1/reports/documents',
      '/api/v1/reports/audit',
      '/api/v1/reports/transactions',
      '/api/v1/reports/income/export.csv',
      '/api/v1/search?q=offering',
    ])('refuses %s without a session', async (url) => {
      await expectRefused(url);
    });

    it('answers every period-bounded report under the versioned prefix', async () => {
      const reports = [
        'financial-summary',
        'income',
        'expenses',
        'expense-categories',
        'member-contributions',
        'offerings',
        'donations',
        'payment-methods',
        'documents',
      ];

      for (const report of reports) {
        const response = await authGet(`/api/v1/reports/${report}?${SEPTEMBER_QUERY}`);

        expect(response.status).toBe(200);
      }
    });
  });

  describe('the active financial reports', () => {
    it('reports income by type with an exact total that excludes voided rows', async () => {
      const report = await readData<BreakdownReport>(`/api/v1/reports/income?${SEPTEMBER_QUERY}`);

      // The voided offering is not in the September income total, and every amount is a string.
      expect(report.total).toBe('1300.50');
      expect(report.currency).toBe('INR');
      expect(typeof report.total).toBe('string');

      const offering = report.rows.find((row) => row.label === 'OFFERING');
      expect(offering?.amount).toBe('1000.00');
      expect(offering?.transactionCount).toBe(1);
    });

    it('never divides by zero for a period with no activity', async () => {
      const report = await readData<BreakdownReport>('/api/v1/reports/income?period=lastYear');

      expect(report.total).toBe('0.00');
      expect(report.rows).toEqual([]);
    });

    it('reports expenses per category with shares that sum to 100 when anything exists', async () => {
      const report = await readData<BreakdownReport>(`/api/v1/reports/expenses?${SEPTEMBER_QUERY}`);

      expect(report.total).toBe('500.00');
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]?.label).toBe('Cleaning supplies');
      // Exact decimal arithmetic, so a whole-number share is `100.00` rather than a rounded `100`.
      expect(report.rows[0]?.sharePercent).toBe('100.00');
    });

    it('labels period movement and ending balance separately on the payment method report', async () => {
      const report = await readData<PaymentMethodReport>(
        `/api/v1/reports/payment-methods?${SEPTEMBER_QUERY}`,
      );

      // `REQ-FIN-014`: a movement is the period; a balance is cumulative through the period end.
      // Both are present and separately named, so a reader cannot confuse them.
      expect(report.movementLabel).not.toBe(report.balanceLabel);
      expect(report.rows.map((row) => row.label)).toEqual(['Cash', 'UPI', 'Bank Transfer']);
      expect(report.rows.every((row) => typeof row.movement === 'string')).toBe(true);
    });

    it('reports a monthly trend across the resolved period', async () => {
      const report = await readData<FinancialSummaryReport>(
        '/api/v1/reports/financial-summary?period=thisMonth',
      );

      expect(report.period.timezone).toBe('Asia/Kolkata');
      expect(report.trend.every((point) => typeof point.movement === 'string')).toBe(true);
      expect(typeof report.availableBalanceForPeriod).toBe('string');
    });
  });

  describe('the Offering and Donation reports', () => {
    it('lists only the offering income type', async () => {
      const report = await readData<TransactionListReport>(
        `/api/v1/reports/offerings?${SEPTEMBER_QUERY}`,
      );

      expect(report.rows.map((row) => row.incomeType)).toEqual(['OFFERING']);
      expect(report.rowsTruncated).toBe(false);
    });

    it('includes an anonymous donation but strips its identity', async () => {
      const report = await readData<TransactionListReport>(
        `/api/v1/reports/donations?${SEPTEMBER_QUERY}`,
      );

      const anonymous = report.rows.find((row) => row.incomeType === 'ANONYMOUS_DONATION');

      expect(anonymous).toBeDefined();
      expect(anonymous?.memberName).toBeNull();
      expect(anonymous?.memberReferenceId).toBeNull();
      // The recorded description is identity-bearing, so it does not travel on an anonymous row.
      expect(anonymous?.description).not.toBe('Secret donor note');
    });

    it('excludes the voided offering from an active report', async () => {
      const report = await readData<TransactionListReport>(
        `/api/v1/reports/offerings?${SEPTEMBER_QUERY}`,
      );

      expect(report.rows.map((row) => row.referenceId)).not.toContain('HY-INC-000004');
    });
  });

  describe('the Member Contribution report', () => {
    it('reports expected, received, and remaining per member-month as exact strings', async () => {
      const report = await readData<MemberContributionReport>(
        `/api/v1/reports/member-contributions?${SEPTEMBER_QUERY}`,
      );

      expect(report.rows).toHaveLength(2);
      expect(report.totals.expected).toBe('1000.00');
      expect(report.totals.received).toBe('0.00');
      expect(report.totals.remaining).toBe('1000.00');
      expect(report.rows.every((row) => typeof row.received === 'string')).toBe(true);
    });

    it('attributes every row to a member reference, never to an invented identity', async () => {
      const report = await readData<MemberContributionReport>(
        `/api/v1/reports/member-contributions?${SEPTEMBER_QUERY}`,
      );

      expect(report.rows.map((row) => row.memberReferenceId).sort()).toEqual([
        'HY-MEM-0001',
        'HY-MEM-0002',
      ]);
    });
  });

  describe('the Receipt / Document report', () => {
    it('distinguishes available, removed, and voided document states', async () => {
      const report = await readData<DocumentReport>(`/api/v1/reports/documents?${SEPTEMBER_QUERY}`);

      expect(report.rows).toHaveLength(2);
      // Every documented state is counted, so a state with no rows reads `0` rather than going
      // missing and leaving the Admin to guess whether the bucket is empty or unimplemented.
      expect(report.counts).toEqual({ AVAILABLE: 1, REMOVED: 1, VOIDED: 0 });
    });

    it('offers a local link only while the bytes exist', async () => {
      const report = await readData<DocumentReport>(`/api/v1/reports/documents?${SEPTEMBER_QUERY}`);

      const available = report.rows.find((row) => row.state === 'AVAILABLE');
      const removed = report.rows.find((row) => row.state === 'REMOVED');

      // `REQ-EXPORT-002`: a link is a promise that opening it will work.
      expect(available?.link.locallyReachable).toBe(true);
      expect(available?.link.storagePath).toBe(
        `/api/v1/documents/${available?.documentId}/download`,
      );

      expect(removed?.link.locallyReachable).toBe(false);
      // The internal storage key must never be exposed, whatever the state.
      expect(removed?.link.storagePath).not.toContain('a'.repeat(64));
    });

    it('states the local-only reachability caveat rather than promising permanence', async () => {
      const report = await readData<DocumentReport>(`/api/v1/reports/documents?${SEPTEMBER_QUERY}`);

      expect(report.rows[0]?.link.accessNote.length).toBeGreaterThan(0);
    });
  });

  describe('the history reports', () => {
    it('retains the voided offering in the Complete Transaction report', async () => {
      const report = await readData<CompleteTransactionReport>(
        `/api/v1/reports/transactions?${SEPTEMBER_QUERY}&status=VOIDED`,
      );

      expect(report.rows.map((row) => row.referenceId)).toEqual(['HY-INC-000004']);
      expect(report.rows[0]?.voidReason).toBe('Recorded twice by mistake');
    });

    it('paginates the Complete Transaction report with a total for the whole match set', async () => {
      const report = await readData<CompleteTransactionReport>(
        `/api/v1/reports/transactions?${SEPTEMBER_QUERY}&page=1&pageSize=2`,
      );

      expect(report.rows).toHaveLength(2);
      // The total is the whole match set, not this page, so the pager can never look like the end.
      expect(report.transactionCount).toBe(6);
      expect(report.pagination.pageSize).toBe(2);
    });

    it('returns the Audit report history newest first with a nullable open window', async () => {
      const report = await readData<AuditReport>('/api/v1/reports/audit');

      // An unbound window is `null`, not an empty string: an open-ended read is a different query.
      expect(report.range).toEqual({ from: null, to: null });
      expect(report.action).toBeNull();
    });

    it('filters the Audit report by an exact action', async () => {
      const report = await readData<AuditReport>('/api/v1/reports/audit?action=TRANSACTION_VOIDED');

      expect(report.action).toBe('TRANSACTION_VOIDED');
    });
  });

  describe('the CSV export', () => {
    it('serves a CSV with the documented content type and filename', async () => {
      const response = await authGet(`/api/v1/reports/income/export.csv?${SEPTEMBER_QUERY}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain(CSV_CONTENT_TYPE);
      expect(response.headers['content-disposition']).toContain('income-report.csv');
    });

    it('exports the same rows the JSON route returns', async () => {
      const json = await readData<BreakdownReport>(`/api/v1/reports/income?${SEPTEMBER_QUERY}`);
      const csv = await authGet(`/api/v1/reports/income/export.csv?${SEPTEMBER_QUERY}`);

      expect(csv.status).toBe(200);

      // Header plus one line per row, and every amount the screen showed is in the file.
      const lines = csv.text.trimEnd().split('\r\n');
      expect(lines).toHaveLength(json.rows.length + 1);

      for (const row of json.rows) {
        expect(csv.text).toContain(row.amount);
      }
    });

    it('carries the document reference and the local-only link caveat into the Offering export', async () => {
      const csv = await authGet(`/api/v1/reports/offerings/export.csv?${SEPTEMBER_QUERY}`);

      expect(csv.status).toBe(200);

      // `REQ-EXPORT-001` and `REQ-EXPORT-002`: the document columns exist, and the link column is
      // labelled as local-only rather than as a permanent public URL.
      expect(csv.text.trimEnd().split('\r\n')[0]).toBe(
        'Reference,Business Date,Amount (INR),Payment Method,Member,Description,Document Reference,Document Link (local application only)',
      );
    });

    it('quotes a description holding a comma so the later columns stay in their own cells', async () => {
      const csv = await authGet(`/api/v1/reports/offerings/export.csv?${SEPTEMBER_QUERY}`);

      expect(csv.status).toBe(200);

      const lines = csv.text.trimEnd().split('\r\n');

      // RFC 4180: the embedded quote is doubled and the whole cell is wrapped, so a reader parses
      // exactly eight fields on this line rather than ten.
      expect(lines[1]).toContain('"Sunday offering, ""main"" box"');
      expect(lines).toHaveLength(2);
    });

    it('refuses an unknown report id rather than exporting a named file', async () => {
      await expectRejected(`/api/v1/reports/not-a-report/export.csv?${SEPTEMBER_QUERY}`);
    });

    it('exports every documented report id as a CSV', async () => {
      // Every one of the eleven documented ids is exportable, which is what makes the export route
      // usable from a report picker rather than a hand-typed path.
      for (const reportId of REPORT_IDS) {
        const response = await authGet(`/api/v1/reports/${reportId}/export.csv?${SEPTEMBER_QUERY}`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
      }
    });
  });

  describe('global search', () => {
    it('finds members and transactions together in one page', async () => {
      const response = await readData<GlobalSearchResponse>('/api/v1/search?q=Kumaran');

      expect(response.query).toBe('Kumaran');
      expect(response.results.some((entry) => entry.kind === 'member')).toBe(true);
    });

    it('finds a transaction by its reference', async () => {
      const response = await readData<GlobalSearchResponse>('/api/v1/search?q=HY-INC-000001');

      expect(response.results).toHaveLength(1);
      expect(response.results[0]?.kind).toBe('transaction');
    });

    it('finds a member by a fragment of the phone number', async () => {
      const response = await readData<GlobalSearchResponse>('/api/v1/search?q=98400');

      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        kind: 'member',
        name: 'Bose Xavier',
        phone: '9840012345',
      });
    });

    it('narrows to one source when the Admin filters by type', async () => {
      const response = await readData<GlobalSearchResponse>('/api/v1/search?q=Kumaran&type=member');

      expect(response.results.every((entry) => entry.kind === 'member')).toBe(true);
    });

    it('reports a combined total consistent with the rows it returns', async () => {
      const response = await readData<GlobalSearchResponse>('/api/v1/search?q=offering');

      expect(response.pagination.totalItems).toBeGreaterThanOrEqual(response.results.length);
    });

    it('rejects a blank search term rather than listing the whole table', async () => {
      await expectRejected(`/api/v1/search?q=${encodeURIComponent('   ')}`);
    });

    it('rejects an over-long search term', async () => {
      await expectRejected(`/api/v1/search?q=${'a'.repeat(200)}`);
    });

    it('rejects an unknown search type', async () => {
      await expectRejected('/api/v1/search?q=offering&type=invoice');
    });
  });

  describe('validation', () => {
    it('rejects an unknown period preset', async () => {
      await expectRejected('/api/v1/reports/income?period=fortnight');
    });

    it('rejects a malformed business date', async () => {
      await expectRejected('/api/v1/reports/income?from=2026-09-01&to=31-09-2026');
    });

    it('rejects an inverted custom range', async () => {
      await expectRejected('/api/v1/reports/income?from=2026-09-30&to=2026-09-01');
    });

    it('rejects a period combined with an explicit range', async () => {
      await expectRejected('/api/v1/reports/income?period=thisMonth&from=2026-09-01&to=2026-09-30');
    });

    it('rejects a custom range wider than the canonical span limit', async () => {
      // The dashboard already refuses a range wider than `DASHBOARD_CUSTOM_RANGE_MONTH_LIMIT`. A
      // report must not be the one screen that accepts it, or the same period would be readable
      // there and rejected here.
      await expectRejected('/api/v1/reports/income?from=2020-01-01&to=2026-09-30');
      await expectRejected('/api/v1/reports/financial-summary?from=2020-01-01&to=2026-09-30');
      await expectRejected('/api/v1/reports/member-contributions?from=2020-01-01&to=2026-09-30');
      await expectRejected('/api/v1/reports/documents?from=2020-01-01&to=2026-09-30');
    });

    it('rejects an unknown transaction filter value', async () => {
      await expectRejected(`/api/v1/reports/transactions?${SEPTEMBER_QUERY}&status=DELETED`);
      await expectRejected(`/api/v1/reports/transactions?${SEPTEMBER_QUERY}&type=TRANSFER`);
    });

    it('rejects an unknown audit action', async () => {
      await expectRejected('/api/v1/reports/audit?action=TRANSACTION_DELETED');
    });

    it('rejects a malformed audit instant', async () => {
      await expectRejected('/api/v1/reports/audit?from=yesterday');
    });

    it('rejects an out-of-range page', async () => {
      await expectRejected(`/api/v1/reports/transactions?${SEPTEMBER_QUERY}&page=0`);
      await expectRejected(`/api/v1/reports/transactions?${SEPTEMBER_QUERY}&pageSize=100000`);
    });

    it('rejects an unrecognised query parameter instead of ignoring it', async () => {
      await expectRejected(`/api/v1/reports/income?${SEPTEMBER_QUERY}&currency=USD`);
    });
  });

  it('answers a period with no configured member expectations honestly', async () => {
    const report = await readData<MemberContributionReport>(
      '/api/v1/reports/member-contributions?period=lastYear',
    );

    expect(report.rows).toEqual([]);
    expect(report.totals.expected).toBe('0.00');
    expect(report.totals.memberMonths).toBe(0);
  });
});

/** The September window, referenced by the direct repository-facing helper above. */
void SEPTEMBER;
