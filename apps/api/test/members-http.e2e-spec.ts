import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CSRF_TOKEN_HEADER, isApiErrorBody, REQUEST_ID_HEADER } from '@hyssop/contracts';
import type { Server } from 'node:http';
import request, { agent } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { notFound, staleRevision, validationFailed } from '../src/common/errors/domain.errors';
import { deriveContributionStatus } from '../src/database/contributions/contribution-status';
import { remainingPaise } from '../src/common/money/paise';
import { hashToken } from '../src/auth/token.util';
import type { AuthenticatedSession } from '../src/auth/session.service';
import { SessionService } from '../src/auth/session.service';
import { MemberRepository, normalizeMemberPhone } from '../src/database/members/member.repository';
import { ContributionPeriodRepository } from '../src/database/contributions/contribution-period.repository';
import { AppSettingRepository } from '../src/database/settings/app-setting.repository';
import {
  applyTestProcessEnvironment,
  TEST_ORIGIN,
  TEST_SESSION_COOKIE,
} from './support/test-application';
import { TEST_ENVIRONMENT } from './support/test-application';

/**
 * HTTP-layer coverage for the member and contribution-period routes.
 *
 * The real `MembersService`, the real controllers, the real DTO validation, the real
 * `SessionGuard`, and the real error filter are all exercised. Only the three
 * repositories are replaced with in-memory fakes, so these tests can run with no
 * PostgreSQL and still prove the transport contract: routing, validation, authentication,
 * CSRF, `If-Match` parsing, the money string format, and the documented error envelopes.
 *
 * The behaviour that genuinely needs a database — reference allocation under
 * concurrency, the unique `(member_id, year, month)` race, CHECK constraints, and
 * least-privilege grants — is covered by `test/database/*.db-spec.ts` instead. Nothing
 * here claims to prove persistence.
 */

const SESSION_TOKEN = 'session-token-for-member-routes';
const CSRF_TOKEN = 'csrf-token-for-member-routes';
const ADMIN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const MEMBER_ONE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_TWO_ID = '22222222-2222-4222-8222-222222222222';
const PERIOD_ID = '33333333-3333-4333-8333-333333333333';
const TRANSACTION_ID = '44444444-4444-4444-8444-444444444444';
const NOT_A_UUID = 'HY-MEM-0001';

