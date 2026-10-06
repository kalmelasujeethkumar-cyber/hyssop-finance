/**
 * Phase 06 expense and category persistence against real PostgreSQL.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-001`-`REQ-EXP-004` and
 * `docs/05-DATABASE-SPEC.md`.
 *
 * The expense HTTP suite proves the transport rules against in-memory doubles. This suite
 * proves the parts that only exist in the database: that an expense really keeps exactly one
 * category, that a category is deactivated rather than deleted so history keeps its label,
 * that case-insensitive name uniqueness is enforced by a constraint instead of only by a
 * pre-check, and that a raw write which bypasses the service cannot produce a stored record
 * the ledger would have to guess about.
 */

import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');

describe('expense persistence', () => {
  let harness: TestHarness;
  let actorAdminId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: testAdminData('expense-actor') });
    actorAdminId = admin.id;
  });

  /** A category created the way the API creates one, so the suite writes through the real path. */
  async function createCategory(name: string) {
    return harness.categories.create(name, actorAdminId);
  }

  /**
   * The reason every expense in this suite is filed under.
   *
   * `REQ-EXP-005` makes a reason part of an expense, so each category gets an `Other` reason
   * through the real repository rather than through a raw insert.
   */
  async function reasonFor(categoryId: string) {
    return harness.ensureReason(categoryId, actorAdminId);
  }

  /** The names of the categories that are currently offered, in the order the picker lists them. */
  async function activeCategoryNames(): Promise<string[]> {
    return (await harness.categories.findActive()).map((row) => row.name);
  }

  /** An expense filed under `categoryId`, created through the shared ledger repository. */
  async function createExpense(categoryId: string, amountPaise = 25_000n) {
    const reason = await reasonFor(categoryId);

    return harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise,
        paymentMethod: 'BANK_TRANSFER',
        businessDate: SEPTEMBER,
        occurredAt: new Date(),
        categoryId,
        expenseReasonId: reason.id,
      },
      { actorAdminId },
    );
  }

  describe('an expense keeps exactly one active category', () => {
    it('stores the category on the record and returns it with the read', async () => {
      const electricity = await createCategory('Electricity');

      const created = await createExpense(electricity.id, 2_450_75n);

      expect(created.categoryId).toBe(electricity.id);
      expect(created.incomeType).toBeNull();
      expect(created.contributionPeriodId).toBeNull();
      expect(created.memberId).toBeNull();

      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(electricity.id);
      // Paise, not a float: the value the UI will format is exactly the value that was stored.
      expect(stored.amountPaise).toBe(2_450_75n);
    });

    it('refuses an expense with no category before anything is written', async () => {
      const electricity = await createCategory('Electricity');

      await expect(
        harness.transactions.create(
          {
            transactionType: 'EXPENSE',
            amountPaise: 25_000n,
            paymentMethod: 'CASH',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            categoryId: null,
            expenseReasonId: (await reasonFor(electricity.id)).id,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/requires a category/);

      expect(await harness.transactions.countMatching({ transactionType: 'EXPENSE' })).toBe(0);
    });

    it('refuses an expense with a category but no reason, and says which field to fix', async () => {
      const electricity = await createCategory('Electricity');

      // `REQ-EXP-005`: "what was this expense for" is part of the record, not an optional
      // annotation, so the pair is refused rather than stored as a half-filled expense.
      await expect(
        harness.transactions.create(
          {
            transactionType: 'EXPENSE',
            amountPaise: 25_000n,
            paymentMethod: 'CASH',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            categoryId: electricity.id,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/requires a reason/);

      expect(await harness.transactions.countMatching({ transactionType: 'EXPENSE' })).toBe(0);
    });

    it('refuses a reason that belongs to a different category', async () => {
      const electricity = await createCategory('Electricity');
      const repairs = await createCategory('Repairs');
      const repairsReason = await reasonFor(repairs.id);

      await expect(
        harness.transactions.create(
          {
            transactionType: 'EXPENSE',
            amountPaise: 25_000n,
            paymentMethod: 'CASH',
            businessDate: SEPTEMBER,
            occurredAt: new Date(),
            categoryId: electricity.id,
            expenseReasonId: repairsReason.id,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/HY_EXP_REASON_CATEGORY_MISMATCH/);

      expect(await harness.transactions.countMatching({ transactionType: 'EXPENSE' })).toBe(0);
    });

    it('refuses a category that is not active, and says which field to fix', async () => {
      const category = await createCategory('Cleaning');
      await harness.categories.update(category.id, { status: 'INACTIVE' }, actorAdminId);

      // The guard the service calls before writing. It is the check that makes a deactivated
      // category a documented field error instead of an accepted row the Admin did not expect.
      await expect(harness.categories.requireActive(category.id)).rejects.toThrow(
        /active category/,
      );

      // `findActive` is what feeds the picker, so a deactivated category cannot be offered
      // and the create form cannot be answered with one.
      expect((await harness.categories.findActive()).map((row) => row.name)).toEqual([]);
    });

    it('refuses a category that does not exist, rather than storing an unlabelled expense', async () => {
      await expect(createExpense('99999999-9999-4999-8999-999999999999')).rejects.toThrow();

      // An expense whose category could not be resolved would have to be displayed with no label
      // at all, so the write has to fail rather than produce a row like that.
      expect(await harness.transactions.countMatching({ transactionType: 'EXPENSE' })).toBe(0);
    });

    it('stores the reason with the record and returns it with the read', async () => {
      const electricity = await createCategory('Electricity');
      const reason = await reasonFor(electricity.id);

      const created = await createExpense(electricity.id);

      expect(created.expenseReasonId).toBe(reason.id);

      const stored = await harness.transactions.findById(created.id);
      expect(stored.expenseReasonId).toBe(reason.id);

      const listed = await harness.transactions.list(
        { transactionType: 'EXPENSE' },
        { limit: 10, offset: 0, sort: 'businessDate', direction: 'desc' },
      );
      expect(listed.find((entry) => entry.id === created.id)?.expenseReason).toMatchObject({
        id: reason.id,
        name: 'Other',
        categoryId: electricity.id,
        status: 'ACTIVE',
      });
    });

    it('refuses a deactivated reason for a new expense but keeps it readable on the record', async () => {
      const electricity = await createCategory('Electricity');
      const reason = await reasonFor(electricity.id);
      const created = await createExpense(electricity.id);

      await harness.reasons.update(reason.id, { status: 'INACTIVE' }, actorAdminId);

      // The guard the service calls before writing. Retiring a reason stops it being chosen for a
      // new expense while leaving the reason that historical expenses already reference intact.
      await expect(
        harness.reasons.requireActiveForCategory(reason.id, electricity.id),
      ).rejects.toThrow(/active reason/);
      // And it leaves the picker: `findActiveForCategory` is what feeds the selector.
      expect(await harness.reasons.findActiveForCategory(electricity.id)).toEqual([]);
      expect(await harness.reasons.findForCategory(electricity.id)).toHaveLength(1);

      // Deactivation stops new entries using the reason; it must not rewrite what the expense
      // that already used it says it was for.
      const listed = await harness.transactions.list(
        { transactionType: 'EXPENSE' },
        { limit: 10, offset: 0, sort: 'businessDate', direction: 'desc' },
      );
      const row = listed.find((entry) => entry.id === created.id);
      expect(row?.expenseReason).toMatchObject({
        id: reason.id,
        name: 'Other',
        status: 'INACTIVE',
      });
    });

    it('keeps the category, the reason and the amount when one of them is corrected', async () => {
      const electricity = await createCategory('Electricity');
      const repairs = await createCategory('Repairs');
      const repairsReason = await harness.ensureReason(repairs.id, actorAdminId, 'Building Repair');
      const created = await createExpense(electricity.id);

      const corrected = await harness.transactions.correct(
        created.id,
        {
          categoryId: repairs.id,
          expenseReasonId: repairsReason.id,
          amountPaise: 3_000n,
          expectedRevision: created.revision,
        },
        { actorAdminId },
      );

      expect(corrected.categoryId).toBe(repairs.id);
      expect(corrected.expenseReasonId).toBe(repairsReason.id);
      expect(corrected.amountPaise).toBe(3_000n);

      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(repairs.id);
      expect(stored.expenseReasonId).toBe(repairsReason.id);
      expect(stored.amountPaise).toBe(3_000n);
    });

    it('refuses a correction that moves only the category or only the reason', async () => {
      const electricity = await createCategory('Electricity');
      const repairs = await createCategory('Repairs');
      const created = await createExpense(electricity.id);
      const originalReasonId = created.expenseReasonId;

      // `REQ-EXP-005` is a statement about the pair. The HTTP layer turns half a pair into a
      // documented `400`; this is the deeper guarantee, proved through the repository so it holds
      // for any caller: a reason that still belongs to the previous category cannot be left behind.
      await expect(
        harness.transactions.correct(
          created.id,
          { categoryId: repairs.id, expectedRevision: created.revision },
          { actorAdminId },
        ),
      ).rejects.toThrow(/HY_EXP_REASON_CATEGORY_MISMATCH/);

      await expect(
        harness.transactions.correct(
          created.id,
          { expenseReasonId: (await reasonFor(repairs.id)).id, expectedRevision: created.revision },
          { actorAdminId },
        ),
      ).rejects.toThrow(/HY_EXP_REASON_CATEGORY_MISMATCH/);

      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(electricity.id);
      expect(stored.expenseReasonId).toBe(originalReasonId);
    });

    it('records the category change in the audit trail with both values', async () => {
      const electricity = await createCategory('Electricity');
      const repairs = await createCategory('Repairs');
      const created = await createExpense(electricity.id);
      const originalReasonId = created.expenseReasonId;
      const repairsReason = await harness.ensureReason(repairs.id, actorAdminId, 'Building Repair');

      await harness.transactions.correct(
        created.id,
        {
          categoryId: repairs.id,
          expenseReasonId: repairsReason.id,
          expectedRevision: created.revision,
        },
        { actorAdminId },
      );

      const event = await harness.runtime.auditEvent.findFirst({
        where: { entityId: created.id, action: 'TRANSACTION_UPDATED' },
      });

      expect(event?.before).toMatchObject({
        categoryId: electricity.id,
        expenseReasonId: originalReasonId,
      });
      expect(event?.after).toMatchObject({
        categoryId: repairs.id,
        expenseReasonId: repairsReason.id,
      });
    });
  });

  describe('a category is deactivated, never deleted', () => {
    it('keeps the historical label and status on an expense after the category is deactivated', async () => {
      const cleaning = await createCategory('Cleaning');
      const created = await createExpense(cleaning.id);

      await harness.categories.update(cleaning.id, { status: 'INACTIVE' }, actorAdminId);

      // The row survives, so the record still explains which category it was filed under and
      // why that category is no longer offered for a new entry.
      const category = await harness.categories.findById(cleaning.id);
      expect(category.name).toBe('Cleaning');
      expect(category.status).toBe('INACTIVE');

      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(cleaning.id);

      const listed = await harness.transactions.list(
        { transactionType: 'EXPENSE' },
        { limit: 10, offset: 0, sort: 'businessDate', direction: 'desc' },
      );
      const row = listed.find((entry) => entry.id === created.id);
      expect(row?.category?.name).toBe('Cleaning');
      expect(row?.category?.status).toBe('INACTIVE');
    });

    it('stops offering a deactivated category while keeping the rest of the set', async () => {
      await createCategory('Cleaning');
      const transport = await createCategory('Transport');
      await harness.categories.update(transport.id, { status: 'INACTIVE' }, actorAdminId);

      const active = await activeCategoryNames();
      expect(active).toEqual(['Cleaning']);
    });

    it('offers the category again after it is reactivated', async () => {
      const category = await createCategory('Transport');
      await harness.categories.update(category.id, { status: 'INACTIVE' }, actorAdminId);
      await harness.categories.update(category.id, { status: 'ACTIVE' }, actorAdminId);

      expect(await activeCategoryNames()).toEqual(['Transport']);
      await expect(createExpense(category.id)).resolves.toMatchObject({ categoryId: category.id });
    });

    it('keeps the rename on the current category without rewriting what history recorded', async () => {
      const original = await createCategory('Cleaning');
      const created = await createExpense(original.id);

      const renamed = await harness.categories.update(
        original.id,
        { name: 'Cleaning and Sanitation' },
        actorAdminId,
      );

      expect(renamed.normalizedName).toBe('cleaning and sanitation');
      // The transaction keeps the same category identity; a rename is not a new category, so a
      // read that resolves the label reports the current name.
      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(original.id);
    });
  });

  describe('category names are unique case-insensitively in the database itself', () => {
    it('refuses a direct insert whose normalized name is not lower-cased and trimmed', async () => {
      const category = await createCategory('Equipment');

      // A pre-check in the service cannot be relied on for a write that arrives from anywhere
      // else, so the constraint has to reject the row itself.
      await expect(
        harness.runtime.expenseCategory.create({
          data: { name: 'Tools', normalizedName: 'Tools', isSystem: false },
        }),
      ).rejects.toThrow();

      expect(await harness.categories.findByNormalizedName('Tools')).toBeNull();
      expect((await harness.categories.findById(category.id)).name).toBe('Equipment');
    });

    it('refuses a direct insert of a name that differs only by case or padding', async () => {
      await createCategory('Repairs');

      await expect(
        harness.runtime.expenseCategory.create({
          data: { name: '  REPAIRS ', normalizedName: '  REPAIRS ', isSystem: false },
        }),
      ).rejects.toThrow();

      const stored = await harness.categories.findByNormalizedName('repairs');
      expect(stored?.name).toBe('Repairs');
    });

    it('reports a duplicate created through the service as a conflict naming the field', async () => {
      await createCategory('Food');

      await expect(createCategory('food')).rejects.toThrow(/already exists/);
      expect((await harness.categories.findAll()).map((row) => row.name)).toEqual(['Food']);
    });

    it('refuses a rename that would collide with another category', async () => {
      await createCategory('Food');
      const repairs = await createCategory('Repairs');

      await expect(
        harness.categories.update(repairs.id, { name: 'FOOD' }, actorAdminId),
      ).rejects.toThrow(/already exists/);

      expect((await harness.categories.findById(repairs.id)).name).toBe('Repairs');
    });

    it('allows a rename to a different spelling of the same category', async () => {
      const food = await createCategory('Food');

      // Renaming to the same name in different case is not a change, and the guard must not
      // treat the row as a collision with itself.
      const updated = await harness.categories.update(food.id, { name: '  food ' }, actorAdminId);

      expect(updated.name).toBe('food');
      expect((await harness.categories.findAll()).map((row) => row.name)).toEqual(['food']);
    });

    it('refuses a blank name rather than storing a label that cannot be shown', async () => {
      const food = await createCategory('Food');

      await expect(
        harness.categories.update(food.id, { name: '   ' }, actorAdminId),
      ).rejects.toThrow();
      await expect(createCategory('   ')).rejects.toThrow();

      expect((await harness.categories.findAll()).map((row) => row.name)).toEqual(['Food']);
    });

    it('marks a service-created category as custom and never as part of the product set', async () => {
      const custom = await createCategory('Books');

      expect(custom.isSystem).toBe(false);
      expect(custom.status).toBe('ACTIVE');
    });
  });

  describe('the ledger still describes an expense correctly after it is voided', () => {
    it('excludes a voided expense from the active totals while keeping the row auditable', async () => {
      const electricity = await createCategory('Electricity');
      const kept = await createExpense(electricity.id, 10_000n);
      const removed = await createExpense(electricity.id, 40_000n);

      await harness.transactions.voidTransaction(removed.id, 'Entered against the wrong category', {
        actorAdminId,
      });

      // The active-only total is the number the dashboard shows, so a voided row must not be
      // counted even though the record itself is still there.
      const totals = await harness.reconciliation.periodTotals(
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-30T00:00:00.000Z'),
      );
      expect(totals.expensePaise).toBe(10_000n);
      expect(totals.incomePaise).toBe(0n);
      expect(totals.movementPaise).toBe(-10_000n);

      // The per-category breakdown is the other expense aggregate, and it applies the same
      // active-only rule; otherwise a voided row would reappear in a category chart.
      const byCategory = await harness.reconciliation.expenseByCategory(
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-30T00:00:00.000Z'),
      );
      expect(byCategory).toEqual([{ categoryId: electricity.id, amountPaise: 10_000n }]);

      const stored = await harness.transactions.findById(removed.id);
      expect(stored.status).toBe('VOIDED');
      expect(stored.voidReason).toBe('Entered against the wrong category');
      expect(stored.categoryId).toBe(electricity.id);
      expect(stored.id).toBe(removed.id);
      expect(kept.status).toBe('ACTIVE');
    });

    it('refuses to move a voided expense to another category and reason', async () => {
      const electricity = await createCategory('Electricity');
      const repairs = await createCategory('Repairs');
      const created = await createExpense(electricity.id);
      const originalReasonId = created.expenseReasonId;
      await harness.transactions.voidTransaction(created.id, 'Duplicate entry', { actorAdminId });

      await expect(
        harness.transactions.correct(
          created.id,
          {
            categoryId: repairs.id,
            expenseReasonId: (await reasonFor(repairs.id)).id,
            expectedRevision: created.revision + 1,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/cannot be edited/);

      const stored = await harness.transactions.findById(created.id);
      expect(stored.categoryId).toBe(electricity.id);
      // A voided record is frozen, and the reason is now one of the fields it freezes.
      expect(stored.expenseReasonId).toBe(originalReasonId);
    });
  });
});
