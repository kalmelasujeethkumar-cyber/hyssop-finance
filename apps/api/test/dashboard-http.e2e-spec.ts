import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  isApiErrorBody,
  isApiSuccessEnvelope,
  isDashboardView,
  type ApiSuccessEnvelope,
  type ContributionMonthBucket,
  type DashboardTrendPoint,
  type DashboardView,
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
  type FakeMember,
  type FakePeriod,
} from './support/fake-ledger';
import {
  FakeReconciliation,
  memberCreatedAt,
  reconciliationLookups,
} from './support/fake-dashboard';

/**
 * HTTP-layer coverage for `GET /api/v1/dashboard`.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-DASH-001` to `REQ-DASH-018` and `REQ-FIN-014`;
 * transport from `docs/06-API-SPEC.md`. The real `DashboardController`, the real `DashboardQueryDto`
 * validation, the real `DashboardService`, the real canonical `period.resolver`, the real
 * `deriveContributionStatus`, the real global `SessionGuard`, and the real error filter are all
 * exercised.
 *
 * Only persistence is replaced, by the shared doubles in `test/support/`, so this suite runs with
 * no PostgreSQL and covers the transport contract: authentication, versioning, the documented
 * period resolution, the validation envelopes for an unknown preset, a malformed date, an inverted
 * range, an over-long span, and a preset/custom conflict, plus the exact-string money envelope.
 *
 * The financial *arithmetic* of the projection is deliberately not asserted here. It is proved
 * against real PostgreSQL by `test/database/dashboard-projection.db-spec.ts`, where the actual
 * `SUM`, `FILTER`, `EXTRACT`, `LEFT JOIN`, and `AT TIME ZONE` behaviour runs. Asserting invented
 * numbers against a double would only prove the double agrees with itself, so what is asserted
 * here is that the correct figures arrive intact, in the documented shape, over the wire.
 */

const SESSION_TOKEN = 'session-token-for-the-dashboard-route';
const CSRF_TOKEN = 'csrf-token-for-the-dashboard-route';

const MEMBER_ONE_ID = 'd1000000-0000-4000-8000-000000000001';
const MEMBER_TWO_ID = 'd1000000-0000-4000-8000-000000000002';
const MEMBER_THREE_ID = 'd1000000-0000-4000-8000-000000000003';

const PERIOD_ONE_ID = 'd2000000-0000-4000-8000-000000000001';
const PERIOD_TWO_ID = 'd2000000-0000-4000-8000-000000000002';

const CATEGORY_ID = 'd3000000-0000-4000-8000-000000000001';
const OTHER_CATEGORY_ID = 'd3000000-0000-4000-8000-000000000002';

const CONTRIBUTION = 'd4000000-0000-4000-8000-000000000001';
const OFFERING = 'd4000000-0000-4000-8000-000000000002';
const PARTIAL_CONTRIBUTION = 'd4000000-0000-4000-8000-000000000003';
const DONATION = 'd4000000-0000-4000-8000-000000000004';
const EXPENSE = 'd4000000-0000-4000-8000-000000000005';
const AUGUST_EXPENSE = 'd4000000-0000-4000-8000-000000000006';
const RECEIPTED_EXPENSE = 'd4000000-0000-4000-8000-000000000007';
const VOIDED_OFFERING = 'd4000000-0000-4000-8000-000000000008';

/** A stored paise count, exactly as the API would receive it. */
const DEFAULT_CONTRIBUTION_SETTING_PAISE = '50000';

