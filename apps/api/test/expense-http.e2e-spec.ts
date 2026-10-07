import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CSRF_TOKEN_HEADER,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  EXPENSE_REASON_NAME_MAX_LENGTH,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  TRANSACTION_PAGE_SIZE_MAX,
  isApiErrorBody,
  isApiListEnvelope,
  isApiSuccessEnvelope,
  type ApiListEnvelope,
  type ApiSuccessEnvelope,
  type ExpenseCategoryView,
  type ExpenseReasonView,
  type ExpenseSummary,
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
import { ExpenseReasonRepository } from '../src/database/reasons/expense-reason.repository';
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
  FakeReasons,
  FakeSettings,
  FakeTransactions,
  categoryFixture,
  fakeSession,
  httpServer,
  reasonFixture,
  TEST_ACTOR_ADMIN_ID as ADMIN_ID,
  transactionFixture,
  type FakeCategory,
  type FakeMember,
  type FakePeriod,
  type FakeReason,
} from './support/fake-ledger';

/**
 * HTTP-layer coverage for the expense and category routes, and for the shared transaction
 * routes as an expense reaches them.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-001` to `REQ-EXP-004` and `REQ-DOC-003`;
 * transport from `docs/06-API-SPEC.md`. The real `ExpensesService`, the real
 * `TransactionsService`, the real controllers, the real DTO validation, the real
 * `SessionGuard`, the real idempotency runner, and the real error filter are all exercised.
 * Only persistence is replaced with the shared in-memory doubles, so these tests run with no
 * PostgreSQL and still prove the transport contract: routing, authentication, CSRF,
 * idempotency, `If-Match` parsing, exact money parsing, the active-category rule, the refusal
 * of income-only fields, the documented error envelopes, and the read/audit projections.
 *
 * The doubles come from `test/support/fake-ledger.ts` and are the same ones the income suite
 * uses, so a repository rule cannot be true for one route and false for the other. The
 * behaviour that genuinely needs a database — the CHECK constraint that makes an expense
 * without a category unrepresentable, category-name uniqueness under a real unique index, and
 * reference allocation — is covered by `test/database/expense-persistence.db-spec.ts`.
 */

const SESSION_TOKEN = 'session-token-for-expense-routes';
const CSRF_TOKEN = 'csrf-token-for-expense-routes';

const CATEGORY_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_CATEGORY_ID = '88888888-8888-4888-8888-888888888888';
const INACTIVE_CATEGORY_ID = '77777777-7777-4777-8777-777777777777';

/**
 * One reason per category, plus the mismatch and inactive cases.
 *
 * `OTHER_CATEGORY_REASON_ID` deliberately shares its *name* with a reason under another category.
 * That is legal and is the point: `REQ-EXP-005` scopes uniqueness to the pair, so a double that
 * compared names globally would reject data the database accepts.
 */
const CATEGORY_REASON_ID = 'a1111111-1111-4111-8111-111111111111';
const OTHER_CATEGORY_REASON_ID = 'a2222222-2222-4222-8222-222222222222';
const INACTIVE_REASON_ID = 'a3333333-3333-4333-8333-333333333333';
/** Belongs to `CATEGORY_ID`, so it is valid for `OTHER_CATEGORY_ID` only as a refusal case. */
const WRONG_CATEGORY_REASON_ID = 'a4444444-4444-4444-8444-444444444444';
/** Active, but under the retired category — usable only once that category is active again. */
const RETIRED_CATEGORY_REASON_ID = 'a6666666-6666-4666-8666-666666666666';
/** Retired later in a test, while its category stays active — so only the status makes it invalid. */
const INACTIVE_REASON_UNDER_ACTIVE_CATEGORY_ID = 'a7777777-7777-4777-8777-777777777777';
const UNKNOWN_REASON_ID = 'a5555555-5555-4555-8555-555555555555';
const NOT_A_UUID_REASON = 'Groceries';
const UNKNOWN_CATEGORY_ID = '99999999-9999-4999-8999-999999999999';
const UNKNOWN_TRANSACTION_ID = '66666666-6666-4666-8666-666666666666';
const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '33333333-3333-4333-8333-333333333333';

/** The expense fixtures, addressed by these stable local names. */
const ELECTRICITY = 'b1111111-1111-4111-8111-111111111111';
const REPAIRS = 'b2222222-2222-4222-8222-222222222222';
const RETIRED_CATEGORY_EXPENSE = 'b3333333-3333-4333-8333-333333333333';
const VOIDED_EXPENSE = 'b4444444-4444-4444-8444-444444444444';
const ATTACHED_RECEIPT = 'b5555555-5555-4555-8555-555555555555';

/** An income row, present so the list can prove it never leaks into an expense result. */
const OFFERING = 'b6666666-6666-4666-8666-666666666666';

/** A category name is not a UUID, so it must be rejected as malformed rather than "missing". */
const NOT_A_UUID = 'Cleaning';

const DEFAULT_CONTRIBUTION_SETTING_PAISE = '50000';