interface FakeMember {
  id: string;
  referenceId: string;
  name: string;
  phone: string | null;
  notes: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FakePeriod {
  id: string;
  memberId: string;
  year: number;
  month: number;
  expectedPaise: bigint;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeTransaction {
  id: string;
  referenceId: string;
  memberId: string;
  contributionPeriodId: string;
  amountPaise: bigint;
  paymentMethod: string;
  businessDate: Date;
  description: string | null;
  status: 'ACTIVE' | 'VOIDED';
}

function seedMember(id: string, referenceId: string, name: string): FakeMember {
  return {
    id,
    referenceId,
    name,
    phone: null,
    notes: null,
    revision: 1,
    createdAt: new Date('2026-01-02T04:00:00.000Z'),
    updatedAt: new Date('2026-01-02T04:00:00.000Z'),
  };
}

class FakeMembers {
  public readonly members: FakeMember[];
  public readonly auditActors: string[] = [];

  public constructor(members: FakeMember[]) {
    this.members = members;
  }

  public async create(
    input: { name: string; phone?: string | null; notes?: string | null },
    actorAdminId: string,
  ): Promise<FakeMember> {
    this.auditActors.push(actorAdminId);
    const created: FakeMember = {
      ...seedMember(
        '99999999-9999-4999-8999-999999999999',
        `HY-MEM-${String(this.members.length + 1).padStart(4, '0')}`,
        input.name,
      ),
      // The shared rule, applied exactly as the real repository applies it. A double that
      // stored the value verbatim would answer `201` for a phone number production refuses,
      // so the contract test would pass while the behaviour was wrong.
      phone: normalizeMemberPhone(input.phone ?? null),
      notes: input.notes ?? null,
    };
    this.members.push(created);

    return created;
  }

  public async findById(id: string): Promise<FakeMember> {
    const found = this.members.find((member) => member.id === id);

    if (found === undefined) {
      throw notFound('Member', id);
    }

    return found;
  }

  public async search(filters: {
    search?: string;
    limit: number;
    offset: number;
  }): Promise<readonly FakeMember[]> {
    const term = filters.search?.trim().toLowerCase() ?? '';

    const matching =
      term === ''
        ? this.members
        : this.members.filter(
            (member) =>
              member.name.toLowerCase().includes(term) ||
              member.referenceId.toLowerCase().includes(term),
          );

    return matching.slice(filters.offset, filters.offset + filters.limit);
  }

  public async countMatching(search?: string): Promise<number> {
    return (
      await this.search({
        ...(search === undefined ? {} : { search }),
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      })
    ).length;
  }

  public async listTransactions(memberId: string): Promise<readonly FakeTransaction[]> {
    return transactions.filter((transaction) => transaction.memberId === memberId);
  }

  public async update(
    id: string,
    input: {
      name: string;
      phone?: string | null;
      notes?: string | null;
      expectedRevision: number;
    },
    actorAdminId: string,
  ): Promise<FakeMember> {
    this.auditActors.push(actorAdminId);
    const current = await this.findById(id);

    if (current.revision !== input.expectedRevision) {
      throw staleRevision('Member', input.expectedRevision, current.revision);
    }

    Object.assign(current, {
      name: input.name,
      // The same shared rule as `create` and as the real repository.
      phone: normalizeMemberPhone(input.phone ?? null),
      notes: input.notes ?? null,
      revision: current.revision + 1,
      updatedAt: new Date('2026-02-01T04:00:00.000Z'),
    });

    return current;
  }
}

class FakePeriods {
  public readonly periods: FakePeriod[];
  public readonly auditActors: string[] = [];
  public readonly listFilteredCalls: unknown[] = [];

  public constructor(periods: FakePeriod[]) {
    this.periods = periods;
  }

  public async find(memberId: string, year: number, month: number): Promise<FakePeriod | null> {
    return (
      this.periods.find(
        (period) => period.memberId === memberId && period.year === year && period.month === month,
      ) ?? null
    );
  }

  public async create(
    input: { memberId: string; year: number; month: number; expectedPaise: bigint },
    actorAdminId: string,
  ): Promise<FakePeriod> {
    this.auditActors.push(actorAdminId);

    if (input.expectedPaise <= 0n) {
      throw validationFailed('The expected contribution must be greater than zero.', {
        field: 'expectedPaise',
      });
    }

    const created: FakePeriod = {
      id: PERIOD_ID,
      memberId: input.memberId,
      year: input.year,
      month: input.month,
      expectedPaise: input.expectedPaise,
      createdAt: new Date('2026-01-02T04:00:00.000Z'),
      updatedAt: new Date('2026-01-02T04:00:00.000Z'),
    };
    this.periods.push(created);

    return created;
  }

  public async updateExpected(
    id: string,
    expectedPaise: bigint,
    actorAdminId: string,
  ): Promise<FakePeriod> {
    this.auditActors.push(actorAdminId);
    const current = this.periods.find((period) => period.id === id);

    if (current === undefined) {
      throw notFound('Contribution period', id);
    }

    current.expectedPaise = expectedPaise;

    return current;
  }

  public async receivedPaise(periodId: string): Promise<bigint> {
    return transactions
      .filter(
        (transaction) =>
          transaction.status === 'ACTIVE' && transaction.contributionPeriodId === periodId,
      )
      .reduce((total, transaction) => total + transaction.amountPaise, 0n);
  }

  public async listForMemberInYear(memberId: string, year: number): Promise<readonly FakePeriod[]> {
    return this.periods
      .filter((period) => period.memberId === memberId && period.year === year)
      .sort((left, right) => right.month - left.month);
  }

  public async listFiltered(filter: {
    memberId?: string;
    year?: number;
    month?: number;
  }): Promise<readonly FakePeriod[]> {
    this.listFilteredCalls.push(filter);

    return this.periods.filter(
      (period) =>
        (filter.memberId === undefined || period.memberId === filter.memberId) &&
        (filter.year === undefined || period.year === filter.year) &&
        (filter.month === undefined || period.month === filter.month),
    );
  }

  public async summarizeMany(periodIds: readonly string[]) {
    return Promise.all(
      periodIds.map(async (id) => {
        const period = this.periods.find((candidate) => candidate.id === id);

        if (period === undefined) {
          throw notFound('Contribution period', id);
        }

        const receivedPaise = await this.receivedPaise(id);

        return { period, receivedPaise };
      }),
    );
  }

  public async summarizeByPeriod(period: { year: number; month: number }) {
    const periods = await this.listFiltered({ year: period.year, month: period.month });
    const summaries = await this.summarizeMany(periods.map((row) => row.id));

    const expectedTotalPaise = summaries.reduce(
      (total, summary) => total + summary.period.expectedPaise,
      0n,
    );
    const receivedTotalPaise = summaries.reduce(
      (total, summary) => total + summary.receivedPaise,
      0n,
    );

    let paid = 0;
    let partiallyPaid = 0;
    let notPaid = 0;

    for (const summary of summaries) {
      const status = deriveContributionStatus(summary.period.expectedPaise, summary.receivedPaise);

      if (status === 'PAID') {
        paid += 1;
      } else if (status === 'PARTIALLY PAID') {
        partiallyPaid += 1;
      } else {
        notPaid += 1;
      }
    }

    return {
      configured: summaries.length,
      paid,
      partiallyPaid,
      notPaid,
      expectedTotalPaise,
      receivedTotalPaise,
      remainingTotalPaise: remainingPaise(expectedTotalPaise, receivedTotalPaise),
    };
  }
}

class FakeSettings {
  public constructor(private readonly values: Record<string, string>) {}

  public async findOne(key: string) {
    const value = this.values[key];

    if (value === undefined) {
      throw notFound('App setting', key);
    }

    return { key, value };
  }
}

/** Deliberately active, so a void-exclusion regression would change the expected totals. */
let transactions: FakeTransaction[] = [];

const DEFAULT_CONTRIBUTION_SETTING_PAISE = '50000';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/** A session the fake `SessionService` resolves, with a CSRF hash the real service can verify. */
function fakeSession(): AuthenticatedSession {
  return {
    sessionId: 'session-1',
    admin: { id: ADMIN_ID, identifier: 'admin', displayName: 'Admin' },
    csrfTokenHash: hashToken(CSRF_TOKEN),
    context: {
      issuedAt: '2026-01-01T04:00:00.000Z',
      expiresAt: '2026-01-08T04:00:00.000Z',
    },
  };
}

describe('Member and contribution-period HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;
  let members: FakeMembers;
  let periods: FakePeriods;

  beforeEach(async () => {
    transactions = [
      {
        id: TRANSACTION_ID,
        referenceId: 'HY-TRX-0001',
        memberId: MEMBER_ONE_ID,
        contributionPeriodId: PERIOD_ID,
        amountPaise: 50_000n,
        paymentMethod: 'CASH',
        businessDate: new Date('2026-09-05T04:00:00.000Z'),
        description: 'September contribution',
        status: 'ACTIVE',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        referenceId: 'HY-TRX-0002',
        memberId: MEMBER_ONE_ID,
        contributionPeriodId: PERIOD_ID,
        amountPaise: 99_900n,
        paymentMethod: 'UPI',
        businessDate: new Date('2026-09-06T04:00:00.000Z'),
        description: 'Voided duplicate',
        status: 'VOIDED',
      },
    ];

    members = new FakeMembers([
      seedMember(MEMBER_ONE_ID, 'HY-MEM-0001', 'Anitha Kumaran'),
      seedMember(MEMBER_TWO_ID, 'HY-MEM-0002', 'Bose Xavier'),
    ]);
    periods = new FakePeriods([
      {
        id: PERIOD_ID,
        memberId: MEMBER_ONE_ID,
        year: 2026,
        month: 9,
        expectedPaise: 50_000n,
        createdAt: new Date('2026-01-02T04:00:00.000Z'),
        updatedAt: new Date('2026-01-02T04:00:00.000Z'),
      },
    ]);

    restoreEnvironment = applyTestProcessEnvironment();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(MemberRepository)
      .useValue(members)
      .overrideProvider(ContributionPeriodRepository)
      .useValue(periods)
      .overrideProvider(AppSettingRepository)
      .useValue(
        new FakeSettings({
          DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_SETTING_PAISE,
        }),
      )
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN ? fakeSession() : null,
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
   * An authenticated, same-origin, CSRF-carrying state change.
   *
   * The method is a parameter rather than a branch, so all state-changing verbs go through
   * the same cookie, origin, and token setup. A helper that forgot one of them would let a
   * test pass for the wrong reason, or fail for a reason the test is not about.
   */
  function authChange(method: 'post' | 'put' | 'patch', url: string) {
    const change = authed();

    switch (method) {
      case 'post':
        return change.post(url);
      case 'put':
        return change.put(url);
      case 'patch':
        return change.patch(url);
    }
  }

  /** The same request with the session, origin, and CSRF token already applied. */
  function authed() {
    // A supertest agent is required rather than the bare `request(app)` factory: only an
    // agent carries default headers, and the session cookie, trusted origin, and CSRF token
    // are exactly the defaults every state change in this file needs.
    return agent(httpServer(app))
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_TOKEN_HEADER, CSRF_TOKEN);
  }

  describe('authentication and CSRF', () => {
    it('refuses every member route without a session', async () => {
      for (const url of [
        '/api/v1/members',
        `/api/v1/members/${MEMBER_ONE_ID}`,
        `/api/v1/members/${MEMBER_ONE_ID}/contributions`,
        `/api/v1/members/${MEMBER_ONE_ID}/transactions`,
        '/api/v1/contribution-periods',
      ]) {
        const response = await request(httpServer(app)).get(url).expect(401);

        expect(isApiErrorBody(response.body)).toBe(true);
        if (isApiErrorBody(response.body)) {
          expect(response.body.error.code).toBe('UNAUTHENTICATED');
        }
      }
    });

    it('refuses a member mutation without the CSRF header even with a valid session', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/members')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Anitha Kumaran' })
        .expect(403);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('CSRF_FAILED');
      }
      expect(members.members).toHaveLength(2);
    });

    it('refuses a cross-origin member mutation even with a valid session and CSRF token', async () => {
      await request(httpServer(app))
        .post('/api/v1/members')
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', 'https://untrusted.example')
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .send({ name: 'Anitha Kumaran' })
        .expect(403);

      expect(members.members).toHaveLength(2);
    });
  });

  describe('GET /api/v1/members', () => {
    it('returns the documented list envelope with a real total', async () => {
      const response = await authGet('/api/v1/members').expect(200);
      const body: unknown = response.body;

      expect(isApiErrorBody(body)).toBe(false);
      const data = (body as { data: unknown[]; pagination: Record<string, number> }).data;
      const pagination = (body as { pagination: Record<string, number> }).pagination;

      expect(data).toHaveLength(2);
      expect(pagination['page']).toBe(1);
      expect(pagination['pageSize']).toBe(20);
      expect(pagination['totalItems']).toBe(2);
      expect(pagination['totalPages']).toBe(1);
    });

    it('exposes both the human-readable reference and the addressing UUID', async () => {
      const response = await authGet('/api/v1/members').expect(200);
      const [first] = (response.body as { data: Record<string, unknown>[] }).data;

      expect(first?.['referenceId']).toBe('HY-MEM-0001');
      expect(first?.['id']).toBe(MEMBER_ONE_ID);
    });

    it('paginates and reports a total that matches the whole filtered set', async () => {
      const response = await authGet('/api/v1/members?page=2&pageSize=1').expect(200);
      const body = response.body as {
        data: Record<string, unknown>[];
        pagination: Record<string, number>;
      };

      expect(body.data).toHaveLength(1);
      expect(body.pagination['totalItems']).toBe(2);
      expect(body.pagination['totalPages']).toBe(2);
    });

    it('rejects an unknown query key rather than silently dropping it', async () => {
      const response = await authGet('/api/v1/members?isAdmin=true').expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects a sort column outside the documented closed set', async () => {
      const response = await authGet('/api/v1/members?sort=notes').expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('searches by name and by reference', async () => {
      const byName = await authGet('/api/v1/members?search=xavier').expect(200);
      const byReference = await authGet('/api/v1/members?search=HY-MEM-0002').expect(200);

      expect((byName.body as { data: unknown[] }).data).toHaveLength(1);
      expect((byReference.body as { data: unknown[] }).data).toHaveLength(1);
    });
  });

  describe('GET /api/v1/members/:id', () => {
    it('returns the member with derived contribution state', async () => {
      const response = await authGet(`/api/v1/members/${MEMBER_ONE_ID}?year=2026`).expect(200);
      const body = response.body as { data: Record<string, unknown> };
      const periodsView = body.data['contributionPeriods'] as Record<string, unknown>[];

      expect(body.data['referenceId']).toBe('HY-MEM-0001');
      expect(periodsView).toHaveLength(1);
      // 50_000 expected, 50_000 received active, so the month is fully paid and the
      // voided 99_900 row is excluded from the derived total.
      expect(periodsView[0]?.['expectedPaise']).toBe('500.00');
      expect(periodsView[0]?.['receivedPaise']).toBe('500.00');
      expect(periodsView[0]?.['remainingPaise']).toBe('0.00');
      expect(periodsView[0]?.['status']).toBe('PAID');
    });

    it('returns 404 for an unknown member', async () => {
      const response = await authGet('/api/v1/members/66666666-6666-4666-8666-666666666666').expect(
        404,
      );

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('rejects a human-readable reference where a UUID is required', async () => {
      const response = await authGet(`/api/v1/members/${NOT_A_UUID}`).expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /api/v1/members/:id/transactions', () => {
    it('serves the documented transaction history and keeps voided rows visible', async () => {
      const response = await authGet(`/api/v1/members/${MEMBER_ONE_ID}/transactions`).expect(200);
      const data = (response.body as { data: Record<string, unknown>[] }).data;

      expect(data).toHaveLength(2);
      expect(data[0]?.['amountPaise']).toBe('500.00');
      expect(data[0]?.['status']).toBe('ACTIVE');
      expect(data[1]?.['status']).toBe('VOIDED');
    });

    it('returns an empty list for a member with no transactions rather than a 404', async () => {
      const response = await authGet(`/api/v1/members/${MEMBER_TWO_ID}/transactions`).expect(200);

      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('POST /api/v1/members', () => {
    it('creates a member and records the authenticated actor', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: '  Anitha Kumaran  ', phone: '+91 98765 43210' })
        .expect(201);

      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['name']).toBe('Anitha Kumaran');
      expect(data['referenceId']).toBe('HY-MEM-0003');
      expect(members.auditActors).toEqual([ADMIN_ID]);
    });

    it('trims the name so whitespace-only input cannot create a nameless member', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: '   ' })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      expect(members.members).toHaveLength(2);
    });

    it('rejects a field outside the documented member shape', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'Anitha Kumaran', revision: 9 })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
    });

    it('rejects a phone number the shared rule refuses', async () => {
      // The rule lives in `@hyssop/contracts` and is used by the browser too. Rejecting a
      // bad number here is what keeps the two applications from disagreeing about what a
      // valid phone is, and the failure has to name the field so the form can show it.
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'Anitha Kumaran', phone: '123' })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.fields?.map((field) => field.field)).toContain('phone');
      }
      expect(members.members).toHaveLength(2);
    });

    it('normalizes a phone number the way the shared rule does', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'Grace Mary', phone: '+91 98765 43210' })
        .expect(201);

      // Stored as ten digits, not as the twelve characters the Admin typed, so search and
      // duplicate detection compare like with like.
      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['phone']).toBe('9876543210');
    });

    it('rejects a name longer than the documented maximum', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'x'.repeat(121) })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.fields?.map((field) => field.field)).toContain('name');
      }
      expect(members.members).toHaveLength(2);
    });

    it('rejects notes longer than the documented maximum', async () => {
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'Anitha Kumaran', notes: 'x'.repeat(2001) })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.fields?.map((field) => field.field)).toContain('notes');
      }
      expect(members.members).toHaveLength(2);
    });

    it('accepts notes exactly at the documented maximum', async () => {
      // The boundary is inclusive on purpose: a value at the limit is legal, and only a
      // value past it is refused. Without this, a limit of "at most 2000" could be
      // implemented as "fewer than 2000" and a legitimate note would be lost.
      const response = await authChange('post', '/api/v1/members')
        .send({ name: 'Anitha Kumaran', notes: 'x'.repeat(2000) })
        .expect(201);

      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['notes']).toBe('x'.repeat(2000));
    });
  });

  describe('CORS preflight for member routes', () => {
    it('allows the If-Match header a member edit needs, and no wildcard', async () => {
      // The browser sends this before a `PATCH` because the header is not a CORS-safelisted
      // one. If the preflight did not allow `If-Match`, the edit would fail in the browser
      // while passing every server-side test, which is exactly the kind of defect that only
      // an end-to-end check catches.
      const response = await request(httpServer(app))
        .options(`/api/v1/members/${MEMBER_ONE_ID}`)
        .set('Origin', TEST_ORIGIN)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token,if-match')
        .expect(204);

      const allowed = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();

      expect(allowed).toContain('if-match');
      expect(allowed).toContain('x-csrf-token');
      expect(allowed).not.toContain('*');
      expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    });

    it('does not allow a member route to an untrusted origin', async () => {
      const response = await request(httpServer(app))
        .options(`/api/v1/members/${MEMBER_ONE_ID}`)
        .set('Origin', 'https://not-the-church.example')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'if-match');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('PATCH /api/v1/members/:id', () => {
    it('requires the If-Match revision rather than defaulting it', async () => {
      const response = await request(httpServer(app))
        .patch(`/api/v1/members/${MEMBER_ONE_ID}`)
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(CSRF_TOKEN_HEADER, CSRF_TOKEN)
        .send({ name: 'Anitha K.' })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('applies an edit for the current revision and increments it', async () => {
      const response = await authChange('patch', `/api/v1/members/${MEMBER_ONE_ID}`)
        .set('If-Match', '"1"')
        .send({ name: 'Anitha K.' })
        .expect(200);

      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['name']).toBe('Anitha K.');
      expect(data['revision']).toBe(2);
      expect(data['referenceId']).toBe('HY-MEM-0001');
      expect(members.auditActors).toEqual([ADMIN_ID]);
    });

    it('returns a conflict for a stale revision instead of overwriting', async () => {
      const response = await authChange('patch', `/api/v1/members/${MEMBER_ONE_ID}`)
        .set('If-Match', '7')
        .send({ name: 'Anitha K.' })
        .expect(409);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        // `STALE_REVISION` is the internal domain condition; the canonical public code is
        // `CONFLICT`, because a stale optimistic lock is one kind of 409 and the browser
        // branches on the code, not on the server's internal taxonomy.
        expect(response.body.error.code).toBe('CONFLICT');
      }
      // The decisive assertion: the stale write must not have landed.
      expect(members.members[0]?.name).toBe('Anitha Kumaran');
      expect(members.members[0]?.revision).toBe(1);
    });

    it('refuses a non-numeric If-Match value', async () => {
      await authChange('patch', `/api/v1/members/${MEMBER_ONE_ID}`)
        .set('If-Match', 'W/"not-a-revision"')
        .send({ name: 'Anitha K.' })
        .expect(400);
    });
  });

  describe('PUT /api/v1/contribution-periods/:memberId/:year/:month', () => {
    it('opens a new period with the configured default read as paise, not rupees', async () => {
      const response = await authChange(
        'put',
        `/api/v1/contribution-periods/${MEMBER_TWO_ID}/2026/10`,
      )
        .send({})
        .expect(200);

      const data = (response.body as { data: Record<string, unknown> }).data;

      // 50000 paise is 500.00 rupees. Treating the stored value as rupees would render
      // 50000.00 and bill the member a hundred times the configured amount.
      expect(data['expectedPaise']).toBe('500.00');
      expect(periods.auditActors).toEqual([ADMIN_ID]);
    });

    it('refuses to reset an existing period when no amount is supplied', async () => {
      const response = await authChange(
        'put',
        `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/9`,
      )
        .send({})
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(periods.periods[0]?.expectedPaise).toBe(50_000n);
    });

    it('changes an existing period when an amount is supplied and records the actor', async () => {
      const response = await authChange(
        'put',
        `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/9`,
      )
        .send({ expectedPaise: '750.00' })
        .expect(200);

      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['expectedPaise']).toBe('750.00');
      expect(data['receivedPaise']).toBe('500.00');
      expect(data['remainingPaise']).toBe('250.00');
      expect(data['status']).toBe('PARTIALLY PAID');
      expect(periods.auditActors).toEqual([ADMIN_ID]);
    });

    it('is idempotent for the same expected amount', async () => {
      const first = await authChange('put', `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/9`)
        .send({ expectedPaise: '500.00' })
        .expect(200);
      const second = await authChange('put', `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/9`)
        .send({ expectedPaise: '500.00' })
        .expect(200);

      expect(second.body).toEqual(first.body);
      // No second audit entry: an unchanged value must not look like a change.
      expect(periods.auditActors).toEqual([]);
    });

    it('rejects a month outside the calendar', async () => {
      await authChange('put', `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/13`)
        .send({ expectedPaise: '500.00' })
        .expect(400);
    });

    it('rejects a member reference in the path as a malformed identifier, not a missing member', async () => {
      const response = await authChange('put', `/api/v1/contribution-periods/${NOT_A_UUID}/2026/9`)
        .send({ expectedPaise: '500.00' })
        .expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
      // Nothing may be written for an identifier the server refused to accept.
      expect(periods.periods).toHaveLength(1);
    });

    it('rejects a non-numeric year or month in the path', async () => {
      await authChange('put', `/api/v1/contribution-periods/${MEMBER_ONE_ID}/not-a-year/9`)
        .send({ expectedPaise: '500.00' })
        .expect(400);
      await authChange('put', `/api/v1/contribution-periods/${MEMBER_ONE_ID}/2026/not-a-month`)
        .send({ expectedPaise: '500.00' })
        .expect(400);
    });

    it('returns 404 for a well-formed member UUID that does not exist', async () => {
      const response = await authChange(
        'put',
        '/api/v1/contribution-periods/66666666-6666-4666-8666-666666666666/2026/9',
      )
        .send({ expectedPaise: '500.00' })
        .expect(404);

      expect(isApiErrorBody(response.body)).toBe(true);
    });
  });

  describe('GET /api/v1/contribution-periods', () => {
    it('filters by member and year', async () => {
      const response = await authGet(
        `/api/v1/contribution-periods?memberId=${MEMBER_ONE_ID}&year=2026`,
      ).expect(200);
      const data = (response.body as { data: Record<string, unknown>[] }).data;

      expect(data).toHaveLength(1);
      expect(periods.listFilteredCalls.at(-1)).toEqual({
        memberId: MEMBER_ONE_ID,
        year: 2026,
      });
    });

    it('filters by derived status rather than by a stored column', async () => {
      const paid = await authGet('/api/v1/contribution-periods?status=PAID').expect(200);
      const unpaid = await authGet('/api/v1/contribution-periods?status=NOT PAID').expect(200);

      expect((paid.body as { data: unknown[] }).data).toHaveLength(1);
      expect((unpaid.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('rejects a memberId filter that is not a UUID instead of matching nothing', async () => {
      await authGet(`/api/v1/contribution-periods?memberId=${NOT_A_UUID}`).expect(400);
    });

    it('rejects a status outside the documented set', async () => {
      await authGet('/api/v1/contribution-periods?status=LATE').expect(400);
    });

    it('reports an over-broad filter rather than returning a silently short list', async () => {
      periods.periods.push(
        ...Array.from({ length: 600 }, (_unused, index) => ({
          id: `period-${index}`,
          memberId: MEMBER_TWO_ID,
          year: 2026,
          month: (index % 12) + 1,
          expectedPaise: 50_000n,
          createdAt: new Date('2026-01-02T04:00:00.000Z'),
          updatedAt: new Date('2026-01-02T04:00:00.000Z'),
        })),
      );

      const response = await authGet('/api/v1/contribution-periods').expect(400);

      expect(isApiErrorBody(response.body)).toBe(true);
      if (isApiErrorBody(response.body)) {
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /api/v1/contribution-periods/summary', () => {
    it('requires both a year and a month', async () => {
      await authGet('/api/v1/contribution-periods/summary?year=2026').expect(400);
      await authGet('/api/v1/contribution-periods/summary?month=9').expect(400);
    });

    it('returns money as decimal strings, never as JSON numbers', async () => {
      const response = await authGet(
        '/api/v1/contribution-periods/summary?year=2026&month=9',
      ).expect(200);
      const data = (response.body as { data: Record<string, unknown> }).data;

      expect(data['configured']).toBe(1);
      expect(data['paid']).toBe(1);
      expect(data['expectedTotalPaise']).toBe('500.00');
      expect(data['receivedTotalPaise']).toBe('500.00');
      expect(data['remainingTotalPaise']).toBe('0.00');
    });
  });

  describe('request identification', () => {
    it('returns a request ID header on a member route', async () => {
      const response = await authGet('/api/v1/members').expect(200);

      expect(response.headers[REQUEST_ID_HEADER]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
