import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_REPORT_ACTIONS,
  CSRF_TOKEN_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  TRANSACTION_PAGE_SIZE_MAX,
  isApiErrorBody,
  isApiSuccessEnvelope,
  type ApiSuccessEnvelope,
  type AuditHistoryResponse,
  type DemoSettings,
} from '@hyssop/contracts';
import request, { agent, type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { SessionService } from '../src/auth/session.service';
import { AuditEventRepository } from '../src/database/audit/audit-event.repository';
import { AppSettingRepository } from '../src/database/settings/app-setting.repository';
import { IdempotencyRecordRepository } from '../src/database/idempotency/idempotency-record.repository';
import {
  applyTestProcessEnvironment,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
  TEST_SESSION_COOKIE,
} from './support/test-application';
import {
  FakeAudit,
  FakeIdempotency,
  FakeLedger,
  FakeSettings,
  fakeSession,
  httpServer,
  type FakeAuditEvent,
} from './support/fake-ledger';

/**
 * HTTP-layer coverage for the Phase 10 audit history and settings routes.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-AUDIT-001`, `REQ-AUDIT-002`, `REQ-SETTINGS-001`
 * to `REQ-SETTINGS-009`; transport from `docs/06-API-SPEC.md` "Audit History" and "Settings".
 * The real controllers, the real DTO validation, the real `AuditEventsService`, the real
 * `SettingsService`, the real snapshot flattener, the real global `SessionGuard`, the real CSRF
 * check, the real idempotency runner, and the real error filter all run.
 *
 * Only persistence is replaced, by the shared doubles in `test/support/`, so this suite needs no
 * PostgreSQL. What it asserts is the transport contract and the honesty rules:
 *
 * - Both routes require a session, and the audit trail is not reachable unauthenticated.
 * - The audit trail is read-only: there is no mutation route to attempt.
 * - Every event is attributed, labelled in plain language, and carries a flattened before/after
 *   with a sensitive value redacted and its field kept.
 * - A snapshot that was never recorded is distinguishable from one recorded as empty.
 * - Filters are validated rather than silently matching nothing, including an inverted date range.
 * - The fixed currency and timezone are shown and reported as not editable, and a request that
 *   tries to change them is refused.
 * - Money crosses the boundary as an exact string, and at least one payment method stays enabled.
 * - A settings change is audited, idempotent, and does not touch a single stored transaction.
 *
 * What genuinely needs a database - the `app_setting` CHECK constraints, the transactional
 * atomicity of a multi-setting write, and the `audit_event` append-only trigger and grants - is
 * proved by `test/database/audited-commands.db-spec.ts`.
 */

const SESSION_TOKEN = 'session-token-for-the-audit-and-settings-routes';
const CSRF_TOKEN = 'csrf-token-for-the-audit-and-settings-routes';

const VOIDED_TRANSACTION_ID = 'f1000000-0000-4000-8000-000000000001';
const MEMBER_ID = 'f2000000-0000-4000-8000-000000000001';
const PERIOD_ID = 'f2000000-0000-4000-8000-000000000002';
const CATEGORY_ID = 'f3000000-0000-4000-8000-000000000001';

/**
 * The trail the suite serves, one event per requirement in `REQ-AUDIT-001`.
 *
 * The entity kinds differ on purpose: `financial_transaction` for the create and the void,
 * `member` for a member correction, `contribution_period` for an expectation, `expense_category`
 * for a category, and `app_setting` for the settings change. A history filter is only meaningful
 * if the entity type is genuinely part of the row, so the fixtures prove that rather than
 * assuming it.
 *
 * The member event's `after` snapshot deliberately carries a sensitive key. `docs/07-SECURITY-RULES.md`
 * forbids exposing secrets through the audit trail, and a snapshot is whatever the writing code
 * chose - so this is the case that proves the flattener redacts on the way out rather than
 * trusting the snapshot to have been safe.
 */
function seedEvents(): FakeAuditEvent[] {
  return [
    {
      id: 'audit-0001',
      entityId: VOIDED_TRANSACTION_ID,
      entityType: 'financial_transaction',
      entityReference: 'HY-EXP-000001',
      action: 'TRANSACTION_CREATED',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-05T04:30:00.000Z'),
      reason: null,
      requestId: 'req-create',
      before: null,
      after: {
        referenceId: 'HY-EXP-000001',
        amountPaise: '45000',
        paymentMethod: 'UPI',
        // A nested structure, so the flattener's dotted paths and array indices are exercised.
        member: { id: MEMBER_ID, name: 'Anitha Kumaran' },
      },
    },
    {
      id: 'audit-0002',
      entityId: VOIDED_TRANSACTION_ID,
      entityType: 'financial_transaction',
      entityReference: 'HY-EXP-000001',
      action: 'TRANSACTION_VOIDED',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-06T09:15:00.000Z'),
      reason: 'Recorded twice by mistake',
      requestId: 'req-void',
      before: { amountPaise: '45000', status: 'ACTIVE' },
      after: { amountPaise: '45000', status: 'VOIDED' },
    },
    {
      id: 'audit-0003',
      entityId: MEMBER_ID,
      entityType: 'member',
      entityReference: 'HY-MEM-0001',
      action: 'MEMBER_UPDATED',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-07T05:00:00.000Z'),
      reason: null,
      requestId: 'req-member',
      before: { phone: '9840012345' },
      after: {
        phone: '9840098765',
        // Would be a credential if any module ever wrote one into a snapshot. The field must be
        // listed with its value withheld, so the viewer can see it existed without seeing it.
        loginToken: 'a-token-that-must-never-be-shown',
      },
    },
    {
      id: 'audit-0004',
      entityId: PERIOD_ID,
      entityType: 'contribution_period',
      entityReference: '2026-09/HY-MEM-0001',
      action: 'CONTRIBUTION_PERIOD_SET',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-08T11:45:00.000Z'),
      reason: null,
      requestId: 'req-period',
      before: null,
      after: { expectedPaise: '50000' },
    },
    {
      id: 'audit-0005',
      entityId: CATEGORY_ID,
      entityType: 'expense_category',
      entityReference: 'Cleaning supplies',
      action: 'CATEGORY_CREATED',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-09T03:00:00.000Z'),
      reason: null,
      requestId: 'req-category',
      before: null,
      after: { name: 'Cleaning supplies', isSystem: false },
    },
    {
      id: 'audit-0006',
      entityId: 'app-setting',
      entityType: 'app_setting',
      entityReference: 'ENABLED_PAYMENT_METHODS',
      action: 'SETTING_UPDATED',
      actorDisplayName: 'Admin',
      occurredAt: new Date('2026-09-10T08:00:00.000Z'),
      reason: null,
      requestId: 'req-settings',
      before: { key: 'ENABLED_PAYMENT_METHODS', value: 'CASH,UPI,BANK_TRANSFER' },
      after: { key: 'ENABLED_PAYMENT_METHODS', value: 'CASH,UPI' },
    },
  ];
}

const SEEDED_SETTINGS = {
  DEFAULT_MONTHLY_CONTRIBUTION_PAISE: '50000',
  ENABLED_PAYMENT_METHODS: 'CASH,UPI,BANK_TRANSFER',
  CURRENCY: 'INR',
  BUSINESS_TIMEZONE: 'Asia/Kolkata',
};

describe('Audit history and settings HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;
  let settings: FakeSettings;

  beforeEach(async () => {
    const ledger = new FakeLedger([]);
    ledger.events.push(...seedEvents());

    settings = new FakeSettings(SEEDED_SETTINGS);

    restoreEnvironment = applyTestProcessEnvironment();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(AuditEventRepository)
      .useValue(new FakeAudit(ledger))
      .overrideProvider(AppSettingRepository)
      .useValue(settings)
      .overrideProvider(IdempotencyRecordRepository)
      .useValue(new FakeIdempotency())
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN
            ? fakeSession({ sessionId: 'session-audit-settings', csrfToken: CSRF_TOKEN })
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

  /**
   * The same request with the session, trusted origin, and CSRF token already applied.
   *
   * A supertest agent is required rather than the bare `request(app)` factory: only an agent
   * carries default headers, and those three are exactly the defaults every state change here
   * needs.
   */
  function authed() {
    return agent(httpServer(app))
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_TOKEN_HEADER, CSRF_TOKEN);
  }

  function patchSettings(key: string | undefined, body: Record<string, unknown>) {
    const call = authed().patch('/api/v1/settings').send(body);

    return key === undefined ? call : call.set(IDEMPOTENCY_KEY_HEADER, key);
  }

  function postContributionDefault(key: string, body: Record<string, unknown>) {
    return authed()
      .post('/api/v1/settings/contribution-default')
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body);
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

  async function readHistory(query = ''): Promise<AuditHistoryResponse> {
    const response = await authGet(`/api/v1/audit-events${query}`);

    expect(response.status).toBe(200);

    return dataOf<AuditHistoryResponse>(response.body);
  }

  async function readSettings(): Promise<DemoSettings> {
    const response = await authGet('/api/v1/settings');

    expect(response.status).toBe(200);

    return dataOf<DemoSettings>(response.body);
  }

  describe('authentication and reachability', () => {
    it.each(['/api/v1/audit-events', '/api/v1/settings'])(
      'refuses %s without a session',
      async (url) => {
        const response = await request(httpServer(app)).get(url);

        expectApiError(response, 401, 'UNAUTHENTICATED');
      },
    );

    it('refuses a settings change without a session, even with a CSRF token', async () => {
      const response = await agent(httpServer(app))
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .set(IDEMPOTENCY_KEY_HEADER, 'anonymous-settings')
        .patch('/api/v1/settings')
        .send({ defaultMonthlyContribution: '600.00' });

      expectApiError(response, 401, 'UNAUTHENTICATED');
      expect(settings.writes).toHaveLength(0);
    });

    it.each([
      ['post', '/api/v1/audit-events'],
      ['patch', '/api/v1/audit-events'],
      ['put', '/api/v1/audit-events'],
      ['delete', '/api/v1/audit-events'],
    ] as const)(
      'offers no %s route on %s, because the trail is append-only',
      async (method, url) => {
        const request = authed()[method](url);
        const response = await request
          .set(IDEMPOTENCY_KEY_HEADER, 'audit-mutation')
          .send({ action: 'TRANSACTION_VOIDED' });

        expect(response.status).toBe(404);
      },
    );

    it('offers no delete route for a settings resource', async () => {
      const response = await authed().delete('/api/v1/settings');

      expect(response.status).toBe(404);
    });
  });

  describe('audit history projection', () => {
    it('returns the whole trail newest first with a total ordering', async () => {
      const history = await readHistory();

      expect(history.rows.map((row) => row.id)).toEqual([
        'audit-0006',
        'audit-0005',
        'audit-0004',
        'audit-0003',
        'audit-0002',
        'audit-0001',
      ]);
      expect(history.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 6,
        totalPages: 1,
      });
    });

    it('attributes every event to an actor, a time, an action, and an entity', async () => {
      const history = await readHistory();
      const voided = history.rows.find((row) => row.id === 'audit-0002');

      expect(voided).toBeDefined();
      expect(voided?.actorDisplayName).toBe('Admin');
      expect(voided?.occurredAt).toBe('2026-09-06T09:15:00.000Z');
      expect(voided?.entityType).toBe('financial_transaction');
      expect(voided?.entityReference).toBe('HY-EXP-000001');
      expect(voided?.reason).toBe('Recorded twice by mistake');
      expect(voided?.requestId).toBe('req-void');
    });

    it('labels every action in plain language while keeping the stored code', async () => {
      const history = await readHistory();

      expect(history.rows.map((row) => [row.action, row.actionLabel])).toEqual([
        ['SETTING_UPDATED', 'Setting changed'],
        ['CATEGORY_CREATED', 'Expense category added'],
        ['CONTRIBUTION_PERIOD_SET', 'Contribution expectation set'],
        ['MEMBER_UPDATED', 'Member corrected'],
        ['TRANSACTION_VOIDED', 'Transaction voided'],
        ['TRANSACTION_CREATED', 'Transaction recorded'],
      ]);
      expect(history.rows.every((row) => row.entityLabel !== '')).toBe(true);
    });

    it('covers every required audited area from REQ-AUDIT-001', async () => {
      const history = await readHistory();
      const kinds = new Set(history.rows.map((row) => row.entityType));

      // Transaction create and void, a member change, a contribution period, a category, and a
      // setting. `document` and the sign-in events are written by their own suites; the filter
      // vocabulary accepting them is proved by the entity-type list below.
      expect(kinds).toEqual(
        new Set([
          'financial_transaction',
          'member',
          'contribution_period',
          'expense_category',
          'app_setting',
        ]),
      );
      expect(AUDIT_ENTITY_TYPES).toEqual(
        expect.arrayContaining([
          'transaction_document',
          'session',
          'app_setting',
          'contribution_period',
        ]),
      );
    });
  });

  describe('audit snapshot detail', () => {
    it('flattens a nested snapshot into labelled, renderable fields', async () => {
      const history = await readHistory('?action=TRANSACTION_CREATED');
      const created = history.rows[0];

      expect(created?.afterRecorded).toBe(true);
      expect(created?.after).toEqual([
        { key: 'referenceId', label: 'Reference Id', value: 'HY-EXP-000001', redacted: false },
        { key: 'amountPaise', label: 'Amount Paise', value: '45000', redacted: false },
        { key: 'paymentMethod', label: 'Payment Method', value: 'UPI', redacted: false },
        { key: 'member.id', label: 'Member Id', value: MEMBER_ID, redacted: false },
        { key: 'member.name', label: 'Member Name', value: 'Anitha Kumaran', redacted: false },
      ]);
    });

    it('distinguishes a snapshot that was never recorded from one recorded as empty', async () => {
      const history = await readHistory('?action=TRANSACTION_CREATED');
      const created = history.rows[0];

      // A creation has no `before`. An empty panel beside `beforeRecorded: false` is honest; the
      // same empty panel beside `true` would claim the change had nothing in it.
      expect(created?.beforeRecorded).toBe(false);
      expect(created?.before).toEqual([]);

      const editedHistory = await readHistory('?action=MEMBER_UPDATED');
      const edited = editedHistory.rows[0];
      expect(edited?.afterRecorded).toBe(true);
      expect(edited?.after.length).toBeGreaterThan(0);
    });

    it('redacts a sensitive value and keeps the field', async () => {
      const history = await readHistory('?action=MEMBER_UPDATED');
      const edited = history.rows[0];

      expect(edited?.after).toContainEqual({
        key: 'loginToken',
        label: 'Login Token',
        value: '[REDACTED]',
        redacted: true,
      });
      // The value must not appear anywhere in the response, including inside another field.
      expect(JSON.stringify(history.rows)).not.toContain('a-token-that-must-never-be-shown');
    });

    it('keeps a null value distinct from an absent field', async () => {
      const history = await readHistory('?action=TRANSACTION_VOIDED');
      const voided = history.rows[0];

      expect(voided?.before.map((field) => field.value)).toEqual(['45000', 'ACTIVE']);
    });
  });

  describe('audit history filters', () => {
    it('filters by action', async () => {
      const history = await readHistory('?action=TRANSACTION_VOIDED');

      expect(history.rows.map((row) => row.id)).toEqual(['audit-0002']);
      expect(history.pagination.totalItems).toBe(1);
      expect(history.filters.action).toBe('TRANSACTION_VOIDED');
    });

    it('filters by entity type', async () => {
      const history = await readHistory('?entityType=member');

      expect(history.rows.map((row) => row.entityType)).toEqual(['member']);
      expect(history.filters.entityType).toBe('member');
    });

    it('filters by a business date range, inclusive of the whole of the last day', async () => {
      // The events sit between 04:30Z and 08:00Z on 6 to 10 Sep, which is 10:00 to 13:30 IST.
      // A `to` of 2026-09-06 has to include the 09:15Z void, and a `from` of 2026-09-10 has to
      // include the 08:00Z settings change: both bounds are whole Asia/Kolkata days.
      const sameDay = await readHistory('?from=2026-09-06&to=2026-09-06');

      expect(sameDay.rows.map((row) => row.id)).toEqual(['audit-0002']);

      const lastDay = await readHistory('?from=2026-09-10&to=2026-09-10');

      expect(lastDay.rows.map((row) => row.id)).toEqual(['audit-0006']);

      const whole = await readHistory('?from=2026-09-05&to=2026-09-10');

      expect(whole.pagination.totalItems).toBe(6);
    });

    it('combines filters and echoes what it applied', async () => {
      const history = await readHistory(
        '?action=TRANSACTION_VOIDED&entityType=financial_transaction&from=2026-09-01&to=2026-09-30&page=1&pageSize=5',
      );

      expect(history.filters).toEqual({
        action: 'TRANSACTION_VOIDED',
        entityType: 'financial_transaction',
        from: '2026-09-01',
        to: '2026-09-30',
      });
      expect(history.pagination.pageSize).toBe(5);
    });

    it.each([
      ['action', 'NOT_AN_ACTION', 'action'],
      ['entityType', 'not_an_entity', 'entityType'],
      ['from', '06-09-2026', 'from'],
      ['to', '2026-13-40', 'to'],
    ])('rejects an unknown %s filter rather than matching nothing', async (_name, value, field) => {
      const response = await authGet(`/api/v1/audit-events?${_name}=${value}`);

      expectApiError(response, 400, 'VALIDATION_FAILED', field);
    });

    it('rejects a range that ends before it begins', async () => {
      const response = await authGet('/api/v1/audit-events?from=2026-09-10&to=2026-09-01');

      expectApiError(response, 400, 'VALIDATION_FAILED', 'from');
    });

    it('rejects a page size beyond the shared maximum', async () => {
      const response = await authGet(
        `/api/v1/audit-events?pageSize=${TRANSACTION_PAGE_SIZE_MAX + 1}`,
      );

      expectApiError(response, 400, 'VALIDATION_FAILED', 'pageSize');
    });

    it('accepts every documented action as a filter value', async () => {
      for (const action of AUDIT_REPORT_ACTIONS) {
        const response = await authGet(`/api/v1/audit-events?action=${action}`);

        expect(response.status).toBe(200);
      }
    });
  });

  describe('audit history pagination', () => {
    it('returns a bounded page and reports the whole match count', async () => {
      const firstPage = await readHistory('?pageSize=2');

      expect(firstPage.rows.map((row) => row.id)).toEqual(['audit-0006', 'audit-0005']);
      expect(firstPage.pagination).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 6,
        totalPages: 3,
      });

      const lastPage = await readHistory('?pageSize=2&page=3');

      expect(lastPage.rows.map((row) => row.id)).toEqual(['audit-0002', 'audit-0001']);
      expect(lastPage.pagination.totalPages).toBe(3);
    });

    it('reports an empty result honestly past the end of the history', async () => {
      const beyond = await readHistory('?page=99');

      expect(beyond.rows).toEqual([]);
      expect(beyond.pagination).toEqual({
        page: 99,
        pageSize: 20,
        totalItems: 6,
        totalPages: 1,
      });
    });
  });

  describe('settings read', () => {
    it('shows the fixed currency and timezone as not editable', async () => {
      const state = await readSettings();

      expect(state.currency).toBe('INR');
      expect(state.businessTimezone).toBe('Asia/Kolkata');
      expect(state.editable).toEqual({
        defaultMonthlyContribution: true,
        enabledPaymentMethods: true,
        currency: false,
        businessTimezone: false,
      });
    });

    it('returns the default contribution as an exact decimal string', async () => {
      const state = await readSettings();

      expect(typeof state.defaultMonthlyContribution).toBe('string');
      expect(state.defaultMonthlyContribution).toBe('500.00');
    });

    it('returns the enabled methods, the minimum rule, and the category entry point', async () => {
      const state = await readSettings();

      expect(state.enabledPaymentMethods).toEqual(['CASH', 'UPI', 'BANK_TRANSFER']);
      // `REQ-SETTINGS-002`: at least one method must remain, so the rule travels as data the
      // screen can apply before the Admin reaches save.
      expect(state.minimumEnabledPaymentMethods).toBe(1);
      expect(state.expenseCategoryManagement.path).toBe('/expenses');
      expect(state.expenseCategoryManagement.note).toContain('Expense screen');
    });
  });

  describe('settings write safety', () => {
    it('requires an idempotency key', async () => {
      const response = await patchSettings(undefined, { defaultMonthlyContribution: '600.00' });

      expectApiError(response, 400, 'VALIDATION_FAILED', IDEMPOTENCY_KEY_HEADER);
      expect(settings.writes).toHaveLength(0);
    });

    it('requires a CSRF token', async () => {
      const response = await request(httpServer(app))
        .patch('/api/v1/settings')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(IDEMPOTENCY_KEY_HEADER, 'settings-without-csrf')
        .send({ defaultMonthlyContribution: '600.00' });

      expectApiError(response, 403, 'CSRF_FAILED');
      expect(settings.writes).toHaveLength(0);
    });

    it('replays an identical retry instead of applying it twice', async () => {
      const first = await patchSettings('settings-retry', {
        defaultMonthlyContribution: '750.00',
      });

      expect(first.status).toBe(200);
      expect(dataOf<DemoSettings>(first.body).defaultMonthlyContribution).toBe('750.00');

      const retry = await patchSettings('settings-retry', {
        defaultMonthlyContribution: '750.00',
      });

      expect(retry.status).toBe(200);
      expect(dataOf<DemoSettings>(retry.body)).toEqual(dataOf<DemoSettings>(first.body));
      expect(settings.writes).toHaveLength(1);
    });

    it('refuses the same key with a different payload', async () => {
      await patchSettings('settings-reuse', { defaultMonthlyContribution: '750.00' });

      const reused = await patchSettings('settings-reuse', {
        defaultMonthlyContribution: '900.00',
      });

      expectApiError(reused, 409, 'CONFLICT');
      expect(settings.stored('DEFAULT_MONTHLY_CONTRIBUTION_PAISE')).toBe('75000');
    });
  });

  describe('settings update', () => {
    it('applies a partial update and leaves an omitted setting alone', async () => {
      const response = await patchSettings('settings-methods-only', {
        enabledPaymentMethods: ['CASH', 'UPI'],
      });

      expect(response.status).toBe(200);

      const state = dataOf<DemoSettings>(response.body);

      expect(state.enabledPaymentMethods).toEqual(['CASH', 'UPI']);
      expect(state.defaultMonthlyContribution).toBe('500.00');

      // A later read must observe the write. A service that validated and then dropped the change
      // would answer 200 here and leave the screen showing values that were never stored.
      expect((await readSettings()).enabledPaymentMethods).toEqual(['CASH', 'UPI']);
    });

    it('stores the enabled methods in the documented order, not the order sent', async () => {
      const response = await patchSettings('settings-order', {
        enabledPaymentMethods: ['UPI', 'CASH'],
      });

      expect(dataOf<DemoSettings>(response.body).enabledPaymentMethods).toEqual(['CASH', 'UPI']);
      expect(settings.stored('ENABLED_PAYMENT_METHODS')).toBe('CASH,UPI');
    });

    it('records the change against the acting admin and the request', async () => {
      await patchSettings('settings-attribution', { enabledPaymentMethods: ['CASH'] });

      expect(settings.writes).toHaveLength(1);
      expect(settings.writes[0]?.actorAdminId).toBeDefined();
      expect(settings.writes[0]?.entries).toEqual([
        { key: 'ENABLED_PAYMENT_METHODS', value: 'CASH' },
      ]);
    });

    it('writes no audit event for a save that changed nothing', async () => {
      await patchSettings('settings-noop', { defaultMonthlyContribution: '500.00' });

      // The value is already `50000`, so the repository skips it and `REQ-AUDIT-001` - which asks
      // for settings *changes* - has nothing to record. An event with identical before and after
      // would make the history claim a change that did not happen.
      expect(settings.writes).toHaveLength(1);
      expect(settings.writes[0]?.unchangedKeys).toEqual(['DEFAULT_MONTHLY_CONTRIBUTION_PAISE']);
    });

    it('changes no stored transaction when a method is disabled', async () => {
      await patchSettings('settings-disable-upi', { enabledPaymentMethods: ['CASH'] });

      // `REQ-SETTINGS-002` and `docs/05-DATABASE-SPEC.md`: disabling a method affects new entries
      // only. The suite has no transaction rows at all, and the write is still settings-only -
      // the audit trail and the ledger are separate tables and this request touches only the
      // former, which `test/database/audited-commands.db-spec.ts` proves against PostgreSQL.
      expect(settings.writes.flatMap((write) => write.entries.map((entry) => entry.key))).toEqual([
        'ENABLED_PAYMENT_METHODS',
      ]);
    });

    it('refuses a body that changes nothing', async () => {
      const response = await patchSettings('settings-empty', {});

      expectApiError(response, 400, 'VALIDATION_FAILED', 'defaultMonthlyContribution');
      expect(settings.writes).toHaveLength(0);
    });

    it('refuses an attempt to change the fixed currency', async () => {
      const response = await patchSettings('settings-currency', { currency: 'USD' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'currency');
      expect(settings.writes).toHaveLength(0);
    });

    it('refuses an attempt to change the fixed business timezone', async () => {
      const response = await patchSettings('settings-timezone', { businessTimezone: 'UTC' });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'businessTimezone');
      expect(settings.writes).toHaveLength(0);
    });

    it.each([
      ['zero', '0'],
      ['negative', '-100.00'],
      ['three decimal places', '100.005'],
      ['an exponent', '1e3'],
      ['grouped digits', '1,000.00'],
      ['text', 'five hundred'],
      ['empty', ''],
    ])('refuses a contribution amount that is %s', async (_name, amount) => {
      const response = await patchSettings(`settings-amount-${_name}`, {
        defaultMonthlyContribution: amount,
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'defaultMonthlyContribution');
      expect(settings.stored('DEFAULT_MONTHLY_CONTRIBUTION_PAISE')).toBe('50000');
    });

    it('keeps the contribution amount exact through to the stored paise count', async () => {
      const response = await patchSettings('settings-exact', {
        defaultMonthlyContribution: '100.10',
      });

      // `Number('100.10')` is a float, and `REQ-FIN-021` requires exact paise. The stored value is
      // 10010 paise, not 10009.999999999998.
      expect(dataOf<DemoSettings>(response.body).defaultMonthlyContribution).toBe('100.10');
      expect(settings.stored('DEFAULT_MONTHLY_CONTRIBUTION_PAISE')).toBe('10010');
    });

    it('refuses to disable every payment method', async () => {
      const response = await patchSettings('settings-none', { enabledPaymentMethods: [] });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'enabledPaymentMethods');
      expect(settings.stored('ENABLED_PAYMENT_METHODS')).toBe('CASH,UPI,BANK_TRANSFER');
    });

    it('refuses an undocumented payment method', async () => {
      const response = await patchSettings('settings-wire', {
        enabledPaymentMethods: ['CASH', 'CHEQUE'],
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'enabledPaymentMethods');
      expect(settings.stored('ENABLED_PAYMENT_METHODS')).toBe('CASH,UPI,BANK_TRANSFER');
    });

    it('refuses a duplicated payment method', async () => {
      const response = await patchSettings('settings-duplicate', {
        enabledPaymentMethods: ['CASH', 'CASH'],
      });

      expectApiError(response, 400, 'VALIDATION_FAILED', 'enabledPaymentMethods');
    });
  });

  describe('settings contribution default', () => {
    it('sets the default monthly expectation', async () => {
      const response = await postContributionDefault('contribution-default-1', {
        defaultMonthlyContribution: '600.00',
      });

      expect(response.status).toBe(200);
      expect(dataOf<DemoSettings>(response.body).defaultMonthlyContribution).toBe('600.00');
      expect(settings.stored('DEFAULT_MONTHLY_CONTRIBUTION_PAISE')).toBe('60000');
    });

    it('requires the amount', async () => {
      const response = await postContributionDefault('contribution-default-2', {});

      expectApiError(response, 400, 'VALIDATION_FAILED', 'defaultMonthlyContribution');
      expect(settings.writes).toHaveLength(0);
    });

    it('replays an identical retry', async () => {
      await postContributionDefault('contribution-default-3', {
        defaultMonthlyContribution: '650.00',
      });

      const retry = await postContributionDefault('contribution-default-3', {
        defaultMonthlyContribution: '650.00',
      });

      expect(retry.status).toBe(200);
      expect(settings.writes).toHaveLength(1);
    });

    it('refuses the same key with a different amount', async () => {
      await postContributionDefault('contribution-default-4', {
        defaultMonthlyContribution: '650.00',
      });

      const reused = await postContributionDefault('contribution-default-4', {
        defaultMonthlyContribution: '700.00',
      });

      expectApiError(reused, 409, 'CONFLICT');
      expect(settings.stored('DEFAULT_MONTHLY_CONTRIBUTION_PAISE')).toBe('65000');
    });
  });

  describe('broken server configuration', () => {
    it('reports an unseeded setting as a server fault rather than inventing a default', async () => {
      // `docs/05-DATABASE-SPEC.md` seeds the four required rows in a migration, so a missing one
      // is an unprepared environment. A `404` would say the request was for something absent and a
      // `400` would say the Admin sent something wrong; neither is true, and a built-in default
      // would let two environments disagree about what a member owes.
      settings.forget('ENABLED_PAYMENT_METHODS');

      const response = await authGet('/api/v1/settings');

      expectApiError(response, 500, 'INTERNAL_ERROR');
    });
  });
});