describe('Dashboard HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;

  const members: readonly FakeMember[] = [
    { id: MEMBER_ONE_ID, referenceId: 'HY-MEM-0001', name: 'Anitha Kumaran' },
    { id: MEMBER_TWO_ID, referenceId: 'HY-MEM-0002', name: 'Bose Xavier' },
    { id: MEMBER_THREE_ID, referenceId: 'HY-MEM-0003', name: 'Deepa Rajan' },
  ];

  /**
   * Three members with different join dates, which is what makes the period-end boundary
   * observable: Anitha and Bose joined in January, Deepa joined in September. A September dashboard
   * must count all three, an August dashboard must count only two.
   */
  const memberCreatedAtById = new Map<string, Date>([
    [MEMBER_ONE_ID, memberCreatedAt('2026-01-05')],
    [MEMBER_TWO_ID, memberCreatedAt('2026-01-20')],
    [MEMBER_THREE_ID, memberCreatedAt('2026-09-12')],
  ]);

  /**
   * Two members have a September expectation, and the third has none — which is what makes the
   * `notConfigured` bucket observable over HTTP.
   */
  const periodRows: FakePeriod[] = [
    { id: PERIOD_ONE_ID, memberId: MEMBER_ONE_ID, year: 2026, month: 9, expectedPaise: 50_000n },
    { id: PERIOD_TWO_ID, memberId: MEMBER_TWO_ID, year: 2026, month: 9, expectedPaise: 50_000n },
  ];

  const categories: FakeCategory[] = [
    categoryFixture({ id: CATEGORY_ID, name: 'Cleaning supplies' }),
    categoryFixture({ id: OTHER_CATEGORY_ID, name: 'Electricity' }),
  ];

  let ledger: FakeLedger;

  beforeEach(async () => {
    ledger = new FakeLedger([
      transactionFixture({
        id: CONTRIBUTION,
        referenceId: 'HY-INC-000001',
        incomeType: 'MEMBER_CONTRIBUTION',
        amountPaise: 50_000n,
        businessDate: parseBusinessDate('2026-09-05'),
        description: 'September contribution',
        memberId: MEMBER_ONE_ID,
        contributionPeriodId: PERIOD_ONE_ID,
      }),
      transactionFixture({
        id: OFFERING,
        referenceId: 'HY-INC-000002',
        incomeType: 'OFFERING',
        amountPaise: 100_000n,
        paymentMethod: 'UPI',
        businessDate: parseBusinessDate('2026-09-06'),
        description: 'Sunday offering',
      }),
      transactionFixture({
        id: PARTIAL_CONTRIBUTION,
        referenceId: 'HY-INC-000003',
        incomeType: 'MEMBER_CONTRIBUTION',
        amountPaise: 20_000n,
        paymentMethod: 'UPI',
        businessDate: parseBusinessDate('2026-09-08'),
        description: 'Part payment',
        memberId: MEMBER_TWO_ID,
        contributionPeriodId: PERIOD_TWO_ID,
      }),
      transactionFixture({
        id: DONATION,
        referenceId: 'HY-INC-000004',
        incomeType: 'DONATION',
        amountPaise: 25_050n,
        paymentMethod: 'BANK_TRANSFER',
        businessDate: parseBusinessDate('2026-09-09'),
        description: 'Donation for the poor',
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
        categoryId: OTHER_CATEGORY_ID,
        documentCount: 1,
      }),
      transactionFixture({
        id: AUGUST_EXPENSE,
        referenceId: 'HY-EXP-000003',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 5_000n,
        businessDate: parseBusinessDate('2026-08-15'),
        description: 'August expense',
        categoryId: CATEGORY_ID,
      }),
      transactionFixture({
        id: VOIDED_OFFERING,
        referenceId: 'HY-INC-000005',
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
      // The dashboard reads the member repository through the same double the income routes use,
      // so a member created through an HTTP route would appear here too.
      .overrideProvider(MemberRepository)
      .useValue(new FakeMembers(members, memberCreatedAtById))
      .overrideProvider(ContributionPeriodRepository)
      .useValue(new FakePeriods(periodRows, ledger))
      .overrideProvider(AppSettingRepository)
      .useValue(
        new FakeSettings({
          DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_SETTING_PAISE,
        }),
      )
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
            ? fakeSession({ sessionId: 'session-dashboard', csrfToken: CSRF_TOKEN })
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

  /** An authenticated GET, which needs no CSRF header because it does not change state. */
  function authGet(url: string) {
    return request(httpServer(app))
      .get(url)
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
  }

  /**
   * Requests a dashboard and insists on the documented success envelope.
   *
   * Asserting the shape before returning means every test below can read `body.data` without
   * re-checking the transport, and `isDashboardView` failing here reports as "the route did not
   * answer with a dashboard" instead of a confusing property error later.
   */
  async function readDashboard(url: string): Promise<DashboardView> {
    const response = await authGet(url);

    expect(response.status).toBe(200);

    const body: unknown = response.body;
    expect(isApiSuccessEnvelope(body)).toBe(true);
    expect(isDashboardView((body as ApiSuccessEnvelope<DashboardView>).data)).toBe(true);

    return (body as ApiSuccessEnvelope<DashboardView>).data;
  }

  /**
   * The nth point of a trend, asserted present.
   *
   * The assertion is the point: an `undefined` subscript would otherwise throw deep inside a
   * `toEqual` diff, whereas here a missing month reports as "the September point is absent", which
   * is the actual failure `REQ-DASH-012` is about.
   */
  function trendPointAt(dashboard: DashboardView, index: number): DashboardTrendPoint {
    const point = dashboard.trend.at(index);

    expect(point).toBeDefined();

    return point as DashboardTrendPoint;
  }

  /** The nth month bucket, asserted present, for the same reason as {@link trendPointAt}. */
  function bucketAt(dashboard: DashboardView, index: number): ContributionMonthBucket {
    const bucket = dashboard.contributionStatus.months.at(index);

    expect(bucket).toBeDefined();

    return bucket as ContributionMonthBucket;
  }

  /**
   * The exact sum of a breakdown's two-decimal share strings.
   *
   * Added in `bigint` rather than with `parseFloat`, because `0.1 + 0.2 !== 0.3` is precisely the
   * artefact that would make a chart's labels fail to add up while the underlying paise are
   * correct. Multiplying by 100 turns each string into whole hundredths, so the addition is exact
   * and the result is compared as a string.
   */
  function sumOfShares(slices: readonly { readonly sharePercent: string }[]): string {
    const hundredths = slices.reduce((sum, slice) => {
      const [whole = '0', fractional = '00'] = slice.sharePercent.split('.');

      return sum + Number.parseInt(whole, 10) * 100 + Number.parseInt(fractional, 10);
    }, 0);

    return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
  }

  describe('authentication and versioning', () => {
    it('refuses the whole financial summary without a session (REQ-DASH-001)', async () => {
      const response = await request(httpServer(app)).get('/api/v1/dashboard');

      expect(response.status).toBe(401);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('refuses a session token the guard cannot resolve', async () => {
      const response = await request(httpServer(app))
        .get('/api/v1/dashboard')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=not-a-real-token`]);

      expect(response.status).toBe(401);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('answers the versioned route the API spec publishes', async () => {
      const response = await authGet('/api/v1/dashboard');

      expect(response.status).toBe(200);
    });

    it('does not expose the unversioned path', async () => {
      const response = await authGet('/dashboard');

      expect(response.status).toBe(404);
    });
  });

  describe('period resolution (REQ-DASH-016, REQ-DASH-017)', () => {
    it('defaults to this month when no filter is supplied', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard');

      expect(dashboard.period.preset).toBe('thisMonth');
    });

    it('reports the inclusive bounds and label it actually used', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?period=lastMonth');

      const month = new Date();
      const expectedTo = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 0));
      const expectedFrom = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));

      expect(dashboard.period.preset).toBe('lastMonth');
      expect(dashboard.period.from).toBe(expectedFrom.toISOString().slice(0, 10));
      expect(dashboard.period.to).toBe(expectedTo.toISOString().slice(0, 10));
      expect(dashboard.period.label).toBe('Last Month');
      expect(dashboard.period.timezone).toBe('Asia/Kolkata');
    });

    it('labels the balance projection as of the period end, not the period', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?period=lastMonth');

      expect(dashboard.balances.label).toBe('Available balance as of period end');
      expect(dashboard.balances.asOf).toBe(dashboard.period.to);
    });

    it('honours an explicit custom range', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-08-01&to=2026-09-30');

      expect(dashboard.period.preset).toBe('custom');
      expect(dashboard.period.from).toBe('2026-08-01');
      expect(dashboard.period.to).toBe('2026-09-30');
    });

    it('accepts a range that covers exactly one day', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-10&to=2026-09-10');

      expect(dashboard.period.from).toBe('2026-09-10');
      expect(dashboard.period.to).toBe('2026-09-10');
      expect(dashboard.trend).toHaveLength(1);
    });

    it('trims surrounding whitespace rather than rejecting a hand-copied filter', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?period=%20thisMonth%20');

      expect(dashboard.period.preset).toBe('thisMonth');
    });
  });

  describe('period validation', () => {
    it('rejects a period outside the documented preset list, naming the choices', async () => {
      const response = await authGet('/api/v1/dashboard?period=fiscalYear');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
      expect(JSON.stringify(response.body)).toContain('thisMonth');
    });

    it('rejects a custom range with only a start bound', async () => {
      const response = await authGet('/api/v1/dashboard?from=2026-08-01');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a custom range with only an end bound', async () => {
      const response = await authGet('/api/v1/dashboard?to=2026-09-30');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a malformed business date', async () => {
      const response = await authGet('/api/v1/dashboard?from=01-08-2026&to=2026-09-30');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a business date that does not exist', async () => {
      const response = await authGet('/api/v1/dashboard?from=2026-02-30&to=2026-03-05');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects an inverted range rather than silently swapping the bounds', async () => {
      const response = await authGet('/api/v1/dashboard?from=2026-09-30&to=2026-08-01');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a custom span longer than the documented limit', async () => {
      const response = await authGet('/api/v1/dashboard?from=2020-01-01&to=2026-09-30');

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a preset combined with an explicit range instead of picking one', async () => {
      const response = await authGet(
        '/api/v1/dashboard?period=thisMonth&from=2026-08-01&to=2026-09-30',
      );

      expect(response.status).toBe(400);
      expect(isApiErrorBody(response.body)).toBe(true);
    });
  });

  describe('the projection is complete and exact', () => {
    it('returns every documented section in one response', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      expect(dashboard.period.preset).toBe('custom');
      expect(dashboard.movement).toEqual({
        label: 'Period movement',
        income: '1950.50',
        expenses: '500.00',
        net: '1450.50',
      });
      expect(dashboard.balances).toEqual({
        label: 'Available balance as of period end',
        asOf: '2026-09-30',
        cash: '50.00',
        upi: '1200.00',
        bank: '150.50',
        total: '1400.50',
        cumulativeIncome: '1950.50',
        cumulativeExpenses: '550.00',
      });
      expect(dashboard.availableBalanceForPeriod).toBe('1450.50');
      expect(dashboard.comparison).toEqual({
        income: '1950.50',
        expenses: '500.00',
        movement: '1450.50',
      });
      expect(dashboard.memberCount).toBe(3);
      expect(dashboard.currency).toBe('INR');
      expect(dashboard.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports every amount as a two-decimal exact string, never a number', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      const amounts: readonly unknown[] = [
        dashboard.movement.income,
        dashboard.movement.expenses,
        dashboard.movement.net,
        dashboard.availableBalanceForPeriod,
        dashboard.balances.cash,
        dashboard.balances.upi,
        dashboard.balances.bank,
        dashboard.balances.total,
        dashboard.incomeBreakdown.total,
        dashboard.expenseBreakdown.total,
        ...dashboard.incomeBreakdown.slices.map((slice) => slice.amount),
        ...dashboard.expenseBreakdown.slices.map((slice) => slice.amount),
        ...dashboard.trend.map((point) => point.income),
        ...dashboard.trend.map((point) => point.expenses),
        ...dashboard.trend.map((point) => point.movement),
        ...dashboard.recentTransactions.map((row) => row.amount),
      ];

      for (const amount of amounts) {
        expect(typeof amount).toBe('string');
        expect(amount).toMatch(/^-?\d+\.\d{2}$/);
      }
    });

    it('separates the period movement from the cumulative balance (REQ-FIN-014)', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      // September income is 1950.50, but the church's cash on hand at the period end also carries
      // the 50.00 August expense and the August month is outside the movement — so the two
      // projections must not coincide.
      expect(dashboard.movement.net).toBe('1450.50');
      expect(dashboard.balances.total).toBe('1400.50');
      expect(dashboard.balances.total).not.toBe(dashboard.movement.net);
      expect(dashboard.balances.cumulativeExpenses).toBe('550.00');
    });

    it('excludes a voided row from every figure while keeping it out of the recent list', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      // The voided 300.00 offering is present in the ledger; including it would read 2250.50.
      expect(dashboard.movement.income).not.toBe('2250.50');
      expect(dashboard.movement.income).toBe('1950.50');
      expect(dashboard.recentTransactions.map((row) => row.id)).not.toContain(VOIDED_OFFERING);
    });

    it('keeps a negative method balance negative rather than clamping it (REQ-FIN-012)', async () => {
      const cashOnlyLedger = new FakeLedger([
        transactionFixture({
          id: 'd4000000-0000-4000-8000-0000000000a1',
          referenceId: 'HY-EXP-000090',
          transactionType: 'EXPENSE',
          incomeType: null,
          amountPaise: 25_000n,
          businessDate: parseBusinessDate('2026-09-02'),
          description: 'Paid before any income arrived',
          categoryId: CATEGORY_ID,
        }),
      ]);
      const app2 = await dashboardOnlyApp(cashOnlyLedger);

      try {
        const response = await request(httpServer(app2))
          .get('/api/v1/dashboard?from=2026-09-01&to=2026-09-30')
          .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);

        const body = response.body as ApiSuccessEnvelope<DashboardView>;

        expect(response.status).toBe(200);
        expect(body.data.balances.cash).toBe('-250.00');
        expect(body.data.balances.total).toBe('-250.00');
      } finally {
        await app2.close();
      }
    });

    it('produces a continuous monthly trend with explicit zero months (REQ-DASH-012)', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-07-01&to=2026-09-30');

      expect(dashboard.trend.map((point) => point.month)).toEqual([
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
      expect(trendPointAt(dashboard, 0)).toEqual({
        month: '2026-07',
        year: 2026,
        monthNumber: 7,
        income: '0.00',
        expenses: '0.00',
        movement: '0.00',
      });
      expect(trendPointAt(dashboard, 1).expenses).toBe('50.00');
    });

    it('reports shares that add up to exactly one hundred percent', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      expect(dashboard.incomeBreakdown.total).toBe('1950.50');
      expect(dashboard.incomeBreakdown.slices.length).toBeGreaterThan(1);
      expect(dashboard.expenseBreakdown.total).toBe('500.00');
      expect(dashboard.expenseBreakdown.slices.length).toBeGreaterThan(1);

      for (const breakdown of [dashboard.incomeBreakdown, dashboard.expenseBreakdown]) {
        expect(sumOfShares(breakdown.slices)).toBe('100.00');
      }
    });

    it('reports a single-slice breakdown as one hundred percent', async () => {
      // A month with only one kind of income has one slice, which must still read 100.00 rather
      // than an empty 0.00 from a divide that never ran.
      const ledger = new FakeLedger([
        transactionFixture({
          id: 'd4000000-0000-4000-8000-0000000000b1',
          referenceId: 'HY-INC-000091',
          incomeType: 'OFFERING',
          amountPaise: 50_000n,
          businessDate: parseBusinessDate('2026-09-04'),
          description: 'Only offering this month',
        }),
      ]);
      const app2 = await dashboardOnlyApp(ledger);

      try {
        const response = await request(httpServer(app2))
          .get('/api/v1/dashboard?from=2026-09-01&to=2026-09-30')
          .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
        const body = response.body as ApiSuccessEnvelope<DashboardView>;

        expect(body.data.incomeBreakdown.slices).toHaveLength(1);
        expect(body.data.incomeBreakdown.slices[0]?.sharePercent).toBe('100.00');
        expect(body.data.expenseBreakdown.slices).toEqual([]);
      } finally {
        await app2.close();
      }
    });

    it('reports every share as zero for a breakdown with no activity', async () => {
      const app2 = await dashboardOnlyApp(new FakeLedger([]));

      try {
        const response = await request(httpServer(app2))
          .get('/api/v1/dashboard?from=2026-09-01&to=2026-09-30')
          .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
        const body = response.body as ApiSuccessEnvelope<DashboardView>;

        // An empty breakdown has no slices to divide, and the total is an exact zero rather than
        // a division by zero or a null.
        expect(body.data.expenseBreakdown.total).toBe('0.00');
        expect(body.data.expenseBreakdown.slices).toEqual([]);
        expect(body.data.incomeBreakdown.slices).toEqual([]);
      } finally {
        await app2.close();
      }
    });

    it('flags an Admin-entered expense category as a custom label and a closed enum as not', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      const expenseSlice = dashboard.expenseBreakdown.slices.find(
        (slice) => slice.label === 'Cleaning supplies',
      );
      const incomeSlice = dashboard.incomeBreakdown.slices.find(
        (slice) => slice.label === 'OFFERING',
      );

      expect(expenseSlice).toMatchObject({ label: 'Cleaning supplies', customLabel: true });
      expect(incomeSlice).toMatchObject({ label: 'OFFERING', customLabel: false });
    });

    it('counts members as of the period end, not as of today (REQ-DASH-004)', async () => {
      const september = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');
      const august = await readDashboard('/api/v1/dashboard?from=2026-08-01&to=2026-08-31');

      // Deepa joined on 12 September, so she is in the September denominator but not August's.
      expect(september.memberCount).toBe(3);
      expect(august.memberCount).toBe(2);
    });

    it('counts a member created late on the period-end date in Asia/Kolkata', async () => {
      // 19:00 UTC on the 30th is already 00:30 on the 1st in Kolkata, so a member created then
      // must NOT be counted for a 30 September period end; 18:29 UTC is still the 30th in Kolkata.
      const ledger = new FakeLedger([]);
      const app2 = await dashboardOnlyApp(
        ledger,
        new Map([
          [MEMBER_ONE_ID, new Date('2026-09-30T19:00:00.000Z')],
          [MEMBER_TWO_ID, new Date('2026-09-30T18:29:00.000Z')],
          // Pinned after the period end so this test measures only the boundary, not the third
          // member's ordinary September join date from the suite fixture.
          [MEMBER_THREE_ID, new Date('2026-11-01T04:00:00.000Z')],
        ]),
      );

      try {
        const response = await request(httpServer(app2))
          .get('/api/v1/dashboard?from=2026-09-01&to=2026-09-30')
          .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
        const body = response.body as ApiSuccessEnvelope<DashboardView>;

        expect(body.data.memberCount).toBe(1);
      } finally {
        await app2.close();
      }
    });

    it('reports a member with no expected period as not configured, not unpaid (REQ-CONTRIB-006)', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      expect(dashboard.contributionStatus.months).toHaveLength(1);

      const september = bucketAt(dashboard, 0);
      const totals = dashboard.contributionStatus.totals;

      expect(september.month).toBe('2026-09');
      expect(september.counts.membersByMonthEnd).toBe(3);
      // One paid, one partial, nobody unpaid, and Deepa has no expectation for September.
      expect(september.counts).toMatchObject({
        paid: 1,
        partiallyPaid: 1,
        notPaid: 0,
        notConfigured: 1,
        configured: 2,
        membersByMonthEnd: 3,
      });
      expect(totals.notPaid).toBe(0);
      expect(totals.notConfigured).toBe(1);
    });

    it('counts the members who existed before the period as this month’s denominator', async () => {
      const september = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');
      const july = await readDashboard('/api/v1/dashboard?from=2026-07-01&to=2026-07-31');

      // July predates Deepa's September join, so her September "not configured" count must not
      // appear in July's.
      expect(bucketAt(july, 0).counts.membersByMonthEnd).toBe(2);
      expect(bucketAt(september, 0).counts.membersByMonthEnd).toBe(3);
    });

    it('bounds the recent list, newest first, and reports the row count (REQ-DASH-013)', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      expect(dashboard.recentTransactions.length).toBeGreaterThan(0);
      expect(dashboard.recentTransactionCount).toBe(dashboard.recentTransactions.length);

      const dates = dashboard.recentTransactions.map((row) => row.businessDate);

      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it('offers a receipt only for a row that has one', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      const withReceipt = dashboard.recentTransactions.find((row) => row.id === RECEIPTED_EXPENSE);
      const withoutReceipt = dashboard.recentTransactions.find((row) => row.id === EXPENSE);

      expect(withReceipt).toMatchObject({ hasReceipt: true, categoryName: 'Electricity' });
      expect(withoutReceipt).toMatchObject({
        hasReceipt: false,
        categoryName: 'Cleaning supplies',
      });
    });

    it('carries the human labels the recent rows display', async () => {
      const dashboard = await readDashboard('/api/v1/dashboard?from=2026-09-01&to=2026-09-30');

      const contribution = dashboard.recentTransactions.find((row) => row.id === CONTRIBUTION);

      expect(contribution).toMatchObject({
        referenceId: 'HY-INC-000001',
        type: 'INCOME',
        amount: '500.00',
        paymentMethod: 'CASH',
        businessDate: '2026-09-05',
        description: 'September contribution',
        incomeType: 'MEMBER_CONTRIBUTION',
        memberName: 'Anitha Kumaran',
        active: true,
      });
    });
  });

  describe('an empty church is not an error', () => {
    it('answers a zeroed projection rather than a 404 or a null', async () => {
      const app2 = await dashboardOnlyApp(new FakeLedger([]));

      try {
        const response = await request(httpServer(app2))
          .get('/api/v1/dashboard?from=2026-09-01&to=2026-09-30')
          .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);

        expect(response.status).toBe(200);

        const body = response.body as ApiSuccessEnvelope<DashboardView>;

        expect(body.data.movement.income).toBe('0.00');
        expect(body.data.movement.net).toBe('0.00');
        expect(body.data.balances.total).toBe('0.00');
        expect(body.data.recentTransactions).toEqual([]);
        expect(body.data.recentTransactionCount).toBe(0);
        expect(body.data.memberCount).toBe(3);
      } finally {
        await app2.close();
      }
    });
  });

  /**
   * A second application over its own ledger, for the cases that need a different ledger than the
   * suite's shared one.
   *
   * Built the same way as the main `beforeEach` — real service, real resolver, real guard, real
   * validation — because a test that proved the projection with a different wiring would not be
   * evidence about the route that ships.
   */
  async function dashboardOnlyApp(
    ledger: FakeLedger,
    createdAtById: ReadonlyMap<string, Date> = memberCreatedAtById,
  ): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(TransactionRepository)
      .useValue(new FakeTransactions(ledger, members, periodRows, categories))
      .overrideProvider(AuditEventRepository)
      .useValue(new FakeAudit(ledger))
      .overrideProvider(MemberRepository)
      .useValue(new FakeMembers(members, createdAtById))
      .overrideProvider(ContributionPeriodRepository)
      .useValue(new FakePeriods(periodRows, ledger))
      .overrideProvider(AppSettingRepository)
      .useValue(
        new FakeSettings({
          DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_SETTING_PAISE,
        }),
      )
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
            ? fakeSession({ sessionId: 'session-dashboard', csrfToken: CSRF_TOKEN })
            : null,
      })
      .compile();

    const built = moduleRef.createNestApplication({ logger: false });
    configureApp(built, TEST_ENVIRONMENT);
    await built.init();

    return built;
  }
});
