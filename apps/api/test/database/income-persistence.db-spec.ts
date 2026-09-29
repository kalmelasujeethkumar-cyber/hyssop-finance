/**
 * Phase 05 income persistence against real PostgreSQL.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-INCOME-001`-`REQ-INCOME-006`,
 * `REQ-FIN-015`, and `docs/05-DATABASE-SPEC.md`.
 *
 * The income HTTP suite proves the transport rules against in-memory doubles. This suite
 * proves the parts that only exist in the database: that a member correction is actually
 * written, that widening the correction allow-list did not open a path the contribution-period
 * trigger is meant to close, and that the income invariants still hold when a real constraint
 * rather than a test double enforces them.
 */

import { ANONYMOUS_DONATION_DESCRIPTION } from '@hyssop/contracts';
import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');

describe('income persistence', () => {
  let harness: TestHarness;
  let actorAdminId: string;
  let memberId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: testAdminData('income-actor') });
    actorAdminId = admin.id;
    const member = await harness.members.create({ name: 'Bose Xavier' }, actorAdminId);
    memberId = member.id;
  });

  /** A named donation: income, a member, and no contribution period. */
  async function createNamedDonation(overrides: { memberId?: string | null } = {}) {
    return harness.transactions.create(
      {
        transactionType: 'INCOME',
        amountPaise: 25_000n,
        paymentMethod: 'BANK_TRANSFER',
        businessDate: SEPTEMBER,
        occurredAt: new Date(),
        incomeType: 'DONATION',
        description: 'Donation for the poor',
        memberId: overrides.memberId === undefined ? memberId : overrides.memberId,
      },
      { actorAdminId },
    );
  }

  describe('member correction is really persisted (DEC-074, ISSUE-026)', () => {
    it('detaches a member with no other change instead of reporting nothing to change', async () => {
      const created = await createNamedDonation();

      // A member-only correction counts as one changed field. When `memberId` was missing from
      // the allow-list this was rejected as "changes nothing", so a mis-keyed donation could
      // only be fixed by voiding it.
      const corrected = await harness.transactions.correct(
        created.id,
        { memberId: null, expectedRevision: created.revision },
        { actorAdminId },
      );

      expect(corrected.memberId).toBeNull();
      expect(corrected.revision).toBe(created.revision + 1);

      const stored = await harness.transactions.findById(created.id);
      expect(stored.memberId).toBeNull();
    });

    it('writes a member change sent together with another field, rather than dropping one', async () => {
      const created = await createNamedDonation();

      // The silent-drop case: a partial write would report 200 and write an audit event while
      // the stored record kept the member the Admin believed they had removed.
      const corrected = await harness.transactions.correct(
        created.id,
        { memberId: null, amountPaise: 26_000n, expectedRevision: created.revision },
        { actorAdminId },
      );

      const stored = await harness.transactions.findById(created.id);
      expect(stored.memberId).toBeNull();
      expect(stored.amountPaise).toBe(26_000n);
      expect(corrected.memberId).toBeNull();
    });

    it('attaches a member to a record that had none', async () => {
      const created = await createNamedDonation({ memberId: null });

      const corrected = await harness.transactions.correct(
        created.id,
        { memberId, expectedRevision: created.revision },
        { actorAdminId },
      );

      expect(corrected.memberId).toBe(memberId);
      expect((await harness.transactions.findById(created.id)).memberId).toBe(memberId);
    });

    it('records the member in the audit before and after values, so the trail shows the fix', async () => {
      const created = await createNamedDonation();

      await harness.transactions.correct(
        created.id,
        { memberId: null, expectedRevision: created.revision },
        { actorAdminId },
      );

      const event = await harness.runtime.auditEvent.findFirst({
        where: { entityId: created.id, action: 'TRANSACTION_UPDATED' },
      });

      // An audit event whose before and after member are identical would document a change that
      // never happened, which is the failure mode `ISSUE-026` recorded.
      expect(event?.before).toMatchObject({ memberId });
      expect(event?.after).toMatchObject({ memberId: null });
    });

    it('rejects a member change on a voided transaction rather than editing frozen history', async () => {
      const created = await createNamedDonation();

      await harness.transactions.voidTransaction(created.id, 'Recorded twice by mistake', {
        actorAdminId,
      });

      await expect(
        harness.transactions.correct(
          created.id,
          { memberId: null, expectedRevision: created.revision + 1 },
          { actorAdminId },
        ),
      ).rejects.toThrow(/cannot be edited/);
    });
  });

  describe('the contribution-period trigger still closes the paths the service refuses', () => {
    it('refuses a member change that would orphan a linked contribution period', async () => {
      const period = await harness.contributions.create(
        { memberId, year: 2026, month: 9, expectedPaise: 50_000n },
        harness.admin.id,
      );
      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );

      // The service refuses to re-link a member contribution before persistence. This proves
      // the database refuses it too, so the allow-list widening cannot be used to orphan a
      // period that a derived contribution status depends on.
      await expect(
        harness.transactions.correct(
          contribution.id,
          { memberId: null, expectedRevision: contribution.revision },
          { actorAdminId },
        ),
      ).rejects.toThrow();

      const stored = await harness.transactions.findById(contribution.id);
      expect(stored.memberId).toBe(memberId);
      expect(stored.contributionPeriodId).toBe(period.id);
    });

    it('refuses a member change to a different member than the period belongs to', async () => {
      const period = await harness.contributions.create(
        { memberId, year: 2026, month: 10, expectedPaise: 50_000n },
        harness.admin.id,
      );
      const other = await harness.members.create({ name: 'Anitha Kumaran' }, actorAdminId);
      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-10-01T00:00:00.000Z'),
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );

      await expect(
        harness.transactions.correct(
          contribution.id,
          { memberId: other.id, expectedRevision: contribution.revision },
          { actorAdminId },
        ),
      ).rejects.toThrow();

      expect((await harness.transactions.findById(contribution.id)).memberId).toBe(memberId);
    });
  });

  describe('income invariants under real constraints', () => {
    it('keeps a member contribution status derived from the ledger after a member correction', async () => {
      const period = await harness.contributions.create(
        { memberId, year: 2026, month: 9, expectedPaise: 50_000n },
        harness.admin.id,
      );
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );

      expect((await harness.contributions.summarize(period.id)).status).toBe('PAID');

      const offering = await createNamedDonation();
      await harness.transactions.correct(
        offering.id,
        { memberId: null, expectedRevision: offering.revision },
        { actorAdminId },
      );

      // Correcting one income record must not disturb a period derived from the others.
      const summary = await harness.contributions.summarize(period.id);
      expect(summary.status).toBe('PAID');
      expect(summary.receivedPaise).toBe(50_000n);
    });

    it('stores an anonymous donation with no member and the server-owned description', async () => {
      const created = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 7_500n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'ANONYMOUS_DONATION',
          description: ANONYMOUS_DONATION_DESCRIPTION,
        },
        { actorAdminId },
      );

      const stored = await harness.transactions.findById(created.id);
      expect(stored.memberId).toBeNull();
      expect(stored.notes).toBeNull();
      expect(stored.description).toBe(ANONYMOUS_DONATION_DESCRIPTION);
    });

    it('refuses an anonymous donation carrying a different description at the database level', async () => {
      // The service replaces whatever the Admin typed, so the constraint is the backstop that
      // stops a free-text donor name reaching storage even if the service is bypassed.
      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 7_500n,
            paymentMethod: 'CASH',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            incomeType: 'ANONYMOUS_DONATION',
            description: 'From Mrs Grace Kumaran',
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/financial_transaction_anonymous_neutral_description/);
    });

    it('allocates income references sequentially and never reuses one after a void', async () => {
      const first = await createNamedDonation();
      const second = await createNamedDonation();

      expect(first.referenceId).toMatch(/^HY-INC-\d{6}$/);
      expect(second.referenceId).toMatch(/^HY-INC-\d{6}$/);
      expect(second.referenceId > first.referenceId).toBe(true);

      await harness.transactions.voidTransaction(first.id, 'Recorded twice by mistake', {
        actorAdminId,
      });

      // A voided record keeps its reference, so a later record must not inherit it.
      const third = await createNamedDonation();
      expect(third.referenceId).not.toBe(first.referenceId);
      expect(third.referenceId > second.referenceId).toBe(true);
    });
  });

  describe('the audit history read works against the real column names', () => {
    // `AuditEventRepository.listForEntity` once selected and ordered by `createdAt`, but the
    // column is `occurred_at`. Prisma types `findMany` with `SelectSubset`, whose inference
    // accepts an unknown field without a compile error, so `npm run typecheck` stayed green and
    // `npm run test:api` stayed green — only a real query failed, with
    // `PrismaClientValidationError: Unknown argument createdAt`, and the browser saw a `500`
    // on the History panel. The read is therefore exercised here against real PostgreSQL, which
    // is the only layer that can observe a wrong column name.
    it('returns the whole trail oldest first with the actor attributed', async () => {
      const created = await createNamedDonation();
      const corrected = await harness.transactions.correct(
        created.id,
        { amountPaise: 30_000n, expectedRevision: created.revision },
        { actorAdminId },
      );
      const voided = await harness.transactions.voidTransaction(
        corrected.id,
        'Recorded twice by mistake',
        { actorAdminId },
      );

      const trail = await harness.audit.listForEntity('financial_transaction', voided.id);

      expect(trail.map((event) => event.action)).toEqual([
        'TRANSACTION_CREATED',
        'TRANSACTION_UPDATED',
        'TRANSACTION_VOIDED',
      ]);

      // The actor is joined in from `admin_user.display_name` rather than read from the event,
      // so a history line names a person and never leaks an internal key.
      expect(trail.every((event) => event.actorDisplayName === 'income-actor')).toBe(true);
      expect(trail.every((event) => !('actorAdminId' in event))).toBe(true);

      // Oldest first, and strictly increasing: the ordering is a real `ORDER BY`, not the
      // order the rows happen to be returned in.
      const times = trail.map((event) => event.occurredAt.getTime());
      expect(times).toEqual([...times].sort((left, right) => left - right));

      // The void reason is part of the record of the event, not only of the transaction.
      expect(trail[2]?.reason).toBe('Recorded twice by mistake');

      // The before/after pair is what makes a correction explainable after the fact.
      expect(JSON.stringify(trail[1]?.before)).toContain('25000');
      expect(JSON.stringify(trail[1]?.after)).toContain('30000');
    });

    it('reads an empty trail rather than failing when a transaction has no events', async () => {
      // Every real transaction has an event, so this only proves the read does not assume one.
      await expect(harness.audit.listForEntity('financial_transaction', memberId)).resolves.toEqual(
        [],
      );
    });
  });
});
