import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ANONYMOUS_DONATION_DESCRIPTION,
  APPLICATION_NAME,
  CSRF_TOKEN_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  TRANSACTION_PAGE_SIZE_MAX,
  isApiErrorBody,
  isApiListEnvelope,
  isApiSuccessEnvelope,
  type ApiListEnvelope,
  type ApiSuccessEnvelope,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionSummary,
} from '@hyssop/contracts';
import request, { agent, type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { parseBusinessDate } from '../src/common/time/business-date';
import { SessionService } from '../src/auth/session.service';
import { AuditEventRepository } from '../src/database/audit/audit-event.repository';
import { IdempotencyRecordRepository } from '../src/database/idempotency/idempotency-record.repository';
import { MemberRepository } from '../src/database/members/member.repository';
import { ContributionPeriodRepository } from '../src/database/contributions/contribution-period.repository';
import { AppSettingRepository } from '../src/database/settings/app-setting.repository';
import { ExpenseCategoryRepository } from '../src/database/categories/expense-category.repository';
import { TransactionRepository } from '../src/database/transactions/transaction.repository';
import {
  applyTestProcessEnvironment,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
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
  TEST_ACTOR_ADMIN_ID as ADMIN_ID,
  TEST_ACTOR_DISPLAY_NAME as ADMIN_DISPLAY_NAME,
  transactionFixture,
  type FakeCategory,
  type FakeMember,
  type FakePeriod,
} from './support/fake-ledger';

/**
 * HTTP-layer coverage for the income route and the shared transaction routes behind it.
 *
 * The real `IncomeService`, the real `TransactionsService`, the real controllers, the real DTO
 * validation, the real `SessionGuard`, the real idempotency runner, and the real error filter
 * are all exercised. Only persistence is replaced with in-memory fakes, so these tests run
 * with no PostgreSQL and still prove the transport contract: routing, authentication, CSRF,
 * idempotency, `If-Match` parsing, exact money parsing, the income-type rules, anonymous
 * privacy, the documented error envelopes, and the read/audit/receipt projections.
 *
 * The doubles are shared with the expense suite through `test/support/fake-ledger.ts`, so the
 * two suites cannot disagree about what the repository rules are: a *second* copy of the same
 * double is how a rule starts to pass in one route and fail in the other. What each double
 * mirrors is the rule of the repository it stands in for — the exact-paise amounts, the
 * `HY-INC-`/`HY-EXP-` reference allocation, the `search` haystack that deliberately excludes
 * `notes`, the status and revision guards, the category lifecycle, and the audit snapshot keys.
 * A double that answered more permissively than production would make these tests pass for the
 * wrong reason.
 *
 * The behaviour that genuinely needs a database — reference allocation under concurrency, the
 * unique `(member_id, year, month)` race, CHECK constraints, triggers, grants, and
 * least-privilege behaviour — is covered by `test/database/*.db-spec.ts` instead. Nothing here
 * claims to prove persistence.
 */

const SESSION_TOKEN = 'session-token-for-income-routes';
const CSRF_TOKEN = 'csrf-token-for-income-routes';

const MEMBER_ONE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_TWO_ID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_MEMBER_ID = '99999999-9999-4999-8999-999999999999';
const PERIOD_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_TWO_ID = '44444444-4444-4444-8444-444444444444';
const CATEGORY_ID = '55555555-5555-4555-8555-555555555555';
const INACTIVE_CATEGORY_ID = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_TRANSACTION_ID = '66666666-6666-4666-8666-666666666666';

/** The transaction fixtures, addressed by these stable local names. */
const CONTRIBUTION = 'a1111111-1111-4111-8111-111111111111';
const OFFERING = 'a2222222-2222-4222-8222-222222222222';
const DONATION = 'a3333333-3333-4333-8333-333333333333';
const ANONYMOUS = 'a4444444-4444-4444-8444-444444444444';
const VOIDED_OFFERING = 'a5555555-5555-4555-8555-555555555555';
const EXPENSE = 'a6666666-6666-4666-8666-666666666666';

/** A human reference is not a UUID, so it must be rejected as malformed rather than "missing". */
const NOT_A_UUID = 'HY-INC-000001';

/** A stored paise count, exactly as the API would receive it. */
const DEFAULT_CONTRIBUTION_SETTING_PAISE = '50000';

describe('Income and transaction HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;
  let ledger: FakeLedger;
  let transactions: FakeTransactions;
  let periods: FakePeriods;
  let idempotency: FakeIdempotency;

  const members: readonly FakeMember[] = [
    { id: MEMBER_ONE_ID, referenceId: 'HY-MEM-0001', name: 'Anitha Kumaran' },
    { id: MEMBER_TWO_ID, referenceId: 'HY-MEM-0002', name: 'Bose Xavier' },
  ];

  const periodRows: FakePeriod[] = [
    { id: PERIOD_ID, memberId: MEMBER_ONE_ID, year: 2026, month: 9, expectedPaise: 50_000n },
    { id: PERIOD_TWO_ID, memberId: MEMBER_TWO_ID, year: 2026, month: 9, expectedPaise: 50_000n },
  ];

  const categories: FakeCategory[] = [
    categoryFixture({ id: CATEGORY_ID, name: 'Cleaning' }),
    categoryFixture({ id: INACTIVE_CATEGORY_ID, name: 'Retired category', status: 'INACTIVE' }),
  ];

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
        contributionPeriodId: PERIOD_ID,
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
        id: DONATION,
        referenceId: 'HY-INC-000003',
        incomeType: 'DONATION',
        amountPaise: 25_050n,
        paymentMethod: 'BANK_TRANSFER',
        businessDate: parseBusinessDate('2026-08-20'),
        description: 'Donation for the poor',
        notes: 'Donor asked us to keep this private',
        memberId: MEMBER_TWO_ID,
      }),
      transactionFixture({
        id: ANONYMOUS,
        referenceId: 'HY-INC-000004',
        incomeType: 'ANONYMOUS_DONATION',
        amountPaise: 7_500n,
        businessDate: parseBusinessDate('2026-08-21'),
        description: ANONYMOUS_DONATION_DESCRIPTION,
      }),
      transactionFixture({
        id: VOIDED_OFFERING,
        referenceId: 'HY-INC-000005',
        incomeType: 'OFFERING',
        amountPaise: 30_000n,
        businessDate: parseBusinessDate('2026-09-05'),
        description: 'Voided duplicate offering',
        status: 'VOIDED',
        voidReason: 'Recorded twice by mistake',
        voidedAt: new Date('2026-09-07T06:00:00.000Z'),
        revision: 2,
      }),
      transactionFixture({
        id: EXPENSE,
        referenceId: 'HY-EXP-000001',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 40_000n,
        businessDate: parseBusinessDate('2026-09-07'),
        description: 'Cleaning supplies',
        categoryId: CATEGORY_ID,
      }),
    ]);

    transactions = new FakeTransactions(ledger, members, periodRows, categories);
    periods = new FakePeriods(periodRows);
    idempotency = new FakeIdempotency();

    restoreEnvironment = applyTestProcessEnvironment();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(TransactionRepository)
      .useValue(transactions)
      .overrideProvider(AuditEventRepository)
      .useValue(new FakeAudit(ledger))
      .overrideProvider(MemberRepository)
      .useValue(new FakeMembers(members))
      .overrideProvider(ContributionPeriodRepository)
      .useValue(periods)
      .overrideProvider(AppSettingRepository)
      .useValue(
        new FakeSettings({
          DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_SETTING_PAISE,
        }),
      )
      .overrideProvider(ExpenseCategoryRepository)
      .useValue(new FakeCategories(categories))
      .overrideProvider(IdempotencyRecordRepository)
      .useValue(idempotency)
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN
            ? fakeSession({ sessionId: 'session-income', csrfToken: CSRF_TOKEN })
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
   * The same request with the session, trusted origin, and CSRF token already applied.
   *
   * A supertest agent is required rather than the bare `request(app)` factory: only an agent
   * carries default headers, and those three are exactly the defaults every state change in
   * this file needs.
   */
  function authed() {
    return agent(httpServer(app))
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_TOKEN_HEADER, CSRF_TOKEN);
  }

  function createIncome(key: string, body: Record<string, unknown>) {
    return authed().post('/api/v1/income').set(IDEMPOTENCY_KEY_HEADER, key).send(body);
  }

  function correctTransaction(
    key: string,
    id: string,
    ifMatch: string,
    body: Record<string, unknown>,
  ) {
    return authed()
      .patch(`/api/v1/transactions/${id}`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .set('If-Match', ifMatch)
      .send(body);
  }

  function voidTransaction(key: string, id: string, body: Record<string, unknown>) {
    return authed()
      .post(`/api/v1/transactions/${id}/void`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body);
  }

  /** A valid member-contribution body, with per-test overrides. */
  function contributionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      incomeType: 'MEMBER_CONTRIBUTION',
      amount: '500.00',
      paymentMethod: 'CASH',
      businessDate: '2026-09-05',
      memberId: MEMBER_ONE_ID,
      contributionPeriod: { year: 2026, month: 9 },
      ...overrides,
    };
  }

  /** Asserts the documented error envelope, optionally naming the offending field. */
  function expectApiError(response: Response, status: number, code: string, field?: string): void {
    expect(response.status).toBe(status);
    expect(isApiErrorBody(response.body)).toBe(true);

    if (!isApiErrorBody(response.body)) {
      return;
    }

    expect(response.body.error.code).toBe(code);
    // Every rejection carries the request id, so a report can be traced to one request.
    expect(typeof response.body.error.requestId).toBe('string');

    if (field !== undefined) {
      expect(response.body.error.fields?.map((issue) => issue.field)).toContain(field);
    }
  }

  function dataOf<TData>(body: unknown): TData {
    expect(isApiSuccessEnvelope(body)).toBe(true);

    return (body as ApiSuccessEnvelope<TData>).data;
  }

  function listOf<TItem>(body: unknown): ApiListEnvelope<TItem> {
    expect(isApiListEnvelope(body)).toBe(true);

    return body as ApiListEnvelope<TItem>;
  }

  describe('authentication and CSRF', () => {
    it('refuses every transaction read route without a session', async () => {
      for (const url of [
        '/api/v1/transactions',
        `/api/v1/transactions/${CONTRIBUTION}`,
        `/api/v1/transactions/${CONTRIBUTION}/audit`,
        `/api/v1/transactions/${CONTRIBUTION}/receipt`,
      ]) {
        const response = await request(httpServer(app)).get(url);

        expectApiError(response, 401, 'UNAUTHENTICATED');
      }
    });

    it('refuses an income create without a session, before it looks at the body', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/income')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-create-1')
        .send(contributionBody());

      expectApiError(response, 401, 'UNAUTHENTICATED');
    });

    it('refuses an income create with a session but no CSRF header', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/income')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(IDEMPOTENCY_KEY_HEADER, 'csrf-missing-header')
        .send(contributionBody());

      expectApiError(response, 403, 'CSRF_FAILED');
    });

    it('refuses an income create from an untrusted origin even with a valid session', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/income')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', 'https://elsewhere.example')
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'untrusted-origin-1')
        .send(contributionBody());

      expectApiError(response, 403, 'FORBIDDEN');
    });

    it('refuses a transaction correction and a void without a session', async () => {
      const correction = await request(httpServer(app))
        .patch(`/api/v1/transactions/${OFFERING}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set('If-Match', '1')
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-correct-1')
        .send({ amount: '900.00' });
      const voided = await request(httpServer(app))
        .post(`/api/v1/transactions/${OFFERING}/void`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-void-1')
        .send({ reason: 'No session' });

      expectApiError(correction, 401, 'UNAUTHENTICATED');
      expectApiError(voided, 401, 'UNAUTHENTICATED');
    });

    it('refuses a state change whose CSRF token does not match the session', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/income')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, 'not-the-session-token')
        .set(IDEMPOTENCY_KEY_HEADER, 'csrf-wrong-token')
        .send(contributionBody());

      expectApiError(response, 403, 'CSRF_FAILED');
    });
  });

  describe('POST /api/v1/income', () => {
    it('records a member contribution and answers the documented envelope', async () => {
      const response = await createIncome('income-create-1', contributionBody());

      expect(response.status).toBe(201);

      const created = dataOf<TransactionSummary>(response.body);

      expect(created).toMatchObject({
        type: 'INCOME',
        incomeType: 'MEMBER_CONTRIBUTION',
        amount: '500.00',
        currency: 'INR',
        paymentMethod: 'CASH',
        status: 'ACTIVE',
        businessDate: '2026-09-05',
        member: { id: MEMBER_ONE_ID, referenceId: 'HY-MEM-0001', name: 'Anitha Kumaran' },
        contributionPeriod: { id: PERIOD_ID, year: 2026, month: 9 },
        category: null,
        voidReason: null,
        voidedAt: null,
        revision: 1,
        documentCount: 0,
      });
      // The reference is server-allocated in the `HY-INC-` series, never client-supplied.
      expect(created.referenceId).toMatch(/^HY-INC-\d{6}$/);
      expect(created.id).toEqual(expect.any(String));
    });

    it('derives the recorded instant from the Asia/Kolkata start of that business day', async () => {
      await createIncome(
        'income-occurred-1',
        contributionBody({ businessDate: '2026-09-25' }),
      ).expect(201);

      const stored = transactions.createCalls[0];

      expect(stored).toBeDefined();
      expect(stored?.input.businessDate.toISOString()).toBe('2026-09-25T00:00:00.000Z');
      // 05:30 IST is 18:30 UTC the day before, so the record falls inside the business day it
      // claims rather than being shifted by a server-timezone conversion.
      expect(stored?.input.occurredAt.toISOString()).toBe('2026-09-24T18:30:00.000Z');
    });

    it('attributes the create to the authenticated Admin and the request id', async () => {
      await createIncome('income-actor-1', contributionBody()).expect(201);

      const stored = transactions.createCalls[0];

      expect(stored?.context.actorAdminId).toBe(ADMIN_ID);
      expect(typeof stored?.context.requestId).toBe('string');
    });

    it('requires an Idempotency-Key rather than generating one server-side', async () => {
      const response = await authed().post('/api/v1/income').send(contributionBody());

      expectApiError(response, 400, 'VALIDATION_FAILED', 'idempotency-key');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('rejects an over-long or unprintable Idempotency-Key', async () => {
      const tooLong = await createIncome(
        'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
        contributionBody(),
      );
      const spaced = await createIncome('has a space', contributionBody());

      expectApiError(tooLong, 400, 'VALIDATION_FAILED', 'idempotency-key');
      expectApiError(spaced, 400, 'VALIDATION_FAILED', 'idempotency-key');
    });

    it('replays the original record when the same key and payload are sent twice', async () => {
      const first = await createIncome(
        'income-retry-1',
        contributionBody({ amount: '750.25' }),
      ).expect(201);
      const second = await createIncome(
        'income-retry-1',
        contributionBody({ amount: '750.25' }),
      ).expect(201);

      expect(dataOf<TransactionSummary>(second.body).id).toBe(
        dataOf<TransactionSummary>(first.body).id,
      );
      // One contribution, not two. This is the duplicate the requirement exists to prevent.
      expect(transactions.createCalls).toHaveLength(1);
    });

    it('rejects the same key reused with a different payload instead of creating a second record', async () => {
      await createIncome('income-reuse-1', contributionBody({ amount: '500.00' })).expect(201);
      const response = await createIncome('income-reuse-1', contributionBody({ amount: '900.00' }));

      expectApiError(response, 409, 'CONFLICT', 'idempotencyKey');
      expect(transactions.createCalls).toHaveLength(1);
    });

    it('rejects a body that tries to set an immutable or unknown field', async () => {
      const response = await createIncome(
        'income-immutable-1',
        contributionBody({ referenceId: 'HY-INC-999999' }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('rejects an income type outside the documented set', async () => {
      const response = await createIncome(
        'income-unknown-type',
        contributionBody({ incomeType: 'PLEDGE' }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
    });

    it('rejects an amount that is not an exact decimal rupee value', async () => {
      for (const amount of ['1,000', '10.005', '1e3', '-500', 'five hundred']) {
        const response = await createIncome(
          `income-amount-${amount}`,
          contributionBody({ amount }),
        );

        expectApiError(response, 400, 'VALIDATION_FAILED', 'amount');
      }

      expect(transactions.createCalls).toHaveLength(0);
    });

    it('rejects a zero amount, which would be a meaningless financial record', async () => {
      const response = await createIncome('income-zero-amount', contributionBody({ amount: '0' }));

      expectApiError(response, 400, 'VALIDATION_FAILED', 'amount');
    });

    it('keeps paise exactly, including a one-paise amount', async () => {
      const response = await createIncome(
        'income-one-paise',
        contributionBody({ amount: '0.01' }),
      ).expect(201);

      expect(dataOf<TransactionSummary>(response.body).amount).toBe('0.01');
    });

    it('rejects a business date that is not a real calendar date', async () => {
      const malformed = await createIncome(
        'income-bad-date-1',
        contributionBody({ businessDate: '05-09-2026' }),
      );
      const impossible = await createIncome(
        'income-bad-date-2',
        contributionBody({ businessDate: '2026-02-30' }),
      );

      expectApiError(malformed, 400, 'VALIDATION_FAILED', 'businessDate');
      expectApiError(impossible, 400, 'VALIDATION_FAILED', 'businessDate');
    });

    it('requires a member and a contribution month for a member contribution', async () => {
      const noMember = await createIncome(
        'income-no-member',
        contributionBody({ memberId: undefined }),
      );
      const noPeriod = await createIncome(
        'income-no-period',
        contributionBody({ contributionPeriod: undefined }),
      );
      const noMonth = await createIncome(
        'income-no-month',
        contributionBody({ contributionPeriod: {} }),
      );

      expectApiError(noMember, 400, 'VALIDATION_FAILED', 'memberId');
      expectApiError(noPeriod, 400, 'VALIDATION_FAILED');
      expectApiError(noMonth, 400, 'VALIDATION_FAILED');
    });

    it('rejects a contribution month outside the calendar', async () => {
      const response = await createIncome(
        'income-month-13',
        contributionBody({ contributionPeriod: { year: 2026, month: 13 } }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
    });

    it('answers a documented 404 for an unknown member instead of a server error', async () => {
      const response = await createIncome(
        'income-unknown-member-1',
        contributionBody({ memberId: UNKNOWN_MEMBER_ID }),
      );

      expectApiError(response, 404, 'NOT_FOUND');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('opens the member-month at the configured expectation, not at the amount received', async () => {
      // A member-month the fixture does not already contain, so this genuinely opens one.
      await createIncome(
        'income-period-1',
        contributionBody({
          memberId: MEMBER_TWO_ID,
          amount: '750.00',
          contributionPeriod: { year: 2026, month: 10 },
        }),
      ).expect(201);

      // Using the payment would mark every month "Paid" on the first payment.
      expect(periods.opened).toEqual([
        { memberId: MEMBER_TWO_ID, year: 2026, month: 10, expectedPaise: 50_000n },
      ]);
      // The opened period belongs to the Admin who recorded the contribution.
      expect(periods.actors).toEqual([ADMIN_ID]);
    });

    it('reuses an existing member-month instead of opening a second one', async () => {
      await createIncome('income-period-2', contributionBody()).expect(201);

      // Two periods for one member-month would make the derived contribution status ambiguous.
      expect(periods.opened).toEqual([]);
    });

    it('records an offering without a member and without a contribution month', async () => {
      const response = await createIncome('income-offering-1', {
        incomeType: 'OFFERING',
        amount: '1200',
        paymentMethod: 'UPI',
        businessDate: '2026-09-06',
        description: 'Sunday offering',
      }).expect(201);

      const created = dataOf<TransactionSummary>(response.body);

      expect(created.member).toBeNull();
      expect(created.contributionPeriod).toBeNull();
      expect(created.amount).toBe('1200.00');
      expect(periods.opened).toEqual([]);
    });

    it('lets an offering or donation name a member', async () => {
      const response = await createIncome('income-donation-with-member', {
        incomeType: 'DONATION',
        amount: '250.50',
        paymentMethod: 'BANK_TRANSFER',
        businessDate: '2026-09-07',
        memberId: MEMBER_TWO_ID,
      }).expect(201);

      expect(dataOf<TransactionSummary>(response.body).member).toMatchObject({
        id: MEMBER_TWO_ID,
        name: 'Bose Xavier',
      });
    });

    it('refuses a contribution month on anything but a member contribution', async () => {
      const response = await createIncome('income-offering-with-period', {
        incomeType: 'OFFERING',
        amount: '500',
        paymentMethod: 'CASH',
        businessDate: '2026-09-06',
        contributionPeriod: { year: 2026, month: 9 },
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'contributionPeriod');
    });

    it('refuses a member, a period, or a note on an anonymous donation', async () => {
      const withMember = await createIncome('income-anonymous-member', {
        incomeType: 'ANONYMOUS_DONATION',
        amount: '100',
        paymentMethod: 'CASH',
        businessDate: '2026-09-06',
        memberId: MEMBER_ONE_ID,
      });
      const withPeriod = await createIncome('income-anonymous-period', {
        incomeType: 'ANONYMOUS_DONATION',
        amount: '100',
        paymentMethod: 'CASH',
        businessDate: '2026-09-06',
        contributionPeriod: { year: 2026, month: 9 },
      });
      const withNote = await createIncome('income-anonymous-note', {
        incomeType: 'ANONYMOUS_DONATION',
        amount: '100',
        paymentMethod: 'CASH',
        businessDate: '2026-09-06',
        notes: 'Donor asked us to keep this private',
      });

      expectApiError(withMember, 400, 'VALIDATION_FAILED', 'memberId');
      expectApiError(withPeriod, 400, 'VALIDATION_FAILED', 'contributionPeriod');
      expectApiError(withNote, 400, 'VALIDATION_FAILED', 'notes');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('replaces an anonymous donation description with the server-owned neutral value', async () => {
      const response = await createIncome('income-anonymous-description', {
        incomeType: 'ANONYMOUS_DONATION',
        amount: '75.00',
        paymentMethod: 'CASH',
        businessDate: '2026-08-21',
        // A name typed into the description box must not be stored.
        description: 'From Mrs Grace Kumaran',
      }).expect(201);

      const created = dataOf<TransactionSummary>(response.body);

      expect(created.description).toBe(ANONYMOUS_DONATION_DESCRIPTION);
      expect(created.member).toBeNull();
      expect(created.notes).toBeNull();
      expect(transactions.createCalls[0]?.input.description).toBe(ANONYMOUS_DONATION_DESCRIPTION);
    });

    it('trims surrounding whitespace on the amount and date it honours', async () => {
      await createIncome(
        'income-trimmed',
        contributionBody({ amount: ' 500.00 ', businessDate: ' 2026-09-05 ' }),
      ).expect(201);

      const stored = transactions.createCalls[0];

      expect(stored?.input.amountPaise).toBe(50_000n);
      expect(stored?.input.businessDate.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    });

    it('keeps a private note on a named contribution', async () => {
      const response = await createIncome(
        'income-with-note',
        contributionBody({ notes: 'Paid in cash at the door' }),
      ).expect(201);

      expect(dataOf<TransactionSummary>(response.body).notes).toBe('Paid in cash at the door');
    });
  });

  describe('GET /api/v1/transactions', () => {
    it('returns the documented list envelope with the voided record included', async () => {
      const response = await authGet('/api/v1/transactions').expect(200);
      const envelope = listOf<TransactionSummary>(response.body);

      expect(envelope.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 6, totalPages: 1 });
      // A voided record stays in the list because void is a state, not a deletion.
      expect(envelope.data.map((row) => row.referenceId)).toContain('HY-INC-000005');
    });

    it('defaults to the newest business date first', async () => {
      const response = await authGet('/api/v1/transactions').expect(200);
      const dates = listOf<TransactionSummary>(response.body).data.map((row) => row.businessDate);

      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('narrows to income with the documented type filter and excludes the expense', async () => {
      const response = await authGet('/api/v1/transactions?type=INCOME').expect(200);
      const envelope = listOf<TransactionSummary>(response.body);

      expect(envelope.pagination.totalItems).toBe(5);
      expect(envelope.data.every((row) => row.type === 'INCOME')).toBe(true);
      expect(envelope.data.map((row) => row.referenceId)).not.toContain('HY-EXP-000001');
    });

    it('narrows to one income type', async () => {
      const response = await authGet(
        '/api/v1/transactions?type=INCOME&incomeType=MEMBER_CONTRIBUTION',
      ).expect(200);
      const envelope = listOf<TransactionSummary>(response.body);

      expect(envelope.pagination.totalItems).toBe(1);
      expect(envelope.data[0]?.referenceId).toBe('HY-INC-000001');
    });

    it('finds a record by reference, description, and member name', async () => {
      for (const search of ['HY-INC-000002', 'Sunday', 'Anitha', 'HY-MEM-0001']) {
        const response = await authGet(
          `/api/v1/transactions?type=INCOME&search=${encodeURIComponent(search)}`,
        ).expect(200);

        expect(listOf<TransactionSummary>(response.body).pagination.totalItems).toBeGreaterThan(0);
      }
    });

    it('never matches a private note, so a note cannot become a searchable identity', async () => {
      const response = await authGet('/api/v1/transactions?type=INCOME&search=private').expect(200);

      expect(listOf<TransactionSummary>(response.body).pagination.totalItems).toBe(0);
    });

    it('treats an empty search box as no filter at all', async () => {
      const response = await authGet('/api/v1/transactions?type=INCOME&search=').expect(200);

      expect(listOf<TransactionSummary>(response.body).pagination.totalItems).toBe(5);
    });

    it('filters by status, so the active ledger and the voided history differ', async () => {
      const active = await authGet('/api/v1/transactions?type=INCOME&status=ACTIVE').expect(200);
      const voided = await authGet('/api/v1/transactions?type=INCOME&status=VOIDED').expect(200);

      expect(listOf<TransactionSummary>(active.body).pagination.totalItems).toBe(4);
      expect(listOf<TransactionSummary>(voided.body).pagination.totalItems).toBe(1);
      expect(listOf<TransactionSummary>(voided.body).data[0]?.voidReason).toBe(
        'Recorded twice by mistake',
      );
    });

    it('filters by payment method and by member', async () => {
      const cash = await authGet('/api/v1/transactions?type=INCOME&paymentMethod=CASH').expect(200);
      const byMember = await authGet(
        `/api/v1/transactions?type=INCOME&memberId=${MEMBER_TWO_ID}`,
      ).expect(200);

      expect(listOf<TransactionSummary>(cash.body).pagination.totalItems).toBe(3);
      expect(listOf<TransactionSummary>(byMember.body).data.map((row) => row.referenceId)).toEqual([
        'HY-INC-000003',
      ]);
    });

    it('matches an exact reference and rejects a reference that is not one', async () => {
      const matched = await authGet('/api/v1/transactions?reference=HY-INC-000002').expect(200);
      const rejected = await authGet('/api/v1/transactions?reference=HY-INC-2');

      expect(listOf<TransactionSummary>(matched.body).pagination.totalItems).toBe(1);
      expectApiError(rejected, 400, 'VALIDATION_FAILED', 'reference');
    });

    it('applies inclusive business-date bounds', async () => {
      const response = await authGet(
        '/api/v1/transactions?type=INCOME&status=ACTIVE&from=2026-09-05&to=2026-09-06',
      ).expect(200);

      // Both bounds are inclusive, so a record on either edge is included. `status=ACTIVE`
      // keeps this test about the date range; void exclusion is asserted by its own test.
      expect(listOf<TransactionSummary>(response.body).data.map((row) => row.businessDate)).toEqual(
        ['2026-09-06', '2026-09-05'],
      );
    });

    it('rejects an inverted date range and an impossible amount window', async () => {
      const dates = await authGet('/api/v1/transactions?from=2026-09-30&to=2026-09-01');
      const amounts = await authGet('/api/v1/transactions?minAmount=900&maxAmount=100');

      expectApiError(dates, 400, 'VALIDATION_FAILED', 'from');
      expectApiError(amounts, 400, 'VALIDATION_FAILED', 'minAmount');
    });

    it('filters an exact amount window, including a zero minimum', async () => {
      const response = await authGet(
        '/api/v1/transactions?type=INCOME&minAmount=0&maxAmount=300',
      ).expect(200);
      const references = listOf<TransactionSummary>(response.body).data.map(
        (row) => row.referenceId,
      );

      expect(references).toContain('HY-INC-000004');
      expect(references).toContain('HY-INC-000005');
      expect(references).not.toContain('HY-INC-000002');
    });

    it('orders by amount on request, ascending and descending', async () => {
      const ascending = await authGet(
        '/api/v1/transactions?type=INCOME&sort=amount&direction=asc',
      ).expect(200);
      const descending = await authGet(
        '/api/v1/transactions?type=INCOME&sort=amount&direction=desc',
      ).expect(200);

      expect(listOf<TransactionSummary>(ascending.body).data.map((row) => row.amount)).toEqual([
        '75.00',
        '250.50',
        '300.00',
        '500.00',
        '1000.00',
      ]);
      expect(listOf<TransactionSummary>(descending.body).data[0]?.amount).toBe('1000.00');
    });

    it('rejects an unknown sort field, direction, or status', async () => {
      const sort = await authGet('/api/v1/transactions?sort=memberName');
      const direction = await authGet('/api/v1/transactions?direction=sideways');
      const status = await authGet('/api/v1/transactions?status=DELETED');

      expectApiError(sort, 400, 'VALIDATION_FAILED');
      expectApiError(direction, 400, 'VALIDATION_FAILED');
      expectApiError(status, 400, 'VALIDATION_FAILED');
    });

    it('pages deterministically and reports the whole result count', async () => {
      const first = await authGet('/api/v1/transactions?type=INCOME&pageSize=2&page=1').expect(200);
      const second = await authGet('/api/v1/transactions?type=INCOME&pageSize=2&page=2').expect(
        200,
      );

      expect(listOf<TransactionSummary>(first.body).pagination).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 5,
        totalPages: 3,
      });
      expect(listOf<TransactionSummary>(first.body).data).toHaveLength(2);
      expect(listOf<TransactionSummary>(second.body).pagination.page).toBe(2);
      // `totalItems` counts matching rows, not the page length, so a pager can trust it.
      expect(listOf<TransactionSummary>(second.body).pagination.totalItems).toBe(5);
    });

    it('reduces an oversized page size to the documented maximum', async () => {
      const atMaximum = await authGet(
        `/api/v1/transactions?pageSize=${TRANSACTION_PAGE_SIZE_MAX}`,
      ).expect(200);
      const aboveMaximum = await authGet(
        `/api/v1/transactions?pageSize=${TRANSACTION_PAGE_SIZE_MAX + 1}`,
      );

      expect(listOf<TransactionSummary>(atMaximum.body).pagination.pageSize).toBe(
        TRANSACTION_PAGE_SIZE_MAX,
      );
      // The DTO bounds it, so one oversized request cannot ask the database for an unbounded page.
      expectApiError(aboveMaximum, 400, 'VALIDATION_FAILED', 'pageSize');
    });

    it('rejects a page below one and an unknown query key', async () => {
      const page = await authGet('/api/v1/transactions?page=0');
      const unknown = await authGet('/api/v1/transactions?sortBy=amount');

      expectApiError(page, 400, 'VALIDATION_FAILED', 'page');
      expectApiError(unknown, 400, 'VALIDATION_FAILED');
    });

    it('projects the member, period, and document count on every row', async () => {
      const response = await authGet(`/api/v1/transactions?reference=HY-INC-000001`).expect(200);
      const row = listOf<TransactionSummary>(response.body).data[0];

      expect(row?.member).toEqual({
        id: MEMBER_ONE_ID,
        referenceId: 'HY-MEM-0001',
        name: 'Anitha Kumaran',
      });
      expect(row?.contributionPeriod).toEqual({ id: PERIOD_ID, year: 2026, month: 9 });
      expect(row?.documentCount).toBe(0);
    });

    it('never projects a member or a note for an anonymous donation', async () => {
      const response = await authGet('/api/v1/transactions?reference=HY-INC-000004').expect(200);
      const row = listOf<TransactionSummary>(response.body).data[0];

      expect(row?.member).toBeNull();
      expect(row?.notes).toBeNull();
      expect(row?.description).toBe(ANONYMOUS_DONATION_DESCRIPTION);
    });
  });

  describe('GET /api/v1/transactions/:id', () => {
    it('returns the stored record with the exact amount as a decimal string', async () => {
      const response = await authGet(`/api/v1/transactions/${CONTRIBUTION}`).expect(200);
      const row = dataOf<TransactionSummary>(response.body);

      expect(row.amount).toBe('500.00');
      expect(typeof row.amount).toBe('string');
      expect(row.businessDate).toBe('2026-09-05');
      expect(row.revision).toBe(1);
    });

    it('reports an unknown record as missing rather than as an empty screen', async () => {
      const response = await authGet(`/api/v1/transactions/${UNKNOWN_TRANSACTION_ID}`);

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('rejects a human reference where a UUID is required', async () => {
      const response = await authGet(`/api/v1/transactions/${NOT_A_UUID}`);

      // 400 rather than 404: the reference exists, the address form does not.
      expectApiError(response, 400, 'VALIDATION_FAILED', 'id');
    });

    it('strips an identity from an anonymous donation even if the stored row carries one', async () => {
      // A deliberately malformed row: the create path refuses this combination, so reaching the
      // read with one would need another route. The read must still refuse to project it.
      const row = ledger.row(ANONYMOUS);

      expect(row).toBeDefined();
      Object.assign(row ?? {}, {
        memberId: MEMBER_ONE_ID,
        notes: 'Donor: Mrs Grace Kumaran',
        description: 'From Mrs Grace Kumaran',
      });

      const response = await authGet(`/api/v1/transactions/${ANONYMOUS}`).expect(200);
      const projected = dataOf<TransactionSummary>(response.body);

      expect(projected.member).toBeNull();
      expect(projected.notes).toBeNull();
      expect(projected.description).toBe(ANONYMOUS_DONATION_DESCRIPTION);
    });
  });

  describe('PATCH /api/v1/transactions/:id', () => {
    it('applies a correction, increments the revision, and returns the stored record', async () => {
      const response = await correctTransaction('correct-1', OFFERING, '1', {
        amount: '1250.00',
        paymentMethod: 'BANK_TRANSFER',
        businessDate: '2026-09-08',
        description: 'Sunday offering, counted late',
      }).expect(200);

      const row = dataOf<TransactionSummary>(response.body);

      expect(row.amount).toBe('1250.00');
      expect(row.paymentMethod).toBe('BANK_TRANSFER');
      expect(row.businessDate).toBe('2026-09-08');
      expect(row.revision).toBe(2);
      // Identity and reference are immutable, so a correction never renames a record.
      expect(row.referenceId).toBe('HY-INC-000002');
      expect(row.id).toBe(OFFERING);
    });

    it('requires an If-Match revision and refuses a value that is not one', async () => {
      const missing = await authed()
        .patch(`/api/v1/transactions/${OFFERING}`)
        .set(IDEMPOTENCY_KEY_HEADER, 'correct-no-if-match')
        .send({ amount: '900.00' });
      const notANumber = await correctTransaction('correct-bad-if-match', OFFERING, 'latest', {
        amount: '900.00',
      });

      expectApiError(missing, 400, 'VALIDATION_FAILED', 'If-Match');
      expectApiError(notANumber, 400, 'VALIDATION_FAILED', 'If-Match');
      expect(transactions.correctCalls).toHaveLength(0);
    });

    it('accepts the quoted and weak conditional forms of If-Match', async () => {
      await correctTransaction('correct-quoted', OFFERING, '"1"', { amount: '1100.00' }).expect(
        200,
      );

      // A fresh record, so the revision is 1 again.
      await correctTransaction('correct-weak', DONATION, 'W/"1"', { amount: '260.00' }).expect(200);

      expect(transactions.correctCalls).toHaveLength(2);
    });

    it('answers a conflict, not a silent overwrite, for a stale revision', async () => {
      const response = await correctTransaction('correct-stale', OFFERING, '9', {
        amount: '900.00',
      });

      expectApiError(response, 409, 'CONFLICT');

      // The revision guard is evaluated inside the write transaction rather than from a
      // pre-transaction read, so the command does reach persistence. What must not happen is
      // a write: the stored amount, revision, status, and history are all exactly as they were.
      const stored = ledger.row(OFFERING);

      expect(stored?.amountPaise).toBe(100_000n);
      expect(stored?.revision).toBe(1);
      expect(stored?.status).toBe('ACTIVE');
      expect(ledger.events.filter((event) => event.entityId === OFFERING)).toEqual([]);
    });

    it('refuses to edit a voided transaction, because void is a state, not a field', async () => {
      const response = await correctTransaction('correct-voided', VOIDED_OFFERING, '2', {
        amount: '400.00',
      });

      expectApiError(response, 409, 'CONFLICT', 'status');
    });

    it('rejects a body that tries to change an immutable field', async () => {
      const response = await correctTransaction('correct-immutable', OFFERING, '1', {
        status: 'VOIDED',
      });

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(transactions.correctCalls).toHaveLength(0);
    });

    it('refuses to move a member contribution to a different member', async () => {
      const response = await correctTransaction('correct-move-member', CONTRIBUTION, '1', {
        memberId: MEMBER_TWO_ID,
      });

      // Re-linking would also have to move the contribution period, which is a different
      // operation from correcting an amount, so it is refused rather than half-applied.
      expectApiError(response, 400, 'VALIDATION_FAILED', 'memberId');
    });

    it('answers a 404 for a correction that names an unknown member', async () => {
      const response = await correctTransaction('correct-unknown-member', OFFERING, '1', {
        memberId: UNKNOWN_MEMBER_ID,
      });

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('detaches a member from a named offering, which is how a mis-keyed donation is fixed', async () => {
      const response = await correctTransaction('correct-detach-member', DONATION, '1', {
        memberId: null,
      }).expect(200);

      // A member correction with no other change is a real change: `memberId` must be in the
      // persistence allow-list, or the repository counts no changed field and refuses it.
      expect(dataOf<TransactionSummary>(response.body).member).toBeNull();
      expect(dataOf<TransactionSummary>(response.body).revision).toBe(2);
      expect(ledger.row(DONATION)?.memberId).toBeNull();
    });

    it('applies a member change together with another field rather than dropping one of them', async () => {
      const response = await correctTransaction('correct-member-and-amount', DONATION, '1', {
        memberId: null,
        amount: '260.00',
      }).expect(200);

      // The silent-drop case: a partial change would answer 200 and write an audit event while
      // the stored record kept the member the Admin believed they had removed.
      const corrected = dataOf<TransactionSummary>(response.body);

      expect(corrected.member).toBeNull();
      expect(corrected.amount).toBe('260.00');
      expect(ledger.row(DONATION)?.memberId).toBeNull();
      expect(ledger.row(DONATION)?.amountPaise).toBe(26_000n);

      const event = ledger.events.find(
        (candidate) =>
          candidate.entityId === DONATION && candidate.action === 'TRANSACTION_UPDATED',
      );

      expect(event?.before?.['memberId']).toBe(MEMBER_TWO_ID);
      expect(event?.after?.['memberId']).toBeNull();
    });

    it('refuses a category on an income transaction', async () => {
      const response = await correctTransaction('correct-income-category', OFFERING, '1', {
        categoryId: CATEGORY_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('refuses a member, a description, or a note on an anonymous donation correction', async () => {
      const member = await correctTransaction('correct-anonymous-member', ANONYMOUS, '1', {
        memberId: MEMBER_ONE_ID,
      });
      const description = await correctTransaction(
        'correct-anonymous-description',
        ANONYMOUS,
        '1',
        {
          description: 'From Mrs Grace Kumaran',
        },
      );
      const notes = await correctTransaction('correct-anonymous-notes', ANONYMOUS, '1', {
        notes: 'Donor asked us to keep this private',
      });

      expectApiError(member, 400, 'VALIDATION_FAILED', 'memberId');
      expectApiError(description, 400, 'VALIDATION_FAILED', 'description');
      expectApiError(notes, 400, 'VALIDATION_FAILED', 'notes');
    });

    it('rejects a correction that changes nothing', async () => {
      const response = await correctTransaction('correct-no-change', OFFERING, '1', {});

      // A no-op edit would write an audit event with identical before and after values.
      expectApiError(response, 400, 'VALIDATION_FAILED');
    });

    it('replays the identical correction rather than writing a second audit event', async () => {
      const first = await correctTransaction('correct-retry', OFFERING, '1', {
        amount: '1100.00',
      }).expect(200);
      const second = await correctTransaction('correct-retry', OFFERING, '1', {
        amount: '1100.00',
      }).expect(200);

      expect(dataOf<TransactionSummary>(second.body).revision).toBe(
        dataOf<TransactionSummary>(first.body).revision,
      );
      expect(transactions.correctCalls).toHaveLength(1);
    });

    it('rejects the same correction key reused with a different payload', async () => {
      await correctTransaction('correct-reuse', OFFERING, '1', { amount: '1100.00' }).expect(200);
      const response = await correctTransaction('correct-reuse', OFFERING, '1', {
        amount: '1200.00',
      });

      expectApiError(response, 409, 'CONFLICT', 'idempotencyKey');
    });

    it('requires an Idempotency-Key on a correction', async () => {
      const response = await authed()
        .patch(`/api/v1/transactions/${OFFERING}`)
        .set('If-Match', '1')
        .send({ amount: '900.00' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'idempotency-key');
    });

    it('keeps the private note when a correction leaves it alone', async () => {
      const response = await correctTransaction('correct-keep-note', DONATION, '1', {
        amount: '300.00',
      }).expect(200);

      expect(dataOf<TransactionSummary>(response.body).notes).toBe(
        'Donor asked us to keep this private',
      );
    });

    it('attributes the correction to the authenticated Admin', async () => {
      await correctTransaction('correct-actor', OFFERING, '1', { amount: '1100.00' }).expect(200);

      expect(transactions.correctCalls[0]?.context.actorAdminId).toBe(ADMIN_ID);
    });

    it('answers a 404 for a correction against an unknown transaction', async () => {
      const response = await correctTransaction('correct-unknown', UNKNOWN_TRANSACTION_ID, '1', {
        amount: '100.00',
      });

      expectApiError(response, 404, 'NOT_FOUND');
    });
  });

  describe('POST /api/v1/transactions/:id/void', () => {
    it('keeps the record, its reference, and its amount, and marks it voided', async () => {
      const response = await voidTransaction('void-1', OFFERING, {
        reason: 'Recorded against the wrong member',
      }).expect(200);

      const row = dataOf<TransactionSummary>(response.body);

      expect(row.status).toBe('VOIDED');
      expect(row.voidReason).toBe('Recorded against the wrong member');
      expect(typeof row.voidedAt).toBe('string');
      expect(row.referenceId).toBe('HY-INC-000002');
      expect(row.amount).toBe('1000.00');
      expect(row.revision).toBe(2);

      const stored = ledger.row(OFFERING);

      expect(stored?.status).toBe('VOIDED');
      expect(stored?.amountPaise).toBe(100_000n);
    });

    it('excludes the voided record from the active list without removing it', async () => {
      await voidTransaction('void-2', OFFERING, { reason: 'Duplicate entry' }).expect(200);

      const active = await authGet('/api/v1/transactions?type=INCOME&status=ACTIVE').expect(200);
      const all = await authGet('/api/v1/transactions?type=INCOME').expect(200);

      expect(listOf<TransactionSummary>(active.body).pagination.totalItems).toBe(3);
      expect(listOf<TransactionSummary>(all.body).pagination.totalItems).toBe(5);
    });

    it('requires a non-empty reason', async () => {
      const empty = await voidTransaction('void-empty', OFFERING, { reason: '   ' });
      const missing = await authTransactionVoidWithoutBody();

      expectApiError(empty, 400, 'VALIDATION_FAILED');
      expectApiError(missing, 400, 'VALIDATION_FAILED');
      expect(ledger.row(OFFERING)?.status).toBe('ACTIVE');
    });

    it('requires an Idempotency-Key on a void', async () => {
      const response = await authed()
        .post(`/api/v1/transactions/${OFFERING}/void`)
        .send({ reason: 'Duplicate entry' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'idempotency-key');
    });

    it('replays the identical void rather than reporting a failure for a void that worked', async () => {
      const first = await voidTransaction('void-retry', OFFERING, {
        reason: 'Duplicate entry',
      }).expect(200);
      const second = await voidTransaction('void-retry', OFFERING, {
        reason: 'Duplicate entry',
      }).expect(200);

      expect(dataOf<TransactionSummary>(second.body).revision).toBe(
        dataOf<TransactionSummary>(first.body).revision,
      );
      expect(transactions.voidCalls).toHaveLength(1);
    });

    it('refuses to overwrite the recorded reason with a different one', async () => {
      await voidTransaction('void-first', OFFERING, { reason: 'Duplicate entry' }).expect(200);
      const response = await voidTransaction('void-second', OFFERING, {
        reason: 'A better reason',
      });

      // Silently re-voiding would destroy the original explanation of the void.
      expectApiError(response, 409, 'CONFLICT', 'reason');
      expect(ledger.row(OFFERING)?.voidReason).toBe('Duplicate entry');
    });

    it('answers a 404 for a void against an unknown transaction', async () => {
      const response = await voidTransaction('void-unknown', UNKNOWN_TRANSACTION_ID, {
        reason: 'Nothing to void',
      });

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('attributes the void to the authenticated Admin and keeps the reason on the row', async () => {
      await voidTransaction('void-actor', OFFERING, { reason: 'Duplicate entry' }).expect(200);

      expect(transactions.voidCalls[0]?.context.actorAdminId).toBe(ADMIN_ID);
      expect(ledger.row(OFFERING)?.voidReason).toBe('Duplicate entry');
    });
  });

  describe('GET /api/v1/transactions/:id/audit', () => {
    it('returns the trail oldest first, with the actor and the recorded values', async () => {
      // A record created through the API, so the trail genuinely starts with its creation.
      const created = await createIncome('audit-create', {
        incomeType: 'OFFERING',
        amount: '1000.00',
        paymentMethod: 'CASH',
        businessDate: '2026-09-05',
        description: 'Weekday offering',
      }).expect(201);
      const record = dataOf<TransactionSummary>(created.body);

      await correctTransaction('audit-correct', record.id, String(record.revision), {
        amount: '1100.00',
      }).expect(200);
      await voidTransaction('audit-void', record.id, { reason: 'Duplicate entry' }).expect(200);

      const response = await authGet(`/api/v1/transactions/${record.id}/audit`).expect(200);
      const events = dataOf<readonly TransactionAuditEventView[]>(response.body);

      expect(events.map((event) => event.action)).toEqual([
        'TRANSACTION_CREATED',
        'TRANSACTION_UPDATED',
        'TRANSACTION_VOIDED',
      ]);
      // A creation is a change from nothing, not a change from a fabricated previous value.
      expect(events[0]?.before).toBeNull();
      expect(events[0]?.after?.['amountPaise']).toBe('100000');
      expect(events[0]?.actorDisplayName).toBe(ADMIN_DISPLAY_NAME);
      expect(events[1]?.before?.['amountPaise']).toBe('100000');
      expect(events[1]?.after?.['amountPaise']).toBe('110000');
      expect(events[2]?.reason).toBe('Duplicate entry');
      expect(events[2]?.after?.['status']).toBe('VOIDED');
      expect(typeof events[0]?.occurredAt).toBe('string');
    });

    it('reports an empty trail for a seeded record rather than inventing a creation', async () => {
      const response = await authGet(`/api/v1/transactions/${CONTRIBUTION}/audit`).expect(200);
      const events = dataOf<readonly TransactionAuditEventView[]>(response.body);

      // The contribution fixture was seeded, so it has no creation event; the empty trail is the
      // honest answer rather than an invented one.
      expect(events).toEqual([]);
    });

    it('answers a 404 for the audit trail of an unknown transaction', async () => {
      const response = await authGet(`/api/v1/transactions/${UNKNOWN_TRANSACTION_ID}/audit`);

      // A missing record must not look like a record nothing ever happened to.
      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('never exposes an internal identifier in place of the actor name', async () => {
      await voidTransaction('audit-actor', OFFERING, { reason: 'Duplicate entry' }).expect(200);

      const response = await authGet(`/api/v1/transactions/${OFFERING}/audit`).expect(200);
      const events = dataOf<readonly TransactionAuditEventView[]>(response.body);

      expect(events[0]?.actorDisplayName).toBe(ADMIN_DISPLAY_NAME);
      expect(JSON.stringify(events)).not.toContain(ADMIN_ID);
    });
  });

  describe('GET /api/v1/transactions/:id/receipt', () => {
    it('projects the documented receipt from the stored record', async () => {
      const response = await authGet(`/api/v1/transactions/${CONTRIBUTION}/receipt`).expect(200);
      const receipt = dataOf<TransactionReceiptView>(response.body);

      expect(receipt).toMatchObject({
        applicationName: APPLICATION_NAME,
        referenceId: 'HY-INC-000001',
        amount: '500.00',
        currency: 'INR',
        incomeType: 'MEMBER_CONTRIBUTION',
        paymentMethod: 'CASH',
        businessDate: '2026-09-05',
        status: 'ACTIVE',
        receivedFrom: { id: MEMBER_ONE_ID, name: 'Anitha Kumaran' },
        voidedAt: null,
        voidReason: null,
      });
      expect(typeof receipt.issuedAt).toBe('string');
    });

    it('reflects a corrected amount on the next render, because it is not a stored image', async () => {
      await correctTransaction('receipt-correct', CONTRIBUTION, '1', { amount: '650.00' }).expect(
        200,
      );

      const response = await authGet(`/api/v1/transactions/${CONTRIBUTION}/receipt`).expect(200);

      expect(dataOf<TransactionReceiptView>(response.body).amount).toBe('650.00');
    });

    it('names no contributor for an anonymous donation', async () => {
      const response = await authGet(`/api/v1/transactions/${ANONYMOUS}/receipt`).expect(200);
      const receipt = dataOf<TransactionReceiptView>(response.body);

      expect(receipt.receivedFrom).toBeNull();
      expect(JSON.stringify(receipt)).not.toContain('HY-MEM-');
    });

    it('keeps a voided receipt, marked VOIDED with its reason', async () => {
      await voidTransaction('receipt-void', CONTRIBUTION, { reason: 'Duplicate entry' }).expect(
        200,
      );

      const response = await authGet(`/api/v1/transactions/${CONTRIBUTION}/receipt`).expect(200);
      const receipt = dataOf<TransactionReceiptView>(response.body);

      expect(receipt.status).toBe('VOIDED');
      expect(receipt.voidReason).toBe('Duplicate entry');
      expect(typeof receipt.voidedAt).toBe('string');
      // The amount is still the stored amount; exclusion from totals is by status, not by erasure.
      expect(receipt.amount).toBe('500.00');
    });

    it('answers a 404 for an unknown transaction and refuses a receipt for an expense', async () => {
      const unknown = await authGet(`/api/v1/transactions/${UNKNOWN_TRANSACTION_ID}/receipt`);
      const expense = await authGet(`/api/v1/transactions/${EXPENSE}/receipt`);

      expectApiError(unknown, 404, 'NOT_FOUND');
      // A receipt is an income concept: money going out must never render an income receipt.
      expectApiError(expense, 400, 'VALIDATION_FAILED', 'id');
    });
  });

  describe('routes that must not exist', () => {
    it('has no separate income read route, so the ledger has one canonical read path', async () => {
      const list = await authGet('/api/v1/income');
      const detail = await authGet(`/api/v1/income/${CONTRIBUTION}`);

      // `docs/06-API-SPEC.md` defines no `GET /api/v1/income`; the browser reads income through
      // `GET /api/v1/transactions?type=INCOME` so a second read path cannot disagree.
      expect(list.status).toBe(404);
      expect(detail.status).toBe(404);
    });

    it('does not answer a transaction id under an income path', async () => {
      const response = await authGet(`/api/v1/income/${EXPENSE}/receipt`);

      expect(response.status).toBe(404);
    });
  });

  /** A void request with no body at all, to prove the reason is not optional. */
  function authTransactionVoidWithoutBody() {
    return authed()
      .post(`/api/v1/transactions/${OFFERING}/void`)
      .set(IDEMPOTENCY_KEY_HEADER, 'void-missing-reason');
  }
});