describe('Expense and category HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;
  let ledger: FakeLedger;
  let transactions: FakeTransactions;
  let categories: FakeCategories;
  let reasons: FakeReasons;
  let idempotency: FakeIdempotency;

  let members: readonly FakeMember[];
  let periodRows: FakePeriod[];
  let categoryRows: FakeCategory[];
  let reasonRows: FakeReason[];

  beforeEach(async () => {
    // Rebuilt per test on purpose: the fakes mutate the rows they are handed, so a shared
    // array would let one test's category rename or deactivation leak into the next.
    members = [{ id: MEMBER_ID, referenceId: 'HY-MEM-0001', name: 'Anitha Kumaran' }];

    periodRows = [
      { id: PERIOD_ID, memberId: MEMBER_ID, year: 2026, month: 9, expectedPaise: 50_000n },
    ];

    categoryRows = [
      categoryFixture({ id: CATEGORY_ID, name: 'Electricity', isSystem: true }),
      categoryFixture({ id: OTHER_CATEGORY_ID, name: 'Repairs' }),
      categoryFixture({ id: INACTIVE_CATEGORY_ID, name: 'Retired category', status: 'INACTIVE' }),
    ];

    // Rebuilt per test for the same reason the categories are: the doubles mutate their rows, so a
    // shared array would let one test's reason rename or deactivation leak into the next.
    reasonRows = [
      reasonFixture({
        id: CATEGORY_REASON_ID,
        categoryId: CATEGORY_ID,
        name: 'Electricity Bill',
        isSystem: true,
      }),
      reasonFixture({ id: OTHER_CATEGORY_REASON_ID, categoryId: OTHER_CATEGORY_ID, name: 'Other' }),
      reasonFixture({
        id: INACTIVE_REASON_ID,
        categoryId: INACTIVE_CATEGORY_ID,
        name: 'Other',
        status: 'INACTIVE',
      }),
      reasonFixture({
        id: WRONG_CATEGORY_REASON_ID,
        categoryId: CATEGORY_ID,
        name: 'Groceries',
      }),
      reasonFixture({
        id: RETIRED_CATEGORY_REASON_ID,
        categoryId: INACTIVE_CATEGORY_ID,
        name: 'Repair Work',
      }),
      reasonFixture({
        id: INACTIVE_REASON_UNDER_ACTIVE_CATEGORY_ID,
        categoryId: OTHER_CATEGORY_ID,
        name: 'Fuel',
      }),
    ];

    ledger = new FakeLedger([
      transactionFixture({
        id: OFFERING,
        referenceId: 'HY-INC-000001',
        incomeType: 'OFFERING',
        amountPaise: 100_000n,
        businessDate: parseBusinessDate('2026-09-10'),
        description: 'Sunday offering',
      }),
      transactionFixture({
        id: ELECTRICITY,
        referenceId: 'HY-EXP-000001',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 45_000n,
        paymentMethod: 'UPI',
        businessDate: parseBusinessDate('2026-09-05'),
        description: 'September electricity bill',
        categoryId: CATEGORY_ID,
        expenseReasonId: CATEGORY_REASON_ID,
      }),
      transactionFixture({
        id: REPAIRS,
        referenceId: 'HY-EXP-000002',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 12_345n,
        paymentMethod: 'CASH',
        businessDate: parseBusinessDate('2026-08-20'),
        description: 'Bell rope and brackets',
        notes: 'Bought from the hardware shop on main street',
        categoryId: OTHER_CATEGORY_ID,
        expenseReasonId: OTHER_CATEGORY_REASON_ID,
      }),
      transactionFixture({
        id: RETIRED_CATEGORY_EXPENSE,
        referenceId: 'HY-EXP-000003',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 8_000n,
        businessDate: parseBusinessDate('2026-07-11'),
        description: 'Recorded under a category that was later retired',
        // A historical expense keeps its reason even when both are inactive. That is the reason
        // deactivation replaces deletion: the record must stay readable and explainable.
        categoryId: INACTIVE_CATEGORY_ID,
        expenseReasonId: INACTIVE_REASON_ID,
      }),
      transactionFixture({
        id: VOIDED_EXPENSE,
        referenceId: 'HY-EXP-000004',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 30_000n,
        businessDate: parseBusinessDate('2026-09-06'),
        description: 'Duplicate fuel entry',
        categoryId: OTHER_CATEGORY_ID,
        expenseReasonId: OTHER_CATEGORY_REASON_ID,
        status: 'VOIDED',
        voidReason: 'Recorded twice by mistake',
        voidedAt: new Date('2026-09-07T06:00:00.000Z'),
        revision: 2,
      }),
      transactionFixture({
        id: ATTACHED_RECEIPT,
        referenceId: 'HY-EXP-000005',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 60_000n,
        businessDate: parseBusinessDate('2026-09-08'),
        description: 'Generator service with a bill attached',
        categoryId: OTHER_CATEGORY_ID,
        expenseReasonId: OTHER_CATEGORY_REASON_ID,
        // Phase 07 owns attaching documents. This fixture proves the projection is *derived*
        // from the document rows rather than hard-coded, without implementing any upload.
        documentCount: 1,
      }),
    ]);

    transactions = new FakeTransactions(ledger, members, periodRows, categoryRows, reasonRows);
    categories = new FakeCategories(categoryRows);
    // The reason double is handed the category double because the repository reads the category
    // inside the same write, so the read has to be reproducible here too.
    reasons = new FakeReasons(reasonRows, categories);
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
      .useValue(new FakePeriods(periodRows))
      .overrideProvider(AppSettingRepository)
      .useValue(
        new FakeSettings({
          DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_SETTING_PAISE,
        }),
      )
      .overrideProvider(ExpenseCategoryRepository)
      .useValue(categories)
      .overrideProvider(ExpenseReasonRepository)
      .useValue(reasons)
      .overrideProvider(IdempotencyRecordRepository)
      .useValue(idempotency)
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN
            ? fakeSession({ sessionId: 'session-expense', csrfToken: CSRF_TOKEN })
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

  function createExpense(key: string, body: Record<string, unknown>) {
    return authed().post('/api/v1/expenses').set(IDEMPOTENCY_KEY_HEADER, key).send(body);
  }

  function createCategory(key: string, body: Record<string, unknown>) {
    return authed().post('/api/v1/expenses/categories').set(IDEMPOTENCY_KEY_HEADER, key).send(body);
  }

  function createReason(key: string, body: Record<string, unknown>) {
    return authed().post('/api/v1/expenses/reasons').set(IDEMPOTENCY_KEY_HEADER, key).send(body);
  }

  function updateReason(key: string, id: string, body: Record<string, unknown>) {
    return authed()
      .patch(`/api/v1/expenses/reasons/${id}`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body);
  }

  function updateCategory(key: string, id: string, body: Record<string, unknown>) {
    return authed()
      .patch(`/api/v1/expenses/categories/${id}`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body);
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

  /**
   * A valid expense body, with per-test overrides.
   *
   * The reason is part of the default, not something each test opts into: an expense without one is
   * unrepresentable in the database, so a default that omitted it would make every refusal test in
   * this file pass for the wrong reason.
   */
  function expenseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      amount: '450.00',
      paymentMethod: 'UPI',
      businessDate: '2026-09-05',
      categoryId: CATEGORY_ID,
      expenseReasonId: CATEGORY_REASON_ID,
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
    it('refuses every expense read route without a session', async () => {
      for (const url of [
        '/api/v1/expenses',
        '/api/v1/expenses/categories',
        `/api/v1/transactions/${ELECTRICITY}`,
      ]) {
        const response = await request(httpServer(app)).get(url);

        expectApiError(response, 401, 'UNAUTHENTICATED');
      }
    });

    it('refuses an expense create without a session, before it looks at the body', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/expenses')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-expense-1')
        .send(expenseBody());

      expectApiError(response, 401, 'UNAUTHENTICATED');
    });

    it('refuses a category create and a category update without a session', async () => {
      const created = await request(httpServer(app))
        .post('/api/v1/expenses/categories')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-category-1')
        .send({ name: 'Books' });

      const updated = await request(httpServer(app))
        .patch(`/api/v1/expenses/categories/${CATEGORY_ID}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-category-2')
        .send({ name: 'Power' });

      expectApiError(created, 401, 'UNAUTHENTICATED');
      expectApiError(updated, 401, 'UNAUTHENTICATED');
    });

    it('refuses an expense create without a CSRF token, so a cross-site form cannot spend', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/expenses')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(IDEMPOTENCY_KEY_HEADER, 'csrf-missing-header')
        .send(expenseBody());

      expectApiError(response, 403, 'CSRF_FAILED');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a category change without a CSRF token', async () => {
      const response = await request(httpServer(app))
        .patch(`/api/v1/expenses/categories/${CATEGORY_ID}`)
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(IDEMPOTENCY_KEY_HEADER, 'csrf-missing-category')
        .send({ status: 'INACTIVE' });

      expectApiError(response, 403, 'CSRF_FAILED');
      expect(categories.updated).toHaveLength(0);
    });

    it('refuses an expense create from an untrusted origin even with a valid session', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/expenses')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', 'http://evil.example')
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'untrusted-origin')
        .send(expenseBody());

      // `FORBIDDEN`, not `CSRF_FAILED`: the origin itself is untrusted, so the request is
      // refused before the token is even compared.
      expectApiError(response, 403, 'FORBIDDEN');
      expect(ledger.rows).toHaveLength(6);
    });
  });

  describe('POST /api/v1/expenses', () => {
    it('records an expense and answers the documented envelope', async () => {
      const response = await createExpense('expense-create-1', expenseBody());

      expect(response.status).toBe(201);

      const created = dataOf<ExpenseSummary>(response.body);

      expect(created.type).toBe('EXPENSE');
      // An expense carries no income type and no member, so neither can be invented by a
      // response shape that has room for them.
      expect(created.incomeType).toBeNull();
      expect(created.member).toBeNull();
      expect(created.contributionPeriod).toBeNull();
      expect(created.category).toEqual({
        id: CATEGORY_ID,
        name: 'Electricity',
        status: 'ACTIVE',
      });
      expect(created.referenceId).toMatch(/^HY-EXP-\d{6}$/);
      expect(created.status).toBe('ACTIVE');
      expect(created.revision).toBe(1);
      expect(created.voidReason).toBeNull();
      expect(created.currency).toBe('INR');
    });

    it('keeps the amount an exact decimal string and stores exact paise', async () => {
      // `450.10` cannot be represented exactly in binary floating point, so a number would
      // store 450.09999999999997. The wire value is a string and the stored value is `45010n`.
      const response = await createExpense(
        'expense-create-exact',
        expenseBody({ amount: '450.10' }),
      );

      expect(dataOf<ExpenseSummary>(response.body).amount).toBe('450.10');
      expect(transactions.createCalls[0]?.input.amountPaise).toBe(45_010n);
    });

    it('refuses an ambiguous amount rather than rounding it', async () => {
      // `REQ-FIN-021`: a value that cannot be represented exactly must be rejected, not
      // coerced. Rounding a financial amount silently is worse than refusing the entry.
      for (const amount of ['10.005', '1,000', '1e3', '0', '-500', '500.999', ' ']) {
        const response = await createExpense(
          `expense-ambiguous-${amount}`,
          expenseBody({ amount }),
        );

        expectApiError(response, 400, 'VALIDATION_FAILED', 'amount');
      }

      expect(transactions.createCalls).toHaveLength(0);
    });

    it('allocates an expense reference rather than an income reference', async () => {
      const response = await createExpense('expense-create-ref', expenseBody());

      const created = dataOf<ExpenseSummary>(response.body);

      // The ledger already holds `HY-EXP-000001` to `HY-EXP-000005`, so the next expense
      // reference must not collide with any of them and must not use the `HY-INC-` scope.
      expect(created.referenceId).toBe('HY-EXP-000006');
      expect(created.referenceId).not.toContain('INC');
    });

    it('records the business date and the instant inside that same day', async () => {
      const response = await createExpense(
        'expense-create-date',
        expenseBody({ businessDate: '2026-09-25' }),
      );

      const created = dataOf<ExpenseSummary>(response.body);

      expect(created.businessDate).toBe('2026-09-25');

      const stored = transactions.createCalls[0]?.input;

      expect(stored?.businessDate).toEqual(parseBusinessDate('2026-09-25'));
      // 00:00 Asia/Kolkata is 18:30 UTC the previous day. Deriving the instant from the
      // business date is what keeps an entry inside the month the Admin typed it into.
      expect((stored?.occurredAt as Date).toISOString()).toBe('2026-09-24T18:30:00.000Z');
    });

    it('requires a category, because an expense cannot exist without one', async () => {
      const body = expenseBody();
      delete body['categoryId'];

      const response = await createExpense('expense-create-no-category', body);

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a category that does not exist', async () => {
      const response = await createExpense(
        'expense-create-unknown-category',
        expenseBody({ categoryId: UNKNOWN_CATEGORY_ID }),
      );

      expectApiError(response, 404, 'NOT_FOUND');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a deactivated category, and says which field is the problem', async () => {
      // `REQ-EXP-004`: new expenses may reference only an *active* category. The message names
      // the field so the Admin is not left guessing, and the answer is a 400 rather than a
      // foreign-key failure reported as a server fault.
      const response = await createExpense(
        'expense-create-inactive-category',
        expenseBody({ categoryId: INACTIVE_CATEGORY_ID }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a category id that is not a UUID', async () => {
      const response = await createExpense(
        'expense-create-bad-uuid',
        expenseBody({ categoryId: NOT_A_UUID }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a member, because an expense belongs to the church and not to a member', async () => {
      // The field is not in the DTO at all, and the global pipe rejects unknown body keys
      // rather than ignoring them. A silent drop would leave the Admin believing a member was
      // attached to a payment that has no member.
      const response = await createExpense(
        'expense-create-with-member',
        expenseBody({ memberId: MEMBER_ID }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'memberId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses an income type and a contribution period on an expense', async () => {
      const incomeType = await createExpense(
        'expense-create-with-income-type',
        expenseBody({ incomeType: 'OFFERING' }),
      );
      const period = await createExpense(
        'expense-create-with-period',
        expenseBody({ contributionPeriod: { year: 2026, month: 9 } }),
      );

      expectApiError(incomeType, 400, 'VALIDATION_FAILED', 'incomeType');
      expectApiError(period, 400, 'VALIDATION_FAILED', 'contributionPeriod');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses an unknown payment method', async () => {
      const response = await createExpense(
        'expense-create-bad-method',
        expenseBody({ paymentMethod: 'CHEQUE' }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'paymentMethod');
    });

    it('refuses a malformed business date', async () => {
      for (const businessDate of ['05-09-2026', '2026-9-5', 'today', '']) {
        const response = await createExpense(
          `expense-bad-date-${businessDate}`,
          expenseBody({ businessDate }),
        );

        expectApiError(response, 400, 'VALIDATION_FAILED', 'businessDate');
      }
    });

    it('requires an Idempotency-Key rather than generating one server-side', async () => {
      // A server-side key would make the route look retry-safe while every retry created a
      // new expense, which is exactly the duplicate the requirement exists to prevent.
      const response = await authed().post('/api/v1/expenses').send(expenseBody());

      expectApiError(response, 400, 'VALIDATION_FAILED', 'idempotency-key');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses an unusable Idempotency-Key', async () => {
      const tooLong = await createExpense(
        'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
        expenseBody(),
      );
      const spaced = await createExpense('has a space', expenseBody());

      expectApiError(tooLong, 400, 'VALIDATION_FAILED', 'idempotency-key');
      expectApiError(spaced, 400, 'VALIDATION_FAILED', 'idempotency-key');
    });

    it('replays the original record when the same key and payload are sent twice', async () => {
      // Without this, a double tap on Save records the same payment twice and overstates the
      // church's expenses.
      const first = await createExpense('expense-replay-1', expenseBody());
      const second = await createExpense('expense-replay-1', expenseBody());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(dataOf<ExpenseSummary>(second.body).id).toBe(dataOf<ExpenseSummary>(first.body).id);
      expect(transactions.createCalls).toHaveLength(1);
      expect(ledger.rows.filter((row) => row.transactionType === 'EXPENSE')).toHaveLength(6);
    });

    it('refuses the same key with a different payload, rather than silently replaying it', async () => {
      // Replaying here would tell the Admin their new amount was saved when the first one
      // was stored, which is a silently wrong financial record.
      await createExpense('expense-key-reuse-1', expenseBody());
      const reused = await createExpense('expense-key-reuse-1', expenseBody({ amount: '999.00' }));

      expectApiError(reused, 409, 'CONFLICT');
      expect(transactions.createCalls).toHaveLength(1);
    });

    it('scopes the key to the route, so the income and expense creates cannot collide', async () => {
      // Without the endpoint in the key's identity, a client that reused one key across both
      // creates would receive the income response on the expense route.
      await createExpense('shared-key-1', expenseBody());
      const income = await authed()
        .post('/api/v1/income')
        .set(IDEMPOTENCY_KEY_HEADER, 'shared-key-1')
        .send({
          incomeType: 'OFFERING',
          amount: '500.00',
          paymentMethod: 'CASH',
          businessDate: '2026-09-05',
        });

      expect(income.status).toBe(201);
      expect(dataOf<TransactionSummary>(income.body).type).toBe('INCOME');
    });
  });

  describe('GET /api/v1/expenses', () => {
    it('returns only expenses, never income', async () => {
      const response = await authGet('/api/v1/expenses');

      expect(response.status).toBe(200);

      const page = listOf<ExpenseSummary>(response.body);

      expect(page.data.every((row) => row.type === 'EXPENSE')).toBe(true);
      expect(page.data.map((row) => row.referenceId)).not.toContain('HY-INC-000001');
      expect(page.data).toHaveLength(5);
      expect(page.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 5, totalPages: 1 });
    });

    it('refuses a type filter, so the route cannot be widened into an income list', async () => {
      // The DTO has no `type` and no `incomeType`, so the global pipe rejects them outright
      // rather than ignoring a filter the Admin believes was applied.
      for (const query of ['type=INCOME', 'type=EXPENSE', 'incomeType=OFFERING']) {
        const response = await authGet(`/api/v1/expenses?${query}`);

        expectApiError(response, 400, 'VALIDATION_FAILED', query.split('=')[0]);
      }
    });

    it('reports an honest empty result rather than claiming expenses exist', async () => {
      const response = await authGet('/api/v1/expenses?search=nothing-matches-this');

      const page = listOf<ExpenseSummary>(response.body);

      expect(page.data).toEqual([]);
      expect(page.pagination.totalItems).toBe(0);
      expect(page.pagination.totalPages).toBe(0);
    });

    it('filters by category', async () => {
      const response = await authGet(`/api/v1/expenses?categoryId=${OTHER_CATEGORY_ID}`);

      const page = listOf<ExpenseSummary>(response.body);

      expect(page.data.every((row) => row.category?.id === OTHER_CATEGORY_ID)).toBe(true);
      expect(page.pagination.totalItems).toBe(3);
    });

    it('keeps a historical expense readable under a category that was later deactivated', async () => {
      // The category's *current* status travels with the expense, so the screen can say why
      // the label is no longer selectable instead of showing a name that silently fails.
      const response = await authGet(`/api/v1/expenses?categoryId=${INACTIVE_CATEGORY_ID}`);

      const page = listOf<ExpenseSummary>(response.body);

      expect(page.data).toHaveLength(1);
      expect(page.data[0]?.category).toEqual({
        id: INACTIVE_CATEGORY_ID,
        name: 'Retired category',
        status: 'INACTIVE',
      });
    });

    it('filters by status, so a voided expense is visible but separable', async () => {
      const active = listOf<ExpenseSummary>((await authGet('/api/v1/expenses?status=ACTIVE')).body);
      const voided = listOf<ExpenseSummary>((await authGet('/api/v1/expenses?status=VOIDED')).body);

      expect(active.pagination.totalItems).toBe(4);
      expect(voided.pagination.totalItems).toBe(1);
      expect(voided.data[0]?.voidReason).toBe('Recorded twice by mistake');
    });

    it('filters by payment method, date range, and amount window', async () => {
      const byMethod = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?paymentMethod=UPI')).body,
      );
      const byRange = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?from=2026-09-01&to=2026-09-30')).body,
      );
      const byAmount = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?minAmount=300.00&maxAmount=500.00')).body,
      );

      expect(byMethod.data.every((row) => row.paymentMethod === 'UPI')).toBe(true);
      expect(byRange.data.every((row) => row.businessDate.startsWith('2026-09'))).toBe(true);
      // The window is applied in exact paise: 450.00 and the voided 300.00 are inside, while
      // 600.00, 123.45 and 80.00 are outside. Newest business date first, so 06 Sep leads.
      expect(byAmount.data.map((row) => row.amount)).toEqual(['300.00', '450.00']);
    });

    it('searches the reference, the description, and the category name but never the note', async () => {
      const byReference = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=HY-EXP-000002')).body,
      );
      const byDescription = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=bell rope')).body,
      );
      const byCategory = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=repairs')).body,
      );
      const byNote = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=hardware shop')).body,
      );

      expect(byReference.data).toHaveLength(1);
      expect(byDescription.data).toHaveLength(1);
      expect(byCategory.data.length).toBeGreaterThan(0);
      // A private note must not become a search result, which is how an identity typed into
      // one would otherwise be discoverable from the list.
      expect(byNote.data).toEqual([]);
    });

    it('refuses an inverted date range rather than returning nothing', async () => {
      // An empty list would read as "no expenses that month" rather than "those bounds are
      // impossible", so `REQ-FIN-022` requires the refusal.
      const response = await authGet('/api/v1/expenses?from=2026-09-30&to=2026-09-01');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'from');
    });

    it('refuses an inverted amount window', async () => {
      const response = await authGet('/api/v1/expenses?minAmount=900&maxAmount=100');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'minAmount');
    });

    it('rejects a non-UUID category filter instead of matching nothing', async () => {
      const response = await authGet(`/api/v1/expenses?categoryId=${NOT_A_UUID}`);

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('rejects a free-text reference filter instead of scanning the column', async () => {
      const response = await authGet('/api/v1/expenses?reference=anything');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'reference');
    });

    it('refuses an oversized page instead of asking for an unbounded page', async () => {
      const atMaximum = await authGet(`/api/v1/expenses?pageSize=${TRANSACTION_PAGE_SIZE_MAX}`);
      const aboveMaximum = await authGet(
        `/api/v1/expenses?pageSize=${TRANSACTION_PAGE_SIZE_MAX + 50}`,
      );

      expect(listOf<ExpenseSummary>(atMaximum.body).pagination.pageSize).toBe(
        TRANSACTION_PAGE_SIZE_MAX,
      );
      // The DTO bounds it, so one oversized request cannot ask the database for an unbounded page.
      expectApiError(aboveMaximum, 400, 'VALIDATION_FAILED', 'pageSize');
    });

    it('orders by business date by default and can reverse on request', async () => {
      const newestFirst = listOf<ExpenseSummary>((await authGet('/api/v1/expenses')).body);
      const oldestFirst = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?sort=businessDate&direction=asc')).body,
      );

      expect(newestFirst.data[0]?.businessDate).toBe('2026-09-08');
      expect(oldestFirst.data[0]?.businessDate).toBe('2026-07-11');
    });

    it('pages deterministically, with a total that covers every page', async () => {
      const first = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?pageSize=2&page=1')).body,
      );
      const second = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?pageSize=2&page=2')).body,
      );

      expect(first.data).toHaveLength(2);
      expect(second.data).toHaveLength(2);
      expect(first.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 5, totalPages: 3 });
      // No row appears on two pages.
      const ids = [...first.data, ...second.data].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('GET /api/v1/expenses/categories', () => {
    it('returns the active categories only, with the system flag preserved', async () => {
      const response = await authGet('/api/v1/expenses/categories');

      expect(response.status).toBe(200);

      const categories = dataOf<readonly ExpenseCategoryView[]>(response.body);

      // `docs/05-DATABASE-SPEC.md`: "The API exposes active categories for new entries and
      // preserves inactive categories on historical transactions." The deactivated fixture is
      // therefore absent here, so the create form cannot offer a category the server refuses.
      // Its status still reaches the Admin on the expense it belongs to, which is asserted
      // below and in the historical-expense read.
      expect(categories.map((category) => category.name)).toEqual(['Electricity', 'Repairs']);
      expect(categories.some((category) => category.status !== 'ACTIVE')).toBe(false);
      expect(categories.find((category) => category.name === 'Electricity')?.isSystem).toBe(true);
      expect(categories.find((category) => category.name === 'Repairs')?.isSystem).toBe(false);
    });

    it('carries the inactive status on a historical expense instead of on the list', async () => {
      // The two halves of the rule above, proven together: the list omits a deactivated
      // category, and the expense filed under it is still readable with that category named
      // and marked inactive, so history is never stripped of its label.
      const list = dataOf<readonly ExpenseCategoryView[]>(
        (await authGet('/api/v1/expenses/categories')).body,
      );

      expect(list.some((category) => category.name === 'Retired category')).toBe(false);

      const historical = listOf<ExpenseSummary>(
        (await authGet(`/api/v1/expenses?categoryId=${INACTIVE_CATEGORY_ID}`)).body,
      );

      expect(historical.data[0]?.category?.name).toBe('Retired category');
      expect(historical.data[0]?.category?.status).toBe('INACTIVE');
    });

    it('returns real ISO timestamps, not a bare date', async () => {
      const categories = dataOf<readonly ExpenseCategoryView[]>(
        (await authGet('/api/v1/expenses/categories')).body,
      );

      expect(categories[0]?.createdAt).toBe('2026-09-01T00:00:00.000Z');
      expect(categories[0]?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('is a plain data array rather than a paged envelope', async () => {
      // The set is a bounded configuration list, not a ledger. A pager on a dropdown would be
      // a control that does nothing useful.
      const response = await authGet('/api/v1/expenses/categories');

      expect(isApiListEnvelope(response.body)).toBe(false);
      expect(Array.isArray(dataOf<unknown>(response.body))).toBe(true);
    });

    it('is not matched as a category identifier', async () => {
      // If `categories` were declared after a `:id` route it would be read as an id and
      // refused as malformed, which would make the whole list unreachable.
      const response = await authGet('/api/v1/expenses/categories');

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/v1/expenses/categories', () => {
    it('adds a custom category', async () => {
      const response = await createCategory('category-create-1', { name: 'Books' });

      expect(response.status).toBe(201);

      const created = dataOf<ExpenseCategoryView>(response.body);

      expect(created.name).toBe('Books');
      // An Admin-created category is always custom; the initial set belongs to the product.
      expect(created.isSystem).toBe(false);
      expect(created.status).toBe('ACTIVE');
    });

    it('trims the name before storing it', async () => {
      const response = await createCategory('category-create-trim', { name: '  Books  ' });

      expect(dataOf<ExpenseCategoryView>(response.body).name).toBe('Books');
    });

    it('refuses a duplicate name that differs only by case or whitespace', async () => {
      // Uniqueness is case-insensitive, so "books" and "Books " are the same category and a
      // second row would make an expense's category ambiguous. The original is created first,
      // so each attempt below collides with a row that really exists.
      const original = await createCategory('category-dup-original', { name: 'Books' });
      const lower = await createCategory('category-dup-lower', { name: 'books' });
      const padded = await createCategory('category-dup-padded', { name: 'Books ' });

      expect(original.status).toBe(201);
      expectApiError(lower, 409, 'CONFLICT', 'name');
      expectApiError(padded, 409, 'CONFLICT', 'name');
      // Both refusals left the category set alone, so no near-duplicate row was stored.
      expect(categories.created).toHaveLength(1);
    });

    it('refuses a name that is empty or over the documented length', async () => {
      const empty = await createCategory('category-empty', { name: '   ' });
      const tooLong = await createCategory('category-too-long', {
        name: 'x'.repeat(EXPENSE_CATEGORY_NAME_MAX_LENGTH + 1),
      });
      const atLimit = await createCategory('category-at-limit', {
        name: 'x'.repeat(EXPENSE_CATEGORY_NAME_MAX_LENGTH),
      });

      expectApiError(empty, 400, 'VALIDATION_FAILED', 'name');
      expectApiError(tooLong, 400, 'VALIDATION_FAILED', 'name');
      expect(atLimit.status).toBe(201);
    });

    it('refuses a request that claims the category is part of the initial set', async () => {
      // The initial set is a documented product set (`REQ-EXP-001`). Accepting the flag would
      // let a request manufacture membership of it.
      const response = await createCategory('category-is-system', {
        name: 'Injected',
        isSystem: true,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'isSystem');
    });

    it('requires an Idempotency-Key', async () => {
      const response = await authed().post('/api/v1/expenses/categories').send({ name: 'Books' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'idempotency-key');
      expect(categories.created).toHaveLength(0);
    });

    it('replays the original category rather than creating a second one', async () => {
      // Two categories differing only by trailing whitespace would be indistinguishable in a
      // dropdown and would split the same kind of expense across two rows.
      const first = await createCategory('category-replay-1', { name: 'Books' });
      const second = await createCategory('category-replay-1', { name: 'Books' });

      expect(dataOf<ExpenseCategoryView>(second.body).id).toBe(
        dataOf<ExpenseCategoryView>(first.body).id,
      );
      expect(categories.created).toHaveLength(1);
    });

    it('refuses the same key with a different payload', async () => {
      await createCategory('category-key-reuse-1', { name: 'Books' });
      const reused = await createCategory('category-key-reuse-1', { name: 'Stationery' });

      expectApiError(reused, 409, 'CONFLICT');
    });
  });

  describe('PATCH /api/v1/expenses/categories/:id', () => {
    it('renames a category', async () => {
      const response = await updateCategory('category-rename-1', CATEGORY_ID, {
        name: 'Electricity and Power',
      });

      expect(response.status).toBe(200);

      const updated = dataOf<ExpenseCategoryView>(response.body);

      expect(updated.name).toBe('Electricity and Power');
      expect(updated.id).toBe(CATEGORY_ID);
    });

    it('deactivates a category without deleting it, so history keeps its label', async () => {
      // `docs/05-DATABASE-SPEC.md`: a category is deactivated, never deleted. The row and every
      // historical expense survive so the label still reads correctly.
      const deactivated = await updateCategory('category-deactivate-1', OTHER_CATEGORY_ID, {
        status: 'INACTIVE',
      });

      expect(dataOf<ExpenseCategoryView>(deactivated.body).status).toBe('INACTIVE');

      const remaining = dataOf<readonly ExpenseCategoryView[]>(
        (await authGet('/api/v1/expenses/categories')).body,
      );

      // The row itself still exists, so every expense filed under it keeps its label; the only
      // thing that changed is that it is no longer offered for a new entry. Proving the
      // *absence* is the point: a deactivated category in this list would be a dropdown option
      // the create form submits and the server refuses.
      expect(remaining.map((category) => category.name)).toEqual(['Electricity']);
      expect(remaining.some((category) => category.name === 'Repairs')).toBe(false);

      const historical = listOf<ExpenseSummary>(
        (await authGet(`/api/v1/expenses?categoryId=${OTHER_CATEGORY_ID}`)).body,
      );

      expect(historical.pagination.totalItems).toBe(3);
      expect(historical.data.every((row) => row.category?.status === 'INACTIVE')).toBe(true);
      expect(historical.data.every((row) => row.category?.name === 'Repairs')).toBe(true);
    });

    it('refuses a new expense once its category is deactivated', async () => {
      await updateCategory('category-deactivate-2', OTHER_CATEGORY_ID, { status: 'INACTIVE' });

      const response = await createExpense(
        'expense-after-deactivation',
        expenseBody({ categoryId: OTHER_CATEGORY_ID, expenseReasonId: OTHER_CATEGORY_REASON_ID }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('reactivates a category', async () => {
      const response = await updateCategory('category-reactivate-1', INACTIVE_CATEGORY_ID, {
        status: 'ACTIVE',
      });

      expect(dataOf<ExpenseCategoryView>(response.body).status).toBe('ACTIVE');

      const accepted = await createExpense(
        'expense-after-reactivation',
        expenseBody({
          categoryId: INACTIVE_CATEGORY_ID,
          expenseReasonId: RETIRED_CATEGORY_REASON_ID,
        }),
      );

      expect(accepted.status).toBe(201);
    });

    it('renames and changes the status together', async () => {
      const response = await updateCategory('category-both-1', OTHER_CATEGORY_ID, {
        name: 'Repairs and Maintenance',
        status: 'INACTIVE',
      });

      const updated = dataOf<ExpenseCategoryView>(response.body);

      expect(updated.name).toBe('Repairs and Maintenance');
      expect(updated.status).toBe('INACTIVE');
    });

    it('refuses a change that changes nothing', async () => {
      // An audit event with identical before and after values would make the history lie about
      // what happened.
      const response = await updateCategory('category-noop-1', CATEGORY_ID, {});

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(categories.updated).toHaveLength(0);
    });

    it('refuses a rename onto a name another category already uses', async () => {
      const response = await updateCategory('category-rename-clash-1', CATEGORY_ID, {
        name: 'repairs',
      });

      expectApiError(response, 409, 'CONFLICT', 'name');
    });

    it('allows a rename to the same name in a different case', async () => {
      // Not a duplicate: the name is unchanged, and a church should be able to fix its own
      // capitalisation without being told the category already exists.
      const response = await updateCategory('category-recase-1', CATEGORY_ID, {
        name: 'ELECTRICITY',
      });

      expect(response.status).toBe(200);
      expect(dataOf<ExpenseCategoryView>(response.body).name).toBe('ELECTRICITY');
    });

    it('refuses an unknown category', async () => {
      const response = await updateCategory('category-unknown-1', UNKNOWN_CATEGORY_ID, {
        name: 'Nothing',
      });

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('refuses an id that is not a UUID, rather than reporting a missing category', async () => {
      const response = await updateCategory('category-bad-uuid-1', NOT_A_UUID, { name: 'Nothing' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'id');
    });

    it('refuses a request that tries to change the system flag', async () => {
      const response = await updateCategory('category-is-system-patch', CATEGORY_ID, {
        isSystem: false,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'isSystem');
      expect(categories.updated).toHaveLength(0);
    });

    it('replays an identical retry rather than recording a second change', async () => {
      const first = await updateCategory('category-replay-patch-1', CATEGORY_ID, {
        status: 'INACTIVE',
      });
      const second = await updateCategory('category-replay-patch-1', CATEGORY_ID, {
        status: 'INACTIVE',
      });

      expect(dataOf<ExpenseCategoryView>(second.body).updatedAt).toBe(
        dataOf<ExpenseCategoryView>(first.body).updatedAt,
      );
      expect(categories.updated).toHaveLength(1);
    });

    it('refuses the same key with a different payload', async () => {
      await updateCategory('category-patch-key-reuse', CATEGORY_ID, { status: 'INACTIVE' });
      const reused = await updateCategory('category-patch-key-reuse', CATEGORY_ID, {
        status: 'ACTIVE',
      });

      expectApiError(reused, 409, 'CONFLICT');
    });

    it('offers no delete route, so a category cannot be removed from history', async () => {
      // `docs/05-DATABASE-SPEC.md` deactivates a category instead of deleting it, so historical
      // expenses keep the label they were recorded with. A route that removed the row would
      // silently rewrite that history.
      const response = await authed().delete(`/api/v1/expenses/categories/${CATEGORY_ID}`);

      expect([404, 405]).toContain(response.status);
      expect((await categories.findById(CATEGORY_ID)).id).toBe(CATEGORY_ID);
    });
  });

  describe('an expense on the shared transaction routes', () => {
    it('reads the detail with its category', async () => {
      const response = await authGet(`/api/v1/transactions/${ELECTRICITY}`);

      const detail = dataOf<TransactionSummary>(response.body);

      expect(detail.type).toBe('EXPENSE');
      expect(detail.category).toEqual({ id: CATEGORY_ID, name: 'Electricity', status: 'ACTIVE' });
    });

    it('answers 404 for a well-formed id that no expense uses', async () => {
      // A real UUID that does not exist is a missing record, which is different from a
      // malformed id; the two must not collapse into one answer.
      const response = await authGet(`/api/v1/transactions/${UNKNOWN_TRANSACTION_ID}`);

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('answers 400, not 404, when an expense is asked for an income receipt', async () => {
      // The transaction exists and is readable, so a 404 would tell the Admin their record is
      // gone. Receipts are an income concept; an expense reports **Receipt Missing** instead.
      const response = await authGet(`/api/v1/transactions/${ELECTRICITY}/receipt`);

      expectApiError(response, 400, 'VALIDATION_FAILED', 'id');
    });

    it('moves an expense to a different active category and reason together', async () => {
      // `REQ-EXP-005` is a rule about the pair, so the correction carries both. Moving only the
      // category would leave a reason from the old category, which the pairing trigger refuses.
      const response = await correctTransaction('expense-correct-category', REPAIRS, '1', {
        categoryId: CATEGORY_ID,
        expenseReasonId: CATEGORY_REASON_ID,
      });

      expect(response.status).toBe(200);

      const corrected = dataOf<TransactionSummary>(response.body);

      expect(corrected.category?.id).toBe(CATEGORY_ID);
      expect(corrected.expenseReason?.id).toBe(CATEGORY_REASON_ID);
      expect(corrected.revision).toBe(2);
    });

    it('refuses to move the category without the reason', async () => {
      // The documented `400` that arrives before anything is written, rather than a half-applied
      // correction the database would reject.
      const response = await correctTransaction('expense-correct-category-only', REPAIRS, '1', {
        categoryId: CATEGORY_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
      expect(ledger.row(REPAIRS)?.categoryId).toBe(OTHER_CATEGORY_ID);
      expect(ledger.row(REPAIRS)?.revision).toBe(1);
    });

    it('refuses a reason that belongs to another category', async () => {
      // The pair is sent together, so the failure is the pairing rather than the "must be corrected
      // together" rule, which is covered separately above.
      const response = await correctTransaction('expense-correct-foreign-reason', REPAIRS, '1', {
        categoryId: OTHER_CATEGORY_ID,
        expenseReasonId: WRONG_CATEGORY_REASON_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
      expect(ledger.row(REPAIRS)?.expenseReasonId).toBe(OTHER_CATEGORY_REASON_ID);
    });

    it('refuses a reason that has been deactivated', async () => {
      // An *active* reason under an active category that has been retired: only the status makes
      // this invalid, so a double that ignored status would accept it.
      await updateReason('reason-retire-for-correction', INACTIVE_REASON_UNDER_ACTIVE_CATEGORY_ID, {
        status: 'INACTIVE',
      });

      const response = await correctTransaction('expense-correct-inactive-reason', REPAIRS, '1', {
        categoryId: OTHER_CATEGORY_ID,
        expenseReasonId: INACTIVE_REASON_UNDER_ACTIVE_CATEGORY_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
      expect(ledger.row(REPAIRS)?.expenseReasonId).toBe(OTHER_CATEGORY_REASON_ID);
      expect(ledger.row(REPAIRS)?.revision).toBe(1);
    });

    it('refuses to clear the category, because an expense must always have exactly one', async () => {
      // `REQ-EXP-004`. A correction that stripped the category would leave an expense the
      // database constraint forbids, so the request is refused instead of half-applied.
      const response = await correctTransaction('expense-correct-clear-category', REPAIRS, '1', {
        categoryId: null,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('refuses to clear the reason, because an expense must always have exactly one', async () => {
      const response = await correctTransaction('expense-correct-clear-reason', REPAIRS, '1', {
        expenseReasonId: null,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
    });

    it('refuses to move an expense to a deactivated category', async () => {
      const response = await correctTransaction('expense-correct-inactive-category', REPAIRS, '1', {
        categoryId: INACTIVE_CATEGORY_ID,
        expenseReasonId: RETIRED_CATEGORY_REASON_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('refuses to attach a member to an expense', async () => {
      const response = await correctTransaction('expense-correct-member', REPAIRS, '1', {
        memberId: MEMBER_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'memberId');
    });

    it('corrects an amount and records it in the audit trail', async () => {
      // The expense is created through the route first, so the trail being read is the one a
      // real Admin would leave: a creation event followed by the correction.
      const created = dataOf<ExpenseSummary>(
        (await createExpense('expense-correct-create', expenseBody())).body,
      );
      const response = await correctTransaction(
        'expense-correct-amount',
        created.id,
        String(created.revision),
        { amount: '460.50' },
      );

      expect(dataOf<TransactionSummary>(response.body).amount).toBe('460.50');

      const audit = dataOf<readonly { action: string; before: unknown; after: unknown }[]>(
        (await authGet(`/api/v1/transactions/${created.id}/audit`)).body,
      );

      expect(audit.map((event) => event.action)).toEqual([
        'TRANSACTION_CREATED',
        'TRANSACTION_UPDATED',
      ]);
      // The audit snapshots hold paise as strings, so the correction is readable afterwards
      // without the audit trail itself becoming a second, differently-rounded amount.
      expect(JSON.stringify(audit[1]?.before)).toContain('45000');
      expect(JSON.stringify(audit[1]?.after)).toContain('46050');
    });

    it('refuses a correction with a stale revision rather than overwriting a change', async () => {
      const response = await correctTransaction('expense-correct-stale', REPAIRS, '9', {
        amount: '1.00',
      });

      expect(response.status).toBe(409);
    });

    it('voids an expense, keeps it readable, and records the reason', async () => {
      const voided = await authed()
        .post(`/api/v1/transactions/${REPAIRS}/void`)
        .set(IDEMPOTENCY_KEY_HEADER, 'expense-void-1')
        .send({ reason: 'Entered against the wrong category' });

      expect(voided.status).toBe(200);

      const transaction = dataOf<TransactionSummary>(voided.body);

      // The row survives with its amount and its history; it leaves active totals by its
      // status, not by being removed.
      expect(transaction.status).toBe('VOIDED');
      expect(transaction.voidReason).toBe('Entered against the wrong category');
      expect(transaction.amount).toBe('123.45');

      const detail = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${REPAIRS}`)).body,
      );

      expect(detail.status).toBe('VOIDED');

      const active = listOf<ExpenseSummary>((await authGet('/api/v1/expenses?status=ACTIVE')).body);

      expect(active.data.map((row) => row.id)).not.toContain(REPAIRS);
    });

    it('refuses to edit a voided expense', async () => {
      const response = await correctTransaction('expense-correct-voided', VOIDED_EXPENSE, '2', {
        amount: '1.00',
      });

      expect(response.status).toBe(409);
    });

    it('requires a void reason', async () => {
      const response = await authed()
        .post(`/api/v1/transactions/${REPAIRS}/void`)
        .set(IDEMPOTENCY_KEY_HEADER, 'expense-void-no-reason')
        .send({ reason: '   ' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'reason');
    });
  });

  describe('REQ-DOC-003: the receipt state is derived, never hard-coded', () => {
    it('reports no receipt for an expense with no attached document', async () => {
      const page = listOf<ExpenseSummary>((await authGet('/api/v1/expenses')).body);

      const withoutReceipt = page.data.filter((row) => row.documentCount === 0);

      expect(withoutReceipt.length).toBeGreaterThan(0);
      expect(withoutReceipt.every((row) => row.hasReceipt === false)).toBe(true);
    });

    it('reports a receipt for an expense that has an attached document', async () => {
      // The projection follows the document rows, so it cannot drift from what is attached.
      // Phase 07 owns attaching documents; this fixture only proves the derivation.
      const detail = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${ATTACHED_RECEIPT}`)).body,
      );

      expect(detail.documentCount).toBe(1);

      const page = listOf<ExpenseSummary>((await authGet('/api/v1/expenses')).body);
      const attached = page.data.find((row) => row.id === ATTACHED_RECEIPT);

      expect(attached?.hasReceipt).toBe(true);
    });

    it('reports no receipt for a newly created expense, because nothing is attached yet', async () => {
      const created = dataOf<ExpenseSummary>(
        (await createExpense('expense-receipt-missing', expenseBody())).body,
      );

      expect(created.hasReceipt).toBe(false);
      expect(created.documentCount).toBe(0);
    });

    it('carries the expense guarantees on the shared transaction detail route', async () => {
      // The expense screen reads `GET /api/v1/transactions/{id}` rather than a second expense
      // route, so that route is where `hasReceipt` and the non-null category have to survive.
      // Returning the shared shape without them is not merely lossy: the browser cannot tell
      // "no receipt" from "an older API", and `REQ-DOC-003` requires it to say
      // **Receipt Missing** instead of rendering an empty control. It is also why the projection
      // is chosen in one place (`toTransactionView`) rather than per route.
      const withReceipt = dataOf<ExpenseSummary>(
        (await authGet(`/api/v1/transactions/${ATTACHED_RECEIPT}`)).body,
      );
      const withoutReceipt = dataOf<ExpenseSummary>(
        (await authGet(`/api/v1/transactions/${ELECTRICITY}`)).body,
      );

      expect(withReceipt.hasReceipt).toBe(true);
      expect(withReceipt.category?.id).toBe(OTHER_CATEGORY_ID);
      expect(withoutReceipt.hasReceipt).toBe(false);
      expect(withoutReceipt.category?.id).toBe(CATEGORY_ID);
    });

    it('carries the expense guarantees on the correction and void responses', async () => {
      // A screen that renders the mutation's own answer rather than refetching must not see a
      // shape that drops them, or the receipt state would appear and disappear across a
      // correction.
      const corrected = dataOf<ExpenseSummary>(
        (await correctTransaction('expense-receipt-corrected', REPAIRS, '1', { amount: '460.00' }))
          .body,
      );
      const voidedResponse = await authed()
        .post(`/api/v1/transactions/${RETIRED_CATEGORY_EXPENSE}/void`)
        .set(IDEMPOTENCY_KEY_HEADER, 'expense-receipt-voided')
        .send({ reason: 'Duplicate entry' });
      const voided = dataOf<ExpenseSummary>(voidedResponse.body);

      expect(corrected.hasReceipt).toBe(false);
      expect(corrected.category?.id).toBe(OTHER_CATEGORY_ID);
      expect(voided.hasReceipt).toBe(false);
      // The category is still resolved on a voided record, so the screen can say which category
      // the money was spent under even though the expense no longer counts anywhere.
      expect(voided.category?.id).toBe(INACTIVE_CATEGORY_ID);
    });
  });

  describe('audit attribution', () => {
    it('records the authenticated Admin as the actor of a category change', async () => {
      await updateCategory('category-audit-1', CATEGORY_ID, { name: 'Power' });

      // The category double records the actor it was handed, so this asserts the *service*
      // attributed the write to the session rather than to a constant.
      expect(categories.updated[0]?.actorAdminId).toBe(ADMIN_ID);
    });

    it('records the authenticated Admin as the actor of a reason change', async () => {
      await updateReason('reason-audit-1', CATEGORY_REASON_ID, { status: 'INACTIVE' });

      expect(reasons.updated[0]?.actorAdminId).toBe(ADMIN_ID);
    });
  });

  describe('REQ-EXP-005: reasons are scoped to their category', () => {
    it('refuses every reason read route without a session', async () => {
      for (const url of [
        `/api/v1/expenses/reasons?categoryId=${CATEGORY_ID}`,
        '/api/v1/expenses/reasons',
      ]) {
        expectApiError(await request(httpServer(app)).get(url), 401, 'UNAUTHENTICATED');
      }
    });

    it('refuses a reason create and a reason update without a session', async () => {
      const created = await request(httpServer(app))
        .post('/api/v1/expenses/reasons')
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-reason-1')
        .send({ categoryId: CATEGORY_ID, name: 'Diesel Generator' });

      const updated = await request(httpServer(app))
        .patch(`/api/v1/expenses/reasons/${CATEGORY_REASON_ID}`)
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-reason-2')
        .send({ status: 'INACTIVE' });

      expectApiError(created, 401, 'UNAUTHENTICATED');
      expectApiError(updated, 401, 'UNAUTHENTICATED');
    });

    it('returns only the active reasons of the requested category', async () => {
      await updateReason('reason-deactivate-1', CATEGORY_REASON_ID, { status: 'INACTIVE' });

      const response = await authGet(`/api/v1/expenses/reasons?categoryId=${CATEGORY_ID}`);

      expect(response.status).toBe(200);

      const data = dataOf<readonly ExpenseReasonView[]>(response.body);
      // The picker offers what may be chosen, so a retired reason is absent rather than greyed out.
      // The historical expense still resolves its own label from the stored reference.
      expect(data.map((reason) => reason.id)).toEqual([WRONG_CATEGORY_REASON_ID]);
      expect(data.every((reason) => reason.status === 'ACTIVE')).toBe(true);
      expect(data.every((reason) => reason.categoryId === CATEGORY_ID)).toBe(true);
    });

    it('never leaks a reason from another category into the list', async () => {
      const data = dataOf<readonly ExpenseReasonView[]>(
        (await authGet(`/api/v1/expenses/reasons?categoryId=${OTHER_CATEGORY_ID}`)).body,
      );

      // Both reasons belong to this category, and nothing belonging to another category appears —
      // which is what makes the list safe to drive a dropdown from. Sorted by name, as the
      // repository orders them.
      expect(data.map((reason) => reason.id)).toEqual([
        INACTIVE_REASON_UNDER_ACTIVE_CATEGORY_ID,
        OTHER_CATEGORY_REASON_ID,
      ]);
      expect(data.every((reason) => reason.categoryId === OTHER_CATEGORY_ID)).toBe(true);
    });

    it('requires the category filter, rather than returning every reason', async () => {
      const response = await authGet('/api/v1/expenses/reasons');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('rejects a category filter that is not a UUID', async () => {
      const response = await authGet('/api/v1/expenses/reasons?categoryId=Electricity');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('answers 404 for a category that does not exist, rather than an empty list', async () => {
      // An empty array would tell the Admin "this category has no reasons" — a conclusion they
      // would act on. The category is genuinely missing, so that is what the answer must say.
      const response = await authGet(`/api/v1/expenses/reasons?categoryId=${UNKNOWN_CATEGORY_ID}`);

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('adds a custom reason under an active category and trims the name', async () => {
      const response = await createReason('reason-create-1', {
        categoryId: CATEGORY_ID,
        name: '  Diesel Generator  ',
      });

      expect(response.status).toBe(201);

      const created = dataOf<ExpenseReasonView>(response.body);

      expect(created.name).toBe('Diesel Generator');
      expect(created.status).toBe('ACTIVE');
      // A reason an Admin typed is never marked as part of the documented set, or a later rename
      // would be blocked by a flag that only the seed is allowed to set.
      expect(created.isSystem).toBe(false);
      expect(created.categoryId).toBe(CATEGORY_ID);

      const listed = dataOf<readonly ExpenseReasonView[]>(
        (await authGet(`/api/v1/expenses/reasons?categoryId=${CATEGORY_ID}`)).body,
      );

      expect(listed.map((reason) => reason.id)).toContain(created.id);
    });

    it('refuses a duplicate reason name in the same category, whatever the case or spacing', async () => {
      const response = await createReason('reason-duplicate-1', {
        categoryId: CATEGORY_ID,
        name: '  electricity BILL ',
      });

      expectApiError(response, 409, 'CONFLICT', 'name');
      expect(reasons.created).toHaveLength(0);
    });

    it('accepts the same reason name under a different category', async () => {
      // Uniqueness is on the pair. `Groceries` already exists under `Electricity` in this fixture,
      // and the database allows it here, so a double that compared names globally would refuse
      // data the real schema stores without complaint.
      const response = await createReason('reason-other-category-1', {
        categoryId: OTHER_CATEGORY_ID,
        name: 'Groceries',
      });

      expect(response.status).toBe(201);
      expect(dataOf<ExpenseReasonView>(response.body).categoryId).toBe(OTHER_CATEGORY_ID);
    });

    it('refuses a name that is empty or over the documented length', async () => {
      const blank = await createReason('reason-blank-1', {
        categoryId: CATEGORY_ID,
        name: '   ',
      });

      const tooLong = await createReason('reason-too-long-1', {
        categoryId: CATEGORY_ID,
        name: 'x'.repeat(EXPENSE_REASON_NAME_MAX_LENGTH + 1),
      });

      expectApiError(blank, 400, 'VALIDATION_FAILED', 'name');
      expectApiError(tooLong, 400, 'VALIDATION_FAILED', 'name');
    });

    it('refuses a reason under an unknown category', async () => {
      const response = await createReason('reason-unknown-category-1', {
        categoryId: UNKNOWN_CATEGORY_ID,
        name: 'Anything',
      });

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('refuses a reason under a deactivated category', async () => {
      await updateCategory('reason-category-deactivated', INACTIVE_CATEGORY_ID, {
        status: 'INACTIVE',
      });

      const response = await createReason('reason-inactive-category-1', {
        categoryId: INACTIVE_CATEGORY_ID,
        name: 'Late Addition',
      });

      // The reason would exist but could never be selected, so it is refused rather than stored.
      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('refuses a reason create without an Idempotency-Key', async () => {
      const response = await authed()
        .post('/api/v1/expenses/reasons')
        .send({ categoryId: CATEGORY_ID, name: 'No Key' });

      expectApiError(response, 400, 'VALIDATION_FAILED', IDEMPOTENCY_KEY_HEADER);
    });

    it('replays the original reason rather than creating a second one', async () => {
      const first = await createReason('reason-replay-1', {
        categoryId: CATEGORY_ID,
        name: 'Inverter Battery',
      });
      const second = await createReason('reason-replay-1', {
        categoryId: CATEGORY_ID,
        name: 'Inverter Battery',
      });

      expect(second.status).toBe(201);
      expect(dataOf<ExpenseReasonView>(second.body).id).toBe(
        dataOf<ExpenseReasonView>(first.body).id,
      );
      expect(reasons.created).toHaveLength(1);
    });

    it('refuses the same key with a different payload', async () => {
      await createReason('reason-replay-2', {
        categoryId: CATEGORY_ID,
        name: 'Inverter Battery',
      });

      const response = await createReason('reason-replay-2', {
        categoryId: CATEGORY_ID,
        name: 'Something Else Entirely',
      });

      expectApiError(response, 409, 'CONFLICT', 'idempotencyKey');
      expect(reasons.created).toHaveLength(1);
    });

    it('renames a reason without changing what its history refers to', async () => {
      const response = await updateReason('reason-rename-1', CATEGORY_REASON_ID, {
        name: 'Electricity Bill (Tata Power)',
      });

      expect(dataOf<ExpenseReasonView>(response.body).name).toBe('Electricity Bill (Tata Power)');

      // The expense still points at the same row, so a rename relabels history rather than
      // detaching it. This is why reasons are corrected through a row reference and never by
      // rewriting the stored label on each expense.
      const historical = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${ELECTRICITY}`)).body,
      );

      expect(historical.expenseReason?.id).toBe(CATEGORY_REASON_ID);
      expect(historical.expenseReason?.name).toBe('Electricity Bill (Tata Power)');
    });

    it('deactivates a reason so a historical expense stays readable but the reason is unselectable', async () => {
      const response = await updateReason('reason-deactivate-2', CATEGORY_REASON_ID, {
        status: 'INACTIVE',
      });

      expect(dataOf<ExpenseReasonView>(response.body).status).toBe('INACTIVE');

      const historical = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${ELECTRICITY}`)).body,
      );

      expect(historical.expenseReason?.status).toBe('INACTIVE');
      expect(historical.expenseReason?.name).toBe('Electricity Bill');

      const refused = await createExpense(
        'expense-deactivated-reason',
        expenseBody({ expenseReasonId: CATEGORY_REASON_ID }),
      );

      expectApiError(refused, 400, 'VALIDATION_FAILED', 'expenseReasonId');
    });

    it('refuses an unknown reason and an id that is not a UUID', async () => {
      const unknown = await updateReason('reason-update-unknown', UNKNOWN_REASON_ID, {
        name: 'Anything',
      });
      const malformed = await updateReason('reason-update-malformed', NOT_A_UUID_REASON, {
        name: 'Anything',
      });

      expectApiError(unknown, 404, 'NOT_FOUND');
      // A malformed id is a bad request, not a missing reason: reporting `404` would tell the
      // Admin to look for something they mistyped.
      expectApiError(malformed, 400, 'VALIDATION_FAILED', 'id');
    });

    it('refuses a change that changes nothing', async () => {
      const response = await updateReason('reason-noop-1', CATEGORY_REASON_ID, {});

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(reasons.updated).toHaveLength(0);
    });

    it('refuses a rename onto a name the same category already uses', async () => {
      const response = await updateReason('reason-rename-clash-1', CATEGORY_REASON_ID, {
        name: 'groceries',
      });

      expectApiError(response, 409, 'CONFLICT', 'name');

      const historical = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${ELECTRICITY}`)).body,
      );

      // The refused rename must not have taken effect: a `409` that still moved the label would
      // leave the history and the reason row disagreeing about the same record.
      expect(historical.expenseReason?.name).toBe('Electricity Bill');
    });

    it('allows a rename to the same name in a different case', async () => {
      const response = await updateReason('reason-recase-1', CATEGORY_REASON_ID, {
        name: 'ELECTRICITY BILL',
      });

      expect(dataOf<ExpenseReasonView>(response.body).name).toBe('ELECTRICITY BILL');
    });

    it('offers no delete route, so a reason cannot be removed from history', async () => {
      const response = await authed()
        .delete(`/api/v1/expenses/reasons/${CATEGORY_REASON_ID}`)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN);

      expect(response.status).toBe(404);
    });
  });

  describe('REQ-EXP-005: a new expense names an active reason of its own category', () => {
    it('records the reason alongside the category', async () => {
      const created = dataOf<ExpenseSummary>(
        (await createExpense('expense-with-reason-1', expenseBody())).body,
      );

      expect(created.category?.id).toBe(CATEGORY_ID);
      expect(created.expenseReason.id).toBe(CATEGORY_REASON_ID);
      expect(created.expenseReason.name).toBe('Electricity Bill');
      expect(created.expenseReason.categoryId).toBe(CATEGORY_ID);
    });

    it('refuses an expense with no reason at all', async () => {
      const response = await createExpense('expense-missing-reason', {
        amount: '450.00',
        paymentMethod: 'UPI',
        businessDate: '2026-09-05',
        categoryId: CATEGORY_ID,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a reason that belongs to a different category', async () => {
      const response = await createExpense(
        'expense-foreign-reason',
        expenseBody({ categoryId: OTHER_CATEGORY_ID, expenseReasonId: CATEGORY_REASON_ID }),
      );

      // `400` naming the reason, not `404`: the reason exists, the pairing in the request is wrong.
      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
      expect(transactions.createCalls).toHaveLength(0);
    });

    it('refuses a reason that has been deactivated', async () => {
      await updateReason('reason-deactivate-3', CATEGORY_REASON_ID, { status: 'INACTIVE' });

      const response = await createExpense(
        'expense-inactive-reason',
        expenseBody({ expenseReasonId: CATEGORY_REASON_ID }),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
    });

    it('refuses an unknown reason id', async () => {
      const response = await createExpense(
        'expense-unknown-reason',
        expenseBody({ expenseReasonId: UNKNOWN_REASON_ID }),
      );

      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('carries the reason on the shared transaction detail route', async () => {
      const detail = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${ELECTRICITY}`)).body,
      );

      expect(detail.expenseReason?.id).toBe(CATEGORY_REASON_ID);
      expect(detail.expenseReason?.name).toBe('Electricity Bill');
    });

    it('carries the reason status, so a retired reason is visibly retired on its own expenses', async () => {
      const created = dataOf<ExpenseSummary>(
        (
          await createExpense(
            'expense-before-its-reason-retires',
            expenseBody({ expenseReasonId: WRONG_CATEGORY_REASON_ID }),
          )
        ).body,
      );

      await updateReason('reason-deactivate-4', WRONG_CATEGORY_REASON_ID, {
        status: 'INACTIVE',
      });

      // The expense that used the retired reason keeps it and shows it as retired. Dropping the
      // reference or blanking the label is what deletion would have done, and both would make the
      // record unexplainable after the fact.
      const detail = dataOf<TransactionSummary>(
        (await authGet(`/api/v1/transactions/${created.id}`)).body,
      );

      expect(detail.expenseReason?.id).toBe(WRONG_CATEGORY_REASON_ID);
      expect(detail.expenseReason?.name).toBe('Groceries');
      expect(detail.expenseReason?.status).toBe('INACTIVE');

      // And it is gone from the picker, so it cannot be chosen again.
      const offered = dataOf<readonly ExpenseReasonView[]>(
        (await authGet(`/api/v1/expenses/reasons?categoryId=${CATEGORY_ID}`)).body,
      );

      expect(offered.map((reason) => reason.id)).not.toContain(WRONG_CATEGORY_REASON_ID);
    });

    it('refuses a reason on an income, because reasons describe how money was spent', async () => {
      const response = await authed()
        .post('/api/v1/income')
        .set(IDEMPOTENCY_KEY_HEADER, 'income-with-reason-1')
        .send({
          incomeType: 'OFFERING',
          amount: '100.00',
          paymentMethod: 'CASH',
          businessDate: '2026-09-05',
          expenseReasonId: CATEGORY_REASON_ID,
        });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'expenseReasonId');
    });

    it('finds an expense by its reason name', async () => {
      const page = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=Electricity+Bill')).body,
      );

      // The reason name is part of the search box because `REQ-EXP-005` makes it how an Admin
      // looks for "what did we spend on fuel" without first knowing which reference that is.
      expect(page.pagination.totalItems).toBe(1);
      expect(page.data[0]?.referenceId).toBe('HY-EXP-000001');
    });

    it('finds nothing for a reason name no expense uses', async () => {
      const page = listOf<ExpenseSummary>(
        (await authGet('/api/v1/expenses?search=Diesel+Generator')).body,
      );

      expect(page.data).toEqual([]);
      expect(page.pagination.totalItems).toBe(0);
    });
  });

  /**
   * `REQ-EXPORT-003`: the filtered expense CSV.
   *
   * The writer itself is covered by `report-csv.spec.ts`. What only a request can prove is the part
   * that actually decides the contents: that the required category filter is enforced, that the rows
   * are the same expenses the list route returns, and that the two "honestly missing" facts -- no
   * notes and no receipt -- reach the file as empty cells rather than as invented text.
   */
  describe('GET /api/v1/reports/expense-transactions/export.csv', () => {
    const EXPORT_PATH = '/api/v1/reports/expense-transactions/export.csv';

    /** Data lines only, so a header assertion and a row assertion cannot be confused. */
    function dataLines(csv: string): readonly string[] {
      return csv.trimEnd().split('\r\n').slice(1);
    }

    it('offers the file as an attachment with a CSV content type', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${CATEGORY_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('expense-transactions.csv');
    });

    it('refuses an export with no category, rather than exporting the whole ledger', async () => {
      const response = await authGet(EXPORT_PATH);

      expectApiError(response, 400, 'VALIDATION_FAILED', 'categoryId');
    });

    it('refuses a page or page size, because a paged export is an incomplete export', async () => {
      // Rejected outright rather than ignored: silently dropping the parameter would return the
      // whole set while the caller believed they had asked for one page of it.
      expectApiError(
        await authGet(`${EXPORT_PATH}?categoryId=${CATEGORY_ID}&page=1`),
        400,
        'VALIDATION_FAILED',
        'page',
      );
      expectApiError(
        await authGet(`${EXPORT_PATH}?categoryId=${CATEGORY_ID}&pageSize=10`),
        400,
        'VALIDATION_FAILED',
        'pageSize',
      );
    });

    it('requires a session like every other read', async () => {
      const response = await request(httpServer(app)).get(
        `${EXPORT_PATH}?categoryId=${CATEGORY_ID}`,
      );

      expect([401, 403]).toContain(response.status);
    });

    it('writes the approved columns and only the expenses of the chosen category', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);
      const [header, ...rows] = response.text.trimEnd().split('\r\n');

      expect(header).toBe(
        'Expense ID,Expense Date,Category,Reason,Vendor,Amount,Payment Method,Notes,Receipt URL',
      );
      // The other category holds REPAIRS, VOIDED_EXPENSE, and ATTACHED_RECEIPT, and nothing that
      // belongs to CATEGORY_ID may leak in -- a filter the file ignores would still look plausible.
      for (const reference of ['HY-EXP-000002', 'HY-EXP-000004', 'HY-EXP-000005']) {
        expect(rows.some((row) => row.startsWith(`${reference},`))).toBe(true);
      }
      expect(rows.some((row) => row.startsWith('HY-EXP-000001,'))).toBe(false);
    });

    it('leaves the Receipt URL cell empty for an expense with no receipt', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${CATEGORY_ID}`);
      const row = dataLines(response.text)[0];

      // The row has no notes and no receipt, so the last two cells are both empty. `Receipt Missing`
      // is the *screen's* wording under `REQ-DOC-003`; in a URL column it would read as a value.
      expect(row).toBe('HY-EXP-000001,05-09-2026,Electricity,Electricity Bill,,450.00,UPI,,');
      expect(response.text).not.toContain('Receipt Missing');
    });

    it('writes the authenticated download path when a receipt is attached', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);
      const row = dataLines(response.text).find((line) => line.startsWith('HY-EXP-000005,'));

      expect(row).toBe(
        `HY-EXP-000005,08-09-2026,Repairs,Other,,600.00,Cash,,` +
          `/api/v1/documents/${ATTACHED_RECEIPT}-document-1/download`,
      );
    });

    it('never leaks a storage key, which would name a file on the server disk', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);

      expect(response.text).not.toContain('storageKey');
      expect(response.text).not.toContain('b'.repeat(64));
      expect(response.text).not.toContain('file://');
    });

    it('exports voided expenses by default, exactly as the unfiltered expense list does', async () => {
      const active = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);
      const onlyActive = await authGet(
        `${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}&status=ACTIVE`,
      );
      const onlyVoided = await authGet(
        `${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}&status=VOIDED`,
      );

      // The expense list has no status default either -- `TRANSACTION_LIST_DEFAULTS.status` is `''`
      // and the screen marks a voided row with a status badge. So the export includes voided rows
      // too, and `status` is the filter an Admin uses to exclude them. Asserted explicitly because
      // this is the one behaviour that could silently change the meaning of a downloaded file.
      expect(active.text).toContain('HY-EXP-000004');
      expect(active.text).toContain('HY-EXP-000004,06-09-2026,Repairs,Other,,300.00,Cash,,');

      expect(onlyActive.text).not.toContain('HY-EXP-000004');
      expect(dataLines(onlyActive.text)).toHaveLength(2);

      expect(dataLines(onlyVoided.text)).toHaveLength(1);
      expect(onlyVoided.text).toContain('HY-EXP-000004,06-09-2026');
    });

    it('exports the same expenses the on-screen list shows for the same filters', async () => {
      const page = listOf<ExpenseSummary>(
        (await authGet(`/api/v1/expenses?categoryId=${OTHER_CATEGORY_ID}&pageSize=100`)).body,
      );
      const exported = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);

      // The screen paginates and the file does not, so equal totals are the real invariant: a file
      // describing a different set of expenses than the one on screen would be the failure mode.
      expect(dataLines(exported.text)).toHaveLength(page.pagination.totalItems);
    });

    it('exports an expense whose category was retired, rather than hiding history', async () => {
      const response = await authGet(`${EXPORT_PATH}?categoryId=${INACTIVE_CATEGORY_ID}`);
      const row = dataLines(response.text)[0];

      // Retiring a category stops it being *chosen* for new expenses. The expenses already recorded
      // under it stay exportable, or a month could not be closed out after the fact.
      expect(row).toBe('HY-EXP-000003,11-07-2026,Retired category,Other,,80.00,Cash,,');
    });

    it('writes only the header when a filter matches no expense', async () => {
      const response = await authGet(
        `${EXPORT_PATH}?categoryId=${CATEGORY_ID}&search=nothing+at+all`,
      );

      expect(response.status).toBe(200);
      expect(response.text.trimEnd().split('\r\n')).toHaveLength(1);
      expect(response.text).toBe(
        'Expense ID,Expense Date,Category,Reason,Vendor,Amount,Payment Method,Notes,Receipt URL\r\n',
      );
    });

    it('quotes a note containing a comma so the sheet stays aligned', async () => {
      // The fixture note has no comma, so this drives the escaper through a real request by
      // creating the expense first. `Bought from the hardware shop on main street` proves the
      // unquoted happy path; the created row proves the quoted one.
      const response = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);
      const row = dataLines(response.text).find((line) => line.startsWith('HY-EXP-000002,'));

      expect(row).toBe(
        'HY-EXP-000002,20-08-2026,Repairs,Other,,123.45,Cash,' +
          'Bought from the hardware shop on main street,',
      );

      const created = dataOf<ExpenseSummary>(
        (
          await createExpense(
            'expense-csv-comma-note',
            expenseBody({
              categoryId: OTHER_CATEGORY_ID,
              expenseReasonId: OTHER_CATEGORY_REASON_ID,
              amount: '99.00',
              notes: 'Paid to Ravi, in cash',
            }),
          )
        ).body,
      );

      const after = await authGet(`${EXPORT_PATH}?categoryId=${OTHER_CATEGORY_ID}`);
      const quoted = dataLines(after.text).find((line) => line.startsWith(created.referenceId));

      expect(quoted).toContain('"Paid to Ravi, in cash"');
    });
  });
});
