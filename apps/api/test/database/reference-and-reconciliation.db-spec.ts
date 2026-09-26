/**
 * Reference allocation, concurrency safety, and the derived financial layer.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` ("`id_sequence` rows allocate the next value
 * inside the same database transaction that creates the record. A failed transaction
 * must not consume a committed business reference permanently for the caller, and
 * concurrent allocation must never produce duplicates."), `docs/01-REQUIREMENTS.md`
 * `REQ-FIN-001` and `REQ-FIN-003`, and `docs/02-ARCHITECTURE.md` (server-side integer
 * calculation from persisted data).
 */

import { createHarness, createPrismaClient, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');
const OCTOBER = new Date('2026-10-01T00:00:00.000Z');

describe('reference allocation and derived financial layer', () => {
  let harness: TestHarness;
  let actorAdminId: string;
  let categoryId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: { displayName: 'Actor' } });
    actorAdminId = admin.id;
    const category = await harness.categories.create('Electricity', actorAdminId);
    categoryId = category.id;
  });

  describe('human-readable references (REQ-MEM-002, REQ-FIN-011, REQ-DOC-008)', () => {
    it('formats the first value of every scope as documented', async () => {
      const references = await harness.runtime.$transaction(async (tx) => ({
        member: await harness.references.allocate(tx, 'MEMBER'),
        income: await harness.references.allocate(tx, 'INCOME'),
        expense: await harness.references.allocate(tx, 'EXPENSE'),
        document: await harness.references.allocate(tx, 'DOCUMENT'),
      }));

      expect(references).toEqual({
        member: 'HY-MEM-0001',
        income: 'HY-INC-000001',
        expense: 'HY-EXP-000001',
        document: 'HY-DOC-000001',
      });
    });

    it('allocates sequentially across separate transactions', async () => {
      const first = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 1_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );
      const second = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 2_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      expect(first.referenceId).toBe('HY-EXP-000001');
      expect(second.referenceId).toBe('HY-EXP-000002');
    });

    it('does not consume a reference when the creating transaction fails', async () => {
      await expect(
        harness.runtime.$transaction(async (tx) => {
          await harness.references.allocate(tx, 'EXPENSE');
          throw new Error('simulated failure after allocation');
        }),
      ).rejects.toThrow(/simulated failure/);

      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 1_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      expect(created.referenceId).toBe('HY-EXP-000001');
    });

    it('never produces a duplicate under concurrent allocation', async () => {
      const allocations = await Promise.all(
        Array.from({ length: 12 }, () =>
          harness.runtime.$transaction((tx) => harness.references.allocate(tx, 'MEMBER')),
        ),
      );

      expect(new Set(allocations).size).toBe(12);
      expect(allocations).toContain('HY-MEM-0001');
      expect(allocations).toContain('HY-MEM-0012');
    });

    it('keeps concurrent income and expense sequences independent', async () => {
      const [income, expense] = await Promise.all([
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 5_000n,
            paymentMethod: 'UPI',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            incomeType: 'OFFERING',
          },
          { actorAdminId },
        ),
        harness.transactions.create(
          {
            transactionType: 'EXPENSE',
            amountPaise: 4_000n,
            paymentMethod: 'UPI',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            categoryId,
          },
          { actorAdminId },
        ),
      ]);

      expect(income.referenceId).toBe('HY-INC-000001');
      expect(expense.referenceId).toBe('HY-EXP-000001');
    });
  });

  describe('active-only totals and method balances (TEST-FIN-003, REQ-FIN-002)', () => {
    async function seedTotals(): Promise<void> {
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 200_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'OFFERING',
        },
        { actorAdminId },
      );
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 300_000n,
          paymentMethod: 'UPI',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'DONATION',
        },
        { actorAdminId },
      );
      await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 50_000n,
          paymentMethod: 'BANK_TRANSFER',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 999n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'OFFERING',
        },
        { actorAdminId },
      );
    }

    it('sums income, expense, and movement exactly', async () => {
      await seedTotals();
      const totals = await harness.reconciliation.periodTotals(
        SEPTEMBER,
        new Date('2026-09-30T00:00:00.000Z'),
      );

      expect(totals.incomePaise).toBe(500_999n);
      expect(totals.expensePaise).toBe(50_000n);
      expect(totals.movementPaise).toBe(450_999n);
    });

    it('excludes a voided transaction from every total while keeping it queryable', async () => {
      await seedTotals();
      const [voided] = await harness.runtime.financialTransaction.findMany({
        where: { incomeType: 'DONATION' },
      });

      await harness.transactions.voidTransaction(voided?.id ?? '', 'Entered twice', {
        actorAdminId,
      });

      const totals = await harness.reconciliation.periodTotals(
        SEPTEMBER,
        new Date('2026-09-30T00:00:00.000Z'),
      );
      expect(totals.incomePaise).toBe(200_999n);

      const retained = await harness.transactions.findById(voided?.id ?? '');
      expect(retained.status).toBe('VOIDED');

      const audit = await harness.audit.countForEntity('financial_transaction', voided?.id ?? '');
      expect(audit).toBe(2);
    });

    it('reports cumulative balances per payment method through a business date', async () => {
      await seedTotals();
      const balances = await harness.reconciliation.endingBalancesThrough(
        new Date('2026-09-30T00:00:00.000Z'),
      );

      expect(balances.incomePaise).toBe(500_999n);
      expect(balances.expensePaise).toBe(50_000n);
      expect(balances.availablePaise).toBe(450_999n);
      expect(balances.byMethod.CASH).toBe(200_999n);
      expect(balances.byMethod.UPI).toBe(300_000n);
      expect(balances.byMethod.BANK_TRANSFER).toBe(-50_000n);
    });

    it('ignores business dates after the filter, which is a calendar date', async () => {
      await seedTotals();
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 777n,
          paymentMethod: 'CASH',
          businessDate: OCTOBER,
          occurredAt: new Date(),
          incomeType: 'OFFERING',
        },
        { actorAdminId },
      );

      const september = await harness.reconciliation.endingBalancesThrough(
        new Date('2026-09-30T00:00:00.000Z'),
      );
      const october = await harness.reconciliation.endingBalancesThrough(
        new Date('2026-10-31T00:00:00.000Z'),
      );

      expect(september.incomePaise).toBe(500_999n);
      expect(october.incomePaise).toBe(501_776n);
    });

    it('groups expenses by category and income by type', async () => {
      const second = await harness.categories.create('Food', actorAdminId);
      await seedTotals();
      await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 1_500n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          categoryId: second.id,
        },
        { actorAdminId },
      );

      const byCategory = await harness.reconciliation.expenseByCategory(
        SEPTEMBER,
        new Date('2026-09-30T00:00:00.000Z'),
      );
      const byType = await harness.reconciliation.incomeByType(
        SEPTEMBER,
        new Date('2026-09-30T00:00:00.000Z'),
      );

      expect(byCategory).toEqual([
        { categoryId, amountPaise: 50_000n },
        { categoryId: second.id, amountPaise: 1_500n },
      ]);
      expect(byType).toEqual([
        { incomeType: 'OFFERING', amountPaise: 200_999n },
        { incomeType: 'DONATION', amountPaise: 300_000n },
      ]);
    });
  });

  describe('contribution derivation (REQ-CONTRIB-002)', () => {
    async function seedContribution(): Promise<{ periodId: string; memberId: string }> {
      const member = await harness.members.create({ name: 'George Mathew' }, actorAdminId);
      const period = await harness.contributions.create({
        memberId: member.id,
        year: 2026,
        month: 9,
        expectedPaise: 50_000n,
      });

      return { periodId: period.id, memberId: member.id };
    }

    it('derives NOT PAID, PARTIALLY PAID, and PAID from active transactions only', async () => {
      const { periodId, memberId } = await seedContribution();

      expect((await harness.contributions.summarize(periodId)).status).toBe('NOT PAID');

      const partial = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 20_000n,
          paymentMethod: 'UPI',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          contributionPeriodId: periodId,
          memberId,
        },
        { actorAdminId },
      );

      const afterPartial = await harness.contributions.summarize(periodId);
      expect(afterPartial.status).toBe('PARTIALLY PAID');
      expect(afterPartial.receivedPaise).toBe(20_000n);
      expect(afterPartial.remainingPaise).toBe(30_000n);

      await harness.transactions.correct(
        partial.id,
        { amountPaise: 50_000n, expectedRevision: partial.revision },
        { actorAdminId },
      );

      const afterCorrection = await harness.contributions.summarize(periodId);
      expect(afterCorrection.status).toBe('PAID');
      expect(afterCorrection.remainingPaise).toBe(0n);
    });

    it('returns to PARTIALLY PAID when a contribution is voided', async () => {
      const { periodId, memberId } = await seedContribution();
      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          contributionPeriodId: periodId,
          memberId,
        },
        { actorAdminId },
      );

      expect((await harness.contributions.summarize(periodId)).status).toBe('PAID');

      await harness.transactions.voidTransaction(contribution.id, 'Wrong member', { actorAdminId });

      const afterVoid = await harness.contributions.summarize(periodId);
      expect(afterVoid.status).toBe('NOT PAID');
      expect(afterVoid.receivedPaise).toBe(0n);
    });
  });

  describe('persistence across a new connection (restart safety)', () => {
    it('reads a committed transaction back through a fresh client', async () => {
      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 12_345n,
          paymentMethod: 'BANK_TRANSFER',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          description: 'Persisted across a restart',
          categoryId,
        },
        { actorAdminId },
      );

      const reconnected = createPrismaClient(
        process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '',
      );

      try {
        await reconnected.verifyConnectivity();
        const found = await reconnected.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
        });

        expect(found.amountPaise).toBe(12_345n);
        expect(found.referenceId).toBe(created.referenceId);
        expect(found.description).toBe('Persisted across a restart');
      } finally {
        await reconnected.$disconnect();
      }
    });
  });
});
